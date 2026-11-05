// Model "Auto" on Codex (a ChatGPT sign-in, running on this computer), the case of a real fresh install (5 Nov 2026: the first "hello" came back as the vendor's `model` must be a non-empty string).
// On a booted daemon with the real engine, the real CLI driver and the real Vault, the person signs in to ChatGPT (the endpoints stubbed) and chats with an agent whose model is left on Auto. The CLI is a
// stand-in (fake-signin-cli.mjs) that answers "authargv" with the command line it was started with: it must carry no model flag at all, so Codex uses its own default; then a model picked in the chat is passed
// exactly once.
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootCore } from "../fixtures/seed/core/index.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { SeamFetch } from "../host/src/seams/ports.ts";

type Any = any;   // eslint-disable-line @typescript-eslint/no-explicit-any
const SIGNIN_CLI = fileURLToPath(new URL("../host/tests/fixtures/fake-cli-driver/fake-signin-cli.mjs", import.meta.url));
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const ACCESS = "codex-access-SIGNEDIN-0123456789abcdef"; // secret-scan: fake
const REFRESH = "codex-refresh-SIGNEDIN-0123456789abcdef"; // secret-scan: fake
/** What the stand-in refreshes the access token to on "authrefresh r1": the old one with the tag after it, so no token is ever typed into the chat. */
const NEW = `${ACCESS}-r1`;
const jwt = (claims: Record<string, unknown>): string => `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const ID_TOKEN = jwt({ email: "dana@example.com", sub: "auth0|dana", "https://api.openai.com/auth": { chatgpt_account_id: "acct-dana", chatgpt_user_id: "user-dana" } });
const digest = (t: string): string => `${t.length}:${t.slice(-4)}`;

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-signin-refresh-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}


test("Codex on Auto is started with no model flag at all; a model picked in the chat is passed once", { timeout: 150_000 }, async () => {
  let approved = false;
  const seamFetch: SeamFetch = async (url) => {
    const reply = (status: number, json: unknown) => ({ status, text: async () => JSON.stringify(json), arrayBuffer: async () => new ArrayBuffer(0) });
    if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") return reply(200, { device_auth_id: "dev_auto", user_code: "LIVE-9012", interval: "2" });
    if (url === "https://auth.openai.com/api/accounts/deviceauth/token") return approved ? reply(200, { authorization_code: "AC-auto", code_challenge: "c", code_verifier: "V-auto" }) : reply(403, { error: "pending" });
    if (url === "https://auth.openai.com/oauth/token") return reply(200, { id_token: ID_TOKEN, access_token: ACCESS, refresh_token: REFRESH });
    return reply(404, {});
  };
  const dir = seededDir();
  const d: Daemon = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "auto-model", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch,
    seams: { fetch: seamFetch },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    engineCli: { command: { codex: [process.execPath, SIGNIN_CLI, "codex"] }, programRead: [path.dirname(SIGNIN_CLI)] } as never,
  });
  const ok = async (cap: string, input: unknown): Promise<Any> => {
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input), signal: AbortSignal.timeout(20_000) });
    const body = (await r.json()) as { data?: unknown };
    assert.equal(r.status, 200, `${cap}: ${JSON.stringify(body)}`);
    return body.data ?? body;
  };
  const log = (): string => { d.sink.flush(); return JSON.stringify(new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, msg, attrs FROM logs WHERE level >= 20 AND msg != 'invoke' ORDER BY id DESC LIMIT 12").all()); };
  const until = async <T>(f: () => Promise<T | null>, why: () => string, ms = 40_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) { await d.hooks?.pump?.(); const v = await f(); if (v !== null) return v; if (Date.now() > end) throw new Error(why()); await new Promise((r) => setTimeout(r, 250)); }
  };
  try {
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 5).toString("base64") }) });
    assert.equal(unlock.status, 204);
    const started = await ok("providers.subscription_start", { providerKey: "codex", idempotencyKey: "am-codex" });
    approved = true;
    await new Promise((r) => setTimeout(r, 2_200));
    const provider = (await ok("providers.subscription_complete", { flowId: started.flowId })).provider;
    const item = ((await ok("vault.items.list", {})).items as Any[]).find((i) => i.kind === "ai_subscription")!;
    const agentId = (await ok("agents.create", { name: "Coder", role: "You write code.", idempotencyKey: "am-agent" })).agent.agentId as string;
    const threadId = (await ok("chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "am-chat" })).thread.threadId as string;
    await ok("providers.set_space_use", { idempotencyKey: "am-space", providerId: provider.id, allow: true });
    await ok("settings.set_space", { key: "memory.learn_daily_passes", value: 0 });
    // the chat is on this account; its model is left on Auto
    await ok("threads.agent.configure", { threadId, agentId, accountRef: item.handle });
    let n = 0;
    const ask = async (body: string): Promise<string> => {
      const before = ((await ok("chat.messages.list", { threadId })).messages as Any[]).length;
      await ok("chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `am-post-${++n}` });
      let seen: unknown = null; let turnsNow: unknown = null;
      return until(async () => {
        const all = ((await ok("chat.messages.list", { threadId })).messages as Any[]).slice(before);
        turnsNow = ((await ok("engine.turns.list", { threadId })).turns as Any[]).map((t) => [t.state, t.model, t.error?.code, t.error?.message]);
        seen = all.map((x) => ({ author: x.author?.kind, body: String(x.body ?? "").slice(0, 120), blocks: (x.blocks ?? []).map((b: Any) => `${b.type}:${JSON.stringify(b.data).slice(0, 200)}`) }));
        const m = all.find((x) => x.author?.kind === "agent" && (x.body ?? "") !== "");
        return m ? String(m.body) : null;
      }, () => `turns=${JSON.stringify(turnsNow)} no reply to "${body}": ${JSON.stringify(seen)} ${log().slice(0, 3000)}`);
    };
    const flagOf = (reply: string): { name: string | null; given: number } => { const m = /^model-flag (none|"[^"]*") models-given (\d+)$/.exec(reply.trim()); assert.ok(m, `the stand-in said: ${reply}`); return { name: m[1] === "none" ? null : (JSON.parse(m[1]!) as string), given: Number(m[2]) }; };
    console.error("DBGCHECK", await ask("authcheck"));
    assert.deepEqual(flagOf(await ask("authargv")), { name: null, given: 0 }, "Auto passes no model flag at all");
    // a model picked in the chat is passed, once, exactly
    await ok("threads.agent.configure", { threadId, agentId, model: "gpt-5-codex", provider: "openai", accountRef: item.handle });
    assert.deepEqual(flagOf(await ask("authargv")), { name: "gpt-5-codex", given: 1 }, "the picked model, once");
    // and back to Auto: no flag again
    await ok("threads.agent.configure", { threadId, agentId, model: "auto", accountRef: item.handle });
    assert.deepEqual(flagOf(await ask("authargv")), { name: null, given: 0 }, "the word Auto is never passed as a model name");
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
