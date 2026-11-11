// @heavy docker
// An agent's workspace on a real Docker engine and a real tmux (6 Nov): the first terminal_run makes the container from images/agent-workspace and answers `echo hi`; a person attaches and sees the same
// tmux session the agent used (checked with tmux itself in the container); the workspace is not root, holds no Docker socket and no setuid program; its home and the project's shared folder are writable
// and survive a sleep; it wakes on the next command in about a second. The module is the real one, bound to the real manager; nothing is stood in but the Space around it (a ctx and a database).
// Runs only with VYRE_HEAVY_DOCKER=1. The image is built from images/agent-workspace under a tag of this run, or VYRE_WORKSPACE_TEST_IMAGE names one already built.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { CODE_ROOT } from "../../../host/src/daemon/daemon.ts";
import { createLocalHost, handlers } from "../impl.ts";
import { bindHost, bindPlace, bindTeam, bindValues, bindWorkspaces } from "../projections.ts";
import type { TermCtx } from "../projections.ts";
import { buildWorkspaceManager, workspaceName } from "../workspace.ts";
import { unixSocketHttp } from "../../../sandbox/src/docker.ts";
import { fakeValues, harness, reset } from "../fixtures/harness.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the workspace is a real container)";
const PRESET = process.env["VYRE_WORKSPACE_TEST_IMAGE"];
const IMAGE = PRESET ?? `vyre/agent-workspace:live-${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const AGENT = `agtlive${Math.random().toString(36).slice(2, 8)}`;
const PROJECT = `prjlive${Math.random().toString(36).slice(2, 8)}`;
const NAME = workspaceName(AGENT);

const h = handlers as unknown as Record<string, (ctx: TermCtx, input: any) => Promise<any> | any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

function docker(args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile("docker", args, { cwd: CODE_ROOT, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number | undefined) ?? 1 : 0, out: `${stdout}\n${stderr}` });
    });
  });
}
const inBox = async (...cmd: string[]): Promise<string> => { const r = await docker(["exec", NAME, ...cmd], 30_000); assert.equal(r.code, 0, r.out); return r.out.trim(); };

test("a real workspace: first terminal_run makes it, a person attaches to the same tmux session, it sleeps and wakes with its files", { skip, timeout: 900_000 }, async (t) => {
  if (PRESET === undefined) {
    const built = await docker(["build", "-t", IMAGE, "images/agent-workspace"], 800_000);
    assert.equal(built.code, 0, built.out.slice(-600));
  }
  const manager = buildWorkspaceManager({ http: unixSocketHttp(), image: IMAGE, idleMs: 600_000, projectsOf: () => [PROJECT] });
  t.after(async () => {
    manager.close();
    await docker(["rm", "-f", NAME], 60_000);
    await docker(["volume", "rm", "-f", `${NAME}-home`, `${NAME}-files`, `vyre-wsproj-${PROJECT}`], 60_000);
    if (PRESET === undefined) await docker(["rmi", "-f", IMAGE], 60_000);
  });

  reset();
  bindTeam(() => true);
  bindWorkspaces(true);
  bindPlace(async () => ({ team: true, agentComputer: false, runsOn: "device", deviceId: "dev_mac" }));
  bindHost(createLocalHost({ exec: async () => ({ code: 127, stdout: "", stderr: "" }), shell: async () => ({ exitCode: 1 }), home: "/tmp", runsHere: () => false }, manager));

  const hn = harness();
  // the agent is Dana's Assistant: Dana attaches to it, nobody else
  const dana: TermCtx = { ...hn.as({ kind: "person", id: "usr_dana" }), call: (async (cap: string) => (cap === "agents.get" ? { agent: { agentId: AGENT, ownerId: "usr_dana", kind: "assistant" } } : undefined)) as never };
  const agent: TermCtx = { ...hn.as({ kind: "agent", id: AGENT }, "usr_dana", "run_1"), thread: "thr_1" };

  assert.deepEqual((await manager.list()).filter((w) => w.agentId === AGENT), [], "nothing before the first use");
  const t0 = Date.now();
  const run = await h["terminal.run"]!(agent, { command: "echo hi", idempotencyKey: "idem_live_1" });
  const firstMs = Date.now() - t0;
  assert.deepEqual([run.exitCode, run.output], [0, "hi"]);
  assert.equal((await manager.list()).find((w) => w.agentId === AGENT)?.state, "running", `made and running (${firstMs} ms with the image on the machine)`);

  // the same tmux session, seen with tmux itself in the container: the agent's command is on its screen
  const session = `vyre-${run.terminalId}`;
  assert.equal(await inBox("tmux", "list-sessions", "-F", "#{session_name}"), session);
  assert.match(await inBox("tmux", "capture-pane", "-p", "-t", session), /echo hi[\s\S]*\nhi\n/);
  // a person attaches: the replay is that screen, and what they type lands in that session
  const att = await h["terminal.attach"]!(dana, { terminalId: run.terminalId });
  assert.match(att.replay, /hi/);
  await h["terminal.input"]!(dana, { terminalId: run.terminalId, data: "echo typed-by-dana\n" });
  await new Promise((r) => setTimeout(r, 600));
  assert.match(await inBox("tmux", "capture-pane", "-p", "-t", session), /typed-by-dana/, "the person's keystrokes are in the agent's session");
  const again = await h["terminal.run"]!(agent, { command: "echo second", idempotencyKey: "idem_live_2" });
  assert.equal(again.terminalId, run.terminalId, "the agent's next command goes to the same session");
  assert.match((await h["terminal.read"]!(dana, { terminalId: run.terminalId, lines: 200 })).text, /typed-by-dana[\s\S]*second/);
  // a member who is not Dana is held out; the agent itself is in
  const sam: TermCtx = { ...dana, principal: { kind: "person", id: "usr_sam" }, authorize: () => ({ effect: "deny" }) };
  await assert.rejects(() => h["terminal.attach"]!(sam, { terminalId: run.terminalId }), (e: { error?: { code?: string } }) => e.error?.code === "permission.role_lacks_permission");

  // the container profile as the engine reports it
  assert.equal(await inBox("id", "-u"), "10001");
  assert.equal(await inBox("sh", "-c", "ls /var/run/docker.sock 2>&1 | head -1; test ! -S /var/run/docker.sock && echo none"), "ls: cannot access '/var/run/docker.sock': No such file or directory\nnone");
  assert.equal(await inBox("sh", "-c", "find / -xdev \\( -perm -4000 -o -perm -2000 \\) -type f 2>/dev/null | wc -l"), "0");
  assert.match(await inBox("sh", "-c", "tmux -V && git --version && node --version && python3 --version && jq --version && curl --version | head -1"), /tmux .*\ngit version .*\nv24\..*\nPython 3\..*\njq-.*\ncurl .*/);
  const hc = JSON.parse((await docker(["inspect", "-f", "{{json .HostConfig}}", NAME], 30_000)).out.split("\n")[0]!) as { CapDrop: string[]; Privileged: boolean; SecurityOpt: string[]; Binds: string[] };
  const insp = [{ HostConfig: hc }];
  assert.deepEqual(insp[0]!.HostConfig.CapDrop, ["ALL"]);
  assert.equal(insp[0]!.HostConfig.Privileged, false);
  assert.ok(insp[0]!.HostConfig.SecurityOpt.includes("no-new-privileges:true"));
  assert.ok(insp[0]!.HostConfig.Binds.every((b) => !b.includes("docker.sock") && !b.startsWith("/")));

  // files: the home and the project's shared folder are writable by the agent user, and stay through a sleep
  await inBox("sh", "-c", `echo kept > ~/note.txt && echo shared > ~/projects/${PROJECT}/shared.txt && echo files > ~/Vyre/f.txt`);
  const g = manager.generation(AGENT);
  assert.equal(await manager.sleep(AGENT), true);
  assert.equal((await docker(["inspect", "-f", "{{.State.Running}}", NAME], 30_000)).out.trim().split("\n")[0], "false", "asleep: the container stopped");
  assert.equal((await manager.list()).find((w) => w.agentId === AGENT)?.state, "asleep");
  const w0 = Date.now();
  const woke = await h["terminal.run"]!(agent, { command: "cat ~/note.txt ~/projects/" + PROJECT + "/shared.txt ~/Vyre/f.txt", idempotencyKey: "idem_live_3" });
  const wakeMs = Date.now() - w0;
  assert.deepEqual([woke.exitCode, woke.output], [0, "kept\nshared\nfiles"], "the files stayed, and the session was made again for the command");
  assert.equal(woke.terminalId, run.terminalId, "the same session row");
  assert.equal(manager.generation(AGENT), g + 1);
  assert.ok(wakeMs < 8_000, `woke and ran in ${wakeMs} ms`);
  t.diagnostic(`first use ${firstMs} ms, wake and run ${wakeMs} ms`);

  // the project's folder is shared: a second agent on the project sees what this one wrote
  const other = `agtlive${Math.random().toString(36).slice(2, 8)}`;
  const second = buildWorkspaceManager({ http: unixSocketHttp(), image: IMAGE, projectsOf: () => [PROJECT] });
  t.after(async () => { second.close(); await docker(["rm", "-f", workspaceName(other)], 60_000); await docker(["volume", "rm", "-f", `${workspaceName(other)}-home`, `${workspaceName(other)}-files`], 60_000); });
  assert.equal((await second.exec(other, ["cat", `/home/agent/projects/${PROJECT}/shared.txt`])).stdout.trim(), "shared");
  assert.equal((await second.exec(other, ["sh", "-c", `echo from-other >> /home/agent/projects/${PROJECT}/shared.txt`])).code, 0);
  assert.match(await inBox("cat", `/home/agent/projects/${PROJECT}/shared.txt`), /from-other/);
  assert.equal((await second.exec(other, ["cat", "/home/agent/note.txt"])).code, 1, "but not another agent's home");
});

test("a real workspace (W6): one person's Vault value used through a team agent never reaches the disk, the history or another person who asks the same agent", { skip, timeout: 900_000 }, async (t) => {
  const TEAM = `agtw6${Math.random().toString(36).slice(2, 8)}`;
  const BOX = workspaceName(TEAM);
  if (PRESET === undefined) {
    const built = await docker(["build", "-t", IMAGE, "images/agent-workspace"], 800_000);
    assert.equal(built.code, 0, built.out.slice(-600));
  }
  const manager = buildWorkspaceManager({ http: unixSocketHttp(), image: IMAGE, idleMs: 600_000, projectsOf: () => [] });
  t.after(async () => {
    manager.close();
    await docker(["rm", "-f", BOX], 60_000);
    await docker(["volume", "rm", "-f", `${BOX}-home`, `${BOX}-files`], 60_000);
    if (PRESET === undefined) await docker(["rmi", "-f", IMAGE], 60_000);
  });
  const SECRET = `sk-live-w6-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  const EVIL = "a$b;touch ~/vyre-pwned;'q\"x";
  reset();
  bindTeam(() => true);
  bindWorkspaces(true);
  bindPlace(async () => ({ team: true, agentComputer: false, runsOn: "space" }));
  bindValues(fakeValues({ "#Dana_Api.key": SECRET, "#Db.password": EVIL }));
  bindHost(createLocalHost({ exec: async () => ({ code: 127, stdout: "", stderr: "" }), shell: async () => ({ exitCode: 1 }), home: "/tmp", runsHere: () => false }, manager));
  const hn = harness();
  const dana: TermCtx = { ...hn.as({ kind: "agent", id: TEAM }, "usr_dana", "run_d"), thread: "thr_dana" };
  const omar: TermCtx = { ...hn.as({ kind: "agent", id: TEAM }, "usr_omar", "run_o"), thread: "thr_omar" };
  const raw = async (...cmd: string[]): Promise<string> => { const r = await docker(["exec", BOX, ...cmd], 30_000); return r.out; };

  const a = await h["terminal.run"]!(dana, { session: "dana", command: 'printf %s "$K" | wc -c; printf %s #Db.password | wc -c; echo "seen=$K"', env: { K: "#Dana_Api.key" }, idempotencyKey: "w6-live-a" });
  assert.equal(a.exitCode, 0, a.output);
  assert.deepEqual(a.output.split("\n").slice(0, 2).map((l: string) => l.trim()), [String(SECRET.length), String(Buffer.byteLength(EVIL))], "both values reached the command exactly");
  assert.equal(a.output.includes(SECRET), false);
  assert.match(await raw("sh", "-c", "ls ~/vyre-pwned 2>&1; true"), /No such file/, "the value did not run as shell");
  const sessA = `vyre-${a.terminalId}`;
  const pane = (await raw("tmux", "display-message", "-p", "-t", sessA, "#{pane_pid}")).trim();
  const typed = (await raw("tmux", "capture-pane", "-p", "-J", "-t", sessA, "-S", "-")).split("\n").find((l) => l.includes("__VYRE_BEG_") && l.includes("printf"));
  assert.ok(typed && !typed.includes(SECRET) && !typed.includes(EVIL), "the typed line names variables only");

  // Omar asks the same agent, in another tab of the same workspace
  for (const [i, command] of ["history", `tmux capture-pane -p -J -t ${sessA} -S -`, `cat /proc/${pane}/environ | tr '\\0' '\\n'`, "env", "ls -la /tmp; tmux list-buffers; true"].entries()) {
    const r = await h["terminal.run"]!(omar, { session: "omar", command, idempotencyKey: `w6-live-b${i}` });
    assert.equal(r.output.includes(SECRET) || r.output.includes(EVIL), false, `Omar's ${command}`);
  }
  // the raw container, with no scrubber in between: nothing of either value is in a file, a buffer, or any process's environment
  const sweep = `grep -rlF -e "$1" -e "$2" /home/agent /tmp 2>/dev/null; tmux list-buffers 2>/dev/null; for p in /proc/[0-9]*; do tr '\\0' '\\n' < $p/environ 2>/dev/null | grep -lF -e "$1" -e "$2" >/dev/null && echo "proc $p"; done; true`;
  assert.equal((await raw("sh", "-c", sweep, "sh", SECRET, EVIL)).trim(), "", "no file, buffer or process holds a value");

  // Dana's tab closes: bash writes its history to the home volume on the hangup. It holds no agent line, so no value.
  await h["terminal.close"]!(dana, { terminalId: a.terminalId });
  await new Promise((r) => setTimeout(r, 800));
  const hist = await raw("sh", "-c", "cat ~/.bash_history 2>/dev/null; true");
  assert.equal(hist.includes(SECRET) || hist.includes(EVIL) || hist.includes("__VYRE_BEG_"), false, "the history on the home volume");
  assert.equal((await raw("sh", "-c", sweep, "sh", SECRET, EVIL)).trim(), "", "nor anywhere else afterwards");
  const later = await h["terminal.run"]!(omar, { session: "omar", command: "cat ~/.bash_history; true", idempotencyKey: "w6-live-c" });
  assert.equal(later.output.includes(SECRET), false);
});
