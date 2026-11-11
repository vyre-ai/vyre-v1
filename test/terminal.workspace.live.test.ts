// @heavy docker
// An agent's workspace on a booted Team daemon with a real Docker engine (6 Nov): nothing is bound in this process, the daemon's own seam gives the terminal module its workspace manager. A
// stand-in model calls terminal_run with no host and no terminal; the command runs in a container made for the agent on that first call, shows under Terminals as a Workspace, the person attaches to
// the same tmux session, and a file the agent makes in ~/Vyre reaches the agent's folder in Files (the mirror, run as the agent). The image is VYRE_WORKSPACE_TEST_IMAGE, or built from images/agent-workspace.
// Runs only with VYRE_HEAVY_DOCKER=1.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, standIn, waitFor } from "./memory-live-kit.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the workspace is a real container)";
const PRESET = process.env["VYRE_WORKSPACE_TEST_IMAGE"];
const IMAGE = PRESET ?? `vyre/agent-workspace:daemon-${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";

function docker(args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile("docker", args, { cwd: CODE_ROOT, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number | undefined) ?? 1 : 0, out: `${stdout}\n${stderr}` });
    });
  });
}
type Reply = { status: number; data: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(d: Daemon, token: string | null, cap: string, input: unknown): Promise<Reply> {
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
let keys = 0;
const ok = async (d: Daemon, token: string, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, token, cap, { idempotencyKey: `ws-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

async function scenario(t: import("node:test").TestContext, kind: "team" | "personal"): Promise<void> {
  if (PRESET === undefined) {
    const built = await docker(["build", "-t", IMAGE, "images/agent-workspace"], 800_000);
    assert.equal(built.code, 0, built.out.slice(-600));
  }
  const savedImage = process.env["VYRE_WORKSPACE_IMAGE"];
  process.env["VYRE_WORKSPACE_IMAGE"] = IMAGE;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-wslive-"));
  const d = await boot(dir, standIn, undefined, {
    config: kind === "team"
      ? loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_wslive", "--space-name", "Team", "--space-kind", "team", "--role", "space"], {}, "1.2.3")
      : loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_wslive", "--space-name", "Personal", "--space-kind", "personal", "--role", "space,device"], {}, "1.2.3"),
    // a Team server is told its socket; a Personal Space finds the runtime its computer has, as the desktop app's daemon does
    ...(kind === "team" ? { computersSocketPath: "/var/run/docker.sock" } : {}), computersHomeIntervalMs: 300, workspaceIdleMs: 600_000,
  });
  let name = "";
  t.after(async () => {
    process.env["VYRE_WORKSPACE_IMAGE"] = savedImage ?? "";
    if (savedImage === undefined) delete process.env["VYRE_WORKSPACE_IMAGE"];
    await d.stop();
    if (name !== "") { await docker(["rm", "-f", name], 60_000); await docker(["volume", "rm", "-f", `${name}-home`, `${name}-files`], 60_000); }
    if (PRESET === undefined) await docker(["rmi", "-f", IMAGE], 60_000);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
  const device = { deviceName: "Dana's Mac", deviceClass: "desktop" };
  assert.equal((await call(d, null, "identity.claim_owner", { code, spaceId: "spc_wslive", username: "dana", displayName: "Dana Reyes", password: PASSWORD, ...device, keys: KEYS })).status, 200);
  const token = ((await call(d, null, "identity.sign_in", { username: "dana", password: PASSWORD, ...device })).data.session as { token: string }).token;
  const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 7).toString("base64") }) });
  assert.equal(unlock.status, 204);
  const folder = await ok(d, token, "vault.folders.create", { name: "Accounts", scope: "mine" });
  const flow = await ok(d, token, "providers.subscription_start", { providerKey: "claude-code" });
  await ok(d, token, "vault.item.put", { folderId: folder.folder.id, name: "Dana_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY, secret: true }] });
  const provider = await ok(d, token, "providers.subscription_complete", { flowId: flow.flowId });
  await ok(d, token, "providers.set_space_use", { providerId: provider.provider.id, allow: true });

  const created = (await ok(d, token, "agents.create", { name: "Dex", role: "You help the team." })).agent as { agentId: string; folderId?: string };
  const agent = created.agentId;
  name = `vyre-ws-${agent}`;
  // a project the agent is on: one shared folder, mirrored with the project's folder in Files
  const project = await ok(d, token, "projects.create", { type: "project", title: "Site", members: [{ principal: agent, role: "member" }] });
  const projectId = project.projectId as string;
  const projectFolder = project.folderId as string;
  const threadId = (await ok(d, token, "chat.start", { kind: "chat", agentIds: [agent] })).thread.threadId as string;
  await ok(d, token, "threads.set_mode", { threadId, mode: "auto" });
  const tool = async (toolName: string, input: Record<string, unknown>, key: string): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    await ok(d, token, "chat.post", { threadId, body: `TOOL ${toolName} ${JSON.stringify({ ...input, idempotencyKey: key })}`, mentions: [{ kind: "agent", id: agent }] });
    const said = await waitFor(async () => {
      await d.hooks?.pump?.();
      const m = ((await call(d, token, "chat.messages.list", { threadId })).data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined) ?? [];
      const results = m.filter((x) => x.author?.kind === "agent" && /TOOL RESULT/.test(x.body ?? "")).map((x) => x.body ?? "");
      return results.length > seenResults ? results.at(-1)! : null;
    }, 120_000);
    seenResults += 1;
    assert.match(said, /TOOL RESULT ok/, said);
    return (JSON.parse(said.replace(/^[\s\S]*?TOOL RESULT ok /, "")) as { data: any }).data;   // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  let seenResults = 0;
  const run = (command: string, key: string, session?: string): Promise<{ terminalId: string; exitCode: number; output: string }> => tool("terminal_run", { command, ...(session ? { session } : {}) }, key);

  assert.equal((await docker(["inspect", name], 30_000)).code === 0, false, "no workspace before the first command");
  const first = await run("echo hi", "ws-echo");
  assert.deepEqual([first.exitCode, first.output], [0, "hi"]);
  assert.equal((await docker(["inspect", "-f", "{{.State.Running}}", name], 30_000)).out.trim().split("\n")[0], "true", "the first command made it");

  const mine = (await ok(d, token, "terminal.list", { section: "personal" })).terminals as Array<{ terminalId: string; host: string; hostTitle: string; agentId?: string; name: string }>;
  const s = mine.find((x) => x.terminalId === first.terminalId);
  assert.ok(s, JSON.stringify(mine));
  assert.deepEqual([s.host, s.hostTitle, s.agentId, s.name], ["agent_computer", "Workspace", agent, "agent"]);
  const att = await ok(d, token, "terminal.attach", { terminalId: s.terminalId });
  assert.match(att.replay, /echo hi/);
  assert.match(att.replay, /^hi$/m);
  const tmux = await docker(["exec", name, "tmux", "list-sessions", "-F", "#{session_name}"], 30_000);
  assert.equal(tmux.out.trim().split("\n")[0], `vyre-${first.terminalId}`, "the person's tab and the agent are in the same tmux session");

  // many tabs: the agent runs into a named one, opens another with terminal_open, lists them and closes one; each is its own tmux session in the same container
  const build = await run("echo building", "ws-build", "build");
  assert.notEqual(build.terminalId, first.terminalId);
  const srv = await tool("terminal_open", { name: "server" }, "ws-open");
  assert.deepEqual([srv.terminal.name, srv.terminal.host, srv.terminal.agentId, srv.terminal.by], ["server", "agent_computer", agent, { kind: "agent" }]);
  const listed = await tool("terminal_list", {}, "ws-list");
  assert.deepEqual((listed.terminals as Array<{ name: string }>).map((x) => x.name).sort(), ["agent", "build", "server"]);
  const sessions = (await docker(["exec", name, "tmux", "list-sessions", "-F", "#{session_name}"], 30_000)).out.trim().split("\n").filter((x) => x.startsWith("vyre-")).sort();
  assert.deepEqual(sessions, [first.terminalId, build.terminalId, srv.terminal.terminalId].map((x) => `vyre-${x}`).sort(), "three tmux sessions in one workspace");
  await tool("terminal_close", { terminalId: srv.terminal.terminalId }, "ws-close");
  assert.deepEqual(((await tool("terminal_list", {}, "ws-list2")).terminals as Array<{ name: string }>).map((x) => x.name).sort(), ["agent", "build"]);

  // a file the agent makes in ~/Vyre reaches its folder in Files, as the agent
  await run("echo from-the-workspace > ~/Vyre/made.txt", "ws-made");
  const folderId = ((await ok(d, token, "agents.get", { agentId: agent })).agent as { folderId: string }).folderId;
  const seen = await waitFor(async () => {
    const l = (await ok(d, token, "files.list", { section: "space", folder: folderId })).files as Array<{ name: string }>;
    return l.some((f) => f.name === "made.txt") ? l : null;
  }, 60_000);
  assert.ok(seen.some((f) => f.name === "made.txt"), JSON.stringify(seen));
  // the project's shared folder: the agent writes there, it reaches the project's folder in Files with the agent as the author, an edit is a second version, and restoring the first from Files puts it back on the disk
  await run(`echo one > ~/projects/${projectId}/plan.md`, "ws-plan1");
  const plan = await waitFor(async () => {
    const l = (await ok(d, token, "files.list", { section: "space", folder: projectFolder })).files as Array<{ fileId: string; name: string }>;
    return l.find((f) => f.name === "plan.md") ?? null;
  }, 60_000);
  await run(`sleep 2; echo two > ~/projects/${projectId}/plan.md`, "ws-plan2");
  const versions = await waitFor(async () => {
    const v = (await ok(d, token, "files.versions", { fileId: plan.fileId })).versions as Array<{ versionId: string; n: number; by: string; reason?: string }>;
    return v.length >= 2 ? v : null;
  }, 60_000);
  assert.ok(versions.every((v) => v.by === agent || v.by.includes(agent)), `who changed it: ${JSON.stringify(versions.map((v) => v.by))}`);
  const v1 = [...versions].sort((x, y) => x.n - y.n)[0]!;
  await ok(d, token, "files.restore_version", { fileId: plan.fileId, versionId: v1.versionId });
  const back = await waitFor(async () => {
    const out = (await docker(["exec", name, "cat", `/home/agent/projects/${projectId}/plan.md`], 30_000)).out.trim().split("\n")[0];
    return out === "one" ? out : null;
  }, 60_000);
  assert.equal(back, "one", "undo from Files reaches the workspace");

  const health = await ok(d, token, "terminal.health", {});
  assert.equal(health.state, "healthy");

  // the agent goes to Trash (12 Nov, audit item 13): its workspace's container goes and its tabs close; its home and Files volumes stay, since it can be restored
  await ok(d, token, "agents.delete", { agentId: agent });
  const gone = await waitFor(async () => { await d.hooks?.pump?.(); return (await docker(["inspect", name], 30_000)).code !== 0 ? true : null; }, 60_000);
  assert.equal(gone, true, "the container is gone");
  assert.equal((await docker(["volume", "inspect", `${name}-home`], 30_000)).code, 0, "what the agent kept stays");
  const left = ((await ok(d, token, "terminal.list", { section: "personal" })).terminals as Array<{ agentId?: string }>).filter((x) => x.agentId === agent);
  assert.deepEqual(left, [], "its tabs are closed");
}

test("Team daemon with Docker: an agent's terminal_run makes its workspace, tabs, a project folder with Files history, and the Files mirror", { skip, timeout: 900_000 }, (t) => scenario(t, "team"));
test("Personal Space on a computer with a container runtime: the same, with the socket found and no Team", { skip, timeout: 900_000 }, (t) => scenario(t, "personal"));
