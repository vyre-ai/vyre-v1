// records.bulk_upsert makes new records a run at a time, one commit for the run (the log's group commit), not one commit per row. The state it leaves is the state the one-at-a-time path leaves:
// the same rows, the same field clocks, the same events in the same order, and a refused row is refused alone with the rows around it made.
import test from "node:test";
import assert from "node:assert/strict";
import { openRecords } from "../impl.ts";
import { createMergeHandlers } from "../handlers/merge.ts";
import type { MergeDeps } from "../handlers/merge.ts";

const PARTY = Object.freeze({
  name: "party",
  label: "Party",
  fields: [
    { name: "name", kind: "text", label: "Name" },
    { name: "email", kind: "text", label: "Email" },
    { name: "age", kind: "number", label: "Age" },
  ],
});

async function run(grouped: boolean) {
  const rec = openRecords({ space: "spc_aaaaaaaaaaaa", path: ":memory:" });
  await rec.store.define({ add_types: [PARTY] as never });
  let batches = 0;
  const log = rec.host.store as unknown as { appendBatch: (b: unknown[]) => unknown };
  const was = log.appendBatch.bind(log);
  log.appendBatch = (b) => {
    batches++;
    return was(b);
  };
  const store = grouped ? rec.store : ({ ...rec.store, createMany: undefined } as typeof rec.store);
  const deps: MergeDeps = { store, tx: rec.host.tx, now: () => 1_800_000_000_000, putFile: async () => "file_1" };
  const emitted: string[] = [];
  const ctx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    emit: (type: string) => void emitted.push(type),
    actor: "usr_dana",
    authorize: () => ({ effect: "allow" }),
  };
  const h = createMergeHandlers(deps);
  const first = Array.from({ length: 450 }, (_, i) => ({ name: `P ${i}`, email: `p${i}@x.test`, age: i }));
  // row 7 holds a value its field refuses: only that row is refused
  (first[7] as Record<string, unknown>)["age"] = "seven";
  const a = await h["records.bulk_upsert"](ctx as never, { type: "party", match: ["email"], rows: first, createOnly: true });
  // a second call mixes rows that exist (updated, skipped) with new ones, in one order
  const second = [
    { name: "P 1 changed", email: "p1@x.test", age: 1 },
    { name: "P 2", email: "p2@x.test", age: 2 },
    ...Array.from({ length: 30 }, (_, i) => ({ name: `Q ${i}`, email: `q${i}@x.test`, age: i })),
    { name: "P 3 changed", email: "p3@x.test", age: 3 },
  ];
  const b = await h["records.bulk_upsert"](ctx as never, { type: "party", match: ["email"], rows: second });
  const dump = (sql: string, ...args: unknown[]) => rec.host.tx.all<Record<string, unknown>>(sql, ...args);
  const rows = dump("SELECT version, data FROM rt_party ORDER BY json_extract(data, '$.email')").map((r) => `${r["version"]} ${r["data"]}`);
  const clocks = dump("SELECT p.data AS d, f.field AS field, f.actor AS actor FROM rt_party__fm f JOIN rt_party p ON p.id = f.id").map(
    (r) => `${JSON.parse(String(r["d"])).email} ${r["field"]} ${r["actor"]}`,
  );
  const events = dump("SELECT json_extract(event, '$.type') AS t FROM events ORDER BY seq").map((r) => String(r["t"]));
  const history = dump("SELECT count(*) AS n FROM records_field_history")[0]!["n"];
  return {
    out: [a, b].map((o) => JSON.stringify(o, (k, v) => (k === "message" ? undefined : v))),
    rows: rows.sort(),
    clocks: clocks.sort(),
    events,
    emitted,
    history,
    batches,
  };
}

test("a group of new rows leaves the same state as one row at a time, in far fewer commits, and a refused row is refused alone", async () => {
  const one = await run(false);
  const many = await run(true);
  assert.deepEqual(many.out, one.out, "the same answers: created, updated, skipped and the one refused row");
  assert.match(many.out[0]!, /"created":449/);
  assert.match(many.out[0]!, /"row":7/);
  assert.equal(many.rows.length, 449 + 30);
  assert.deepEqual(many.rows, one.rows);
  assert.deepEqual(many.clocks, one.clocks);
  assert.deepEqual(many.events, one.events, "the same events in the same order");
  assert.deepEqual(many.emitted, one.emitted);
  assert.equal(many.history, one.history);
  assert.ok(one.batches >= 449 + 30, `one commit per new row before: ${one.batches}`);
  assert.ok(many.batches <= 8, `a run of rows is one commit: ${many.batches}`);
});

test("a group that fails at its commit leaves none of its rows: no record, no event, no field clock; the next group is made whole", async () => {
  const rec = openRecords({ space: "spc_aaaaaaaaaaaa", path: ":memory:" });
  await rec.store.define({ add_types: [PARTY] as never });
  const count = (sql: string): number => Number(rec.host.tx.all<Record<string, unknown>>(sql)[0]!["n"]);
  const before = { events: count("SELECT count(*) AS n FROM events"), rows: count("SELECT count(*) AS n FROM rt_party") };
  const db = (rec.host as unknown as { raw: { exec: (sql: string) => void } }).raw;
  const exec = db.exec.bind(db);
  let armed = true;
  db.exec = (sql: string) => {
    if (armed && sql === "COMMIT") {
      armed = false;
      throw new Error("disk full");
    }
    return exec(sql);
  };
  const items = Array.from({ length: 50 }, (_, i) => ({ id: `rec_${i.toString(16).padStart(32, "0")}`, data: { name: `P ${i}`, email: `p${i}@x.test`, age: i } }));
  const failed = await rec.store.createMany!("party", items);
  assert.equal(failed.filter((m) => m.ok).length, 0, "every item of the group reports the failure");
  assert.equal(count("SELECT count(*) AS n FROM events"), before.events, "no event of the group is left");
  assert.equal(count("SELECT count(*) AS n FROM rt_party"), before.rows, "no record of the group is left");
  assert.equal(count("SELECT count(*) AS n FROM rt_party__fm"), 0, "no field clock is left");
  const made = await rec.store.createMany!("party", items);
  assert.equal(made.filter((m) => m.ok).length, 50);
  assert.equal(count("SELECT count(*) AS n FROM rt_party"), 50);
  assert.equal(count("SELECT count(*) AS n FROM rt_party__fm"), 150);
});

test("one event the log refuses on its own in the middle of a run is that row's refusal: the rows around it are made, counted and emitted, and nothing is called not done", async () => {
  const rec = openRecords({ space: "spc_aaaaaaaaaaaa", path: ":memory:" });
  await rec.store.define({ add_types: [PARTY] as never });
  const log = rec.host.store as unknown as { appendBatch: (b: { type: string }[]) => unknown };
  const was = log.appendBatch.bind(log);
  log.appendBatch = (b) => {
    if (b.length > 25) b[25]!.type = "NOT A TYPE"; // the log refuses this one event alone
    return was(b);
  };
  const emitted: string[] = [];
  const ctx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    emit: (type: string) => void emitted.push(type),
    actor: "usr_dana",
    authorize: () => ({ effect: "allow" }),
  };
  const h = createMergeHandlers({ store: rec.store, tx: rec.host.tx, now: () => 1_800_000_000_000, putFile: async () => "file_1" });
  const rows = Array.from({ length: 60 }, (_, i) => ({ name: `P ${i}`, email: `p${i}@x.test`, age: i }));
  const out = await h["records.bulk_upsert"](ctx as never, { type: "party", match: ["email"], rows, createOnly: true });
  const stored = Number(rec.host.tx.all<Record<string, unknown>>("SELECT count(*) AS n FROM rt_party")[0]!["n"]);
  assert.equal(out.stopped, undefined, "the call did not stop");
  assert.equal(out.created, 59);
  assert.deepEqual(out.refused?.map((r) => r.row), [25]);
  assert.equal(stored, 59, "what is stored is what was counted");
  assert.equal(emitted.length, 59, "each stored record was announced");
});
