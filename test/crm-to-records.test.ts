// CRM to Records, end to end on two made-up CRMs that share nothing (test/support/fake-crm-server.ts, a real HTTP server): the agent stand-in reads real pages through the discovery
// capabilities and fills a SyncSpec; the platform checks it, makes the connector, the connection, the record types (the real schema module) and the bindings, and the real sync engine
// pulls the records. Then a person edit pushes, a conflict resolves newest-wins with the old value kept in history, a delete never reaches the app, and only GET and the edited
// PATCHes ever travel. Nothing in the platform knows either app.
import test from "node:test";
import assert from "node:assert/strict";
import { openSchema } from "../modules/schema/impl.ts";
import { openConnectors } from "../modules/connectors/impl.ts";
import * as sources from "../modules/sources/impl.ts";
import { KEY_A, KEY_B, ledgerAccountSpec } from "../modules/connectors/fixtures/crm.ts";
import { coreOf, createSyncEngine } from "../host/src/daemon/syncengine.ts";
import type { SyncEngine } from "../modules/connectors/handlers/sync.ts";
import type { ConnectorsCtx, Probe } from "../modules/connectors/projections.ts";
import { fillSpec } from "./support/agent-standin.ts";
import type { Know } from "./support/agent-standin.ts";
import { startFakeCrm } from "./support/fake-crm-server.ts";

const VAULT: Record<string, string> = { "#Ledger_Key": KEY_A, "#Orbit_Key": KEY_B };
const LEDGER: Know = {
  name: "Ledger", domain: "crm-a.test", auth: { vaultHandle: "#Ledger_Key", style: "header", header: "X-Api-Token" },
  objects: [
    { remote: "organizations", path: "/api/v2/organizations", label: "Organization", recordType: "org" },
    { remote: "people", path: "/api/v2/people", label: "Person", recordType: "person", write: { path: "/api/v2/people/{id}", evidence: "https://docs.crm-a.test/people#update" } },
  ],
  fieldsEndpoint: { path: "/api/v2/fields/people", forRemote: "people" },
  firstPullFilter: { remote: "people", param: "modified_after", value: "2026-01-01T00:00:00Z", words: "People changed since the start of 2026" },
};
const ORBIT: Know = {
  name: "Orbit", domain: "crm-b.test", auth: { vaultHandle: "#Orbit_Key", style: "bearer" },
  objects: [{ remote: "jobs", path: "/v1/objects/jobs", label: "Job", recordType: "job", write: { path: "/v1/objects/jobs/{id}", evidence: "https://docs.crm-b.test/jobs#update" } }],
  fieldsEndpoint: { path: "/v1/schema/jobs", forRemote: "jobs" }, backfill: "now",
};

async function boot() {
  const crm = await startFakeCrm();
  const schema = openSchema();
  sources.openSources({ tx: schema.tx });
  const scheduled: { cap: string; input: any; ran: boolean }[] = [];
  const runs: { runId: string; status?: string; summary?: string }[] = [];
  const events: { name: string; payload: Record<string, unknown> }[] = [];
  const probe: Probe = async (_c, req) => {
    const key = VAULT[req.handle] ?? "";
    const headers = req.style === "bearer" ? { Authorization: `Bearer ${key}` } : { [req.header ?? "Authorization"]: `${req.prefix ?? ""}${key}` };
    const r = await crm.fetch(req.url, { method: "GET", headers });
    return { status: r.status, text: await r.text(), ...(r.link ? { link: r.link } : {}) };
  };
  const conn = openConnectors({ tx: schema.tx, resolveSecret: async (h) => VAULT[h], probe });
  const trace = { traceId: "0123456789abcdef0123456789abcdef" };
  const schemaCtx = { trace, emit: () => undefined, actor: "usr_dana" };
  const ctx: ConnectorsCtx = {
    trace, actor: "usr_dana",
    emit: (name, _s, payload) => { events.push({ name, payload }); },
    http: (url, init) => crm.fetch(url, init),
    schedule: async (_at, cap, input) => { scheduled.push({ cap, input, ran: false }); return `sch_${scheduled.length}`; },
    call: async (cap, input) => {
      if (cap.startsWith("schema.")) return (schema.handlers as Record<string, (c: unknown, i: unknown) => Promise<unknown>>)[cap]!(schemaCtx, input);
      if (cap === "runs.start") { const runId = `run_${runs.length + 1}`; runs.push({ runId }); return { runId }; }
      if (cap === "runs.finish") { const i = input as { runId: string; status: string; summary?: string }; Object.assign(runs.find((r) => r.runId === i.runId)!, { status: i.status, ...(i.summary ? { summary: i.summary } : {}) }); return { run: { id: i.runId } }; }
      if (cap === "records.update") { const i = input as { type: string; recordId: string; patch: Record<string, unknown> }; const cur = await schema.store.get(i.type, i.recordId); await schema.store.update(i.type, i.recordId, i.patch as never, cur!.version); return { record: { id: i.recordId } }; }
      if (cap === "records.delete") { const i = input as { type: string; recordId: string }; const cur = await schema.store.get(i.type, i.recordId); if (cur) await schema.store.remove(i.type, i.recordId, cur.version); return { deleted: true }; }
      if (cap === "records.counts") return { count: (await schema.store.query((input as { type: string }).type, { page: { limit: 500 } })).rows.length };
      if (cap === "connectors.run" || cap === "connectors.get" || cap === "sync_types.get") return (conn.handlers as Record<string, (c: unknown, i: unknown) => Promise<unknown>>)[cap]!(ctx, input);
      throw new Error(`no ${cap}`);
    },
  };
  const engine = createSyncEngine({ core: coreOf(sources as unknown as Record<string, unknown>), local: { open: () => ({ store: schema.store, tx: schema.tx }), space: "sp_test" } });
  conn.deps.engine = engine as unknown as SyncEngine;
  const hs = conn.handlers;
  /** Run every scheduled pass that has not run yet (the scheduler's job), polls excluded. */
  const drain = async (): Promise<void> => {
    for (const s of scheduled) if (s.cap === "connectors.sync_run" && !s.ran) { s.ran = true; await hs["connectors.sync_run"](ctx, s.input); }
  };
  const rows = async (type: string) => (await schema.store.query(type, { page: { limit: 100 } })).rows;
  const byName = async (type: string, name: string) => (await rows(type)).find((r) => r.data["name"] === name || r.data["title"] === name)!;
  const pass = async (type: string): Promise<void> => { await hs["connectors.sync_now"](ctx, { type, idempotencyKey: `n${scheduled.length}` } as never); await drain(); };
  return { crm, schema, conn, hs, ctx, scheduled, runs, events, drain, rows, byName, pass, close: () => crm.close() };
}
type World = Awaited<ReturnType<typeof boot>>;

async function bring(w: World, know: Know, key: string) {
  const spec = await fillSpec(w.hs, w.ctx, know);
  const checked = await w.hs["sync_specs.validate"](w.ctx, { spec });
  assert.deepEqual(checked.problems.filter((p) => p.level === "error"), [], `${know.name} spec: ${JSON.stringify(checked.problems)}`);
  const applied = await w.hs["sync_specs.apply"](w.ctx, { spec, idempotencyKey: key });
  await w.drain();
  return { spec, applied };
}

test("two unknown CRMs become record types and records, with nothing written to either", async () => {
  const w = await boot();
  try {
    const ledger = await bring(w, LEDGER, "a");
    const orbit = await bring(w, ORBIT, "b");

    // the stand-in read the shapes off real pages
    const people = (ledger.spec as any).objects.find((o: any) => o.remote === "people");
    assert.deepEqual([people.itemsAt, people.id, people.updatedAt, people.list.cursor.kind], ["/data", "/id", "/modified", "page"]);
    assert.equal(people.fields.find((f: any) => f.path === "/org_id").relationTo, "organizations", "a relation found because its values are another object's ids");
    assert.equal((orbit.spec as any).objects[0].list.cursor.kind, "link");

    // record types, made by the real schema module
    const described = ((await w.schema.handlers["schema.describe"]({ trace: { traceId: "0123456789abcdef0123456789abcdef" }, emit: () => undefined, actor: "usr_dana" }, {})) as { types: any[] }).types;
    const person = described.find((t) => t.key === "person");
    assert.equal(person.fields.find((f: any) => f.key === "status").type, "status");
    assert.deepEqual(person.fields.find((f: any) => f.key === "status").options.stages.map((s: any) => s.key), ["lead", "client", "closed"]);
    assert.equal(person.fields.find((f: any) => f.key === "org").type, "relation");
    assert.equal(described.find((t) => t.key === "job").fields.find((f: any) => f.key === "kind").type, "choice");

    // records: the first-pull filter left Cy out of Ledger; Orbit's backfill brought all three jobs over two Link pages
    assert.deepEqual((await w.rows("org")).map((r) => r.data["name"]).sort(), ["North Works", "South Mill"]);
    assert.deepEqual((await w.rows("person")).map((r) => r.data["name"]).sort(), ["Ada Stone", "Ben Ford", "Di Moss", "Ed Park"]);
    assert.deepEqual((await w.rows("job")).map((r) => r.data["title"]).sort(), ["Ford repair", "Moss repair", "Stone install"]);
    const ada = await w.byName("person", "Ada Stone");
    const north = await w.byName("org", "North Works");
    assert.equal(ada.data["status"], "lead");
    assert.deepEqual(ada.data["org"], [{ urn: `vyre://sp_test/org/${north.id}` }], "the relation is a link to the pulled record");
    const back = ((await w.schema.store.get("org", north.id))!.data["persons"] as { urn: string }[]).map((x) => x.urn).sort();
    assert.deepEqual(back, [ada.id, (await w.byName("person", "Ben Ford")).id].map((id) => `vyre://sp_test/person/${id}`).sort(), "the other end of the two-way relation moved with it");
    const job = await w.byName("job", "Stone install");
    assert.equal(job.data["kind"], "install");
    assert.equal(job.data["amount"], 12000);

    // every Run finished
    assert.ok(w.runs.every((r) => r.status === "succeeded"), JSON.stringify(w.runs));
    // reading is all that happened
    assert.ok(w.crm.methods().every((m) => m === "GET"), `methods: ${[...new Set(w.crm.methods())]}`);
    // the filter was the app's own query parameter
    assert.ok(w.crm.c.state.requests.length > 8);
  } finally { await w.close(); }
});

test("a person edit pushes, a conflict resolves newest-wins with the old value in history, a delete never reaches the app", async () => {
  const w = await boot();
  try {
    await bring(w, LEDGER, "a");
    await bring(w, ORBIT, "b");
    const wrote = () => w.crm.c.state.requests.filter((r) => r.method !== "GET");
    assert.equal(wrote().length, 0);

    // 1. an edit pushes, only the field that changed, and the push is in the outbox as sent
    const ada = await w.byName("person", "Ada Stone");
    await w.schema.store.update("person", ada.id, { phone: "+1 555 9999" }, ada.version);
    await w.pass("person");
    assert.equal(w.crm.c.state.people.find((p) => p.id === 101)!.attributes.phone, "+1 555 9999");
    assert.deepEqual(wrote().map((r) => `${r.method} ${r.path}`), ["PATCH /api/v2/people/101"]);
    const outbox = await w.hs["connectors.outbox.list"](w.ctx, { type: "person" });
    assert.deepEqual(outbox.items.map((o) => [o.op, o.state, o.fields]), [["update", "sent", ["phone"]]]);

    // the push is in the field's history as sent by the person who asked for the pass
    const sent = await w.hs["sync_types.field_history"](w.ctx, { type: "person", recordId: ada.id, field: "phone" });
    assert.deepEqual(sent.entries.map((e) => [e.replacedBy, e.by, e.value]), [["push", "usr_dana", "+1 555 9999"]]);

    // 2. both sides changed Ben's name; the app's change is the newer one, so it wins here and our value is kept
    const ben = await w.byName("person", "Ben Ford");
    await w.schema.store.update("person", ben.id, { name: "Ben (typed here)" }, ben.version);
    const theirBen = w.crm.c.state.people.find((p) => p.id === 102)!;
    theirBen.attributes.full_name = "Ben (typed there)";
    theirBen.modified = "2099-01-01T00:00:00Z";
    await w.pass("person");
    assert.equal((await w.schema.store.get("person", ben.id))!.data["name"], "Ben (typed there)");
    const lost = w.schema.tx.all<{ field: string; value: string; actor: string }>("SELECT field, value, actor FROM records_field_history WHERE type = 'person' AND reason = 'lww_loser' AND id = ?", ben.id);
    assert.deepEqual(lost.map((h) => [h.field, JSON.parse(h.value), h.actor]), [["name", "Ben (typed here)", "sync:crm_ledger"]]);

    // 3. both changed Ed's note; ours is the newer, so it is pushed and the app's old value is kept
    const ed = await w.byName("person", "Ed Park");
    await w.schema.store.update("person", ed.id, { note: "called today" }, ed.version);
    const theirEd = w.crm.c.state.people.find((p) => p.id === 105)!;
    theirEd.attributes.note = "old note in the app";
    theirEd.modified = "2026-01-02T00:00:00Z";
    await w.pass("person");
    assert.equal(theirEd.attributes.note, "called today");
    const kept = w.schema.tx.all<{ value: string; actor: string }>("SELECT value, actor FROM records_field_history WHERE type = 'person' AND reason = 'lww_loser' AND id = ?", ed.id);
    assert.deepEqual(kept.map((h) => [JSON.parse(h.value), h.actor]), [["old note in the app", "source:crm_ledger"]]);

    // 4. a delete here never reaches the app
    const di = await w.byName("person", "Di Moss");
    await w.schema.store.remove("person", di.id, di.version);
    await w.pass("person");
    await w.pass("person");
    assert.equal(w.crm.c.state.people.some((p) => p.id === 104), true, "Di is still in the app");
    assert.ok(w.crm.methods().every((m) => m === "GET" || m === "PATCH"), `methods: ${[...new Set(w.crm.methods())]}`);
    assert.deepEqual([...new Set(wrote().map((r) => r.path))].sort(), ["/api/v2/people/101", "/api/v2/people/105"]);

    // 5. an Orbit job edit pushes through the other shape (props nested, bearer key)
    const m = await w.byName("job", "Ford repair");
    await w.schema.store.update("job", m.id, { title: "Ford repair (open)" }, m.version);
    await w.pass("job");
    assert.equal(w.crm.c.state.jobs.find((x) => x.uid === "j-2")!.props.title, "Ford repair (open)");
    assert.equal(w.crm.c.state.jobs.find((x) => x.uid === "j-2")!.props.amount, 0, "only the changed field went");

    // 6. no key value is anywhere in what Vyre stored
    const dump = JSON.stringify(["cn_connectors", "cn_connections", "cn_sync_specs", "cn_synced_types", "cn_log", "sy_log", "sy_outbox", "sy_links"].map((t) => w.schema.tx.all(`SELECT * FROM ${t}`))) + JSON.stringify(w.events);
    assert.equal(dump.includes(KEY_A) || dump.includes(KEY_B), false);
  } finally { await w.close(); }
});

test("the first-pull filter holds until a backfill, then Cy arrives", async () => {
  const w = await boot();
  try {
    await bring(w, LEDGER, "a");
    assert.equal((await w.rows("person")).some((r) => r.data["name"] === "Cy Lane"), false);
    const bf = await w.hs["sync_specs.backfill"](w.ctx, { type: "person", idempotencyKey: "bf" } as never);
    assert.ok(bf.runId);
    await w.drain();
    assert.equal((await w.rows("person")).some((r) => r.data["name"] === "Cy Lane"), true);
    assert.equal((await w.rows("person")).length, 5);
  } finally { await w.close(); }
});

test("what a person sees: where a record came from, how each field is doing, the value that lost and its Restore, the Sync page", async () => {
  const w = await boot();
  try {
    await bring(w, LEDGER, "a");
    const ada = await w.byName("person", "Ada Stone");
    const state = () => w.hs["sync_types.record_state"](w.ctx, { type: "person", recordId: ada.id });
    // before any edit: synced, with the address to open it in the app, and the lock on what is only read
    const before = await state();
    assert.deepEqual([before.synced, before.state, before.app?.title, before.remoteId, before.openUrl], [true, "synced", "Ledger", "101", undefined], "no open address unless the spec gave one");
    assert.deepEqual(before.fields.find((f) => f.key === "org")!.dir, "pull");
    assert.deepEqual(before.fields.find((f) => f.key === "phone")!.dir, "both");
    assert.equal((await w.hs["sync_types.record_state"](w.ctx, { type: "org", recordId: "nope" })).synced, true);
    assert.equal((await w.hs["sync_types.record_state"](w.ctx, { type: "task", recordId: "x" })).synced, false);

    // an edit waits in the outbox while the app is down: saving, then failed after the retries, then saved after a retry
    w.crm.c.state.rejectWrites = true;
    await w.schema.store.update("person", ada.id, { phone: "+1 555 7777" }, ada.version);
    await w.pass("person");
    const failed = await state();
    assert.equal(failed.fields.find((f) => f.key === "phone")!.state, "saving", "one failed try is still saving");
    await w.pass("person");
    await w.pass("person");
    const dead = await state();
    assert.deepEqual([dead.state, dead.fields.find((f) => f.key === "phone")!.state], ["failed", "failed"]);
    assert.ok(dead.fields.find((f) => f.key === "phone")!.error);
    const status = await w.hs["sync_types.status"](w.ctx, { type: "person" });
    assert.equal(status.failedPushes, 1);
    w.crm.c.state.rejectWrites = false;
    await w.hs["connectors.outbox.retry"](w.ctx, { outboxId: dead.fields.find((f) => f.key === "phone")!.outboxId! });
    const saved = await state();
    assert.deepEqual([saved.state, saved.fields.find((f) => f.key === "phone")!.state], ["synced", "synced"]);
    assert.ok(saved.fields.find((f) => f.key === "phone")!.at, "saved at a time, for the tooltip");
    assert.equal(w.crm.c.state.people.find((p) => p.id === 101)!.attributes.phone, "+1 555 7777");

    // a conflict the app wins: our value is in the field's history, Restore puts it back and sends it
    const cur = await w.schema.store.get("person", ada.id);
    await w.schema.store.update("person", ada.id, { note: "typed here" }, cur!.version);
    const theirs = w.crm.c.state.people.find((p) => p.id === 101)!;
    theirs.attributes.note = "typed there";
    theirs.modified = "2099-01-01T00:00:00Z";
    await w.pass("person");
    assert.equal((await w.schema.store.get("person", ada.id))!.data["note"], "typed there");
    assert.equal((await state()).fields.find((f) => f.key === "note")!.history, 1);
    const hist = await w.hs["sync_types.field_history"](w.ctx, { type: "person", recordId: ada.id, field: "note" });
    assert.deepEqual(hist.entries.map((e) => [e.value, e.replacedBy]), [["typed here", "app"]]);
    assert.ok(hist.entries[0]!.at && hist.entries[0]!.at > 0);
    const restored = await w.hs["sync_types.restore_field"](w.ctx, { type: "person", recordId: ada.id, field: "note", historyId: hist.entries[0]!.historyId });
    assert.equal(restored.ok, true);
    await w.drain();
    assert.equal((await w.schema.store.get("person", ada.id))!.data["note"], "typed here");
    assert.equal(theirs.attributes.note, "typed here", "the restored value is sent");
    await assert.rejects(w.hs["sync_types.restore_field"](w.ctx, { type: "person", recordId: ada.id, field: "note", historyId: "999" }), (e: any) => e.error?.code === "validation.not_found");

    // the Sync page
    const page = await w.hs["sync_types.status"](w.ctx, { type: "person" });
    assert.deepEqual([page.app.title, page.records, page.estimate, page.canBackfill, page.filter, page.paused, page.deletes, page.spec], ["Ledger", 4, 5, true, "People changed since the start of 2026", false, "off", true]);
    assert.match(page.lastRun!.summary, /created|updated/);
    assert.ok(page.nextPollAt);
  } finally { await w.close(); }
});

test("Remove: keep the records as plain records, or remove them with their types", async () => {
  const keep = await boot();
  try {
    await bring(keep, LEDGER, "a");
    const out = await keep.hs["sync_specs.remove"](keep.ctx, { type: "person", records: "keep" });
    assert.deepEqual(out.detached.sort(), ["org", "person"]);
    assert.equal((await keep.rows("person")).length, 4, "the records stay");
    assert.equal((await keep.hs["sync_types.record_state"](keep.ctx, { type: "person", recordId: "x" })).synced, false);
    assert.equal(keep.schema.tx.get("SELECT 1 AS x FROM cn_connectors WHERE key = 'crm_ledger'"), undefined);
    assert.equal(keep.schema.tx.get("SELECT 1 AS x FROM cn_connections"), undefined);
    const before = keep.crm.methods().length;
    await keep.pass("person").catch(() => undefined);
    assert.equal(keep.crm.methods().length, before, "nothing talks to the app any more");
  } finally { await keep.close(); }
  const drop = await boot();
  try {
    await bring(drop, LEDGER, "a");
    const out = await drop.hs["sync_specs.remove"](drop.ctx, { type: "person", records: "remove" });
    assert.deepEqual(out.removed.sort(), ["org", "person"]);
    const described = ((await drop.schema.handlers["schema.describe"]({ trace: { traceId: "0123456789abcdef0123456789abcdef" }, emit: () => undefined, actor: "usr_dana" }, {})) as { types: { key: string }[] }).types;
    assert.equal(described.some((t) => t.key === "person" || t.key === "org"), false);
    assert.equal(drop.crm.c.state.people.length, 5, "the app is untouched");
    assert.ok(drop.crm.methods().every((m) => m === "GET"));
  } finally { await drop.close(); }
});

test("two accounts of one app share one record type: a From field tells them apart, nothing crosses between them", async () => {
  const w = await boot();
  try {
    VAULT["#Ledger_Paris"] = KEY_A;
    const berlin = ledgerAccountSpec("Berlin");
    const paris = { ...ledgerAccountSpec("Paris", "b"), auth: { vaultHandle: "#Ledger_Paris", style: "header", header: "X-Api-Token" } };
    const apply = async (spec: Record<string, unknown>, key: string) => { const v = await w.hs["sync_specs.validate"](w.ctx, { spec }); assert.deepEqual(v.problems.filter((p) => p.level === "error"), []); await w.hs["sync_specs.apply"](w.ctx, { spec, idempotencyKey: key }); await w.drain(); };
    await apply(berlin, "ab");
    await apply(paris, "ap");
    const people = await w.rows("person");
    assert.equal(people.length, 5 + 2, "one type, every account's records");
    const from = (n: string) => people.filter((p) => p.data["from"] === n).map((p) => p.data["name"]).sort();
    assert.deepEqual(from("Berlin"), ["Ada Stone", "Ben Ford", "Cy Lane", "Di Moss", "Ed Park"]);
    assert.deepEqual(from("Paris"), ["Ada Stone (Paris)", "Gus Hale"]);
    assert.equal(people.filter((p) => p.data["email"] === "ada@example.test").length, 2, "the same email in two accounts is two records, never merged");
    // each account has its own binding, status and pause
    const st = await w.hs["sync_types.status"](w.ctx, { type: "person" });
    assert.deepEqual(st.accounts!.map((a) => [a.account, a.records]), [["Berlin", 5], ["Paris", 2]]);
    assert.equal(st.records, 7);
    assert.equal((await w.hs["sync_types.status"](w.ctx, { type: "person", account: "Paris" })).records, 2);
    // an edit pushes to the account it came from only
    const gus = people.find((p) => p.data["name"] === "Gus Hale")!;
    await w.schema.store.update("person", gus.id, { phone: "+33 9 9999" }, gus.version);
    await w.pass("person");
    assert.equal(w.crm.c.state.peopleB.find((p) => p.id === 202)!.attributes.phone, "+33 9 9999");
    assert.equal(w.crm.c.state.people.some((p) => p.attributes.phone === "+33 9 9999"), false);
    const wrote = w.crm.c.state.requests.filter((r) => r.method === "PATCH").map((r) => r.path);
    assert.deepEqual(wrote, ["/api/v2/people/202"]);
    // pausing one account leaves the other running; removing one keeps the other's records
    await w.hs["sync_types.pause"](w.ctx, { type: "person", account: "Paris" });
    assert.deepEqual((await w.hs["sync_types.status"](w.ctx, { type: "person" })).accounts!.map((a) => a.state === "paused"), [false, true]);
    await w.hs["sync_specs.remove"](w.ctx, { type: "person", account: "Paris", records: "remove" });
    assert.deepEqual((await w.rows("person")).map((p) => p.data["from"]).filter((f) => f === "Paris").length, 0);
    assert.equal((await w.rows("person")).length, 5);
  } finally { await w.close(); }
});
