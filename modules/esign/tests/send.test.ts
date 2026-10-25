// esign core: signature_send is held at the Gate, sending, tracking, cancelling, saving the signed file, providers and health (spec 2.20, 2.14, 3.6; ARCH 8.4).
// Real SQLite behind the host's table guard, generated validators on every input, output and event, a fake provider that records what it was asked.
// The migration is data: @reads keeps ci-select on this test instead of the whole suite.
// @reads /modules/esign/migrations/0001_esign.sql

import test from "node:test";
import assert from "node:assert/strict";
import { createInvoke, indexCapabilities } from "../../../host/src/invoke.ts";
import type { CtxSeed, GateHook, InvokeDeps } from "../../../host/src/invoke.ts";
import { registry } from "../../../generated/registry.ts";
import { validateInput } from "../../../generated/validators.ts";
import { configureEsign } from "../handlers/send.ts";
import { handlers } from "../impl.ts";
import { CERT_PDF, FILE, FOLDER, FakeProvider, PDF, RECORD, SIGNED_PDF, dana, fromBase64, harness, refused } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";

const SIGNERS = [{ name: "Dana Whitfield", email: "Dana@Client.example" }, { name: "Sam Ortiz", email: "sam@client.example", order: 2 }];

async function send(h: Harness, over: Record<string, unknown> = {}, who = dana): Promise<{ envelopeId: string }> {
  const input = Object.fromEntries(Object.entries({ fileId: FILE, recordId: RECORD, signers: SIGNERS, idempotencyKey: "k1", ...over }).filter(([, v]) => v !== undefined));
  return h.call("esign.send", input, who);
}

test("signature_send is held at the Gate: nothing reaches the provider until it is approved", async () => {
  const h = harness();
  const parked: { act: string; cap: string; input: unknown }[] = [];
  const gate: GateHook = {
    applies: (cap) => (cap.gate && cap.gate.act !== "none" ? { act: cap.gate.act } : null),
    park: async (a) => { parked.push({ act: a.act, cap: a.cap.name, input: a.input }); return { taskId: "tsk_g1" }; },
    verify: (token) => token === "apv_good",
  };
  const deps: InvokeDeps = {
    caps: indexCapabilities(registry.capabilities.filter((c) => c.name === "esign.send")),
    validateInput,
    authorize: () => ({ effect: "allow", reason: "granted", decisionId: "dec_1", obligations: [], steps: [] }) as never,
    handler: (cap) => (_ctx, input) => (handlers as Record<string, (c: ReturnType<Harness["ctxFor"]>, i: unknown) => Promise<unknown>>)[cap]!(h.ctxFor(cap, dana), input),
    commit: async (b) => b.events,
    gate,
    now: () => 1_000,
  };
  const invoke = createInvoke(deps);
  const seed = (o: Partial<CtxSeed> = {}): CtxSeed => ({ space: "spc_test", principal: { kind: "person", id: dana.id }, ...o });
  const input = { fileId: FILE, recordId: RECORD, signers: SIGNERS, idempotencyKey: "k1" };

  const first = await invoke("esign.send", input, seed());
  assert.equal(first.status, "held");
  assert.deepEqual(parked.map((p) => [p.act, p.cap]), [["signature_send", "esign.send"]]);
  assert.equal(h.provider.created.length, 0, "the provider was never called");
  assert.equal(h.rows("esign_envelope").length, 0);
  assert.equal(h.callsTo("files.read").length, 0, "the file was not even read");

  const wrong = await invoke("esign.send", input, seed({ approval: "apv_bad" }));
  assert.equal(wrong.status, "held", "a token that does not verify does not release the call");
  assert.equal(h.provider.created.length, 0);

  const approved = await invoke("esign.send", input, seed({ approval: "apv_good" }));
  assert.equal(approved.status, "ok");
  assert.equal(h.provider.created.length, 1);
  assert.equal(h.rows("esign_envelope").length, 1);
});

test("the manifest holds esign.send at signature_send, and the Gate is the only door: no other capability sends", () => {
  const send = registry.capabilities.find((c) => c.name === "esign.send")!;
  assert.deepEqual(send.gate, { act: "signature_send" });
  const sends = registry.capabilities.filter((c) => c.name.startsWith("esign.") && c.effects === "outward");
  assert.deepEqual(sends.map((c) => c.name), ["esign.send"]);
});

test("send: the PDF goes to the provider with normalised signers, an envelope and signer rows are kept, a Signature task opens, the event names the provider", async () => {
  const h = harness();
  const out = await send(h, {}, { ...dana, run: "run_1", thread: "thr_1" });
  assert.match(out.envelopeId, /^env_[a-z0-9]+$/);
  const req = h.provider.created[0]!;
  assert.equal(req.envelopeId, out.envelopeId);
  assert.equal(req.title, "Retainer");
  assert.equal(req.fileName, "Retainer.pdf");
  assert.deepEqual([...req.pdf], [...PDF]);
  assert.deepEqual(req.signers, [{ name: "Dana Whitfield", email: "dana@client.example", order: 1 }, { name: "Sam Ortiz", email: "sam@client.example", order: 2 }]);

  const env = h.rows("esign_envelope")[0]!;
  assert.deepEqual([env.id, env.provider, env.provider_ref, env.file_id, env.folder_id, env.record_id, env.status, env.thread_id, env.created_by], [out.envelopeId, "documenso", "doc_1", FILE, FOLDER, RECORD, "sent", "thr_1", dana.id]);
  assert.equal(env.task_id, "tsk_sig1");
  assert.deepEqual(h.rows("esign_signer").map((s) => [s.email, s.order_no, s.status]), [["dana@client.example", 1, "sent"], ["sam@client.example", 2, "sent"]]);

  const task = h.callsTo("tasks.create")[0]!.input;
  assert.equal(task.kind, "signature");
  assert.deepEqual(task.assigned, { kind: "person", id: dana.id });
  assert.deepEqual(task.fileIds, [FILE]);
  assert.equal(task.recordId, RECORD);
  assert.deepEqual(task.source, { kind: "run", id: "run_1" });
  assert.match(String(task.title), /Dana Whitfield, Sam Ortiz.*Retainer/);
  assert.match(String(h.callsTo("chat.post")[0]!.input.body), /Sent Retainer for signature to Dana Whitfield \(dana@client.example\)/);
  assert.equal(h.callsTo("chat.post")[0]!.input.threadId, "thr_1");

  assert.deepEqual(h.events.map((e) => [e.name, e.subject, e.payload]), [["signature.sent", `entity/${out.envelopeId}`, { envelopeId: out.envelopeId, recordId: RECORD, provider: "documenso" }]]);
});

test("send: an agent sends for the person it works for; a service sender gets no task; the record id is optional", async () => {
  const h = harness();
  await send(h, { recordId: undefined }, { id: "agt_clerk", kind: "agent", actingFor: "usr_dana" });
  assert.deepEqual(h.callsTo("tasks.create")[0]!.input.assigned, { kind: "person", id: "usr_dana" });
  assert.equal("recordId" in h.callsTo("tasks.create")[0]!.input, false);
  assert.equal("recordId" in h.events[0]!.payload, false);
  const h2 = harness();
  await send(h2, {}, { id: "svc_flow", kind: "service" });
  assert.equal(h2.callsTo("tasks.create").length, 0);
  assert.equal(h2.rows("esign_envelope").length, 1);
});

test("send: a task or thread that fails does not fail the send", async () => {
  const h = harness();
  h.callee("tasks.create", () => { throw new Error("tasks are down"); });
  h.callee("chat.post", () => { throw new Error("chat is down"); });
  const out = await send(h, {}, { ...dana, thread: "thr_1" });
  assert.equal(h.rows("esign_envelope")[0]!.task_id, null);
  assert.ok(h.warnings.some((w) => w.includes("opening the signature task")));
  assert.ok(h.warnings.some((w) => w.includes("posting in the run thread")));
  assert.equal(h.events[0]!.payload.envelopeId, out.envelopeId);
});

test("send: bad signers, wrong files and an unreadable file are refused before the provider is called", async () => {
  const h = harness();
  const bad = (signers: unknown, code = "validation.bad_input") => refused(h.call("esign.send", { fileId: FILE, signers, idempotencyKey: "k" }, dana, false), code);
  await bad([]);
  await bad("dana");
  await bad([{ name: "", email: "a@client.example" }]);
  await bad([{ name: "A", email: "not-an-email" }]);
  await bad([{ name: "A", email: "a@client.example", order: 0 }]);
  await bad([{ name: "A", email: "a@client.example", order: 1.5 }]);
  await bad([{ name: "A", email: "a@client.example" }, { name: "B", email: "A@client.example" }], "validation.duplicate");
  await bad(Array.from({ length: 21 }, (_, i) => ({ name: `S${i}`, email: `s${i}@client.example` })), "validation.too_large");
  await refused(h.call("esign.send", { fileId: FILE, signers: SIGNERS, provider: "pandadoc", idempotencyKey: "k" }, dana, false), "validation.bad_input");

  h.callee("files.get", () => ({ file: { fileId: FILE, folderId: FOLDER, name: "Retainer.docx", kind: "document", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 10, version: 1 } }));
  await refused(send(h), "validation.bad_input");
  h.callee("files.get", () => ({ file: { fileId: FILE, folderId: FOLDER, name: "Big.pdf", mime: "application/pdf", size: 26 * 1024 * 1024 } }));
  await refused(send(h), "validation.too_large");
  h.callee("files.get", () => ({ file: { fileId: FILE, folderId: FOLDER, name: "Retainer.pdf", mime: "application/pdf", size: 10 } }));
  h.callee("files.read", () => ({ base64: "", truncated: true }));
  await refused(send(h), "validation.too_large");
  h.callee("files.read", () => ({ base64: "", truncated: false }));
  await refused(send(h), "validation.too_large");
  h.callee("files.get", () => { throw Object.assign(new Error("gone"), { error: { code: "validation.not_found" } }); });
  await assert.rejects(send(h), /gone/);

  assert.equal(h.provider.created.length, 0);
  assert.equal(h.rows("esign_envelope").length, 0);
  assert.equal(h.events.length, 0);
});

test("send: a provider that is not connected or fails leaves nothing behind", async () => {
  const none = harness({ providers: null });
  await refused(send(none), "validation.precondition_failed");
  const h = harness();
  await refused(send(h, { provider: "docusign" }), "validation.precondition_failed");
  h.provider.failCreate = "connection refused";
  await refused(send(h), "provider.unavailable");
  assert.equal(h.rows("esign_envelope").length, 0);
  assert.equal(h.rows("esign_signer").length, 0);
  assert.equal(h.callsTo("tasks.create").length, 0);
  assert.equal(h.events.length, 0);
  assert.ok(h.warnings.some((w) => w.includes("provider call failed")));
});

test("status and list: signers in order, newest envelope first, filtered by record", async () => {
  const h = harness();
  const a = await send(h);
  h.advance(1000);
  const b = await send(h, { recordId: "rec_sam", idempotencyKey: "k2" });
  assert.deepEqual(await h.call("esign.status", { envelopeId: a.envelopeId }), { status: "sent", signers: [{ name: "Dana Whitfield", status: "sent" }, { name: "Sam Ortiz", status: "sent" }] });
  assert.deepEqual((await h.call("esign.list", {})).envelopes.map((e: { envelopeId: string }) => e.envelopeId), [b.envelopeId, a.envelopeId]);
  assert.deepEqual(await h.call("esign.list", { recordId: RECORD }), { envelopes: [{ envelopeId: a.envelopeId, title: "Retainer", status: "sent" }] });
  assert.deepEqual(await h.call("esign.list", { recordId: "rec_nobody" }), { envelopes: [] });
  await refused(h.call("esign.status", { envelopeId: "env_gone" }), "validation.not_found");
});

test("cancel: the provider is told, signers and the task end, saying it twice is fine, a signed envelope cannot be cancelled", async () => {
  const h = harness();
  const { envelopeId } = await send(h, {}, { ...dana, thread: "thr_1" });
  assert.deepEqual(await h.call("esign.cancel", { envelopeId }), { cancelled: true });
  assert.deepEqual(h.provider.cancelled, ["doc_1"]);
  assert.deepEqual(await h.call("esign.status", { envelopeId }), { status: "cancelled", signers: [{ name: "Dana Whitfield", status: "cancelled" }, { name: "Sam Ortiz", status: "cancelled" }] });
  assert.deepEqual(h.callsTo("tasks.transition")[0]!.input, { taskId: "tsk_sig1", to: "canceled", note: "The envelope was cancelled." });
  await h.call("esign.cancel", { envelopeId });
  assert.equal(h.provider.cancelled.length, 1, "no second call to the provider");

  const h2 = harness();
  const e2 = await send(h2);
  h2.provider.failCancel = "timeout";
  await refused(h2.call("esign.cancel", { envelopeId: e2.envelopeId }), "provider.unavailable");
  assert.equal((await h2.call("esign.status", { envelopeId: e2.envelopeId })).status, "sent", "unchanged when the provider could not cancel");
  h2.provider.failCancel = null;
  h2.provider.allSigned();
  await h2.call("esign.fetch_signed", { envelopeId: e2.envelopeId });
  await refused(h2.call("esign.cancel", { envelopeId: e2.envelopeId }), "validation.precondition_failed");
});

test("fetch_signed: refuses until everyone signed, then saves the signed PDF as a new version of the sent file", async () => {
  const h = harness();
  const { envelopeId } = await send(h, {}, { ...dana, thread: "thr_1" });
  await refused(h.call("esign.fetch_signed", { envelopeId }), "validation.precondition_failed");
  assert.equal(h.written.length, 0);
  h.provider.allSigned();
  const out = await h.call("esign.fetch_signed", { envelopeId });
  assert.deepEqual(out, { fileId: FILE });
  assert.equal(h.written.length, 1);
  assert.equal(h.written[0]!.fileId, FILE);
  assert.deepEqual([...fromBase64(h.written[0]!.base64)], [...SIGNED_PDF]);
  assert.equal(h.written[0]!.reason, "Signed by Dana Whitfield, Sam Ortiz");
  assert.equal(h.created.length, 0, "Documenso embeds its certificate, so there is no second file");
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["signature.signed", { envelopeId, fileId: FILE }]]);
  assert.deepEqual(h.callsTo("tasks.transition").map((c) => [c.input.taskId, c.input.to]), [["tsk_sig1", "done"]]);
  assert.match(String(h.callsTo("chat.post").pop()!.input.body), /Retainer is signed/);
  assert.deepEqual(await h.call("esign.status", { envelopeId }), { status: "signed", signers: [{ name: "Dana Whitfield", status: "signed" }, { name: "Sam Ortiz", status: "signed" }] });

  // again: the same file, nothing saved twice, no second event
  assert.deepEqual(await h.call("esign.fetch_signed", { envelopeId }), { fileId: FILE });
  assert.equal(h.written.length, 1);
  assert.equal(h.provider.fetched.length, 1);
});

test("fetch_signed: a provider that keeps the certificate apart gets it saved beside the file; failures save nothing", async () => {
  const h = harness();
  const { envelopeId } = await send(h);
  h.provider.allSigned();
  h.provider.files = { pdf: SIGNED_PDF, certificate: CERT_PDF };
  h.provider.failFetch = "download failed";
  await refused(h.call("esign.fetch_signed", { envelopeId }), "provider.unavailable");
  assert.equal(h.written.length, 0);
  assert.equal(h.events.length, 0);
  assert.equal((await h.call("esign.status", { envelopeId })).status, "sent");
  h.provider.failFetch = null;
  await h.call("esign.fetch_signed", { envelopeId });
  assert.deepEqual(h.created.map((c) => [c.folderId, c.name]), [[FOLDER, "Retainer - signature certificate.pdf"]]);
  assert.deepEqual([...fromBase64(h.created[0]!.base64)], [...CERT_PDF]);
  assert.equal(h.rows("esign_envelope")[0]!.certificate_file_id, "fil_cert1");

  const empty = harness();
  const e = await send(empty);
  empty.provider.allSigned();
  empty.provider.files = { pdf: new Uint8Array(0) };
  await refused(empty.call("esign.fetch_signed", { envelopeId: e.envelopeId }), "provider.bad_response");
});

test("providers: all three are listed, Documenso is the default, only a connected one can become the default", async () => {
  const h = harness();
  assert.deepEqual((await h.call("esign.providers", {})).providers, [
    { key: "documenso", default: true, connected: true }, { key: "dropbox_sign", default: false, connected: false }, { key: "docusign", default: false, connected: false },
  ]);
  await refused(h.call("esign.provider_set", { provider: "docusign" }), "validation.precondition_failed");
  const both = harness({ providers: { documenso: new FakeProvider(), docusign: new FakeProvider() } });
  await both.call("esign.provider_set", { provider: "docusign" });
  assert.equal((await both.call("esign.providers", {})).providers.find((p: { default: boolean }) => p.default).key, "docusign");
  await both.call("esign.provider_set", { provider: "documenso" });
  assert.equal(both.rows("esign_setting").length, 1, "one row, updated");
  await both.call("esign.provider_set", { provider: "docusign" });
  const out = await both.call("esign.send", { fileId: FILE, signers: SIGNERS, idempotencyKey: "k" });
  assert.equal(both.rows("esign_envelope").find((r) => r.id === out.envelopeId)!.provider, "docusign", "send uses the default");
});

test("health: healthy, down when the provider says so, throws or is not connected, degraded when slow", async () => {
  const h = harness();
  assert.equal((await h.call("esign.health", {})).state, "healthy");
  h.provider.healthy = { ok: false, detail: "Documenso answered 502." };
  assert.deepEqual({ ...(await h.call("esign.health", {})), latencyMs: 0 }, { state: "down", detail: "Documenso answered 502.", latencyMs: 0 });
  h.provider.healthy = new Error("ECONNREFUSED");
  assert.deepEqual(await h.call("esign.health", {}), { state: "down", detail: "ECONNREFUSED" });
  assert.deepEqual(await harness({ providers: null }).call("esign.health", {}), { state: "down", detail: "documenso is not connected." });
  const slow = harness();
  slow.provider.healthy = { ok: true };
  slow.provider.health = async () => { await new Promise((r) => setTimeout(r, 2100)); return { ok: true }; };
  const r = await slow.call("esign.health", {});
  assert.equal(r.state, "degraded");
  assert.ok(r.latencyMs >= 2000);
});

test("cleanup", () => {
  configureEsign(null);
});
