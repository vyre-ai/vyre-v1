// @reads /modules/sources/migrations/0001_sources.sql
// A relation holds every link (20 Nov 2026: a firm's lead attorney leads thousands of matters; the record held 500 links and every further matter of theirs was skipped with "holds at most 500 links").
// 3,000 people point at one org through a sync: the org holds all 3,000 links, nothing is skipped, and the far end is written once for the pass, not once for each person.
import test from "node:test";
import assert from "node:assert/strict";
import { mintRecordId } from "../../../lib/ids.ts";
import { openRecordStore } from "../../../kernel/src/store/records.ts";
import { openSources } from "../impl.ts";
import { MAX_LINKS } from "../../../kernel/src/store/values.ts";
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
    { name: "org", kind: "link", label: "Org", to: "org", many: true },
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
  {
    local: "org",
    remote: "/org",
    direction: "pull",
    relation: { syncTypeId: "syt_org", type: "org", inverse: "persons" },
  },
]);
const cpu = (): number => {
  const u = (process as unknown as { threadCpuUsage?: () => { user: number; system: number } }).threadCpuUsage?.();
  return u ? (u.user + u.system) / 1000 : process.cpuUsage().user / 1000;
};

test(
  "3,000 people of one org: the org holds every link, nothing is skipped, and the pass does not grow with the square of the links",
  { timeout: 120_000 },
  async () => {
    const clock = { t: 1000 };
    const l = openRecordStore({ path: ":memory:", space: "sp_local", clock: () => clock.t });
    const r = openRecordStore({ path: ":memory:", space: "sp_remote", clock: () => clock.t });
    await l.store.define({ add_types: [ORG, PERSON] });
    await r.store.define({ add_types: [R_ORG, R_PERSON] });
    openSources({ tx: l.host.tx, now: () => clock.t });
    const deps = (): SyncDeps => ({
      local: l.store,
      remote: r.store,
      tx: l.host.tx,
      space: "sp_local",
      now: () => clock.t,
      emit: () => undefined,
    });
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
  },
);

test(
  "a record that would pass the most links is named, not changed, and no link is dropped without being said; one record with 20,000 links reads and writes inside a bound",
  { timeout: 120_000 },
  async () => {
    const clock = { t: 1000 };
    const l = openRecordStore({ path: ":memory:", space: "sp_local", clock: () => clock.t });
    const r = openRecordStore({ path: ":memory:", space: "sp_remote", clock: () => clock.t });
    await l.store.define({ add_types: [ORG, PERSON] });
    await r.store.define({ add_types: [R_ORG, R_PERSON] });
    openSources({ tx: l.host.tx, now: () => clock.t });
    const logs: { kind: string; summary: string }[] = [];
    const deps = (): SyncDeps => ({
      local: l.store,
      remote: r.store,
      tx: l.host.tx,
      space: "sp_local",
      now: () => clock.t,
      emit: () => undefined,
    });
    // an org that already holds the most: made straight in the store, timed (read, write) with thread CPU
    const full = Array.from({ length: MAX_LINKS }, (_, i) => ({ urn: `vyre://sp_local/person/p${i}` }));
    let t0 = cpu();
    const org = await l.store.create("org", mintRecordId(), { name: "Full Org", persons: full });
    const writeMs = cpu() - t0;
    t0 = cpu();
    const back = (await l.store.get("org", org.id))!;
    const readMs = cpu() - t0;
    t0 = cpu();
    await l.store.update("org", org.id, { persons: full.slice(1) }, back.version);
    const rewriteMs = cpu() - t0;
    process.stderr.write(
      `[links] one record with ${MAX_LINKS} links: create ${Math.round(writeMs)} ms, read ${Math.round(readMs)} ms, rewrite ${Math.round(rewriteMs)} ms (thread CPU)\n`,
    );
    assert.equal(((back.data["persons"] as unknown[]) ?? []).length, MAX_LINKS);
    assert.ok(
      readMs < 1000 && writeMs < 2000 && rewriteMs < 2000,
      "reading and writing one record of 20,000 links is quick",
    );
    // the app has the org in its list: its remote id is the org's remote id; two people point at it
    const remoteOrg = (await r.store.create("r_org", mintRecordId(), { "/name": "Full Org" })).id;
    await runSync(deps(), ORG_B, {});
    const rec = (await l.store.query("org", { page: { limit: 10 } })).rows.find(
      (x) => x.data["name"] === "Full Org" && x.id !== org.id,
    )!;
    await l.store.update("org", rec.id, { persons: full }, (await l.store.get("org", rec.id))!.version);
    for (let i = 0; i < 2; i++)
      await r.store.create("r_person", mintRecordId(), { "/name": `Late ${i}`, "/org": remoteOrg });
    const rep = await runSync(deps(), PERSON_B, {});
    assert.equal(rep.local.created, 2, "the two people arrive");
    assert.equal(rep.skipped, 1, "the org that would pass the most is counted");
    assert.match(rep.summary, new RegExp(`would hold more than ${MAX_LINKS} links`), "the summary says it");
    assert.match(rep.summary, new RegExp(`org ${rec.id}`), "and names the record");
    const after = (await l.store.get("org", rec.id))!;
    assert.equal((after.data["persons"] as unknown[]).length, MAX_LINKS, "its links are all still there: none dropped");
    void logs;
  },
);

test(
  "a pass that stops between a record's links and the far end's write loses nothing: the next pass writes what was owed",
  { timeout: 120_000 },
  async () => {
    const clock = { t: 1000 };
    const l = openRecordStore({ path: ":memory:", space: "sp_local", clock: () => clock.t });
    const r = openRecordStore({ path: ":memory:", space: "sp_remote", clock: () => clock.t });
    await l.store.define({ add_types: [ORG, PERSON] });
    await r.store.define({ add_types: [R_ORG, R_PERSON] });
    openSources({ tx: l.host.tx, now: () => clock.t });
    const deps = (): SyncDeps => ({
      local: l.store,
      remote: r.store,
      tx: l.host.tx,
      space: "sp_local",
      now: () => clock.t,
      emit: () => undefined,
    });
    const orgId = (await r.store.create("r_org", mintRecordId(), { "/name": "Org" })).id;
    for (let i = 0; i < 450; i++)
      await r.store.create("r_person", mintRecordId(), { "/name": `P ${i}`, "/org": orgId });
    await runSync(deps(), ORG_B, {});
    // the far end cannot be written (the process "stops" right there): every write to the org fails
    const real = l.store.update.bind(l.store);
    let killed = true;
    l.store.update = (async (type: string, id: string, patch: Record<string, unknown>, version: number) => {
      if (killed && type === "org") throw new Error("the process stopped");
      return real(type, id, patch, version);
    }) as typeof l.store.update;
    await runSync(deps(), PERSON_B, {});
    const org = (await l.store.query("org", { page: { limit: 10 } })).rows[0]!;
    assert.equal(((org.data["persons"] as unknown[]) ?? []).length, 0, "the far end was not written");
    const owed = l.host.tx.get<{ n: number }>("SELECT count(*) AS n FROM sy_far_owed")!.n;
    assert.equal(owed, 450, "all 450 inverse links are owed, kept in the store");
    // started again: the next pass, with nothing new to pull, writes what was owed first
    killed = false;
    await runSync(deps(), PERSON_B, {});
    const after = (await l.store.get("org", org.id))!;
    assert.equal((after.data["persons"] as unknown[]).length, 450, "every inverse link is present");
    assert.equal(
      l.host.tx.get<{ n: number }>("SELECT count(*) AS n FROM sy_far_owed")!.n,
      0,
      "nothing is owed any more",
    );
  },
);

async function kit2() {
  const clock = { t: 1000 };
  const l = openRecordStore({ path: ":memory:", space: "sp_local", clock: () => clock.t });
  const r = openRecordStore({ path: ":memory:", space: "sp_remote", clock: () => clock.t });
  await l.store.define({ add_types: [ORG, PERSON] });
  await r.store.define({ add_types: [R_ORG, R_PERSON] });
  openSources({ tx: l.host.tx, now: () => clock.t });
  const logs: string[] = [];
  const deps = (): SyncDeps => ({
    local: l.store,
    remote: r.store,
    tx: l.host.tx,
    space: "sp_local",
    now: () => clock.t,
    emit: () => undefined,
  });
  const owedCount = () => l.host.tx.get<{ n: number }>("SELECT count(*) AS n FROM sy_far_owed")!.n;
  const errorsLogged = () =>
    l.host.tx.all<{ summary: string }>("SELECT summary FROM sy_log WHERE kind = 'error'").map((x) => x.summary);
  return { clock, l, r, deps, logs, owedCount, errorsLogged };
}
const failOrgWrites = (l: ReturnType<typeof openRecordStore>, on: { v: boolean }, calls: { n: number }) => {
  const real = l.store.update.bind(l.store);
  l.store.update = (async (type: string, id: string, patch: Record<string, unknown>, version: number) => {
    if (type === "org") calls.n++;
    if (on.v && type === "org") throw new Error("this record cannot take it");
    return real(type, id, patch, version);
  }) as typeof l.store.update;
};

test(
  "a record that stays over the most links is said when it first happens, again when its count changes or a day has passed, and not on every pass",
  { timeout: 120_000 },
  async () => {
    const k = await kit2();
    const remoteOrg = (await k.r.store.create("r_org", mintRecordId(), { "/name": "Full Org" })).id;
    await runSync(k.deps(), ORG_B, {});
    const org = (await k.l.store.query("org", { page: { limit: 10 } })).rows[0]!;
    const full = Array.from({ length: MAX_LINKS }, (_, i) => ({ urn: `vyre://sp_local/person/p${i}` }));
    await k.l.store.update("org", org.id, { persons: full }, (await k.l.store.get("org", org.id))!.version);
    await k.r.store.create("r_person", mintRecordId(), { "/name": "Late 1", "/org": remoteOrg });
    const first = await runSync(k.deps(), PERSON_B, {});
    assert.equal(first.skipped, 1);
    assert.match(first.summary, /would hold more than/);
    const second = await runSync(k.deps(), PERSON_B, {});
    assert.equal(second.skipped, 0, "a standing over-cap record is not new trouble");
    assert.doesNotMatch(second.summary, /would hold more than/);
    k.clock.t += 25 * 3600 * 1000;
    const third = await runSync(k.deps(), PERSON_B, {});
    assert.equal(third.skipped, 1, "said again after a day");
    await k.r.store.create("r_person", mintRecordId(), { "/name": "Late 2", "/org": remoteOrg });
    const fourth = await runSync(k.deps(), PERSON_B, {});
    assert.equal(fourth.skipped, 1, "said again when the count changes");
    assert.equal(
      ((await k.l.store.get("org", org.id))!.data["persons"] as unknown[]).length,
      MAX_LINKS,
      "no link was dropped",
    );
  },
);

test(
  "a far write that keeps failing is set aside after five tries, said once, and not tried again",
  { timeout: 120_000 },
  async () => {
    const k = await kit2();
    const remoteOrg = (await k.r.store.create("r_org", mintRecordId(), { "/name": "Org" })).id;
    await runSync(k.deps(), ORG_B, {});
    await k.r.store.create("r_person", mintRecordId(), { "/name": "P", "/org": remoteOrg });
    const on = { v: true },
      calls = { n: 0 };
    failOrgWrites(k.l, on, calls);
    const parkedSaid: string[] = [];
    for (let i = 0; i < 8; i++) {
      const rep = await runSync(k.deps(), PERSON_B, {});
      if (/set aside/.test(rep.summary)) parkedSaid.push(rep.summary);
    }
    assert.equal(calls.n, 5, "tried five times, then no more");
    assert.equal(parkedSaid.length, 1, "said once, when it was set aside");
    assert.equal(k.l.host.tx.get<{ n: number }>("SELECT count(*) AS n FROM sy_far_owed WHERE parked = 1")!.n, 1);
  },
);

test("the drain does not link a record that was deleted while its link was owed", { timeout: 120_000 }, async () => {
  const k = await kit2();
  const remoteOrg = (await k.r.store.create("r_org", mintRecordId(), { "/name": "Org" })).id;
  await runSync(k.deps(), ORG_B, {});
  for (let i = 0; i < 3; i++)
    await k.r.store.create("r_person", mintRecordId(), { "/name": `P ${i}`, "/org": remoteOrg });
  const on = { v: true },
    calls = { n: 0 };
  failOrgWrites(k.l, on, calls);
  await runSync(k.deps(), PERSON_B, {});
  const people = (await k.l.store.query("person", { page: { limit: 10 } })).rows;
  assert.equal(people.length, 3);
  await k.l.store.remove("person", people[0]!.id, (await k.l.store.get("person", people[0]!.id))!.version);
  on.v = false;
  await runSync(k.deps(), PERSON_B, {});
  const org = (await k.l.store.query("org", { page: { limit: 10 } })).rows[0]!;
  const urns = (org.data["persons"] as { urn: string }[]).map((x) => x.urn);
  assert.equal(urns.length, 2, "the deleted person is not linked");
  assert.ok(!urns.some((u) => u.endsWith(`/${people[0]!.id}`)));
});

test(
  "owed far records are written in chunks of 200: 450 far records, none lost, none read twice",
  { timeout: 120_000 },
  async () => {
    const k = await kit2();
    const orgs: string[] = [];
    for (let i = 0; i < 450; i++)
      orgs.push((await k.r.store.create("r_org", mintRecordId(), { "/name": `Org ${i}` })).id);
    await runSync(k.deps(), ORG_B, {});
    for (let i = 0; i < 450; i++)
      await k.r.store.create("r_person", mintRecordId(), { "/name": `P ${i}`, "/org": orgs[i] });
    const on = { v: true },
      calls = { n: 0 };
    failOrgWrites(k.l, on, calls);
    await runSync(k.deps(), PERSON_B, {});
    assert.equal(k.owedCount(), 450);
    on.v = false;
    calls.n = 0;
    await runSync(k.deps(), PERSON_B, {});
    assert.equal(k.owedCount(), 0);
    assert.equal(calls.n, 450, "each far record written once");
    const withOne = (await k.l.store.query("org", { page: { limit: 500 } })).rows.filter(
      (o) => ((o.data["persons"] as unknown[]) ?? []).length === 1,
    ).length;
    assert.equal(withOne, 450);
  },
);
