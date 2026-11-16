// A join object (who is on which deal) relates two already-synced records through a many-to-many relation: a row that appears relates, a row that changes its ends moves the relation,
// a row the app no longer returns unrelates only when no other live join row holds the same pair, an end not pulled yet waits and is tried again, and a repeat pass changes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { mintRecordId } from "../../lib/ids.ts";
import { openRecordStore } from "../../kernel/src/store/records.ts";
import { applyLinks, createSyncEngine, namesFor } from "../src/daemon/syncengine.ts";
import type { BindingRow, EngineCtx, LinkDef, SyncCore } from "../src/daemon/syncengine.ts";
import type { StoredRecord } from "../../kernel/src/store/types.ts";

const MATTER = {
  name: "matter",
  label: "Matter",
  fields: [
    { name: "name", kind: "text", label: "Name" },
    { name: "people", kind: "link", label: "People", to: "person", many: true },
  ],
};
const PERSON = {
  name: "person",
  label: "Person",
  fields: [
    { name: "name", kind: "text", label: "Name" },
    { name: "matters", kind: "link", label: "Matters", to: "matter", many: true },
  ],
};
const LINK: LinkDef = {
  from: { type: "matter", at: "/matter_id" },
  to: { type: "person", at: "/person_id" },
  key: "people",
  inverseKey: "matters",
};
const SID = "syt_join";

async function kit() {
  const l = openRecordStore({ path: ":memory:", space: "sp_local" });
  await l.store.define({ add_types: [MATTER, PERSON] });
  l.host.tx.exec(
    "CREATE TABLE IF NOT EXISTS sy_links (sync_type TEXT NOT NULL, local_id TEXT NOT NULL, remote_id TEXT NOT NULL, base TEXT NOT NULL, removed_at INTEGER, PRIMARY KEY (sync_type, local_id))",
  );
  l.host.tx.exec(
    "CREATE TABLE IF NOT EXISTS sy_state (sync_type TEXT PRIMARY KEY, cursor TEXT, last_run_at INTEGER, pending_deletes TEXT)",
  );
  const typeIds = new Map([
    ["matter", "syt_matter"],
    ["person", "syt_person"],
  ]);
  /** A record pulled for an app id (its link row is what the engine's own pull leaves behind). */
  const pulled = async (type: "matter" | "person", remote: string): Promise<string> => {
    const id = mintRecordId();
    await l.store.create(type, id, { name: `${type} ${remote}` });
    l.host.tx.run(
      "INSERT INTO sy_links (sync_type, local_id, remote_id, base, removed_at) VALUES (?, ?, ?, '{}', NULL)",
      typeIds.get(type)!,
      id,
      remote,
    );
    return id;
  };
  const row = (id: string, matter: string, person: string): StoredRecord => ({
    type: "joins",
    id,
    version: 1,
    data: { "/matter_id": matter, "/person_id": person },
    created_at: 0,
    updated_at: 0,
  });
  const pass = (rows: StoredRecord[], seen?: Set<string>) =>
    applyLinks({
      tx: l.host.tx,
      local: l.store,
      space: "sp_local",
      syncTypeId: SID,
      link: LINK,
      typeIds,
      rows,
      ...(seen ? { seen } : {}),
    });
  const urns = async (type: string, id: string, field: string): Promise<string[]> =>
    (((await l.store.get(type, id))!.data[field] as { urn: string }[] | undefined) ?? []).map((u) => u.urn);
  const urn = (type: string, id: string) => `vyre://sp_local/${type}/${id}`;
  return { l, pulled, row, pass, urns, urn };
}

test("a join row relates its two records at both ends, many to many, and a repeat changes nothing", async () => {
  const k = await kit();
  const m1 = await k.pulled("matter", "m1"),
    m2 = await k.pulled("matter", "m2");
  const p1 = await k.pulled("person", "p1"),
    p2 = await k.pulled("person", "p2");
  const rows = [k.row("j1", "m1", "p1"), k.row("j2", "m1", "p2"), k.row("j3", "m2", "p1")];
  assert.deepEqual(await k.pass(rows), { made: 3, removed: 0, waiting: 0 });
  assert.deepEqual((await k.urns("matter", m1, "people")).sort(), [k.urn("person", p1), k.urn("person", p2)].sort());
  assert.deepEqual((await k.urns("person", p1, "matters")).sort(), [k.urn("matter", m1), k.urn("matter", m2)].sort());
  assert.deepEqual(await k.urns("matter", m2, "people"), [k.urn("person", p1)]);
  // the same rows again, and a backfill of everything: no write, no count
  assert.deepEqual(await k.pass(rows), { made: 0, removed: 0, waiting: 0 });
  assert.deepEqual(await k.pass(rows, new Set(["j1", "j2", "j3"])), { made: 0, removed: 0, waiting: 0 });
  assert.equal((await k.l.store.get("matter", m1))!.version, 2, "one write made both relations on m1, nothing after");
});

test("a row that changes its ends moves the relation", async () => {
  const k = await kit();
  const m1 = await k.pulled("matter", "m1"),
    m2 = await k.pulled("matter", "m2");
  const p1 = await k.pulled("person", "p1");
  await k.pass([k.row("j1", "m1", "p1")]);
  assert.deepEqual(await k.pass([k.row("j1", "m2", "p1")]), { made: 1, removed: 1, waiting: 0 });
  assert.deepEqual(await k.urns("matter", m1, "people"), []);
  assert.deepEqual(await k.urns("matter", m2, "people"), [k.urn("person", p1)]);
  assert.deepEqual(await k.urns("person", p1, "matters"), [k.urn("matter", m2)]);
});

test("a row the app no longer returns unrelates only when no other live join row holds the same pair", async () => {
  const k = await kit();
  const m1 = await k.pulled("matter", "m1");
  const p1 = await k.pulled("person", "p1");
  // two join rows say the same pair (two relationship types)
  await k.pass([k.row("j1", "m1", "p1"), k.row("j2", "m1", "p1")]);
  assert.deepEqual(await k.urns("matter", m1, "people"), [k.urn("person", p1)]);
  // the sweep finds j1 gone: j2 still holds the pair
  assert.deepEqual(await k.pass([], new Set(["j2"])), { made: 0, removed: 0, waiting: 0 });
  assert.deepEqual(await k.urns("matter", m1, "people"), [k.urn("person", p1)]);
  // then j2 is gone too
  assert.deepEqual(await k.pass([], new Set()), { made: 0, removed: 1, waiting: 0 });
  assert.deepEqual(await k.urns("matter", m1, "people"), []);
  assert.deepEqual(await k.urns("person", p1, "matters"), []);
  // a delta pull of rows alone (no sweep) never unrelates
  await k.pass([k.row("j3", "m1", "p1")]);
  assert.deepEqual(await k.pass([]), { made: 0, removed: 0, waiting: 0 });
  assert.deepEqual(await k.urns("matter", m1, "people"), [k.urn("person", p1)]);
});

test("an end that is not pulled yet waits and is related on a later pass, never dropped or linked by a bare id", async () => {
  const k = await kit();
  const m1 = await k.pulled("matter", "m1");
  assert.deepEqual(await k.pass([k.row("j1", "m1", "p1")]), { made: 0, removed: 0, waiting: 1 });
  assert.deepEqual(await k.urns("matter", m1, "people"), []);
  // what the Sync page counts (the same queries as sync_types.status)
  const counts = () => ({
    made: k.l.host.tx.get<{ n: number }>("SELECT count(*) AS n FROM sy_related WHERE sync_type = ?", SID)!.n,
    waiting: k.l.host.tx.get<{ n: number }>(
      "SELECT count(*) AS n FROM (SELECT DISTINCT lft, rgt FROM sy_pairs p WHERE sync_type = ? AND live = 1 AND NOT EXISTS (SELECT 1 FROM sy_related r WHERE r.sync_type = p.sync_type AND r.lft = p.lft AND r.rgt = p.rgt))",
      SID,
    )!.n,
  });
  assert.deepEqual(counts(), { made: 0, waiting: 1 });
  // the pass after, with no rows at all, still tries it: the person is in now
  const p1 = await k.pulled("person", "p1");
  assert.deepEqual(await k.pass([]), { made: 1, removed: 0, waiting: 0 });
  assert.deepEqual(await k.urns("matter", m1, "people"), [k.urn("person", p1)]);
  assert.deepEqual(counts(), { made: 1, waiting: 0 });
  // an id that belongs to another synced type does not count: the person with remote id "x" is not the matter "x"
  await k.pulled("person", "x");
  assert.deepEqual(await k.pass([k.row("j2", "x", "p1")]), { made: 0, removed: 0, waiting: 1 });
});

// ---- through the engine: the link rides the pass that pulls the join rows, with no call to the app of its own

test("namesFor reads a link off the connector's object and ignores a malformed one", () => {
  assert.deepEqual(namesFor({ joins: { list: "list_joins", link: LINK } }, "joins").link, LINK);
  assert.equal(namesFor({ joins: { link: { key: "people" } } }, "joins").link, undefined);
});

test("a pass over the join object relates the records it already pulled, makes no extra call, and the next pass is quiet", async () => {
  const k = await kit();
  const m1 = await k.pulled("matter", "m1");
  const p1 = await k.pulled("person", "p1");
  const p2 = await k.pulled("person", "p2");
  const calls: string[] = [];
  const ctx: EngineCtx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    emit: () => ({}),
    call: async (cap, input) => {
      calls.push(cap);
      if (cap === "connectors.get") return { connector: { objects: { joins: { list: "list_joins", link: LINK } } } };
      if (cap === "sync_types.get") {
        const type = (input as { type: string }).type;
        return { syncedType: { syncTypeId: type === "matter" ? "syt_matter" : "syt_person" } };
      }
      if (cap === "connectors.read")
        return {
          output: {
            rows: [
              { id: "j1", data: { "/matter_id": "m1", "/person_id": "p1" } },
              { id: "j2", data: { "/matter_id": "m1", "/person_id": "p2" } },
            ],
          },
        };
      throw new Error(`no ${cap}`);
    },
  };
  const core = {
    runSync: async () => ({
      local: { created: 2, updated: 0 },
      remote: { created: 0, updated: 0, removed: 0 },
      matched: 0,
      ambiguous: 0,
      conflicts: 0,
      askedConflicts: 0,
      removedAtSource: 0,
      pausedDeletes: false,
      summary: "2 new.",
    }),
  } as unknown as SyncCore;
  const engine = createSyncEngine({
    core,
    local: { open: () => ({ store: k.l.store, tx: k.l.host.tx }), space: "sp_local" },
  });
  const b: BindingRow = {
    syncTypeId: SID,
    type: "join",
    connector: "crm",
    connectionId: "conn",
    remote: "joins",
    fields: [],
    match: [],
    createAtSource: false,
    deletes: "off",
    conflict: "newest",
  };
  const first = await engine.run(ctx, b, { mode: "incremental" });
  assert.match(first.summary, /2 links made/);
  assert.deepEqual((await k.urns("matter", m1, "people")).sort(), [k.urn("person", p1), k.urn("person", p2)].sort());
  assert.equal(calls.filter((c) => c === "connectors.read").length, 1, "one page read, none for the links");
  const again = await engine.run(ctx, b, { mode: "incremental" });
  assert.doesNotMatch(again.summary, /link/);
});
