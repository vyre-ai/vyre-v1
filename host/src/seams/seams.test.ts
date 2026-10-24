// The Google, Microsoft and IMAP seams against a fake Vault and a fake network: what leaves the host, what comes back, and what is refused.
import test from "node:test";
import assert from "node:assert/strict";
import { HostError } from "../routes/errors.ts";
import { createGoogleHost, GOOGLE_TOKEN_URL } from "./google.ts";
import { createImapSecretResolver } from "./imap.ts";
import { createMsHost } from "./microsoft.ts";
import { wireSeams } from "./index.ts";
import type { GoogleHostSeam, ImapSecretResolver, MsHostSeam } from "./index.ts";
import type { SeamCtx, SeamFetch, VaultPort } from "./ports.ts";

const NOW = 1_760_000_000_000;
const TRACE = "c".repeat(32);
const dec = new TextDecoder();
const code = (c: string) => (e: unknown): boolean => e instanceof HostError && e.error.code === c;

const SA = JSON.stringify({ type: "service_account", client_id: "1234567890", client_email: "vyre@proj.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nSECRETKEYMATERIAL\n-----END PRIVATE KEY-----\n" });
const MSAPP = JSON.stringify({ clientId: "app-1", clientSecret: "s3cr3t-value", tenantId: "contoso.onmicrosoft.com" });

interface Sent { url: string; method: string | undefined; headers: Record<string, string>; body: string | Uint8Array | undefined }

function net(replies: { status: number; body?: string; bytes?: Uint8Array }[]) {
  const sent: Sent[] = [];
  const fetch: SeamFetch = async (url, init) => {
    sent.push({ url, method: init?.method, headers: init?.headers ?? {}, body: init?.body });
    const r = replies.shift() ?? { status: 200, body: "{}" };
    return { status: r.status, text: async () => r.body ?? "", arrayBuffer: async () => (r.bytes ?? new TextEncoder().encode(r.body ?? "")).slice().buffer as ArrayBuffer };
  };
  return { fetch, sent };
}

function world(o: { secret?: string; rows?: unknown[]; replies?: { status: number; body?: string; bytes?: Uint8Array }[] } = {}) {
  const n = net(o.replies ?? []);
  const asked: { handle: string; space: string }[] = [];
  const blobs: { space: string; size: number; mime: string }[] = [];
  const vault: VaultPort = {
    secret: async (handle, space) => { asked.push({ handle, space }); return o.secret ?? SA; },
    signRs256: async (_h, _s, data) => `SIG(${data.length})`,
  };
  const deps = {
    vault, fetch: n.fetch,
    files: { read: async (_s: string, id: string) => ({ name: `${id}.txt`, mime: "text/plain", bytes: new TextEncoder().encode("file body") }) },
    blobs: { put: async (space: string, bytes: Uint8Array, mime: string) => { blobs.push({ space, size: bytes.byteLength, mime }); return `blb_${bytes.byteLength}`; } },
    members: { emails: async (space: string) => [{ userId: "usr_maya", email: `maya@${space}.test` }] },
  };
  const ctx: SeamCtx = { space: "spc_1", trace: { traceId: TRACE }, now: () => NOW, db: { all: () => o.rows ?? [{ h: "#Google_DWD" }] } };
  return { ...n, asked, blobs, deps, ctx };
}

const claimsOf = (jwt: string): { header: Record<string, unknown>; claims: Record<string, unknown>; sig: string } => {
  const [h, c, s] = jwt.split(".") as [string, string, string];
  return { header: JSON.parse(Buffer.from(h, "base64url").toString()), claims: JSON.parse(Buffer.from(c, "base64url").toString()), sig: s };
};
const form = (body: string | Uint8Array | undefined): URLSearchParams => new URLSearchParams(typeof body === "string" ? body : "");

// ---- Google

test("google: serviceAccount returns the public identity and never the key", async () => {
  const w = world();
  const id = await createGoogleHost(w.deps).serviceAccount(w.ctx, "#Google_DWD");
  assert.deepEqual(id, { clientId: "1234567890", clientEmail: "vyre@proj.iam.gserviceaccount.com" });
  assert.ok(!JSON.stringify(id).includes("SECRETKEYMATERIAL"));
  assert.deepEqual(w.asked, [{ handle: "#Google_DWD", space: "spc_1" }]);
});

test("google: serviceAccount refuses a bad handle and an item that is not a service-account key", async () => {
  const w = world();
  await assert.rejects(createGoogleHost(w.deps).serviceAccount(w.ctx, "Google_DWD"), code("validation.bad_input"));
  assert.equal(w.asked.length, 0, "a bad handle never reaches the Vault");
  for (const secret of ["not json", "{}", JSON.stringify({ type: "authorized_user" }), JSON.stringify({ type: "service_account", client_id: "1" })]) {
    const x = world({ secret });
    await assert.rejects(createGoogleHost(x.deps).serviceAccount(x.ctx, "#Google_DWD"), code("validation.bad_input"), secret);
  }
});

test("google: mintToken signs a delegated JWT in the Vault and trades it for a token", async () => {
  const w = world({ replies: [{ status: 200, body: JSON.stringify({ access_token: "ya29.tok", expires_in: 1800, token_type: "Bearer" }) }] });
  const t = await createGoogleHost(w.deps).mintToken(w.ctx, { connectionId: "con_1", sub: "maya@vyre.test", scopes: ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/calendar"] });
  assert.deepEqual(t, { token: "ya29.tok", expiresAt: NOW + 1_800_000 });
  assert.equal(w.sent.length, 1);
  const req = w.sent[0]!;
  assert.equal(req.url, GOOGLE_TOKEN_URL);
  assert.equal(req.method, "POST");
  assert.equal(req.headers["content-type"], "application/x-www-form-urlencoded");
  const f = form(req.body);
  assert.equal(f.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const jwt = claimsOf(f.get("assertion")!);
  assert.deepEqual(jwt.header, { alg: "RS256", typ: "JWT" });
  assert.equal(jwt.claims["iss"], "vyre@proj.iam.gserviceaccount.com");
  assert.equal(jwt.claims["sub"], "maya@vyre.test");
  assert.equal(jwt.claims["scope"], "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar");
  assert.equal(jwt.claims["aud"], GOOGLE_TOKEN_URL);
  assert.equal(jwt.claims["iat"], NOW / 1000);
  assert.equal(jwt.claims["exp"], NOW / 1000 + 3600);
  assert.match(jwt.sig, /^SIG\(\d+\)$/);
  assert.ok(!String(req.body).includes("SECRETKEYMATERIAL"), "the key never leaves the Vault");
});

test("google: mintToken maps Google's answers to provider errors", async () => {
  const cases: [number, string, string][] = [
    [400, '{"error":"unauthorized_client","error_description":"Client is unauthorized"}', "provider.auth_failed"],
    [401, "", "provider.auth_failed"],
    [429, "", "provider.rate_limited"],
    [503, "", "provider.unavailable"],
    [200, "not json", "provider.bad_response"],
    [200, "{}", "provider.bad_response"],
  ];
  for (const [status, body, want] of cases) {
    const w = world({ replies: [{ status, body }] });
    await assert.rejects(createGoogleHost(w.deps).mintToken(w.ctx, { connectionId: "con_1", sub: "a@b.test", scopes: ["s"] }), code(want), `${status} ${body}`);
  }
  const w = world({ replies: [{ status: 400, body: '{"error":"unauthorized_client","error_description":"Client is unauthorized"}' }] });
  await assert.rejects(createGoogleHost(w.deps).mintToken(w.ctx, { connectionId: "con_1", sub: "a@b.test", scopes: ["s"] }), (e: unknown) => {
    const d = (e as HostError).error.details as { why?: string };
    return d.why === "unauthorized_client: Client is unauthorized";
  });
});

test("google: mintToken with no configured connection fails as auth, before any network", async () => {
  for (const rows of [[], [{ h: "not a handle" }], [{ h: 5 }]]) {
    const w = world({ rows });
    await assert.rejects(createGoogleHost(w.deps).mintToken(w.ctx, { connectionId: "con_x", sub: "a@b.test", scopes: ["s"] }), code("provider.auth_failed"));
    assert.equal(w.sent.length, 0);
    assert.equal(w.asked.length, 0);
  }
});

test("google: memberEmails, fileBytes and putBlob go to the Space's own stores", async () => {
  const w = world();
  const h = createGoogleHost(w.deps);
  assert.deepEqual(await h.memberEmails(w.ctx), [{ userId: "usr_maya", email: "maya@spc_1.test" }]);
  const f = await h.fileBytes(w.ctx, "fil_1");
  assert.equal(f.name, "fil_1.txt");
  assert.equal(dec.decode(f.bytes), "file body");
  assert.equal(await h.putBlob(w.ctx, new Uint8Array(5), "image/png"), "blb_5");
  assert.deepEqual(w.blobs, [{ space: "spc_1", size: 5, mime: "image/png" }]);
});

test("google: download fetches with the bearer token and stores a blob", async () => {
  const w = world({ replies: [{ status: 200, bytes: new Uint8Array([1, 2, 3, 4]) }] });
  const got = await createGoogleHost(w.deps).download(w.ctx, { url: "https://www.googleapis.com/drive/v3/files/f1?alt=media", token: "tok", mime: "application/pdf" });
  assert.deepEqual(got, { blobId: "blb_4", size: 4, mime: "application/pdf" });
  assert.equal(w.sent[0]!.headers["authorization"], "Bearer tok");
  assert.deepEqual(w.blobs, [{ space: "spc_1", size: 4, mime: "application/pdf" }]);
});

test("google: a token only goes to a listed https host", async () => {
  const w = world();
  const h = createGoogleHost(w.deps);
  for (const url of ["http://www.googleapis.com/x", "https://evil.test/x", "https://googleapis.com.evil.test/x", "https://user:pw@www.googleapis.com/x", "nonsense"]) {
    await assert.rejects(h.download(w.ctx, { url, token: "tok" }), (e: unknown) => e instanceof HostError && (e.error.code === "permission.no_grant" || e.error.code === "validation.bad_input"), url);
    await assert.rejects(h.upload(w.ctx, { url, token: "tok", fileId: "f", metadata: {} }), (e: unknown) => e instanceof HostError, url);
  }
  assert.equal(w.sent.length, 0, "nothing was sent");
});

test("google: download maps a failing status", async () => {
  const w = world({ replies: [{ status: 404 }, { status: 403 }] });
  const h = createGoogleHost(w.deps);
  await assert.rejects(h.download(w.ctx, { url: "https://www.googleapis.com/drive/v3/files/f1?alt=media", token: "t" }), code("provider.bad_response"));
  await assert.rejects(h.download(w.ctx, { url: "https://www.googleapis.com/drive/v3/files/f1?alt=media", token: "t" }), code("provider.auth_failed"));
});

test("google: upload sends metadata and the Space file as multipart and returns Google's answer", async () => {
  const w = world({ replies: [{ status: 200, body: '{"id":"up1","name":"a.txt"}' }] });
  const out = await createGoogleHost(w.deps).upload(w.ctx, { url: "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", token: "tok", fileId: "fil_9", metadata: { name: "a.txt" } });
  assert.deepEqual(out, { id: "up1", name: "a.txt" });
  const req = w.sent[0]!;
  assert.equal(req.method, "POST");
  assert.equal(req.headers["authorization"], "Bearer tok");
  const ct = req.headers["content-type"]!;
  const boundary = /^multipart\/related; boundary=(.+)$/.exec(ct)![1]!;
  const body = dec.decode(req.body as Uint8Array);
  assert.ok(body.startsWith(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"a.txt"}\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\nfile body\r\n--${boundary}--`));
});

// ---- Microsoft

test("microsoft: mintToken uses client credentials on the tenant's endpoint", async () => {
  const w = world({ secret: MSAPP, rows: [{ h: "#Microsoft_App" }], replies: [{ status: 200, body: '{"access_token":"eyJ.graph","expires_in":3599}' }] });
  const t = await createMsHost(w.deps).mintToken(w.ctx, { connectionId: "con_ms" });
  assert.deepEqual(t, { token: "eyJ.graph", expiresAt: NOW + 3_599_000 });
  const req = w.sent[0]!;
  assert.equal(req.url, "https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token");
  const f = form(req.body);
  assert.equal(f.get("grant_type"), "client_credentials");
  assert.equal(f.get("client_id"), "app-1");
  assert.equal(f.get("client_secret"), "s3cr3t-value");
  assert.equal(f.get("scope"), "https://graph.microsoft.com/.default");
  assert.deepEqual(w.asked, [{ handle: "#Microsoft_App", space: "spc_1" }]);
});

test("microsoft: refusals and a handle supplied by the module's own lookup", async () => {
  const w = world({ secret: MSAPP, replies: [{ status: 401, body: '{"error":"invalid_client","error_description":"AADSTS7000215: Invalid client secret.\\r\\nTrace ID: x"}' }] });
  await assert.rejects(createMsHost({ ...w.deps, handleFor: () => "#Microsoft_App" }).mintToken(w.ctx, { connectionId: "c" }), (e: unknown) => {
    const d = e instanceof HostError ? (e.error.details as { why?: string }) : {};
    return e instanceof HostError && e.error.code === "provider.auth_failed" && d.why === "invalid_client: AADSTS7000215: Invalid client secret.";
  });
  const none = world({ secret: MSAPP, rows: [] });
  await assert.rejects(createMsHost(none.deps).mintToken(none.ctx, { connectionId: "c" }), code("provider.auth_failed"));
  const wrong = world({ secret: SA, rows: [{ h: "#Microsoft_App" }] });
  await assert.rejects(createMsHost(wrong.deps).mintToken(wrong.ctx, { connectionId: "c" }), code("validation.bad_input"));
});

test("microsoft: appIdentity shows the client and tenant, never the secret", async () => {
  const w = world({ secret: MSAPP });
  const id = await createMsHost(w.deps).appIdentity(w.ctx, "#Microsoft_App");
  assert.deepEqual(id, { clientId: "app-1", tenantId: "contoso.onmicrosoft.com" });
  assert.ok(!JSON.stringify(id).includes("s3cr3t"));
});

test("microsoft: downloads are limited to Microsoft hosts", async () => {
  const w = world({ replies: [{ status: 200, bytes: new Uint8Array(3) }] });
  const h = createMsHost(w.deps);
  await assert.rejects(h.download(w.ctx, { url: "https://www.googleapis.com/x", token: "t" }), code("permission.no_grant"));
  const got = await h.download(w.ctx, { url: "https://graph.microsoft.com/v1.0/me/drive/items/1/content", token: "t" });
  assert.equal(got.size, 3);
});

// ---- IMAP

test("imap: the Vault releases the password for a handle, nothing else", async () => {
  const asked: string[] = [];
  const resolve = createImapSecretResolver({ secret: async (h, s) => { asked.push(`${h}@${s}`); return "pa55"; } });
  const ctx = { space: "spc_1", trace: { traceId: TRACE } };
  assert.equal(await resolve("#Mail_Pw", ctx), "pa55");
  assert.deepEqual(asked, ["#Mail_Pw@spc_1"]);
  await assert.rejects(resolve("plain-password", ctx), code("provider.auth_failed"));
  assert.equal(asked.length, 1, "a value that is not a handle never reaches the Vault");
});

test("imap: a Vault failure or an empty value is an auth failure with no detail leaked", async () => {
  const ctx = { space: "spc_1", trace: { traceId: TRACE } };
  const boom = createImapSecretResolver({ secret: async () => { throw new Error("vault locked: key=XYZ"); } });
  await assert.rejects(boom("#Mail_Pw", ctx), (e: unknown) => e instanceof HostError && e.error.code === "provider.auth_failed" && !JSON.stringify(e.error).includes("XYZ"));
  const empty = createImapSecretResolver({ secret: async () => "" });
  await assert.rejects(empty("#Mail_Pw", ctx), code("provider.auth_failed"));
});

// ---- wiring

test("wireSeams registers what it is given and reports what is absent, then takes it all back out", () => {
  const calls: string[] = [];
  let google: GoogleHostSeam | null = null;
  let imap: ImapSecretResolver | null = null;
  const w = world();
  const wired = wireSeams({
    setGoogleHost: (h) => { calls.push(h ? "google+" : "google-"); google = h; },
    setImapSecretResolver: (f) => { calls.push(f ? "imap+" : "imap-"); imap = f; },
  }, w.deps);
  assert.deepEqual(wired.state, { google: "wired", microsoft: "absent", imap: "wired" });
  assert.equal(typeof (google as GoogleHostSeam | null)?.mintToken, "function");
  assert.equal(typeof imap, "function");
  wired.unwire();
  assert.deepEqual(calls, ["google+", "imap+", "google-", "imap-"]);
  assert.equal(google, null);
  assert.equal(imap, null);
});

test("wireSeams wires Microsoft when its setter exists", () => {
  let ms: MsHostSeam | null = null;
  const w = world();
  const wired = wireSeams({ setMsHost: (h) => { ms = h; } }, w.deps);
  assert.equal(wired.state.microsoft, "wired");
  assert.equal(typeof (ms as MsHostSeam | null)?.mintToken, "function");
  assert.deepEqual([wired.state.google, wired.state.imap], ["absent", "absent"]);
});

// P-H_01 final run: each named test shows its own ok line in the run on the last commit.
