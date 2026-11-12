// @heavy docker
// Eighth look Y1 on the real path: a clean daemon stop (an update stops it the same way: the engine records its turns cancelled with reason "closing", as their askers) and a crash
// (SIGKILL) leave an agent's running workspace command running. The daemon is a child process (test/support/terminal-daemon-hold.ts) with the stand-in model; the agent's turn runs a loop
// that writes a counter every second; the counter keeps counting through a SIGTERM and start, then through a SIGKILL and start. Needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1" && process.env["VYRE_WORKSPACE_TEST_IMAGE"] !== undefined;
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE";
const HOLDER = fileURLToPath(new URL("./support/terminal-daemon-hold.ts", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";

const docker = (args: string[]): Promise<{ code: number; out: string }> => new Promise((r) => { execFile("docker", args, { timeout: 30_000 }, (e, out, err) => r({ code: e ? 1 : 0, out: `${String(out)}${String(err)}` })); });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, ms: number, look: () => Promise<T | null>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = await look(); if (v !== null) return v; assert.ok(Date.now() < end, `gave up waiting for ${what}`); await sleep(300); }
}

function hold(dir: string): Promise<{ child: ChildProcess; url: string; claim: string | null }> {
  const child = spawn(process.execPath, ["--experimental-strip-types", HOLDER, "--data-dir", dir], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: process.env });
  return new Promise((resolve, reject) => {
    let buf = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`daemon did not listen\n${buf}\n${err}`)); }, 60_000);
    child.stdout?.on("data", (c: Buffer) => {
      buf += c.toString();
      const url = /listening (http\S+)/.exec(buf)?.[1];
      if (!url) return;
      // the claim line follows the listening line on a first boot
      setTimeout(() => { clearTimeout(timer); resolve({ child, url, claim: /claim (\S+)/.exec(buf)?.[1] ?? null }); }, 300);
    });
    child.stderr?.on("data", (c: Buffer) => { err += c.toString(); });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`daemon exited ${code ?? "null"}\n${err.slice(-2000)}`)); });
  });
}
const gone = (c: ChildProcess): Promise<void> => new Promise((r) => { if (c.exitCode !== null || c.signalCode !== null) r(); else c.once("exit", () => r()); });

test("a clean daemon stop and start, and a SIGKILL and start, leave an agent's running command running: its counter keeps counting", { skip, timeout: 900_000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-restart-"));
  const saved = process.env["VYRE_WORKSPACE_IMAGE"];
  process.env["VYRE_WORKSPACE_IMAGE"] = process.env["VYRE_WORKSPACE_TEST_IMAGE"];
  let live: ChildProcess | null = null;
  let name = "";
  t.after(async () => {
    if (live) { live.kill("SIGKILL"); await gone(live); }
    if (saved === undefined) delete process.env["VYRE_WORKSPACE_IMAGE"]; else process.env["VYRE_WORKSPACE_IMAGE"] = saved;
    if (name !== "") { await docker(["rm", "-f", name]); await docker(["volume", "rm", "-f", `${name}-home`, `${name}-files`]); }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let d = await hold(dir);
  live = d.child;
  let url = d.url;
  const call = async (token: string | null, cap: string, input: unknown): Promise<{ status: number; data: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
    const body = (await r.json()) as { data?: unknown };
    return { status: r.status, data: body.data ?? body };
  };
  let keys = 0;
  const ok = async (token: string, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await call(token, cap, { idempotencyKey: `rs-${cap}-${++keys}`, ...input });
    assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
    return r.data;
  };
  assert.ok(d.claim, "a claim link on the first boot");
  const code = decodeURIComponent(new URL(d.claim).pathname.split("/").pop() ?? "");
  const device = { deviceName: "Dana's Mac", deviceClass: "desktop" };
  assert.equal((await call(null, "identity.claim_owner", { code, spaceId: "spc_keep", username: "dana", displayName: "Dana Reyes", password: PASSWORD, ...device, keys: KEYS })).status, 200);
  const signIn = async (): Promise<string> => ((await call(null, "identity.sign_in", { username: "dana", password: PASSWORD, ...device })).data.session as { token: string }).token;
  let token = await signIn();
  const unlock = async (): Promise<void> => { const r = await fetch(`${url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 7).toString("base64") }) }); assert.equal(r.status, 204); };
  await unlock();
  const folder = await ok(token, "vault.folders.create", { name: "Accounts", scope: "mine" });
  const flow = await ok(token, "providers.subscription_start", { providerKey: "claude-code" });
  await ok(token, "vault.item.put", { folderId: folder.folder.id, name: "Dana_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY, secret: true }] });
  await ok(token, "providers.subscription_complete", { flowId: flow.flowId });
  const agent = (await ok(token, "agents.create", { name: "Dex", role: "You help." })).agent.agentId as string;
  name = `vyre-ws-${agent}`;
  const threadId = (await ok(token, "chat.start", { kind: "chat", agentIds: [agent] })).thread.threadId as string;
  await ok(token, "threads.set_mode", { threadId, mode: "auto" });
  const post = (command: string, key: string) => ok(token, "chat.post", { threadId, body: `TOOL terminal_run ${JSON.stringify({ command, idempotencyKey: key })}`, mentions: [{ kind: "agent", id: agent }] });
  const count = async (): Promise<number> => Number((await docker(["exec", name, "sh", "-c", "cat /tmp/vyre-count 2>/dev/null || echo 0"])).out.trim().split("\n")[0] || 0);
  const counting = async (what: string): Promise<void> => { const a = await count(); await sleep(3000); const b = await count(); console.log(`RESTART ${what}: ${a} then ${b}`); assert.ok(b > a, `${what}: the command still runs (${a} then ${b})`); };

  // the first command's answer, not only its container: a second message while that turn still runs is steering (injected into it), and the stand-in model, like a model that
  // has already chosen its next step, does not act on it. On a cold CI runner the first turn outlived "container exists + 2 s", so the loop was never run (12 Nov, heavy-live).
  const answers = async (): Promise<number> => (((await call(token, "chat.messages.list", { threadId })).data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined) ?? []).filter((m) => m.author?.kind === "agent" && /TOOL RESULT/.test(m.body ?? "")).length;
  const t0 = Date.now();
  await post("echo ready", "rs-ready");
  await until("the workspace", 120_000, async () => ((await docker(["inspect", name])).code === 0 ? true : null));
  const made = Date.now() - t0;
  await until("the first command's answer", 120_000, async () => ((await answers()) >= 1 ? true : null));
  console.log(`RESTART first command: container after ${made} ms, answer after ${Date.now() - t0} ms`);
  await post("i=0; while true; do i=$((i+1)); echo $i > /tmp/vyre-count; sleep 1; done", "rs-loop");
  await until("the counter", 60_000, async () => ((await count()) >= 2 ? true : null));

  // a clean stop, as an update does it
  d.child.kill("SIGTERM");
  await gone(d.child);
  await counting("while the daemon is stopped");
  d = await hold(dir); live = d.child; url = d.url;
  token = await signIn(); await unlock();
  await sleep(4000);
  await counting("after a clean stop and start");

  // a crash
  d.child.kill("SIGKILL");
  await gone(d.child);
  await counting("after a SIGKILL");
  d = await hold(dir); live = d.child; url = d.url;
  await sleep(4000);
  await counting("after a SIGKILL and start");
  await docker(["exec", name, "sh", "-c", "pkill -f 'vyre-count' || true"]);
});
