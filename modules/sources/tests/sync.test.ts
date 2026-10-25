// @reads /modules/sources/migrations/0001_sources.sql
// The sync engine over two RecordStores: a dry run shows the diff and writes nothing, pushes can be undone with the stored value, conflicts follow their rule,
// imports fire no automations unless ticked, vanished records are soft-marked behind a guard.
import test from "node:test";
import assert from "node:assert/strict";
import { mintRecordId } from "../../../lib/ids.ts";
import { openRecordStore } from "../../../kernel/src/store/records.ts";
import type { Store, StoredRecord } from "../../../kernel/src/store/types.ts";
import { openSources } from "../impl.ts";
import { confirmDeletes, flushOutbox, removedAtSource, resolveConflict, retryPush, runSync, undoPush } from "../handlers/sync.ts";
import type { SyncBinding, SyncDeps } from "../handlers/sync.ts";

const LOCAL = { name: "contact", label: "Contact", fields: [
  { name: "name", kind: "text", label: "Name" }, { name: "email", kind: "text", label: "Email" }, { name: "phone", kind: "text", label: "Phone" },
  { name: "city", kind: "text", label: "City" }, { name: "notes", kind: "text", label: "Notes" },
] };
const REMOTE = { name: "hs_contact", label: "HubSpot contact", fields: [
  { name: "full_name", kind: "text" }, { name: "email_address", kind: "text" }, { name: "phone_number", kind: "text" }, { name: "town", kind: "text" }, { name: "private", kind: "text" },
] };
const BINDING: SyncBinding = {
  syncTypeId: "syt_1", type: "contact", remote: "hs_contact", connector: "hubspot", label: "HubSpot",
  fields: [
    { local: "name", remote: "full_name", direction: "both" }, { local: "email", remote: "email_address", direction: "both" },
    { local: "phone", remote: "phone_number", direction: "pull" }, { local: "city", remote: "town", direction: "push" }, { local: "notes", remote: "private", direction: "off" },
  ],
  match: ["email"], createAtSource: false, deletes: false, conflict: "newest",
};

interface Seen { name: string; subject: string; payload: Record<string, any> }
async function kit(b: Partial<SyncBinding> = {}) {
  const clock = { t: 1000 };
  const localOpen = openRecordStore({ path: ":memory:", space: "sp_local", clock: () => clock.t });
  const remoteOpen = openRecordStore({ path: ":memory:", space: "sp_remote", clock: () => clock.t });
  await localOpen.store.define({ add_types: [LOCAL] });
  await remoteOpen.store.define({ add_types: [REMOTE] });
  const src = openSources({ tx: localOpen.host.tx, now: () => clock.t });
  const seen: Seen[] = [];
  const binding: SyncBinding = { ...BINDING, ...b };
  let remote: Store = remoteOpen.store;
  const deps = (): SyncDeps => ({ local: localOpen.store, remote, tx: localOpen.host.tx, now: () => clock.t, emit: (name, subject, payload) => { seen.push({ name, subject, payload }); } });
  const local = localOpen.store;
  const remoteStore = remoteOpen.store;
  const events = (name: string) => seen.filter((e) => e.name === name).map((e) => e.payload);
  const addRemote = async (data: Record<string, unknown>) => (await remoteStore.create("hs_contact", mintRecordId(), data)).id;
  const addLocal = async (data: Record<string, unknown>) => (await local.create("contact", mintRecordId(), data)).id;
  const editLocal = async (id: string, patch: Record<string, unknown>) => { const r = await local.get("contact", id); return local.update("contact", id, patch, r!.version); };
  const editRemote = async (id: string, patch: Record<string, unknown>) => { const r = await remoteStore.get("hs_contact", id); return remoteStore.update("hs_contact", id, patch, r!.version); };
  const run = (o: Parameters<typeof runSync>[2] = {}) => runSync(deps(), binding, o);
  const locals = async (): Promise<StoredRecord[]> => (await local.query("contact", { page: { limit: 500 } })).rows as StoredRecord[];
  const remotes = async (): Promise<StoredRecord[]> => (await remoteStore.query("hs_contact", { page: { limit: 500 } })).rows as StoredRecord[];
  const count = (table: string) => src.tx.get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)!.n;
  const swapRemote = (r: Store) => { remote = r; };
  return { clock, deps, seen, events, binding, addRemote, addLocal, editLocal, editRemote, run, locals, remotes, count, local, remoteStore, tx: src.tx, swapRemote };
}
type Kit = Awaited<ReturnType<typeof kit>>;
const seed = async (k: Kit, n: number): Promise<string[]> => {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await k.addRemote({ full_name: `Person ${i}`, email_address: `p${i}@x.com`, phone_number: `555-000${i}`, town: `Town ${i}`, private: "secret" }));
  return ids;
};

test("first sync pulls what the directions allow, a second sync changes nothing", async () => {
  const k = await kit();
  await seed(k, 3);
  const r1 = await k.run();
  assert.deepEqual([r1.local.created, r1.local.updated, r1.remote.created, r1.remote.updated, r1.dryRun], [3, 0, 0, 0, false]);
  const rows = await k.locals();
  assert.equal(rows.length, 3);
  const p0 = rows.find((r) => r.data.email === "p0@x.com")!;
  assert.deepEqual({ ...p0.data }, { name: "Person 0", email: "p0@x.com", phone: "555-0000" }, "city is push-only and notes is off: neither is pulled");
  assert.equal(k.count("sy_links"), 3);

  const r2 = await k.run();
  assert.deepEqual([r2.local.created, r2.local.updated, r2.remote.created, r2.remote.updated, r2.matched, r2.conflicts], [0, 0, 0, 0, 0, 0]);
  assert.equal(r2.summary, "Nothing to change.");
  assert.equal(k.count("sy_outbox"), 0);
  const done = k.events("sync.completed");
  assert.equal(done.length, 2);
  assert.deepEqual({ ...done[0], runId: undefined }, { runId: undefined, syncTypeId: "syt_1", type: "contact", connector: "hubspot", mode: "both", pulled: 3, pushed: 0, created: 3, updated: 0, removed: 0 });
  assert.match(done[0]!.runId, /^run_[a-z0-9]+$/);
});

test("imports fire no automations unless the importer ticks run automations", async () => {
  const k = await kit();
  await seed(k, 2);
  await k.run();
  const created = k.events("record.created");
  assert.equal(created.length, 2);
  assert.ok(created.every((e) => e.quiet === true && e.type === "contact"), "quiet by default");
  await k.editRemote((await k.remotes())[0]!.id, { full_name: "Changed" });
  await k.run();
  assert.equal(k.events("record.updated").at(-1)!.quiet, true);
  assert.deepEqual(k.events("record.updated").at(-1)!.fields, { name: "Changed" });
  assert.deepEqual(k.events("record.updated").at(-1)!.prev, { name: "Person 0" });

  const k2 = await kit();
  await seed(k2, 1);
  await k2.run({ runAutomations: true });
  assert.ok(!("quiet" in k2.events("record.created")[0]!), "ticked: not marked quiet");
});

test("dry run: the diff in words and counts, and nothing written anywhere", async () => {
  const k = await kit();
  const ids = await seed(k, 4);
  await k.run();
  const mine = await k.locals();
  const byEmail = (e: string) => mine.find((r) => r.data.email === e)!;
  await k.editRemote(ids[0]!, { full_name: "Remote 0" });
  await k.editRemote(ids[1]!, { full_name: "Remote 1" });
  await k.editLocal(byEmail("p2@x.com").id, { name: "Local 2" });
  await k.addRemote({ full_name: "Fresh", email_address: "fresh@x.com" });
  k.seen.length = 0;
  const before = { links: k.count("sy_links"), outbox: k.count("sy_outbox"), log: k.count("sy_log"), locals: JSON.stringify(await k.locals()), remotes: JSON.stringify(await k.remotes()) };

  const dry = await k.run({ dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.deepEqual([dry.local.created, dry.local.updated, dry.remote.updated], [1, 2, 1]);
  assert.equal(dry.summary, "Will create 1 record here, update 2 records here, update 1 record in HubSpot.");
  assert.deepEqual({ links: k.count("sy_links"), outbox: k.count("sy_outbox"), log: k.count("sy_log"), locals: JSON.stringify(await k.locals()), remotes: JSON.stringify(await k.remotes()) }, before);
  assert.deepEqual(k.seen, [], "a dry run announces nothing");

  const real = await k.run();
  assert.deepEqual([real.local.created, real.local.updated, real.remote.updated], [1, 2, 1]);
  assert.equal((await k.locals()).length, 5);
  assert.equal((await k.remotes()).find((r) => r.id === ids[2])!.data.full_name, "Local 2");
});

test("push goes through the outbox with the replaced value, and an undo puts it back", async () => {
  const k = await kit();
  const [rid] = await seed(k, 1);
  await k.run();
  const lid = (await k.locals())[0]!.id;
  k.clock.t = 2000;
  await k.editLocal(lid, { name: "Renamed", city: "Oslo" });
  k.seen.length = 0;
  const r = await k.run();
  assert.deepEqual([r.remote.updated, r.queued, r.failed], [1, 1, 0]);
  const remote = (await k.remotes())[0]!;
  assert.deepEqual([remote.data.full_name, remote.data.town], ["Renamed", "Oslo"]);
  const row = k.tx.get<{ outbox_id: string; status: string; replaced: string; op: string; attempts: number }>("SELECT * FROM sy_outbox")!;
  assert.deepEqual([row.status, row.op, row.attempts], ["done", "update", 0]);
  assert.deepEqual(JSON.parse(row.replaced), { full_name: "Person 0", town: "Town 0" });
  assert.deepEqual(k.events("sync.pushed"), [{ syncTypeId: "syt_1", recordId: lid, outboxId: row.outbox_id }]);
  assert.equal((await k.run()).queued, 0, "settled: nothing more to push");
  assert.equal(k.count("sy_outbox"), 1);

  k.clock.t = 3000;
  const undone = await undoPush(k.deps(), k.binding, row.outbox_id);
  assert.deepEqual(undone, { undone: true });
  const back = (await k.remotes())[0]!;
  assert.deepEqual([back.data.full_name, back.data.town], ["Person 0", "Town 0"]);
  assert.deepEqual(k.events("sync.push_undone"), [{ syncTypeId: "syt_1", recordId: lid, outboxId: row.outbox_id }]);
  assert.deepEqual(await undoPush(k.deps(), k.binding, row.outbox_id), { undone: false, reason: "already undone" });
  assert.equal((await undoPush(k.deps(), k.binding, "obx_nope")).undone, false);

  // The next pass pulls the old value back into the local record: the undo holds on both sides.
  await k.run();
  assert.equal((await k.locals())[0]!.data.name, "Person 0");
  assert.equal((await k.remotes())[0]!.id, rid);
});

test("an undo is refused when the remote record moved after the push", async () => {
  const k = await kit();
  const [rid] = await seed(k, 1);
  await k.run();
  await k.editLocal((await k.locals())[0]!.id, { name: "Mine" });
  await k.run();
  const row = k.tx.get<{ outbox_id: string }>("SELECT outbox_id FROM sy_outbox")!;
  await k.editRemote(rid!, { full_name: "Theirs, later" });
  const out = await undoPush(k.deps(), k.binding, row.outbox_id);
  assert.deepEqual(out, { undone: false, reason: "the remote record changed since the push" });
  assert.equal((await k.remotes())[0]!.data.full_name, "Theirs, later");
});

test("directions: pull-only, push-only and off fields stay in their lane", async () => {
  const k = await kit();
  const [rid] = await seed(k, 1);
  await k.run();
  const lid = (await k.locals())[0]!.id;
  k.clock.t = 2000;
  await k.editLocal(lid, { phone: "local-phone", notes: "local note" });
  await k.editRemote(rid!, { town: "Remote town", private: "remote private" });
  const r = await k.run();
  assert.deepEqual([r.local.updated, r.remote.updated], [0, 0]);
  assert.equal((await k.remotes())[0]!.data.phone_number, "555-0000", "a pull-only field is never pushed");
  assert.equal((await k.locals())[0]!.data.city, undefined, "a push-only field is never pulled");
  assert.equal((await k.locals())[0]!.data.notes, "local note");
  assert.equal((await k.remotes())[0]!.data.private, "remote private");
  await k.editRemote(rid!, { phone_number: "new-phone" });
  await k.run();
  assert.equal((await k.locals())[0]!.data.phone, "new-phone", "pull-only still pulls");
});

test("mode: a pull pass does not push and a push pass does not pull", async () => {
  const k = await kit();
  const [rid] = await seed(k, 1);
  await k.run();
  const lid = (await k.locals())[0]!.id;
  k.clock.t = 2000;
  await k.editLocal(lid, { name: "L" });
  await k.editRemote(rid!, { email_address: "r@x.com" });
  const pull = await k.run({ mode: "pull" });
  assert.deepEqual([pull.local.updated, pull.remote.updated, k.count("sy_outbox")], [1, 0, 0]);
  assert.equal((await k.locals())[0]!.data.email, "r@x.com");
  assert.equal((await k.remotes())[0]!.data.full_name, "Person 0");
  const push = await k.run({ mode: "push" });
  assert.deepEqual([push.remote.updated, push.local.updated], [1, 0]);
  assert.equal((await k.remotes())[0]!.data.full_name, "L");
});

test("conflicts: newest wins by default, source or vyre when asked, a person when the rule is ask", async () => {
  const conflict = async (rule: SyncBinding["conflict"], localLater: boolean) => {
    const k = await kit({ conflict: rule });
    const [rid] = await seed(k, 1);
    await k.run();
    const lid = (await k.locals())[0]!.id;
    k.clock.t = 2000;
    if (localLater) { await k.editRemote(rid!, { full_name: "Remote" }); k.clock.t = 3000; await k.editLocal(lid, { name: "Local" }); }
    else { await k.editLocal(lid, { name: "Local" }); k.clock.t = 3000; await k.editRemote(rid!, { full_name: "Remote" }); }
    k.seen.length = 0;
    const rep = await k.run();
    return { k, rep, local: (await k.locals())[0]!.data.name, remote: (await k.remotes())[0]!.data.full_name, lid };
  };
  const a = await conflict("newest", true);
  assert.deepEqual([a.local, a.remote, a.rep.conflicts], ["Local", "Local", 1]);
  const b = await conflict("newest", false);
  assert.deepEqual([b.local, b.remote], ["Remote", "Remote"]);
  const c = await conflict("source", true);
  assert.deepEqual([c.local, c.remote], ["Remote", "Remote"]);
  const d = await conflict("vyre", false);
  assert.deepEqual([d.local, d.remote], ["Local", "Local"]);

  const e = await conflict("ask", true);
  assert.deepEqual([e.local, e.remote, e.rep.askedConflicts], ["Local", "Remote", 1], "neither side is touched");
  const ev = e.k.events("sync.conflict");
  assert.equal(ev.length, 1);
  assert.deepEqual({ ...ev[0], conflictId: undefined }, { conflictId: undefined, syncTypeId: "syt_1", type: "contact", recordId: e.lid, field: "name", rule: "ask" });
  await e.k.run();
  assert.equal(e.k.events("sync.conflict").length, 1, "the same open conflict is not announced twice");
  assert.equal(e.k.count("sy_conflicts"), 1);
  assert.match(e.rep.summary, /ask about 1 conflict/);

  const id = ev[0]!.conflictId as string;
  await resolveConflict(e.k.deps(), e.k.binding, id, "theirs");
  assert.equal((await e.k.locals())[0]!.data.name, "Remote");
  await e.k.run();
  assert.deepEqual([(await e.k.locals())[0]!.data.name, (await e.k.remotes())[0]!.data.full_name], ["Remote", "Remote"]);
  await assert.rejects(resolveConflict(e.k.deps(), e.k.binding, id, "ours"), /no open conflict/);
});

test("resolving a conflict with ours or a typed value pushes it", async () => {
  for (const [resolution, value, expected] of [["ours", undefined, "Local"], ["value", "Typed", "Typed"]] as const) {
    const k = await kit({ conflict: "ask" });
    const [rid] = await seed(k, 1);
    await k.run();
    const lid = (await k.locals())[0]!.id;
    k.clock.t = 2000;
    await k.editLocal(lid, { name: "Local" });
    await k.editRemote(rid!, { full_name: "Remote" });
    await k.run();
    const cid = k.events("sync.conflict")[0]!.conflictId as string;
    await resolveConflict(k.deps(), k.binding, cid, resolution, value);
    assert.deepEqual([(await k.locals())[0]!.data.name, (await k.remotes())[0]!.data.full_name], [expected, expected], resolution);
    assert.equal((await k.run()).conflicts, 0);
  }
});

test("first sync matches records that exist on both sides instead of duplicating them", async () => {
  const k = await kit();
  await seed(k, 2);
  const mine = await k.addLocal({ name: "Local Zero", email: "p0@x.com", city: "Oslo" });
  await k.addLocal({ name: "Dup A", email: "dup@x.com" });
  await k.addLocal({ name: "Dup B", email: "dup@x.com" });
  await k.addRemote({ full_name: "Dup Remote", email_address: "dup@x.com" });
  const dry = await k.run({ dryRun: true });
  assert.deepEqual([dry.matched, dry.ambiguous, dry.local.created], [1, 1, 1]);
  assert.match(dry.summary, /link 1 record that already exist/);
  const r = await k.run();
  assert.deepEqual([r.matched, r.ambiguous, r.local.created], [1, 1, 1]);
  assert.equal((await k.locals()).length, 4, "p1 came in, the match and the ambiguous pair did not duplicate");
  const m = (await k.locals()).find((x) => x.id === mine)!;
  assert.equal(m.data.phone, "555-0000", "the pull fills what the local record lacked");
  assert.equal(m.data.name, "Local Zero", "and does not overwrite what only we changed");
  assert.equal((await k.remotes()).find((x) => x.data.email_address === "p0@x.com")!.data.full_name, "Local Zero", "our difference is pushed");
  assert.equal((await k.remotes()).find((x) => x.data.email_address === "p0@x.com")!.data.town, "Oslo");
  assert.equal((await k.remotes()).filter((x) => x.data.email_address === "dup@x.com").length, 1, "the ambiguous pair is left for a person");
  assert.equal(k.count("sy_links"), 2);
});

test("create at source: off keeps local-only records local, on creates and links them", async () => {
  const off = await kit();
  await off.addLocal({ name: "Only Here", email: "here@x.com", city: "Rome" });
  assert.equal((await off.run()).remote.created, 0);
  assert.equal((await off.remotes()).length, 0);

  const k = await kit({ createAtSource: true });
  const lid = await k.addLocal({ name: "Only Here", email: "here@x.com", city: "Rome", notes: "never sent", phone: "never sent either" });
  const dry = await k.run({ dryRun: true });
  assert.equal(dry.summary, "Will create 1 record in HubSpot.");
  assert.equal((await k.remotes()).length, 0);
  const r = await k.run();
  assert.equal(r.remote.created, 1);
  const made = (await k.remotes())[0]!;
  assert.deepEqual({ ...made.data }, { full_name: "Only Here", email_address: "here@x.com", town: "Rome" }, "push fields only: phone is pull-only, notes is off");
  const link = k.tx.get<{ remote_id: string }>("SELECT remote_id FROM sy_links WHERE local_id = ?", lid)!;
  assert.equal(link.remote_id, made.id);
  assert.equal((await k.run()).remote.created, 0, "linked: not created twice");
  await k.editLocal(lid, { name: "Renamed" });
  await k.run();
  assert.equal((await k.remotes()).length, 1);
  assert.equal((await k.remotes())[0]!.data.full_name, "Renamed");
});

test("transforms apply to what is pulled", async () => {
  const k = await kit({ fields: [{ local: "name", remote: "full_name", direction: "pull", transform: "upper(value)" }, { local: "email", remote: "email_address", direction: "pull", transform: "lower(value)" }] });
  await k.addRemote({ full_name: "Ann Lee", email_address: "ANN@X.COM" });
  await k.run();
  assert.deepEqual({ ...(await k.locals())[0]!.data }, { name: "ANN LEE", email: "ann@x.com" });
  assert.equal((await k.run()).local.updated, 0, "stable: the transformed value is the base");
});

test("deletes at the source are soft; more than 10 percent waits for a person", async () => {
  const k = await kit();
  const ids = await seed(k, 20);
  await k.run();
  const idOf = (i: number) => (k.tx.get<{ local_id: string }>("SELECT local_id FROM sy_links WHERE remote_id = ?", ids[i]!)!).local_id;

  await k.remoteStore.remove("hs_contact", ids[0]!, (await k.remoteStore.get("hs_contact", ids[0]!))!.version);
  const dry = await k.run({ dryRun: true });
  assert.equal(dry.removedAtSource, 1);
  assert.deepEqual(removedAtSource(k.deps(), k.binding), []);
  const r = await k.run();
  assert.deepEqual([r.removedAtSource, r.pausedDeletes], [1, false]);
  assert.deepEqual(removedAtSource(k.deps(), k.binding), [idOf(0)]);
  assert.equal((await k.locals()).length, 20, "the local record stays, marked removed at source");
  assert.equal((await k.run()).removedAtSource, 0, "marked once");
  await k.remoteStore.restore("hs_contact", ids[0]!);
  await k.run();
  assert.deepEqual(removedAtSource(k.deps(), k.binding), [], "it came back");

  for (const i of [1, 2, 3]) await k.remoteStore.remove("hs_contact", ids[i]!, (await k.remoteStore.get("hs_contact", ids[i]!))!.version);
  k.seen.length = 0;
  const big = await k.run();
  assert.deepEqual([big.pausedDeletes, big.removedAtSource], [true, 0]);
  assert.deepEqual(k.events("sync.deletes_paused"), [{ syncTypeId: "syt_1", type: "contact", count: 3, percent: 15 }]);
  assert.deepEqual(removedAtSource(k.deps(), k.binding), [], "nothing marked while it waits");
  assert.match(big.summary, /wait for you to confirm/);
  assert.equal(confirmDeletes(k.deps(), k.binding, "mark_removed"), 3);
  assert.deepEqual(removedAtSource(k.deps(), k.binding).sort(), [1, 2, 3].map(idOf).sort());
  assert.equal((await k.run()).pausedDeletes, false, "decided: not asked again");
});

test("keep: records that vanished stay live and are not asked about again", async () => {
  const k = await kit();
  const ids = await seed(k, 10);
  await k.run();
  for (const i of [0, 1]) await k.remoteStore.remove("hs_contact", ids[i]!, (await k.remoteStore.get("hs_contact", ids[i]!))!.version);
  assert.equal((await k.run()).pausedDeletes, true);
  assert.equal(confirmDeletes(k.deps(), k.binding, "keep"), 0);
  const again = await k.run();
  assert.deepEqual([again.pausedDeletes, again.removedAtSource], [false, 0]);
  assert.deepEqual(removedAtSource(k.deps(), k.binding), []);
});

test("a delete here travels only when deletes are on", async () => {
  for (const deletes of [false, true]) {
    const k = await kit({ deletes });
    await seed(k, 2);
    await k.run();
    const gone = (await k.locals())[0]!;
    await k.local.remove("contact", gone.id, gone.version);
    const r = await k.run();
    assert.equal(r.remote.removed, deletes ? 1 : 0);
    assert.equal((await k.remotes()).length, deletes ? 1 : 2);
    if (deletes) {
      const row = k.tx.get<{ outbox_id: string; op: string }>("SELECT outbox_id, op FROM sy_outbox")!;
      assert.equal(row.op, "remove");
      assert.deepEqual(await undoPush(k.deps(), k.binding, row.outbox_id), { undone: true }, "a removal can be undone");
      assert.equal((await k.remotes()).length, 2);
    }
  }
});

test("a push that keeps failing is retried, reported once, and can be retried by a person", async () => {
  const k = await kit();
  const [rid] = await seed(k, 1);
  await k.run();
  k.clock.t = 2000;
  await k.editLocal((await k.locals())[0]!.id, { name: "Pushed" });
  const real = k.remoteStore;
  let broken = true;
  k.swapRemote({ ...real, update: async (...a: Parameters<Store["update"]>) => { if (broken) throw new Error("HubSpot is down"); return real.update(...a); } } as Store);
  k.seen.length = 0;
  const r1 = await k.run();
  assert.deepEqual([r1.queued, r1.failed], [1, 0]);
  const r2 = await k.run();
  assert.deepEqual([r2.queued, r2.failed], [0, 0], "the open row is reused, not queued again");
  const r3 = await k.run();
  assert.equal(r3.failed, 1);
  assert.equal(k.count("sy_outbox"), 1);
  const row = k.tx.get<{ outbox_id: string; status: string; attempts: number; error: string }>("SELECT * FROM sy_outbox")!;
  assert.deepEqual([row.status, row.attempts, row.error], ["failed", 3, "HubSpot is down"]);
  const ev = k.events("sync.push_failed");
  assert.equal(ev.length, 1);
  assert.deepEqual({ ...ev[0] }, { syncTypeId: "syt_1", type: "contact", recordId: (await k.locals())[0]!.id, outboxId: row.outbox_id, error: "HubSpot is down", attempts: 3 });
  assert.equal((await k.run()).failed, 0, "a failed push is left alone until retried");
  assert.equal((await k.remotes())[0]!.data.full_name, "Person 0");

  broken = false;
  assert.equal(retryPush(k.deps(), row.outbox_id), true);
  assert.equal(retryPush(k.deps(), row.outbox_id), false);
  assert.equal(await flushOutbox(k.deps(), k.binding), 0);
  assert.equal((await k.remotes())[0]!.data.full_name, "Pushed");
  assert.equal(rid, (await k.remotes())[0]!.id);
});

test("the log records each pass under its run id", async () => {
  const k = await kit();
  await seed(k, 1);
  const r = await k.run({ traceId: "0123456789abcdef0123456789abcdef" });
  const rows = k.tx.all<{ kind: string; run_id: string; trace_id: string; summary: string }>("SELECT kind, run_id, trace_id, summary FROM sy_log ORDER BY id");
  assert.deepEqual(rows.map((x) => x.kind), ["pull", "push"]);
  assert.ok(rows.every((x) => x.run_id === r.runId && x.trace_id === "0123456789abcdef0123456789abcdef"));
  assert.match(rows[0]!.summary, /1 created, 0 updated here/);
});
