// @reads /modules/sources/migrations/0001_sources.sql
// A slice of the app's records costs the slice, not the type (17 Nov 2026, a firm's server: every pass listed and decoded every local record of a 100,000-record type to match a few hundred incoming
// rows, 14 s of every 90 s). A type of 50,000 linked records takes a pass over 3 changed rows inside the budget. A speed number counts only on the v1-perf runners (ruling 46).
import test from "node:test";
import assert from "node:assert/strict";
import { mintRecordId } from "../../../lib/ids.ts";
import { openRecordStore } from "../../../kernel/src/store/records.ts";
import type { StoredRecord } from "../../../kernel/src/store/types.ts";
import { openSources } from "../impl.ts";
import { runSync } from "../handlers/sync.ts";
import type { SyncBinding, SyncDeps } from "../handlers/sync.ts";

const TOTAL = 50_000;
const BUDGET_MS = 300;
const FIELDS = Array.from({ length: 30 }, (_, f) => ({ name: `f${f}`, kind: "text" }));

test("a pass over 3 changed rows of a type of 50,000 linked records takes under 300 ms", async () => {
  const clock = { t: 1000 };
  const local = openRecordStore({ path: ":memory:", space: "sp_slice_local", clock: () => clock.t });
  const remote = openRecordStore({ path: ":memory:", space: "sp_slice_remote", clock: () => clock.t });
  await local.store.define({
    add_types: [{ name: "matter", label: "Matter", fields: [{ name: "name", kind: "text" }, ...FIELDS] }],
  });
  await remote.store.define({
    add_types: [{ name: "app_matter", label: "App matter", fields: [{ name: "title", kind: "text" }] }],
  });
  const src = openSources({ tx: local.host.tx, now: () => clock.t });
  const data = JSON.stringify({
    name: "Matter",
    ...Object.fromEntries(FIELDS.map((f) => [f.name, `value ${f.name} lorem ipsum dolor sit amet`])),
  });
  local.host.tx.exec("BEGIN");
  const ids: string[] = [];
  for (let i = 0; i < TOTAL; i++) {
    const id = mintRecordId();
    ids.push(id);
    local.host.tx.run(
      "INSERT INTO rt_matter (id, version, created_at, updated_at, deleted_at, data) VALUES (?, 1, 1, 1, NULL, ?)",
      id,
      data,
    );
    local.host.tx.run(
      "INSERT INTO sy_links (sync_type, local_id, remote_id, base, removed_at) VALUES ('syt_p', ?, ?, ?, NULL)",
      id,
      `app_${i}`,
      JSON.stringify({ name: "Matter" }),
    );
  }
  local.host.tx.exec("COMMIT");
  const binding: SyncBinding = {
    syncTypeId: "syt_p",
    type: "matter",
    remote: "app_matter",
    connector: "app",
    label: "App",
    fields: [{ local: "name", remote: "title", direction: "pull" }],
    match: ["name"],
    createAtSource: false,
    deletes: false,
    conflict: "newest",
  };
  const slice: StoredRecord[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await remote.store.create("app_matter", mintRecordId(), { title: `Renamed ${i}` });
    slice.push({ ...r, id: `app_${i}` });
  }
  const deps: SyncDeps = { local: local.store, remote: remote.store, tx: src.tx, now: () => clock.t, emit: () => {} };
  const started = performance.now();
  const out = await runSync(deps, binding, { mode: "both", partial: slice, pushLocalSince: 1 });
  const tookMs = Math.round(performance.now() - started);
  process.stderr.write(`[slice-perf] a pass over 3 rows of ${TOTAL} took ${tookMs} ms\n`);
  assert.equal(out.local.updated, 3);
  assert.ok(tookMs <= BUDGET_MS, `the pass took ${tookMs} ms (budget ${BUDGET_MS} ms)`);
});
