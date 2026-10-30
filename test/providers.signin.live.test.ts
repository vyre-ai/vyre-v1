// Direct sign-in on a booted daemon (owner ruling, rc.4): the person presses Sign in, the server starts the provider's own sign-in and answers its link, the code is pasted back (or the person approves), and the
// token lands in their own Mine Vault as an ai_subscription item. Nothing is faked inside the daemon but the provider's endpoints (a stub on the injected network seam), the model stand-in and the sink the
// engine would fill the token into. The token is searched for in every answer, log line and stored row; a chat turn then runs on that account and the engine's fill gets the token.
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultPrompt } from "../agent/src/drivers/cli/prompt.ts";
import type { DriverEvent, EngineSession, OpenSession, SessionSpec, TurnInput } from "../agent/src/turn-engine/types.ts";
import { bootCore } from "../fixtures/seed/core/index.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { SeamFetch } from "../host/src/seams/ports.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const TOKEN = "sk-ant-oat01-LIVEdirectLOGINtoken0123456789abcdefXYZ"; // secret-scan: fake
const CODEX_ACCESS = "codex-access-LIVE-0123456789"; // secret-scan: fake

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-signin-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

async function call(d: Daemon, cap: string, input: unknown, bag: string[]): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input), signal: AbortSignal.timeout(20_000) });
  const text = await r.text();
  bag.push(text);
  const body = JSON.parse(text) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

test("Sign in with Claude and ChatGPT on a booted daemon: the link, the pasted code, the approval, the token in the Mine Vault, and a chat turn on it", async () => {
  const said: string[] = [];
  const hits: { url: string; body: string }[] = [];
  let approved = false;
  let sentState = "";
  // the providers' endpoints
  const seamFetch: SeamFetch = async (url, init) => {
    const body = String(init?.body ?? "");
    hits.push({ url, body });
    const reply = (status: number, json: unknown) => ({ status, text: async () => JSON.stringify(json), arrayBuffer: async () => new ArrayBuffer(0) });
    if (url === "https://platform.claude.com/v1/oauth/token") {
      const b = JSON.parse(body) as { code: string; state: string; code_verifier: string };
      return b.code === "GOODCODE12345" && b.state === sentState && b.code_verifier.length >= 32 ? reply(200, { access_token: TOKEN, expires_in: 31536000 }) : reply(400, { error: "invalid_grant" });
    }
    if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") return reply(200, { device_auth_id: "dev_live", user_code: "LIVE-1234", interval: "2" });
    if (url === "https://auth.openai.com/api/accounts/deviceauth/token") return approved ? reply(200, { authorization_code: "AC-live", code_challenge: "c", code_verifier: "V-live" }) : reply(403, { error: "pending" });
    if (url === "https://auth.openai.com/oauth/token") return reply(200, { id_token: "a.b.c", access_token: CODEX_ACCESS, refresh_token: "rt-live" });
    return reply(404, {});
  };
  let filled = "";
  const specs: SessionSpec[] = [];
  const standIn: OpenSession = async (spec) => {
    specs.push(spec);
    return { warm: true, async *send(input: TurnInput): AsyncGenerator<DriverEvent> { yield { type: "text", text: `Ran on ${spec.account?.provider ?? "no account"} ${spec.account?.ref ?? ""} ${spec.account?.kind ?? ""} ${defaultPrompt(input, true).slice(0, 0)}` }; yield { type: "done" }; }, sendToolResult() {}, inject() {}, async cancel() {}, async close() {} } as EngineSession;
  };
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "signin-live", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch,
    seams: { fetch: seamFetch, vaultSinks: { env: (f: { value: string }) => { filled = f.value; } } },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    engineOpenSession: standIn,
  });
  const ok = async (cap: string, input: unknown): Promise<any> => { const r = await call(d, cap, input, said); assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`); return r.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204);

    // ---- Claude: the link, then the code the page shows
    const started = await ok("providers.subscription_start", { providerKey: "claude-code", idempotencyKey: "si-claude" });
    assert.equal(started.needsCode, true);
    const link = new URL(started.url);
    assert.equal(link.origin + link.pathname, "https://claude.ai/oauth/authorize");
    sentState = link.searchParams.get("state")!;
    assert.deepEqual(await ok("providers.subscription_complete", { flowId: started.flowId }), { waiting: true });
    const wrong = await call(d, "providers.subscription_complete", { flowId: started.flowId, code: `NOPE123456#${sentState}` }, said);
    assert.equal(wrong.status, 502, JSON.stringify(wrong.data));
    assert.match(JSON.stringify(wrong.data), /did not accept that code/);
    const again = await ok("providers.subscription_start", { providerKey: "claude-code", idempotencyKey: "si-claude-2" });
    sentState = new URL(again.url).searchParams.get("state")!;
    const claude = (await ok("providers.subscription_complete", { flowId: again.flowId, code: `GOODCODE12345#${sentState}` })).provider;
    assert.deepEqual([claude.providerKey, claude.connection, claude.scope, claude.state], ["claude-code", "subscription", "mine", "ok"]);

    // ---- ChatGPT: the code to type, polling until the person approves
    const codex = await ok("providers.subscription_start", { providerKey: "codex", idempotencyKey: "si-codex" });
    assert.deepEqual([codex.url, codex.userCode, codex.needsCode], ["https://auth.openai.com/codex/device", "LIVE-1234", false]);
    assert.deepEqual(await ok("providers.subscription_complete", { flowId: codex.flowId }), { waiting: true });
    approved = true;
    await new Promise((r) => setTimeout(r, 2_200));
    const chatgpt = (await ok("providers.subscription_complete", { flowId: codex.flowId })).provider;
    assert.deepEqual([chatgpt.providerKey, chatgpt.scope], ["codex", "mine"]);

    // ---- the token is in the person's own Mine folder as an ai_subscription item, and nowhere else
    const listed = (await ok("vault.items.list", {})).items as { id: string; handle: string; kind: string; scope: string; name: string }[];
    const items = listed.filter((i) => i.kind === "ai_subscription");
    assert.deepEqual(items.map((i) => [i.name, i.scope]).sort(), [["Claude Code", "mine"], ["Codex", "mine"]]);
    d.sink.flush();
    const logs = JSON.stringify(new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT msg, attrs FROM logs").all());
    for (const secret of [TOKEN, CODEX_ACCESS]) {
      assert.equal(said.join("\n").includes(secret), false, "no answer to the person carried it");
      assert.equal(logs.includes(secret), false, "no log line carried it");
    }
    const rows = new DatabaseSync(path.join(dir, "modules.db"), { readOnly: true });
    for (const t of ["vault_meta", "vault_item_x", "vault_provider", "vault_provider_flow"]) assert.equal(JSON.stringify(rows.prepare(`SELECT * FROM ${t}`).all()).includes(TOKEN), false, `${t} holds no plain token`);
    rows.close();

    // ---- a chat turn runs on the account, and the engine's fill gets the token (and only the engine's fill does)
    await ok("providers.set_space_use", { idempotencyKey: "si-space", providerId: claude.id, allow: true });
    const agentId = (await ok("agents.create", { name: "Intake", role: "You answer.", idempotencyKey: "si-agent" })).agent.agentId as string;
    const thread = (await ok("chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "si-chat" })).thread.threadId as string;
    await ok("engine.pool.status", {});
    await ok("chat.post", { threadId: thread, body: "hello", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "si-post" });
    const deadline = Date.now() + 40_000;
    let reply = "";
    while (Date.now() < deadline && reply === "") {
      await d.hooks?.pump?.();
      const m = ((await ok("chat.messages.list", { threadId: thread })).messages as { author?: { kind?: string }; body?: string }[]).find((x) => x.author?.kind === "agent" && (x.body ?? "") !== "");
      reply = m?.body ?? "";
      if (reply === "") await new Promise((r) => setTimeout(r, 200));
    }
    assert.match(reply, /Ran on anthropic #Claude_Code subscription/, `the turn ran on the account that was just signed in: ${reply}`);
    assert.equal(specs.length >= 1, true);
    const claudeItem = items.find((i) => i.name === "Claude Code")!;
    await ok("vault.fill", { handle: `${claudeItem.handle}.setup_token`, target: { kind: "env", ref: "CLAUDE_CODE_OAUTH_TOKEN" } });
    assert.equal(filled, TOKEN, "the engine's fill hands the token to the process, which no answer did");
    assert.equal(said.join("\n").includes(TOKEN), false);
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
