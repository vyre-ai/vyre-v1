// @reads /modules/connectors/migrations/0001_connectors.sql
// @reads /modules/sources/migrations/0001_sources.sql
// Synced types and the sync engine's capabilities: bind, change, pause, review schema changes, detach, log, outbox, sync_now and the engine seam. The engine itself is tested in modules/sources;
// here it is a recording fake behind the SyncEngine seam, over the real sy_* tables the engine writes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACME } from "../fixtures/acme.ts";
import { NOW, kit } from "../fixtures/kit.ts";
import type { Kit } from "../fixtures/kit.ts";
import { handlers as live } from "../impl.ts";
import { createSyncHandlers, noteSchemaChanges, proposedKey, proposedType, syncRequest } from "../handlers/sync.ts";
import type { SyncEngine, SchemaChange } from "../handlers/sync.ts";
import type { ConnectorDef, ConnectorsCtx } from "../projections.ts";

const code = (c: string) => (e: unknown) => {
  assert.equal((e as { error?: { code?: string } }).error?.code, c, JSON.stringify(e));
  return true;
};
const KEYS = { Acme_Key: "#AcmeKey", Acme_Hook: "#AcmeHook" };
const SOURCES_SQL = readFileSync(new URL("../../sources/migrations/0001_sources.sql", import.meta.url), "utf8");
const SYNC_ACME: ConnectorDef = {
  ...ACME, rate: undefined, syncedTypes: ["contacts", "deals"],
  actions: [...ACME.actions, { name: "discover", url: "https://api.acme.test/v1/schema", output: "/objects" }],
};
const MAP = [{ key: "name", remote: "full_name", dir: "both" as const }, { key: "email", remote: "email_address", dir: "both" as const }, { key: "phone", remote: "phone_number", dir: "pull" as const }];

interface Call { cap: string; input: any }
interface World {
  k: Kit; calls: Call[]; types: Map<string, string[]>; engine: Record<string, unknown[][]>; engineOut: Record<string, unknown>;
  ctx: ConnectorsCtx; as(actor: string): ConnectorsCtx; hs: ReturnType<typeof createSyncHandlers>; connectionId: string;
}

async function world(o: { engine?: boolean; state?: "space" | "person" } = {}): Promise<World> {
  const k = kit();
  k.tx.exec(SOURCES_SQL);
  k.install(SYNC_ACME);
  const calls: Call[] = [];
  const types = new Map<string, string[]>();
  const engine: Record<string, unknown[][]> = {};
  const engineOut: Record<string, unknown> = {};
  const fake: SyncEngine = {
    preview: async (_c, b, op) => { (engine["preview"] ??= []).push([b.type, op]); return (engineOut["preview"] as never) ?? { creates: 0, updates: 34, removes: 0, skips: 1, summary: "Will update 34 records in Acme", samples: [] }; },
    confirmDeletes: async (_c, b, d) => { (engine["confirmDeletes"] ??= []).push([b.type, d]); return d === "mark_removed" ? 3 : 0; },
    resolveConflict: async (_c, b, id, r, v) => { (engine["resolveConflict"] ??= []).push([b.type, id, r, v]); return { recordId: "rec_1" }; },
    replayConflict: async (_c, b, id) => { (engine["replayConflict"] ??= []).push([b.type, id]); return [{ rule: "source", value: "theirs" }, { rule: "vyre", value: "ours" }]; },
    undoPush: async (_c, b, id) => { (engine["undoPush"] ??= []).push([b.type, id]); return (engineOut["undoPush"] as never) ?? { undone: true }; },
    push: async (_c, b, id) => { (engine["push"] ??= []).push([b.type, id]); return (engineOut["push"] as never) ?? { state: "sent" }; },
  };
  const wrap = (c: ConnectorsCtx): ConnectorsCtx => ({
    ...c,
    call: async (cap, input) => {
      calls.push({ cap, input });
      if (cap === "runs.start") return { runId: `run_${calls.filter((x) => x.cap === "runs.start").length}` };
      if (cap === "schema.describe") {
        const t = (input as { type: string }).type;
        return { types: types.has(t) ? [{ key: t, fields: types.get(t)!.map((key) => ({ key })) }] : [] };
      }
      if (cap === "schema.apply") {
        for (const op of (input as { ops: { op: string; type: string; field?: string; def?: { fields?: { key: string }[] } }[] }).ops) {
          if (op.op === "type.create") types.set(op.type, (op.def?.fields ?? []).map((f) => f.key));
          if (op.op === "field.add") types.set(op.type, [...(types.get(op.type) ?? []), op.field!]);
        }
        return { applied: 1 };
      }
      throw new Error(`no ${cap}`);
    },
  });
  const hs = createSyncHandlers({ ...k.deps, ...(o.engine === false ? {} : { engine: fake }) });
  const ctx = wrap(k.ctx);
  const made = await k.hs["connections.create"](k.ctx, { connector: "acme", title: "Acme", ownerKind: "space", secrets: KEYS });
  return { k, calls, types, engine, engineOut, ctx, as: (a) => wrap(k.mk(a)), hs, connectionId: made.connection.connectionId };
}

const bind = (w: World, extra: Record<string, unknown> = {}) =>
  w.hs["sync_types.create"](w.ctx, { type: "contact", connectionId: w.connectionId, remote: "contacts", fields: MAP, match: ["email"], ...extra } as never);
const seedOutbox = (w: World, syncTypeId: string, id: string, status: string, op = "update", extra: Partial<{ attempts: number; error: string; at: number; idem: string }> = {}) =>
  w.k.tx.run(
    "INSERT INTO sy_outbox (outbox_id, sync_type, local_id, remote_id, op, fields, values_json, idem_key, status, attempts, error, created_at) VALUES (?, ?, 'rec_1', 'r1', ?, '[\"name\"]', '{}', ?, ?, ?, ?, ?)",
    id, syncTypeId, op, extra.idem ?? `${op}:r1:${id}`, status, extra.attempts ?? 0, extra.error ?? null, extra.at ?? NOW,
  );
const seedConflict = (w: World, syncTypeId: string, id: string, status = "open") =>
  w.k.tx.run("INSERT INTO sy_conflicts (conflict_id, sync_type, local_id, field, ours, theirs, base, rule, status, created_at) VALUES (?, ?, 'rec_1', 'name', '\"Ann\"', '\"Anna\"', '\"A\"', 'ask', ?, ?)", id, syncTypeId, status, NOW);

test("every capability this packet owns has a handler, here and in the loader entry", async () => {
  const reg = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as { capabilities: { name: string }[] };
  const want = reg.capabilities.map((c) => c.name).filter((n) => n.startsWith("sync_types.") || ["connectors.sync_now", "connectors.outbox.list", "connectors.outbox.retry", "connectors.outbox.cancel", "connectors.push"].includes(n));
  assert.equal(want.length, 21, `16 sync_types + sync_now + 3 outbox + push = 21, got ${want.length}`);
  const w = await world();
  for (const n of want) {
    assert.equal(typeof (w.hs as unknown as Record<string, unknown>)[n], "function", `${n} has a handler`);
    assert.equal(typeof (live as unknown as Record<string, unknown>)[n], "function", `${n} is exported to the loader`);
  }
});

test("helpers: remote names become record keys and types", () => {
  assert.equal(proposedKey("firstName"), "first_name");
  assert.equal(proposedKey("Phone Number"), "phone_number");
  assert.equal(proposedKey("2fa"), "f_2fa");
  assert.equal(proposedType("integer"), "number");
  assert.equal(proposedType("boolean"), "checkbox");
  assert.equal(proposedType("timestamp"), "datetime");
  assert.equal(proposedType("email"), "email");
  assert.equal(proposedType("picklist"), "choice");
  assert.equal(proposedType("string"), "text");
});

test("create binds a new record type: the type and its columns come from schema.apply, the defaults are filled, the event is announced", async () => {
  const w = await world();
  const { syncedType: s } = await bind(w);
  assert.match(s.syncTypeId, /^syt_[0-9a-f]+$/);
  assert.deepEqual({ type: s.type, connector: s.connector, remote: s.remote, state: s.state, match: s.match, createAtSource: s.createAtSource, deletes: s.deletes, conflict: s.conflict, nightlyReconcile: s.nightlyReconcile }, {
    type: "contact", connector: "acme", remote: "contacts", state: "initial", match: ["email"], createAtSource: false, deletes: "off", conflict: "newest", nightlyReconcile: true,
  });
  assert.deepEqual(s.polling, { activeSec: 60, idleSec: 300, dormantSec: 3600 });
  assert.deepEqual([s.pending, s.conflicts, s.schemaChanges], [0, 0, 0]);
  const apply = w.calls.find((c) => c.cap === "schema.apply")!;
  assert.equal(apply.input.ops.length, 1);
  assert.equal(apply.input.ops[0].op, "type.create");
  assert.deepEqual(apply.input.ops[0].def.fields.map((f: { key: string }) => f.key), ["name", "email", "phone"]);
  assert.equal(apply.input.ops[0].def.titleField, "name");
  assert.deepEqual(w.k.events2("sync.type_bound"), [{ syncTypeId: s.syncTypeId, type: "contact", connector: "acme" }]);
});

test("create on an existing type adds only the missing columns and keeps the ones that are there", async () => {
  const w = await world();
  w.types.set("contact", ["name", "email"]);
  await bind(w);
  const ops = w.calls.filter((c) => c.cap === "schema.apply").flatMap((c) => c.input.ops);
  assert.deepEqual(ops.map((o: { op: string; field: string }) => `${o.op}:${o.field}`), ["field.add:phone"]);
});

test("create keeps off fields out of the record type and takes every rule as given", async () => {
  const w = await world();
  const { syncedType: s } = await bind(w, {
    fields: [...MAP, { key: "secret_note", remote: "private", dir: "off" }], createAtSource: true, deletes: "soft", conflict: "ask", nightlyReconcile: false,
    polling: { activeSec: 30, idleSec: 60, dormantSec: 300 },
  });
  assert.deepEqual(w.types.get("contact"), ["name", "email", "phone"]);
  assert.equal(s.fields.length, 4);
  assert.deepEqual({ c: s.createAtSource, d: s.deletes, r: s.conflict, n: s.nightlyReconcile, p: s.polling }, { c: true, d: "soft", r: "ask", n: false, p: { activeSec: 30, idleSec: 60, dormantSec: 300 } });
});

test("create refuses what cannot work, and a refused create binds nothing", async () => {
  const w = await world();
  const bad = (extra: Record<string, unknown>, c: string) => assert.rejects(bind(w, extra), code(c));
  await bad({ fields: [] }, "validation.bad_input");
  await bad({ fields: [{ key: "Name", remote: "n", dir: "both" }] }, "validation.bad_input");
  await bad({ fields: [{ key: "name", remote: " ", dir: "both" }] }, "validation.bad_input");
  await bad({ fields: [{ key: "name", remote: "n", dir: "sideways" }] }, "validation.bad_input");
  await bad({ fields: [{ key: "name", remote: "a", dir: "both" }, { key: "name", remote: "b", dir: "both" }] }, "validation.bad_input");
  await bad({ fields: [{ key: "a", remote: "same", dir: "both" }, { key: "b", remote: "same", dir: "both" }] }, "validation.bad_input");
  await bad({ match: ["nope"] }, "validation.bad_input");
  await bad({ match: ["email", "email"] }, "validation.bad_input");
  await bad({ remote: "tickets" }, "validation.bad_input");
  await bad({ remote: " " }, "validation.bad_input");
  await bad({ deletes: "always" }, "validation.bad_input");
  await bad({ conflict: "coin" }, "validation.bad_input");
  await bad({ polling: { activeSec: 5, idleSec: 60, dormantSec: 300 } }, "validation.bad_input");
  await bad({ connectionId: "con_nope" }, "validation.not_found");
  assert.equal(w.k.tx.all("SELECT * FROM cn_synced_types").length, 0);
  assert.equal(w.calls.filter((c) => c.cap === "schema.apply").length, 0, "nothing reached the schema");
  await bind(w);
  await assert.rejects(bind(w), code("validation.duplicate"));
});

test("create waits for a usable connection", async () => {
  const w = await world();
  const pending = (await w.k.hs["connections.create"](w.k.ctx, { connector: "acme", title: "Pending", ownerKind: "space" })).connection.connectionId;
  await assert.rejects(bind(w, { connectionId: pending }), code("validation.precondition_failed"));
  await w.k.hs["connections.pause"](w.k.ctx, { connectionId: w.connectionId });
  await assert.rejects(bind(w), code("validation.precondition_failed"));
  await w.k.hs["connections.resume"](w.k.ctx, { connectionId: w.connectionId });
  w.k.tx.run("UPDATE cn_connections SET state = 'needs_reconnect' WHERE connection_id = ?", w.connectionId);
  await assert.rejects(bind(w), code("provider.auth_failed"));
});

test("a schema.apply refusal leaves nothing bound", async () => {
  const w = await world();
  const failing: ConnectorsCtx = { ...w.ctx, call: async (cap) => { if (cap === "schema.describe") return { types: [] }; throw Object.assign(new Error("no"), { error: { code: "permission.no_grant" } }); } };
  await assert.rejects(w.hs["sync_types.create"](failing, { type: "contact", connectionId: w.connectionId, remote: "contacts", fields: MAP, match: [] } as never), code("permission.no_grant"));
  assert.equal(w.k.tx.all("SELECT * FROM cn_synced_types").length, 0);
});

test("list, get and the state a person reads in the header", async () => {
  const w = await world();
  const { syncedType: a } = await bind(w);
  const { syncedType: b } = await bind(w, { type: "deal", remote: "deals", match: [] });
  const list = await w.hs["sync_types.list"](w.ctx, {});
  assert.deepEqual(list.syncedTypes.map((s) => s.type), ["contact", "deal"]);
  assert.equal(list.total, 2);
  const page = await w.hs["sync_types.list"](w.ctx, { limit: 1 });
  assert.equal(page.syncedTypes.length, 1);
  assert.equal(page.next, "1");
  assert.deepEqual((await w.hs["sync_types.list"](w.ctx, { cursor: page.next!, limit: 1 })).syncedTypes.map((s) => s.type), ["deal"]);
  assert.equal((await w.hs["sync_types.list"](w.ctx, { connector: "other" })).syncedTypes.length, 0);
  assert.equal((await w.hs["sync_types.get"](w.ctx, { type: "contact" })).syncedType.syncTypeId, a.syncTypeId);
  await assert.rejects(w.hs["sync_types.get"](w.ctx, { type: "nope" }), code("validation.not_found"));

  // initial before the first pass, syncing after it
  assert.equal(a.state, "initial");
  w.k.tx.run("INSERT INTO sy_state (sync_type, last_run_at) VALUES (?, ?)", a.syncTypeId, NOW - 5);
  let got = (await w.hs["sync_types.get"](w.ctx, { type: "contact" })).syncedType;
  assert.deepEqual([got.state, got.lastSyncAt], ["syncing", NOW - 5]);
  // counts of pushes waiting, conflicts and schema changes
  seedOutbox(w, a.syncTypeId, "obx_1", "pending");
  seedOutbox(w, a.syncTypeId, "obx_2", "failed");
  seedOutbox(w, a.syncTypeId, "obx_3", "done");
  seedConflict(w, a.syncTypeId, "cfl_1");
  seedConflict(w, a.syncTypeId, "cfl_2", "resolved");
  got = (await w.hs["sync_types.get"](w.ctx, { type: "contact" })).syncedType;
  assert.deepEqual([got.pending, got.conflicts], [2, 1]);
  // an error connection shows as error, schema changes as needs_review, a pause beats both
  w.k.tx.run("UPDATE cn_connections SET state = 'failing' WHERE connection_id = ?", w.connectionId);
  assert.equal((await w.hs["sync_types.get"](w.ctx, { type: "contact" })).syncedType.state, "error");
  noteSchemaChanges(w.k.deps, w.ctx, "contact", [{ changeKey: "k1", kind: "field_added", remote: "nickname", summary: "New field nickname" }]);
  got = (await w.hs["sync_types.get"](w.ctx, { type: "contact" })).syncedType;
  assert.deepEqual([got.state, got.schemaChanges], ["needs_review", 1]);
  await w.hs["sync_types.pause"](w.ctx, { type: "contact" });
  assert.equal((await w.hs["sync_types.get"](w.ctx, { type: "contact" })).syncedType.state, "paused");
  assert.equal((await w.hs["sync_types.get"](w.ctx, { type: "deal" })).syncedType.syncTypeId, b.syncTypeId);
});

test("a person's own connection keeps its synced types from everyone else", async () => {
  const w = await world();
  w.k.install({ ...SYNC_ACME, key: "mine", scope: "person" });
  const mine = (await w.k.hs["connections.create"](w.k.ctx, { connector: "mine", title: "Mine", ownerKind: "person", secrets: KEYS })).connection.connectionId;
  await bind(w, { connectionId: mine });
  assert.equal((await w.hs["sync_types.list"](w.ctx, {})).syncedTypes.length, 1);
  const other = w.as("usr_omar");
  assert.equal((await w.hs["sync_types.list"](other, {})).syncedTypes.length, 0);
  await assert.rejects(w.hs["sync_types.get"](other, { type: "contact" }), code("validation.not_found"));
  await assert.rejects(w.hs["sync_types.pause"](other, { type: "contact" }), code("validation.not_found"));
  await assert.rejects(w.hs["connectors.sync_now"](other, { type: "contact" }), code("validation.not_found"));
  await assert.rejects(w.hs["sync_types.discover"](other, { connectionId: mine }), code("validation.not_found"));
  await assert.rejects(bind({ ...w, ctx: other }, { type: "other", connectionId: mine }), code("validation.not_found"));
  const syt = (await w.hs["sync_types.get"](w.ctx, { type: "contact" })).syncedType.syncTypeId;
  seedOutbox(w, syt, "obx_1", "failed");
  assert.deepEqual((await w.hs["connectors.outbox.list"](other, {})).items, []);
  await assert.rejects(w.hs["connectors.outbox.retry"](other, { outboxId: "obx_1" }), code("validation.not_found"));
});

test("discover lists the app's objects and fields with a proposed record type, and flags sensitive fields", async () => {
  const w = await world();
  w.k.state.reply = (req) => {
    assert.match(req.url, /^https:\/\/api\.acme\.test\/v1\/schema/);
    return { status: 200, body: { objects: [
      { remote: "contacts", title: "Contacts", fields: [{ remote: "firstName", type: "string" }, { remote: "age", type: "integer" }, { remote: "social_security_number", type: "string" }, { remote: "isVip", type: "boolean" }] },
      { remote: "deals", fields: [{ remote: "closed_at", type: "timestamp" }] }, { title: "no name" },
    ] } };
  };
  const all = await w.hs["sync_types.discover"](w.ctx, { connectionId: w.connectionId });
  assert.deepEqual(all.objects.map((o) => [o.remote, o.title]), [["contacts", "Contacts"], ["deals", "deals"]]);
  assert.deepEqual(all.objects[0]!.fields.map((f) => [f.proposedKey, f.proposedType, f.sensitive]), [["first_name", "text", false], ["age", "number", false], ["social_security_number", "text", true], ["is_vip", "checkbox", false]]);
  assert.equal(all.objects[1]!.fields[0]!.proposedType, "datetime");
  assert.deepEqual((await w.hs["sync_types.discover"](w.ctx, { connectionId: w.connectionId, remote: "deals" })).objects.map((o) => o.remote), ["deals"]);
  assert.equal(w.k.sent.every((s) => !s.url.includes("SECRET")), true);
});

test("discover needs a connector that can list its objects, and a usable connection", async () => {
  const w = await world();
  w.k.install({ ...SYNC_ACME, key: "plain", actions: ACME.actions });
  const plain = (await w.k.hs["connections.create"](w.k.ctx, { connector: "plain", title: "Plain", ownerKind: "space", secrets: KEYS })).connection.connectionId;
  await assert.rejects(w.hs["sync_types.discover"](w.ctx, { connectionId: plain }), code("validation.unsupported"));
  await assert.rejects(w.hs["sync_types.discover"](w.ctx, { connectionId: "con_nope" }), code("validation.not_found"));
  await w.k.hs["connections.pause"](w.k.ctx, { connectionId: w.connectionId });
  await assert.rejects(w.hs["sync_types.discover"](w.ctx, { connectionId: w.connectionId }), code("validation.precondition_failed"));
});

test("update changes directions, rules and polling, adds a column for a new field, and says what changed", async () => {
  const w = await world();
  await bind(w);
  w.k.events.length = 0;
  const fields = [...MAP, { key: "city", remote: "town", dir: "push" as const, transform: "upper(value)" }];
  const { syncedType: s } = await w.hs["sync_types.update"](w.ctx, { type: "contact", fields, conflict: "ask", deletes: "travel", createAtSource: true, polling: { activeSec: 45, idleSec: 90, dormantSec: 600 } });
  assert.equal(s.fields.at(-1)!.transform, "upper(value)");
  assert.deepEqual([s.conflict, s.deletes, s.createAtSource, s.polling.activeSec], ["ask", "travel", true, 45]);
  assert.deepEqual(w.types.get("contact"), ["name", "email", "phone", "city"]);
  assert.deepEqual(w.k.events2("sync.type_updated")[0]!["fields"], ["fields", "createAtSource", "deletes", "conflict", "polling"]);
  // an update that changes nothing says nothing
  w.k.events.length = 0;
  await w.hs["sync_types.update"](w.ctx, { type: "contact", conflict: "ask" });
  assert.equal(w.k.events2("sync.type_updated").length, 0);
  // a field turned off keeps its column, a bad mapping is refused whole
  await w.hs["sync_types.update"](w.ctx, { type: "contact", fields: fields.map((f) => (f.key === "phone" ? { ...f, dir: "off" as const } : f)) });
  assert.deepEqual(w.types.get("contact"), ["name", "email", "phone", "city"]);
  await assert.rejects(w.hs["sync_types.update"](w.ctx, { type: "contact", match: ["ghost"] }), code("validation.bad_input"));
  await assert.rejects(w.hs["sync_types.update"](w.ctx, { type: "contact", conflict: "coin" as never }), code("validation.bad_input"));
  await assert.rejects(w.hs["sync_types.update"](w.ctx, { type: "nope" }), code("validation.not_found"));
  assert.equal((await w.hs["sync_types.get"](w.ctx, { type: "contact" })).syncedType.conflict, "ask");
});

test("pause and resume announce once, and a paused type refuses a real sync but allows a dry run", async () => {
  const w = await world();
  const { syncedType: s } = await bind(w);
  assert.deepEqual(await w.hs["sync_types.pause"](w.ctx, { type: "contact" }), { ok: true });
  assert.deepEqual(await w.hs["sync_types.pause"](w.ctx, { type: "contact" }), { ok: true });
  assert.deepEqual(w.k.events2("sync.type_paused"), [{ syncTypeId: s.syncTypeId }]);
  await assert.rejects(w.hs["connectors.sync_now"](w.ctx, { type: "contact" }), code("validation.precondition_failed"));
  await w.hs["connectors.sync_now"](w.ctx, { type: "contact", mode: "dry_run" });
  await w.hs["sync_types.resume"](w.ctx, { type: "contact" });
  await w.hs["sync_types.resume"](w.ctx, { type: "contact" });
  assert.deepEqual(w.k.events2("sync.type_resumed"), [{ syncTypeId: s.syncTypeId }]);
  await w.hs["connectors.sync_now"](w.ctx, { type: "contact" });
});

test("preview is the engine's dry run for the type, with the direction asked for", async () => {
  const w = await world();
  await bind(w);
  const out = await w.hs["sync_types.preview"](w.ctx, { type: "contact", direction: "push" });
  assert.equal(out.summary, "Will update 34 records in Acme");
  assert.deepEqual(w.engine["preview"], [["contact", { direction: "push" }]]);
  await w.hs["sync_types.preview"](w.ctx, { type: "contact" });
  assert.deepEqual(w.engine["preview"]![1], ["contact", {}]);
  await assert.rejects(w.hs["sync_types.preview"](w.ctx, { type: "nope" }), code("validation.not_found"));
});

test("log is newest first, paged, and empty before the first pass", async () => {
  const w = await world();
  const { syncedType: s } = await bind(w);
  assert.deepEqual(await w.hs["sync_types.log"](w.ctx, { type: "contact" }), { entries: [], total: 0 });
  const add = (at: number, kind: string, summary: string, run: string | null, trace: string | null) =>
    w.k.tx.run("INSERT INTO sy_log (sync_type, at, kind, summary, run_id, trace_id) VALUES (?, ?, ?, ?, ?, ?)", s.syncTypeId, at, kind, summary, run, trace);
  add(NOW - 30, "pull", "2 created, 1 updated here", "run_1", "tr_1");
  add(NOW - 20, "push", "0 created, 3 updated, 0 removed in Acme", "run_1", null);
  add(NOW - 10, "conflict", "name changed on both sides", null, null);
  w.k.tx.run("INSERT INTO sy_log (sync_type, at, kind, summary) VALUES ('syt_other', ?, 'pull', 'not mine')", NOW);
  const all = await w.hs["sync_types.log"](w.ctx, { type: "contact" });
  assert.deepEqual(all.entries.map((e) => e.kind), ["conflict", "push", "pull"]);
  assert.deepEqual(all.entries[2], { at: NOW - 30, kind: "pull", summary: "2 created, 1 updated here", runId: "run_1", traceId: "tr_1" });
  assert.deepEqual(all.entries[0], { at: NOW - 10, kind: "conflict", summary: "name changed on both sides" });
  assert.equal(all.total, 3);
  const p1 = await w.hs["sync_types.log"](w.ctx, { type: "contact", limit: 2 });
  assert.deepEqual([p1.entries.length, p1.next], [2, "2"]);
  assert.deepEqual((await w.hs["sync_types.log"](w.ctx, { type: "contact", cursor: "2", limit: 2 })).entries.map((e) => e.kind), ["pull"]);
});

const CHANGES: SchemaChange[] = [
  { changeKey: "add:nickname", kind: "field_added", remote: "nickname", summary: "New field nickname", fieldType: "text" },
  { changeKey: "drop:phone_number", kind: "field_removed", remote: "phone_number", summary: "phone_number was removed" },
  { changeKey: "retype:full_name", kind: "field_retyped", remote: "full_name", summary: "full_name is now rich text", fieldType: "longtext" },
  { changeKey: "gone:contacts", kind: "object_removed", remote: "contacts", summary: "contacts was removed" },
];

test("schema changes wait for review: the engine host notes them, a person reads them, accepted ones go through schema.apply", async () => {
  const w = await world();
  await bind(w);
  assert.equal(noteSchemaChanges(w.k.deps, w.ctx, "contact", CHANGES), 4);
  assert.equal(noteSchemaChanges(w.k.deps, w.ctx, "contact", [CHANGES[0]!]), 4, "a change already waiting is not doubled");
  assert.deepEqual(w.k.events2("sync.schema_changed"), [{ syncTypeId: (await w.hs["sync_types.get"](w.ctx, { type: "contact" })).syncedType.syncTypeId, type: "contact", changes: 4 }]);
  assert.equal(noteSchemaChanges(w.k.deps, w.ctx, "unknown", CHANGES), 0);
  const waiting = await w.hs["sync_types.schema_changes"](w.ctx, { type: "contact" });
  assert.deepEqual(waiting.changes.map((c) => c.changeKey), ["add:nickname", "drop:phone_number", "retype:full_name", "gone:contacts"]);
  assert.deepEqual(Object.keys(waiting.changes[0]!).sort(), ["changeKey", "kind", "remote", "summary"]);

  w.calls.length = 0;
  w.k.events.length = 0;
  assert.deepEqual(await w.hs["sync_types.review_schema"](w.ctx, { type: "contact", accept: ["add:nickname", "drop:phone_number", "retype:full_name"], ignore: [] }), { accepted: 3, ignored: 0 });
  const ops = w.calls.filter((c) => c.cap === "schema.apply").flatMap((c) => c.input.ops);
  assert.deepEqual(ops.map((o: { op: string; field: string; toType?: string }) => `${o.op}:${o.field}:${o.toType ?? ""}`), ["field.add:nickname:", "field.retype:name:longtext"]);
  const s = (await w.hs["sync_types.get"](w.ctx, { type: "contact" })).syncedType;
  assert.equal(s.fields.find((f) => f.remote === "nickname")!.dir, "pull");
  assert.equal(s.fields.find((f) => f.remote === "phone_number")!.dir, "off");
  assert.deepEqual([s.schemaChanges, s.state], [1, "needs_review"]);
  assert.equal(w.k.events2("sync.type_updated").length, 1);

  // ignoring the last one clears the review; accepting a removed object pauses sync
  assert.deepEqual(await w.hs["sync_types.review_schema"](w.ctx, { type: "contact", accept: [], ignore: ["gone:contacts"] }), { accepted: 0, ignored: 1 });
  assert.equal((await w.hs["sync_types.get"](w.ctx, { type: "contact" })).syncedType.state, "initial");
  noteSchemaChanges(w.k.deps, w.ctx, "contact", [CHANGES[3]!]);
  await w.hs["sync_types.review_schema"](w.ctx, { type: "contact", accept: ["gone:contacts"], ignore: [] });
  assert.equal((await w.hs["sync_types.get"](w.ctx, { type: "contact" })).syncedType.state, "paused");
});

test("review refuses a change that is not waiting, one decided twice, and a new field that clashes", async () => {
  const w = await world();
  await bind(w);
  noteSchemaChanges(w.k.deps, w.ctx, "contact", [CHANGES[0]!, { changeKey: "add:name", kind: "field_added", remote: "name", summary: "New field name", key: "name" }]);
  await assert.rejects(w.hs["sync_types.review_schema"](w.ctx, { type: "contact", accept: ["add:ghost"], ignore: [] }), code("validation.bad_input"));
  await assert.rejects(w.hs["sync_types.review_schema"](w.ctx, { type: "contact", accept: ["add:nickname"], ignore: ["add:nickname"] }), code("validation.bad_input"));
  await assert.rejects(w.hs["sync_types.review_schema"](w.ctx, { type: "contact", accept: ["add:name"], ignore: [] }), code("validation.duplicate"));
  assert.equal((await w.hs["sync_types.schema_changes"](w.ctx, { type: "contact" })).changes.length, 2, "a refused review changes nothing");
});

test("confirm_deletes hands the decision to the engine, and only when a pass is waiting", async () => {
  const w = await world();
  const { syncedType: s } = await bind(w);
  await assert.rejects(w.hs["sync_types.confirm_deletes"](w.ctx, { type: "contact", decision: "keep" }), code("validation.precondition_failed"));
  w.k.tx.run("INSERT INTO sy_state (sync_type, pending_deletes) VALUES (?, '[\"a\",\"b\",\"c\"]')", s.syncTypeId);
  await assert.rejects(w.hs["sync_types.confirm_deletes"](w.ctx, { type: "contact", decision: "maybe" as never }), code("validation.bad_input"));
  assert.deepEqual(await w.hs["sync_types.confirm_deletes"](w.ctx, { type: "contact", decision: "mark_removed" }), { removed: 3 });
  assert.deepEqual(await w.hs["sync_types.confirm_deletes"](w.ctx, { type: "contact", decision: "keep" }), { removed: 0 });
  assert.deepEqual(w.engine["confirmDeletes"], [["contact", "mark_removed"], ["contact", "keep"]]);
});

test("make_native detaches the binding, keeps the links, cancels unsent pushes and closes open conflicts", async () => {
  const w = await world();
  const { syncedType: s } = await bind(w);
  w.k.tx.run("INSERT INTO sy_links (sync_type, local_id, remote_id, base) VALUES (?, 'rec_1', 'r1', '{}')", s.syncTypeId);
  seedOutbox(w, s.syncTypeId, "obx_1", "pending");
  seedOutbox(w, s.syncTypeId, "obx_2", "failed");
  seedOutbox(w, s.syncTypeId, "obx_3", "done");
  seedConflict(w, s.syncTypeId, "cfl_1");
  assert.deepEqual(await w.hs["sync_types.make_native"](w.ctx, { type: "contact" }), { ok: true });
  assert.deepEqual(w.k.events2("sync.type_native"), [{ syncTypeId: s.syncTypeId, type: "contact" }]);
  await assert.rejects(w.hs["sync_types.get"](w.ctx, { type: "contact" }), code("validation.not_found"));
  assert.equal(w.k.tx.all("SELECT * FROM sy_links").length, 1, "record ids, history and attribution stay");
  assert.deepEqual(w.k.tx.all<{ status: string }>("SELECT status FROM sy_outbox ORDER BY outbox_id").map((r) => r.status), ["canceled", "canceled", "done"]);
  assert.equal(w.k.tx.get<{ status: string }>("SELECT status FROM sy_conflicts")!.status, "closed");
  await assert.rejects(w.hs["sync_types.make_native"](w.ctx, { type: "contact" }), code("validation.not_found"));
  await bind(w);
});

test("a conflict is settled by the engine, once, with the answer the person gave", async () => {
  const w = await world();
  const { syncedType: s } = await bind(w);
  seedConflict(w, s.syncTypeId, "cfl_1");
  seedConflict(w, s.syncTypeId, "cfl_done", "resolved");
  await assert.rejects(w.hs["sync_types.resolve_conflict"](w.ctx, { conflictId: "cfl_nope", resolution: "ours" }), code("validation.not_found"));
  await assert.rejects(w.hs["sync_types.resolve_conflict"](w.ctx, { conflictId: "cfl_done", resolution: "ours" }), code("validation.precondition_failed"));
  await assert.rejects(w.hs["sync_types.resolve_conflict"](w.ctx, { conflictId: "cfl_1", resolution: "value" }), code("validation.bad_input"));
  assert.deepEqual(await w.hs["sync_types.resolve_conflict"](w.ctx, { conflictId: "cfl_1", resolution: "value", value: "Anne" }), { recordId: "rec_1" });
  assert.deepEqual(w.engine["resolveConflict"], [["contact", "cfl_1", "value", "Anne"]]);
  assert.deepEqual((await w.hs["sync_types.replay_conflict"](w.ctx, { conflictId: "cfl_1" })).results, [{ rule: "source", value: "theirs" }, { rule: "vyre", value: "ours" }]);
  await assert.rejects(w.hs["sync_types.replay_conflict"](w.ctx, { conflictId: "cfl_nope" }), code("validation.not_found"));
});

test("undo_push reverses a push that went out, and says why when it cannot", async () => {
  const w = await world();
  const { syncedType: s } = await bind(w);
  seedOutbox(w, s.syncTypeId, "obx_sent", "done");
  seedOutbox(w, s.syncTypeId, "obx_wait", "pending");
  seedOutbox(w, s.syncTypeId, "obx_undone", "undone");
  assert.deepEqual(await w.hs["sync_types.undo_push"](w.ctx, { outboxId: "obx_sent" }), { ok: true });
  assert.deepEqual(w.engine["undoPush"], [["contact", "obx_sent"]]);
  await assert.rejects(w.hs["sync_types.undo_push"](w.ctx, { outboxId: "obx_wait" }), code("validation.precondition_failed"));
  await assert.rejects(w.hs["sync_types.undo_push"](w.ctx, { outboxId: "obx_undone" }), code("validation.precondition_failed"));
  await assert.rejects(w.hs["sync_types.undo_push"](w.ctx, { outboxId: "obx_nope" }), code("validation.not_found"));
  w.engineOut["undoPush"] = { undone: false, reason: "the remote record changed since the push" };
  await assert.rejects(w.hs["sync_types.undo_push"](w.ctx, { outboxId: "obx_sent" }), (e: unknown) => {
    assert.equal((e as { error: { code: string } }).error.code, "validation.precondition_failed");
    assert.match((e as { error: { message: string } }).error.message, /changed since the push/);
    return true;
  });
});

test("sync_now starts a Run for a type, a binding id or every type on a connection, and keeps what was asked for", async () => {
  const w = await world();
  const { syncedType: a } = await bind(w);
  const { syncedType: b } = await bind(w, { type: "deal", remote: "deals", match: [] });
  const r1 = await w.hs["connectors.sync_now"](w.ctx, { type: "contact" });
  assert.deepEqual(r1, { runId: "run_1" });
  const start = w.calls.find((c) => c.cap === "runs.start")!;
  assert.deepEqual({ kind: start.input.kind, owner: start.input.owner, subject: start.input.subject }, { kind: "connector_sync", owner: "usr_dana", subject: { type: "record_type", id: "contact" } });
  assert.deepEqual(syncRequest(w.k.deps, "run_1"), { syncTypeIds: [a.syncTypeId], mode: "incremental", runAutomations: false });
  await w.hs["connectors.sync_now"](w.ctx, { syncTypeId: b.syncTypeId, mode: "backfill", runAutomations: true });
  assert.deepEqual(syncRequest(w.k.deps, "run_2"), { syncTypeIds: [b.syncTypeId], mode: "backfill", runAutomations: true });
  await w.hs["connectors.sync_now"](w.ctx, { connectionId: w.connectionId, mode: "reconcile" });
  assert.deepEqual(syncRequest(w.k.deps, "run_3"), { syncTypeIds: [a.syncTypeId, b.syncTypeId], mode: "reconcile", runAutomations: false });
  assert.deepEqual(w.calls.filter((c) => c.cap === "runs.start")[2]!.input.subject, { type: "connection", id: w.connectionId });
  await w.hs["connectors.sync_now"](w.ctx, { type: "contact", mode: "dry_run" });
  assert.equal(syncRequest(w.k.deps, "run_4")!.mode, "dry_run");
  assert.equal(syncRequest(w.k.deps, "run_none"), undefined);
});

test("sync_now refuses what cannot run and starts nothing", async () => {
  const w = await world();
  const { syncedType: a } = await bind(w);
  const none = (extra: Record<string, unknown>, c: string) => assert.rejects(w.hs["connectors.sync_now"](w.ctx, extra as never), code(c));
  await none({}, "validation.bad_input");
  await none({ type: "contact", connectionId: w.connectionId }, "validation.bad_input");
  await none({ type: "contact", mode: "sideways" }, "validation.bad_input");
  await none({ type: "nope" }, "validation.not_found");
  await none({ syncTypeId: "syt_nope" }, "validation.not_found");
  await none({ connectionId: "con_nope" }, "validation.not_found");
  const empty = (await w.k.hs["connections.create"](w.k.ctx, { connector: "acme", title: "Empty", ownerKind: "space", secrets: KEYS })).connection.connectionId;
  await none({ connectionId: empty }, "validation.not_found");
  await w.k.hs["connections.pause"](w.k.ctx, { connectionId: w.connectionId });
  await none({ type: "contact" }, "validation.precondition_failed");
  await w.k.hs["connections.resume"](w.k.ctx, { connectionId: w.connectionId });
  w.k.tx.run("DELETE FROM cn_connections WHERE connection_id = ?", w.connectionId);
  await none({ syncTypeId: a.syncTypeId }, "validation.precondition_failed");
  assert.equal(w.calls.filter((c) => c.cap === "runs.start").length, 0);
});

test("the outbox lists pushes with their keys, in the manifest's words, newest first, filtered and paged", async () => {
  const w = await world();
  const { syncedType: a } = await bind(w);
  const { syncedType: b } = await bind(w, { type: "deal", remote: "deals", match: [] });
  seedOutbox(w, a.syncTypeId, "obx_1", "done", "update", { at: NOW - 30 });
  seedOutbox(w, a.syncTypeId, "obx_2", "failed", "remove", { at: NOW - 20, attempts: 3, error: "429 slow down" });
  seedOutbox(w, b.syncTypeId, "obx_3", "pending", "create", { at: NOW - 10 });
  const all = await w.hs["connectors.outbox.list"](w.ctx, {});
  assert.deepEqual(all.items.map((i) => i.outboxId), ["obx_3", "obx_2", "obx_1"]);
  assert.deepEqual(all.items[1], { outboxId: "obx_2", syncTypeId: a.syncTypeId, recordId: "rec_1", op: "delete", fields: ["name"], state: "failed", attempts: 3, idempotencyKey: "remove:r1:obx_2", error: "429 slow down", at: NOW - 20 });
  assert.equal(all.items[2]!.state, "sent", "the engine's done is a sent push");
  assert.equal(all.total, 3);
  assert.deepEqual((await w.hs["connectors.outbox.list"](w.ctx, { type: "deal" })).items.map((i) => i.outboxId), ["obx_3"]);
  assert.deepEqual((await w.hs["connectors.outbox.list"](w.ctx, { state: "sent" })).items.map((i) => i.outboxId), ["obx_1"]);
  assert.deepEqual((await w.hs["connectors.outbox.list"](w.ctx, { state: "failed" })).items.map((i) => i.outboxId), ["obx_2"]);
  const p = await w.hs["connectors.outbox.list"](w.ctx, { limit: 2 });
  assert.deepEqual([p.items.length, p.next], [2, "2"]);
  await assert.rejects(w.hs["connectors.outbox.list"](w.ctx, { state: "lost" as never }), code("validation.bad_input"));
  await assert.rejects(w.hs["connectors.outbox.list"](w.ctx, { type: "nope" }), code("validation.not_found"));
});

test("retry puts a failed push back and tries it now; cancel stops one that has not gone out", async () => {
  const w = await world();
  const { syncedType: a } = await bind(w);
  seedOutbox(w, a.syncTypeId, "obx_f", "failed", "update", { attempts: 3, error: "boom" });
  seedOutbox(w, a.syncTypeId, "obx_p", "pending");
  seedOutbox(w, a.syncTypeId, "obx_d", "done");
  assert.deepEqual(await w.hs["connectors.outbox.retry"](w.ctx, { outboxId: "obx_f" }), { ok: true });
  assert.deepEqual(w.k.tx.get<{ status: string; attempts: number; error: string | null }>("SELECT status, attempts, error FROM sy_outbox WHERE outbox_id = 'obx_f'"), { status: "pending", attempts: 0, error: null });
  assert.deepEqual(w.engine["push"], [["contact", "obx_f"]]);
  assert.deepEqual(await w.hs["connectors.outbox.retry"](w.ctx, { outboxId: "obx_p" }), { ok: true }, "already waiting");
  assert.equal(w.engine["push"]!.length, 1);
  await assert.rejects(w.hs["connectors.outbox.retry"](w.ctx, { outboxId: "obx_d" }), code("validation.precondition_failed"));
  await assert.rejects(w.hs["connectors.outbox.retry"](w.ctx, { outboxId: "obx_nope" }), code("validation.not_found"));

  assert.deepEqual(await w.hs["connectors.outbox.cancel"](w.ctx, { outboxId: "obx_p" }), { ok: true });
  assert.deepEqual(await w.hs["connectors.outbox.cancel"](w.ctx, { outboxId: "obx_p" }), { ok: true });
  assert.equal(w.k.tx.get<{ status: string }>("SELECT status FROM sy_outbox WHERE outbox_id = 'obx_p'")!.status, "canceled");
  await assert.rejects(w.hs["connectors.outbox.cancel"](w.ctx, { outboxId: "obx_d" }), code("validation.precondition_failed"));
  await assert.rejects(w.hs["connectors.outbox.cancel"](w.ctx, { outboxId: "obx_nope" }), code("validation.not_found"));
});

test("retry still requeues when no engine is wired; the next pass sends it", async () => {
  const w = await world({ engine: false });
  const { syncedType: a } = await bind(w);
  seedOutbox(w, a.syncTypeId, "obx_f", "failed");
  assert.deepEqual(await w.hs["connectors.outbox.retry"](w.ctx, { outboxId: "obx_f" }), { ok: true });
  assert.equal(w.k.tx.get<{ status: string }>("SELECT status FROM sy_outbox WHERE outbox_id = 'obx_f'")!.status, "pending");
});

test("push writes one outbox item through the engine, and answers for items already sent or stopped", async () => {
  const w = await world();
  const { syncedType: a } = await bind(w);
  seedOutbox(w, a.syncTypeId, "obx_p", "pending");
  seedOutbox(w, a.syncTypeId, "obx_d", "done");
  seedOutbox(w, a.syncTypeId, "obx_c", "canceled");
  assert.deepEqual(await w.hs["connectors.push"](w.ctx, { outboxId: "obx_p" }), { state: "sent" });
  w.engineOut["push"] = { state: "failed", error: "429" };
  assert.deepEqual(await w.hs["connectors.push"](w.ctx, { outboxId: "obx_p" }), { state: "failed", error: "429" });
  assert.deepEqual(await w.hs["connectors.push"](w.ctx, { outboxId: "obx_d" }), { state: "sent" });
  assert.equal(w.engine["push"]!.length, 2, "a sent item is not sent twice");
  await assert.rejects(w.hs["connectors.push"](w.ctx, { outboxId: "obx_c" }), code("validation.precondition_failed"));
  await assert.rejects(w.hs["connectors.push"](w.ctx, { outboxId: "obx_nope" }), code("validation.not_found"));
  await w.k.hs["connections.pause"](w.k.ctx, { connectionId: w.connectionId });
  await assert.rejects(w.hs["connectors.push"](w.ctx, { outboxId: "obx_p" }), code("validation.precondition_failed"));
});

test("without a sync engine, what needs one refuses plainly and the rest works", async () => {
  const w = await world({ engine: false });
  const { syncedType: a } = await bind(w);
  w.k.tx.run("INSERT INTO sy_state (sync_type, pending_deletes) VALUES (?, '[\"a\"]')", a.syncTypeId);
  seedOutbox(w, a.syncTypeId, "obx_d", "done");
  seedOutbox(w, a.syncTypeId, "obx_p", "pending");
  seedConflict(w, a.syncTypeId, "cfl_1");
  const unavailable = (p: Promise<unknown>) => assert.rejects(p, code("internal.unavailable"));
  await unavailable(w.hs["sync_types.preview"](w.ctx, { type: "contact" }));
  await unavailable(w.hs["sync_types.confirm_deletes"](w.ctx, { type: "contact", decision: "keep" }));
  await unavailable(w.hs["sync_types.resolve_conflict"](w.ctx, { conflictId: "cfl_1", resolution: "ours" }));
  await unavailable(w.hs["sync_types.replay_conflict"](w.ctx, { conflictId: "cfl_1" }));
  await unavailable(w.hs["sync_types.undo_push"](w.ctx, { outboxId: "obx_d" }));
  await unavailable(w.hs["connectors.push"](w.ctx, { outboxId: "obx_p" }));
  assert.equal((await w.hs["connectors.sync_now"](w.ctx, { type: "contact" })).runId, "run_1");
  assert.equal((await w.hs["connectors.outbox.list"](w.ctx, {})).items.length, 2);
});

test("the loader entry runs the same handlers", async () => {
  const out = await (live["sync_types.list"] as unknown as (c: never, i: never) => Promise<{ syncedTypes: unknown[] }>)({ trace: { traceId: "0123456789abcdef0123456789abcdef" }, emit: () => undefined, call: async () => ({}), http: async () => ({ status: 200, text: async () => "{}" }) } as never, {} as never);
  assert.deepEqual(out.syncedTypes, []);
});

test("no secret value reaches the synced type tables or their events", async () => {
  const w = await world();
  w.k.state.reply = () => ({ status: 200, body: { objects: [{ remote: "contacts", fields: [{ remote: "name", type: "string" }] }] } });
  await w.hs["sync_types.discover"](w.ctx, { connectionId: w.connectionId });
  await bind(w);
  const blob = JSON.stringify([w.k.tx.all("SELECT * FROM cn_synced_types"), w.k.tx.all("SELECT * FROM cn_sync_requests"), w.k.events, w.calls]);
  assert.equal(blob.includes("sk_live_SECRET123"), false);
  assert.equal(blob.includes("whsec_HOOKVALUE9"), false);
});

