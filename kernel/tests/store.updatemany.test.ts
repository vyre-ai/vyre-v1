// Store.updateMany updates several records in one commit. The state it leaves is the state the one-at-a-time update leaves (the same rows, versions, change feed and events in the same order); an item the
// store refuses (not found, a version that moved, a bad value) is refused alone with the rest updated; an update that changes nothing is no write; a group whose commit fails updates nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { openRecordStore } from "../src/store/records.ts";
import { mintRecordId } from "../../lib/ids.ts";
import type { Store } from "../src/store/types.ts";

const PARTY = {
  name: "party",
  label: "Party",
  fields: [
    { name: "name", kind: "text", label: "Name" },
    { name: "age", kind: "number", label: "Age" },
  ],
};

async function run(grouped: boolean) {
  const o = openRecordStore({ path: ":memory:", space: "sp_um", clock: () => 5000 });
  await o.store.define({ add_types: [PARTY] as never });
  const store: Store = grouped ? o.store : ({ ...o.store, updateMany: undefined } as Store);
  const ids: string[] = [];
  for (let i = 0; i < 12; i++) {
    const id = mintRecordId();
    ids.push(id);
    await o.store.create("party", id, { name: `P ${i}`, age: i });
  }
  const items = [
    { id: ids[0]!, patch: { name: "P 0 new" }, base_version: 1 },
    { id: ids[1]!, patch: { age: "seven" as never }, base_version: 1 }, // refused: a bad value
    { id: ids[2]!, patch: { name: "P 2" }, base_version: 1 }, // changes nothing
    { id: ids[3]!, patch: { age: 33 }, base_version: 9 }, // refused: the version moved
    { id: mintRecordId(), patch: { name: "ghost" }, base_version: 1 }, // refused: not found
    { id: ids[5]!, patch: { name: null as never }, base_version: 1 }, // clears a field
    ...ids.slice(6).map((id, k) => ({ id, patch: { age: 100 + k }, base_version: 1 })),
  ];
  const out = store.updateMany
    ? await store.updateMany("party", items)
    : await Promise.all(
        items.map((it) =>
          store.update("party", it.id, it.patch, it.base_version).then(
            (record) => ({ ok: true as const, record }),
            (error: unknown) => ({ ok: false as const, error }),
          ),
        ),
      );
  const dump = (sql: string) => o.host.tx.all<Record<string, unknown>>(sql);
  return {
    results: out.map((r) => (r.ok ? `ok v${r.record.version}` : `refused ${(r.error as { code?: string }).code}`)),
    rows: dump("SELECT version, data FROM rt_party ORDER BY json_extract(data, '$.name'), id").map(
      (r) => `${r["version"]} ${r["data"]}`,
    ),
    changes: dump("SELECT type, kind, version, after FROM rs_changes ORDER BY cursor").map((r) => JSON.stringify(r)),
    events: dump("SELECT json_extract(event, '$.type') AS t FROM events ORDER BY seq").map((r) => String(r["t"])),
    commits: 0,
  };
}

test("updateMany leaves the state the one-at-a-time update leaves, and refuses an item alone", async () => {
  const one = await run(false);
  const many = await run(true);
  assert.deepEqual(many.results, one.results);
  assert.deepEqual(many.results.slice(0, 5), [
    "ok v2",
    "refused invalid",
    "ok v1",
    "refused version_conflict",
    "refused not_found",
  ]);
  assert.deepEqual(many.rows, one.rows);
  assert.deepEqual(many.changes, one.changes);
  assert.deepEqual(many.events, one.events);
});

test("updateMany commits the group once, and a commit that fails updates nothing", async () => {
  const o = openRecordStore({ path: ":memory:", space: "sp_um2", clock: () => 5000 });
  await o.store.define({ add_types: [PARTY] as never });
  const ids = [mintRecordId(), mintRecordId(), mintRecordId()];
  for (const id of ids) await o.store.create("party", id, { name: "x", age: 1 });
  const log = o.host.store as unknown as { appendBatch: (b: unknown[]) => unknown };
  const was = log.appendBatch.bind(log);
  let batches = 0;
  let failNext = false;
  log.appendBatch = (b) => {
    if (failNext) {
      failNext = false;
      throw new Error("the commit failed");
    }
    batches++;
    return was(b);
  };
  const items = ids.map((id) => ({ id, patch: { age: 2 }, base_version: 1 }));
  const r = await o.store.updateMany!("party", items);
  assert.equal(batches, 1, "one commit for the group");
  assert.ok(r.every((x) => x.ok));
  failNext = true;
  await assert.rejects(
    o.store.updateMany!(
      "party",
      ids.map((id) => ({ id, patch: { age: 3 }, base_version: 2 })),
    ),
    (e: { code?: string }) => e.code === "unavailable",
  );
  const rows = o.host.tx.all<{ version: number }>("SELECT version FROM rt_party");
  assert.ok(
    rows.every((x) => x.version === 2),
    "a failed commit updated nothing",
  );
});
