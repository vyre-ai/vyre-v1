// The Docker host of the computers module against a scripted Engine API: what the container is and is not given, how agentd is asked, what a recording save writes, and the whole
// lifecycle through the handlers on top of it. The same host against real Docker is lifecycle.heavy.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { untar } from "../../../sandbox/src/tar.ts";
import type { ContainerConfig, DockerApi, DockerHttp } from "../../../sandbox/src/docker.ts";
import { AGENTD_CTL, computerContainerConfig, createDockerComputerHost, DEFAULT_COMPUTER_IMAGE, FILES_GUEST, reviewComputerConfig } from "../impl.ts";
import { bindHost } from "../projections.ts";
import { giveBack, provision, sleep, takeOver, wake } from "../handlers/lifecycle.ts";
import { recordStart, recordStop } from "../handlers/record.ts";
import { harness, INTAKE } from "../fixtures/harness.ts";

interface ExecCall { name: string; cmd: readonly string[] }

function fakeApi(answers: Record<string, (body: Record<string, unknown>) => { exitCode?: number; stdout?: string; stderr?: string }> = {}) {
  const calls: string[] = [];
  const execs: ExecCall[] = [];
  const created = new Map<string, ContainerConfig>();
  const running = new Set<string>();
  const archives: Array<{ name: string; dir: string; tar: Uint8Array }> = [];
  let imageThere = true;
  let failExecs = 0;
  const api: DockerApi = {
    async ping() { calls.push("ping"); return true; },
    async imageExists(name) { calls.push(`imageExists ${name}`); return imageThere; },
    async networkCreate() { throw new Error("computers do not make networks"); },
    async networkRemove() { throw new Error("computers do not make networks"); },
    async containerCreate(name, config) { calls.push(`create ${name}`); created.set(name, config); return `id-${name}`; },
    async containerStart(id) { calls.push(`start ${id}`); running.add(id); },
    async containerStop(id, grace) { calls.push(`stop ${id} ${grace}`); running.delete(id); },
    async containerRemove(id) { calls.push(`remove ${id}`); created.delete(id); running.delete(id); },
    async containerRunning(id) { return running.has(id); },
    async exec(name, a) {
      execs.push({ name, cmd: a.cmd });
      if (failExecs > 0) { failExecs--; return { exitCode: 1, stdout: "", stderr: "agentd is not up yet" }; }
      if (a.cmd[0] === AGENTD_CTL) {
        const action = String(a.cmd[1]);
        const body = JSON.parse(String(a.cmd[2] ?? "{}")) as Record<string, unknown>;
        const r = answers[action]?.(body) ?? { stdout: "{}" };
        return { exitCode: r.exitCode ?? 0, stdout: r.stdout ?? "{}", stderr: r.stderr ?? "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    async putArchive(name, dir, tar) { archives.push({ name, dir, tar }); },
  };
  return { api, calls, execs, created, running, archives, setImage(v: boolean) { imageThere = v; }, failNextExecs(n: number) { failExecs = n; } };
}

const ctlCalls = (execs: ExecCall[]): string[] => execs.filter((e) => e.cmd[0] === AGENTD_CTL).map((e) => `${e.cmd[1]} ${e.cmd[2]}`);

test("the container is built inside its profile and a config outside it is refused", () => {
  const c = computerContainerConfig("vyre-comp-abc", "cmt_abc", INTAKE, { api: fakeApi().api, filesRoot: (a) => `/srv/vyre/files/${a}` }, 8);
  assert.deepEqual(reviewComputerConfig(c), []);
  assert.equal(c.Image, DEFAULT_COMPUTER_IMAGE);
  assert.deepEqual(c.HostConfig.CapDrop, ["ALL"]);
  assert.deepEqual(c.HostConfig.SecurityOpt, ["no-new-privileges:true"]);
  assert.equal(c.HostConfig.Privileged, false);
  assert.equal(c.HostConfig.Devices.length, 0);
  assert.equal(c.HostConfig.NetworkMode, "bridge");
  assert.equal(c.HostConfig.IpcMode, "private");
  assert.deepEqual(c.HostConfig.Binds, ["vyre-comp-abc-profile:/home/agent/.profile-disk:rw", `/srv/vyre/files/${INTAKE}:${FILES_GUEST}:rw`]);
  assert.deepEqual(c.Labels, { "vyre.computer": "cmt_abc", "vyre.agent": INTAKE });
  assert.ok(c.HostConfig.Memory > 0 && c.HostConfig.PidsLimit > 0);
  const bad = (f: (x: ContainerConfig) => void): string[] => { const x = structuredClone(c); f(x); return reviewComputerConfig(x); };
  assert.ok(bad((x) => { x.HostConfig.Privileged = true; }).includes("privileged"));
  assert.ok(bad((x) => { x.HostConfig.CapDrop = []; }).includes("capabilities are not all dropped"));
  assert.ok(bad((x) => { x.HostConfig.CapAdd = ["SYS_ADMIN"]; }).includes("capabilities added"));
  assert.ok(bad((x) => { x.HostConfig.NetworkMode = "host"; }).includes("host network"));
  assert.ok(bad((x) => { x.HostConfig.PidMode = "host"; }).includes("host pid namespace"));
  assert.ok(bad((x) => { x.HostConfig.Binds.push("/var/run/docker.sock:/var/run/docker.sock"); }).includes("docker socket"));
  assert.ok(bad((x) => { x.HostConfig.Binds.push("/etc:/etc:ro"); }).includes("a system folder is bound"));
  assert.ok(bad((x) => { x.HostConfig.Devices = [{ PathOnHost: "/dev/kvm" }]; }).includes("devices"));
  assert.ok(bad((x) => { x.HostConfig.Memory = 0; }).includes("no process or memory limit"));
});

test("create makes a stopped container, and an image that is not on the host is an error, not a surprise later", async () => {
  const f = fakeApi();
  const host = createDockerComputerHost({ api: f.api });
  await host.create({ computerId: "cmt_abc", agentId: INTAKE, tabLimit: 8, idleSleepMinutes: 10 });
  assert.deepEqual(f.calls, [`imageExists ${DEFAULT_COMPUTER_IMAGE}`, "create vyre-comp-abc"]);
  assert.equal(f.running.size, 0);
  f.setImage(false);
  await assert.rejects(() => host.create({ computerId: "cmt_two", agentId: "agt_two", tabLimit: 8, idleSleepMinutes: 10 }), /not on this host/);
  assert.equal(f.created.has("vyre-comp-two"), false);
});

test("start unseals the profile, starts the container and waits for agentd to answer", async () => {
  const f = fakeApi();
  const order: string[] = [];
  let slept = 0;
  const host = createDockerComputerHost({ api: f.api, profile: { unseal: async () => { order.push("unseal"); }, seal: async () => { order.push("seal"); } }, sleep: async () => { slept++; } });
  f.failNextExecs(2);
  await host.start({ computerId: "cmt_abc", tabLimit: 5 });
  assert.equal(f.running.has("vyre-comp-abc"), true);
  assert.equal(order[0], "unseal");
  assert.equal(slept, 2, "agentd was not up for the first two tries");
  assert.deepEqual(ctlCalls(f.execs).at(-1), `configure ${JSON.stringify({ tabLimit: 5 })}`);
  // agentd that never answers is an error
  const dead = fakeApi();
  dead.failNextExecs(1000);
  let t = 0;
  const realNow = Date.now;
  Date.now = () => (t += 20_000);
  try {
    await assert.rejects(() => createDockerComputerHost({ api: dead.api, sleep: async () => {} }).start({ computerId: "cmt_x", tabLimit: 1 }), /did not answer in time/);
  } finally {
    Date.now = realNow;
  }
});

test("stop reads the signed-in sessions first, stops the container, then seals the profile", async () => {
  const f = fakeApi({ sessions: () => ({ stdout: JSON.stringify({ sessions: [{ site: "app.example.com", since: 1, lastSeen: 2 }] }) }) });
  const order: string[] = [];
  const host = createDockerComputerHost({ api: f.api, profile: { unseal: async () => {}, seal: async () => { order.push("seal"); } } });
  await host.start({ computerId: "cmt_abc", tabLimit: 8 });
  const out = await host.stop({ computerId: "cmt_abc", reason: "requested" });
  assert.deepEqual(out.sessions, [{ site: "app.example.com", since: 1, lastSeen: 2 }]);
  assert.deepEqual(f.calls.slice(-1), ["stop vyre-comp-abc 10"]);
  assert.deepEqual(order, ["seal"]);
  assert.ok(ctlCalls(f.execs).includes("sessions {}"));
  // removing does not seal what is about to be deleted
  await host.stop({ computerId: "cmt_abc", reason: "remove" });
  assert.deepEqual(order, ["seal"]);
});

test("remove deletes the container and the profile volume", async () => {
  const f = fakeApi();
  const volumes: string[] = [];
  const http: DockerHttp = async (r) => { volumes.push(`${r.method} ${r.path} ${r.query?.["force"] ?? ""}`); return { status: 204, body: new Uint8Array() }; };
  await createDockerComputerHost({ api: f.api, http }).remove("cmt_abc");
  assert.deepEqual(f.calls, ["remove vyre-comp-abc"]);
  assert.deepEqual(volumes, ["DELETE /volumes/vyre-comp-abc-profile true"]);
  const refused: DockerHttp = async () => ({ status: 409, body: new Uint8Array() });
  await assert.rejects(() => createDockerComputerHost({ api: f.api, http: refused }).remove("cmt_abc"), /profile volume was not removed/);
});

test("probe asks agentd only when the container runs", async () => {
  const f = fakeApi({ status: () => ({ stdout: JSON.stringify({ tabs: 3, busy: true, caption: "Reading", lastFrameAt: 99, diskBytes: 7 }) }) });
  const host = createDockerComputerHost({ api: f.api });
  assert.deepEqual(await host.probe("cmt_abc"), { running: false, busy: false, tabs: 0 });
  assert.equal(f.execs.length, 0);
  f.running.add("vyre-comp-abc");
  assert.deepEqual(await host.probe("cmt_abc"), { running: true, busy: true, tabs: 3, caption: "Reading", lastFrameAt: 99, diskBytes: 7 });
});

test("agentd's answers become the host's: takeover, screenshot, stream, sessions, sign out, and errors carry agentd's words", async () => {
  const f = fakeApi({
    screenshot: () => ({ stdout: JSON.stringify({ png: btoa("\u0089PNG"), width: 640, height: 400 }) }),
    stream: (b) => ({ stdout: JSON.stringify({ transport: "webrtc", url: `/rtc/${String(b["ticket"])}` }) }),
    sessions: () => ({ stdout: JSON.stringify({ sessions: [{ site: "a.example.com", since: 1, lastSeen: 2 }] }) }),
    sign_out: (b) => ({ stdout: JSON.stringify({ ok: b["site"] === "a.example.com" }) }),
    take_over_fail: () => ({}),
    takeover: () => ({ exitCode: 3, stderr: "the desktop is not ready" }),
  });
  const host = createDockerComputerHost({ api: f.api });
  const shot = await host.screenshot("cmt_abc");
  assert.deepEqual([shot.width, shot.height, shot.bytes.length], [640, 400, 4]);
  assert.deepEqual(await host.stream({ computerId: "cmt_abc", ticket: "cpt_1" }), { transport: "webrtc", url: "/rtc/cpt_1" });
  assert.equal((await host.sessions("cmt_abc")).length, 1);
  assert.equal(await host.signOut({ computerId: "cmt_abc", site: "a.example.com" }), true);
  assert.equal(await host.signOut({ computerId: "cmt_abc", site: "b.example.com" }), false);
  await assert.rejects(() => host.takeover({ computerId: "cmt_abc", personId: "usr_dana" }), /agentd takeover failed \(3\): the desktop is not ready/);
  await host.giveBack("cmt_abc");
  assert.ok(ctlCalls(f.execs).includes("give_back {}"));
});

test("recordings: agentd records, the host writes the masked files beside the video, and a path outside work/recordings is refused", async () => {
  const f = fakeApi({
    record_stop: () => ({ stdout: JSON.stringify({ events: "{\"t\":1}\n", har: "{\"log\":{}}", durationMs: 1234 }) }),
  });
  const host = createDockerComputerHost({ api: f.api, user: { uid: 1000, gid: 1000 } });
  await host.record({ computerId: "cmt_abc", recordingId: "rcd_a1", action: "start" });
  assert.deepEqual(await host.record({ computerId: "cmt_abc", recordingId: "rcd_a1", action: "stop" }), { events: "{\"t\":1}\n", har: "{\"log\":{}}", durationMs: 1234 });
  await host.saveRecording({ computerId: "cmt_abc", recordingId: "rcd_a1", folderPath: "work/recordings/rcd_a1", events: "E", har: "H" });
  assert.deepEqual(f.execs.find((e) => e.cmd[0] === "mkdir")?.cmd, ["mkdir", "-p", `${FILES_GUEST}/work/recordings/rcd_a1`]);
  const a = f.archives[0]!;
  assert.equal(a.dir, `${FILES_GUEST}/work/recordings/rcd_a1`);
  const files = untar(a.tar).filter((x) => x.type === "file");
  assert.deepEqual(files.map((x) => [x.path, new TextDecoder().decode(x.data), x.uid]), [["events.jsonl", "E", 1000], ["network.har", "H", 1000]]);
  for (const bad of ["work/recordings/../../etc", "../escape", "work/recordings/rcd_a1/extra", "/abs"]) {
    await assert.rejects(() => host.saveRecording({ computerId: "cmt_abc", recordingId: "rcd_a1", folderPath: bad, events: "", har: "" }), /work\/recordings/);
    await assert.rejects(() => host.removeRecording({ computerId: "cmt_abc", recordingId: "rcd_a1", folderPath: bad }), /work\/recordings/);
  }
  await host.removeRecording({ computerId: "cmt_abc", recordingId: "rcd_a1", folderPath: "work/recordings/rcd_a1" });
  assert.deepEqual(f.execs.at(-1)?.cmd, ["rm", "-rf", `${FILES_GUEST}/work/recordings/rcd_a1`]);
});

test("health is the engine's answer", async () => {
  const host = createDockerComputerHost({ api: fakeApi().api });
  const h = await host.health();
  assert.equal(h.ok, true);
  assert.ok((h.latencyMs ?? -1) >= 0);
  const down = createDockerComputerHost({ api: { ...fakeApi().api, ping: async () => false } });
  assert.deepEqual([(await down.health()).ok, (await down.health()).detail], [false, "The container runtime did not answer."]);
});

test("the whole lifecycle through the handlers on the Docker host: provision, wake, take over, record, give back, sleep", async () => {
  const f = fakeApi({
    status: () => ({ stdout: JSON.stringify({ tabs: 2, busy: false }) }),
    record_stop: () => ({ stdout: JSON.stringify({ events: "", har: JSON.stringify({ log: { version: "1.2", entries: [] } }), durationMs: 60_000 }) }),
    sessions: () => ({ stdout: JSON.stringify({ sessions: [] }) }),
  });
  const h = harness();
  bindHost(createDockerComputerHost({ api: f.api, sleep: async () => {} }));
  const made = await provision(h.ctx, { agentId: INTAKE, idempotencyKey: "k" });
  const name = `vyre-comp-${made.computer.computerId.replace(/^cmt_/, "")}`;
  assert.equal(made.computer.state, "asleep");
  assert.equal(f.created.has(name), true);
  assert.equal((await wake(h.ctx, { computerId: made.computer.computerId })).computer.state, "working");
  assert.equal(f.running.has(name), true);
  const t = await takeOver(h.ctx, { computerId: made.computer.computerId });
  assert.equal(t.computer.state, "takeover");
  await recordStart(h.ctx, { computerId: made.computer.computerId });
  const stopped = await recordStop(h.ctx, { computerId: made.computer.computerId });
  assert.equal(stopped.recording.state, "saved");
  assert.equal(f.archives.length, 1);
  assert.equal((await giveBack(h.ctx, { computerId: made.computer.computerId })).computer.state, "working");
  assert.equal((await sleep(h.ctx, { computerId: made.computer.computerId })).computer.state, "asleep");
  assert.equal(f.running.has(name), false);
  assert.deepEqual(ctlCalls(f.execs).map((c) => c.split(" ")[0]), ["configure", "status", "takeover", "record_start", "record_stop", "give_back", "status", "status", "sessions"]);
});
