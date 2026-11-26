// The doctor row for computed fields: fills that are stuck half done, and the consumer that keeps the values being far behind the log. Counts, types and fields, never a value; read-only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { computedFieldsFinding } from "../src/daemon/doctor.ts";

const NOW = 1_800_000_000_000;
function world(o: {
  jobs?: Array<[string, string, number, number, string, number | null]>;
  cursor?: number;
  head?: number;
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-doc-computed-"));
  const space = path.join(dir, "space.db");
  const modules = path.join(dir, "modules.db");
  const events = path.join(dir, "events.db");
  const s = new DatabaseSync(space);
  s.exec(
    "CREATE TABLE records_computed_job (type TEXT, field TEXT, def_hash TEXT, cursor TEXT, done INTEGER, total INTEGER, state TEXT, updated_at INTEGER, error TEXT, PRIMARY KEY (type, field))",
  );
  for (const [type, field, done, total, state, at] of o.jobs ?? [])
    s.prepare("INSERT INTO records_computed_job VALUES (?, ?, 'h', NULL, ?, ?, ?, ?, NULL)").run(
      type,
      field,
      done,
      total,
      state,
      at,
    );
  s.close();
  const m = new DatabaseSync(modules);
  m.exec("CREATE TABLE host_hook_cursor (name TEXT PRIMARY KEY, seq INTEGER NOT NULL, at INTEGER NOT NULL)");
  if (o.cursor !== undefined) m.prepare("INSERT INTO host_hook_cursor VALUES ('records.computed', ?, 1)").run(o.cursor);
  m.close();
  const e = new DatabaseSync(events);
  e.exec("CREATE TABLE events (seq INTEGER PRIMARY KEY, type TEXT)");
  if (o.head !== undefined) e.prepare("INSERT INTO events VALUES (?, 'x')").run(o.head);
  e.close();
  return { space, modules, events };
}

test("a fill that is moving or done is healthy; one failed or not moved for an hour is stuck and named; a consumer far behind says so", () => {
  const ok = world({ jobs: [["line", "total", 100, 9500, "running", NOW - 5_000]], cursor: 990, head: 1000 });
  const a = computedFieldsFinding(ok.space, ok.modules, ok.events, NOW);
  assert.equal(a.state, "healthy", "a fill that moved a moment ago is not stuck");
  const failed = world({ jobs: [["line", "total", 100, 9500, "failed", NOW - 5_000]], cursor: 990, head: 1000 });
  const b = computedFieldsFinding(failed.space, failed.modules, failed.events, NOW);
  assert.equal(b.state, "degraded");
  assert.match(b.detail, /line\.total 100 of 9500, failed/);
  const old = world({ jobs: [["line", "total", 100, 9500, "running", NOW - 2 * 3_600_000]], cursor: 1, head: 1 });
  assert.equal(
    computedFieldsFinding(old.space, old.modules, old.events, NOW).state,
    "degraded",
    "not moved for two hours",
  );
  const behind = world({ cursor: 10, head: 5_000 });
  const c = computedFieldsFinding(behind.space, behind.modules, behind.events, NOW);
  assert.equal(c.state, "degraded");
  assert.match(c.detail, /4990 events behind/);
  assert.match(c.next, /save the stuck field again/);
  const none = world({ cursor: 5, head: 6 });
  assert.equal(computedFieldsFinding(none.space, none.modules, none.events, NOW).state, "healthy");
  assert.equal(
    computedFieldsFinding(path.join(os.tmpdir(), "vyre-no-space.db"), none.modules, none.events, NOW).state,
    "healthy",
  );
});
