// @reads /modules/sources/migrations/0001_sources.sql
// The sync engine for apps whose records point at each other and whose values a record type may refuse: a relation turns the app's id into a link to the record pulled for it,
// the value that loses a newest-wins settlement is kept in the field's history, and a record the type refuses is skipped and logged without stopping the pass.
import test from "node:test";
import assert from "node:assert/strict";
import { mintRecordId } from "../../../lib/ids.ts";
import { openRecordStore } from "../../../kernel/src/store/records.ts";
import { openSources } from "../impl.ts";
import { runSync } from "../handlers/sync.ts";
import type { SyncBinding, SyncDeps } from "../handlers/sync.ts";

const ORG = { name: "org", label: "Org", fields: [{ name: "name", kind: "text", label: "Name" }, { name: "persons", kind: "link", label: "Persons", to: "person", many: true }] };
const PERSON = { name: "person", label: "Person", fields: [
  { name: "name", kind: "text", label: "Name" }, { name: "email", kind: "text", label: "Email" }, { name: "stage", kind: "stage", label: "Stage", options: ["lead", "client"] },
  { name: "org", kind: "link", label: "Org", to: "org", many: true },
] };
const R_ORG = { name: "r_org", label: "r_org", fields: [{ name: "/name", kind: "text" }] };
const R_PERSON = { name: "r_person", label: "r_person", fields: [{ name: "/name", kind: "text" }, { name: "/email", kind: "text" }, { name: "/stage", kind: "text" }, { name: "/org", kind: "text" }] };

const ORG_B: SyncBinding = { syncTypeId: "syt_org", type: "org", remote: "r_org", connector: "app", label: "App", fields: [{ local: "name", remote: "/name", direction: "pull" }], match: [], createAtSource: false, deletes: false, conflict: "newest" };
const PERSON_B: SyncBinding = {
  syncTypeId: "syt_person", type: "person", remote: "r_person", connector: "app", label: "App",
  fields: [
    { local: "name", remote: "/name", direction: "both" }, { local: "email", remote: "/email", direction: "both" }, { local: "stage", remote: "/stage", direction: "both" },
    { local: "org", remote: "/org", direction: "pull", relation: { syncTypeId: "syt_org", type: "org", inverse: "persons" } },
  ],
  match: ["email"], createAtSource: false, deletes: false, conflict: "newest",
};

async function kit() {
  const clock = { t: 1000 };
  const l = openRecordStore({ path: ":memory:", space: "sp_local", clock: () => clock.t });
  const r = openRecordStore({ path: ":memory:", space: "sp_remote", clock: () => clock.t });
  await l.store.define({ add_types: [ORG, PERSON] });
  await r.store.define({ add_types: [R_ORG, R_PERSON] });
  const src = openSources({ tx: l.host.tx, now: () => clock.t });
  const events: { name: string; payload: Record<string, any> }[] = [];
  const deps = (): SyncDeps => ({ local: l.store, remote: r.store, tx: l.host.tx, space: "sp_local", now: () => clock.t, emit: (name, _s, payload) => { events.push({ name, payload }); } });
  const run = (b: SyncBinding, o: Parameters<typeof runSync>[2] = {}) => runSync({ ...deps(), remote: remoteOf(b) }, b, o);
  const remoteOf = (_b: SyncBinding) => r.store;
  return { clock, l, r, src, events, run, deps };
}
type Kit = Awaited<ReturnType<typeof kit>>;
const mk = async (k: Kit, type: string, data: Record<string, unknown>) => (await k.r.store.create(type, mintRecordId(), data)).id;
const local = async (k: Kit, type: string) => (await k.l.store.query(type, { page: { limit: 100 } })).rows;

test("a relation becomes a link to the record pulled for the app's id, and fills in once that record arrives", async () => {
  const k = await kit();
  const orgId = await mk(k, "r_org", { "/name": "North Works" });
  await mk(k, "r_person", { "/name": "Ada", "/email": "ada@x.test", "/stage": "lead", "/org": orgId });
  // people first: the org has not been pulled, so the link is empty and nothing fails
  const first = await k.run(PERSON_B);
  assert.equal(first.local.created, 1);
  const ada = (await local(k, "person"))[0]!;
  assert.equal(ada.data["org"] ?? null, null);
  await k.run(ORG_B);
  const second = await k.run(PERSON_B);
  assert.equal(second.local.updated, 1);
  const org = (await local(k, "org"))[0]!;
  const linked = (await k.l.store.get("person", ada.id))!.data["org"] as { urn: string }[];
  assert.deepEqual(linked, [{ urn: `vyre://sp_local/org/${org.id}` }]);
  assert.deepEqual((await k.l.store.get("org", org.id))!.data["persons"], [{ urn: `vyre://sp_local/person/${ada.id}` }], "the other end moved with it");
  // the app moves Ada to another org: the old end lets go and the new one takes hold
  const other = await mk(k, "r_org", { "/name": "South Mill" });
  const adaRemote = (await k.r.store.query("r_person", { page: { limit: 10 } })).rows[0]!;
  await k.r.store.update("r_person", adaRemote.id, { "/org": other }, adaRemote.version);
  await k.run(ORG_B);
  await k.run(PERSON_B);
  const south = (await local(k, "org")).find((o) => o.data["name"] === "South Mill")!;
  assert.deepEqual((await k.l.store.get("org", org.id))!.data["persons"] ?? [], []);
  assert.deepEqual((await k.l.store.get("org", south.id))!.data["persons"], [{ urn: `vyre://sp_local/person/${ada.id}` }]);
  // a third pass is quiet
  assert.equal((await k.run(PERSON_B)).summary, "Nothing to change.");
});

test("newest wins keeps the value that lost in the field's history, whichever side lost", async () => {
  const k = await kit();
  const rid = await mk(k, "r_person", { "/name": "Ben", "/email": "ben@x.test", "/stage": "lead" });
  await k.run(PERSON_B);
  const id = (await local(k, "person"))[0]!.id;
  // both sides change the name; the app's change is newer
  k.clock.t = 2000;
  const mine = await k.l.store.get("person", id);
  await k.l.store.update("person", id, { name: "Ben (mine)" }, mine!.version);
  k.clock.t = 3000;
  const theirs = await k.r.store.get("r_person", rid);
  await k.r.store.update("r_person", rid, { "/name": "Ben (crm)" }, theirs!.version);
  const rep = await k.run(PERSON_B);
  assert.equal(rep.conflicts, 1);
  assert.equal((await k.l.store.get("person", id))!.data["name"], "Ben (crm)");
  const lost = k.l.host.tx.all<{ field: string; value: string; actor: string; reason: string }>("SELECT field, value, actor, reason FROM records_field_history WHERE type = 'person' AND reason = 'lww_loser' AND id = ?", id);
  assert.deepEqual(lost.map((h) => [h.field, JSON.parse(h.value), h.actor, h.reason]), [["name", "Ben (mine)", "sync:App", "lww_loser"]]);

  // now mine is newer: the app's value is what is kept, and it is pushed
  k.clock.t = 4000;
  const cur = await k.l.store.get("person", id);
  await k.l.store.update("person", id, { name: "Ben (mine 2)" }, cur!.version);
  k.clock.t = 3500;
  const t2 = await k.r.store.get("r_person", rid);
  await k.r.store.update("r_person", rid, { "/name": "Ben (crm 2)" }, t2!.version);
  k.clock.t = 5000;
  await k.run(PERSON_B);
  assert.equal((await k.r.store.get("r_person", rid))!.data["/name"], "Ben (mine 2)");
  const all = k.l.host.tx.all<{ value: string; actor: string }>("SELECT value, actor FROM records_field_history WHERE type = 'person' AND reason = 'lww_loser' AND id = ? ORDER BY rowid", id);
  assert.deepEqual(all.map((h) => [JSON.parse(h.value), h.actor]), [["Ben (mine)", "sync:App"], ["Ben (crm 2)", "source:App"]]);
});

test("a record the type refuses is skipped and logged, the others still arrive, and the next pass tries again", async () => {
  const k = await kit();
  await mk(k, "r_person", { "/name": "Cy", "/email": "cy@x.test", "/stage": "lead" });
  await mk(k, "r_person", { "/name": "Di", "/email": "di@x.test", "/stage": "platinum" });
  await mk(k, "r_person", { "/name": "Ed", "/email": "ed@x.test", "/stage": "client" });
  const rep = await k.run(PERSON_B);
  assert.equal(rep.skipped, 1);
  assert.equal(rep.local.created, 3, "the report counts what was planned");
  assert.deepEqual((await local(k, "person")).map((p) => p.data["name"]).sort(), ["Cy", "Ed"]);
  const log = k.src.tx.all<{ kind: string; summary: string }>("SELECT kind, summary FROM sy_log WHERE sync_type = 'syt_person' AND kind = 'error'");
  assert.equal(log.length, 1);
  assert.match(log[0]!.summary, /skipped App record .*stage must be one of its options/);
  const again = await k.run(PERSON_B);
  assert.equal(again.skipped, 1);
});

test("a slice of a big app is pulled alone: its records arrive, nothing outside the slice is marked removed, and nothing is pushed", async () => {
  const k = await kit();
  const a = await mk(k, "r_person", { "/name": "Al", "/email": "al@x.test", "/stage": "lead" });
  await mk(k, "r_person", { "/name": "Bo", "/email": "bo@x.test", "/stage": "lead" });
  const all = (await k.r.store.query("r_person", { page: { limit: 10 } })).rows;
  const first = await k.run({ ...PERSON_B, deletes: true }, { mode: "both", partial: all.filter((r) => r.id === a) });
  assert.equal(first.local.created, 1);
  const second = await k.run({ ...PERSON_B, deletes: true }, { mode: "both", partial: all.filter((r) => r.id !== a) });
  assert.equal(second.local.created, 1);
  assert.equal(second.removedAtSource, 0, "Al is not in this slice and is not gone");
  assert.equal(second.remote.created + second.remote.updated + second.remote.removed, 0);
  assert.deepEqual((await local(k, "person")).map((p) => p.data["name"]).sort(), ["Al", "Bo"]);
  assert.equal((await local(k, "person")).every((p) => !p.deleted_at), true);
});
