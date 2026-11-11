// The read view (projections.ts readOnly, consumers.ts readViewOf): a capability that only reads gets the store access.sync keeps instead of reading every access table again.
// On a real SQLite file with the host's own db handles (a new one per call):
//   1  every read capability answers exactly what it answers on a store of its own read from the tables, before and after the kept store changes in place and is rebuilt
//   2  nothing a reader holds can change the view: a map, a record, a field, a method, the snapshot it reads through store.snapshot() (viewerOf, levelFor), or its fields
//   3  a reader never sees a change a handler holds but has not written
//   4  a write by a handler, or with plain SQL on this connection or another, is seen by the next read
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../../../host/src/daemon/sqlite.ts";
import type { HostDb } from "../../../host/src/daemon/sqlite.ts";
import { migrate } from "../../../host/src/daemon/hosttables.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { hostCalls, readCounts } from "../consumers.ts";
import type { LogEvent } from "../consumers.ts";
import { handlers } from "../handlers/index.ts";
import { READ_VIEW_REFUSAL, storeOf } from "../projections.ts";
import type { AccessCtx, AccessStore } from "../projections.ts";
import { check, providerCheck } from "../handlers/check.ts";
import { grantsList, groupsGet, groupsList, principalsEffective, principalsGet, principalsList, rolesAssign, rolesGet, rolesList } from "../handlers/roles.ts";
import { reachBatch } from "../handlers/reach.ts";
import { agentsCanCallGet, deciders, recordMarks, sharesOf } from "../handlers/share.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const NOW = 1_800_000_000_000;
const SPACE = "spc_rv";
const TRACE = "0123456789abcdef0123456789abcdef";
const sync = hostCalls["access.sync"] as unknown as (ctx: unknown, input: { events: LogEvent[] }) => unknown;

type Ctx = AccessCtx & { origin: string; depth: number; actingFor?: string; call(cap: string, input: unknown): Promise<unknown>; log: { warn(): void } };
function ctxOf(raw: HostDb, principal = "usr_owner", kind = "person", actingFor?: string): Ctx {
  return {
    space: SPACE, principal: { kind, id: principal }, trace: { traceId: TRACE }, now: () => NOW, db: scopedDb("access", raw, TRACE), emit: () => undefined,
    origin: "gateway", depth: 0, ...(actingFor ? { actingFor } : {}), call: async () => null, log: { warn: () => undefined },
  };
}
function fresh(tag: string): { file: string; raw: HostDb } {
  const dir = fs.mkdtempSync(path.join(process.env["TMPDIR"] ?? os.tmpdir(), `access-rv-${tag}-`));
  const file = path.join(dir, "modules.db");
  const raw = openDb(file);
  migrate(raw, ROOT, () => NOW);
  return { file, raw };
}

let seq = 0;
const ev = (type: string, payload: unknown): LogEvent => ({ seq: ++seq, type, payload });
const res = (id: string, type: string, parent: string | null, label = 0, owner = "usr_owner"): LogEvent => ev("resource.created", { id, type, parent_id: parent, label, owner_id: owner, holds: 0 });
function seed(raw: HostDb): void {
  sync(ctxOf(raw), { events: [
    res(SPACE, "space", null),
    ...["usr_owner", "usr_mia", "usr_noor"].map((id) => ev("principal.created", { id, kind: "person", name: id.slice(4), status: "active" })),
    ev("principal.created", { id: "agt_mine", kind: "agent", name: "Helper", status: "active", owner: "usr_mia" }),
    ev("principal.role_set", { holder: "usr_owner", role: "rol_owner" }),
    ev("principal.role_set", { holder: "usr_mia", role: "rol_member" }),
    ev("principal.role_set", { holder: "agt_mine", role: "rol_member" }),
    ev("group.member_added", { group: "grp_everyone", member: "usr_mia" }),
    ev("agent.privacy_set", { agentId: "agt_mine", private: true, assistant: true }),
    res("contact", "record_type", SPACE),
    res("rec_1", "record", "contact", 1, "usr_mia"),
    res("rec_2", "record", "contact", 2),
    res("fld_1", "folder", SPACE),
    res("agt_mine", "agent", SPACE, 0, "usr_mia"),
    ev("grant.created", { id: "gr_noor", subject_kind: "actor", subject_id: "usr_noor", resource_type: "record", resource_id: "rec_2", level: "view", conditions: { hiddenFields: ["email"] }, by: "usr_owner" }),
    ev("grant.created", { id: "gr_grp", subject_kind: "group", subject_id: "grp_everyone", resource_type: "folder", resource_id: "fld_1", level: "edit", by: "usr_owner" }),
  ] });
}

type Call = { cap: string; viewer: [string, string, string?]; input: unknown; own: (ctx: never, input: never) => Promise<unknown> };
const CALLS: Call[] = [
  { cap: "access.principals.list", viewer: ["usr_mia", "person"], input: { kind: "agent" }, own: principalsList },
  { cap: "access.principals.list", viewer: ["usr_noor", "person"], input: {}, own: principalsList },
  { cap: "access.principals.list", viewer: ["usr_owner", "person"], input: { q: "help" }, own: principalsList },
  { cap: "access.principals.get", viewer: ["usr_noor", "person"], input: { principal: { kind: "agent", id: "agt_mine" } }, own: principalsGet },
  { cap: "access.principals.get", viewer: ["usr_mia", "person"], input: { principal: { kind: "person", id: "usr_owner" } }, own: principalsGet },
  { cap: "access.principals.effective", viewer: ["usr_owner", "person"], input: { principal: { kind: "person", id: "usr_noor" } }, own: principalsEffective },
  { cap: "access.shares_of", viewer: ["usr_owner", "person"], input: { resource: { type: "record", id: "rec_2" } }, own: sharesOf },
  { cap: "access.shares_of", viewer: ["usr_mia", "person"], input: { resource: { type: "folder", id: "fld_1" } }, own: sharesOf },
  { cap: "access.check", viewer: ["usr_owner", "person"], input: { principal: { kind: "person", id: "usr_noor" }, action: { level: "view" }, resource: { type: "record", id: "rec_2" } }, own: check },
  { cap: "access.check", viewer: ["usr_owner", "person"], input: { principal: { kind: "person", id: "usr_noor" }, action: { level: "edit" }, resource: { type: "record", id: "rec_new" } }, own: check },
  { cap: "access.provider_check", viewer: ["agt_mine", "agent", "usr_mia"], input: { resources: [{ type: "record", id: "rec_1" }, { type: "record", id: "rec_2" }], provider: "openrouter" }, own: providerCheck },
  { cap: "access.reach", viewer: ["usr_noor", "person"], input: { items: [{ type: "record", id: "rec_1" }, { type: "record", id: "rec_2" }, { type: "folder", id: "fld_1" }, { type: "record", id: "rec_new" }] }, own: reachBatch },
  { cap: "access.record_marks", viewer: ["usr_owner", "person"], input: { type: "contact" }, own: recordMarks },
  { cap: "access.agents_can_call.get", viewer: ["usr_mia", "person"], input: { agentId: "agt_mine" }, own: agentsCanCallGet },
  { cap: "access.deciders", viewer: ["usr_owner", "person"], input: { resource: { type: "folder", id: "fld_1" } }, own: deciders },
  { cap: "access.groups.list", viewer: ["usr_owner", "person"], input: {}, own: groupsList },
  { cap: "access.groups.get", viewer: ["usr_owner", "person"], input: { groupId: "grp_everyone" }, own: groupsGet },
  { cap: "access.roles.list", viewer: ["usr_owner", "person"], input: {}, own: rolesList },
  { cap: "access.roles.get", viewer: ["usr_owner", "person"], input: { roleId: "rol_member" }, own: rolesGet },
  { cap: "access.grants.list", viewer: ["usr_owner", "person"], input: { resource: { type: "record", id: "rec_2" } }, own: grantsList },
];

async function answer(f: () => Promise<unknown>): Promise<string> {
  // a decision id is new for every decision
  try { return JSON.stringify(await f()).replace(/"dec_[0-9a-f-]+"/g, '"dec"'); } catch (e) { return `throws ${(e as Error).message}`; }
}
/** Each read capability through the read view and on a store of its own read from the tables: the same answer, and the view was used. */
async function same(raw: HostDb, where: string): Promise<void> {
  for (const c of CALLS) {
    const before = readCounts.views;
    const h = (handlers as Record<string, (ctx: unknown, input: unknown) => Promise<unknown>>)[c.cap]!;
    const viaView = await answer(() => h(ctxOf(raw, ...c.viewer), c.input));
    const own = await answer(() => c.own(ctxOf(raw, ...c.viewer) as never, c.input as never));
    assert.ok(!viaView.includes(READ_VIEW_REFUSAL), `${where} ${c.cap} tried to change the read view: ${viaView}`);
    assert.equal(viaView, own, `${where} ${c.cap} ${JSON.stringify(c.input)}`);
    assert.ok(readCounts.views > before, `${where} ${c.cap} read the view`);
  }
}

test("1 every read capability answers on the read view what it answers on a store of its own, as the kept store changes", async () => {
  const { raw } = fresh("same");
  seed(raw);
  await same(raw, "seeded");
  sync(ctxOf(raw), { events: [res("rec_new", "record", "contact", 0, "usr_noor")] });   // in place
  await same(raw, "after an object");
  sync(ctxOf(raw), { events: [ev("principal.suspended", { principalId: "usr_mia" })] });   // rebuilt
  await same(raw, "after a suspension");
  await rolesAssign(ctxOf(raw), { subject: { kind: "person", id: "usr_noor" }, roleId: "rol_developer" });   // a handler writes: read again
  await same(raw, "after a handler wrote");
  raw.close();
});

test("2 nothing a reader holds can change the read view", async () => {
  const { raw } = fresh("sealed");
  seed(raw);
  let view: AccessStore | null = null;
  const peek = (ctx: AccessCtx): Promise<unknown> => { view = storeOf(ctx); return Promise.resolve(null); };
  const { readOnly } = await import("../projections.ts");
  await readOnly(peek)(ctxOf(raw), {});
  assert.ok(view, "a reader got the view");
  const v = view as unknown as AccessStore & Record<string, unknown>;
  const refused = (what: string, f: () => unknown): void => assert.throws(f, (e: Error) => e.message === READ_VIEW_REFUSAL || e instanceof TypeError, what);
  refused("a map set", () => v.principals.set("usr_x", { id: "usr_x", kind: "person", name: "X", status: "active", createdAt: 0 }));
  refused("a map delete", () => v.grants.delete("gr_noor"));
  refused("a map clear", () => v.fieldLabels.clear());
  refused("a set add", () => v.catalogue.add("x.y"));
  refused("a record field", () => { v.principals.get("usr_mia")!.status = "removed"; });
  refused("an array in a record", () => { v.groups.get("grp_everyone")!.members.push({ kind: "person", id: "usr_noor" }); });
  refused("a nested condition", () => { (v.grants.get("gr_noor")!.conditions.hiddenFields as string[]).pop(); });
  refused("a row of a resource", () => { (v.resources.get("rec_1") as { label: string }).label = "public"; });
  refused("a field", () => { v.epoch = 99; });
  refused("a new field", () => { v["extra"] = 1; });
  refused("bump", () => v.bump());
  refused("invalidate", () => v.invalidate());
  refused("setRoles", () => v.setRoles("usr_noor", ["rol_admin"]));
  refused("persist", () => v.persist(ctxOf(raw).db));
  refused("replacing a method", () => { (v as unknown as { bump: unknown }).bump = () => undefined; });
  const snap = v.snapshot();
  assert.equal(v.snapshot(), snap, "store.snapshot() answers the view's own snapshot and builds nothing");
  for (const m of ["putGrant", "revokeGrant", "putResource", "putPrincipal", "putRole", "addPrincipalRole", "removePrincipalRole", "addMember", "removeMember", "setFieldLabel", "setPolicies", "setAssistant", "changed"]) {
    refused(`snapshot.${m}`, () => (snap as unknown as Record<string, (...a: unknown[]) => void>)[m]!({ id: "x", holder: "usr_noor", role: "rol_admin", group: "g", member: "m", subject_kind: "actor", subject_id: "usr_noor", resource_type: "space", resource_id: SPACE, level: "manage", by: "x" }));
  }
  refused("snapshot.epoch", () => { snap.epoch = 0; });
  refused("snapshot.rowSource", () => { snap.rowSource = () => ({}); });
  refused("snapshot.clock", () => { snap.clock = () => 0; });
  refused("snapshot.labelNames", () => { snap.labelNames.push("x"); });
  // the answers are what they were
  assert.equal(v.principals.get("usr_mia")!.status, "active");
  assert.equal(v.grants.has("gr_noor"), true);
  const daemon = sync(ctxOf(raw), { events: [] }) as typeof snap;
  assert.equal(daemon.info("usr_noor")?.keys.has("role:rol_admin"), false);
  raw.close();
});

test("3 a reader never sees a change a handler holds but has not written", async () => {
  const { raw } = fresh("phantom");
  seed(raw);
  const writer = storeOf(ctxOf(raw));   // a handler's own store
  writer.principals.set("usr_ghost", { id: "usr_ghost", kind: "person", name: "Ghost", status: "active", createdAt: NOW });
  writer.setRoles("usr_noor", ["rol_admin"]);
  writer.bump();
  const got = await answer(() => (handlers["access.principals.get"] as (c: unknown, i: unknown) => Promise<unknown>)(ctxOf(raw), { principal: { kind: "person", id: "usr_ghost" } }));
  assert.match(got, /^throws/, "the unwritten person is not there");
  const eff = JSON.parse(await answer(() => (handlers["access.principals.effective"] as (c: unknown, i: unknown) => Promise<unknown>)(ctxOf(raw), { principal: { kind: "person", id: "usr_noor" } }))) as { roles: string[] };
  assert.equal(eff.roles.includes("rol_admin"), false, "nor the unwritten role");
  raw.close();
});

test("4 a write by a handler, or with plain SQL on this connection or another, is seen by the next read", async () => {
  const { file, raw } = fresh("external");
  seed(raw);
  const get = async (id: string): Promise<{ principal?: { name: string; roles: string[] } }> => JSON.parse(await answer(() => (handlers["access.principals.get"] as (c: unknown, i: unknown) => Promise<unknown>)(ctxOf(raw), { principal: { kind: "person", id } })));
  assert.equal((await get("usr_noor")).principal?.name, "noor");
  raw.run("UPDATE access_principals SET name = 'Noor A' WHERE id = 'usr_noor'");
  assert.equal((await get("usr_noor")).principal?.name, "Noor A", "plain SQL on this connection");
  const other = openDb(file);
  other.run("UPDATE access_principals SET name = 'Noor B' WHERE id = 'usr_noor'");
  other.close();
  assert.equal((await get("usr_noor")).principal?.name, "Noor B", "plain SQL on another connection");
  await rolesAssign(ctxOf(raw), { subject: { kind: "person", id: "usr_noor" }, roleId: "rol_developer" });
  assert.ok((await get("usr_noor")).principal?.roles.includes("rol_developer"), "a handler's write");
  raw.close();
});
