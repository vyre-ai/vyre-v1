// Dropbox on a booted daemon with the real Vault (live folders L3). Dropbox itself is a stand-in (token endpoint and API), nothing inside the daemon is faked: the Vault, the Space seal, the dropbox
// module and its host seam are live. It proves what the refresh token's storage promises:
//   - a person connects Dropbox; the Vault holds the app's key and secret and nothing else, so no member, admin or agent can list, reveal, copy or fill the token through any vault capability;
//   - the token is on disk only sealed: the plaintext is in no file of the data directory;
//   - a pass run by the host with nobody signed in (a scheduled mount pass) still gets a valid access token from it;
//   - the answer to the person never carries it.
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
const REFRESH = "rt-LIVE-SECRET-refresh-token-0001";
const APP_KEY = "appkey-live", APP_SECRET = "appsecret-live";

/** Dropbox: the token endpoint (code and refresh grants) and the two API calls the test needs. */
function dropbox() {
  const seen: { url: string; auth?: string; form?: URLSearchParams }[] = [];
  let tokens = 0;
  const reply = (status: number, body: unknown) => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
  const http = async (url: string, init: { headers?: Record<string, string>; body?: string } = {}) => {
    const u = new URL(url);
    seen.push({ url: `${u.hostname}${u.pathname}`, ...(init.headers?.["authorization"] ? { auth: init.headers["authorization"] } : {}) });
    if (u.pathname === "/2/users/get_current_account") return reply(200, { account_id: "dbid:LIVE", email: "maya@firm.example", name: { display_name: "Maya Rivera" } });
    if (u.pathname === "/2/files/list_folder") return reply(200, { entries: [{ ".tag": "file", id: "id:f1", name: "a.txt", path_lower: "/a.txt", path_display: "/a.txt", rev: "0123456789ab", size: 3 }], cursor: "c1", has_more: false });
    return reply(404, { error_summary: "not_found" });
  };
  const fetch = async (url: string, init: { body?: string | Uint8Array } = {}) => {
    const u = new URL(url);
    const form = new URLSearchParams(typeof init.body === "string" ? init.body : "");
    seen.push({ url: `${u.hostname}${u.pathname}`, form });
    if (u.pathname !== "/oauth2/token") return { status: 404, text: async () => "{}", arrayBuffer: async () => new ArrayBuffer(0) };
    const body = form.get("grant_type") === "authorization_code"
      ? { access_token: `sl.access-${++tokens}`, refresh_token: REFRESH, expires_in: 14400, account_id: "dbid:LIVE", token_type: "bearer" }
      : { access_token: `sl.access-${++tokens}`, expires_in: 14400, token_type: "bearer" };
    return { status: 200, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return { seen, http, fetch };
}

async function boot(extra: Record<string, unknown>): Promise<{ d: Daemon; dir: string }> {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-dropbox-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "dropbox-live", free: 80e9,
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
  const r = await call(d, cap, { idempotencyKey: `dbx-live-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

/** Every byte the data directory holds, to look for a plaintext in. */
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

test("dropbox live: a connected Dropbox leaves nothing in the Vault but the app's own item, the token is sealed on disk, and a locked vault does not stop it getting an access token", async () => {
  const dbx = dropbox();
  const { d, dir } = await boot({ http: dbx.http, seams: { fetch: dbx.fetch } });
  try {
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204);
    // the admin files the Dropbox app in the Vault (a Shared item, as Google and Microsoft are) and names it
    const folder = (await ok(d, "vault.folders.create", { name: "Apps", scope: "shared" })).folder.id as string;
    await ok(d, "vault.item.put", { folderId: folder, name: "Dropbox_App", kind: "other", fields: [{ key: "app_key", value: APP_KEY, secret: false }, { key: "app_secret", value: APP_SECRET, secret: true }] });
    assert.deepEqual(await ok(d, "dropbox.app.set", { vaultItem: "#Dropbox_App" }), { configured: true, appKey: APP_KEY, webhooks: true });

    // a person connects their own Dropbox
    const start = await ok(d, "dropbox.connect.start", {});
    assert.match(String(start.authUrl), /^https:\/\/www\.dropbox\.com\/oauth2\/authorize\?/);
    const done = await ok(d, "dropbox.connect.complete", { state: start.state, code: "the-code" });
    assert.match(String(done.connectionId), /^con_/);
    assert.ok(!JSON.stringify(done).includes(REFRESH), "the answer never carries the token");
    const exchange = dbx.seen.find((s) => s.form?.get("grant_type") === "authorization_code")!;
    assert.equal(exchange.form!.get("client_id"), APP_KEY);

    // the Vault: the app's item and nothing else. Every item the Vault will list, revealed, holds no part of the token.
    const items = (await ok(d, "vault.items.list", {})).items as { id: string; name: string }[];
    assert.deepEqual(items.map((i) => i.name), ["Dropbox_App"], "no Dropbox item in the Vault");
    for (const i of items) assert.ok(!JSON.stringify((await ok(d, "vault.item.reveal", { itemId: i.id })).fields ?? {}).includes(REFRESH), `${i.name} holds no token`);
    const folders = (await ok(d, "vault.folders.list", {})).folders as { name: string; itemCount: number }[];
    assert.ok(!folders.some((f) => f.name === "Connections"), "no Connections folder was made for it");

    // on disk the token exists only sealed: its plaintext is in no file of the data directory
    d.sink.flush();
    const needle = Buffer.from(REFRESH);
    for (const bytes of everything(dir)) assert.equal(bytes.includes(needle), false, "the plaintext token is in no file");

    // nobody has their vault open any more (the person locks it): a scheduled pass could not open a Mine item now, and the sealed token does not need one
    const lock = await fetch(`${d.url}/local/vault/key/lock`, { method: "POST", headers: { authorization: `Bearer ${d.token}` } });
    assert.ok(lock.status === 204 || lock.status === 200, `lock: ${lock.status}`);
    const listed = await ok(d, "dropbox.files.list_folder", { connectionId: done.connectionId, path: "", recursive: true });
    assert.deepEqual(listed.entries.map((e: { id: string }) => e.id), ["id:f1"]);
    const mine = await ok(d, "dropbox.account.list", {});
    assert.ok(!JSON.stringify(mine).includes(REFRESH), "the account list never carries the token");
    const refresh = dbx.seen.find((s) => s.form?.get("grant_type") === "refresh_token");
    assert.ok(refresh, "an access token was made from the sealed refresh token");
    assert.equal(refresh!.form!.get("refresh_token"), REFRESH);
    const api = dbx.seen.filter((s) => s.url === "api.dropboxapi.com/2/files/list_folder").at(-1)!;
    assert.match(String(api.auth), /^Bearer sl\.access-\d+$/);
  } finally { await d.stop(); }
});
