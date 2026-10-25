// @heavy docker
// Agent computer lifecycle on a real Docker host (spec 2.7, ARCH 6.6, 7.2): the handlers of the computers module over createDockerComputerHost, against the real Engine. A container is created
// from the person-sandbox image with a stand-in for agentd's control program (the real agentd is images/agent-computer, P-L2_17), woken, taken over, recorded, given back, put to sleep, woken again
// and removed. Every check looks at the real container, not at what the module believes: the Engine's own inspect output for what the container is not given, `docker exec` for what agentd was told,
// the files on the host's disk for what a recording saved.
//
// Runs only with VYRE_HEAVY_DOCKER=1 (the l2-heavy job in check.yml sets it). Without it every test here is skipped with its reason; a skip is never a pass of the real thing. With it on, nothing is
// skipped: a missing Docker daemon or image fails the run, so a green run means the proofs ran.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDockerApi, DEFAULT_IMAGE, unixSocketHttp } from "../../../sandbox/src/docker.ts";
import { tarFiles } from "../../../sandbox/src/tar.ts";
import { createDockerComputerHost, FILES_GUEST } from "../impl.ts";
import { bindHost } from "../projections.ts";
import { giveBack, provision, remove, sessionsList, sleep, takeOver, wake } from "../handlers/lifecycle.ts";
import { recordStart, recordStop, screenshot, stream } from "../handlers/record.ts";
import { harness, INTAKE } from "../fixtures/harness.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the 20 s shard never starts containers)";

const suffix = `${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const PREFIX = `vyre-comp-hv${suffix}-`;
// The stand-in lives in the bound folder: the computer's /tmp is mounted noexec, like the real one, so a program cannot run from it.
const CTL = `${FILES_GUEST}/.agentd-ctl`;
const STATE = "/tmp/agentd-state";
const http = unixSocketHttp();
const api = createDockerApi(http);
const filesRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-comp-heavy-")));

// The stand-in for agentd's control program: the same actions and answers as the protocol in impl.ts, with the state in files so the test can look at what it was told.
const CTL_SCRIPT = String.raw`#!/bin/sh
state=${STATE}
mkdir -p "$state"
case "$1" in
  status) printf '{"tabs":1,"busy":false,"lastFrameAt":1}';;
  configure) printf '{}';;
  takeover) printf '%s' "$2" > "$state/takeover"; printf '{}';;
  give_back) rm -f "$state/takeover"; printf '{}';;
  screenshot) printf '{"png":"iVBORw0KGgo=","width":800,"height":600}';;
  stream) printf '{"transport":"mjpeg","url":"/stream"}';;
  record_start) printf '%s' "$2" > "$state/recording"; printf '{}';;
  record_stop) rm -f "$state/recording"; printf '{"events":"{\\"t\\":1,\\"type\\":\\"key\\",\\"key\\":\\"x\\",\\"element\\":{\\"type\\":\\"password\\"}}\\n","har":"{\\"log\\":{\\"version\\":\\"1.2\\",\\"entries\\":[]}}","durationMs":1500}';;
  sessions) printf '{"sessions":[{"site":"app.example.com","since":1,"lastSeen":2}]}';;
  sign_out) printf '{"ok":true}';;
  *) echo "unknown action $1" >&2; exit 2;;
esac
`;

const host = createDockerComputerHost({
  api, http, image: DEFAULT_IMAGE, cmd: ["sleep", "infinity"], prefix: PREFIX, ctl: CTL, filesRoot: () => filesRoot, startTimeoutMs: 40_000, user: { uid: 10001, gid: 10001 },
});

const nameOf = (computerId: string): string => `${PREFIX}${computerId.replace(/^cmt_/, "")}`;
async function inspect(name: string): Promise<{ status: number; json: any }> {
  const r = await http({ method: "GET", path: `/containers/${name}/json` });
  let json: any = null;
  try { json = JSON.parse(new TextDecoder().decode(r.body)); } catch { json = null; }
  return { status: r.status, json };
}
const run = (name: string, cmd: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> => api.exec(name, { cmd, env: [] });

/** Put the stand-in control program into a running container, as the image will have it. */
async function installCtl(name: string): Promise<void> {
  await api.putArchive(name, FILES_GUEST, tarFiles([{ path: ".agentd-ctl", data: new TextEncoder().encode(CTL_SCRIPT), mode: 0o755, uid: 10001, gid: 10001, mtime: Math.floor(Date.now() / 1000) }]));
}

/** Wake a computer whose container does not have its control program yet: the host waits for agentd, and the program is put in as soon as the container runs. */
async function wakeWithCtl(h: ReturnType<typeof harness>, computerId: string) {
  const name = nameOf(computerId);
  const waking = wake(h.ctx, { computerId });
  for (let i = 0; i < 200 && !(await api.containerRunning(name)); i++) await new Promise((r) => setTimeout(r, 100));
  await installCtl(name);
  return waking;
}

before(async () => {
  if (!ON) return;
  assert.equal(await api.ping(), true, "the Docker daemon answers");
  assert.equal(await api.imageExists(DEFAULT_IMAGE), true, `the image ${DEFAULT_IMAGE} is on this runner`);
  fs.chmodSync(filesRoot, 0o777);
});

after(async () => {
  bindHost(null);
  if (!ON) return;
  const list = await http({ method: "GET", path: "/containers/json", query: { all: "true", filters: JSON.stringify({ name: [PREFIX] }) } });
  for (const c of JSON.parse(new TextDecoder().decode(list.body)) as Array<{ Id: string }>) await api.containerRemove(c.Id);
  const vols = await http({ method: "GET", path: "/volumes", query: { filters: JSON.stringify({ name: [PREFIX] }) } });
  for (const v of (JSON.parse(new TextDecoder().decode(vols.body)) as { Volumes?: Array<{ Name: string }> }).Volumes ?? []) await http({ method: "DELETE", path: `/volumes/${v.Name}`, query: { force: "true" } });
  fs.rmSync(filesRoot, { recursive: true, force: true });
});

test("@heavy computers: provision, wake, take over, record, give back, sleep, wake and remove on a real Docker host", { skip, timeout: 300_000 }, async () => {
  const h = harness();
  bindHost(host);

  // provision: a container exists, stopped, inside its profile
  const made = await provision(h.ctx, { agentId: INTAKE, idempotencyKey: "heavy" });
  const id = made.computer.computerId;
  const name = nameOf(id);
  assert.equal(made.computer.state, "asleep");
  const created = await inspect(name);
  assert.equal(created.status, 200);
  assert.equal(created.json.State.Running, false, "asleep means no running container");
  const hc = created.json.HostConfig;
  assert.equal(hc.Privileged, false);
  assert.deepEqual(hc.CapDrop, ["ALL"]);
  assert.ok((hc.SecurityOpt as string[]).includes("no-new-privileges:true"));
  assert.equal(hc.NetworkMode, "bridge");
  assert.ok(hc.Memory > 0 && hc.PidsLimit > 0);
  assert.ok(!(hc.Binds as string[]).some((b) => b.includes("docker.sock")));
  assert.equal(hc.IpcMode, "private");
  assert.ok(!hc.PidMode, "no host pid namespace");
  assert.equal((hc.Devices ?? []).length, 0);

  // wake: the container runs and agentd answers
  const woke = await wakeWithCtl(h, id);
  assert.equal(woke.computer.state, "working");
  assert.equal((await inspect(name)).json.State.Running, true);
  assert.equal((await run(name, [CTL, "status", "{}"])).stdout.includes('"tabs":1'), true);
  assert.equal(woke.computer.tabs, 1);

  // the screen and the live view
  const shot = await screenshot(h.ctx, { computerId: id });
  assert.deepEqual([shot.width, shot.height], [800, 600]);
  const live = await stream(h.ctx, { computerId: id });
  assert.equal(live.transport, "mjpeg");

  // take over: agentd was told who, and the state says so
  const taken = await takeOver(h.ctx, { computerId: id });
  assert.equal(taken.computer.state, "takeover");
  assert.equal((await run(name, ["cat", `${STATE}/takeover`])).stdout, "usr_dana", "agentd was told whose hands are on the desktop");

  // record: files appear on the host's disk, masked
  const rec = await recordStart(h.ctx, { computerId: id });
  assert.equal((await run(name, ["cat", `${STATE}/recording`])).stdout, rec.recordingId);
  const done = await recordStop(h.ctx, { computerId: id });
  assert.equal(done.recording.durationMs, 1500);
  const dir = path.join(filesRoot, done.recording.folderPath);
  const events = fs.readFileSync(path.join(dir, "events.jsonl"), "utf8");
  assert.match(events, /"key":"\[masked\]"/, "a key typed into a password field is not on disk");
  assert.ok(!/"key":"x"/.test(events));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "network.har"), "utf8")).log.version, "1.2");
  assert.ok((await run(name, ["ls", `${FILES_GUEST}/${done.recording.folderPath}`])).stdout.includes("events.jsonl"), "the files are where the agent sees them, in its own folder");

  // give back
  const back = await giveBack(h.ctx, { computerId: id });
  assert.equal(back.computer.state, "working");
  assert.notEqual((await run(name, ["test", "-e", `${STATE}/takeover`])).exitCode, 0, "the takeover is over inside the container");

  // sleep: the container stops, the sessions it had are kept
  const slept = await sleep(h.ctx, { computerId: id });
  assert.equal(slept.computer.state, "asleep");
  assert.equal((await inspect(name)).json.State.Running, false);
  assert.deepEqual((await sessionsList(h.ctx, { computerId: id })).sessions.map((s) => s.site), ["app.example.com"]);

  // wake again: the same container comes back
  const again = await wakeWithCtl(h, id);
  assert.equal(again.computer.state, "working");
  assert.equal((await inspect(name)).json.State.Running, true);

  // remove: the container and its volume are gone
  assert.deepEqual(await remove(h.ctx, { computerId: id }), { removed: true });
  assert.equal((await inspect(name)).status, 404);
  const vol = await http({ method: "GET", path: `/volumes/${name}-profile` });
  assert.equal(vol.status, 404);
});
