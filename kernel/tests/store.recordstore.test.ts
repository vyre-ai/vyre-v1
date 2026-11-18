import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openRecordStore, recordsRows } from "../src/store/records.ts";
import { mintRecordId } from "../../lib/ids.ts";
import { StoreError } from "../src/store/types.ts";

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-rs-"));
const CONTACT = {
  name: "contact",
  label: "Contact",
  fields: [
    { name: "name", kind: "text", required: true },
    { name: "age", kind: "number" },
  ],
};

test("writes are events: one record event per write, hash chain intact, rows and changes follow", async () => {
  const { host, store } = openRecordStore({ path: ":memory:", space: "sp_1" });
  await store.define({ add_types: [CONTACT] });
  const id = mintRecordId();
  const a = await store.create("contact", id, { name: "Ann" });
  await store.update("contact", id, { age: 3 }, a.version);
  await store.remove("contact", id, 2);
  await store.restore("contact", id);
  assert.deepEqual(
    host.store.read({ limit: 100 }).map((e) => e.type),
    ["schema.applied", "record.created", "record.updated", "record.removed", "record.restored"],
  );
  assert.deepEqual(
    host.store.read({ type: "record.*" }).map((e) => e.entity_id),
    [id, id, id, id],
  );
  assert.equal(host.store.verify().ok, true);
  assert.deepEqual(
    (await store.changes(null, 10)).entries.map((e) => [e.kind, e.version]),
    [
      ["created", 1],
      ["updated", 2],
      ["removed", 3],
      ["restored", 4],
    ],
  );
});

test("a refused write appends nothing: version_conflict, invalid, unique", async () => {
  const { host, store } = openRecordStore({ path: ":memory:", space: "sp_1" });
  await store.define({ add_types: [CONTACT] });
  const id = mintRecordId();
  await store.create("contact", id, { name: "Ann" });
  const n = host.store.count();
  await assert.rejects(
    store.update("contact", id, { name: "x" }, 7),
    (e: unknown) => e instanceof StoreError && e.code === "version_conflict",
  );
  await assert.rejects(
    store.create("contact", mintRecordId(), { age: 1 }),
    (e: unknown) => e instanceof StoreError && e.code === "invalid",
  );
  assert.equal(host.store.count(), n);
});

test("state survives a reopen, and a version bump rebuilds the rt_ tables from the log with the same answers", async () => {
  const file = path.join(dir(), "events.db");
  const first = openRecordStore({ path: file, space: "sp_1" });
  await first.store.define({ add_types: [CONTACT] });
  const ids: string[] = [];
  for (let i = 0; i < 20; i++) {
    const id = mintRecordId();
    ids.push(id);
    await first.store.create("contact", id, { name: `n${i}`, age: i });
  }
  await first.store.update("contact", ids[0]!, { age: 99 }, 1);
  await first.store.remove("contact", ids[1]!, 1);
  const snap = async (s: typeof first.store) => ({
    q: (await s.query("contact", { sort: [{ field: "name", dir: "asc" }], page: { limit: 50 }, include_deleted: true }))
      .rows,
    c: await s.changes(null, 100),
  });
  const before = await snap(first.store);
  first.host.close();

  const again = openRecordStore({ path: file, space: "sp_1" });
  assert.deepEqual(await snap(again.store), before);
  again.host.close();

  const bumped = openRecordStore({ path: file, space: "sp_1", extra: [] });
  bumped.host.rebuild("records.rows");
  assert.deepEqual(await snap(bumped.store), before, "a rebuild from the log gives the same rows and changes");
  assert.equal(bumped.host.projectionVersion("records.rows")?.applied, bumped.host.store.head.seq);
  bumped.host.close();
  assert.equal(recordsRows.version, 1);
});

test("a query with no sort pages the type in order of id in SQL: the same pages, the same cursors and the same end as the general path, and each page reads only its own rows", async () => {
  const { host, store } = openRecordStore({ path: ":memory:", space: "sp_keyset" });
  await store.define({ add_types: [CONTACT] });
  const made: string[] = [];
  for (let i = 0; i < 23; i++) {
    const id = mintRecordId();
    await store.create("contact", id, { name: `P${i}`, age: i });
    made.push(id);
  }
  await store.remove("contact", made[3]!, 1);
  const walk = async (spec: Record<string, unknown>): Promise<string[][]> => {
    const pages: string[][] = [];
    let cursor: string | undefined;
    do {
      const p = await store.query("contact", { ...spec, page: { limit: 5, ...(cursor ? { cursor } : {}) } } as never);
      pages.push(p.rows.map((r) => r.id));
      cursor = p.next_cursor;
    } while (cursor);
    return pages;
  };
  // the sort by id is the general path (it reads and orders every row); the two must agree page by page
  assert.deepEqual(await walk({}), await walk({ sort: [{ field: "id", dir: "asc" }] }));
  assert.deepEqual(
    await walk({ include_deleted: true }),
    await walk({ include_deleted: true, sort: [{ field: "id", dir: "asc" }] }),
  );
  assert.equal((await walk({})).flat().length, 22, "the removed record is not listed");
  // changed since a time (the sync's push of local edits)
  const since = (await store.get("contact", made[10]!))!.updated_at;
  assert.deepEqual(
    await walk({ filter: { field: "updated_at", op: "gte", value: since } }),
    await walk({ filter: { field: "updated_at", op: "gte", value: since }, sort: [{ field: "id", dir: "asc" }] }),
  );
  // a cursor that is not ours is still refused
  await assert.rejects(store.query("contact", { page: { limit: 5, cursor: "nope" } }), /invalid cursor/);
  assert.ok(host.store.verify().ok);
});
