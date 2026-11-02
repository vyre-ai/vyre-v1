// A Codex sign-in the CLI refreshes during a turn is kept (owner, rc.13: "You should never lose credentials if they're in here. They're as secure as they are in one password."). On a booted daemon
// with the real engine, the real CLI driver, the real sandbox and the real Vault, the person signs in to ChatGPT (the provider's endpoints stubbed on the network seam) and chats with an agent on that
// account. The CLI is a stand-in (host/tests/fixtures/fake-cli-driver/fake-signin-cli.mjs) that, like the real one, rewrites its auth.json when it refreshes its token. The second turn must start with the
// refreshed token, the Vault item's history must say the sign-in was refreshed, a turn still running when the daemon stops must have its refresh saved before the databases close, and no token may be in
// an answer, a log line or a row in the clear.
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

test("a Codex sign-in the CLI refreshes during a turn is saved back: the next turn starts with the refreshed token, the Vault item's history says so, and a turn the daemon's stop ends is saved too", { timeout: 150_000 }, async () => {
  const said: string[] = [];
  let approved = false;
  const seamFetch: SeamFetch = async (url) => {
    const reply = (status: number, json: unknown) => ({ status, text: async () => JSON.stringify(json), arrayBuffer: async () => new ArrayBuffer(0) });
    if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") return reply(200, { device_auth_id: "dev_refresh", user_code: "LIVE-5678", interval: "2" });
    if (url === "https://auth.openai.com/api/accounts/deviceauth/token") return approved ? reply(200, { authorization_code: "AC-refresh", code_challenge: "c", code_verifier: "V-refresh" }) : reply(403, { error: "pending" });
    if (url === "https://auth.openai.com/oauth/token") return reply(200, { id_token: ID_TOKEN, access_token: ACCESS, refresh_token: REFRESH });
    return reply(404, {});
  };
  const dir = seededDir();
  const d: Daemon = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "signin-refresh", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch,
    seams: { fetch: seamFetch },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    engineCli: { command: { codex: [process.execPath, SIGNIN_CLI, "codex"] }, programRead: [path.dirname(SIGNIN_CLI)] } as never,
  });
  const call = async (cap: string, input: unknown): Promise<{ status: number; data: Any }> => {
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input), signal: AbortSignal.timeout(20_000) });
    const text = await r.text();
    said.push(text);
    const body = JSON.parse(text) as { data?: unknown };
    return { status: r.status, data: body.data ?? body };
  };
  const ok = async (cap: string, input: unknown): Promise<Any> => { const r = await call(cap, input); assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`); return r.data; };
  const log = (all = true): string => { d.sink.flush(); return JSON.stringify(new DatabaseSync(d.paths.logs, { readOnly: true }).prepare(`SELECT level, place, msg, attrs FROM logs ${all ? "" : "WHERE level >= 20 AND msg != 'invoke' "}ORDER BY id DESC LIMIT 400`).all()); };
  const until = async <T>(f: () => Promise<T | null>, why: () => string, ms = 40_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      await d.hooks?.pump?.();
      const v = await f();
      if (v !== null) return v;
      if (Date.now() > end) throw new Error(why());
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  try {
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 5).toString("base64") }) });
    assert.equal(unlock.status, 204);

    // ---- sign in to ChatGPT through Codex's device sign-in
    const started = await ok("providers.subscription_start", { providerKey: "codex", idempotencyKey: "sr-codex" });
    approved = true;
    await new Promise((r) => setTimeout(r, 2_200));
    const provider = (await ok("providers.subscription_complete", { flowId: started.flowId })).provider;
    assert.deepEqual([provider.providerKey, provider.scope, provider.state], ["codex", "mine", "ok"]);
    const item = ((await ok("vault.items.list", {})).items as Any[]).find((i) => i.kind === "ai_subscription")!;

    // ---- a chat on that account
    const agentId = (await ok("agents.create", { name: "Coder", role: "You write code.", idempotencyKey: "sr-agent" })).agent.agentId as string;
    const threadId = (await ok("chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "sr-chat" })).thread.threadId as string;
    await ok("providers.set_space_use", { idempotencyKey: "sr-space", providerId: provider.id, allow: true });
    await ok("threads.agent.configure", { threadId, agentId, model: "gpt-5-codex", provider: "openai", accountRef: item.handle });
    let n = 0;
    const ask = async (body: string): Promise<string> => {
      const before = ((await ok("chat.messages.list", { threadId })).messages as Any[]).length;
      await ok("chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `sr-post-${++n}` });
      let seen: unknown = null;
      return until(async () => {
        const all = ((await ok("chat.messages.list", { threadId })).messages as Any[]).slice(before);
        seen = all.map((x) => ({ author: x.author, body: String(x.body ?? "").slice(0, 200), blocks: (x.blocks ?? []).map((b: Any) => b.type) }));
        const m = all.find((x) => x.author?.kind === "agent" && (x.body ?? "") !== "");
        return m ? String(m.body) : null;
      }, () => `no reply to "${body.slice(0, 20)}": ${JSON.stringify(seen)} ${log(false).slice(0, 4000)}`);
    };
    const refreshedLine = async (): Promise<Any[]> => ((await ok("vault.item.history", { itemId: item.id })).entries as Any[]).filter((e) => e.detail === "Codex refreshed its sign-in");

    // ---- turn 1: the CLI starts on the signed-in token and refreshes it
    assert.match(await ask("authcheck"), new RegExp(`codex signed in as ${digest(ACCESS)} mode 600`), "the first turn runs on the sign-in");
    assert.deepEqual(await refreshedLine(), [], "a turn that changes nothing saves nothing");
    assert.match(await ask("authrefresh r1"), new RegExp(`codex refreshed to ${digest(NEW)}`));
    const lines = await until(async () => { const l = await refreshedLine(); return l.length > 0 ? l : null; }, () => `no refresh in the item's history: ${log(false).slice(0, 4000)}`);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].field, "credentials");

    // ---- turn 2: starts with the refreshed token, from the same handle and the same row
    assert.match(await ask("authcheck"), new RegExp(`codex signed in as ${digest(NEW)} mode 600`), "the next turn starts with the refreshed token");
    const rows = ((await ok("providers.list", {})).providers as Any[]).filter((p) => p.providerKey === "codex");
    assert.deepEqual(rows.map((p) => [p.id, p.handle, p.state]), [[provider.id, item.handle, "ok"]], "one row, the same handle, still working");
    assert.equal((await refreshedLine()).length, 1, "a turn that only reads its sign-in saves nothing more");

    // ---- a turn still running when the daemon stops: its CLI refreshed, the stop ends it, and the refresh is saved before the databases close
    const authFile = (): string | null => fs.readdirSync(dir, { recursive: true }).map(String).find((p) => p.endsWith(path.join(".codex", "auth.json"))) ?? null;
    const before = Number((new DatabaseSync(path.join(dir, "modules.db"), { readOnly: true }).prepare(`SELECT "rev" FROM vault_secret WHERE "itemId" = ?`).get(item.id) as Any).rev);
    await ok("chat.post", { threadId, body: "authhang r2", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "sr-post-hang" });
    await until(async () => {
      const f = authFile();
      if (f === null) return null;
      try { return (JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Any).tokens.access_token === `${NEW}-r2` ? true : null; } catch { return null; }
    }, () => `the hanging turn never refreshed: ${log(false).slice(0, 3000)}`);
    const logs = log();
    await d.stop();
    const after = new DatabaseSync(path.join(dir, "modules.db"), { readOnly: true });
    const saved = after.prepare(`SELECT "detail" FROM vault_history WHERE "itemId" = ? AND "detail" = ?`).all(item.id, "Codex refreshed its sign-in") as Any[];
    const rev = Number((after.prepare(`SELECT "rev" FROM vault_secret WHERE "itemId" = ?`).get(item.id) as Any).rev);
    after.close();
    const afterLog = (): string => JSON.stringify(new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, msg, attrs FROM logs WHERE msg LIKE '%sign-in%' OR msg LIKE '%signin%' OR place = 'engine' OR level >= 40 ORDER BY id DESC LIMIT 60").all());
    assert.equal(saved.length, 2, `the refresh of the turn the stop ended is in the item's history: ${afterLog().slice(0, 4000)}`);
    assert.equal(rev, before + 1, "and its sealed value was written once more");
    assert.equal(authFile(), null, "the stopped turn's files are gone too");

    // ---- no token in the clear anywhere a person, a log or a row could show it
    const db = new DatabaseSync(path.join(dir, "modules.db"), { readOnly: true });
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Any[]).map((t) => String(t.name));
    const dump = tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all())).join("\n");
    db.close();
    for (const secret of [ACCESS, REFRESH, NEW, `rt-${NEW}`, `${NEW}-r2`]) {
      assert.equal(said.join("\n").includes(secret), false, "no answer carried a token");
      assert.equal(logs.includes(secret), false, "no log line carried a token");
      assert.equal(dump.includes(secret), false, "no module row holds a token in the clear");
    }
  } finally { await d.stop().catch(() => undefined); fs.rmSync(dir, { recursive: true, force: true }); }
});
