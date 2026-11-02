// One sign-in, one account, through updates (owner, rc.13: "every time I updated, it loses my credentials"). On a booted daemon with the provider's sign-in stubbed on the network seam:
//   1. signing in to Claude twice with the same account leaves one row, the same handle, named by the account, holding the newest token;
//   2. the daemon is stopped and started again from another app path and version (an update), the app hands the same Vault key back, and a chat turn runs on that sign-in with no new sign-in;
//   3. four rows of that account (as earlier releases saved them) are folded into one when the daemon starts, and a chat pinned to one of the folded handles runs on the row that kept the account.
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DriverEvent, EngineSession, OpenSession, SessionSpec } from "../agent/src/turn-engine/types.ts";
import { bootCore } from "../fixtures/seed/core/index.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { SeamFetch } from "../host/src/seams/ports.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const TOKENS = ["sk-ant-oat01-ONCEfirstTOKEN0123456789abcdef", "sk-ant-oat01-ONCEsecondTOKEN0123456789abcdef"]; // secret-scan: fake
const OLDER = ["sk-ant-oat01-ONCEcopyA0123456789abcdef", "sk-ant-oat01-ONCEcopyB0123456789abcdef", "sk-ant-oat01-ONCEcopyC0123456789abcdef"]; // secret-scan: fake
const KEY = Buffer.alloc(32, 9).toString("base64");   // the person's Vault key, which the app hands over after every start

type Any = any;   // eslint-disable-line @typescript-eslint/no-explicit-any

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-signin-once-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

test("one Claude sign-in stays one account: signed in twice, through an update from another app path, and four old copies folded into it at start", async () => {
  let n = 0;
  const tokenHits: string[] = [];
  let sentState = "";
  const seamFetch: SeamFetch = async (url, init) => {
    const reply = (status: number, json: unknown) => ({ status, text: async () => JSON.stringify(json), arrayBuffer: async () => new ArrayBuffer(0) });
    if (url === "https://platform.claude.com/v1/oauth/token") {
      tokenHits.push(url);
      const b = JSON.parse(String(init?.body ?? "{}")) as { state: string };
      if (b.state !== sentState) return reply(400, { error: "invalid_grant" });
      return reply(200, { access_token: TOKENS[n++], expires_in: 31536000, account: { uuid: "acc-dana", email_address: "dana@example.com" }, organization: { uuid: "org-dana", name: "Dana" } });
    }
    return reply(404, {});
  };
  let filled = "";
  const specs: SessionSpec[] = [];
  const standIn: OpenSession = async (spec) => {
    specs.push(spec);
    return { warm: true, async *send(): AsyncGenerator<DriverEvent> { yield { type: "text", text: `Ran on ${spec.account?.ref ?? "no account"} ${spec.account?.kind ?? ""}` }; yield { type: "done" }; }, sendToolResult() {}, inject() {}, async cancel() {}, async close() {} } as EngineSession;
  };
  const dir = seededDir();
  const apps = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-apps-"));
  const boot = (version: string, codeRoot: string): Promise<Daemon> => startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, version), codeRoot,
    platform: fakePlatform({ os: "linux", hostname: "signin-once", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch,
    seams: { fetch: seamFetch, vaultSinks: { env: (f: { value: string }) => { filled = f.value; } } },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    engineOpenSession: standIn,
  });
  const api = (d: Daemon) => {
    const ok = async (cap: string, input: unknown): Promise<Any> => {
      const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input), signal: AbortSignal.timeout(20_000) });
      const body = JSON.parse(await r.text()) as { data?: unknown };
      assert.equal(r.status, 200, `${cap}: ${JSON.stringify(body)}`);
      return body.data;
    };
    const unlock = async (): Promise<void> => {
      const r = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: KEY }) });
      assert.equal(r.status, 204);
    };
    const claudeRows = async (): Promise<Any[]> => ((await ok("providers.list", {})).providers as Any[]).filter((p) => p.providerKey === "claude-code");
    const ask = async (threadId: string, agentId: string, body: string, key: string): Promise<string> => {
      const before = ((await ok("chat.messages.list", { threadId })).messages as Any[]).length;
      await ok("chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: key });
      const deadline = Date.now() + 40_000;
      while (Date.now() < deadline) {
        await d.hooks?.pump?.();
        const m = ((await ok("chat.messages.list", { threadId })).messages as Any[]).slice(before).find((x) => x.author?.kind === "agent" && (x.body ?? "") !== "");
        if (m) return String(m.body);
        await new Promise((r) => setTimeout(r, 200));
      }
      return "";
    };
    return { ok, unlock, claudeRows, ask };
  };
  const signIn = async (a: ReturnType<typeof api>, key: string): Promise<Any> => {
    const started = await a.ok("providers.subscription_start", { providerKey: "claude-code", idempotencyKey: key });
    sentState = new URL(started.url).searchParams.get("state")!;
    return (await a.ok("providers.subscription_complete", { flowId: started.flowId, code: `GOODCODE12345#${sentState}` })).provider;
  };

  let d = await boot("1.2.3", CODE_ROOT);
  let threadId = "", agentId = "";
  try {
    // ---- 1. two sign-ins to the same account: one row
    let a = api(d);
    await a.unlock();
    const first = await signIn(a, "once-1");
    const second = await signIn(a, "once-2");
    assert.deepEqual([second.id, second.handle], [first.id, first.handle], "the second sign-in refreshed the first row");
    const rows = await a.claudeRows();
    assert.equal(rows.length, 1, "one Claude row");
    assert.deepEqual([rows[0].handle, rows[0].displayName, rows[0].identity], ["#Claude_Code", "Claude Code, dana@example.com", "dana@example.com"]);
    await a.ok("providers.set_space_use", { idempotencyKey: "once-space", providerId: first.id, allow: true });
    agentId = (await a.ok("agents.create", { name: "Intake", role: "You answer.", idempotencyKey: "once-agent" })).agent.agentId as string;
    threadId = (await a.ok("chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "once-chat" })).thread.threadId as string;
    await a.ok("engine.pool.status", {});
    assert.match(await a.ask(threadId, agentId, "hello", "once-post-1"), /Ran on #Claude_Code subscription/);
    await a.ok("vault.fill", { handle: "#Claude_Code.setup_token", target: { kind: "env", ref: "CLAUDE_CODE_OAUTH_TOKEN" } });
    assert.equal(filled, TOKENS[1], "the row holds the newest sign-in");
    // three more copies of this account, saved the way earlier releases did (a new item each time); their rows are added while the daemon is down
    const folder = ((await a.ok("vault.folders.list", {})).folders as Any[]).find((f) => f.name === "AI providers").id as string;
    const copies: { id: string; handle: string }[] = [];
    for (const [i, value] of OLDER.entries()) {
      const item = (await a.ok("vault.item.put", { folderId: folder, name: `Claude Code ${i + 2}`, kind: "ai_subscription", fields: [{ key: "setup_token", value, secret: true }], idempotencyKey: `once-copy-${i}` })).item;
      copies.push({ id: item.id, handle: item.handle });
    }
    assert.deepEqual(copies.map((c) => c.handle), ["#Claude_Code_2", "#Claude_Code_3", "#Claude_Code_4"]);
    await d.stop();

    // ---- 2. an update: another app path, another version, the same data folder; the app hands the same key back
    const appRoot = path.join(apps, "Vyre 1.2.4.app", "Contents", "Resources");
    fs.mkdirSync(appRoot, { recursive: true });
    fs.symlinkSync(CODE_ROOT, path.join(appRoot, "app"));
    const hitsBefore = tokenHits.length;
    d = await boot("1.2.4", path.join(appRoot, "app"));
    a = api(d);
    await a.unlock();
    const after = await a.claudeRows();
    assert.deepEqual(after.map((p) => [p.id, p.handle, p.state]), [[first.id, "#Claude_Code", "ok"]], "the sign-in is there, working, after the update");
    assert.match(await a.ask(threadId, agentId, "still there?", "once-post-2"), /Ran on #Claude_Code subscription/, "the turn ran on it with no new sign-in");
    assert.equal(tokenHits.length, hitsBefore, "nothing asked the provider to sign in again");
    await d.stop();

    // the copies' rows, as an earlier release left them: the same account, a chat pinned to the newest copy
    const db = new DatabaseSync(path.join(dir, "modules.db"));
    const owner = String((db.prepare(`SELECT "owner" FROM vault_provider WHERE id = ?`).get(first.id) as Any).owner);
    const identity = db.prepare(`SELECT * FROM vault_provider_identity WHERE "providerId" = ?`).get(first.id) as Any;
    assert.equal(identity.identity, "claude:acct:acc-dana/org:org-dana");
    const t0 = Date.now();
    copies.forEach((c, i) => {
      const id = `prv_oncecopy${i}`;
      db.prepare(`INSERT INTO vault_provider ("id", "providerKey", "connection", "scope", "owner", "itemId", "spaceMayUse", "state", "createdAt", "deleted_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, "claude-code", "subscription", "mine", owner, c.id, 1, "ok", t0 + i, null);
      db.prepare(`INSERT INTO vault_provider_identity ("providerId", "identity", "label", "at") VALUES (?, ?, ?, ?)`).run(id, identity.identity, identity.label, t0);
    });
    db.prepare(`UPDATE chat_thread_agent SET "accountRef" = ? WHERE "thread" = ? AND "agentId" = ?`).run("#Claude_Code_4", threadId, agentId);
    db.close();

    // ---- 3. the next start folds them into the row that has the account
    d = await boot("1.2.4", path.join(appRoot, "app"));
    a = api(d);
    await a.unlock();
    let folded: Any[] = [];
    const until = Date.now() + 15_000;
    while (Date.now() < until) { folded = await a.claudeRows(); if (folded.length === 1) break; await new Promise((r) => setTimeout(r, 250)); }
    assert.deepEqual(folded.map((p) => [p.id, p.handle, p.itemName]), [[first.id, "#Claude_Code", "Claude Code, dana@example.com"]], "one row: the oldest id, handle and name");
    assert.deepEqual(folded[0].aliases, ["#Claude_Code_2", "#Claude_Code_3", "#Claude_Code_4"]);
    const listed = ((await a.ok("engine.accounts.list", {})).accounts as Any[]).filter((x) => x.driver === "claude_code");
    assert.deepEqual(listed.map((x) => [x.ref, x.name]), [["#Claude_Code", "Claude Code, dana@example.com"]], "one entry, named by its account");
    assert.match(await a.ask(threadId, agentId, "after the fold", "once-post-3"), /Ran on #Claude_Code subscription/, "the chat pinned to #Claude_Code_4 runs on the row that kept the account");
    await a.ok("vault.fill", { handle: "#Claude_Code.setup_token", target: { kind: "env", ref: "CLAUDE_CODE_OAUTH_TOKEN" } });
    assert.equal(filled, OLDER[2], "it holds the newest of the copies");
    const trash = new DatabaseSync(path.join(dir, "modules.db"), { readOnly: true });
    const gone = trash.prepare(`SELECT "id", "handle", "deleted_at" FROM vault_meta WHERE "kind" = ? AND "deleted_at" IS NOT NULL`).all("ai_subscription") as Any[];
    assert.equal(gone.length, 3, "the three older credentials are in the Trash, not erased");
    const history = trash.prepare(`SELECT "action", "detail" FROM vault_history WHERE "action" = ?`).all("deleted") as Any[];
    assert.equal(history.length, 3, "each with a line in its history");
    trash.close();
    assert.equal(specs.every((s) => s.account?.ref === "#Claude_Code"), true);
  } finally { await d.stop().catch(() => undefined); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(apps, { recursive: true, force: true }); }
});
