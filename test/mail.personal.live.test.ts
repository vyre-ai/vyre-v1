// A person's own Gmail and Outlook on a booted daemon with the real Vault, Space seal, mail, google and microsoft modules and host seams. Google and Microsoft themselves are stand-ins (token
// endpoint, Gmail and Graph). It proves what the sign-in promises:
//   - the Space has its OAuth client in a Vault item; a person signs in, and the Vault still holds only that item (no token in it, nothing to reveal or copy);
//   - the refresh token is on disk only sealed, and no answer or event carries it;
//   - the mailbox it makes is pulled (first the recent mail, then only what changed since) and a poll with the vault locked and nobody asking still gets an access token;
//   - mail.send_as sends through the person's own Gmail or Graph, and disconnecting the mailbox removes the account and the token.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../fixtures/seed/core/index.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const here = path.dirname(new URL(import.meta.url).pathname);
const fixture = (rel: string): unknown => JSON.parse(fs.readFileSync(path.join(here, "..", "modules", rel), "utf8")) as unknown;
const GOOGLE_REFRESH = "1//LIVE-SECRET-google-refresh-0001";
const MS_REFRESH = "M.R3_LIVE-SECRET-microsoft-refresh-0002";

interface Seen { method: string; url: string; auth?: string; form?: URLSearchParams; body?: string }
const reply = (status: number, body: unknown) => ({ status, headers: { get: () => null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

/** The token endpoint both providers share in this test: the code grant and the refresh grant. */
function tokenSeam(seen: Seen[], refreshToken: string) {
  let n = 0;
  return async (url: string, init: { method?: string; body?: string | Uint8Array } = {}) => {
    const u = new URL(url);
    const form = new URLSearchParams(typeof init.body === "string" ? init.body : "");
    seen.push({ method: init.method ?? "GET", url: `${u.hostname}${u.pathname}`, form });
    if (!/\/token$/.test(u.pathname)) return { status: 404, text: async () => "{}", arrayBuffer: async () => new ArrayBuffer(0) };
    const body = form.get("grant_type") === "authorization_code"
      ? { access_token: `at-${++n}`, refresh_token: refreshToken, expires_in: 3600, token_type: "Bearer" }
      : { access_token: `at-${++n}`, expires_in: 3600, token_type: "Bearer" };
    return { status: 200, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) };
  };
}

async function boot(extra: Record<string, unknown>): Promise<{ d: Daemon; dir: string }> {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-pmail-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "pmail-live", free: 80e9,
      commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    ...extra,
  });
  return { d, dir };
}

async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
let keys = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown> = {}): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `pmail-live-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

async function until<T>(f: () => Promise<T | null>, why: string): Promise<T> {
  const end = Date.now() + 30_000;
  for (;;) {
    const v = await f();
    if (v !== null) return v;
    if (Date.now() > end) throw new Error(`never happened: ${why}`);
    await new Promise<void>((r) => setTimeout(r, 150));
  }
}

function everything(dir: string): Buffer[] {
  const out: Buffer[] = [];
  const walk = (p: string): void => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) walk(f); else if (e.isFile() && fs.statSync(f).size < 200 * 1024 * 1024) out.push(fs.readFileSync(f));
    }
  };
  walk(dir);
  return out;
}

const unlock = async (d: Daemon): Promise<void> => {
  const r = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
  assert.equal(r.status, 204);
};
const lock = async (d: Daemon): Promise<void> => {
  const r = await fetch(`${d.url}/local/vault/key/lock`, { method: "POST", headers: { authorization: `Bearer ${d.token}` } });
  assert.ok(r.status === 204 || r.status === 200, `lock: ${r.status}`);
};
const count = async (d: Daemon, mailboxId: string): Promise<number> => ((await ok(d, "mail.message.list", { mailboxId })).messages as unknown[]).length;

async function vaultApp(d: Daemon, name: string, fields: Array<{ key: string; value: string; secret: boolean }>): Promise<void> {
  const folder = (await ok(d, "vault.folders.create", { name: "Apps", scope: "shared" })).folder.id as string;
  await ok(d, "vault.item.put", { folderId: folder, name, kind: "other", fields });
}

/** What no answer, listing, Vault item or file of the data directory may hold. */
async function assertSealed(d: Daemon, dir: string, secret: string, expectItems: string[]): Promise<void> {
  const items = (await ok(d, "vault.items.list", {})).items as { id: string; name: string }[];
  assert.deepEqual(items.map((i) => i.name), expectItems, "the Vault holds the app and nothing else");
  for (const i of items) assert.ok(!JSON.stringify((await ok(d, "vault.item.reveal", { itemId: i.id })).fields ?? {}).includes(secret), `${i.name} holds no token`);
  d.sink.flush();
  for (const bytes of everything(dir)) assert.equal(bytes.includes(Buffer.from(secret)), false, "the plaintext token is in no file");
}

test("personal mail live: a person's Gmail signs in with the Space's OAuth client, syncs incrementally with the vault locked, sends as them, and disconnecting removes the token", async () => {
  const seen: Seen[] = [];
  const ME = "olivia@gmail.test";
  const sent: unknown[] = [];
  let polled = false;
  const http = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    seen.push({ method, url: `${u.hostname}${u.pathname}`, ...(init.headers?.["authorization"] ? { auth: init.headers["authorization"] } : {}) });
    const p = u.pathname.replace("/gmail/v1/users/me", "");
    if (u.hostname === "oauth2.googleapis.com" && u.pathname === "/revoke") return reply(200, {});
    if (p === "/profile") return reply(200, { emailAddress: ME, messagesTotal: 3, threadsTotal: 3, historyId: polled ? "1010" : "1000" });
    if (p === "/messages" && method === "GET") return reply(200, fixture("google/fixtures/gmail/list-messages.json"));
    if (p === "/history") return reply(200, { history: [{ id: "1005", messages: [{ id: "m3", threadId: "t1" }], messagesAdded: [{ message: { id: "m3", threadId: "t1", labelIds: ["SENT"] } }] }], historyId: "1010" });
    if (p === "/messages/send") { sent.push(JSON.parse(init.body ?? "{}")); return reply(200, { id: "sent-1", threadId: "t9", labelIds: ["SENT"] }); }
    const one = /^\/messages\/(m\d)$/.exec(p);
    if (one) return reply(200, fixture(`google/fixtures/gmail/message-${one[1]}.json`));
    return reply(404, { error: { code: 404, errors: [{ reason: "notFound" }] } });
  };
  const { d, dir } = await boot({ http, seams: { fetch: tokenSeam(seen, GOOGLE_REFRESH) } });
  try {
    await unlock(d);
    await vaultApp(d, "Google_Sign_In", [{ key: "client_id", value: "live-client.apps.googleusercontent.com", secret: false }, { key: "client_secret", value: "live-client-secret", secret: true }]);
    const status0 = await ok(d, "google.user.app_status", {});
    assert.equal(status0.configured, false);
    assert.deepEqual(await ok(d, "google.user.app_set", { vaultItem: "#Google_Sign_In" }), { configured: true, clientId: "live-client.apps.googleusercontent.com" });

    const start = await ok(d, "google.user.start", { loginHint: ME });
    const auth = new URL(start.authUrl as string);
    assert.equal(auth.hostname, "accounts.google.com");
    assert.equal(auth.searchParams.get("client_id"), "live-client.apps.googleusercontent.com");
    assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
    assert.match(String(start.state), /^gos_/);
    const done = await ok(d, "google.user.complete", { state: start.state, code: "the-code" });
    assert.equal(done.email, ME);
    assert.match(String(done.accountId), /^gua_/);
    assert.ok(!JSON.stringify(done).includes(GOOGLE_REFRESH), "the answer never carries the token");
    const exchange = seen.find((s) => s.form?.get("grant_type") === "authorization_code")!;
    assert.deepEqual([exchange.form!.get("client_id"), exchange.form!.get("client_secret"), exchange.form!.get("code")], ["live-client.apps.googleusercontent.com", "live-client-secret", "the-code"]);
    assert.ok(exchange.form!.get("code_verifier"), "PKCE: the verifier goes with the code");

    // the mailbox is there, theirs, and the first pull lands the recent mail
    const boxes = (await ok(d, "mail.mailbox.list", { scope: "mine" })).mailboxes as { id: string; address: string; provider: string }[];
    const box = boxes.find((b) => b.address === ME)!;
    assert.equal(box.provider, "google");
    assert.equal(done.mailboxId, box.id);
    await until(async () => ((await count(d, box.id)) >= 2 ? true : null), "the first pull");
    assert.equal(await count(d, box.id), 2);

    await assertSealed(d, dir, GOOGLE_REFRESH, ["Google_Sign_In"]);

    // nobody has their vault open: the next pull still runs on the sealed token and fetches only what changed since
    await lock(d);
    polled = true;
    await ok(d, "mail.sync_now", { mailboxId: box.id });
    await until(async () => ((await count(d, box.id)) >= 3 ? true : null), "the incremental pull");
    const history = seen.find((s) => s.url === "gmail.googleapis.com/gmail/v1/users/me/history")!;
    assert.ok(history, "the second pull asked for history since the cursor, not the whole mailbox");
    assert.equal(seen.filter((s) => s.url.endsWith("/users/me/messages") && s.method === "GET").length, 1, "the recent mail was listed once");
    const refresh = seen.find((s) => s.form?.get("grant_type") === "refresh_token");
    assert.ok(refresh, "an access token was made from the sealed refresh token");
    assert.equal(refresh!.form!.get("refresh_token"), GOOGLE_REFRESH);
    assert.match(String(history.auth), /^Bearer at-\d+$/);

    // send as the person
    await unlock(d);
    const out = await ok(d, "mail.send_as", { mailboxId: box.id, to: [{ address: "pat@acme.test" }], subject: "Hello from me", text: "Hi Pat" });
    assert.ok(out.messageId);
    assert.equal(sent.length, 1);
    const raw = Buffer.from(String((sent[0] as { raw: string }).raw), "base64url").toString("utf8");
    assert.match(raw, /^From: .*olivia@gmail\.test/m);
    assert.match(raw, /^Subject: Hello from me/m);

    // disconnect: the account and the token are gone, Google was told
    await ok(d, "mail.mailbox.disconnect", { mailboxId: box.id });
    assert.deepEqual((await ok(d, "google.user.list", {})).accounts, []);
    assert.ok(seen.some((s) => s.url === "oauth2.googleapis.com/revoke"), "Google was asked to revoke");
  } finally { await d.stop(); }
});

test("personal mail live: a person's Outlook signs in, reads through /me with delta ids, sends with Graph sendMail, and disconnecting removes the account", async () => {
  const seen: Seen[] = [];
  const ME = "olivia@outlook.test";
  const sent: unknown[] = [];
  let second = false;
  const http = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    seen.push({ method, url: `${u.hostname}${u.pathname}${u.search.includes("deltatoken") ? "?delta" : ""}`, ...(init.headers?.["authorization"] ? { auth: init.headers["authorization"] } : {}) });
    const p = u.pathname.replace("/v1.0", "");
    if (p === "/me") return reply(200, { mail: ME, userPrincipalName: ME });
    if (p === "/me/sendMail") { sent.push(JSON.parse(init.body ?? "{}")); return reply(202, ""); }
    const delta = /^\/me\/mailFolders\/(inbox|sentitems)\/messages\/delta$/.exec(p);
    if (delta) {
      if (u.search.includes("skiptoken=S2")) return reply(200, fixture("microsoft/fixtures/graph/delta-inbox-2.json"));
      return reply(200, delta[1] === "inbox" ? fixture("microsoft/fixtures/graph/delta-inbox-1.json") : fixture("microsoft/fixtures/graph/delta-sent.json"));
    }
    if (u.search.includes("deltatoken")) {
      return reply(200, second && /inbox/.test(u.pathname + u.search)
        ? { value: [{ id: "g3", isDraft: false }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=D3" }
        : { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages/delta?$deltatoken=SD3" });
    }
    if (/\/attachments$/.test(p)) return reply(200, { value: [] });
    const one = /^\/me\/messages\/(g\d)$/.exec(p);
    if (one) return reply(200, fixture(`microsoft/fixtures/graph/message-${one[1]}.json`));
    return reply(404, { error: { code: "ResourceNotFound" } });
  };
  const { d, dir } = await boot({ http, seams: { fetch: tokenSeam(seen, MS_REFRESH) } });
  try {
    await unlock(d);
    await vaultApp(d, "Microsoft_Sign_In", [{ key: "client_id", value: "11111111-2222-3333-4444-555555555555", secret: false }, { key: "client_secret", value: "live-ms-secret", secret: true }]);
    assert.deepEqual(await ok(d, "ms.user.app_set", { vaultItem: "#Microsoft_Sign_In" }), { configured: true, clientId: "11111111-2222-3333-4444-555555555555" });
    const start = await ok(d, "ms.user.start", {});
    const auth = new URL(start.authUrl as string);
    assert.equal(auth.hostname, "login.microsoftonline.com");
    assert.match(auth.searchParams.get("scope") ?? "", /offline_access/);
    const done = await ok(d, "ms.user.complete", { state: start.state, code: "ms-code" });
    assert.equal(done.email, ME);
    assert.match(String(done.accountId), /^mua_/);
    assert.ok(!JSON.stringify(done).includes(MS_REFRESH));

    const box = ((await ok(d, "mail.mailbox.list", { scope: "mine" })).mailboxes as { id: string; address: string; provider: string }[]).find((b) => b.address === ME)!;
    assert.equal(box.provider, "microsoft");
    await until(async () => ((await count(d, box.id)) >= 4 ? true : null), "the first delta walk");
    assert.ok(seen.every((s) => !s.url.includes("/users/")), "every Graph call the module built is /me");
    await assertSealed(d, dir, MS_REFRESH, ["Microsoft_Sign_In"]);

    // the next pull, vault locked, follows the stored delta links
    await lock(d);
    second = true;
    await ok(d, "mail.sync_now", { mailboxId: box.id });
    await until(async () => (seen.some((s) => s.url.endsWith("?delta")) ? true : null), "the delta pull");
    const refresh = seen.find((s) => s.form?.get("grant_type") === "refresh_token");
    assert.equal(refresh?.form?.get("refresh_token"), MS_REFRESH);

    await unlock(d);
    await ok(d, "mail.send_as", { mailboxId: box.id, to: [{ address: "pat@acme.test" }], subject: "From Outlook", text: "Hi Pat" });
    assert.equal(sent.length, 1);
    assert.equal(((sent[0] as { message: { subject: string } }).message).subject, "From Outlook");
    assert.ok(seen.some((s) => s.url === "graph.microsoft.com/v1.0/me/sendMail"));

    await ok(d, "mail.mailbox.disconnect", { mailboxId: box.id });
    assert.deepEqual((await ok(d, "ms.user.list", {})).accounts, []);
  } finally { await d.stop(); }
});
