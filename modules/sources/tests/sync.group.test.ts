// A pull makes the new records a group at a time, one commit for the group (the store's group commit), not one commit each. The state it leaves is the state the one-at-a-time path leaves: the same records,
// the same field clocks, the same links and sync rows, the same events in the same order, the same report; an item the store refuses is skipped alone with the rest made; a group whose commit fails makes nothing
// and the next pass makes it.
import test from "node:test";
import assert from "node:assert/strict";
import { openRecordStore } from "../../../kernel/src/store/records.ts";
import { mintRecordId } from "../../../lib/ids.ts";
import type { Store } from "../../../kernel/src/store/types.ts";
import { openSources } from "../impl.ts";
import { runSync } from "../handlers/sync.ts";
import type { SyncBinding, SyncDeps } from "../handlers/sync.ts";

const LOCAL = {
  name: "contact",
  label: "Contact",
  fields: [
    { name: "name", kind: "text", label: "Name" },
    { name: "email", kind: "text", label: "Email" },
    { name: "tier", kind: "choice", label: "Tier", options: ["gold", "silver"] },
  ],
};
const REMOTE = {
  name: "hs_contact",
  label: "Remote contact",
  fields: [
    { name: "full_name", kind: "text" },
    { name: "email_address", kind: "text" },
    { name: "tier", kind: "text" },
  ],
};
const BINDING: SyncBinding = {
  syncTypeId: "syt_1",
  type: "contact",
  remote: "hs_contact",
  connector: "crm",
  label: "CRM",
  fields: [
    { local: "name", remote: "full_name", direction: "both" },
    { local: "email", remote: "email_address", direction: "both" },
    { local: "tier", remote: "tier", direction: "pull" },
  ],
  match: ["email"],
  createAtSource: false,
  deletes: false,
  conflict: "newest",
};

interface Fail {
  commit?: boolean;
}
async function pull(grouped: boolean, rows: number, fail: Fail = {}) {
  const clock = { t: 1000 };
  const localOpen = openRecordStore({ path: ":memory:", space: "sp_local", clock: () => clock.t });
  const remoteOpen = openRecordStore({ path: ":memory:", space: "sp_remote", clock: () => clock.t });
  await localOpen.store.define({ add_types: [LOCAL] });
  await remoteOpen.store.define({ add_types: [REMOTE] });
  const src = openSources({ tx: localOpen.host.tx, now: () => clock.t });
  for (let i = 0; i < rows; i++)
    await remoteOpen.store.create("hs_contact", mintRecordId(), {
      full_name: `Person ${i}`,
      email_address: `p${i}@x.test`,
      // a value the local field refuses (not one of its options): only that row is skipped
      tier: i === 7 ? "bronze" : "gold",
    });
  let commits = 0;
  const log = localOpen.host.store as unknown as { appendBatch: (b: unknown[]) => unknown };
  const was = log.appendBatch.bind(log);
  let failNext = fail.commit === true;
  log.appendBatch = (b) => {
    if (failNext && b.length > 1) {
      failNext = false;
      throw Object.assign(new Error("the commit failed"), { code: "unavailable" });
    }
    commits++;
    return was(b);
  };
  const local: Store = grouped ? localOpen.store : ({ ...localOpen.store, createMany: undefined } as Store);
  const seen: string[] = [];
  const deps = (): SyncDeps => ({
    local,
    remote: remoteOpen.store,
    tx: localOpen.host.tx,
    now: () => clock.t,
    emit: (name, subject) => void seen.push(`${name} ${subject.replace(/rec_[0-9a-z-]+/, "rec")}`),
  });
  const report = await runSync(deps(), BINDING, {});
  const dump = (sql: string) => src.tx.all<Record<string, unknown>>(sql);
  const names = (r: Record<string, unknown>[]) => r.map((x) => JSON.stringify(x)).sort();
  return {
    report,
    rerun: async () => runSync(deps(), BINDING, {}),
    commits,
    seen,
    records: names(dump("SELECT version, data FROM rt_contact")),
    changes: names(dump("SELECT type, kind, version, after FROM rs_changes")),
    links: names(dump("SELECT remote_id IS NOT NULL AS has_remote, removed_at FROM sy_links")),
    linkCount: dump("SELECT count(*) AS n FROM sy_links")[0]!["n"],
    events: dump("SELECT json_extract(event, '$.type') AS t FROM events ORDER BY seq").map((r) => String(r["t"])),
    count: dump("SELECT count(*) AS n FROM rt_contact")[0]!["n"],
  };
}

test("a pull makes new records a group at a time and leaves the state the one-at-a-time path leaves", async () => {
  const one = await pull(false, 450);
  const many = await pull(true, 450);
  assert.deepEqual(many.records.length, one.records.length);
  assert.equal(many.count, 449, "the row the store refuses is skipped alone and the other 449 are made");
  assert.deepEqual(many.changes, one.changes, "the same change feed");
  assert.deepEqual(many.links, one.links);
  assert.equal(many.linkCount, one.linkCount);
  assert.deepEqual(many.events, one.events, "the same events in the same order");
  assert.deepEqual(many.seen, one.seen, "the same announcements in the same order");
  assert.deepEqual({ ...many.report, runId: "" }, { ...one.report, runId: "" }, "the same report");
  assert.ok(
    many.commits < one.commits / 20,
    `far fewer commits for the records (${many.commits} against ${one.commits})`,
  );
});

test("a group whose commit fails makes nothing, saves no link, and the next pass makes it", async () => {
  const k = await pull(true, 150, { commit: true });
  assert.equal(k.count, 0, "nothing was half made");
  assert.equal(k.links.length, 0, "no link was saved");
  const again = await k.rerun();
  assert.ok(again.local.created >= 149, "the next pass makes what the failed group left");
});
