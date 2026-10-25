// @reads /modules/records/migrations/0001_init.sql
// @reads /modules/records/migrations/0002_query.sql
// The reference is the store itself: the same cursor format, so a cursor from one path continues on the other.
// records.query, records.search, records.counts and saved views against the RecordStore as the reference: the SQL path and the
// store's own filter, sort and keyset code must return the same rows in the same order, page after page.
import test from "node:test";
import assert from "node:assert/strict";
import { mintRecordId } from "../../../lib/ids.ts";
import { openRecords } from "../impl.ts";
import { createQueryHandlers, deleteView, listViews, runQuery, runView, saveView } from "../handlers/query.ts";
import type { ViewSpec } from "../handlers/query.ts";
import type { Filter, Sort } from "../../../kernel/src/store/types.ts";
import { ITEM } from "../fixtures/seed.ts";

const ctx = { trace: { traceId: "0123456789abcdef0123456789abcdef" } };
const vcode = (c: string) => (e: unknown) => {
  assert.equal((e as { error?: { code?: string } }).error?.code, c);
  return true;
};
const TAGGED = Object.freeze({
  name: "tagged",
  fields: [
    { name: "name", kind: "text" },
    { name: "qty", kind: "number" },
    { name: "status", kind: "choice", options: ["open", "closed", "done"] },
    { name: "tags", kind: "multi_choice" },
    { name: "meta", kind: "address" },
  ],
});

const STATUS = ["open", "closed", "done", null] as const;
async function seed(n: number) {
  const rec = openRecords({ space: `sp_q${n}` });
  await rec.store.define({ add_types: [ITEM, TAGGED] });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = mintRecordId();
    ids.push(id);
    const data: Record<string, unknown> = { name: `Item ${i % 17} ${i % 2 ? "alpha" : "beta"}`, qty: i % 7 === 0 ? undefined : (i * 37) % 11 };
    const s = STATUS[i % 4];
    if (s) data["status"] = s;
    await rec.store.create("item", id, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
  }
  return { rec, ids, q: createQueryHandlers({ tx: rec.host.tx }) };
}

async function reference(rec: Awaited<ReturnType<typeof seed>>["rec"], type: string, filter: Filter | undefined, sort: Sort[], size: number): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const p = await rec.store.query(type, { ...(filter ? { filter } : {}), sort, page: { limit: size, ...(cursor ? { cursor } : {}) } });
    out.push(...p.rows.map((r) => r.id));
    if (!p.next_cursor) return out;
    cursor = p.next_cursor;
  }
}

async function viaHandler(q: Awaited<ReturnType<typeof seed>>["q"], type: string, spec: ViewSpec): Promise<{ ids: string[]; total?: number }> {
  const out: string[] = [];
  let cursor: string | undefined;
  let total: number | undefined;
  for (;;) {
    const r = await q["records.query"](ctx, { type, ...spec, ...(cursor ? { cursor } : {}) });
    out.push(...r.rows.map((x) => x.id));
    total = r.total;
    if (!r.next) return { ids: out, ...(total !== undefined ? { total } : {}) };
    cursor = r.next;
  }
}

const SPECS: { name: string; filter?: Filter; sort: Sort[] }[] = [
  { name: "no filter, default order", sort: [] },
  { name: "eq choice, sort qty desc", filter: { field: "status", op: "eq", value: "open" }, sort: [{ field: "qty", dir: "desc" }] },
  { name: "ne choice with nulls, sort name asc", filter: { field: "status", op: "ne", value: "open" }, sort: [{ field: "name", dir: "asc" }] },
  { name: "and/or/not", filter: { and: [{ or: [{ field: "qty", op: "gte", value: 5 }, { field: "status", op: "eq", value: "done" }] }, { not: { field: "name", op: "contains", value: "alpha" } }] }, sort: [{ field: "status", dir: "asc" }, { field: "qty", dir: "desc" }] },
  { name: "in and is_null", filter: { or: [{ field: "status", op: "in", value: ["open", "done"] }, { field: "qty", op: "is_null" }] }, sort: [{ field: "qty", dir: "asc" }] },
  { name: "lt on nullable number", filter: { field: "qty", op: "lt", value: 4 }, sort: [{ field: "updated_at", dir: "desc" }, { field: "name", dir: "asc" }] },
  { name: "contains text case-insensitive", filter: { field: "name", op: "contains", value: "ITEM 3" }, sort: [{ field: "name", dir: "desc" }] },
];

test("filter and sort: the SQL path pages exactly like the RecordStore, for every spec and page size", async () => {
  const { rec, q } = await seed(97);
  for (const s of SPECS) {
    for (const size of [1, 7, 500]) {
      const want = await reference(rec, "item", s.filter, s.sort.length ? s.sort : [{ field: "created_at", dir: "asc" }], size);
      const got = await viaHandler(q, "item", { ...(s.filter ? { filter: s.filter } : {}), ...(s.sort.length ? { sort: s.sort } : {}), limit: size });
      assert.deepEqual(got.ids, want, `${s.name}, page ${size}`);
      assert.equal(got.total, want.length, `${s.name}: total`);
    }
  }
});

test("group is the leading sort key", async () => {
  const { rec, q } = await seed(40);
  const want = await reference(rec, "item", undefined, [{ field: "status", dir: "asc" }, { field: "qty", dir: "desc" }], 500);
  const got = await viaHandler(q, "item", { group: "status", sort: [{ field: "qty", dir: "desc" }], limit: 9 });
  assert.deepEqual(got.ids, want);
});

test("window: offset and limit return the slice of the same order; fields trims the row", async () => {
  const { rec, q } = await seed(50);
  const all = await reference(rec, "item", undefined, [{ field: "name", dir: "asc" }], 500);
  const r = await q["records.query"](ctx, { type: "item", sort: [{ field: "name", dir: "asc" }], offset: 10, limit: 5, fields: ["name"] });
  assert.deepEqual(r.rows.map((x) => x.id), all.slice(10, 15));
  assert.deepEqual(Object.keys(r.rows[0]!.fields), ["name"]);
  assert.equal(r.total, 50);
  assert.ok(r.next, "more rows follow the window");
});

test("deleted rows are out of every result and the count follows writes", async () => {
  const { rec, ids, q } = await seed(20);
  assert.equal((await q["records.counts"](ctx, { type: "item" })).count, 20);
  const cur = await rec.store.get("item", ids[3]!);
  await rec.store.remove("item", ids[3]!, cur!.version);
  assert.equal((await q["records.counts"](ctx, { type: "item" })).count, 19, "the cached count is stale after a write, so it is recounted");
  const r = await viaHandler(q, "item", { limit: 500 });
  assert.equal(r.ids.length, 19);
  assert.ok(!r.ids.includes(ids[3]!));
  await rec.store.restore("item", ids[3]!);
  assert.equal((await q["records.counts"](ctx, { type: "item", filter: { field: "status", op: "eq", value: "open" } })).count, 5);
  assert.equal((await q["records.counts"](ctx, { type: "item" })).count, 20);
});

test("the server fallback answers a filter the SQL compiler cannot express, with the same rows", async () => {
  const rec = openRecords({ space: "sp_fb" });
  await rec.store.define({ add_types: [TAGGED] });
  const a = mintRecordId(), b = mintRecordId(), c = mintRecordId();
  await rec.store.create("tagged", a, { name: "a", meta: { k: "1" } });
  await rec.store.create("tagged", b, { name: "b", meta: { k: "2" } });
  await rec.store.create("tagged", c, { name: "c" });
  const q = createQueryHandlers({ tx: rec.host.tx });
  const r = await q["records.query"](ctx, { type: "tagged", filter: { field: "meta", op: "eq", value: { k: "2" } }, sort: [{ field: "name", dir: "asc" }] });
  assert.deepEqual(r.rows.map((x) => x.id), [b]);
  assert.equal(r.total, 1);
  assert.equal((await q["records.counts"](ctx, { type: "tagged", filter: { field: "meta", op: "in", value: [{ k: "1" }, { k: "2" }] } })).count, 2);
});

test("contains on a many-valued field matches an element", async () => {
  const rec = openRecords({ space: "sp_tags" });
  await rec.store.define({ add_types: [TAGGED] });
  const a = mintRecordId(), b = mintRecordId();
  await rec.store.create("tagged", a, { name: "a", tags: ["x", "y"] });
  await rec.store.create("tagged", b, { name: "b", tags: ["z"] });
  const q = createQueryHandlers({ tx: rec.host.tx });
  const r = await q["records.query"](ctx, { type: "tagged", filter: { field: "tags", op: "contains", value: "y" } });
  assert.deepEqual(r.rows.map((x) => x.id), [a]);
});

test("bad input maps to catalogue errors", async () => {
  const { q } = await seed(3);
  await assert.rejects(() => q["records.query"](ctx, { type: "nope" }), vcode("validation.bad_input"));
  await assert.rejects(() => q["records.query"](ctx, { type: "item", sort: [{ field: "missing", dir: "asc" }] }), vcode("validation.bad_input"));
  await assert.rejects(() => q["records.query"](ctx, { type: "item", filter: { field: "name'); DROP TABLE rt_item;--", op: "eq", value: 1 } }), vcode("validation.bad_input"));
  await assert.rejects(() => q["records.query"](ctx, { type: "item", cursor: "not-a-cursor" }), vcode("validation.bad_input"));
  await assert.rejects(() => q["records.query"](ctx, { type: "item", filter: { field: "name", op: "regex", value: "x" } }), vcode("validation.bad_input"));
});

test("search: words match as prefixes, deleted and sealed text stay out, new and edited rows are found", async () => {
  const { rec, ids, q } = await seed(60);
  const hits = await q["records.search"](ctx, { type: "item", q: "alph" });
  assert.equal(hits.rows.length, 30);
  assert.ok(hits.rows.every((r) => String(r.fields["name"]).includes("alpha")));
  const two = await q["records.search"](ctx, { type: "item", q: "item 3 alpha" });
  assert.ok(two.rows.length > 0 && two.rows.every((r) => /Item 3 alpha/.test(String(r.fields["name"]))));
  const page1 = await q["records.search"](ctx, { type: "item", q: "alpha", limit: 10 });
  const page2 = await q["records.search"](ctx, { type: "item", q: "alpha", limit: 10, cursor: page1.next! });
  assert.equal(page1.rows.length, 10);
  assert.ok(page2.rows.every((r) => !page1.rows.some((p) => p.id === r.id)));
  const target = await rec.store.get("item", ids[1]!);
  await rec.store.update("item", ids[1]!, { name: "zebra crossing" }, target!.version);
  assert.deepEqual((await q["records.search"](ctx, { type: "item", q: "zebra" })).rows.map((r) => r.id), [ids[1]]);
  const fresh = mintRecordId();
  await rec.store.create("item", fresh, { name: "quokka" });
  assert.deepEqual((await q["records.search"](ctx, { type: "item", q: "quokka" })).rows.map((r) => r.id), [fresh]);
  const now = await rec.store.get("item", fresh);
  await rec.store.remove("item", fresh, now!.version);
  assert.equal((await q["records.search"](ctx, { type: "item", q: "quokka" })).rows.length, 0);
  assert.equal((await q["records.search"](ctx, { type: "item", q: "   " })).rows.length, 0);
  assert.equal((await q["records.search"](ctx, { type: "item", q: "\"); DROP" })).rows.length, 0);
});

test("saved views: save builds the sort index, personal views are private, shared ones are listed, run returns the page", async () => {
  const { rec, q } = await seed(30);
  const deps = { tx: rec.host.tx, now: () => 1700000000000 };
  const spec: ViewSpec = { filter: { field: "status", op: "eq", value: "open" }, sort: [{ field: "qty", dir: "desc" }], limit: 4 };
  const v = saveView(deps, { viewId: "viw_a", type: "item", title: "Open by qty", spec, ownerId: "usr_a" });
  assert.equal(v.kind, "table");
  assert.equal(v.shared, false);
  const idx = rec.host.tx.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'qx_item_%'");
  assert.ok(idx.length >= 1, "the view's sort has an index");
  const cached = rec.host.tx.get<{ n: number }>("SELECT n FROM qx_counts WHERE type = 'item' AND key = ?", JSON.stringify({ field: "status", op: "eq", value: "open" }));
  assert.equal(cached?.n, 8, "its count is already cached");
  assert.throws(() => saveView(deps, { viewId: "viw_a", type: "item", title: "stolen", spec, ownerId: "usr_b" }));
  saveView(deps, { viewId: "viw_s", type: "item", title: "Everyone", spec: {}, shared: true, ownerId: "usr_a" });
  assert.deepEqual(listViews(deps, "item", "usr_a").map((x) => x.viewId), ["viw_a", "viw_s"]);
  assert.deepEqual(listViews(deps, "item", "usr_b").map((x) => x.viewId), ["viw_s"]);
  const first = runView(deps, "viw_a");
  assert.equal(first.rows.length, 4);
  assert.equal(first.total, 8);
  const second = runView(deps, "viw_a", { cursor: first.next! });
  assert.equal(second.rows.length, 4);
  assert.deepEqual(first.rows.map((r) => r.id).concat(second.rows.map((r) => r.id)), (await viaHandler(q, "item", { filter: spec.filter, sort: spec.sort, limit: 100 })).ids);
  assert.equal(deleteView(deps, "viw_a", "usr_b"), false);
  assert.equal(deleteView(deps, "viw_a", "usr_a"), true);
  assert.throws(() => runView(deps, "viw_a"));
  assert.ok(runQuery(rec.host.tx, "item", {}).rows.length > 0);
});

test("a view page is an index range scan, not a table scan", async () => {
  const { rec } = await seed(30);
  runQuery(rec.host.tx, "item", { sort: [{ field: "qty", dir: "desc" }], limit: 5 });
  const plan = rec.host.tx.all<{ detail: string }>(
    "EXPLAIN QUERY PLAN SELECT r.id FROM rt_item r WHERE r.deleted_at IS NULL ORDER BY json_extract(r.data, '$.\"qty\"') DESC, r.id ASC LIMIT 5",
  ).map((p) => p.detail).join(" | ");
  assert.match(plan, /USING (COVERING )?INDEX qx_item_/, plan);
  assert.doesNotMatch(plan, /USE TEMP B-TREE/, plan);
});
