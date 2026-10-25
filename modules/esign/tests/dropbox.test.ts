// Dropbox Sign: the API v3 client, the HMAC that signs its callbacks, callback reading, and a replay of Dropbox Sign callbacks through esign.hook against a scripted
// Dropbox Sign (spec 2.20, 3.6; ARCH 8.4). The scripted server keeps signature request state like the real one, so a callback that claims more than the API says is caught.
// @reads /modules/esign/migrations/0001_esign.sql

import test from "node:test";
import assert from "node:assert/strict";
import { configureEsign, ProviderPayloadError } from "../handlers/send.ts";
import type { EnvelopeRequest } from "../handlers/send.ts";
import { dropboxSign, hmacSha256Hex, multipartForm, sha256 } from "../handlers/dropbox.ts";
import type { HttpFn, HttpResponse } from "../handlers/documenso.ts";
import { FILE, PDF, RECORD, SIGNED_PDF, dana, fromBase64, harness, refused } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";

const API_KEY = "db_sign_test_key_0123456789";
const BASIC = `Basic ${btoa(`${API_KEY}:`)}`;

// ---- the hash behind callback signatures --------------------------------------------------------------------

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

test("hmac: SHA-256 and HMAC-SHA256 agree with known vectors and with Web Crypto across block boundaries and long keys", async () => {
  assert.equal(hex(sha256(new TextEncoder().encode("abc"))), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(hex(sha256(new Uint8Array(0))), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog"), "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  for (const [keyLen, msgLen] of [[1, 0], [20, 55], [20, 56], [20, 64], [64, 119], [65, 120], [131, 1000]] as const) {
    const key = "k".repeat(keyLen), msg = "m".repeat(msgLen);
    const ck = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const want = hex(new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", ck, new TextEncoder().encode(msg))));
    assert.equal(hmacSha256Hex(key, msg), want, `key ${keyLen} bytes, message ${msgLen} bytes`);
  }
});

// ---- a scripted Dropbox Sign --------------------------------------------------------------------------------

interface Sig { signature_id: string; signer_email_address: string; signer_name: string; order: number | null; status_code: "awaiting_signature" | "signed" | "declined"; last_viewed_at: number | null; decline_reason?: string }
interface Req { id: string; title: string; subject: string; metadata: Record<string, string>; signatures: Sig[]; is_complete: boolean; is_declined: boolean; pdf: Uint8Array; fileName: string; fields: unknown; testMode: boolean; clientId: string | undefined }

/** Reads the plain fields and the file[0] part out of a multipart body, the way Dropbox Sign's send endpoint does. */
function readForm(contentType: string, body: Uint8Array): { fields: Record<string, string>; file: Uint8Array; fileName: string } {
  const boundary = /boundary=(.+)$/.exec(contentType)![1]!;
  const text = new TextDecoder("latin1").decode(body);
  const parts = text.split(`--${boundary}`).filter((x) => x.includes("Content-Disposition"));
  const fields: Record<string, string> = {};
  let file = new Uint8Array(0), fileName = "";
  for (const part of parts) {
    const name = /name="([^"]*)"/.exec(part)![1]!;
    const value = part.slice(part.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, "");
    if (name === "file[0]") {
      fileName = /filename="([^"]*)"/.exec(part)![1]!;
      file = Uint8Array.from(value, (c) => c.charCodeAt(0));
    } else fields[name] = value;
  }
  return { fields, file, fileName };
}

class FakeDropbox {
  reqs = new Map<string, Req>();
  log: { method: string; path: string; auth: string | undefined }[] = [];
  down = false;
  private seq = 0;

  http: HttpFn = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const auth = init.headers?.Authorization;
    this.log.push({ method, path: u.pathname, auth });
    const reply = (status: number, body: unknown = {}): HttpResponse => ({
      status, ok: status >= 200 && status < 300, json: async () => body, arrayBuffer: async () => (body instanceof Uint8Array ? body.slice().buffer : new ArrayBuffer(0)),
    });
    if (this.down) return reply(503);
    if (auth !== BASIC) return reply(401, { error: { error_msg: "Unauthorized user.", error_name: "unauthorized" } });
    if (method === "GET" && u.pathname === "/v3/signature_request/list") return reply(200, { signature_requests: [] });
    if (method === "POST" && u.pathname === "/v3/signature_request/send") {
      const ctype = init.headers?.["Content-Type"] ?? "";
      if (!ctype.startsWith("multipart/form-data") || !(init.body instanceof Uint8Array)) return reply(400);
      const { fields, file, fileName } = readForm(ctype, init.body);
      const signers: Sig[] = [];
      if (fields["signers[0][email_address]"] === undefined) return reply(400, { error: { error_msg: "No signers.", error_name: "bad_request" } });
      for (let i = 0; fields[`signers[${i}][email_address]`] !== undefined; i++) {
        const order = fields[`signers[${i}][order]`];
        signers.push({ signature_id: `sig_${this.seq}_${i}`, signer_email_address: fields[`signers[${i}][email_address]`]!, signer_name: fields[`signers[${i}][name]`]!, order: order === undefined ? null : Number(order), status_code: "awaiting_signature", last_viewed_at: null });
      }
      const perDoc = JSON.parse(fields["form_fields_per_document"] ?? "[]") as { signer: number }[][];
      // Dropbox Sign refuses a signer without a field to sign
      if (signers.some((_, i) => !perDoc[0]?.some((f) => f.signer === i))) return reply(400, { error: { error_msg: "A signer has no signature field.", error_name: "bad_request" } });
      const id = `sr_${++this.seq}`;
      const metadata: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) { const m = /^metadata\[(.+)\]$/.exec(k); if (m) metadata[m[1]!] = v; }
      this.reqs.set(id, { id, title: fields["title"]!, subject: fields["subject"]!, metadata, signatures: signers, is_complete: false, is_declined: false, pdf: file, fileName, fields: perDoc, testMode: fields["test_mode"] === "1", clientId: fields["client_id"] });
      return reply(200, { signature_request: this.view(id) });
    }
    const files = u.pathname.match(/^\/v3\/signature_request\/files\/(sr_\d+)$/);
    if (method === "GET" && files) {
      const r = this.reqs.get(files[1]!);
      if (!r) return reply(404);
      return r.is_complete && u.searchParams.get("file_type") === "pdf" ? reply(200, SIGNED_PDF) : reply(409);
    }
    const cancel = u.pathname.match(/^\/v3\/signature_request\/cancel\/(sr_\d+)$/);
    if (method === "POST" && cancel) return this.reqs.delete(cancel[1]!) ? reply(200) : reply(404);
    const one = u.pathname.match(/^\/v3\/signature_request\/(sr_\d+)$/);
    if (method === "GET" && one) return this.reqs.has(one[1]!) ? reply(200, { signature_request: this.view(one[1]!) }) : reply(404);
    return reply(405);
  };

  view(id: string): Record<string, unknown> {
    const r = this.reqs.get(id)!;
    return { signature_request_id: r.id, title: r.title, subject: r.subject, metadata: r.metadata, is_complete: r.is_complete, is_declined: r.is_declined, has_error: false, signatures: r.signatures };
  }
  view_(id: string, email: string): void { this.sig(id, email).last_viewed_at = 1_761_390_000; }
  sign(id: string, email: string): void {
    const r = this.reqs.get(id)!;
    Object.assign(this.sig(id, email), { status_code: "signed", last_viewed_at: 1_761_390_000 });
    if (r.signatures.every((x) => x.status_code === "signed")) r.is_complete = true;
  }
  decline(id: string, email: string, reason: string): void {
    const r = this.reqs.get(id)!;
    Object.assign(this.sig(id, email), { status_code: "declined", decline_reason: reason });
    r.is_declined = true;
  }
  private sig(id: string, email: string): Sig { return this.reqs.get(id)!.signatures.find((x) => x.signer_email_address === email)!; }
}

/** The callback Dropbox Sign posts: the event with its hash, and the signature request as it is when the event is sent. */
function callback(server: FakeDropbox, type: string, id: string, time: string, key = API_KEY): unknown {
  return {
    event: { event_time: time, event_type: type, event_hash: hmacSha256Hex(key, time + type), event_metadata: { related_signature_id: server.reqs.get(id)!.signatures[0]!.signature_id, reported_for_account_id: "acc_1", reported_for_app_id: null, event_message: null } },
    signature_request: server.view(id),
  };
}

function rig() {
  const server = new FakeDropbox();
  const provider = dropboxSign({ apiKey: API_KEY, http: server.http });
  const h = harness({ providers: { dropbox_sign: provider } });
  return { server, provider, h };
}

const SIGNERS = [{ name: "Dana Whitfield", email: "dana@client.example" }, { name: "Sam Ortiz", email: "sam@client.example" }];
const sendIt = (h: Harness, thread = "thr_1") => h.call("esign.send", { fileId: FILE, recordId: RECORD, signers: SIGNERS, provider: "dropbox_sign", idempotencyKey: "k1" }, { ...dana, thread });
const hook = (h: Harness, payload: unknown) => h.call("esign.hook", { provider: "dropbox_sign", payload });

// ---- REST client --------------------------------------------------------------------------------------------

test("client: create sends the PDF, each signer and a signature field per signer in one multipart call; the API key is the Basic user name", async () => {
  const server = new FakeDropbox();
  const provider = dropboxSign({ apiKey: API_KEY, http: server.http, clientId: "app_1", testMode: true });
  const req: EnvelopeRequest = { envelopeId: "env_abc", title: "Retainer", fileName: "Retainer.pdf", pdf: PDF, signers: [{ name: "A", email: "a@x.example", order: 1 }, { name: "B", email: "b@x.example", order: 2 }] };
  const { ref } = await provider.create(req);
  assert.equal(ref, "sr_1");
  assert.deepEqual(server.log.map((l) => `${l.method} ${l.path}`), ["POST /v3/signature_request/send"]);
  assert.equal(server.log[0]!.auth, BASIC);
  const r = server.reqs.get("sr_1")!;
  assert.equal(r.metadata["vyre_envelope"], "env_abc");
  assert.equal(r.subject, "Please sign: Retainer");
  assert.equal(r.fileName, "Retainer.pdf");
  assert.deepEqual([...r.pdf], [...PDF]);
  assert.equal(r.testMode, true);
  assert.equal(r.clientId, "app_1");
  assert.deepEqual(r.signatures.map((x) => [x.signer_email_address, x.order]), [["a@x.example", 0], ["b@x.example", 1]]);
  const fields = (r.fields as { signer: number; type: string; page: number; y: number }[][])[0]!;
  assert.equal(fields.length, 2);
  assert.ok(fields.every((f) => f.type === "signature" && f.page === 1));
  assert.notEqual(fields[0]!.y, fields[1]!.y, "boxes do not overlap");

  // one order for everyone means no order is sent, so the signers sign in parallel
  await provider.create({ ...req, signers: [{ name: "A", email: "a@x.example", order: 1 }, { name: "B", email: "b@x.example", order: 1 }] });
  assert.deepEqual(server.reqs.get("sr_2")!.signatures.map((x) => x.order), [null, null]);
  // orders 3 and 7 become 0 and 1
  await provider.create({ ...req, signers: [{ name: "A", email: "a@x.example", order: 3 }, { name: "B", email: "b@x.example", order: 7 }] });
  assert.deepEqual(server.reqs.get("sr_3")!.signatures.map((x) => x.order), [0, 1]);
});

test("client: a file name or field that could break the multipart header is made safe", async () => {
  const server = new FakeDropbox();
  const provider = dropboxSign({ apiKey: API_KEY, http: server.http });
  await provider.create({ envelopeId: "env_1", title: "T", fileName: 'a"b\r\nX: y.pdf', pdf: PDF, signers: [{ name: "A", email: "a@x.example", order: 1 }] });
  assert.equal(server.reqs.get("sr_1")!.fileName, "a_b__X_ y.pdf");
  const body = new TextDecoder().decode(multipartForm("b", [['we"ird', "v"]], "f.pdf", PDF));
  assert.match(body, /name="weird"/);
});

test("client: status maps Dropbox Sign's words, cancel removes the request, fetchSigned downloads the final PDF, health lists one request", async () => {
  const { server, provider } = rig();
  const { ref } = await provider.create({ envelopeId: "env_1", title: "T", fileName: "T.pdf", pdf: PDF, signers: [{ name: "Dana", email: "dana@client.example", order: 1 }, { name: "Sam", email: "sam@client.example", order: 1 }] });
  assert.deepEqual(await provider.status(ref), { state: "sent", signers: [{ name: "Dana", email: "dana@client.example", status: "sent" }, { name: "Sam", email: "sam@client.example", status: "sent" }] });
  server.view_(ref, "dana@client.example");
  assert.equal((await provider.status(ref)).state, "viewed");
  server.sign(ref, "dana@client.example");
  assert.deepEqual((await provider.status(ref)).signers.map((s) => s.status), ["signed", "sent"]);
  await assert.rejects(provider.fetchSigned(ref), /answered 409/, "nothing to download before the last signer signs");
  server.sign(ref, "sam@client.example");
  assert.equal((await provider.status(ref)).state, "signed");
  const files = await provider.fetchSigned(ref);
  assert.deepEqual([...files.pdf], [...SIGNED_PDF]);
  assert.equal(files.certificate, undefined, "the audit trail is inside the final PDF");
  assert.deepEqual(await provider.health!(), { ok: true });

  const second = (await provider.create({ envelopeId: "env_2", title: "T", fileName: "T.pdf", pdf: PDF, signers: [{ name: "Dana", email: "dana@client.example", order: 1 }] })).ref;
  server.decline(second, "dana@client.example", "wrong amount");
  assert.deepEqual(await provider.status(second), { state: "declined", signers: [{ name: "Dana", email: "dana@client.example", status: "declined" }], reason: "wrong amount" });
  await provider.cancel(second);
  assert.equal(server.reqs.has(second), false);
  await assert.rejects(provider.status(second), /answered 404/);
});

test("client: a wrong key, a missing request or a server error throws with the status, never a partial result", async () => {
  const server = new FakeDropbox();
  const bad = dropboxSign({ apiKey: "wrong", http: server.http });
  await assert.rejects(bad.status("sr_1"), /answered 401/);
  assert.deepEqual(await bad.health!(), { ok: false, detail: "Dropbox Sign refused the API key." });
  const good = dropboxSign({ apiKey: API_KEY, http: server.http });
  await assert.rejects(good.status("sr_999"), /answered 404/);
  await assert.rejects(good.fetchSigned("sr_999"), /answered 404/);
  await assert.rejects(good.cancel("sr_999"), /answered 404/);
  await assert.rejects(good.create({ envelopeId: "e", title: "T", fileName: "T.pdf", pdf: PDF, signers: [] }), /refused the document \(400\)/);
  server.down = true;
  await assert.rejects(good.create({ envelopeId: "e", title: "T", fileName: "T.pdf", pdf: PDF, signers: [{ name: "A", email: "a@x.example", order: 1 }] }), /refused the document \(503\)/);
  assert.deepEqual(await good.health!(), { ok: false, detail: "Dropbox Sign answered 503." });
  assert.equal(server.reqs.size, 0, "a failed create leaves no request");
});

// ---- callback reading ---------------------------------------------------------------------------------------

test("webhook: callbacks read as viewed, signed, completed, declined and cancelled; other events are not tracked; the form field, its text and the bare event all work", async () => {
  const { server, provider } = rig();
  const { ref } = await provider.create({ envelopeId: "env_1", title: "T", fileName: "T.pdf", pdf: PDF, signers: [{ name: "Dana", email: "Dana@Client.example", order: 1 }] });
  server.sign(ref, "Dana@Client.example");
  const body = (type: string) => callback(server, type, ref, "1761390000");
  const kinds: Record<string, string> = {
    signature_request_viewed: "viewed", signature_request_signed: "signed", signature_request_all_signed: "completed", signature_request_declined: "declined", signature_request_canceled: "cancelled",
  };
  for (const [type, kind] of Object.entries(kinds)) {
    const ev = provider.webhook(body(type))!;
    assert.equal(ev.kind, kind, type);
    assert.equal(ev.ref, ref);
    assert.deepEqual(ev.recipients, [{ email: "dana@client.example", name: "Dana", read: true, signed: true, rejected: false }]);
  }
  for (const ignored of ["callback_test", "signature_request_sent", "signature_request_downloadable", "signature_request_email_bounce", "file_error"]) {
    assert.equal(provider.webhook(callback(server, ignored, ref, "1761390000")), null, ignored);
  }
  const text = JSON.stringify(body("signature_request_viewed"));
  assert.equal(provider.webhook(text)!.kind, "viewed", "the text of the json field");
  assert.equal(provider.webhook({ json: text })!.kind, "viewed", "the whole form");
  assert.equal(provider.webhook(body("signature_request_viewed"))!.id, provider.webhook(body("signature_request_viewed"))!.id, "a re-delivery has the same id");
  assert.notEqual(provider.webhook(callback(server, "signature_request_viewed", ref, "1761399999"))!.id, provider.webhook(body("signature_request_viewed"))!.id, "a later event has its own id");
});

test("webhook: a callback signed with another key, an altered body, and junk are refused with ProviderPayloadError", async () => {
  const { server, provider } = rig();
  const { ref } = await provider.create({ envelopeId: "env_1", title: "T", fileName: "T.pdf", pdf: PDF, signers: [{ name: "Dana", email: "dana@client.example", order: 1 }] });
  assert.throws(() => provider.webhook(callback(server, "signature_request_all_signed", ref, "1761390000", "someone else's key")), /signature does not match/);
  const real = callback(server, "signature_request_viewed", ref, "1761390000") as { event: { event_type: string } };
  assert.throws(() => provider.webhook({ ...real, event: { ...real.event, event_type: "signature_request_all_signed" } }), ProviderPayloadError, "the type is part of the hash");
  assert.throws(() => provider.webhook({ ...real, event: { ...(real.event as object), event_time: "1" } }), ProviderPayloadError, "the time is part of the hash");
  assert.throws(() => provider.webhook({ event: { event_time: "1", event_type: "signature_request_viewed", event_hash: hmacSha256Hex(API_KEY, "1signature_request_viewed") } }), /names no document/);
  for (const junk of [null, "x", "{not json", [], {}, { event: 1 }, { event: {} }, { event: { event_time: "1", event_type: "x" } }, { json: 5 }]) {
    assert.throws(() => provider.webhook(junk), ProviderPayloadError, JSON.stringify(junk));
  }
});

// ---- replay through esign.hook ------------------------------------------------------------------------------

test("replay: opened, signed twice, completed. The signed PDF is saved as a new version once, each event fires once, the task ends", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  const id = "sr_1";
  assert.equal(h.rows("esign_envelope")[0]!.provider, "dropbox_sign");
  assert.equal(h.rows("esign_envelope")[0]!.provider_ref, id);

  server.view_(id, "dana@client.example");
  await hook(h, callback(server, "signature_request_viewed", id, "1761390001"));
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["signature.viewed", { envelopeId, signer: "dana@client.example" }]]);
  assert.deepEqual((await h.call("esign.status", { envelopeId })).signers.map((s: { status: string }) => s.status), ["viewed", "sent"]);

  await hook(h, callback(server, "signature_request_viewed", id, "1761390001"));
  assert.equal(h.events.length, 0, "the same delivery again: nothing happens");

  server.sign(id, "dana@client.example");
  await hook(h, callback(server, "signature_request_signed", id, "1761390300"));
  assert.equal(h.events.length, 0, "one of two signed: no signature.signed yet");
  assert.deepEqual((await h.call("esign.status", { envelopeId })).signers.map((s: { status: string }) => s.status), ["signed", "sent"]);

  server.sign(id, "sam@client.example");
  await hook(h, callback(server, "signature_request_signed", id, "1761390600"));
  await hook(h, callback(server, "signature_request_all_signed", id, "1761390601"));
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["signature.signed", { envelopeId, fileId: FILE }]]);
  assert.equal(h.written.length, 1);
  assert.deepEqual([...fromBase64(h.written[0]!.base64)], [...SIGNED_PDF]);
  assert.equal(h.written[0]!.fileId, FILE);
  assert.equal(h.created.length, 0, "no separate certificate file for this provider");
  assert.deepEqual(await h.call("esign.status", { envelopeId }), { status: "signed", signers: [{ name: "Dana Whitfield", status: "signed" }, { name: "Sam Ortiz", status: "signed" }] });
  assert.deepEqual(h.callsTo("tasks.transition").map((c) => [c.input.taskId, c.input.to]), [["tsk_sig1", "done"]]);

  await hook(h, callback(server, "signature_request_all_signed", id, "1761390601"));
  await hook(h, callback(server, "signature_request_all_signed", id, "1761399000"));
  await h.call("esign.fetch_signed", { envelopeId });
  assert.equal(h.written.length, 1, "re-deliveries and a hand fetch keep one saved version");
  assert.equal(h.events.length, 0);
});

test("replay: a callback with a wrong hash is refused before it reaches the envelope, and nothing changes", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  server.sign("sr_1", "dana@client.example");
  server.sign("sr_1", "sam@client.example");
  await refused(hook(h, callback(server, "signature_request_all_signed", "sr_1", "1761390000", "wrong key")), "validation.bad_input");
  assert.equal(h.written.length, 0);
  assert.equal(h.events.length, 0);
  assert.equal(h.rows("esign_hook_seen").length, 0);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "sent");
});

test("replay: an all_signed callback the API does not confirm is ignored; the real one later is applied", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  assert.deepEqual(await hook(h, callback(server, "signature_request_all_signed", "sr_1", "1761390000")), { ok: true });
  assert.equal(h.written.length, 0);
  assert.equal(h.events.length, 0);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "sent");
  assert.ok(h.warnings.some((w) => w.includes("completed webhook not confirmed")));
  server.sign("sr_1", "dana@client.example");
  server.sign("sr_1", "sam@client.example");
  await hook(h, callback(server, "signature_request_all_signed", "sr_1", "1761390900"));
  assert.equal(h.written.length, 1);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "signed");
});

test("replay: a decline is applied once the API confirms it, with the signer and the reason; the task is cancelled", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  server.decline("sr_1", "sam@client.example", "wrong retainer amount");
  await hook(h, callback(server, "signature_request_declined", "sr_1", "1761390000"));
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["signature.declined", { envelopeId, signer: "sam@client.example", reason: "wrong retainer amount" }]]);
  assert.deepEqual(await h.call("esign.status", { envelopeId }), { status: "declined", signers: [{ name: "Dana Whitfield", status: "sent" }, { name: "Sam Ortiz", status: "declined" }] });
  assert.deepEqual(h.callsTo("tasks.transition").map((c) => [c.input.to, c.input.note]), [["canceled", "A signer declined."]]);
  await hook(h, callback(server, "signature_request_declined", "sr_1", "1761390000"));
  assert.equal(h.events.length, 0, "a re-delivery changes nothing");
  await refused(h.call("esign.fetch_signed", { envelopeId }), "validation.precondition_failed");
});

test("replay: a decline the API does not back is ignored", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  await hook(h, callback(server, "signature_request_declined", "sr_1", "1761390000"));
  assert.equal(h.events.length, 0);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "sent");
  assert.ok(h.warnings.some((w) => w.includes("declined webhook not confirmed")));
});

test("replay: a request cancelled at Dropbox Sign cancels the envelope; events after a cancel change nothing", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  const cancelled = callback(server, "signature_request_canceled", "sr_1", "1761390000");
  const viewed = callback(server, "signature_request_viewed", "sr_1", "1761391000");
  server.reqs.delete("sr_1");
  await hook(h, cancelled);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "cancelled");
  assert.deepEqual((await h.call("esign.status", { envelopeId })).signers.map((s: { status: string }) => s.status), ["cancelled", "cancelled"]);
  assert.deepEqual(h.callsTo("tasks.transition").map((c) => c.input.to), ["canceled"]);
  await hook(h, viewed);
  assert.equal(h.events.length, 0);
});

test("replay: a cancel from Vyre removes the request at Dropbox Sign", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  assert.deepEqual(await h.call("esign.cancel", { envelopeId }), { cancelled: true });
  assert.equal(server.reqs.size, 0);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "cancelled");
});

test("replay: Dropbox Sign down while confirming returns an error and keeps the event replayable; the retry works", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  server.sign("sr_1", "dana@client.example");
  server.sign("sr_1", "sam@client.example");
  const body = callback(server, "signature_request_all_signed", "sr_1", "1761390000");
  server.down = true;
  await refused(hook(h, body), "provider.unavailable");
  assert.equal(h.written.length, 0);
  assert.equal(h.rows("esign_hook_seen").length, 0, "the delivery was not marked seen");
  server.down = false;
  await hook(h, body);
  assert.equal(h.written.length, 1);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "signed");
});

test("replay: requests that are not ours, the callback test, a provider that is not connected", async () => {
  const { server, h } = rig();
  await sendIt(h);
  server.reqs.set("sr_555", { ...server.reqs.get("sr_1")!, id: "sr_555" });
  assert.deepEqual(await hook(h, callback(server, "signature_request_viewed", "sr_555", "1761390000")), { ok: true });
  assert.equal(h.events.length, 0);
  assert.ok(h.warnings.some((w) => w.includes("not ours")));
  assert.deepEqual(await hook(h, callback(server, "callback_test", "sr_1", "1761390000")), { ok: true });
  await refused(h.call("esign.hook", { provider: "docusign", payload: {} }), "validation.precondition_failed");
  assert.equal(h.rows("esign_hook_seen").length, 0, "ignored events are not remembered");
});

test("cleanup", () => {
  configureEsign(null);
});
