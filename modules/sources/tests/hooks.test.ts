// @reads /modules/sources/migrations/0001_sources.sql
// The inbound pipeline: signatures fail closed, a repeated provider id is dropped, a mapping failure keeps the delivery for replay, sure matches link and unsure ones wait for a person.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mintUuid } from "../../../lib/ids.ts";
import { fakeCall } from "../fixtures/records.ts";
import { openSources } from "../impl.ts";
import { hmacSha256Hex, normalise, parseBody, pointerGet, verifyDelivery } from "../projections.ts";
import type { Mapping } from "../projections.ts";

const NOW = 1_800_000_000_000;
const SECRET = "whsec_test";
const code = (c: string) => (e: unknown) => {
  assert.equal((e as { error?: { code?: string } }).error?.code, c);
  return true;
};
const LEAD = { name: "lead", label: "Lead", fields: [
  { name: "email", kind: "text", label: "Email", required: true }, { name: "name", kind: "text", label: "Name" }, { name: "phone", kind: "text", label: "Phone" },
  { name: "amount", kind: "number", label: "Amount" }, { name: "ext_id", kind: "text", label: "External id" },
] };
const PERSON = { name: "person", label: "Person", fields: [{ name: "email", kind: "text", label: "Email" }, { name: "name", kind: "text", label: "Name" }, { name: "phone", kind: "text", label: "Phone" }] };

const LEAD_MAP: Mapping = {
  dedupe: "/id",
  fields: [{ from: "/id", to: "ext_id" }, { from: "/customer/email", to: "email", transform: "lower(value)" }, { from: "/customer/name", to: "name" }, { from: "/amount", to: "amount" }],
  match: ["ext_id"],
};
const PERSON_MAP: Mapping = { dedupe: "/id", fields: [{ from: "/email", to: "email" }, { from: "/name", to: "name" }, { from: "/phone", to: "phone" }], match: [], link: ["email"] };

async function kit(o: { secrets?: Record<string, string>; maxBodyBytes?: number } = {}) {
  const clock = { t: NOW };
  const secrets = o.secrets ?? { Whsec: SECRET };
  const s = openSources({ now: () => clock.t, secret: async (n) => secrets[n], ...(o.maxBodyBytes ? { maxBodyBytes: o.maxBodyBytes } : {}) });
  await s.store!.define({ add_types: [LEAD, PERSON] });
  const calls: { cap: string; input: unknown }[] = [];
  const seen: { name: string; subject: string; payload: Record<string, any> }[] = [];
  const ctx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" }, actor: "usr_dana",
    emit: (name: string, subject: string, payload: Record<string, unknown>) => { seen.push({ name, subject, payload }); },
    call: fakeCall(s.store!, calls),
  };
  const h = s.handlers;
  const events = (name: string) => seen.filter((e) => e.name === name).map((e) => e.payload);
  const signed = (obj: unknown, secret = SECRET, extra: Record<string, string> = {}) => {
    const body = typeof obj === "string" ? obj : JSON.stringify(obj);
    return { body, headers: { "X-Hub-Signature-256": `sha256=${hmacSha256Hex(secret, body)}`, ...extra } };
  };
  const ingest = (source: string, obj: unknown, o2: { secret?: string; runAutomations?: boolean; headers?: Record<string, string> } = {}) => {
    const { body, headers } = signed(obj, o2.secret);
    return h["sources.ingest"](ctx, { source, receivedAt: clock.t, headers: o2.headers ?? headers, body, ...(o2.runAutomations !== undefined ? { runAutomations: o2.runAutomations } : {}) });
  };
  const leadSource = async (extra: Record<string, unknown> = {}) =>
    (await h["sources.create"](ctx, { connector: "webhook", title: "Shop leads", type: "lead", mapping: LEAD_MAP, secretName: "Whsec", ...extra } as never)).source;
  const personSource = async (mapping: Mapping = PERSON_MAP) =>
    (await h["sources.create"](ctx, { connector: "webhook", title: "People feed", type: "person", mapping, secretName: "Whsec" })).source;
  const rows = async (type: string) => (await s.store!.query(type, { page: { limit: 100 } })).rows;
  return { s, h, ctx, seen, calls, clock, events, signed, ingest, leadSource, personSource, rows };
}
const order = (id: string, extra: Record<string, unknown> = {}) => ({ id, amount: 12, customer: { email: "Ann@X.com", name: "Ann" }, ...extra });

test("hmac-sha256: the published test vectors", () => {
  assert.equal(hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog"), "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  assert.equal(hmacSha256Hex(new Uint8Array(20).fill(0x0b), "Hi There"), "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
  assert.equal(hmacSha256Hex(new Uint8Array(131).fill(0xaa), "Test Using Larger Than Block-Size Key - Hash Key First"), "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");
});

test("verifyDelivery: hex, prefixed and base64 hmac, timestamped signatures with a 5 minute window", () => {
  const body = '{"a":1}';
  const hex = hmacSha256Hex(SECRET, body);
  assert.deepEqual(verifyDelivery("hmac", SECRET, { "x-signature": hex }, body, NOW), { ok: true });
  assert.deepEqual(verifyDelivery("hmac", SECRET, { "X-Hub-Signature-256": `sha256=${hex.toUpperCase()}` }, body, NOW), { ok: true });
  const raw = Uint8Array.from(hex.match(/../g)!, (x) => parseInt(x, 16));
  assert.deepEqual(verifyDelivery("hmac", SECRET, { "x-webhook-signature": btoa(String.fromCharCode(...raw)) }, body, NOW), { ok: true });
  assert.equal(verifyDelivery("hmac", SECRET, { "x-signature": hex }, `${body} `, NOW).ok, false, "a changed body");
  assert.equal(verifyDelivery("hmac", "other", { "x-signature": hex }, body, NOW).ok, false, "a wrong secret");
  assert.equal(verifyDelivery("hmac", SECRET, {}, body, NOW).ok, false, "no signature");
  assert.equal(verifyDelivery("none", SECRET, {}, body, NOW).ok, true);

  const t = Math.floor(NOW / 1000);
  const sig = hmacSha256Hex(SECRET, `${t}.${body}`);
  assert.equal(verifyDelivery("signature", SECRET, { "Stripe-Signature": `t=${t},v1=deadbeef,v1=${sig}` }, body, NOW).ok, true);
  assert.equal(verifyDelivery("signature", SECRET, { "stripe-signature": `t=${t},v1=${sig}` }, body, NOW + 301_000).ok, false, "replayed after 5 minutes");
  assert.equal(verifyDelivery("signature", SECRET, { "x-vyre-timestamp": String(t), "x-vyre-signature": sig }, body, NOW + 299_000).ok, true);
  assert.equal(verifyDelivery("signature", SECRET, { "stripe-signature": `v1=${sig}` }, body, NOW).ok, false, "no timestamp");
});

test("pointers, bodies and mappings", () => {
  const doc = { a: { "b/c": [10, { d: "x" }], "~": 1 }, n: null };
  assert.equal(pointerGet(doc, "/a/b~1c/1/d"), "x");
  assert.equal(pointerGet(doc, "/a/~0"), 1);
  assert.equal(pointerGet(doc, "/a/zzz"), undefined);
  assert.equal(pointerGet(doc, ""), doc);
  assert.deepEqual(parseBody("a=1&b=two%20words"), { a: "1", b: "two words" });
  assert.deepEqual(parseBody(' {"x":1} '), { x: 1 });
  assert.throws(() => parseBody("hello"));
  assert.throws(() => parseBody("{nope"));
  const n = normalise(LEAD_MAP, order(7, { customer: { email: "A@B.C" } }));
  assert.deepEqual(n.row, { ext_id: 7, email: "a@b.c", amount: 12 });
  assert.equal(n.providerId, "7");
  assert.deepEqual(n.missing, ["name"]);
});

test("ingest: a verified delivery becomes a record, the log and the events follow", async () => {
  const k = await kit();
  const src = await k.leadSource();
  assert.equal(src.key, "shop-leads");
  assert.equal(src.path, "/hooks/shop-leads");
  assert.equal(src.verify, "hmac");
  k.calls.length = 0;
  const out = await k.ingest("shop-leads", order("o1"));
  assert.equal(out.status, "accepted");
  assert.equal(out.recordIds.length, 1);
  const r = (await k.rows("lead"))[0]!;
  assert.deepEqual({ ...r.data }, { ext_id: "o1", email: "ann@x.com", name: "Ann", amount: 12 });
  assert.equal(out.recordIds[0], r.id);
  const up = k.calls.find((c) => c.cap === "records.bulk_upsert")!.input as { match: string[]; runAutomations: boolean };
  assert.deepEqual(up.match, ["ext_id"]);
  assert.equal(up.runAutomations, true, "a live delivery fires automations");
  const rec = k.events("source.received")[0]!;
  assert.deepEqual({ ...rec, deliveryId: undefined }, { sourceId: src.sourceId, deliveryId: undefined, source: "shop-leads", providerId: "o1", type: "lead", recordIds: [r.id] });
  assert.equal(rec.deliveryId, out.deliveryId);

  const list = await k.h["sources.deliveries.list"](k.ctx, { sourceId: src.sourceId });
  assert.deepEqual(list.deliveries.map((d) => [d.status, d.providerId, d.recordIds.length]), [["accepted", "o1", 1]]);
  const got = (await k.h["sources.get"](k.ctx, { sourceId: src.sourceId })).source;
  assert.equal(got.received24h, 1);
  assert.equal(got.failed24h, 0);
  assert.equal(got.lastReceivedAt, NOW);
  assert.equal(got.state, "active");

  k.calls.length = 0;
  await k.ingest("shop-leads", order("o2"), { runAutomations: false });
  assert.equal((k.calls.find((c) => c.cap === "records.bulk_upsert")!.input as { runAutomations: boolean }).runAutomations, false, "a backfill is quiet");
  assert.equal((await k.rows("lead")).length, 2);
});

test("ingest: a repeated provider id is dropped and logged, whatever the body", async () => {
  const k = await kit();
  const src = await k.leadSource();
  const first = await k.ingest("shop-leads", order("o1"));
  const second = await k.ingest("shop-leads", order("o1", { amount: 999 }));
  assert.equal(first.status, "accepted");
  assert.equal(second.status, "duplicate");
  assert.deepEqual(second.recordIds, []);
  assert.equal((await k.rows("lead")).length, 1);
  assert.equal((await k.rows("lead"))[0]!.data.amount, 12, "the duplicate changed nothing");
  assert.deepEqual(k.events("source.deduped"), [{ sourceId: src.sourceId, deliveryId: second.deliveryId, providerId: "o1" }]);
  const statuses = (await k.h["sources.deliveries.list"](k.ctx, { sourceId: src.sourceId })).deliveries.map((d) => d.status).sort();
  assert.deepEqual(statuses, ["accepted", "duplicate"]);
  assert.equal((await k.h["sources.deliveries.list"](k.ctx, { sourceId: src.sourceId, status: "duplicate" })).deliveries.length, 1);
  assert.equal(k.events("source.received").length, 1);
});

test("ingest: a bad or missing signature is refused and creates nothing", async () => {
  const k = await kit();
  const src = await k.leadSource();
  const body = JSON.stringify(order("o1"));
  const bad = await k.ingest("shop-leads", order("o1"), { secret: "wrong" });
  assert.equal(bad.status, "rejected");
  assert.equal(bad.reason, "bad_signature");
  const none = await k.h["sources.ingest"](k.ctx, { source: "shop-leads", receivedAt: NOW, headers: {}, body });
  assert.equal(none.reason, "bad_signature");
  const tampered = await k.h["sources.ingest"](k.ctx, { source: "shop-leads", receivedAt: NOW, headers: k.signed(order("o1")).headers, body: body.replace("12", "13") });
  assert.equal(tampered.reason, "bad_signature");
  assert.equal((await k.rows("lead")).length, 0);
  assert.equal(k.events("source.received").length, 0);
  assert.equal(k.events("source.rejected").length, 3);
  assert.deepEqual(k.events("source.rejected")[0], { sourceId: src.sourceId, source: "shop-leads", reason: "bad_signature" });
  const log = (await k.h["sources.deliveries.list"](k.ctx, { sourceId: src.sourceId, status: "rejected" })).deliveries;
  assert.equal(log.length, 3);
  assert.equal(log[0]!.error, "bad_signature");
  assert.equal((await k.h["sources.get"](k.ctx, { sourceId: src.sourceId })).source.received24h, 0, "refused deliveries are not counted as received");
  // a good one still works afterwards
  assert.equal((await k.ingest("shop-leads", order("o1"))).status, "accepted");
});

test("ingest: no secret in the Vault means every delivery is refused", async () => {
  const secrets: Record<string, string> = {};
  const k = await kit({ secrets });
  await k.leadSource();
  assert.equal((await k.ingest("shop-leads", order("o1"))).reason, "bad_signature");
  const noName = await k.h["sources.create"](k.ctx, { connector: "webhook", title: "No name", type: "lead", mapping: LEAD_MAP });
  assert.equal((await k.ingest(noName.source.key, order("o1"))).reason, "bad_signature");
  assert.equal((await k.rows("lead")).length, 0);
  const health = await k.h["sources.health"](k.ctx, {});
  assert.equal(health.state, "degraded");
  assert.match(health.detail!, /no signing secret/);
  await k.h["sources.set_secret"](k.ctx, { sourceId: noName.source.sourceId, secretName: "Whsec" });
  assert.equal((await k.ingest(noName.source.key, order("o1"))).reason, "bad_signature", "named, but the Vault has no such item");
  secrets["Whsec"] = SECRET;
  assert.equal((await k.ingest(noName.source.key, order("o1"))).status, "accepted");
});

test("ingest: a source with verify none needs no signature; unknown and paused sources are refused", async () => {
  const k = await kit();
  const open = await k.h["sources.create"](k.ctx, { connector: "webhook", title: "Open feed", type: "lead", mapping: LEAD_MAP, verify: "none" });
  const plain = await k.h["sources.ingest"](k.ctx, { source: open.source.key, receivedAt: NOW, headers: {}, body: JSON.stringify(order("p1")) });
  assert.equal(plain.status, "accepted");

  const unknown = await k.h["sources.ingest"](k.ctx, { source: "nope", receivedAt: NOW, headers: {}, body: "{}" });
  assert.deepEqual([unknown.status, unknown.reason, unknown.deliveryId], ["rejected", "unknown_source", undefined]);
  assert.deepEqual(k.events("source.rejected").at(-1), { source: "nope", reason: "unknown_source" });

  k.seen.length = 0;
  await k.h["sources.pause"](k.ctx, { sourceId: open.source.sourceId, reason: "maintenance" });
  assert.ok(k.events("source.paused").length === 1);
  const paused = await k.h["sources.ingest"](k.ctx, { source: open.source.key, receivedAt: NOW, headers: {}, body: JSON.stringify(order("p2")) });
  assert.equal(paused.reason, "paused");
  assert.equal((await k.h["sources.get"](k.ctx, { sourceId: open.source.sourceId })).source.state, "paused");
  assert.equal((await k.rows("lead")).length, 1);
  await k.h["sources.resume"](k.ctx, { sourceId: open.source.sourceId });
  assert.equal((await k.h["sources.ingest"](k.ctx, { source: open.source.key, receivedAt: NOW, headers: {}, body: JSON.stringify(order("p2")) })).status, "accepted");
  assert.ok(k.events("source.resumed").length === 1);
});

test("ingest: too large, form bodies, and bodies that are not payloads", async () => {
  const k = await kit({ maxBodyBytes: 200 });
  const src = await k.h["sources.create"](k.ctx, { connector: "webhook", title: "Forms", type: "lead", verify: "none", mapping: { dedupe: "/id", fields: [{ from: "/id", to: "ext_id" }, { from: "/email", to: "email" }], match: ["ext_id"] } });
  await assert.rejects(k.h["sources.ingest"](k.ctx, { source: src.source.key, receivedAt: NOW, headers: {}, body: "x".repeat(300) }), code("validation.too_large"));
  assert.deepEqual(k.events("source.rejected").at(-1), { sourceId: src.source.sourceId, source: src.source.key, reason: "too_large" });
  const form = await k.h["sources.ingest"](k.ctx, { source: src.source.key, receivedAt: NOW, headers: {}, body: "id=f1&email=f%40x.com" });
  assert.equal(form.status, "accepted");
  assert.equal((await k.rows("lead"))[0]!.data.email, "f@x.com");
  const junk = await k.h["sources.ingest"](k.ctx, { source: src.source.key, receivedAt: NOW, headers: {}, body: "hello there" });
  assert.deepEqual([junk.status, junk.reason], ["rejected", "bad_payload"]);
  assert.equal(k.events("source.rejected").at(-1)!.reason, "bad_payload");
});

test("a mapping failure keeps the delivery; fix the mapping and replay it", async () => {
  const k = await kit();
  const src = await k.leadSource({ mapping: { ...LEAD_MAP, fields: [{ from: "/id", to: "ext_id" }, { from: "/customer/mail", to: "email" }] } });
  const out = await k.ingest("shop-leads", order("o1"));
  assert.equal(out.status, "failed");
  assert.deepEqual(out.recordIds, []);
  assert.equal(k.events("source.mapping_failed").length, 1);
  assert.equal(k.events("source.mapping_failed")[0]!.deliveryId, out.deliveryId);
  assert.match(String(k.events("source.mapping_failed")[0]!.error), /required|email/i);
  assert.equal((await k.rows("lead")).length, 0);
  const d = (await k.h["sources.deliveries.list"](k.ctx, { sourceId: src.sourceId })).deliveries[0]!;
  assert.equal(d.status, "failed");
  assert.match(d.error!, /.+/);

  await assert.rejects(k.h["sources.replay"](k.ctx, { deliveryId: "dlv_nope" }), code("validation.not_found"));
  await k.h["sources.update"](k.ctx, { sourceId: src.sourceId, mapping: LEAD_MAP });
  assert.deepEqual(k.events("source.updated").at(-1), { sourceId: src.sourceId, fields: ["mapping"] });
  const replayed = await k.h["sources.replay"](k.ctx, { deliveryId: out.deliveryId! });
  assert.equal(replayed.status, "accepted");
  assert.equal(replayed.recordIds.length, 1);
  assert.equal((await k.rows("lead"))[0]!.data.email, "ann@x.com");
  assert.equal((await k.h["sources.deliveries.list"](k.ctx, { sourceId: src.sourceId })).deliveries[0]!.status, "accepted");
  await assert.rejects(k.h["sources.replay"](k.ctx, { deliveryId: out.deliveryId! }), code("validation.precondition_failed"));
  assert.equal((await k.ingest("shop-leads", order("o1"))).status, "duplicate", "the replayed delivery counts as seen");

  const none = await k.ingest("shop-leads", { customer: { mail: "x@y.z" } });
  assert.equal(none.status, "failed");
  assert.match(String(k.events("source.mapping_failed").at(-1)!.error), /no provider id at \/id/);
});

test("three failed deliveries in a row make a source failing", async () => {
  const k = await kit();
  const src = await k.leadSource({ mapping: { ...LEAD_MAP, fields: [{ from: "/id", to: "ext_id" }] } });
  for (let i = 0; i < 3; i++) await k.ingest("shop-leads", order(`o${i}`));
  const got = (await k.h["sources.get"](k.ctx, { sourceId: src.sourceId })).source;
  assert.equal(got.failed24h, 3);
  assert.equal(got.state, "failing");
  assert.equal((await k.h["sources.list"](k.ctx, { state: "failing" })).sources.length, 1);
  assert.equal((await k.h["sources.list"](k.ctx, { state: "active" })).sources.length, 0);
  assert.match((await k.h["sources.health"](k.ctx, {})).detail!, /1 source is failing/);
  k.clock.t += 2 * 86_400_000;
  assert.equal((await k.h["sources.get"](k.ctx, { sourceId: src.sourceId })).source.failed24h, 0, "only the last 24 hours count");
});

test("linking: a sure match is linked, no match creates, and the log says which", async () => {
  const k = await kit();
  const src = await k.personSource();
  const none = await k.ingest("people-feed", { id: "e1", email: "new@x.com", name: "New" });
  assert.equal(none.status, "accepted");
  assert.equal((await k.rows("person")).length, 1);
  assert.equal(k.events("source.linked").length, 0);

  const known = (await k.rows("person"))[0]!.id;
  const sure = await k.ingest("people-feed", { id: "e2", email: "new@x.com", name: "Renamed", phone: "555" });
  assert.deepEqual(sure.recordIds, [known]);
  assert.equal((await k.rows("person")).length, 1, "linked, not duplicated");
  assert.deepEqual({ ...(await k.s.store!.get("person", known))!.data }, { email: "new@x.com", name: "Renamed", phone: "555" });
  assert.deepEqual(k.events("source.linked"), [{ sourceId: src.sourceId, deliveryId: sure.deliveryId, recordId: known, by: "rule" }]);
  assert.equal(k.events("source.link_pending").length, 0);
});

test("linking: unsure matches wait in Needs you until a person settles them", async () => {
  const k = await kit();
  const src = await k.personSource();
  const mk = (data: Record<string, unknown>) => k.s.store!.create("person", mintUuid(), data).then((r) => r.id);
  const a = await mk({ email: "dup@x.com", name: "A" });
  const b = await mk({ email: "dup@x.com", name: "B" });
  const out = await k.ingest("people-feed", { id: "e1", email: "dup@x.com", name: "Dup" });
  assert.equal(out.status, "accepted");
  assert.deepEqual(out.recordIds, [], "nothing was written yet");
  const pend = k.events("source.link_pending")[0]!;
  assert.equal(pend.candidates, 2);
  assert.equal((await k.h["sources.deliveries.list"](k.ctx, { sourceId: src.sourceId })).deliveries[0]!.status, "linked_pending");
  assert.equal((await k.rows("person")).length, 2);

  const list = await k.h["sources.link.list_pending"](k.ctx, { type: "person" });
  assert.equal(list.pending.length, 1);
  const m = list.pending[0]!;
  assert.equal(m.matchId, pend.matchId);
  assert.deepEqual(m.row, { email: "dup@x.com", name: "Dup" });
  assert.deepEqual(m.candidates.map((c) => c.recordId).sort(), [a, b].sort());
  assert.ok(m.candidates.every((c) => c.score === 1 && c.reasons[0] === "email matches"));
  assert.equal((await k.h["sources.link.list_pending"](k.ctx, { type: "lead" })).pending.length, 0);

  await assert.rejects(k.h["sources.link.resolve"](k.ctx, { matchId: m.matchId }), code("validation.precondition_failed"));
  await assert.rejects(k.h["sources.link.resolve"](k.ctx, { matchId: m.matchId, recordId: a, ignore: true }), code("validation.precondition_failed"));
  await assert.rejects(k.h["sources.link.resolve"](k.ctx, { matchId: m.matchId, recordId: "rec_other" }), code("validation.precondition_failed"));
  await assert.rejects(k.h["sources.link.resolve"](k.ctx, { matchId: "mat_nope", ignore: true }), code("validation.not_found"));

  k.seen.length = 0;
  assert.deepEqual(await k.h["sources.link.resolve"](k.ctx, { matchId: m.matchId, recordId: b }), { recordId: b });
  assert.equal((await k.s.store!.get("person", b))!.data.name, "Dup");
  assert.equal((await k.s.store!.get("person", a))!.data.name, "A");
  assert.deepEqual(k.events("source.linked"), [{ sourceId: src.sourceId, deliveryId: out.deliveryId, recordId: b, by: "person" }]);
  assert.equal((await k.h["sources.link.list_pending"](k.ctx, {})).pending.length, 0);
  const d = (await k.h["sources.deliveries.list"](k.ctx, { sourceId: src.sourceId })).deliveries[0]!;
  assert.deepEqual([d.status, d.recordIds], ["accepted", [b]]);
  await assert.rejects(k.h["sources.link.resolve"](k.ctx, { matchId: m.matchId, ignore: true }), code("validation.precondition_failed"));
  assert.equal((await k.ingest("people-feed", { id: "e1", email: "dup@x.com" })).status, "duplicate", "settled deliveries count as seen");
});

test("linking: partial agreement is unsure; create new and ignore", async () => {
  const k = await kit();
  const src = await k.personSource({ ...PERSON_MAP, link: ["email", "phone"] });
  await k.s.store!.create("person", "00000000-0000-4000-8000-000000000001", { email: "p@x.com", phone: "111" });
  const out = await k.ingest("people-feed", { id: "e1", email: "p@x.com", phone: "222", name: "P" });
  assert.equal(out.recordIds.length, 0);
  const m = (await k.h["sources.link.list_pending"](k.ctx, {})).pending[0]!;
  assert.equal(m.candidates[0]!.score, 0.5);
  const made = await k.h["sources.link.resolve"](k.ctx, { matchId: m.matchId, createNew: true });
  assert.ok(made.recordId);
  assert.equal((await k.rows("person")).length, 2);

  await k.ingest("people-feed", { id: "e2", email: "p@x.com", phone: "333", name: "Q" });
  const m2 = (await k.h["sources.link.list_pending"](k.ctx, {})).pending[0]!;
  assert.deepEqual(await k.h["sources.link.resolve"](k.ctx, { matchId: m2.matchId, ignore: true }), {});
  assert.equal((await k.rows("person")).length, 2, "ignored: nothing written");
  const ignored = (await k.h["sources.deliveries.list"](k.ctx, { sourceId: src.sourceId })).deliveries.find((d) => d.providerId === "e2")!;
  assert.deepEqual([ignored.status, ignored.error], ["accepted", "ignored by a person"]);
});

test("link.match: sure, unsure and none, with default fields", async () => {
  const k = await kit();
  const a = await k.s.store!.create("person", "00000000-0000-4000-8000-0000000000a1", { email: "a@x.com", phone: "1", name: "A" });
  await k.s.store!.create("person", "00000000-0000-4000-8000-0000000000a2", { email: "b@x.com", phone: "1", name: "B" });
  const m = (row: Record<string, unknown>, by?: string[]) => k.h["sources.link.match"](k.ctx, { type: "person", row, ...(by ? { by } : {}) });
  assert.deepEqual(await m({ email: "a@x.com" }), { sure: a.id, unsure: [] });
  assert.deepEqual(await m({ email: "zzz@x.com" }), { unsure: [] });
  assert.deepEqual(await m({ name: "A" }), { unsure: [] }, "no key fields in the row: nothing to link on");
  const two = await m({ phone: "1" });
  assert.equal(two.sure, undefined);
  assert.equal(two.unsure.length, 2);
  const mixed = await m({ email: "a@x.com", phone: "1" }, ["email", "phone"]);
  assert.equal(mixed.sure, undefined, "a is full, b agrees on phone only: not sure");
  assert.deepEqual(mixed.unsure.map((c) => [c.recordId, c.score]), [[a.id, 1], ["00000000-0000-4000-8000-0000000000a2", 0.5]]);
});

test("preview_mapping: the row, the action, the link outcome and what is wrong", async () => {
  const k = await kit();
  const src = await k.leadSource();
  const pv = (input: Record<string, unknown>) => k.h["sources.preview_mapping"](k.ctx, input as never);
  const fresh = await pv({ sourceId: src.sourceId, payload: order("o1") });
  assert.deepEqual(fresh, { normalized: { ext_id: "o1", email: "ann@x.com", name: "Ann", amount: 12 }, action: "create", link: { unsure: [] }, problems: [] });
  assert.equal((await k.rows("lead")).length, 0, "a preview writes nothing");
  await k.ingest("shop-leads", order("o1"));
  assert.equal((await pv({ sourceId: src.sourceId, payload: order("o1") })).action, "skip");
  assert.equal((await pv({ sourceId: src.sourceId, payload: order("o1", { amount: 5 }) })).action, "update");

  const gaps = await pv({ sourceId: src.sourceId, payload: { amount: 1 } });
  assert.ok(gaps.problems.some((p) => /no provider id at \/id/.test(p)));
  assert.ok(gaps.problems.some((p) => /No value at \/customer\/email for email/.test(p)));
  assert.ok(gaps.problems.some((p) => /email is required/.test(p)));
  const unknown = await pv({ type: "lead", mapping: { ...LEAD_MAP, fields: [...LEAD_MAP.fields, { from: "/x", to: "nope" }] }, payload: order("o1") });
  assert.ok(unknown.problems.some((p) => /lead has no field nope/.test(p)));
  const bad = await pv({ type: "lead", mapping: { dedupe: "id", fields: [], match: [] }, payload: {} });
  assert.match(bad.problems[0]!, /JSON pointer/);

  const people = await k.personSource();
  await k.s.store!.create("person", "00000000-0000-4000-8000-0000000000b1", { email: "q@x.com" });
  const linked = await pv({ sourceId: people.sourceId, payload: { id: "z", email: "q@x.com", name: "Q" } });
  assert.equal(linked.link.sure, "00000000-0000-4000-8000-0000000000b1");
  assert.equal(linked.action, "update");
  await assert.rejects(pv({ payload: {} }), code("validation.bad_input"));
  await assert.rejects(pv({ mapping: LEAD_MAP, payload: {} }), code("validation.bad_input"));
});

test("sources: set up from a connector or a generic webhook, change, list, remove", async () => {
  const k = await kit();
  const reg = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as { connectors: { key: string; title: string; sources: { key: string; path: string; verify: string }[] }[] };
  const stripe = reg.connectors.find((c) => c.key === "stripe")!;
  const made = (await k.h["sources.create"](k.ctx, { connector: "stripe", title: "Stripe payments", type: "lead", mapping: LEAD_MAP, secretName: "Stripe_Whsec", connectionId: "con_abc" })).source;
  assert.equal(made.key, stripe.sources[0]!.path.replace("/hooks/", ""));
  assert.equal(made.path, stripe.sources[0]!.path);
  assert.equal(made.verify, stripe.sources[0]!.verify);
  assert.equal(made.connector, "stripe");
  assert.equal(made.connectionId, "con_abc");
  assert.deepEqual(k.events("source.created")[0], { sourceId: made.sourceId, key: made.key, type: "lead" });
  const again = (await k.h["sources.create"](k.ctx, { connector: "stripe", title: "Stripe again", type: "lead", mapping: LEAD_MAP })).source;
  assert.equal(again.key, `${made.key}-2`, "keys stay unique");
  const g1 = await k.leadSource();
  const g2 = await k.leadSource();
  assert.deepEqual([g1.key, g2.key], ["shop-leads", "shop-leads-2"]);

  const bad = (extra: Record<string, unknown>) => k.h["sources.create"](k.ctx, { connector: "webhook", title: "T", type: "lead", mapping: LEAD_MAP, ...extra } as never);
  await assert.rejects(bad({ connector: "nope" }), code("validation.not_found"));
  await assert.rejects(bad({ connector: "github_signin" }), code("validation.bad_input"));
  await assert.rejects(bad({ title: "  " }), code("validation.bad_input"));
  await assert.rejects(bad({ type: "nope" }), (e: unknown) => /no type nope/.test((e as Error).message));
  await assert.rejects(bad({ mapping: { ...LEAD_MAP, dedupe: "id" } }), code("validation.bad_input"));
  await assert.rejects(bad({ mapping: { ...LEAD_MAP, match: ["email", "zzz"] } }), code("validation.bad_input"));
  await assert.rejects(bad({ mapping: { ...LEAD_MAP, fields: [{ from: "/x", to: "nope" }], match: [] } }), code("validation.bad_input"));
  await assert.rejects(bad({ mapping: { ...LEAD_MAP, fields: [{ from: "/x", to: "email", transform: "((" }] , match: []} }), code("validation.bad_input"));

  const kinds = (await k.h["sources.kinds"](k.ctx, {})).kinds;
  assert.equal(kinds[0]!.key, "webhook");
  assert.ok(kinds.some((x) => x.key === "stripe" && x.connector === "stripe"));
  assert.ok(kinds.some((x) => x.key === "twilio:twilio_sms"), "a connector with several sources lists each");
  assert.ok(kinds.every((x) => x.needsTeamSpace));

  assert.equal((await k.h["sources.list"](k.ctx, { type: "lead" })).sources.length, 4);
  assert.equal((await k.h["sources.list"](k.ctx, { type: "person" })).sources.length, 0);
  const page1 = await k.h["sources.list"](k.ctx, { limit: 3 });
  assert.equal(page1.sources.length, 3);
  assert.equal(page1.total, 4);
  assert.equal((await k.h["sources.list"](k.ctx, { limit: 3, cursor: page1.next! })).sources.length, 1);

  const up = (await k.h["sources.update"](k.ctx, { sourceId: made.sourceId, title: "Stripe", verify: "none" })).source;
  assert.deepEqual([up.title, up.verify], ["Stripe", "none"]);
  assert.deepEqual(k.events("source.updated").at(-1), { sourceId: made.sourceId, fields: ["title", "verify"] });
  await assert.rejects(k.h["sources.update"](k.ctx, { sourceId: made.sourceId, type: "nope" }), (e: unknown) => /no type nope/.test((e as Error).message));
  await assert.rejects(k.h["sources.update"](k.ctx, { sourceId: "src_nope", title: "x" }), code("validation.not_found"));
  await assert.rejects(k.h["sources.set_secret"](k.ctx, { sourceId: made.sourceId, secretName: " " }), code("validation.bad_input"));

  await k.ingest(g1.key, order("o1"));
  assert.deepEqual(await k.h["sources.delete"](k.ctx, { sourceId: g1.sourceId }), { deleted: true });
  assert.deepEqual(k.events("source.deleted").at(-1), { sourceId: g1.sourceId });
  await assert.rejects(k.h["sources.get"](k.ctx, { sourceId: g1.sourceId }), code("validation.not_found"));
  assert.equal((await k.rows("lead")).length, 1, "records already created stay");
  assert.equal((await k.h["sources.ingest"](k.ctx, { source: g1.key, receivedAt: NOW, headers: {}, body: "{}" })).reason, "unknown_source");
});

test("health: healthy, degraded with a reason, down when the address does not answer", async () => {
  const k = await kit();
  assert.deepEqual(await k.h["sources.health"](k.ctx, {}), { state: "healthy" });
  const src = await k.leadSource({ mapping: { ...LEAD_MAP, fields: [{ from: "/id", to: "ext_id" }] } });
  await k.ingest("shop-leads", order("o1"));
  assert.deepEqual(await k.h["sources.health"](k.ctx, {}), { state: "healthy" }, "a fresh failure is not stuck yet");
  k.clock.t += 2 * 3_600_000;
  const h = await k.h["sources.health"](k.ctx, {});
  assert.equal(h.state, "degraded");
  assert.match(h.detail!, /1 delivery has waited over an hour/);
  void src;
  const down = openSources({ reachable: async () => false });
  assert.deepEqual(await down.handlers["sources.health"](k.ctx, {}), { state: "down", detail: "The public address does not answer." });
});

test("every capability of the manifest has a handler", () => {
  const raw = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as { capabilities: { name: string; module: string }[] };
  const names = raw.capabilities.filter((c) => c.module === "sources").map((c) => c.name).sort();
  assert.deepEqual(Object.keys(openSources().handlers).sort(), names);
});
