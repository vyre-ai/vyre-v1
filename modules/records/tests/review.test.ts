// @reads /modules/records/migrations/0001_init.sql
// P-L3_REC2: the eleven records capabilities that had no handler. Contract tests over a real record store: changes, completeness, gap_check, page_prefs.get/set, relate,
// relations_map, value_source, values.pending, values.review and view.
import test from "node:test";
import assert from "node:assert/strict";
import { mintUuid } from "../../../lib/ids.ts";
import { openRecords } from "../impl.ts";
import { createReviewHandlers, propose } from "../handlers/review.ts";
import type { RvCtx } from "../handlers/review.ts";
import { createViewHandlers } from "../handlers/views.ts";

const DAY = 86_400_000;
const code = (c: string) => (e: unknown) => {
  assert.equal((e as { error?: { code?: string } }).error?.code, c);
  return true;
};
const COMPANY = { name: "company", label: "Company", fields: [
  { name: "name", kind: "text", label: "Name", required: true },
  { name: "people", kind: "link", many: true, to: "person", label: "People", inverse: { name: "company" } },
] };
const PERSON = { name: "person", label: "Person", fields: [
  { name: "name", kind: "text", label: "Name", required: true },
  { name: "email", kind: "text", label: "Email" },
  { name: "phone", kind: "text", label: "Phone" },
  { name: "status", kind: "choice", label: "Status", options: ["open", "closed"] },
  { name: "score", kind: "number", label: "Score", ftype: "autonumber", derived: true },
  { name: "company", kind: "link", many: true, to: "company", label: "Company", inverse: { name: "people" } },
] };

interface Seen { name: string; subject: string; payload: Record<string, unknown> }
async function kit(o: { now?: () => number; call?: RvCtx["call"] } = {}) {
  const rec = openRecords({ space: "sp_rv" });
  await rec.store.define({ add_types: [COMPANY, PERSON] });
  const seen: Seen[] = [];
  const mk = (who: string | null): RvCtx => ({
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    ...(who ? { principal: { kind: "person" as const, id: who } } : {}),
    emit: (name, subject, payload) => { seen.push({ name, subject, payload }); return {}; },
    ...(o.call ? { call: o.call } : {}),
  });
  const deps = { tx: rec.host.tx, store: rec.store, writes: rec.handlers, space: "sp_rv", ...(o.now ? { now: o.now } : {}) };
  return { rec, seen, ctx: mk("usr_dana"), anon: mk(null), mk, review: createReviewHandlers(deps), views: createViewHandlers(deps) };
}
type Kit = Awaited<ReturnType<typeof kit>>;
const add = async (k: Kit, type: string, fields: Record<string, unknown>): Promise<string> => (await k.rec.handlers["records.create"](k.ctx, { type, fields })).record.id;

test("every one of the 11 capabilities is a function in the loader entry", async () => {
  const { handlers } = await import("../impl.ts");
  for (const n of ["records.changes", "records.completeness", "records.gap_check", "records.page_prefs.get", "records.page_prefs.set", "records.relate", "records.relations_map", "records.value_source", "records.values.pending", "records.values.review", "records.view"]) {
    assert.equal(typeof (handlers as unknown as Record<string, unknown>)[n], "function", n);
  }
});

test("changes: a feed of one type since a sequence number, with the op of each change and a cursor to continue from", async () => {
  const k = await kit();
  const a = await add(k, "person", { name: "Ann" });
  const b = await add(k, "person", { name: "Bo" });
  await add(k, "company", { name: "Other type" });
  await k.rec.handlers["records.update"](k.ctx, { type: "person", recordId: a, patch: { email: "a@x.io" } });
  await k.rec.handlers["records.delete"](k.ctx, { type: "person", recordId: b });
  const all = await k.review["records.changes"](k.ctx, { type: "person", since: 0 });
  assert.deepEqual(all.changes.map((c) => [c.id, c.op]), [[a, "upsert"], [b, "upsert"], [a, "patch"], [b, "delete"]]);
  assert.equal(all.next, all.changes[3]!.seq);
  const rest = await k.review["records.changes"](k.ctx, { type: "person", since: all.changes[1]!.seq });
  assert.deepEqual(rest.changes.map((c) => c.op), ["patch", "delete"]);
  const none = await k.review["records.changes"](k.ctx, { type: "person", since: all.next });
  assert.deepEqual(none, { changes: [], next: all.next });
  assert.equal((await k.review["records.changes"](k.ctx, { type: "person", since: 0, limit: 1 })).changes.length, 1);
  await assert.rejects(k.review["records.changes"](k.ctx, { type: "nope", since: 0 }), code("validation.bad_input"));
});

test("completeness: filled of total over the fields a person fills, with the missing ones named; derived fields are not asked for", async () => {
  const k = await kit();
  const id = await add(k, "person", { name: "Ann", email: "a@x.io" });
  const c = await k.review["records.completeness"](k.ctx, { type: "person", recordId: id });
  assert.equal(c.total, 5);
  assert.equal(c.filled, 2);
  assert.deepEqual(c.missing.map((m) => m.field), ["phone", "status", "company"]);
  assert.deepEqual(c.missing[0], { field: "phone", title: "Phone" });
  await k.rec.handlers["records.update"](k.ctx, { type: "person", recordId: id, patch: { phone: "555", status: "open" } });
  const d = await k.review["records.completeness"](k.ctx, { type: "person", recordId: id });
  assert.deepEqual([d.filled, d.total, d.missing.length], [4, 5, 1]);
  await assert.rejects(k.review["records.completeness"](k.ctx, { type: "person", recordId: mintUuid() }), code("validation.not_found"));
});

test("value source and Needs review: a proposed value waits, shows its source, and is accepted or rejected", async () => {
  const k = await kit();
  const id = await add(k, "person", { name: "Ann", email: "old@x.io" });
  // no proposal on record: whoever wrote the field, and it counts
  const plain = await k.review["records.value_source"](k.ctx, { type: "person", recordId: id, field: "email" });
  assert.equal(plain.source.state, "counted");
  // an agent writes a value; the event says it needs review
  await k.rec.handlers["records.update"](k.ctx, { type: "person", recordId: id, patch: { email: "new@x.io" } });
  propose(k.rec.host.tx, { recordId: id, type: "person", field: "email", reviewRequired: true, source: { kind: "agent", actor: "agt_scout", at: 1_800_000_000_000, state: "needs_review", link: "vyre://sp_rv/run/r1" } });
  const src = await k.review["records.value_source"](k.ctx, { type: "person", recordId: id, field: "email" });
  assert.deepEqual(src.source, { kind: "agent", actor: "agt_scout", at: 1_800_000_000_000, state: "needs_review", link: "vyre://sp_rv/run/r1" });
  const pending = await k.review["records.values.pending"](k.ctx, { type: "person" });
  assert.equal(pending.total, 1);
  assert.deepEqual(pending.values.map((v) => [v.recordId, v.field, v.value, v.source.state]), [[id, "email", "new@x.io", "needs_review"]]);

  const rejected = await k.review["records.values.review"](k.ctx, { type: "person", recordId: id, field: "email", decision: "reject", note: "wrong person" });
  assert.equal(rejected.record.fields["email"], "old@x.io", "the value before the proposal is back");
  assert.equal((await k.review["records.value_source"](k.ctx, { type: "person", recordId: id, field: "email" })).source.state, "rejected");
  assert.deepEqual((await k.review["records.values.pending"](k.ctx, { type: "person" })).values, []);
  const hist = await k.rec.handlers["records.history"](k.ctx, { type: "person", recordId: id, field: "email" });
  assert.ok(hist.entries.some((e) => String(e.value).includes("new@x.io")), "the rejected value stays in history");
  const reviewed = k.seen.filter((e) => e.name === "record.value_reviewed");
  assert.deepEqual(reviewed.map((e) => [e.payload["decision"], e.payload["by"], e.payload["field"]]), [["rejected", "usr_dana", "email"]]);
  assert.ok(k.seen.some((e) => e.name === "record.updated"), "the put-back is one record.updated");
  await assert.rejects(k.review["records.values.review"](k.ctx, { type: "person", recordId: id, field: "email", decision: "accept" }), code("validation.not_found"));

  // accept: the value stays and counts
  await k.rec.handlers["records.update"](k.ctx, { type: "person", recordId: id, patch: { phone: "555" } });
  propose(k.rec.host.tx, { recordId: id, type: "person", field: "phone", reviewRequired: true, source: { kind: "agent", actor: "agt_scout", at: 5, state: "needs_review" } });
  const ok = await k.review["records.values.review"](k.mk("usr_lee"), { type: "person", recordId: id, field: "phone", decision: "accept" });
  assert.equal(ok.record.fields["phone"], "555");
  assert.equal((await k.review["records.value_source"](k.ctx, { type: "person", recordId: id, field: "phone" })).source.state, "counted");
  // a field that needs no review counts straight away
  propose(k.rec.host.tx, { recordId: id, type: "person", field: "status", reviewRequired: false, source: { kind: "agent", actor: "agt_scout", at: 6, state: "counted" } });
  assert.deepEqual((await k.review["records.values.pending"](k.ctx, { type: "person" })).values, []);
});

test("values.pending pages a long list with a cursor", async () => {
  const k = await kit();
  for (let i = 0; i < 3; i++) {
    const id = await add(k, "person", { name: `P${i}`, email: `e${i}@x.io` });
    propose(k.rec.host.tx, { recordId: id, type: "person", field: "email", reviewRequired: true, source: { kind: "agent", actor: "agt_a", at: 10 + i, state: "needs_review" } });
  }
  const one = await k.review["records.values.pending"](k.ctx, { type: "person", limit: 2 });
  assert.equal(one.values.length, 2);
  assert.equal(one.total, 3);
  assert.ok(one.next);
  const two = await k.review["records.values.pending"](k.ctx, { type: "person", limit: 2, cursor: one.next! });
  assert.equal(two.values.length, 1);
  assert.equal(two.next, undefined);
});

test("relate: links both ends of a two-way relation, is idempotent, and unlinks both ends", async () => {
  const k = await kit();
  const co = await add(k, "company", { name: "Acme" });
  const p = await add(k, "person", { name: "Ann" });
  const linked = await k.review["records.relate"](k.ctx, { type: "person", recordId: p, field: "company", toId: co });
  assert.deepEqual(linked.record.fields["company"], [{ urn: `vyre://sp_rv/company/${co}` }]);
  const far = await k.rec.store.get("company", co);
  assert.deepEqual(far!.data["people"], [{ urn: `vyre://sp_rv/person/${p}` }]);
  const before = k.seen.length;
  await k.review["records.relate"](k.ctx, { type: "person", recordId: p, field: "company", toId: co });
  assert.equal(k.seen.length, before, "linking again changes nothing and emits nothing");
  const gone = await k.review["records.relate"](k.ctx, { type: "person", recordId: p, field: "company", toId: co, unlink: true });
  assert.deepEqual(gone.record.fields["company"], []);
  assert.deepEqual((await k.rec.store.get("company", co))!.data["people"], []);
  await assert.rejects(k.review["records.relate"](k.ctx, { type: "person", recordId: p, field: "email", toId: co }), code("validation.bad_input"));
  await assert.rejects(k.review["records.relate"](k.ctx, { type: "person", recordId: p, field: "company", toId: mintUuid() }), code("validation.not_found"));
});

test("relations_map: records linked out to two hops, each edge named by its field", async () => {
  const k = await kit();
  const co = await add(k, "company", { name: "Acme" });
  const p1 = await add(k, "person", { name: "Ann" });
  const p2 = await add(k, "person", { name: "Bo" });
  await k.review["records.relate"](k.ctx, { type: "person", recordId: p1, field: "company", toId: co });
  await k.review["records.relate"](k.ctx, { type: "person", recordId: p2, field: "company", toId: co });
  const one = await k.views["records.relations_map"](k.ctx, { type: "person", recordId: p1, hops: 1 });
  assert.deepEqual(one.nodes.map((n) => [n.title, n.hop]), [["Ann", 0], ["Acme", 1]]);
  assert.deepEqual(one.edges, [{ from: p1, to: co, field: "company" }]);
  const two = await k.views["records.relations_map"](k.ctx, { type: "person", recordId: p1 });
  assert.deepEqual(two.nodes.map((n) => [n.title, n.hop]).sort(), [["Acme", 1], ["Ann", 0], ["Bo", 2]]);
  assert.ok(two.edges.some((e) => e.from === co && e.to === p2 && e.field === "people"));
  await assert.rejects(k.views["records.relations_map"](k.ctx, { type: "person", recordId: mintUuid() }), code("validation.not_found"));
});

test("gap_check: missing and stale rules name the fill route and announce record.gaps_found", async () => {
  const rules = [
    { ruleId: "r_phone", field: "phone", when: "missing", route: "task", enabled: true },
    { ruleId: "r_email", field: "email", when: "stale", staleAfterDays: 30, route: "agent_lookup", agentId: "agt_scout", enabled: true },
    { ruleId: "r_off", field: "status", when: "missing", route: "form", enabled: false },
  ];
  const asked: unknown[] = [];
  const call: RvCtx["call"] = async (cap, input) => { asked.push([cap, input]); return { rules }; };
  const fresh = await kit({ call });
  const id = await add(fresh, "person", { name: "Ann", email: "a@x.io" });
  const g = await fresh.review["records.gap_check"](fresh.ctx, { type: "person", recordId: id });
  assert.deepEqual(g.gaps, [{ recordId: id, field: "phone", reason: "missing", route: "task" }]);
  assert.deepEqual(asked[0], ["schema.gap_rules.list", { type: "person" }]);
  assert.deepEqual(fresh.seen.filter((e) => e.name === "record.gaps_found").map((e) => e.payload), [{ recordId: id, type: "person", fields: ["phone"], ruleId: "r_phone" }]);

  const later = await kit({ call, now: () => Date.now() + 40 * DAY });
  const a = await add(later, "person", { name: "Ann", email: "a@x.io", phone: "555" });
  const b = await add(later, "person", { name: "Bo", phone: "" });
  const all = await later.review["records.gap_check"](later.ctx, { type: "person" });
  const key = (x: { recordId: string; field: string; reason: string }) => `${x.recordId}:${x.field}:${x.reason}`;
  assert.deepEqual(all.gaps.map(key).sort(), [`${a}:email:stale`, `${b}:email:stale`, `${b}:phone:missing`].sort());

  const noCall = await kit();
  await assert.rejects(noCall.review["records.gap_check"](noCall.ctx, { type: "person" }), code("internal.unavailable"));
});

test("page prefs: personal to the person, partial updates keep the rest, no person is refused", async () => {
  const k = await kit();
  assert.deepEqual(await k.views["records.page_prefs.get"](k.ctx, { type: "person" }), { folded: [], keepVisible: [] });
  assert.deepEqual(await k.views["records.page_prefs.set"](k.ctx, { type: "person", folded: ["notes", "notes", "history"] }), { folded: ["notes", "history"], keepVisible: [] });
  assert.deepEqual(await k.views["records.page_prefs.set"](k.ctx, { type: "person", keepVisible: ["phone"] }), { folded: ["notes", "history"], keepVisible: ["phone"] });
  assert.deepEqual(await k.views["records.page_prefs.get"](k.mk("usr_lee"), { type: "person" }), { folded: [], keepVisible: [] }, "another person has their own");
  assert.deepEqual(await k.views["records.page_prefs.set"](k.ctx, { type: "person", folded: [] }), { folded: [], keepVisible: ["phone"] });
  await assert.rejects(k.views["records.page_prefs.get"](k.anon, { type: "person" }), code("permission.role_lacks_permission"));
  await assert.rejects(k.views["records.page_prefs.get"](k.ctx, { type: "nope" }), code("validation.bad_input"));
});

test("view: the saved view from the schema module resolved to its rows, a page at a time", async () => {
  const view = { viewId: "viw_open", type: "person", kind: "table", title: "Open", shared: true, updatedAt: 5, filter: { field: "status", op: "eq", value: "open" }, sort: [{ field: "name", dir: "desc" }], hidden: ["phone"] };
  const call: RvCtx["call"] = async (cap, input) => {
    assert.equal(cap, "views.get");
    return (input as { viewId: string }).viewId === "viw_open" ? { view } : { view: { ...view, viewId: "viw_other", type: "company" } };
  };
  const k = await kit({ call });
  for (const [n, s] of [["Ann", "open"], ["Bo", "closed"], ["Cy", "open"], ["Di", "open"]] as const) await add(k, "person", { name: n, status: s });
  const first = await k.views["records.view"](k.ctx, { type: "person", viewId: "viw_open", limit: 2 });
  assert.equal(first.view.title, "Open");
  assert.deepEqual(first.view.hidden, ["phone"]);
  assert.deepEqual(first.rows.map((r) => r.fields["name"]), ["Di", "Cy"]);
  assert.equal(first.total, 3);
  assert.ok(first.next);
  const second = await k.views["records.view"](k.ctx, { type: "person", viewId: "viw_open", limit: 2, cursor: first.next! });
  assert.deepEqual(second.rows.map((r) => r.fields["name"]), ["Ann"]);
  await assert.rejects(k.views["records.view"](k.ctx, { type: "person", viewId: "viw_other" }), code("validation.not_found"));
  const noCall = await kit();
  await assert.rejects(noCall.views["records.view"](noCall.ctx, { type: "person", viewId: "viw_open" }), code("internal.unavailable"));
});
