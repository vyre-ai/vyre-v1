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

test("Team daemon with Docker: an agent's terminal_run makes its workspace, the person attaches to the same session, and a file made in ~/Vyre reaches the agent's folder in Files", { skip, timeout: 900_000 }, async (t) => {
  if (PRESET === undefined) {
    const built = await docker(["build", "-t", IMAGE, "images/agent-workspace"], 800_000);
    assert.equal(built.code, 0, built.out.slice(-600));
  }
  const savedImage = process.env["VYRE_WORKSPACE_IMAGE"];
  process.env["VYRE_WORKSPACE_IMAGE"] = IMAGE;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-wslive-"));
  const d = await boot(dir, standIn, undefined, {
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_wslive", "--space-name", "Team", "--space-kind", "team", "--role", "space"], {}, "1.2.3"),
    computersSocketPath: "/var/run/docker.sock", computersHomeIntervalMs: 300, workspaceIdleMs: 600_000,
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
  const threadId = (await ok(d, token, "chat.start", { kind: "chat", agentIds: [agent] })).thread.threadId as string;
  await ok(d, token, "threads.set_mode", { threadId, mode: "auto" });
  const run = async (command: string, key: string): Promise<{ terminalId: string; exitCode: number; output: string }> => {
    await ok(d, token, "chat.post", { threadId, body: `TOOL terminal_run ${JSON.stringify({ command, idempotencyKey: key })}`, mentions: [{ kind: "agent", id: agent }] });
    const said = await waitFor(async () => {
      await d.hooks?.pump?.();
      const m = ((await call(d, token, "chat.messages.list", { threadId })).data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined) ?? [];
      return m.filter((x) => x.author?.kind === "agent" && /TOOL RESULT/.test(x.body ?? "")).map((x) => x.body ?? "").find((b) => b.includes(key)) ?? m.filter((x) => x.author?.kind === "agent" && /TOOL RESULT/.test(x.body ?? "")).map((x) => x.body ?? "").at(-1) ?? null;
    }, 120_000);
    assert.match(said, /TOOL RESULT ok/, said);
    return (JSON.parse(said.replace(/^[\s\S]*?TOOL RESULT ok /, "")) as { data: { terminalId: string; exitCode: number; output: string } }).data;
  };

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

  // a file the agent makes in ~/Vyre reaches its folder in Files, as the agent
  await run("echo from-the-workspace > ~/Vyre/made.txt", "ws-made");
  const folderId = ((await ok(d, token, "agents.get", { agentId: agent })).agent as { folderId: string }).folderId;
  const seen = await waitFor(async () => {
    const l = (await ok(d, token, "files.list", { section: "space", folder: folderId })).files as Array<{ name: string }>;
    return l.some((f) => f.name === "made.txt") ? l : null;
  }, 60_000);
  assert.ok(seen.some((f) => f.name === "made.txt"), JSON.stringify(seen));
  const health = await ok(d, token, "terminal.health", {});
  assert.equal(health.state, "healthy");
});
