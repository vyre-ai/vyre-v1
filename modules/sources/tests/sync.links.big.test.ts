// @reads /modules/sources/migrations/0001_sources.sql
// A relation holds every link (20 Nov 2026: a firm's lead attorney leads thousands of matters; the record held 500 links and every further matter of theirs was skipped with "holds at most 500 links").
// 3,000 people point at one org through a sync: the org holds all 3,000 links, nothing is skipped, and the far end is written once for the pass, not once for each person.
import test from "node:test";
import assert from "node:assert/strict";
import { mintRecordId } from "../../../lib/ids.ts";
import { openRecordStore } from "../../../kernel/src/store/records.ts";
import { openSources } from "../impl.ts";
import { runSync } from "../handlers/sync.ts";
import type { SyncBinding, SyncDeps } from "../handlers/sync.ts";

const ORG = {
  name: "org",
  label: "Org",
  fields: [
    { name: "name", kind: "text", label: "Name" },
    { name: "persons", kind: "link", label: "Persons", to: "person", many: true },
  ],
};
const PERSON = {
  name: "person",
  label: "Person",
  fields: [
    { name: "name", kind: "text", label: "Name" },
    { name: "org", kind: "link", label: "Org", to: "org", many: false },
  ],
};
const R_ORG = { name: "r_org", label: "r_org", fields: [{ name: "/name", kind: "text" }] };
const R_PERSON = {
  name: "r_person",
  label: "r_person",
  fields: [
    { name: "/name", kind: "text" },
    { name: "/org", kind: "text" },
  ],
};
const b = (type: string, remote: string, syncTypeId: string, fields: SyncBinding["fields"]): SyncBinding => ({
  syncTypeId,
  type,
  remote,
  connector: "app",
  label: "App",
  fields,
  match: [],
  createAtSource: false,
  deletes: false,
  conflict: "newest",
});
const ORG_B = b("org", "r_org", "syt_org", [{ local: "name", remote: "/name", direction: "pull" }]);
const PERSON_B = b("person", "r_person", "syt_person", [
  { local: "name", remote: "/name", direction: "pull" },
  { local: "org", remote: "/org", direction: "pull", relation: { syncTypeId: "syt_org", type: "org", inverse: "persons" } },
]);
const cpu = (): number => {
  const u = (process as unknown as { threadCpuUsage?: () => { user: number; system: number } }).threadCpuUsage?.();
  return u ? (u.user + u.system) / 1000 : process.cpuUsage().user / 1000;
};

test("3,000 people of one org: the org holds every link, nothing is skipped, and the pass does not grow with the square of the links", { timeout: 120_000 }, async () => {
  const clock = { t: 1000 };
  const l = openRecordStore({ path: ":memory:", space: "sp_local", clock: () => clock.t });
  const r = openRecordStore({ path: ":memory:", space: "sp_remote", clock: () => clock.t });
  await l.store.define({ add_types: [ORG, PERSON] });
  await r.store.define({ add_types: [R_ORG, R_PERSON] });
  openSources({ tx: l.host.tx, now: () => clock.t });
  const deps = (): SyncDeps => ({ local: l.store, remote: r.store, tx: l.host.tx, space: "sp_local", now: () => clock.t, emit: () => undefined });
  const orgId = (await r.store.create("r_org", mintRecordId(), { "/name": "Big Org" })).id;
  const N = 3000;
  for (let i = 0; i < N; i++) await r.store.create("r_person", mintRecordId(), { "/name": `P ${i}`, "/org": orgId });
  await runSync(deps(), ORG_B, {});
  const t0 = cpu();
  const rep = await runSync(deps(), PERSON_B, {});
  const ms = cpu() - t0;
  process.stderr.write(`[links] ${N} links, pass CPU ${Math.round(ms)} ms, skipped ${rep.skipped}\n`);
  assert.equal(rep.skipped, 0, "no person was skipped");
  const org = (await l.store.query("org", { page: { limit: 10 } })).rows[0]!;
  const held = (org.data["persons"] as unknown[]).length;
  assert.equal(held, N, `the org holds ${held} of ${N} links`);
  assert.ok(ms < 8000, `the pass took ${Math.round(ms)} ms of CPU for ${N} links`);
});
