// DocuSign: the JWT grant, the eSignature REST client, Connect webhook reading, and a replay of Connect messages through esign.hook against a scripted DocuSign
// (spec 2.20, 3.6; ARCH 8.4). The scripted server checks the JWT signature with the public key and keeps envelope state like the real one, so a webhook that claims
// more than the API says is caught.
// @reads /modules/esign/migrations/0001_esign.sql

import test from "node:test";
import assert from "node:assert/strict";
import { configureEsign, ProviderPayloadError } from "../handlers/send.ts";
import type { EnvelopeRequest } from "../handlers/send.ts";
import { docusign, pkcs8FromPem, signJwt } from "../handlers/docusign.ts";
import type { HttpFn, HttpResponse } from "../handlers/documenso.ts";
import { CERT_PDF, FILE, PDF, RECORD, SIGNED_PDF, dana, fromBase64, harness, refused } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";

const subtle = globalThis.crypto.subtle;
const toB64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
const pem = (label: string, der: Uint8Array): string => `-----BEGIN ${label}-----\n${toB64(der).replace(/(.{64})/g, "$1\n")}\n-----END ${label}-----\n`;
const unb64url = (t: string): Uint8Array => Uint8Array.from(atob(t.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

const pair = await subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const PKCS8 = new Uint8Array(await subtle.exportKey("pkcs8", pair.privateKey));
const PKCS8_PEM = pem("PRIVATE KEY", PKCS8);
// a 2048-bit PKCS#8 key is a 26-byte header in front of the PKCS#1 key, which is the form DocuSign hands out
const PKCS1_PEM = pem("RSA PRIVATE KEY", PKCS8.slice(26));

const NOW = 1_761_390_000_000;
const AUTH_HOST = "account-d.docusign.com";
const BASE = "https://demo.docusign.net";
const ACCOUNT = "acc_1";
const API = `/restapi/v2.1/accounts/${ACCOUNT}`;

// ---- the key and the JWT --------------------------------------------------------------------------------------

test("key: a PKCS#1 PEM (what DocuSign hands out) is wrapped into the same PKCS#8 bytes Web Crypto exports; PKCS#8 passes through; anything else is refused", () => {
  assert.deepEqual([...pkcs8FromPem(PKCS1_PEM)], [...PKCS8]);
  assert.deepEqual([...pkcs8FromPem(PKCS8_PEM)], [...PKCS8]);
  assert.throws(() => pkcs8FromPem("not a key"), /not a PEM private key/);
  assert.throws(() => pkcs8FromPem("-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----"), /not a PEM private key/);
});

test("jwt: RS256 header, the grant's claims, one hour of life, and a signature the public key verifies", async () => {
  const jwt = await signJwt({ integrationKey: "ik_1", userId: "usr_guid", authHost: AUTH_HOST, privateKey: PKCS1_PEM, nowSeconds: 1_761_390_000 });
  const [h, c, sig] = jwt.split(".") as [string, string, string];
  assert.deepEqual(JSON.parse(new TextDecoder().decode(unb64url(h))), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(unb64url(c))), { iss: "ik_1", sub: "usr_guid", aud: AUTH_HOST, iat: 1_761_390_000, exp: 1_761_393_600, scope: "signature impersonation" });
  assert.equal(await subtle.verify("RSASSA-PKCS1-v1_5", pair.publicKey, unb64url(sig) as BufferSource, new TextEncoder().encode(`${h}.${c}`)), true);
  assert.equal(/[+/=]/.test(jwt), false, "base64url, no padding");
});

// ---- a scripted DocuSign --------------------------------------------------------------------------------------

interface Signer { recipientId: string; routingOrder: string; email: string; name: string; status: "sent" | "delivered" | "completed" | "declined"; declinedReason?: string; tabs?: unknown }
interface Env { id: string; subject: string; status: "sent" | "completed" | "declined" | "voided"; signers: Signer[]; doc: Uint8Array; docName: string; custom: Record<string, string> }

class FakeDocuSign {
  envs = new Map<string, Env>();
  log: { method: string; path: string; auth?: string | undefined }[] = [];
  grants = 0;
  consentRequired = false;
  down = false;
  valid = new Set<string>();
  private seq = 0;
  private tokens = 0;

  http: HttpFn = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const auth = init.headers?.Authorization;
    this.log.push({ method, path: `${u.host}${u.pathname}`, auth });
    const reply = (status: number, body: unknown = {}): HttpResponse => ({
      status, ok: status >= 200 && status < 300, json: async () => body, arrayBuffer: async () => (body instanceof Uint8Array ? body.slice().buffer : new ArrayBuffer(0)),
    });
    if (this.down) return reply(503);
    if (u.host === AUTH_HOST && u.pathname === "/oauth/token") {
      const form = new URLSearchParams(String(init.body));
      if (init.headers?.["Content-Type"] !== "application/x-www-form-urlencoded" || form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer") return reply(400, { error: "unsupported_grant_type" });
      if (this.consentRequired) return reply(400, { error: "consent_required" });
      const [h, c, sig] = (form.get("assertion") ?? "").split(".") as [string, string, string];
      const ok = await subtle.verify("RSASSA-PKCS1-v1_5", pair.publicKey, unb64url(sig ?? "") as BufferSource, new TextEncoder().encode(`${h}.${c}`));
      const claims = JSON.parse(new TextDecoder().decode(unb64url(c ?? ""))) as { iss: string; sub: string; aud: string; exp: number; iat: number; scope: string };
      if (!ok || claims.iss !== "ik_1" || claims.sub !== "usr_guid" || claims.aud !== AUTH_HOST || !claims.scope.includes("signature") || claims.exp - claims.iat > 3600) return reply(400, { error: "invalid_grant" });
      this.grants++;
      const token = `at_${++this.tokens}`;
      this.valid.add(token);
      return reply(200, { access_token: token, token_type: "Bearer", expires_in: 3600 });
    }
    if (u.host !== "demo.docusign.net" || !u.pathname.startsWith(API)) return reply(404);
    if (!auth || !this.valid.has(auth.replace(/^Bearer /, ""))) return reply(401);
    const path = u.pathname.slice(API.length);
    if (method === "POST" && path === "/envelopes") {
      const b = JSON.parse(String(init.body)) as { emailSubject: string; status: string; documents: { documentBase64: string; name: string }[]; recipients: { signers: Signer[] }; customFields?: { textCustomFields: { name: string; value: string }[] } };
      if (b.status !== "sent" || !b.documents[0] || b.recipients.signers.length === 0) return reply(400, { errorCode: "INVALID_REQUEST_BODY" });
      if (b.recipients.signers.some((s) => !(s.tabs as { signHereTabs?: unknown[] } | undefined)?.signHereTabs?.length)) return reply(400, { errorCode: "ENVELOPE_RECIPIENT_NO_TABS" });
      const id = `env-${++this.seq}`;
      this.envs.set(id, {
        id, subject: b.emailSubject, status: "sent", docName: b.documents[0].name, doc: fromBase64(b.documents[0].documentBase64),
        signers: b.recipients.signers.map((s) => ({ ...s, status: "sent" as const })),
        custom: Object.fromEntries((b.customFields?.textCustomFields ?? []).map((f) => [f.name, f.value])),
      });
      return reply(201, { envelopeId: id, status: "sent", uri: `${API}/envelopes/${id}` });
    }
    const one = path.match(/^\/envelopes\/(env-\d+)$/);
    const env = one ? this.envs.get(one[1]!) : undefined;
    if (one && method === "GET") {
      if (!env) return reply(404, { errorCode: "ENVELOPE_DOES_NOT_EXIST" });
      return reply(200, { envelopeId: env.id, status: env.status, recipients: u.searchParams.get("include") === "recipients" ? { signers: env.signers } : undefined });
    }
    if (one && method === "PUT") {
      if (!env) return reply(404);
      const b = JSON.parse(String(init.body)) as { status: string; voidedReason?: string };
      if (b.status !== "voided" || !b.voidedReason) return reply(400);
      env.status = "voided";
      return reply(200, { envelopeId: env.id });
    }
    const docs = path.match(/^\/envelopes\/(env-\d+)\/documents\/(combined|certificate)$/);
    if (docs && method === "GET") {
      const e = this.envs.get(docs[1]!);
      if (!e) return reply(404);
      return e.status === "completed" ? reply(200, docs[2] === "combined" ? SIGNED_PDF : CERT_PDF) : reply(409);
    }
    return reply(405);
  };

  open(id: string, email: string): void { this.signer(id, email).status = "delivered"; }
  sign(id: string, email: string): void {
    const env = this.envs.get(id)!;
    this.signer(id, email).status = "completed";
    if (env.signers.every((x) => x.status === "completed")) env.status = "completed";
  }
  decline(id: string, email: string, reason: string): void {
    Object.assign(this.signer(id, email), { status: "declined", declinedReason: reason });
    this.envs.get(id)!.status = "declined";
  }
  private signer(id: string, email: string): Signer { return this.envs.get(id)!.signers.find((x) => x.email === email)!; }
}

/** A Connect JSON message (SIM): the event name, the envelope with its recipients, the time DocuSign generated it. */
function connect(server: FakeDocuSign, event: string, id: string, at: string, recipientId?: string): unknown {
  const env = server.envs.get(id)!;
  return {
    event, apiVersion: "v2.1", uri: `${API}/envelopes/${id}`, retryCount: 0, configurationId: 12345, generatedDateTime: at,
    data: { accountId: ACCOUNT, userId: "usr_guid", envelopeId: id, ...(recipientId ? { recipientId } : {}), envelopeSummary: { status: env.status, recipients: { signers: env.signers } } },
  };
}

function build(server: FakeDocuSign, clock: { now: number } = { now: NOW }, http: HttpFn = server.http) {
  return docusign({ integrationKey: "ik_1", userId: "usr_guid", accountId: ACCOUNT, baseUri: `${BASE}/`, privateKey: PKCS1_PEM, http, now: () => clock.now });
}

function rig() {
  const server = new FakeDocuSign();
  const clock = { now: NOW };
  const provider = build(server, clock);
  const h = harness({ providers: { docusign: provider } });
  return { server, provider, h, clock };
}

const SIGNERS = [{ name: "Dana Whitfield", email: "dana@client.example" }, { name: "Sam Ortiz", email: "sam@client.example" }];
const sendIt = (h: Harness, thread = "thr_1") => h.call("esign.send", { fileId: FILE, recordId: RECORD, signers: SIGNERS, provider: "docusign", idempotencyKey: "k1" }, { ...dana, thread });
const hook = (h: Harness, payload: unknown) => h.call("esign.hook", { provider: "docusign", payload });

// ---- the grant and the REST client ----------------------------------------------------------------------------

test("grant: the first call trades a signed JWT for a token, later calls reuse it, it is renewed a minute before it runs out and again when DocuSign answers 401", async () => {
  const server = new FakeDocuSign();
  const clock = { now: NOW };
  const provider = build(server, clock);
  const req: EnvelopeRequest = { envelopeId: "env_abc", title: "Retainer", fileName: "Retainer.pdf", pdf: PDF, signers: [{ name: "A", email: "a@x.example", order: 1 }] };
  const { ref } = await provider.create(req);
  await provider.status(ref);
  await provider.status(ref);
  assert.equal(server.grants, 1);
  assert.deepEqual(server.log.map((l) => l.auth).filter(Boolean), ["Bearer at_1", "Bearer at_1", "Bearer at_1"]);

  clock.now += 3_539_000;
  await provider.status(ref);
  assert.equal(server.grants, 1, "59 minutes in, the token is still good");
  clock.now += 2_000;
  await provider.status(ref);
  assert.equal(server.grants, 2, "inside the last minute it is renewed");

  server.valid.clear();
  assert.equal((await provider.status(ref)).state, "sent");
  assert.equal(server.grants, 3, "a 401 renews the token once and the call goes through");

  const real = server.http;
  const stubborn: HttpFn = async (url, init) => (new URL(url).host === AUTH_HOST ? real(url, init) : { status: 401, ok: false, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
  await assert.rejects(build(server, clock, stubborn).status(ref), /answered 401/, "a second 401 is an error, not a loop");
});

test("grant: missing consent says so; a refused grant names the status; a server error is an error", async () => {
  const server = new FakeDocuSign();
  server.consentRequired = true;
  await assert.rejects(build(server).status("env-1"), /needs the user's consent/);
  server.consentRequired = false;
  const wrongKey = docusign({ integrationKey: "other", userId: "usr_guid", accountId: ACCOUNT, baseUri: BASE, privateKey: PKCS8_PEM, http: server.http });
  await assert.rejects(wrongKey.status("env-1"), /refused the sign-in \(400 invalid_grant\)/);
  server.down = true;
  await assert.rejects(build(server).status("env-1"), /refused the sign-in \(503\)/);
  assert.equal(server.log.some((l) => l.path.includes("/envelopes")), false, "no envelope call is made without a token");
  const bad = docusign({ integrationKey: "ik_1", userId: "usr_guid", accountId: ACCOUNT, baseUri: BASE, privateKey: "nope", http: server.http });
  await assert.rejects(bad.status("env-1"), /not a PEM private key/);
});

test("client: create sends the PDF as base64 with each signer, routing order and a sign-here tab, in one call; the envelope id comes back as the reference", async () => {
  const server = new FakeDocuSign();
  const provider = build(server);
  const req: EnvelopeRequest = { envelopeId: "env_abc", title: "Retainer", fileName: "Retainer.pdf", pdf: PDF, signers: [{ name: "A", email: "a@x.example", order: 1 }, { name: "B", email: "b@x.example", order: 2 }] };
  const { ref } = await provider.create(req);
  assert.equal(ref, "env-1");
  assert.deepEqual(server.log.map((l) => `${l.method} ${l.path}`), [`POST ${AUTH_HOST}/oauth/token`, `POST demo.docusign.net${API}/envelopes`]);
  const env = server.envs.get(ref)!;
  assert.equal(env.subject, "Please sign: Retainer");
  assert.equal(env.docName, "Retainer.pdf");
  assert.deepEqual([...env.doc], [...PDF]);
  assert.equal(env.custom["vyreEnvelopeId"], "env_abc");
  assert.deepEqual(env.signers.map((s) => [s.email, s.recipientId, s.routingOrder]), [["a@x.example", "1", "1"], ["b@x.example", "2", "2"]]);
  const y = env.signers.map((s) => (s.tabs as { signHereTabs: { yPosition: string }[] }).signHereTabs[0]!.yPosition);
  assert.notEqual(y[0], y[1], "boxes do not overlap");
});

test("client: a PDF larger than one chunk of the base64 encoder round-trips", async () => {
  const server = new FakeDocuSign();
  const big = Uint8Array.from({ length: 100_000 }, (_, i) => i % 251);
  const { ref } = await build(server).create({ envelopeId: "e", title: "T", fileName: "T.pdf", pdf: big, signers: [{ name: "A", email: "a@x.example", order: 1 }] });
  assert.deepEqual([...server.envs.get(ref)!.doc], [...big]);
});

test("client: status maps DocuSign's words, cancel voids with a reason, fetchSigned returns the signed PDF and the certificate, health proves the grant", async () => {
  const { server, provider } = rig();
  const { ref } = await provider.create({ envelopeId: "env_1", title: "T", fileName: "T.pdf", pdf: PDF, signers: [{ name: "Dana", email: "dana@client.example", order: 1 }, { name: "Sam", email: "sam@client.example", order: 1 }] });
  assert.deepEqual(await provider.status(ref), { state: "sent", signers: [{ name: "Dana", email: "dana@client.example", status: "sent" }, { name: "Sam", email: "sam@client.example", status: "sent" }] });
  server.open(ref, "dana@client.example");
  assert.equal((await provider.status(ref)).state, "viewed");
  server.sign(ref, "dana@client.example");
  assert.deepEqual((await provider.status(ref)).signers.map((s) => s.status), ["signed", "sent"]);
  await assert.rejects(provider.fetchSigned(ref), /answered 409/, "nothing to fetch before the last signer signs");
  server.sign(ref, "sam@client.example");
  assert.equal((await provider.status(ref)).state, "signed");
  const files = await provider.fetchSigned(ref);
  assert.deepEqual([...files.pdf], [...SIGNED_PDF]);
  assert.deepEqual([...files.certificate!], [...CERT_PDF]);
  assert.deepEqual(await provider.health!(), { ok: true });

  const second = (await provider.create({ envelopeId: "env_2", title: "T", fileName: "T.pdf", pdf: PDF, signers: [{ name: "Dana", email: "dana@client.example", order: 1 }] })).ref;
  server.decline(second, "dana@client.example", "wrong amount");
  assert.deepEqual(await provider.status(second), { state: "declined", signers: [{ name: "Dana", email: "dana@client.example", status: "declined" }], reason: "wrong amount" });
  const third = (await provider.create({ envelopeId: "env_3", title: "T", fileName: "T.pdf", pdf: PDF, signers: [{ name: "Dana", email: "dana@client.example", order: 1 }] })).ref;
  await provider.cancel(third);
  assert.equal(server.envs.get(third)!.status, "voided");
  assert.equal((await provider.status(third)).state, "cancelled");
});

test("client: a missing envelope, a rejected body or a server error throws with the status, never a partial result", async () => {
  const { server, provider } = rig();
  await assert.rejects(provider.status("env-999"), /answered 404/);
  await assert.rejects(provider.cancel("env-999"), /answered 404/);
  await assert.rejects(provider.fetchSigned("env-999"), /answered 404/);
  await assert.rejects(provider.create({ envelopeId: "e", title: "T", fileName: "T.pdf", pdf: PDF, signers: [] }), /answered 400 for POST \/envelopes/);
  assert.equal(server.envs.size, 0, "a failed create leaves no envelope");
  const sick = build(server);
  await sick.status("env-999").catch(() => undefined);
  server.down = true;
  assert.deepEqual((await sick.health!()).ok, false);
});

// ---- webhook reading ------------------------------------------------------------------------------------------

test("webhook: Connect events read as viewed, signed, completed, declined and cancelled; other events are not tracked; JSON text works; junk throws ProviderPayloadError", () => {
  const { server, provider } = rig();
  server.envs.set("env-7", { id: "env-7", subject: "T", status: "sent", docName: "T.pdf", doc: PDF, custom: {}, signers: [{ recipientId: "1", routingOrder: "1", email: "Dana@Client.example", name: "Dana", status: "completed" }] });
  const body = (event: string, at = "2026-10-25T10:00:00.000Z") => connect(server, event, "env-7", at, "1");
  const kinds: Record<string, string> = {
    "recipient-delivered": "viewed", "recipient-completed": "signed", "envelope-completed": "completed", "envelope-declined": "declined", "envelope-voided": "cancelled",
  };
  for (const [event, kind] of Object.entries(kinds)) {
    const ev = provider.webhook(body(event))!;
    assert.equal(ev.kind, kind, event);
    assert.equal(ev.ref, "env-7");
    assert.deepEqual(ev.recipients, [{ email: "dana@client.example", name: "Dana", read: true, signed: true, rejected: false }]);
  }
  for (const ignored of ["envelope-sent", "envelope-delivered", "recipient-sent", "recipient-declined", "envelope-resent", "envelope-purge", "something-new"]) assert.equal(provider.webhook(body(ignored)), null, ignored);
  assert.equal(provider.webhook(JSON.stringify(body("recipient-delivered")))!.kind, "viewed", "the text of the body");
  assert.equal(provider.webhook(body("recipient-delivered"))!.id, provider.webhook({ ...(body("recipient-delivered") as object), retryCount: 3 })!.id, "a retry has the same id");
  assert.notEqual(provider.webhook(body("recipient-delivered", "2026-10-25T11:00:00.000Z"))!.id, provider.webhook(body("recipient-delivered"))!.id, "a later event has its own id");
  const bare = provider.webhook({ event: "envelope-completed", data: { envelopeId: "env-7" } })!;
  assert.deepEqual(bare.recipients, [], "a message without recipients still names the envelope");
  for (const junk of [null, "x", "{not json", [], {}, { event: 1 }, { event: "envelope-completed" }, { event: "envelope-completed", data: {} }, { event: "envelope-completed", data: { envelopeId: 5 } }]) {
    assert.throws(() => provider.webhook(junk), ProviderPayloadError, JSON.stringify(junk));
  }
});

// ---- replay through esign.hook --------------------------------------------------------------------------------

test("replay: delivered, completed twice, envelope-completed. The signed PDF and the certificate are saved once, each event fires once, the task ends", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  const id = "env-1";
  assert.equal(h.rows("esign_envelope")[0]!.provider, "docusign");
  assert.equal(h.rows("esign_envelope")[0]!.provider_ref, id);

  server.open(id, "dana@client.example");
  await hook(h, connect(server, "recipient-delivered", id, "2026-10-25T10:00:00.000Z", "1"));
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["signature.viewed", { envelopeId, signer: "dana@client.example" }]]);
  assert.deepEqual((await h.call("esign.status", { envelopeId })).signers.map((s: { status: string }) => s.status), ["viewed", "sent"]);

  await hook(h, connect(server, "recipient-delivered", id, "2026-10-25T10:00:00.000Z", "1"));
  assert.equal(h.events.length, 0, "the same delivery again: nothing happens");

  server.sign(id, "dana@client.example");
  await hook(h, connect(server, "recipient-completed", id, "2026-10-25T10:05:00.000Z", "1"));
  assert.equal(h.events.length, 0, "one of two signed: no signature.signed yet");
  assert.deepEqual((await h.call("esign.status", { envelopeId })).signers.map((s: { status: string }) => s.status), ["signed", "sent"]);

  server.sign(id, "sam@client.example");
  await hook(h, connect(server, "recipient-completed", id, "2026-10-25T10:10:00.000Z", "2"));
  await hook(h, connect(server, "envelope-completed", id, "2026-10-25T10:10:01.000Z"));
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["signature.signed", { envelopeId, fileId: FILE }]]);
  assert.equal(h.written.length, 1);
  assert.deepEqual([...fromBase64(h.written[0]!.base64)], [...SIGNED_PDF]);
  assert.equal(h.written[0]!.fileId, FILE);
  assert.equal(h.created.length, 1, "the certificate is its own file beside the original");
  assert.deepEqual([...fromBase64(h.created[0]!.base64)], [...CERT_PDF]);
  assert.deepEqual(await h.call("esign.status", { envelopeId }), { status: "signed", signers: [{ name: "Dana Whitfield", status: "signed" }, { name: "Sam Ortiz", status: "signed" }] });
  assert.deepEqual(h.callsTo("tasks.transition").map((c) => [c.input.taskId, c.input.to]), [["tsk_sig1", "done"]]);

  await hook(h, connect(server, "envelope-completed", id, "2026-10-25T10:10:01.000Z"));
  await hook(h, connect(server, "envelope-completed", id, "2026-10-25T10:30:00.000Z"));
  await h.call("esign.fetch_signed", { envelopeId });
  assert.equal(h.written.length, 1, "re-deliveries and a hand fetch keep one saved version");
  assert.equal(h.created.length, 1);
  assert.equal(h.events.length, 0);
});

test("replay: an envelope-completed message the DocuSign API does not confirm is ignored; the real one later is applied", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  assert.deepEqual(await hook(h, connect(server, "envelope-completed", "env-1", "2026-10-25T09:00:00.000Z")), { ok: true });
  assert.equal(h.written.length, 0);
  assert.equal(h.events.length, 0);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "sent");
  assert.ok(h.warnings.some((w) => w.includes("completed webhook not confirmed")));
  server.sign("env-1", "dana@client.example");
  server.sign("env-1", "sam@client.example");
  await hook(h, connect(server, "envelope-completed", "env-1", "2026-10-25T10:00:00.000Z"));
  assert.equal(h.written.length, 1);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "signed");
});

test("replay: a decline is applied once the API confirms it, with the signer and the reason; the task is cancelled", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  server.decline("env-1", "sam@client.example", "wrong retainer amount");
  assert.deepEqual(await hook(h, connect(server, "recipient-declined", "env-1", "2026-10-25T10:00:00.000Z", "2")), { ok: true });
  assert.equal(h.events.length, 0, "DocuSign sends recipient-declined and envelope-declined for one decline; only the envelope one counts");
  await hook(h, connect(server, "envelope-declined", "env-1", "2026-10-25T10:00:05.000Z"));
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["signature.declined", { envelopeId, signer: "sam@client.example", reason: "wrong retainer amount" }]]);
  assert.deepEqual(await h.call("esign.status", { envelopeId }), { status: "declined", signers: [{ name: "Dana Whitfield", status: "sent" }, { name: "Sam Ortiz", status: "declined" }] });
  assert.deepEqual(h.callsTo("tasks.transition").map((c) => [c.input.to, c.input.note]), [["canceled", "A signer declined."]]);
  await hook(h, connect(server, "recipient-declined", "env-1", "2026-10-25T10:00:00.000Z", "2"));
  await hook(h, connect(server, "envelope-declined", "env-1", "2026-10-25T10:00:05.000Z"));
  assert.equal(h.events.length, 0, "re-deliveries change nothing");
  await refused(h.call("esign.fetch_signed", { envelopeId }), "validation.precondition_failed");
});

test("replay: a decline the API does not back is ignored", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  await hook(h, connect(server, "envelope-declined", "env-1", "2026-10-25T10:00:00.000Z"));
  assert.equal(h.events.length, 0);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "sent");
  assert.ok(h.warnings.some((w) => w.includes("declined webhook not confirmed")));
});

test("replay: an envelope voided at DocuSign cancels the envelope; events after a cancel change nothing", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  server.envs.get("env-1")!.status = "voided";
  await hook(h, connect(server, "envelope-voided", "env-1", "2026-10-25T10:00:00.000Z"));
  assert.equal((await h.call("esign.status", { envelopeId })).status, "cancelled");
  assert.deepEqual((await h.call("esign.status", { envelopeId })).signers.map((s: { status: string }) => s.status), ["cancelled", "cancelled"]);
  assert.deepEqual(h.callsTo("tasks.transition").map((c) => c.input.to), ["canceled"]);
  server.open("env-1", "dana@client.example");
  await hook(h, connect(server, "recipient-delivered", "env-1", "2026-10-25T11:00:00.000Z", "1"));
  assert.equal(h.events.length, 0);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "cancelled");
});

test("replay: a cancel from Vyre voids the envelope at DocuSign", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  assert.deepEqual(await h.call("esign.cancel", { envelopeId }), { cancelled: true });
  assert.equal(server.envs.get("env-1")!.status, "voided");
  assert.equal((await h.call("esign.status", { envelopeId })).status, "cancelled");
});

test("replay: DocuSign down while confirming returns an error and keeps the event replayable; the retry works", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  server.sign("env-1", "dana@client.example");
  server.sign("env-1", "sam@client.example");
  const body = connect(server, "envelope-completed", "env-1", "2026-10-25T10:00:00.000Z");
  server.down = true;
  await refused(hook(h, body), "provider.unavailable");
  assert.equal(h.written.length, 0);
  assert.equal(h.rows("esign_hook_seen").length, 0, "the delivery was not marked seen");
  server.down = false;
  await hook(h, body);
  assert.equal(h.written.length, 1);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "signed");
});

test("replay: envelopes that are not ours, junk bodies, and a provider that is not connected", async () => {
  const { server, h } = rig();
  await sendIt(h);
  server.envs.set("env-555", { ...server.envs.get("env-1")!, id: "env-555" });
  assert.deepEqual(await hook(h, connect(server, "recipient-delivered", "env-555", "2026-10-25T10:00:00.000Z", "1")), { ok: true });
  assert.equal(h.events.length, 0);
  assert.ok(h.warnings.some((w) => w.includes("not ours")));
  assert.deepEqual(await hook(h, connect(server, "envelope-sent", "env-1", "2026-10-25T10:00:00.000Z")), { ok: true });
  await refused(hook(h, { not: "docusign" }), "validation.bad_input");
  await refused(h.call("esign.hook", { provider: "dropbox_sign", payload: {} }), "validation.precondition_failed");
  assert.equal(h.rows("esign_hook_seen").length, 0, "ignored events are not remembered");
});

test("cleanup", () => {
  configureEsign(null);
});
