// The Dropbox seam against a fake Vault and a fake network: the app key and secret, the sign-in code exchange, tokens made from a refresh token, and the two binary transfers.
import test from "node:test";
import assert from "node:assert/strict";
import { HostError } from "../routes/errors.ts";
import { asciiJson, createDropboxHost, DROPBOX_TOKEN_URL } from "./dropbox.ts";
import type { SeamCtx, SeamFetch } from "./ports.ts";

const NOW = 1_760_000_000_000;
const code = (c: string) => (e: unknown): boolean => e instanceof HostError && e.error.code === c;

interface Sent { url: string; method: string | undefined; headers: Record<string, string>; body: string | Uint8Array | undefined }
type Reply = { status: number; body?: string; bytes?: Uint8Array };

function world(o: { replies?: Reply[]; items?: Record<string, string> } = {}) {
  const sent: Sent[] = [];
  const replies = [...(o.replies ?? [])];
  const asked: { handle: string; asker?: string }[] = [];
  const blobs: { size: number; mime: string }[] = [];
  const items = o.items ?? { "#Dropbox_App.app_key": "key-1", "#Dropbox_App.app_secret": "sec-1", "#Token_Maya": "refresh-1" };
  const fetch: SeamFetch = async (url, init) => {
    sent.push({ url, method: init?.method, headers: init?.headers ?? {}, body: init?.body });
    const r = replies.shift() ?? { status: 200, body: "{}" };
    return { status: r.status, text: async () => r.body ?? "", arrayBuffer: async () => (r.bytes ?? new TextEncoder().encode(r.body ?? "")).slice().buffer as ArrayBuffer };
  };
  const deps = {
    vault: { secret: async (handle: string, _space: string, asker?: string) => { asked.push({ handle, ...(asker ? { asker } : {}) }); const v = items[handle]; if (v === undefined) throw new Error("no item"); return v; } },
    fetch,
    files: { read: async (_s: string, id: string) => ({ name: `${id}.txt`, mime: "text/plain", bytes: new TextEncoder().encode("file body") }) },
    blobs: { put: async (_s: string, bytes: Uint8Array, mime: string) => { blobs.push({ size: bytes.byteLength, mime }); return `blb_${bytes.byteLength}`; } },
    publicUrl: async (space: string) => `https://${space}.vyre.test`,
  };
  let clock = NOW;
  const ctx: SeamCtx = { space: "spc_1", trace: { traceId: "d".repeat(32) }, now: () => clock, db: { all: () => [] } };
  return { sent, asked, blobs, deps, ctx, advance: (ms: number) => { clock += ms; } };
}
const form = (b: string | Uint8Array | undefined): URLSearchParams => new URLSearchParams(typeof b === "string" ? b : "");

test("dropbox: app reads the key and says whether a secret is there; a missing key is a refusal; a bad handle never reaches the Vault", async () => {
  const w = world();
  assert.deepEqual(await createDropboxHost(w.deps).app(w.ctx, "#Dropbox_App"), { appKey: "key-1", hasSecret: true });
  assert.equal(await createDropboxHost(w.deps).appSecret(w.ctx, "#Dropbox_App"), "sec-1");
  const bare = world({ items: { "#Dropbox_App.app_key": "key-1" } });
  assert.deepEqual(await createDropboxHost(bare.deps).app(bare.ctx, "#Dropbox_App"), { appKey: "key-1", hasSecret: false });
  await assert.rejects(createDropboxHost(bare.deps).appSecret(bare.ctx, "#Dropbox_App"), code("provider.auth_failed"));
  const none = world({ items: {} });
  await assert.rejects(createDropboxHost(none.deps).app(none.ctx, "#Dropbox_App"), code("provider.auth_failed"));
  const before = w.asked.length;
  await assert.rejects(createDropboxHost(w.deps).app(w.ctx, "Dropbox_App"), code("validation.bad_input"));
  await assert.rejects(createDropboxHost(w.deps).app(w.ctx, "#Dropbox_App.app_secret"), code("validation.bad_input"));
  assert.equal(w.asked.length, before);
});

test("dropbox: exchange trades the code for tokens with the PKCE verifier and the app key and secret", async () => {
  const w = world({ replies: [{ status: 200, body: JSON.stringify({ access_token: "sl.acc", refresh_token: "rt.1", expires_in: 14400, token_type: "bearer", account_id: "dbid:AAA" }) }] });
  const out = await createDropboxHost(w.deps).exchange(w.ctx, { appHandle: "#Dropbox_App", code: "the-code", verifier: "ver-1", redirectUri: "https://x.vyre.test/oauth/callback" });
  assert.deepEqual(out, { refreshToken: "rt.1", accessToken: "sl.acc", expiresAt: NOW + 14_400_000, accountId: "dbid:AAA" });
  const req = w.sent[0]!;
  assert.equal(req.url, DROPBOX_TOKEN_URL);
  assert.equal(req.method, "POST");
  const f = form(req.body);
  assert.deepEqual([f.get("grant_type"), f.get("code"), f.get("code_verifier"), f.get("redirect_uri"), f.get("client_id"), f.get("client_secret")], ["authorization_code", "the-code", "ver-1", "https://x.vyre.test/oauth/callback", "key-1", "sec-1"]);
});

test("dropbox: exchange refuses a refused code, an answer with no refresh token, and never puts a secret in the error", async () => {
  const w = world({ replies: [{ status: 400, body: '{"error":"invalid_grant","error_description":"code expired sec-1 rt.1"}' }, { status: 200, body: '{"access_token":"a"}' }] });
  await assert.rejects(createDropboxHost(w.deps).exchange(w.ctx, { appHandle: "#Dropbox_App", code: "c", verifier: "v", redirectUri: "https://x/cb" }), (e: unknown) => {
    assert.ok(e instanceof HostError && e.error.code === "provider.auth_failed");
    assert.ok(!JSON.stringify(e.error).includes("sec-1") && !JSON.stringify(e.error).includes("rt.1"), "no secret in the error");
    return true;
  });
  await assert.rejects(createDropboxHost(w.deps).exchange(w.ctx, { appHandle: "#Dropbox_App", code: "c", verifier: "v", redirectUri: "https://x/cb" }), code("provider.bad_response"));
});

test("dropbox: token makes an access token from the refresh token it is handed, keeps it by connection until the last minute, and fresh asks again", async () => {
  const w = world({ replies: [
    { status: 200, body: '{"access_token":"acc-1","expires_in":14400}' }, { status: 200, body: '{"access_token":"acc-2","expires_in":14400}' }, { status: 200, body: '{"access_token":"acc-3","expires_in":14400}' },
    { status: 200, body: '{"access_token":"acc-4","expires_in":14400}' },
  ] });
  const h = createDropboxHost(w.deps);
  const a = { appHandle: "#Dropbox_App", refreshToken: "refresh-1", cacheKey: "con_maya" };
  assert.deepEqual(await h.token(w.ctx, a), { token: "acc-1", expiresAt: NOW + 14_400_000 });
  const f = form(w.sent[0]!.body);
  assert.deepEqual([f.get("grant_type"), f.get("refresh_token"), f.get("client_id")], ["refresh_token", "refresh-1", "key-1"]);
  assert.ok(w.asked.every((x) => !x.handle.startsWith("#Token")) && w.asked.every((x) => x.asker === undefined), "the Vault is asked only for the app's key and secret, and never as a person");
  assert.equal((await h.token(w.ctx, a)).token, "acc-1");
  assert.equal(w.sent.length, 1, "cached");
  assert.equal((await h.token(w.ctx, { ...a, fresh: true })).token, "acc-2");
  w.advance(14_400_000 - 30_000);
  assert.equal((await h.token(w.ctx, a)).token, "acc-3", "asked again inside the last minute");
  assert.equal((await h.token(w.ctx, { ...a, cacheKey: "con_other" })).token, "acc-4", "another connection has its own entry");
});

test("dropbox: a lost sign-in and a refused refresh both ask the person to connect again", async () => {
  const h0 = world({ items: { "#Dropbox_App.app_key": "k" } });
  await assert.rejects(createDropboxHost(h0.deps).token(h0.ctx, { appHandle: "#Dropbox_App", refreshToken: "", cacheKey: "c" }), code("provider.auth_failed"));
  const w = world({ replies: [{ status: 400, body: '{"error":"invalid_grant"}' }, { status: 503 }, { status: 429 }] });
  const h = createDropboxHost(w.deps);
  const a = { appHandle: "#Dropbox_App", refreshToken: "r", cacheKey: "c" };
  await assert.rejects(h.token(w.ctx, a), code("provider.auth_failed"));
  await assert.rejects(h.token(w.ctx, a), code("provider.unavailable"));
  await assert.rejects(h.token(w.ctx, a), code("provider.rate_limited"));
});

test("dropbox: upload sends the Space file's bytes with the arguments in Dropbox-API-Arg, written as ASCII", async () => {
  const w = world({ replies: [{ status: 200, body: '{"id":"id:1","name":"Réport.docx","rev":"0123456789a"}' }] });
  const out = await createDropboxHost(w.deps).upload(w.ctx, { token: "tok", arg: { path: "/Sales/Réport.docx", mode: { ".tag": "update", update: "r1" } }, fileId: "fil_9" });
  assert.deepEqual(out, { status: 200, json: { id: "id:1", name: "Réport.docx", rev: "0123456789a" } });
  const req = w.sent[0]!;
  assert.equal(req.url, "https://content.dropboxapi.com/2/files/upload");
  assert.equal(req.headers["authorization"], "Bearer tok");
  assert.equal(req.headers["content-type"], "application/octet-stream");
  assert.ok(/^[\x20-\x7e]*$/.test(req.headers["dropbox-api-arg"]!), "the header is ASCII");
  assert.deepEqual(JSON.parse(req.headers["dropbox-api-arg"]!), { path: "/Sales/Réport.docx", mode: { ".tag": "update", update: "r1" } });
  assert.equal(new TextDecoder().decode(req.body as Uint8Array), "file body");
  assert.equal(asciiJson({ a: "é" }), '{"a":"\\u00e9"}');
});

test("dropbox: a refused upload comes back as its status and body for the module to map; download stores the bytes as a blob or answers the refusal", async () => {
  const w = world({ replies: [{ status: 409, body: '{"error_summary":"path/conflict/file/.."}' }, { status: 200, bytes: new Uint8Array([1, 2, 3, 4]) }, { status: 409, body: '{"error_summary":"path/not_found/.."}' }] });
  const h = createDropboxHost(w.deps);
  assert.deepEqual(await h.upload(w.ctx, { token: "t", arg: { path: "/a" }, fileId: "f" }), { status: 409, json: { error_summary: "path/conflict/file/.." } });
  const ok = await h.download(w.ctx, { token: "t", arg: { path: "id:1" }, mime: "application/pdf" });
  assert.deepEqual(ok, { status: 200, json: {}, blob: { blobId: "blb_4", size: 4, mime: "application/pdf" } });
  assert.equal(w.sent[1]!.url, "https://content.dropboxapi.com/2/files/download");
  assert.equal(w.sent[1]!.method, "POST");
  assert.deepEqual(await h.download(w.ctx, { token: "t", arg: { path: "id:2" } }), { status: 409, json: { error_summary: "path/not_found/.." } });
});

test("dropbox: publicUrl answers the Space address, or says there is none", async () => {
  const w = world();
  assert.equal(await createDropboxHost(w.deps).publicUrl(w.ctx), "https://spc_1.vyre.test");
  await assert.rejects(createDropboxHost({ ...w.deps, publicUrl: undefined }).publicUrl(w.ctx), code("internal.unavailable"));
});
