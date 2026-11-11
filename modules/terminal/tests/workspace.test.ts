// The agent workspace (6 Nov): made on first use without a grant, kept within its container profile, mounted with the agent's folders and its projects' shared ones, asleep after idle minutes and awake
// again on the next command, and the terminal in it: an agent's commands and a person's attached tab are the same tmux sessions. The Docker engine is a stand-in (fixtures/fake-docker.ts) behind the
// real DockerApi; tmux in a container is the stand-in tmux, lost when the container stops.
import test from "node:test";
import assert from "node:assert/strict";
import { createDockerApi } from "../../../sandbox/src/docker.ts";
import { createWorkspaceManager, createWorkspaceTerminalHost, encodeControlOutput, incompleteTail, projectInitBody, reviewWorkspaceConfig, workspaceContainerConfig, workspaceName, PROJECT_INIT_SCRIPT, IMAGE_MISSING_LINE } from "../workspace.ts";
import type { WorkspaceOptions } from "../workspace.ts";
import { createTmuxHost, decodeControlOutput, frameOf } from "../impl.ts";
import { fakeDocker } from "../fixtures/fake-docker.ts";
import type { FakeDockerOptions } from "../fixtures/fake-docker.ts";

const AGENT = "agt_dex";
const NAME = workspaceName(AGENT);

function rig(o: { docker?: FakeDockerOptions; projects?: () => string[]; idleMs?: number; admit?: WorkspaceOptions["admit"]; runner?: boolean; home?: WorkspaceOptions["home"]; image?: string } = {}) {
  const dk = fakeDocker({ tmux: { scripts: { "echo hi": { out: "hi", code: 0 } } }, ...o.docker });
  const clock = { t: 1_000_000 };
  const mgr = createWorkspaceManager({
    api: createDockerApi(dk.http), http: dk.http, now: () => clock.t, sleep: async (ms) => { clock.t += ms; },
    idleMs: o.idleMs ?? 600_000,
    ...(o.projects ? { projectsOf: o.projects } : {}), ...(o.admit ? { admit: o.admit } : {}), ...(o.runner ? { runner: true } : {}), ...(o.home ? { home: o.home } : {}), ...(o.image ? { image: o.image } : {}),
  });
  return { dk, mgr, clock };
}
const termHost = (r: ReturnType<typeof rig>) => createWorkspaceTerminalHost({ manager: r.mgr, streamMs: 10, sleep: async () => { await new Promise((x) => setTimeout(x, 2)); } });
const target = (agentId = AGENT) => ({ host: "agent_computer" as const, agentId });
const open = (h: ReturnType<typeof termHost>, id = "trm_1") => h.open({ terminalId: id, target: target(), name: "agent", cols: 100, rows: 30, folders: [] });

test("the container profile: non-root, no capability, no new privileges, no Docker socket, no device, limits, only its own volumes, never a host folder", () => {
  const good = workspaceContainerConfig(AGENT, "vyre/agent-workspace:1", { projects: ["prj_a"] }, {});
  assert.deepEqual(reviewWorkspaceConfig(good, AGENT), []);
  assert.equal(good.User, "10001:10001");
  assert.deepEqual(good.HostConfig.CapDrop, ["ALL"]);
  assert.equal(good.HostConfig.Privileged, false);
  assert.ok(good.HostConfig.SecurityOpt.includes("no-new-privileges:true"));
  assert.deepEqual(good.HostConfig.Binds, [`${NAME}-home:/home/agent:rw`, `${NAME}-files:/home/agent/Vyre:rw`, "vyre-wsproj-prj_a:/home/agent/projects/prj_a:rw"]);
  assert.equal(good.HostConfig.Memory, 1024 * 1024 * 1024);
  assert.equal(good.HostConfig.NanoCpus, 1e9);

  const wrong = (edit: (c: typeof good) => void): string => { const c = structuredClone(good); edit(c); return reviewWorkspaceConfig(c, AGENT).join("; "); };
  assert.match(wrong((c) => { c.HostConfig.Binds.push("/var/run/docker.sock:/var/run/docker.sock:rw"); }), /docker socket/);
  assert.match(wrong((c) => { c.HostConfig.Binds.push("/etc:/home/agent/projects/etc:rw"); }), /system folder|host folder is bound/);
  assert.match(wrong((c) => { c.HostConfig.Binds.push("/srv/other:/home/agent/projects/x:rw"); }), /host folder is bound/);
  assert.match(wrong((c) => { c.HostConfig.Binds.push("/srv/files/agt_dex:/home/agent/Vyre:rw"); }), /host folder is bound/);
  assert.match(wrong((c) => { c.HostConfig.Binds.push("someone-elses-home:/home/agent/projects/y:rw"); }), /is not this workspace's/);
  assert.match(wrong((c) => { c.User = ""; }), /runs as/);
  assert.match(wrong((c) => { c.User = "0:0"; }), /runs as 0:0/);
  assert.match(wrong((c) => { c.HostConfig.Privileged = true; }), /privileged/);
  assert.match(wrong((c) => { c.HostConfig.CapAdd = ["SYS_ADMIN"]; }), /capabilities added/);
  assert.match(wrong((c) => { c.HostConfig.CapDrop = []; }), /not all dropped/);
  assert.match(wrong((c) => { c.HostConfig.SecurityOpt = []; }), /new privileges/);
  assert.match(wrong((c) => { c.HostConfig.NetworkMode = "host"; }), /host or shared network/);
  assert.match(wrong((c) => { c.HostConfig.PidMode = "host"; }), /pid/);
  assert.match(wrong((c) => { c.HostConfig.Devices = [{}]; }), /devices/);
  assert.match(wrong((c) => { c.HostConfig.Memory = 0; }), /limit/);
  assert.match(wrong((c) => { c.Labels["vyre.workspace"] = "agt_other"; }), /not this agent's workspace/);
});

test("the first use makes the workspace and starts it, with no grant; two first uses at once make it once", async () => {
  const r = rig();
  assert.equal(r.dk.boxes.size, 0, "nothing exists before the first use");
  const [a, b] = await Promise.all([r.mgr.exec(AGENT, ["tmux", "-V"]), r.mgr.exec(AGENT, ["tmux", "-V"])]);
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  assert.equal(r.dk.ops("create").length, 1, "made once");
  assert.equal(r.dk.ops("start").length, 1, "started once");
  const cfg = r.dk.box(NAME).config;
  assert.equal(cfg["Labels"]["vyre.workspace"], AGENT);
  assert.equal(cfg["User"], "10001:10001");
  assert.equal(cfg["HostConfig"]["NetworkMode"], "bridge", "a Space with a Docker socket of its own uses the default network");
  assert.equal(await r.mgr.ensure(AGENT), "running");
  assert.deepEqual((await r.mgr.list()).map((x) => [x.agentId, x.state]), [[AGENT, "running"]]);
});

test("an id that is not an agent's is refused before anything is made", async () => {
  const r = rig();
  await assert.rejects(() => r.mgr.ensure("../etc"), /not an agent/);
  assert.equal(r.dk.boxes.size, 0);
});

test("behind the runner each workspace is on a network of its own, and only named volumes are bound", async () => {
  const r = rig({ runner: true });
  await r.mgr.ensure(AGENT);
  assert.equal(r.dk.ops("network").length, 1);
  const net = r.dk.ops("network")[0]!.name!;
  assert.match(net, /^vyre-wsnet-[0-9a-f]{16}$/);
  assert.equal(r.dk.box(NAME).config["HostConfig"]["NetworkMode"], net);
  assert.ok(r.dk.box(NAME).config["HostConfig"]["Binds"].every((b: string) => !b.startsWith("/")), "named volumes only");
});

test("the room check runs before a workspace is made or woken, and a refusal makes nothing", async () => {
  const seen: string[] = [];
  const r = rig({ admit: ({ state }) => { seen.push(state); if (seen.length === 1) throw new Error("Waiting for room on the Space server"); } });
  await assert.rejects(() => r.mgr.ensure(AGENT), /Waiting for room/);
  assert.equal(r.dk.boxes.size, 0);
  await r.mgr.ensure(AGENT);
  assert.deepEqual(seen, ["create", "create"]);
});

test("no image on the server and none to fetch: the line says so and nothing is made", async () => {
  const REL = "ghcr.io/vyre-ai/agent-workspace:1.0.0";
  const r = rig({ docker: { image: false }, image: REL });
  await assert.rejects(() => r.mgr.ensure(AGENT), (e: Error) => e.message.startsWith(IMAGE_MISSING_LINE) && e.message.includes(`docker pull ${REL}`));
  assert.equal(r.dk.boxes.size, 0);
  const fetched = rig({ docker: { image: false, pullWorks: true }, image: REL });
  assert.equal(await fetched.mgr.ensure(AGENT), "created", "a server that can fetch the image does");
});

test("a local image name (vyre/...) is never asked of a registry: Docker would look on Docker Hub, which is not Vyre's", async () => {
  // the registry would even answer here (pullWorks): the manager must not ask
  for (const image of [undefined, "vyre/agent-workspace:1", "docker.io/vyre/agent-workspace:1", `vyre/agent-workspace@sha256:${"a".repeat(64)}`]) {
    const r = rig({ docker: { image: false, pullWorks: true }, ...(image ? { image } : {}) });
    await assert.rejects(() => r.mgr.ensure(AGENT), (e: Error) => e.message.startsWith(IMAGE_MISSING_LINE) && /never fetched/.test(e.message) && !/docker pull/.test(e.message), String(image));
    assert.equal(r.dk.log.filter((l) => l.op === "pull").length, 0, `no fetch was tried for ${String(image)}`);
    assert.equal(r.dk.boxes.size, 0);
  }
});

test("a workspace sleeps after idle minutes with its volumes kept, and wakes on the next use", async () => {
  const r = rig({ idleMs: 600_000 });
  await r.mgr.exec(AGENT, ["tmux", "-V"]);
  const g0 = r.mgr.generation(AGENT);
  r.clock.t += 599_000;
  assert.deepEqual(await r.mgr.sweep(), [], "not idle yet");
  r.clock.t += 2_000;
  assert.deepEqual(await r.mgr.sweep(), [AGENT]);
  assert.equal(r.dk.box(NAME).running, false);
  assert.deepEqual((await r.mgr.list()).map((x) => x.state), ["asleep"]);
  assert.equal(r.dk.ops("remove").length, 0, "the container and the volumes stay");
  const res = await r.mgr.exec(AGENT, ["tmux", "-V"]);
  assert.equal(res.code, 0);
  assert.equal(r.dk.box(NAME).running, true);
  assert.equal(r.dk.ops("create").length, 1, "woken, not made again");
  assert.equal(r.mgr.generation(AGENT), g0 + 1, "a wake is counted: tmux was lost with the container");
});

test("a use resets the idle clock, and a pane running something other than a shell is work: it never sleeps mid-task", async () => {
  let busy = false;
  const r = rig({ idleMs: 600_000, docker: { panes: () => (busy ? "bash\nnode" : "bash") } });
  await r.mgr.exec(AGENT, ["tmux", "-V"]);
  r.clock.t += 500_000;
  await r.mgr.exec(AGENT, ["tmux", "-V"]);
  r.clock.t += 500_000;
  assert.deepEqual(await r.mgr.sweep(), [], "used 500 s ago");
  busy = true;
  r.clock.t += 200_000;
  assert.deepEqual(await r.mgr.sweep(), [], "idle for the time but a build is running");
  assert.equal(r.dk.box(NAME).running, true);
  busy = false;
  r.clock.t += 700_000;
  assert.deepEqual(await r.mgr.sweep(), [AGENT], "asleep once the pane is a shell again");
});

test("a workspace that was running before this process started gets a whole idle period, then sleeps", async () => {
  const r = rig({ idleMs: 600_000 });
  await r.mgr.exec(AGENT, ["tmux", "-V"]);
  const fresh = createWorkspaceManager({ api: createDockerApi(r.dk.http), http: r.dk.http, now: () => r.clock.t, idleMs: 600_000 });
  assert.deepEqual(await fresh.sweep(), []);
  r.clock.t += 601_000;
  assert.deepEqual(await fresh.sweep(), [AGENT]);
});

test("a project the agent is on gets one shared volume, made once and handed to the agent user by a one-off helper; a new project recreates the container and keeps the rest", async () => {
  let projects = ["prj_site"];
  const r = rig({ projects: () => projects });
  await r.mgr.ensure(AGENT);
  assert.deepEqual(r.dk.ops("volume").map((x) => x.name), ["vyre-wsproj-prj_site"]);
  const helper = r.dk.ops("create").find((x) => x.name === "vyre-wsinit-prj_site");
  assert.ok(helper, "the helper ran");
  assert.deepEqual(helper!.detail, projectInitBody("prj_site", "vyre/agent-workspace:1"));
  assert.equal(PROJECT_INIT_SCRIPT, "chown 10001:10001 /vol");
  assert.equal(r.dk.boxes.has("vyre-wsinit-prj_site"), false, "the helper is removed");
  assert.ok(r.dk.box(NAME).config["HostConfig"]["Binds"].includes("vyre-wsproj-prj_site:/home/agent/projects/prj_site:rw"));

  await r.mgr.ensure(AGENT);
  assert.equal(r.dk.ops("create").filter((x) => x.name === NAME).length, 1, "nothing changed: nothing made again");

  projects = ["prj_site", "prj_book"];
  const g = r.mgr.generation(AGENT);
  assert.equal(await r.mgr.ensure(AGENT), "created", "made again with the new mount");
  assert.equal(r.dk.ops("create").filter((x) => x.name === NAME).length, 2);
  assert.equal(r.dk.ops("volume_remove").length, 0, "no volume was removed: what the agent kept stays");
  assert.deepEqual(r.dk.ops("volume").map((x) => x.name), ["vyre-wsproj-prj_site", "vyre-wsproj-prj_book"], "the first project's volume was not made again");
  assert.ok(r.dk.box(NAME).config["HostConfig"]["Binds"].includes("vyre-wsproj-prj_book:/home/agent/projects/prj_book:rw"));
  assert.ok(r.mgr.generation(AGENT) > g);

  // two agents on the same project mount the same volume
  const other = "agt_pam";
  const r2 = createWorkspaceManager({ api: createDockerApi(r.dk.http), http: r.dk.http, now: () => r.clock.t, projectsOf: () => ["prj_site"] });
  await r2.ensure(other);
  assert.ok(r.dk.box(workspaceName(other)).config["HostConfig"]["Binds"].includes("vyre-wsproj-prj_site:/home/agent/projects/prj_site:rw"));
  assert.equal(r.dk.ops("volume").filter((x) => x.name === "vyre-wsproj-prj_site").length, 1, "shared, not copied");
});

test("a project folder that could not be set up stops the workspace from starting", async () => {
  const r = rig({ projects: () => ["prj_site"] });
  r.dk.helperFails();
  await assert.rejects(() => r.mgr.ensure(AGENT), /project folder could not be set up/);
  assert.equal(r.dk.boxes.has(NAME), false);
  assert.equal(r.dk.boxes.has("vyre-wsinit-prj_site"), false, "the helper is cleaned up");
});

test("an exec on a container that stopped under us wakes it once more", async () => {
  const r = rig();
  await r.mgr.exec(AGENT, ["tmux", "-V"]);
  r.dk.kill(NAME);
  const res = await r.mgr.exec(AGENT, ["tmux", "-V"]);
  assert.equal(res.code, 0);
  assert.equal(r.dk.box(NAME).running, true);
});

// ---- the terminal ----------------------------------------------------------------------------------------------------------------------------------------

test("terminal_run in a workspace: the workspace is made, the command runs in tmux in it and its output comes back", async () => {
  const r = rig();
  const h = termHost(r);
  const o = await open(h);
  assert.equal(o.title, "Workspace");
  assert.equal(r.dk.ops("create").length, 1, "made by the first terminal use");
  const res = await h.run("trm_1", { command: "echo hi", env: {}, timeoutMs: 5000 });
  assert.deepEqual([res.exitCode, res.output], [0, "hi"]);
  assert.ok(r.dk.box(NAME).tmux.sessions.has("vyre-trm_1"), "a tmux session in the container");
});

test("a person's attached tab sees the agent's session: the same tmux session, the same screen, typing goes to it", async () => {
  const r = rig();
  const agent = termHost(r);
  await open(agent);
  await agent.run("trm_1", { command: "echo hi", env: {}, timeoutMs: 5000 });
  // the person's tab goes through a host of its own (another request, a restart of the daemon): it still finds the session
  const person = termHost(r);
  assert.equal(await person.has("trm_1"), true);
  const screen = await person.read("trm_1", { lines: 50 });
  assert.match(screen.text, /echo hi/);
  assert.match(screen.text, /^hi$/m, "the agent's output is on the person's screen");
  await person.input("trm_1", "ls\n");
  assert.ok(r.dk.box(NAME).tmux.calls.some((c) => c[1] === "send-keys" && c.includes("-t") && c.includes("vyre-trm_1") && c[c.length - 1] === "ls\n"), "the keystrokes reach the agent's own session");
  assert.equal((await person.status(["trm_1"]))[0]!.state, "idle");
  assert.equal(await createWorkspaceTerminalHost({ manager: r.mgr }).has("trm_nope"), false);
});

test("a session whose tmux died with the sleep is made again, empty, where it was; the agent's next command just works", async () => {
  const r = rig({ idleMs: 600_000 });
  const h = termHost(r);
  await h.open({ terminalId: "trm_1", target: target(), name: "agent", cols: 90, rows: 25, cwd: "/home/agent/projects/p", folders: [] });
  await h.run("trm_1", { command: "echo hi", env: {}, timeoutMs: 5000 });
  r.clock.t += 700_000;
  await r.mgr.sweep();
  assert.equal(r.dk.box(NAME).running, false);
  assert.equal((await h.status(["trm_1"]))[0]!.state, "idle", "asleep: its sessions read as idle, and a status read does not wake it");
  assert.equal(r.dk.box(NAME).running, false);
  const res = await h.run("trm_1", { command: "echo hi", env: {}, timeoutMs: 5000 });
  assert.equal(res.exitCode, 0);
  const again = r.dk.ops("exec").map((x) => x.detail as string[]).find((c) => c[1] === "new-session" && c.includes("-A"));
  assert.ok(again, "new-session -A -d");
  assert.ok(r.dk.box(NAME).tmux.sessions.has("vyre-trm_1"), "the session is there again");
  assert.deepEqual(again!.slice(again!.indexOf("-x")), ["-x", "90", "-y", "25", "-c", "/home/agent/projects/p"], "at the size and folder it had");
});

test("an agent with no workspace yet is not given another agent's: a session opens in the agent it names", async () => {
  const r = rig();
  const h = termHost(r);
  await assert.rejects(() => h.open({ terminalId: "trm_x", target: { host: "agent_computer" }, name: "x", cols: 80, rows: 24, folders: [] }), /Say which agent/);
  assert.equal(r.dk.boxes.size, 0);
});

test("closing a session kills its tmux session in the workspace and leaves the workspace", async () => {
  const r = rig();
  const h = termHost(r);
  await open(h);
  await h.close("trm_1");
  assert.equal(r.dk.box(NAME).tmux.sessions.has("vyre-trm_1"), false);
  assert.equal(r.dk.box(NAME).running, true);
});

test("live frames: tmux pipe-pane into a file, read back from an offset, handed to the tab as control-mode lines; one reader however many tabs; the file and the pipe are cleaned up at the end", async () => {
  const chunks: string[] = [];
  let file = Buffer.alloc(0);
  const r = rig({
    docker: {
      onExec: (_box, argv) => {
        const script = argv[2] ?? "";
        if (argv[0] === "sh" && script.includes("pipe-pane") && script.includes('cat >> $2')) { file = Buffer.alloc(0); chunks.push("pipe on"); return { code: 0, stdout: "", stderr: "" }; }
        if (argv[0] === "sh" && script.startsWith("tail -c +")) { const from = Number(argv[4]) - 1; return { code: 0, stdout: file.subarray(from, from + 49152).toString("base64"), stderr: "" }; }
        if (argv[0] === "sh" && script.includes("rm -f")) { chunks.push("pipe off"); return { code: 0, stdout: "", stderr: "" }; }
        return undefined;
      },
    },
  });
  const h = termHost(r);
  await open(h);
  const seenA: string[] = [];
  const seenB: string[] = [];
  const stopA = h.stream!("trm_1", (t) => seenA.push(t));
  const stopB = h.stream!("trm_1", (t) => seenB.push(t));
  const until = async (f: () => boolean): Promise<void> => { for (let i = 0; i < 400 && !f(); i++) await new Promise((x) => setTimeout(x, 5)); assert.ok(f(), "timed out"); };
  await until(() => chunks.includes("pipe on"));
  file = Buffer.concat([file, Buffer.from("héllo\r\n")]);
  await until(() => seenA.join("").includes("llo") && seenB.join("").includes("llo"));
  assert.equal(seenA.join(""), "héllo\r\n");
  assert.equal(chunks.filter((c) => c === "pipe on").length, 1, "one reader for two tabs");
  stopA();
  assert.ok(!chunks.includes("pipe off"), "one tab still watching");
  stopB();
  await until(() => chunks.includes("pipe off"));
});

test("control-mode encoding is the inverse of the decoder, and a character cut in two waits for its other half", () => {
  const bytes = new TextEncoder().encode("a\\b\r\n\x1b[0m é 🙂");
  assert.equal(decodeControlOutput(encodeControlOutput(bytes)), "a\\b\r\n\x1b[0m é 🙂");
  assert.equal(frameOf(`%output %0 ${encodeControlOutput(new TextEncoder().encode("ok\n"))}`), "ok\n");
  const e = new TextEncoder().encode("é");
  assert.equal(incompleteTail(e.subarray(0, 1)), 1);
  assert.equal(incompleteTail(e), 0);
  const smile = new TextEncoder().encode("a🙂");
  assert.equal(incompleteTail(smile.subarray(0, 3)), 2);
  assert.equal(incompleteTail(smile.subarray(0, 4)), 3);
  assert.equal(incompleteTail(smile), 0);
  assert.equal(incompleteTail(new TextEncoder().encode("plain")), 0);
});

test("createTmuxHost is what runs in the container: the same command lines as on any machine, with tmux run through docker exec", async () => {
  const r = rig();
  await r.mgr.ensure(AGENT);
  const host = createTmuxHost({ exec: (argv) => r.mgr.exec(AGENT, argv) });
  await host.open({ terminalId: "trm_9", target: target(), name: "x", cols: 100, rows: 30, folders: [] });
  assert.deepEqual(r.dk.box(NAME).tmux.calls[0], ["tmux", "new-session", "-d", "-s", "vyre-trm_9", "-x", "100", "-y", "30"]);
});

// ---- the Files folder ------------------------------------------------------------------------------------------------------------------------------------

function fakeHome(r: () => ReturnType<typeof rig>, o: { fail?: boolean } = {}) {
  const passes: Array<{ running: boolean; stopsSoFar: number }> = [];
  const seen: { fs?: import("../workspace.ts").HomeDisk; manifest?: string; computerId?: string; agentId?: string } = {};
  const home: NonNullable<WorkspaceOptions["home"]> = {
    sync: (x) => { seen.fs = x.fs; seen.manifest = x.manifest; seen.computerId = x.computerId; seen.agentId = x.agentId; return { async pass() { if (o.fail) throw new Error("Files did not answer"); passes.push({ running: r().dk.boxes.get(NAME)?.running === true, stopsSoFar: r().dk.ops("stop").length }); return { failed: 0 }; } }; },
    readTar: () => ({ files: new Map([["notes.md", { bytes: Buffer.from("hello"), mtimeMs: 1 }]]), dirs: new Set(["work"]), refused: [], complete: true }),
    manifest: (id) => `/data/workspaces/${id}/home-manifest.json`,
    intervalMs: 5,
  };
  return { home, passes, seen };
}
const later = (ms: number): Promise<void> => new Promise((x) => setTimeout(x, ms));

test("the Files folder is mirrored: once the workspace is up and before the first command, every few seconds while it is awake, and a last time before it stops", async () => {
  let rg: ReturnType<typeof rig>;
  const fh = fakeHome(() => rg);
  rg = rig({ home: fh.home });
  await rg.mgr.ensure(AGENT);
  assert.equal(fh.passes.length >= 1, true, "a pass before ensure returned");
  assert.equal(fh.passes[0]!.running, true, "after the container started: removals are an exec");
  assert.deepEqual([fh.seen.agentId, fh.seen.computerId, fh.seen.manifest], [AGENT, `ws_${AGENT}`, `/data/workspaces/${AGENT}/home-manifest.json`]);
  const n0 = fh.passes.length;
  await later(60);
  assert.ok(fh.passes.length > n0, "passes keep running while it is awake");
  assert.equal(await rg.mgr.sleep(AGENT), true);
  const last = fh.passes.at(-1)!;
  assert.deepEqual([last.running, last.stopsSoFar], [true, 0], "the last pass ran with the container still up, before it was stopped");
  const n1 = fh.passes.length;
  await later(40);
  assert.equal(fh.passes.length, n1, "no pass after it sleeps");
  await rg.mgr.exec(AGENT, ["tmux", "-V"]);
  const n2 = fh.passes.length;
  assert.ok(n2 > n1, "a wake mirrors again before the command");
  rg.mgr.close();
  await later(30);
  const n3 = fh.passes.length;
  await later(30);
  assert.equal(fh.passes.length, n3, "closing the manager stops the passes");
});

test("a mirror that fails does not stop the workspace from starting, sleeping or waking", async () => {
  let rg: ReturnType<typeof rig>;
  const fh = fakeHome(() => rg, { fail: true });
  rg = rig({ home: fh.home });
  assert.equal(await rg.mgr.ensure(AGENT), "created");
  assert.equal(await rg.mgr.sleep(AGENT), true);
  assert.equal(await rg.mgr.ensure(AGENT), "woke");
  rg.mgr.close();
});

test("the disk side of the mirror is the container's own view: the archive of ~/Vyre to read and write, an exec as the agent's user to remove", async () => {
  let rg: ReturnType<typeof rig>;
  const fh = fakeHome(() => rg);
  rg = rig({ home: fh.home, docker: { onExec: (_b, argv) => (argv[0] === "sh" && (argv[2] ?? "").includes("rm -f --") ? { code: 0, stdout: "", stderr: "" } : undefined) } });
  await rg.mgr.ensure(AGENT);
  const snap = await fh.seen.fs!.snapshot();
  assert.deepEqual([...snap.files.keys()], ["notes.md"]);
  assert.deepEqual(rg.dk.ops("archive_get").at(-1)!.detail, { path: "/home/agent/Vyre/.", bytes: 0 });
  await fh.seen.fs!.put([{ rel: "AGENT.md", bytes: new TextEncoder().encode("role"), readOnly: true }, { rel: "work/a.txt", bytes: new TextEncoder().encode("a"), readOnly: false }]);
  const put = rg.dk.ops("archive_put").at(-1)!.detail as { path: string; bytes: number };
  assert.equal(put.path, "/home/agent/Vyre");
  assert.ok(put.bytes > 512 * 2, "a tar of both files");
  await fh.seen.fs!.put([]);
  assert.equal(rg.dk.ops("archive_put").length, 1, "nothing to write, nothing sent");
  await fh.seen.fs!.remove(["old.txt", "work/b.txt"], ["gone"]);
  const rm = rg.dk.ops("exec").map((x) => x.detail as string[]).find((c) => c[0] === "sh" && c[2]?.includes("rm -f --"));
  assert.ok(rm, "an exec removed them");
  assert.deepEqual(rm!.slice(3), ["sh", "/home/agent/Vyre/old.txt", "/home/agent/Vyre/work/b.txt", "::", "/home/agent/Vyre/gone"]);
  await fh.seen.fs!.remove([], []);
  rg.mgr.close();
});

test("with no mirror configured ~/Vyre is an ordinary folder: nothing runs and nothing is asked of Files", async () => {
  const r = rig();
  await r.mgr.ensure(AGENT);
  assert.equal(await r.mgr.sleep(AGENT), true);
  assert.equal(r.dk.ops("archive_get").length + r.dk.ops("archive_put").length, 0);
});

// ---- room on the host ---------------------------------------------------------------------------------------------------------------------------------

function fakeRoom(o: { full?: () => boolean } = {}) {
  const log: string[] = [];
  const capacity: NonNullable<WorkspaceOptions["capacity"]> = {
    async claim(id) { log.push(`claim ${id}`); return o.full?.() ? { state: "waiting", line: "Waiting for room on the Space server. Add a compute server in Console > Computers to run more." } : { state: "running" }; },
    async release(id) { log.push(`release ${id}`); },
  };
  return { capacity, log };
}
const rigWith = (extra: Partial<WorkspaceOptions>, docker?: FakeDockerOptions) => {
  const dk = fakeDocker({ tmux: { scripts: { "echo hi": { out: "hi", code: 0 } } }, ...docker });
  const clock = { t: 1_000_000 };
  const mgr = createWorkspaceManager({ api: createDockerApi(dk.http), http: dk.http, now: () => clock.t, sleep: async (ms) => { clock.t += ms; }, idleMs: 600_000, ...extra });
  return { dk, mgr, clock };
};

test("a workspace asks for room before it is made, tells the host when it sleeps or goes, and keeps nothing it did not get", async () => {
  const room = fakeRoom();
  const r = rigWith({ capacity: room.capacity });
  await r.mgr.ensure(AGENT);
  assert.deepEqual(room.log, [`claim ${AGENT}`]);
  await r.mgr.ensure(AGENT);
  assert.deepEqual(room.log, [`claim ${AGENT}`], "a running workspace is not asked again");
  assert.equal(await r.mgr.sleep(AGENT), true);
  assert.deepEqual(room.log, [`claim ${AGENT}`, `release ${AGENT}`], "the room goes back when it stops");
  await r.mgr.ensure(AGENT);
  assert.deepEqual(room.log.slice(-1), [`claim ${AGENT}`], "a wake asks again");
  await r.mgr.remove(AGENT);
  assert.equal(room.log.at(-1), `release ${AGENT}`);
});

test("a full host queues the workspace with the plain line: nothing is made or started, and the next try after room opens works", async () => {
  let full = true;
  const room = fakeRoom({ full: () => full });
  const r = rigWith({ capacity: room.capacity });
  await assert.rejects(() => r.mgr.ensure(AGENT), (e: Error) => e.message.startsWith("Waiting for room on the Space server.") && (e as { workspace?: boolean }).workspace === true && (e as { code?: string }).code === "waiting");
  assert.equal(r.dk.boxes.size, 0);
  full = false;
  assert.equal(await r.mgr.ensure(AGENT), "created", "the starter the host runs when room opens");
});

test("a workspace that fails to start gives its room back", async () => {
  const room = fakeRoom();
  const r = rigWith({ capacity: room.capacity }, { image: false });
  await assert.rejects(() => r.mgr.ensure(AGENT), /can't start agent workspaces/);
  assert.deepEqual(room.log, [`claim ${AGENT}`, `release ${AGENT}`]);
});

test("provision makes the workspace stopped, asks for no room and starts nothing, and is safe to repeat; the first command starts it", async () => {
  const room = fakeRoom();
  const admitted: string[] = [];
  const r = rigWith({ capacity: room.capacity, admit: ({ state }) => { admitted.push(state); }, projectsOf: () => ["prj_site"] });
  const a = await r.mgr.provision(AGENT);
  const b = await r.mgr.provision(AGENT);
  assert.deepEqual([a, b], [{ workspaceId: NAME }, { workspaceId: NAME }]);
  assert.equal(r.dk.ops("create").filter((x) => x.name === NAME).length, 1);
  assert.equal(r.dk.ops("start").filter((x) => x.name === NAME).length, 0, "the workspace itself was not started (only the one-off project helper ran)");
  assert.deepEqual([room.log, admitted], [[], []], "no room claimed");
  assert.equal(r.dk.box(NAME).running, false);
  assert.deepEqual((await r.mgr.list()).map((x) => x.state), ["asleep"]);
  assert.equal(await r.mgr.ensure(AGENT), "woke", "the first command wakes what was provisioned");
  assert.equal(r.dk.ops("create").filter((x) => x.name === NAME).length, 1, "it is not made again");
  await assert.rejects(() => r.mgr.provision("../x"), /not an agent/);
});

test("the container carries the host's limits: 1 CPU, a 1 GB hard cap with 64 MB held back, low CPU shares, no swap, 512 processes", () => {
  const c = workspaceContainerConfig(AGENT, "i", { projects: [] }, {});
  const MB = 1024 * 1024;
  assert.deepEqual([c.HostConfig.NanoCpus, c.HostConfig.Memory, c.HostConfig.MemorySwap, c.HostConfig.PidsLimit, c.HostConfig.MemoryReservation, c.HostConfig.CpuShares], [1e9, 1024 * MB, 1024 * MB, 512, 64 * MB, 256]);
});

// ---- the project folders, mirrored with Files and attributed to the agent that worked in them ---------------------------------------------------------------

function projectHome(o: { folderless?: boolean; fail?: boolean } = {}) {
  const made: Array<{ projectId: string; agentId: string; manifest: string }> = [];
  const passes: Array<{ projectId: string; agentId: string; running: string[]; stops: number }> = [];
  const disks = new Map<string, import("../workspace.ts").HomeDisk>();
  let rg: ReturnType<typeof rigWith> | undefined;
  const home: NonNullable<WorkspaceOptions["home"]> = {
    sync: () => ({ async pass() { return { failed: 0 }; } }),
    readTar: () => ({ files: new Map([["plan.md", { bytes: Buffer.from("x"), mtimeMs: 1 }]]), dirs: new Set(), refused: [], complete: true }),
    manifest: (id) => `/m/${id}.json`,
    projectManifest: (id) => `/m/projects/${id}.json`,
    syncProject: (x) => {
      if (o.folderless) return null;
      made.push({ projectId: x.projectId, agentId: x.agentId, manifest: x.manifest });
      disks.set(`${x.projectId}|${x.agentId}`, x.fs);
      return { async pass() { if (o.fail) throw new Error("Files did not answer"); passes.push({ projectId: x.projectId, agentId: x.agentId, running: [...(rg?.dk.boxes.values() ?? [])].filter((b) => b.running && b.name.startsWith("vyre-ws-")).map((b) => b.name), stops: rg?.dk.ops("stop").length ?? 0 }); return { failed: 0 }; } };
    },
    intervalMs: 5000,
  };
  return { home, made, passes, disks, bind: (r: ReturnType<typeof rigWith>) => { rg = r; } };
}
const B_AGENT = "agt_pam";

test("a project's folder is mirrored with Files when a workspace on it wakes, and a command makes the agent that ran it the one the next mirror is made as", async () => {
  const ph = projectHome();
  const r = rigWith({ home: ph.home, projectsOf: () => ["prj_site"], projectKickMs: 5 });
  ph.bind(r);
  await r.mgr.ensure(AGENT);
  assert.deepEqual(ph.passes.map((p) => [p.projectId, p.agentId]), [["prj_site", AGENT]], "a pass at wake, as the agent whose workspace woke");
  assert.deepEqual(ph.made[0], { projectId: "prj_site", agentId: AGENT, manifest: "/m/projects/prj_site.json" });
  // a second agent on the same project
  await r.mgr.ensure(B_AGENT);
  const n = ph.passes.length;
  // B works (a command of B's ran to its end): 12 Nov, any exec was taken for work, so another agent's tab reading its screen took the authorship
  await r.mgr.exec(B_AGENT, ["tmux", "-V"]);
  r.mgr.worked(B_AGENT);
  await later(40);
  const after = ph.passes.slice(n);
  assert.ok(after.length >= 1 && after.every((p) => p.agentId === B_AGENT), `the pass after B's command is B's: ${JSON.stringify(after.map((p) => p.agentId))}`);
  const m = ph.passes.length;
  await r.mgr.exec(AGENT, ["tmux", "-V"]);
  r.mgr.worked(AGENT);
  await later(40);
  assert.ok(ph.passes.slice(m).every((p) => p.agentId === AGENT) && ph.passes.length > m, "and then A's");
  assert.deepEqual([...new Set(ph.made.map((x) => x.manifest))], ["/m/projects/prj_site.json"], "one manifest for the project, whoever ran the pass");
  r.mgr.close();
});

test("the last workspace on a project mirrors it once more before it stops; one that is not the last leaves it to the one still running", async () => {
  const ph = projectHome();
  const r = rigWith({ home: ph.home, projectsOf: () => ["prj_site"], projectKickMs: 5 });
  ph.bind(r);
  await r.mgr.ensure(AGENT);
  await r.mgr.ensure(B_AGENT);
  const n = ph.passes.length;
  assert.equal(await r.mgr.sleep(AGENT), true);
  assert.equal(ph.passes.length, n, "B is still running on the project: A stopping adds no project pass");
  assert.equal(await r.mgr.sleep(B_AGENT), true);
  const last = ph.passes.at(-1)!;
  assert.deepEqual([last.projectId, last.running.includes(workspaceName(B_AGENT)), last.stops], ["prj_site", true, 1], "B was the last: a pass ran while it was up, before its stop");
  r.mgr.close();
});

test("the disk side of a project mirror is the archive of the project's folder through a running workspace, and an exec to remove", async () => {
  const ph = projectHome();
  const r = rigWith({ home: ph.home, projectsOf: () => ["prj_site"], projectKickMs: 5 }, { onExec: (_b, argv) => (argv[0] === "sh" && (argv[2] ?? "").includes("rm -f --") ? { code: 0, stdout: "", stderr: "" } : undefined) });
  ph.bind(r);
  await r.mgr.ensure(AGENT);
  const disk = ph.disks.get(`prj_site|${AGENT}`)!;
  assert.deepEqual([...(await disk.snapshot()).files.keys()], ["plan.md"]);
  assert.deepEqual(r.dk.ops("archive_get").at(-1)!.detail, { path: "/home/agent/projects/prj_site/.", bytes: 0 });
  await disk.put([{ rel: "notes/a.md", bytes: new TextEncoder().encode("a"), readOnly: false }]);
  assert.equal((r.dk.ops("archive_put").at(-1)!.detail as { path: string }).path, "/home/agent/projects/prj_site");
  await disk.remove(["old.md"], ["gone"]);
  const rm = r.dk.ops("exec").map((x) => x.detail as string[]).find((c) => c[0] === "sh" && c[2]?.includes("rm -f --") && c.includes("/home/agent/projects/prj_site/old.md"));
  assert.deepEqual(rm!.slice(4), ["/home/agent/projects/prj_site/old.md", "::", "/home/agent/projects/prj_site/gone"]);
  r.mgr.close();
});

test("a project with no folder in Files, and a mirror that fails, change nothing about starting, using or stopping the workspace", async () => {
  for (const o of [{ folderless: true }, { fail: true }]) {
    const ph = projectHome(o);
    const r = rigWith({ home: ph.home, projectsOf: () => ["prj_site"], projectKickMs: 5 });
    ph.bind(r);
    assert.equal(await r.mgr.ensure(AGENT), "created");
    assert.equal((await r.mgr.exec(AGENT, ["tmux", "-V"])).code, 0);
    await later(20);
    assert.equal(await r.mgr.sleep(AGENT), true);
    assert.equal(await r.mgr.ensure(AGENT), "woke");
    r.mgr.close();
  }
});

test("with no project mirror configured the project volume is just shared: no archive call, no pass", async () => {
  const r = rigWith({ projectsOf: () => ["prj_site"] });
  await r.mgr.ensure(AGENT);
  await r.mgr.exec(AGENT, ["tmux", "-V"]);
  assert.equal(r.dk.ops("archive_get").length, 0);
  r.mgr.close();
});
