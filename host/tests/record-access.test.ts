import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot } from "../../kernel/src/authorize/index.ts";
import type { Store, StoredRecord } from "../../kernel/src/store/types.ts";
import { createRecordAccess } from "../src/daemon/record-access.ts";
function fixture() {
  const snapshot = new AccessSnapshot();
  snapshot.putPrincipal({ id: "reader", kind: "person", status: "active" });
  snapshot.putRole({ id: "role", clearance: 3, perms: [] });
  snapshot.addPrincipalRole({ holder: "reader", role: "role" });
  snapshot.putResource({ id: "type", type: "record_type", parent_id: null, label: 0, owner_id: null, holds: 0 });
  snapshot.putResource({ id: "row", type: "record", parent_id: "type", label: 0, owner_id: null, holds: 0 });
  snapshot.putGrant({
    id: "grant",
    subject_kind: "actor",
    subject_id: "reader",
    resource_type: "record_type",
    resource_id: "type",
    level: "view",
    conditions: { hiddenFields: ["secret"] },
  });
  const row: StoredRecord = {
    id: "row",
    type: "type",
    version: 1,
    data: { name: "Visible", secret: "Hidden" },
    created_at: 1,
    updated_at: 1,
  };
  const store = {
    types: async () => [
      {
        name: "type",
        fields: [
          { name: "name", kind: "text" },
          { name: "secret", kind: "text", sensitivity: "restricted" },
        ],
      },
    ],
    get: async () => row,
  } as unknown as Store;
  const guard = createRecordAccess({ store: () => store, snapshot: () => snapshot, now: () => 1, fresh: () => true });
  const seed = { space: "space", principal: { kind: "person" as const, id: "reader" } };
  return { snapshot, row, store, guard, seed };
}
test("ordinary read projection rechecks permission after an awaited audit", async () => {
  const f = fixture();
  const finish = await f.guard.project(
    "records.get",
    { type: "type", recordId: "row" },
    f.seed,
    { record: { id: "row", fields: f.row.data } },
    "trace",
  );
  f.snapshot.putPrincipal({ id: "reader", kind: "person", status: "suspended" });
  await assert.rejects(Promise.resolve().then(finish));
});
test("ordinary read projection applies changed hidden fields after preparing its result", async () => {
  const f = fixture();
  const finish = await f.guard.project(
    "records.get",
    { type: "type", recordId: "row" },
    f.seed,
    { record: { id: "row", fields: f.row.data } },
    "trace",
  );
  f.snapshot.putGrant({
    id: "grant",
    subject_kind: "actor",
    subject_id: "reader",
    resource_type: "record_type",
    resource_id: "type",
    level: "view",
    conditions: { hiddenFields: ["name", "secret"] },
  });
  assert.deepEqual(((await finish()) as { record: { fields: unknown } }).record.fields, {});
});
test("conditional hidden-field probes are rejected before any canonical row query", async () => {
  const f = fixture();
  let queries = 0;
  f.store.query = async () => {
    queries++;
    return { rows: [] };
  };
  f.snapshot.putGrant({
    id: "grant",
    subject_kind: "actor",
    subject_id: "reader",
    resource_type: "record_type",
    resource_id: "type",
    level: "view",
    conditions: { rowFilter: { op: "eq", field: "name", value: "no visible row" }, hiddenFields: ["secret"] },
  });
  const ask = (input: Record<string, unknown>) =>
    f.guard.collection(
      "records.query",
      { type: "type", ...input },
      f.seed,
      {
        principal: "reader",
        action: { perm: null, level: "view" },
        resource: { type: "record_type", id: "type" },
        now: 1,
      },
      "trace",
    );
  await assert.rejects(
    ask({ filter: { field: "secret", op: "eq", value: "no match" } }),
    (error) => (error as { error?: { code?: string } }).error?.code === "permission.no_grant",
  );
  assert.equal(queries, 0);
});
test("a sort or group by a hidden field is not refused: the field counts as empty, so the stored order never follows its values", async () => {
  const f = fixture();
  const seen: unknown[] = [];
  f.store.query = async (_type: string, q: unknown) => {
    seen.push(q);
    return { rows: [f.row] };
  };
  f.snapshot.putGrant({
    id: "grant",
    subject_kind: "actor",
    subject_id: "reader",
    resource_type: "record_type",
    resource_id: "type",
    level: "view",
    conditions: { hiddenFields: ["secret"] },
  });
  for (const input of [{ sort: [{ field: "secret", dir: "asc" }] }, { group: "secret" }]) {
    const scoped = await f.guard.collection(
      "records.query",
      { type: "type", ...input },
      f.seed,
      {
        principal: "reader",
        action: { perm: null, level: "view" },
        resource: { type: "record_type", id: "type" },
        now: 1,
      },
      "trace",
    );
    assert.ok(scoped, "the read is answered by the scoped path");
    const out = (await scoped!.finish()) as { rows: Array<{ fields: Record<string, unknown> }> };
    assert.equal(out.rows.length, 1, "the row is still there");
    assert.equal("secret" in out.rows[0]!.fields, false, "and carries no hidden value");
    const last = seen[seen.length - 1] as { sort?: Array<{ field: string }> };
    assert.equal(
      (last.sort ?? []).some((row) => row.field === "secret"),
      false,
      "the read that answered was not ordered by the hidden field",
    );
  }
});
test("dropping classified fields or a type after preparation never declassifies retained values", async () => {
  const f = fixture();
  f.snapshot.putRole({ id: "role", clearance: 1, perms: [] });
  f.snapshot.putGrant({
    id: "grant",
    subject_kind: "actor",
    subject_id: "reader",
    resource_type: "record_type",
    resource_id: "type",
    level: "view",
  });
  const finish = await f.guard.project(
    "records.get",
    { type: "type", recordId: "row" },
    f.seed,
    { record: { id: "row", version: 1, fields: f.row.data } },
    "trace",
  );
  f.store.types = async () => [{ name: "type", fields: [{ name: "name", kind: "text" }] }];
  const result = (await finish()) as { record: { id: string; version: number; fields: Record<string, unknown> } };
  assert.deepEqual(result.record.fields, { name: "Visible" });
  assert.equal(result.record.id, "row");
  assert.equal(result.record.version, 1);
  f.store.types = async () => [];
  await assert.rejects(Promise.resolve().then(finish));
});
test("a query that filters, sorts or groups by a field no row has set is allowed: an unset field is not a hidden one", async () => {
  const f = fixture();
  f.snapshot.putGrant({
    id: "grant",
    subject_kind: "actor",
    subject_id: "reader",
    resource_type: "record_type",
    resource_id: "type",
    level: "view",
  });
  f.store.types = async () =>
    [
      {
        name: "type",
        fields: [
          { name: "name", kind: "text" },
          { name: "secret", kind: "text", sensitivity: "restricted" },
          { name: "stage", kind: "choice" },
        ],
      },
    ] as never;
  for (const input of [
    { filter: { field: "stage", op: "empty" } },
    { sort: [{ field: "stage", dir: "asc" }] },
    { group: "stage" },
  ]) {
    const finish = await f.guard.project(
      "records.query",
      { type: "type", ...input },
      f.seed,
      { rows: [{ id: "row", fields: { name: "Visible" } }] },
      "trace",
    );
    assert.deepEqual(
      ((await finish()) as { rows: { id: string }[] }).rows.map((row) => row.id),
      ["row"],
    );
  }
});
const grant = (f: ReturnType<typeof fixture>) =>
  f.snapshot.putGrant({
    id: "grant",
    subject_kind: "actor",
    subject_id: "reader",
    resource_type: "record_type",
    resource_id: "type",
    level: "view",
  });
const page = (...ids: string[]) => ({ rows: ids.map((id) => ({ id, fields: { name: id } })) });
test("a read that returns a record the snapshot has not folded yet folds what is pending and waits for it, however slow the fold is", async () => {
  const f = fixture();
  grant(f);
  f.store.get = (async (_type: string, id: string) => ({ ...f.row, id, data: { name: id } })) as never;
  let refreshes = 0;
  const guard = createRecordAccess({
    store: () => f.store,
    snapshot: () => f.snapshot,
    now: () => 1,
    fresh: () => true,
    settleMs: [0, 0, 0, 0, 0, 0, 0],
    refresh: async () => {
      refreshes++;
      if (refreshes === 6)
        f.snapshot.putResource({ id: "late", type: "record", parent_id: "type", label: 0, owner_id: null, holds: 0 });
    },
  });
  const finish = await guard.project("records.query", { type: "type" }, f.seed, page("row", "late"), "trace");
  assert.deepEqual(
    ((await finish()) as { rows: { id: string }[] }).rows.map((row) => row.id),
    ["row", "late"],
  );
  assert.equal(refreshes, 6, "it kept folding until the entry was there, then stopped");
});
test("a row that never becomes known, one that was removed and one this person may no longer see are left out of the page; the page is still answered and shows nothing it should not", async () => {
  const f = fixture();
  grant(f);
  f.snapshot.putResource({ id: "denied", type: "record", parent_id: "other", label: 0, owner_id: null, holds: 0 });
  f.store.get = (async (_type: string, id: string) =>
    id === "gone" ? null : { ...f.row, id, data: { name: id } }) as never;
  let refreshes = 0;
  const warned: { allowed: number; returned: number; missing: string[] }[] = [];
  const guard = createRecordAccess({
    store: () => f.store,
    snapshot: () => f.snapshot,
    now: () => 1,
    fresh: () => true,
    settleMs: [0, 0],
    refresh: async () => {
      refreshes++;
    },
    warn: (info) => warned.push(info),
  });
  const finish = await guard.project(
    "records.query",
    { type: "type" },
    f.seed,
    { ...page("row", "never", "gone", "denied", "row"), next: "n" },
    "trace",
  );
  const out = (await finish()) as { rows: { id: string }[]; next?: string };
  assert.deepEqual(
    out.rows.map((row) => row.id),
    ["row", "row"],
  );
  assert.equal(out.next, "n", "the cursor goes on");
  assert.deepEqual([...(warned[0]?.missing ?? [])].sort(), ["denied", "gone", "never"]);
  assert.ok(refreshes > 0 && refreshes <= 3, "it waited a bounded number of folds");
});
test("a snapshot that cannot be brought up to date refuses the read so it can be asked again, never a page with rows missing", async () => {
  const f = fixture();
  grant(f);
  let stale = true;
  const guard = createRecordAccess({
    store: () => f.store,
    snapshot: () => f.snapshot,
    now: () => 1,
    fresh: () => !stale,
    settleMs: [0, 0],
    refresh: async () => {},
  });
  const finish = await guard.project("records.query", { type: "type" }, f.seed, page("row"), "trace");
  await assert.rejects(
    Promise.resolve().then(finish),
    (error) => (error as { error?: { code?: string } }).error?.code === "internal.unavailable",
  );
  stale = false;
  assert.equal(((await finish()) as { rows: unknown[] }).rows.length, 1, "asked again once the snapshot is current");
});
test("a restricted reader's page waits for a record the snapshot has not folded yet instead of skipping it", async () => {
  const f = fixture();
  const ids = ["row", "late", "tail"];
  f.store.query = (async (_type: string, q: { page?: { cursor?: string } }) => {
    const at = q.page?.cursor ? Number(q.page.cursor) : 0;
    const id = ids[at]!;
    return {
      rows: [{ ...f.row, id, data: { name: id, secret: "s" } }],
      ...(at + 1 < ids.length ? { next_cursor: String(at + 1) } : {}),
    };
  }) as never;
  f.store.describe = (async () => ({ name: "type", fields: [{ name: "name", kind: "text" }] })) as never;
  let refreshes = 0;
  const guard = createRecordAccess({
    store: () => f.store,
    snapshot: () => f.snapshot,
    now: () => 1,
    fresh: () => true,
    settleMs: [0, 0, 0],
    refresh: async () => {
      refreshes++;
      for (const id of ["late", "tail"])
        f.snapshot.putResource({ id, type: "record", parent_id: "type", label: 0, owner_id: null, holds: 0 });
    },
  });
  const req = {
    principal: "reader",
    action: { perm: null, level: "view" as const },
    resource: { type: "record_type", id: "type" },
    now: 1,
  };
  const read = async (): Promise<string[]> => {
    const part = await guard.collection("records.query", { type: "type", limit: 10 }, f.seed, req, "trace");
    assert.ok(part, "the scoped path answers");
    return ((await part.finish()) as { rows: { id: string; fields: Record<string, unknown> }[] }).rows.map((row) => {
      assert.equal(row.fields["secret"], undefined, "a hidden field never shows");
      return row.id;
    });
  };
  assert.deepEqual(await read(), ["row", "late", "tail"], "no existing record was skipped");
  assert.equal(refreshes, 1, "one fold found them");
});

test("a page of 200 records reads their computed values and rows in a constant number of queries, whatever the type has", async () => {
  const f = fixture();
  const ids = Array.from({ length: 200 }, (_, i) => `row${i}`);
  for (const id of ids)
    f.snapshot.putResource({ id, type: "record", parent_id: "type", label: 0, owner_id: null, holds: 0 });
  const store = {
    types: async () => [
      {
        name: "type",
        fields: [
          { name: "name", kind: "text" },
          { name: "secret", kind: "text", sensitivity: "restricted" },
          { name: "double0", kind: "number" },
          { name: "double1", kind: "number" },
          { name: "double2", kind: "number" },
        ],
      },
    ],
    get: async (_t: string, id: string) => ({ ...f.row, id }),
  } as unknown as Store;
  let asked = 0;
  const side: { has: boolean; fields: number } = { has: false, fields: 1 };
  const guard = createRecordAccess({
    store: () => store,
    snapshot: () => f.snapshot,
    now: () => 1,
    fresh: () => true,
    rows: {
      all: (sql: string, ...args: unknown[]) => {
        asked++;
        if (/FROM records_computed WHERE type = \? LIMIT 1/.test(sql)) return side.has ? [{ x: 1 }] : [];
        if (/FROM records_computed_job/.test(sql)) return [];
        if (/FROM records_computed WHERE type = \? AND id IN/.test(sql))
          return (args.slice(1) as string[]).flatMap((id) =>
            Array.from({ length: side.fields }, (_, n) => ({
              id,
              field: `double${n}`,
              value: "2",
              inputs: '["type.name"]',
              kind: "formula",
              computed_at: 1,
              link_ids: null,
            })),
          );
        if (/FROM rt_type WHERE deleted_at IS NULL AND id IN/.test(sql))
          return (args as string[]).map((id) => ({ id, data: JSON.stringify(f.row.data) }));
        if (/FROM records_computed WHERE type = \? AND id = \?/.test(sql) || /FROM rt_type WHERE id = \?/.test(sql))
          return ["one query for one record"].map(() => ({}));
        return [];
      },
    },
  });
  const page = ids.map((id) => ({ id, fields: f.row.data }));
  const run = async (): Promise<{ asked: number; rows: Array<{ fields: Record<string, unknown> }> }> => {
    asked = 0;
    const finish = await guard.project("records.query", { type: "type" }, f.seed, { rows: page }, "trace");
    const out = (await finish()) as { rows: Array<{ fields: Record<string, unknown> }> };
    return { asked, rows: out.rows };
  };
  const without = await run();
  side.has = true;
  const one = await run();
  side.fields = 3;
  const three = await run();
  console.log(
    `SQL statements for a page of 200 rows: ${without.asked} with no computed field, ${one.asked} with one, ${three.asked} with three`,
  );
  assert.equal(without.rows.length, 200);
  assert.ok(
    without.asked <= 2,
    `a type with no computed field costs a constant number of statements (${without.asked})`,
  );
  assert.ok(
    one.rows.every((r) => r.fields["double0"] === 2),
    "control: every row has its computed value",
  );
  assert.ok(
    three.rows.every((r) => r.fields["double2"] === 2),
    "and with three computed fields",
  );
  assert.ok(
    one.asked <= 8 && three.asked <= 8,
    `a page costs a constant number of statements however many rows and fields (${one.asked}, ${three.asked})`,
  );
});
