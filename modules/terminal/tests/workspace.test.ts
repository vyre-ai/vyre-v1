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

function rig(o: { docker?: FakeDockerOptions; projects?: () => string[]; idleMs?: number; admit?: WorkspaceOptions["admit"]; runner?: boolean; filesRoot?: WorkspaceOptions["filesRoot"] } = {}) {
  const dk = fakeDocker({ tmux: { scripts: { "echo hi": { out: "hi", code: 0 } } }, ...o.docker });
  const clock = { t: 1_000_000 };
  const mgr = createWorkspaceManager({
    api: createDockerApi(dk.http), http: dk.http, now: () => clock.t, sleep: async (ms) => { clock.t += ms; },
    idleMs: o.idleMs ?? 600_000,
    ...(o.projects ? { projectsOf: o.projects } : {}), ...(o.admit ? { admit: o.admit } : {}), ...(o.runner ? { runner: true } : {}), ...(o.filesRoot ? { filesRoot: o.filesRoot } : {}),
  });
  return { dk, mgr, clock };
}
const termHost = (r: ReturnType<typeof rig>) => createWorkspaceTerminalHost({ manager: r.mgr, streamMs: 10, sleep: async () => { await new Promise((x) => setTimeout(x, 2)); } });
const target = (agentId = AGENT) => ({ host: "agent_computer" as const, agentId });
const open = (h: ReturnType<typeof termHost>, id = "trm_1") => h.open({ terminalId: id, target: target(), name: "agent", cols: 100, rows: 30, folders: [] });

test("the container profile: non-root, no capability, no new privileges, no Docker socket, no device, limits, only its own volumes and the Files folder", () => {
  const good = workspaceContainerConfig(AGENT, "vyre/agent-workspace:1", { projects: ["prj_a"], filesHost: null }, {});
  assert.deepEqual(reviewWorkspaceConfig(good, AGENT), []);
  assert.equal(good.User, "10001:10001");
  assert.deepEqual(good.HostConfig.CapDrop, ["ALL"]);
  assert.equal(good.HostConfig.Privileged, false);
  assert.ok(good.HostConfig.SecurityOpt.includes("no-new-privileges:true"));
  assert.deepEqual(good.HostConfig.Binds, [`${NAME}-home:/home/agent:rw`, `${NAME}-files:/home/agent/Vyre:rw`, "vyre-wsproj-prj_a:/home/agent/projects/prj_a:rw"]);
  assert.equal(good.HostConfig.Memory, 1024 * 1024 * 1024);
  assert.equal(good.HostConfig.NanoCpus, 1e9);
  const withFolder = workspaceContainerConfig(AGENT, "i", { projects: [], filesHost: "/srv/vyre/files/agt_dex" }, {});
  assert.deepEqual(reviewWorkspaceConfig(withFolder, AGENT), [], "a host folder is allowed for the Files folder only");

  const wrong = (edit: (c: typeof good) => void): string => { const c = structuredClone(good); edit(c); return reviewWorkspaceConfig(c, AGENT).join("; "); };
  assert.match(wrong((c) => { c.HostConfig.Binds.push("/var/run/docker.sock:/var/run/docker.sock:rw"); }), /docker socket/);
  assert.match(wrong((c) => { c.HostConfig.Binds.push("/etc:/home/agent/projects/etc:rw"); }), /system folder|host folder is bound/);
  assert.match(wrong((c) => { c.HostConfig.Binds.push("/srv/other:/home/agent/projects/x:rw"); }), /host folder is bound at/);
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

test("behind the runner each workspace is on a network of its own, and no host folder is bound even when one is offered", async () => {
  const r = rig({ runner: true, filesRoot: () => "/srv/vyre/files/agt_dex" });
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
  const r = rig({ docker: { image: false } });
  await assert.rejects(() => r.mgr.ensure(AGENT), (e: Error) => e.message.startsWith(IMAGE_MISSING_LINE) && /docker pull vyre\/agent-workspace:1/.test(e.message));
  assert.equal(r.dk.boxes.size, 0);
  const fetched = rig({ docker: { image: false, pullWorks: true } });
  assert.equal(await fetched.mgr.ensure(AGENT), "created", "a server that can fetch the image does");
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
  assert.equal(PROJECT_INIT_SCRIPT, "chown 10001:10001 /vol && chmod 2775 /vol");
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
