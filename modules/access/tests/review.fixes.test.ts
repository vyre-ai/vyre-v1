// The review of #905 (team/v1/SCALE-REVIEW-2026-11-11.md), findings 1 to 5, on a real SQLite file with every migration and the host's own db handles.
//   1  the store skips events at or below its cursor: the host hands them over in the log's order (host/tests/access.batch.test.ts); folded in order, a restart replays the same state
//   2  the sync writes only tables the write counter watches, and every table persist and persistResources write has its three triggers
//   3  a seed whose write failed is answered once and never kept
//   4  the snapshot holds copies of a store's role permissions and grant conditions, and the kept store's records cannot be edited
//   5  a boot-time registration (seq -1) makes a missing resource and never resets the label or owner of one that exists
import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../../../host/src/daemon/sqlite.ts";
import { authorize } from "../../../kernel/src/authorize/index.ts";
import type { AccessSnapshot } from "../../../kernel/src/authorize/index.ts";
import { TRIGGERED, mustBeTriggered, syncCounts } from "../consumers.ts";
import type { LogEvent } from "../consumers.ts";
import { AccessStore, loadStore, readOnly, storeOf } from "../projections.ts";
import type { Db } from "../projections.ts";
import { NOW, SPACE, ctxOf, fresh, setLabel, sync, transfer } from "../fixtures/incremental.ts";

const res = (seq: number, id: string, type: string, parent: string | null, label = 0, owner = "usr_owner"): LogEvent => ({ seq, type: "resource.created", payload: { id, type, parent_id: parent, label, owner_id: owner, holds: 0 } });
const person = (seq: number, id: string): LogEvent => ({ seq, type: "principal.created", payload: { id, kind: "person", name: id.slice(4), status: "active" } });

test("1 folded in the log's order, a suspension below a new record is applied, a restart replays the same state, and a repeat changes nothing", () => {
  const { file, db: raw } = fresh("order");
  const log: LogEvent[] = [res(1, SPACE, "space", null), person(2, "usr_owner"), person(3, "usr_sam"), { seq: 4, type: "principal.role_set", payload: { holder: "usr_sam", role: "rol_member" } }];
  sync(ctxOf(raw), { events: log });
  const later: LogEvent[] = [{ seq: 41, type: "principal.suspended", payload: { principalId: "usr_sam" } }, res(42, "rec_1", "record", SPACE)];
  log.push(...later);
  const snap = sync(ctxOf(raw), { events: later });
  assert.equal(snap.principal("usr_sam")?.status, "suspended");
  assert.equal(authorize(snap, { principal: "usr_sam", action: { perm: null, level: "view" }, resource: { type: "record", id: "rec_1" }, now: NOW }).effect, "deny");
  // the same events again (a retry): nothing changes
  const again = sync(ctxOf(raw), { events: later });
  assert.equal(again.principal("usr_sam")?.status, "suspended");
  raw.close();
  const back = openDb(file);
  const replayed = sync(ctxOf(back), { events: log });
  assert.equal(replayed.principal("usr_sam")?.status, "suspended", "after a restart");
  assert.ok(replayed.resource("rec_1"));
  back.close();
});

test("1b the contract the host keeps: an event handed over below the cursor is skipped (which is why accessBatch reads the log in order)", () => {
  const { db: raw } = fresh("contract");
  sync(ctxOf(raw), { events: [res(1, SPACE, "space", null), person(2, "usr_sam")] });
  sync(ctxOf(raw), { events: [res(42, "rec_1", "record", SPACE)] });
  const late = sync(ctxOf(raw), { events: [{ seq: 41, type: "principal.suspended", payload: { principalId: "usr_sam" } }] });
  assert.equal(late.principal("usr_sam")?.status, "active", "push order [42] then [41] loses 41: the host must never hand over that way");
  raw.close();
});

test("2 the sync writes only triggered tables, and every table seed, persist and persistResources write has its three triggers", () => {
  const { db: raw } = fresh("written");
  const written = new Set<string>();
  const spy: Db = { all: (sql, ...a) => raw.all(sql, ...a), run: (sql, ...a) => { const m = /(?:INTO|FROM|UPDATE)\s+"?([A-Za-z0-9_]+)/i.exec(sql); if (m) written.add(m[1]!); return raw.run(sql, ...a); } };
  const store = loadStore(spy);   // seed and its persist
  store.principals.set("usr_x", { id: "usr_x", kind: "person", name: "X", status: "active", createdAt: 1 });
  store.setRoles("usr_x", ["rol_member"]);
  store.grants.set("gr_x", { id: "gr_x", subject: { kind: "person", id: "usr_x" }, resource: { type: "space", id: SPACE }, level: "view", conditions: {}, by: "usr_x", createdAt: 1 });
  store.roleChanges.set("rol_member", { before: [], after: [], by: { kind: "person", id: "usr_x" }, at: 1 });
  store.actors.set("act_x", { id: "act_x", provider: "p", status: "active", engineerMcp: false });
  store.fieldLabels.set("contact.email", 2);
  store.fieldLabels.set("seed_cursor", 7);
  store.bump();
  store.persist(spy);
  store.resources.set("rec_x", { id: "rec_x", type: "record", parentId: null, label: "public", ownerId: null, holds: 0 });
  store.persistResources(spy, ["rec_x"], true);
  const triggers = raw.all("SELECT tbl_name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'access_stamp_%'") as { tbl_name: string; sql: string }[];
  assert.ok(written.size >= 11, [...written].join(", "));
  for (const t of written) {
    assert.ok(TRIGGERED.has(t), `${t} is on the counted list`);
    for (const op of ["INSERT", "UPDATE", "DELETE"]) assert.ok(triggers.some((x) => x.tbl_name === t && new RegExp(`AFTER ${op} ON`, "i").test(x.sql)), `${t} AFTER ${op}`);
  }
  for (const t of TRIGGERED) for (const op of ["INSERT", "UPDATE", "DELETE"]) assert.ok(triggers.some((x) => x.tbl_name === t && new RegExp(`AFTER ${op} ON`, "i").test(x.sql)), `${t} AFTER ${op}`);
  // the counting wrapper refuses anything else
  for (const sql of ["INSERT INTO access_folders (id) VALUES (?)", "DELETE FROM access_my_access WHERE id = ?", "UPDATE access_acl SET x = 1", "CREATE TABLE access_new (x)", "INSERT INTO access_local_stamp (id, n) VALUES (1, 0)"]) {
    assert.throws(() => mustBeTriggered(sql), /only the tables the write counter watches/, sql);
  }
  for (const sql of ["INSERT OR REPLACE INTO access_grants (id) VALUES (?)", `INSERT INTO access_meta (id,epoch) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET epoch = max(epoch, excluded.epoch)`, "DELETE FROM access_resources WHERE id = ?"]) mustBeTriggered(sql);
  raw.close();
});

test("3 a seed whose write failed is answered once and never kept", () => {
  const { db: raw } = fresh("seedfail");
  raw.run("CREATE TRIGGER t_block BEFORE INSERT ON access_groups BEGIN SELECT RAISE(ABORT, 'disk full'); END");
  const before = syncCounts.hydrated;
  const first = sync(ctxOf(raw), { events: [res(1, SPACE, "space", null)] });
  assert.ok(first, "the first sync still answers from memory");
  raw.run("DROP TRIGGER t_block");
  sync(ctxOf(raw), { events: [] });
  assert.equal(syncCounts.hydrated - before, 2, "the second sync read the tables again: the half-written seed was not kept");
  raw.close();
});

test("4 the snapshot holds copies of role permissions and grant conditions; the kept store's records cannot be edited", async () => {
  // a store of its own (a handler's): editing its records after the snapshot was built leaves the snapshot as it was
  const store = new AccessStore();
  store.seed();
  store.principals.set("usr_x", { id: "usr_x", kind: "person", name: "X", status: "active", createdAt: 1 });
  store.grants.set("gr_x", { id: "gr_x", subject: { kind: "person", id: "usr_x" }, resource: { type: "space", id: SPACE }, level: "view", conditions: { hiddenFields: ["email"], rowFilter: { op: "eq", args: [{ field: "city" }, "Rome"] } as never, exception: undefined }, by: "usr_x", createdAt: 1 });
  store.grants.set("gr_e", { id: "gr_e", subject: { kind: "person", id: "usr_x" }, resource: { type: "space", id: SPACE }, level: "view", conditions: { exception: { perms: ["records.export"], effect: "allow" } }, by: "usr_x", createdAt: 1 });
  const snap = store.snapshot();
  const perms = [...(snap as unknown as { roles: Map<string, { perms: string[] }> }).roles.get("rol_member")!.perms];
  const grants = (snap as unknown as { grants: Map<string, { conditions?: { hiddenFields?: string[]; rowFilter?: unknown }; exception?: { perms: string[] } }> }).grants;
  store.roles.get("rol_member")!.permissions.push("x.y");
  store.grants.get("gr_x")!.conditions.hiddenFields!.push("phone");
  (store.grants.get("gr_x")!.conditions.rowFilter as { args: unknown[] }).args[1] = "Oslo";
  store.grants.get("gr_e")!.conditions.exception!.perms.push("members.remove");
  assert.deepEqual((snap as unknown as { roles: Map<string, { perms: string[] }> }).roles.get("rol_member")!.perms, perms, "role permissions copied");
  assert.deepEqual(grants.get("gr_x")!.conditions!.hiddenFields, ["email"], "hidden fields copied");
  assert.deepEqual((grants.get("gr_x")!.conditions!.rowFilter as { args: unknown[] }).args[1], "Rome", "row filter copied");
  assert.deepEqual(grants.get("gr_e")!.exception!.perms, ["records.export"], "exception permissions copied");
  // the kept store: its records refuse an edit, and the adopted snapshot does not change
  const { db: raw } = fresh("records");
  const adopted = sync(ctxOf(raw), { events: [res(1, SPACE, "space", null), person(2, "usr_x"), res(3, "rec_1", "record", SPACE, 1)] });
  let kept: AccessStore | null = null;
  await readOnly(async (ctx: never) => { kept = storeOf(ctx); })(ctxOf(raw) as never, {});
  assert.ok(kept);
  const k = kept as AccessStore;
  assert.throws(() => { (k.resources.get("rec_1") as { label: string }).label = "public"; });
  assert.throws(() => { k.roles.get("rol_member")!.permissions.push("x.y"); });
  assert.equal(adopted.resource("rec_1")?.label, 1);
  assert.equal(adopted.rowSource?.("rec_1")?.["label"], 1);
  raw.close();
});

test("5 a boot-time registration makes a missing record type and never resets the label or owner of one that exists", () => {
  const { file, db: first } = fresh("boot");
  const log: LogEvent[] = [res(1, SPACE, "space", null), person(2, "usr_owner"), person(3, "usr_ida"), { seq: 4, type: "principal.role_set", payload: { holder: "usr_owner", role: "rol_owner" } }];
  const boot: LogEvent[] = [{ seq: -1, type: "resource.created", payload: { id: "contact", type: "record_type", parent_id: SPACE, label: 0, owner_id: "usr_owner", holds: 0 } }, { seq: -1, type: "resource.created", payload: { id: "deal", type: "record_type", parent_id: SPACE, label: 0, owner_id: "usr_owner", holds: 0 } }];
  let snap: AccessSnapshot = sync(ctxOf(first), { events: [...log, ...boot] });
  assert.equal(snap.resource("contact")?.type, "record_type", "made when missing");
  assert.equal(setLabel(ctxOf(first), { resource: { type: "record_type", id: "contact" }, label: "restricted" }), true);
  assert.equal(transfer(ctxOf(first), { resource: { type: "record_type", id: "deal" }, from: "usr_owner", to: "usr_ida" }), true);
  sync(ctxOf(first), { events: [] });
  // a start without a restart (the boot events come again in the same process), then a real one
  snap = sync(ctxOf(first), { events: boot });
  assert.equal(snap.resource("contact")?.label, 3, "still Restricted");
  first.close();
  const raw = openDb(file);
  snap = sync(ctxOf(raw), { events: [...log, ...boot] });
  assert.equal(snap.resource("contact")?.label, 3, "still Restricted after a restart");
  assert.equal(snap.resource("deal")?.owner_id, "usr_ida", "still Ida's after a restart");
  raw.close();
});
