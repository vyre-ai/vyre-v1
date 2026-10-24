// Documenso: the pinned container files, the REST client, webhook reading, and a replay of Documenso webhooks through esign.hook against a scripted Documenso (spec 2.20, 3.6; ARCH 8.4).
// The scripted server keeps document state like the real one, so a webhook that claims more than the API says is caught.
// @reads /images/documenso/documenso.lock
// @reads /images/documenso/compose.yml
// @reads /modules/esign/migrations/0001_esign.sql

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { configureEsign, ProviderPayloadError } from "../handlers/send.ts";
import type { EnvelopeRequest } from "../handlers/send.ts";
import { documenso, parseLock } from "../handlers/documenso.ts";
import type { HttpFn, HttpResponse } from "../handlers/documenso.ts";
import { FILE, PDF, RECORD, SIGNED_PDF, dana, fromBase64, harness, refused } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";

const lockText = readFileSync(new URL("../../../images/documenso/documenso.lock", import.meta.url), "utf8");
const compose = readFileSync(new URL("../../../images/documenso/compose.yml", import.meta.url), "utf8");

// ---- the container files ------------------------------------------------------------------------------------

test("lock: both images are pinned by sha256 digest, and the compose file runs exactly what the lock names", () => {
  const lock = parseLock(lockText);
  assert.match(lock.documenso.image, /^documenso\/documenso:v\d+\.\d+\.\d+$/, "a release tag beside the digest, never latest");
  assert.match(lock.postgres.image, /^postgres:\d+(\.\d+)?-alpine$/);
  assert.match(lock.documenso.digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(lock.postgres.digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(compose, /image: \$\{DOCUMENSO_IMAGE\}/);
  assert.match(compose, /image: \$\{POSTGRES_IMAGE\}/);
  assert.equal(/image: (?!\$\{)/.test(compose), false, "no image in the compose file is named outside the lock");
  assert.throws(() => parseLock("DOCUMENSO_IMAGE=documenso/documenso:latest\nPOSTGRES_IMAGE=postgres:16@sha256:" + "a".repeat(64)), /not pinned by digest/);
  assert.throws(() => parseLock("DOCUMENSO_IMAGE=documenso/documenso:v2@sha256:abc\nPOSTGRES_IMAGE=postgres:16@sha256:" + "a".repeat(64)), /malformed digest/);
  assert.throws(() => parseLock(""), /DOCUMENSO_IMAGE/);
});

test("compose: the database is on an internal-only network with no published port; Documenso listens on 127.0.0.1 only; no secret is written in the file", () => {
  assert.match(compose, /documenso-internal:\n    internal: true/);
  const db = compose.slice(compose.indexOf("  documenso-db:"), compose.indexOf("  documenso:\n"));
  assert.equal(/ports:/.test(db), false, "no published port on the database");
  assert.match(db, /- documenso-internal\b/);
  assert.equal(/documenso-edge/.test(db), false, "the database has no route out");
  const app = compose.slice(compose.indexOf("  documenso:\n"), compose.indexOf("networks:\n  documenso-internal"));
  assert.match(app, /"127\.0\.0\.1:\$\{DOCUMENSO_PORT:-3010\}:3000"/);
  assert.match(app, /- documenso-internal\b/);
  assert.match(app, /- documenso-edge\b/);
  for (const secret of ["NEXTAUTH_SECRET", "NEXT_PRIVATE_ENCRYPTION_KEY", "NEXT_PRIVATE_SMTP_PASSWORD", "POSTGRES_PASSWORD"]) {
    const line = compose.split("\n").find((l) => l.includes(`${secret}:`))!;
    assert.match(line, /\$\{[A-Z_]+\}/, `${secret} comes from the environment`);
  }
  assert.equal(/documenso:\s*\n\s+build:/.test(compose), false, "never built or forked");
  assert.ok((compose.match(/no-new-privileges:true/g) ?? []).length >= 2);
});

// ---- a scripted Documenso -----------------------------------------------------------------------------------

interface Recipient { id: number; name: string; email: string; role: string; signingOrder?: number; signingStatus: "NOT_SIGNED" | "SIGNED" | "REJECTED"; readStatus: "NOT_OPENED" | "OPENED"; rejectionReason?: string }
interface Doc { id: number; title: string; externalId: string; status: "DRAFT" | "PENDING" | "COMPLETED" | "REJECTED"; recipients: Recipient[]; meta: Record<string, unknown>; pdf?: Uint8Array }

class FakeDocumenso {
  docs = new Map<number, Doc>();
  log: { method: string; path: string; auth?: string | undefined; body?: unknown }[] = [];
  down = false;
  private seq = 100;
  token = "api_test_token";

  http: HttpFn = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const auth = init.headers?.Authorization;
    this.log.push({ method, path: u.pathname, auth, ...(typeof init.body === "string" ? { body: JSON.parse(init.body) } : {}) });
    const reply = (status: number, body: unknown = {}): HttpResponse => ({
      status, ok: status >= 200 && status < 300, json: async () => body, arrayBuffer: async () => (body instanceof Uint8Array ? body.slice().buffer : new ArrayBuffer(0)),
    });
    if (this.down) return reply(503);
    if (u.pathname === "/api/health") return reply(200, { status: "ok" });
    if (u.pathname.startsWith("/upload/")) {
      const doc = this.docs.get(Number(u.pathname.split("/")[2]));
      if (!doc || !(init.body instanceof Uint8Array)) return reply(400);
      doc.pdf = init.body;
      return reply(200);
    }
    if (u.pathname.startsWith("/signed/")) return reply(200, SIGNED_PDF);
    if (u.pathname.startsWith("/api/v1/") && auth !== this.token) return reply(401);
    if (method === "POST" && u.pathname === "/api/v1/documents") {
      const b = JSON.parse(String(init.body)) as { title: string; externalId: string; recipients: { name: string; email: string; role: string; signingOrder?: number }[]; meta: Record<string, unknown> };
      const id = ++this.seq;
      this.docs.set(id, { id, title: b.title, externalId: b.externalId, status: "DRAFT", meta: b.meta, recipients: b.recipients.map((r, i) => ({ id: id * 10 + i, ...r, signingStatus: "NOT_SIGNED", readStatus: "NOT_OPENED" })) });
      return reply(200, { uploadUrl: `http://documenso.test/upload/${id}`, documentId: id, recipients: [] });
    }
    const m = u.pathname.match(/^\/api\/v1\/documents\/(\d+)(\/send|\/download)?$/);
    const doc = m ? this.docs.get(Number(m[1])) : undefined;
    if (!m || !doc) return reply(404);
    if (method === "POST" && m[2] === "/send") { doc.status = "PENDING"; return reply(200, { message: "sent" }); }
    if (method === "GET" && m[2] === "/download") return reply(200, { downloadUrl: `http://documenso.test/signed/${doc.id}` });
    if (method === "GET" && !m[2]) return reply(200, { id: doc.id, title: doc.title, externalId: doc.externalId, status: doc.status, recipients: doc.recipients });
    if (method === "DELETE") { this.docs.delete(doc.id); return reply(200, {}); }
    return reply(405);
  };

  open(id: number, email: string): void { this.rec(id, email).readStatus = "OPENED"; }
  sign(id: number, email: string): void {
    const doc = this.docs.get(id)!;
    this.rec(id, email).signingStatus = "SIGNED";
    if (doc.recipients.every((r) => r.signingStatus === "SIGNED")) doc.status = "COMPLETED";
  }
  reject(id: number, email: string, reason: string): void {
    const doc = this.docs.get(id)!;
    Object.assign(this.rec(id, email), { signingStatus: "REJECTED", rejectionReason: reason });
    doc.status = "REJECTED";
  }
  private rec(id: number, email: string): Recipient { return this.docs.get(id)!.recipients.find((r) => r.email === email)!; }
}

/** The webhook body Documenso posts: the event name, the document with its recipients, a timestamp. */
function hookBody(server: FakeDocumenso, event: string, id: number, at: string): unknown {
  const doc = server.docs.get(id)!;
  return { event, payload: { id, externalId: doc.externalId, title: doc.title, status: doc.status, Recipient: doc.recipients }, createdAt: at, webhookEndpoint: "https://space.example/hooks/esign" };
}

function rig() {
  const server = new FakeDocumenso();
  const provider = documenso({ baseUrl: "http://documenso.test/", apiToken: server.token, http: server.http });
  const h = harness({ providers: { documenso: provider } });
  return { server, provider, h };
}

const SIGNERS = [{ name: "Dana Whitfield", email: "dana@client.example" }, { name: "Sam Ortiz", email: "sam@client.example" }];
const sendIt = (h: Harness, thread = "thr_1") => h.call("esign.send", { fileId: FILE, recordId: RECORD, signers: SIGNERS, idempotencyKey: "k1" }, { ...dana, thread });
const hook = (h: Harness, payload: unknown) => h.call("esign.hook", { provider: "documenso", payload });

// ---- REST client --------------------------------------------------------------------------------------------

test("client: create posts the recipients, uploads the PDF to the returned address, then sends; the token goes in the Authorization header as is", async () => {
  const server = new FakeDocumenso();
  const provider = documenso({ baseUrl: "http://documenso.test", apiToken: server.token, http: server.http });
  const req: EnvelopeRequest = { envelopeId: "env_abc", title: "Retainer", fileName: "Retainer.pdf", pdf: PDF, signers: [{ name: "A", email: "a@x.example", order: 1 }, { name: "B", email: "b@x.example", order: 2 }] };
  const { ref } = await provider.create(req);
  assert.equal(ref, "101");
  assert.deepEqual(server.log.map((l) => `${l.method} ${l.path}`), ["POST /api/v1/documents", "PUT /upload/101", "POST /api/v1/documents/101/send"]);
  assert.equal(server.log[0]!.auth, "api_test_token");
  const doc = server.docs.get(101)!;
  assert.equal(doc.externalId, "env_abc");
  assert.equal(doc.status, "PENDING");
  assert.deepEqual([...doc.pdf!], [...PDF]);
  assert.deepEqual(doc.recipients.map((r) => [r.email, r.role, r.signingOrder]), [["a@x.example", "SIGNER", 1], ["b@x.example", "SIGNER", 2]]);
  assert.equal(doc.meta.signingOrder, "SEQUENTIAL");
  await provider.create({ ...req, signers: [{ name: "A", email: "a@x.example", order: 1 }] });
  assert.equal(server.docs.get(102)!.meta.signingOrder, "PARALLEL");
});

test("client: status maps Documenso's words, cancel deletes, fetchSigned downloads the signed PDF, health reads /api/health", async () => {
  const { server, provider } = rig();
  const { ref } = await provider.create({ envelopeId: "env_1", title: "T", fileName: "T.pdf", pdf: PDF, signers: [{ name: "Dana", email: "dana@client.example", order: 1 }, { name: "Sam", email: "sam@client.example", order: 1 }] });
  const id = Number(ref);
  assert.deepEqual(await provider.status(ref), { state: "sent", signers: [{ name: "Dana", email: "dana@client.example", status: "sent" }, { name: "Sam", email: "sam@client.example", status: "sent" }] });
  server.open(id, "dana@client.example");
  assert.equal((await provider.status(ref)).state, "viewed");
  server.sign(id, "dana@client.example");
  assert.deepEqual((await provider.status(ref)).signers.map((s) => s.status), ["signed", "sent"]);
  server.sign(id, "sam@client.example");
  assert.equal((await provider.status(ref)).state, "signed");
  const files = await provider.fetchSigned(ref);
  assert.deepEqual([...files.pdf], [...SIGNED_PDF]);
  assert.equal(files.certificate, undefined);
  assert.deepEqual(await provider.health!(), { ok: true });

  const second = (await provider.create({ envelopeId: "env_2", title: "T", fileName: "T.pdf", pdf: PDF, signers: [{ name: "Dana", email: "dana@client.example", order: 1 }] })).ref;
  server.reject(Number(second), "dana@client.example", "wrong amount");
  assert.deepEqual(await provider.status(second), { state: "declined", signers: [{ name: "Dana", email: "dana@client.example", status: "declined" }], reason: "wrong amount" });
  await provider.cancel(second);
  assert.equal(server.docs.has(Number(second)), false);
});

test("client: a wrong token, a missing document or a server error throws with the status, never a partial result", async () => {
  const server = new FakeDocumenso();
  const bad = documenso({ baseUrl: "http://documenso.test", apiToken: "wrong", http: server.http });
  await assert.rejects(bad.status("1"), /answered 401/);
  const good = documenso({ baseUrl: "http://documenso.test", apiToken: server.token, http: server.http });
  await assert.rejects(good.status("999"), /answered 404/);
  await assert.rejects(good.fetchSigned("999"), /answered 404/);
  server.down = true;
  await assert.rejects(good.create({ envelopeId: "e", title: "T", fileName: "T.pdf", pdf: PDF, signers: [{ name: "A", email: "a@x.example", order: 1 }] }), /answered 503/);
  assert.deepEqual(await good.health!(), { ok: false, detail: "Documenso answered 503." });
  assert.equal(server.docs.size, 0, "a failed create leaves no document");
});

// ---- webhook reading ----------------------------------------------------------------------------------------

test("webhook: Documenso events read as viewed, signed, completed, declined and cancelled; other events are not tracked; junk throws ProviderPayloadError", () => {
  const { server, provider } = rig();
  server.docs.set(7, { id: 7, title: "T", externalId: "env_1", status: "PENDING", meta: {}, recipients: [{ id: 70, name: "Dana", email: "Dana@Client.example", role: "SIGNER", signingStatus: "SIGNED", readStatus: "OPENED" }] });
  const body = (event: string) => hookBody(server, event, 7, "2026-10-25T10:00:00Z");
  const kinds: Record<string, string> = { DOCUMENT_OPENED: "viewed", DOCUMENT_SIGNED: "signed", DOCUMENT_COMPLETED: "completed", DOCUMENT_REJECTED: "declined", DOCUMENT_CANCELLED: "cancelled" };
  for (const [event, kind] of Object.entries(kinds)) {
    const ev = provider.webhook(body(event))!;
    assert.equal(ev.kind, kind, event);
    assert.equal(ev.ref, "7");
    assert.deepEqual(ev.recipients, [{ email: "dana@client.example", name: "Dana", read: true, signed: true, rejected: false }]);
  }
  for (const ignored of ["DOCUMENT_CREATED", "DOCUMENT_SENT", "SOMETHING_NEW"]) assert.equal(provider.webhook(body(ignored)), null, ignored);
  assert.equal(provider.webhook(body("DOCUMENT_OPENED"))!.id, provider.webhook(body("DOCUMENT_OPENED"))!.id, "a re-delivery has the same id");
  assert.notEqual(provider.webhook(hookBody(server, "DOCUMENT_OPENED", 7, "2026-10-25T11:00:00Z"))!.id, provider.webhook(body("DOCUMENT_OPENED"))!.id, "a later event has its own id");
  for (const junk of [null, "x", [], {}, { event: 1 }, { event: "DOCUMENT_OPENED" }, { event: "DOCUMENT_OPENED", payload: {} }]) {
    assert.throws(() => provider.webhook(junk), ProviderPayloadError, JSON.stringify(junk));
  }
});

// ---- replay through esign.hook ------------------------------------------------------------------------------

test("replay: opened, signed twice, completed. The signed PDF is saved as a new version once, each event fires once, the task ends", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  const id = 101;
  assert.equal(server.docs.get(id)!.status, "PENDING");
  assert.equal(h.rows("esign_envelope")[0]!.provider_ref, "101");

  server.open(id, "dana@client.example");
  await hook(h, hookBody(server, "DOCUMENT_OPENED", id, "2026-10-25T10:00:00Z"));
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["signature.viewed", { envelopeId, signer: "dana@client.example" }]]);
  assert.deepEqual((await h.call("esign.status", { envelopeId })).signers.map((s: { status: string }) => s.status), ["viewed", "sent"]);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "viewed");

  // the same delivery again: nothing happens
  await hook(h, hookBody(server, "DOCUMENT_OPENED", id, "2026-10-25T10:00:00Z"));
  assert.equal(h.events.length, 0);

  server.sign(id, "dana@client.example");
  await hook(h, hookBody(server, "DOCUMENT_SIGNED", id, "2026-10-25T10:05:00Z"));
  assert.equal(h.events.length, 0, "one of two signed: no signature.signed yet");
  assert.deepEqual((await h.call("esign.status", { envelopeId })).signers.map((s: { status: string }) => s.status), ["signed", "sent"]);

  server.sign(id, "sam@client.example");
  await hook(h, hookBody(server, "DOCUMENT_SIGNED", id, "2026-10-25T10:10:00Z"));
  await hook(h, hookBody(server, "DOCUMENT_COMPLETED", id, "2026-10-25T10:10:01Z"));
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["signature.signed", { envelopeId, fileId: FILE }]]);
  assert.equal(h.written.length, 1);
  assert.deepEqual([...fromBase64(h.written[0]!.base64)], [...SIGNED_PDF]);
  assert.equal(h.written[0]!.fileId, FILE);
  assert.deepEqual(await h.call("esign.status", { envelopeId }), { status: "signed", signers: [{ name: "Dana Whitfield", status: "signed" }, { name: "Sam Ortiz", status: "signed" }] });
  assert.deepEqual(h.callsTo("tasks.transition").map((c) => [c.input.taskId, c.input.to]), [["tsk_sig1", "done"]]);
  assert.ok(h.callsTo("chat.post").some((c) => /Retainer is signed/.test(String(c.input.body))));

  // Documenso re-delivers the completion later, and esign.fetch_signed is asked for by hand: still one saved version
  await hook(h, hookBody(server, "DOCUMENT_COMPLETED", id, "2026-10-25T10:10:01Z"));
  await hook(h, hookBody(server, "DOCUMENT_COMPLETED", id, "2026-10-25T10:30:00Z"));
  await h.call("esign.fetch_signed", { envelopeId });
  assert.equal(h.written.length, 1);
  assert.equal(h.events.length, 0);
  assert.equal(h.rows("esign_envelope")[0]!.signed_file_id, FILE);
});

test("replay: a completed webhook the Documenso API does not confirm is ignored; the real one later is applied", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  const forged = hookBody(server, "DOCUMENT_COMPLETED", 101, "2026-10-25T09:00:00Z");
  assert.deepEqual(await hook(h, forged), { ok: true });
  assert.equal(h.written.length, 0);
  assert.equal(h.events.length, 0);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "sent");
  assert.ok(h.warnings.some((w) => w.includes("completed webhook not confirmed")));
  server.sign(101, "dana@client.example");
  server.sign(101, "sam@client.example");
  await hook(h, hookBody(server, "DOCUMENT_COMPLETED", 101, "2026-10-25T10:00:00Z"));
  assert.equal(h.written.length, 1);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "signed");
});

test("replay: a rejection is applied once the API confirms it, with the signer and the reason; the task is cancelled", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  server.reject(101, "sam@client.example", "wrong retainer amount");
  await hook(h, hookBody(server, "DOCUMENT_REJECTED", 101, "2026-10-25T10:00:00Z"));
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["signature.declined", { envelopeId, signer: "sam@client.example", reason: "wrong retainer amount" }]]);
  assert.deepEqual(await h.call("esign.status", { envelopeId }), { status: "declined", signers: [{ name: "Dana Whitfield", status: "sent" }, { name: "Sam Ortiz", status: "declined" }] });
  assert.deepEqual(h.callsTo("tasks.transition").map((c) => [c.input.to, c.input.note]), [["canceled", "A signer declined."]]);
  assert.ok(h.callsTo("chat.post").some((c) => /sam@client.example declined to sign Retainer: wrong retainer amount/.test(String(c.input.body))));
  await hook(h, hookBody(server, "DOCUMENT_REJECTED", 101, "2026-10-25T10:00:00Z"));
  assert.equal(h.events.length, 0, "a re-delivery changes nothing");
  await refused(h.call("esign.fetch_signed", { envelopeId }), "validation.precondition_failed");
});

test("replay: a rejection claim the API does not back is ignored", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  const claim = hookBody(server, "DOCUMENT_REJECTED", 101, "2026-10-25T10:00:00Z");
  await hook(h, claim);
  assert.equal(h.events.length, 0);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "sent");
  assert.ok(h.warnings.some((w) => w.includes("declined webhook not confirmed")));
});

test("replay: a document deleted at Documenso cancels the envelope; events after a cancel change nothing", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  server.open(101, "sam@client.example");
  const cancelled = hookBody(server, "DOCUMENT_CANCELLED", 101, "2026-10-25T10:00:00Z");
  const opened = hookBody(server, "DOCUMENT_OPENED", 101, "2026-10-25T11:00:00Z");
  server.docs.delete(101);
  await hook(h, cancelled);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "cancelled");
  assert.deepEqual((await h.call("esign.status", { envelopeId })).signers.map((s: { status: string }) => s.status), ["cancelled", "cancelled"]);
  assert.deepEqual(h.callsTo("tasks.transition").map((c) => c.input.to), ["canceled"]);
  await hook(h, opened);
  assert.equal(h.events.length, 0);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "cancelled");
});

test("replay: Documenso down while confirming returns an error and keeps the event replayable; the retry works", async () => {
  const { server, h } = rig();
  const { envelopeId } = await sendIt(h);
  server.sign(101, "dana@client.example");
  server.sign(101, "sam@client.example");
  const body = hookBody(server, "DOCUMENT_COMPLETED", 101, "2026-10-25T10:00:00Z");
  server.down = true;
  await refused(hook(h, body), "provider.unavailable");
  assert.equal(h.written.length, 0);
  assert.equal(h.rows("esign_hook_seen").length, 0, "the delivery was not marked seen");
  server.down = false;
  await hook(h, body);
  assert.equal(h.written.length, 1);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "signed");
});

test("replay: documents that are not ours, junk bodies, unknown providers and a provider that is not connected", async () => {
  const { server, h } = rig();
  await sendIt(h);
  server.docs.set(555, { id: 555, title: "Other", externalId: "other", status: "PENDING", meta: {}, recipients: [{ id: 5550, name: "X", email: "x@y.example", role: "SIGNER", signingStatus: "NOT_SIGNED", readStatus: "OPENED" }] });
  assert.deepEqual(await hook(h, hookBody(server, "DOCUMENT_OPENED", 555, "2026-10-25T10:00:00Z")), { ok: true });
  assert.equal(h.events.length, 0);
  assert.ok(h.warnings.some((w) => w.includes("not ours")));
  assert.deepEqual(await hook(h, hookBody(server, "DOCUMENT_CREATED", 101, "2026-10-25T10:00:00Z")), { ok: true });
  await refused(hook(h, { not: "documenso" }), "validation.bad_input");
  await refused(h.call("esign.hook", { provider: "pandadoc", payload: {} }, dana, false), "validation.bad_input");
  await refused(h.call("esign.hook", { provider: "docusign", payload: {} }), "validation.precondition_failed");
  assert.equal(h.rows("esign_hook_seen").length, 0, "ignored events are not remembered");
});

test("cleanup", () => {
  configureEsign(null);
});
