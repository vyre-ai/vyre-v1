// access.sync keeps its store and snapshot between calls on a daemon database (consumers.ts syncKept, issue #905). These tests hold it to the old behaviour, a store read from the tables on
// every call and a snapshot built from it, on a real SQLite file with every module migration applied and the host's own db handle (a new one per call, as host/src/loader.ts makes them).
//   1  a long seeded stream of log events, handler calls, plain SQL behind the store's back and restarts: after every step the kept snapshot equals one built from the tables, and authorize
//      answers the same for a sample of people, actions and resources
//   2  a handler's change that is never written does not reach the snapshot, even when a sync runs while the handler waits
//   3  a row changed with plain SQL (as the copy from another computer does), on this connection or another, is seen by the next sync
//   4  every access table the store reads carries the triggers that move the write counter
//   5  a restart does not fold again the objects registered since the last other change (the cursor of an objects-only batch is kept in access_local_cursor)
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
import { authorize } from "../../../kernel/src/authorize/index.ts";
import type { AccessSnapshot } from "../../../kernel/src/authorize/index.ts";
import { hostCalls, syncCounts } from "../consumers.ts";
import type { LogEvent } from "../consumers.ts";
import { loadStore, storeOf } from "../projections.ts";
import type { AccessCtx, Db } from "../projections.ts";
import { labelsSet } from "../handlers/check.ts";
import { groupsAddMember, groupsRemoveMember, rolesAssign, rolesUnassign } from "../handlers/roles.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const NOW = 1_800_000_000_000;
const SPACE = "spc_inc";
const TRACE = "0123456789abcdef0123456789abcdef";

type Call = (ctx: unknown, input: unknown) => unknown;
const sync = hostCalls["access.sync"] as unknown as (ctx: unknown, input: { events: LogEvent[] }) => AccessSnapshot;
const fromTables = hostCalls["access.snapshot"] as unknown as (ctx: unknown) => AccessSnapshot;
const setLabel = hostCalls["access.set_resource_label"] as unknown as Call;
const transfer = hostCalls["access.transfer_ownership"] as unknown as Call;

function tempFile(tag: string): string {
  const dir = fs.mkdtempSync(path.join(process.env["TMPDIR"] ?? os.tmpdir(), `access-inc-${tag}-`));
  return path.join(dir, "modules.db");
}
function fresh(tag: string): { file: string; db: HostDb } {
  const file = tempFile(tag);
  const db = openDb(file);
  migrate(db, ROOT, () => NOW);
  return { file, db };
}
/** A call's ctx as the host builds it: a new scoped handle on the daemon database every time. */
function ctxOf(raw: HostDb, principal = "usr_owner"): AccessCtx & { origin: string; depth: number } {
  return {
    space: SPACE, principal: { kind: "person", id: principal }, trace: { traceId: TRACE }, now: () => NOW,
    db: scopedDb("access", raw, TRACE), emit: () => undefined, origin: "hook", depth: 0,
  };
}

// ---- comparing two snapshots completely

const canon = (v: unknown): unknown => {
  if (v instanceof Map) return [...v.entries()].map(([k, x]) => [k, canon(x)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  if (v instanceof Set) return [...v].map(canon).map((x) => JSON.stringify(x)).sort();
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, canon((v as Record<string, unknown>)[k])]));
  return v;
};
/** Everything authorize can read from a snapshot. Order is left out: the old path built the snapshot in the order its own store held, which was never the tables' order either. */
function dump(snap: AccessSnapshot): unknown {
  const s = snap as unknown as Record<string, unknown>;
  const sortedLists = (m: unknown): unknown => new Map([...(m as Map<string, string[]>)].map(([k, l]) => [k, [...l].sort()]));
  const resources = [...snap.allResources()].map((r) => r.id).sort();
  return canon({
    principals: s["principals"], roles: s["roles"], holderRoles: sortedLists(s["holderRoles"]), members: sortedLists(s["members"]), grants: s["grants"], resources: s["resources"],
    fieldLabels: s["fieldLabels"], policies: [...(s["policyList"] as unknown[])].map((p) => JSON.stringify(canon(p))).sort(), assistants: s["assistants"], labelNames: s["labelNames"],
    rows: resources.map((id) => [id, snap.rowSource?.(id)]),
  });
}

function sameSnapshots(got: AccessSnapshot, want: AccessSnapshot, where: string, perms: readonly string[]): void {
  const a = JSON.stringify(dump(got)), b = JSON.stringify(dump(want));
  if (a !== b) {
    const da = dump(got) as Record<string, unknown>, db = dump(want) as Record<string, unknown>;
    const parts = Object.keys(db).filter((k) => JSON.stringify(da[k]) !== JSON.stringify(db[k]));
    assert.fail(`${where}: the kept snapshot differs from one built from the tables in ${parts.join(", ")}\n${parts.map((k) => `kept ${k}: ${JSON.stringify(da[k]).slice(0, 1500)}\ntables ${k}: ${JSON.stringify(db[k]).slice(0, 1500)}`).join("\n")}`);
  }
  const people = [...want.allPrincipals()].map((p) => p.id).sort();
  const all = [...want.allResources()].map((r) => ({ type: r.type, id: r.id })).sort((x, y) => x.id.localeCompare(y.id));
  const actions: { perm: string | null; level: "view" | "use" | "edit" | "manage" }[] = [
    { perm: null, level: "view" }, { perm: null, level: "use" }, { perm: null, level: "edit" }, { perm: null, level: "manage" },
  ];
  let asked = 0;
  for (const [pi, p] of [...people, "usr_nobody"].entries()) {
    const agentFor = want.principal(p)?.kind === "agent" ? want.principal(p)?.owner : undefined;
    // the Space, the newest five resources, and five spread over the rest, different for each person
    const sample = [...new Set([...all.filter((r) => r.type === "space"), ...all.slice(-5), ...Array.from({ length: 5 }, (_, k) => all[(pi * 7 + k * 13) % Math.max(1, all.length)]!)])];
    for (const r of sample) {
      for (const action of [...actions, { perm: perms[(pi + asked) % Math.max(1, perms.length)] ?? null, level: "use" as const }]) {
        const req = { principal: p, ...(agentFor ? { actingFor: agentFor } : {}), action, resource: r, now: NOW, explain: true };
        const x = JSON.stringify(authorize(got, req)), y = JSON.stringify(authorize(want, req));
        if (x !== y) assert.fail(`${where}: authorize differs for ${JSON.stringify(req)}\nkept   ${x}\ntables ${y}`);
        asked++;
      }
    }
  }
  assert.ok(asked > 0);
}

// ---- a seeded stream

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

async function stream(seed: number, steps: number): Promise<{ inPlace: number; rebuilt: number; hydrated: number; restarts: number; handler: number; external: number }> {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const { file } = fresh(`s${seed}`);
  let raw = openDb(file);
  let seq = 0;
  const log: LogEvent[] = [];
  const ev = (type: string, payload: unknown): LogEvent => { const e = { seq: ++seq, type, payload }; log.push(e); return e; };
  const people = ["usr_owner", "usr_ana", "usr_ben", "usr_cara"];
  const agents: string[] = [];
  const containers = [SPACE];
  const resources: { id: string; type: string }[] = [{ id: SPACE, type: "space" }];
  const groups = ["grp_everyone", "grp_sales"];
  const roles = ["rol_member", "rol_developer", "rol_guest", "rol_admin"];
  const grants: string[] = [];
  let n = 0;
  const counts = { inPlace: 0, rebuilt: 0, hydrated: 0, restarts: 0, handler: 0, external: 0 };
  const start = { ...syncCounts };

  const boot: LogEvent[] = [
    ev("resource.created", { id: SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_owner", holds: 0 }),
    ...people.map((id) => ev("principal.created", { id, kind: "person", name: id.slice(4), status: "active" })),
    ev("principal.role_set", { holder: "usr_owner", role: "rol_owner" }),
    ev("principal.role_set", { holder: "usr_ana", role: "rol_member" }),
    ev("principal.role_set", { holder: "usr_ben", role: "rol_guest" }),
    ev("group.member_added", { group: "grp_everyone", member: "usr_ana" }),
    ev("group.member_added", { group: "grp_sales", member: "usr_ben" }),
  ];
  const perms = (() => { sync(ctxOf(raw), { events: boot }); return storeOf(ctxOf(raw)).roles.get("rol_member")!.permissions.slice(0, 6); })();
  sameSnapshots(sync(ctxOf(raw), { events: [] }), fromTables(ctxOf(raw)), `seed ${seed} boot`, perms);

  const newResource = (): LogEvent => {
    const type = pick(["record", "record", "folder", "kit", "record_type"]);
    const id = `${type === "record" ? "rec" : type === "folder" ? "fld" : type}_${seed}_${++n}`;
    resources.push({ id, type });
    if (type === "folder" || type === "record_type") containers.push(id);
    return ev("resource.created", { id, type, parent_id: pick(containers), label: Math.floor(r() * 4), owner_id: pick(people), holds: Math.floor(r() * 3) });
  };

  for (let step = 0; step < steps; step++) {
    const roll = r();
    let events: LogEvent[] = [];
    let what = "";
    if (roll < 0.30) { what = "objects"; events = Array.from({ length: 1 + Math.floor(r() * 4) }, newResource); }
    else if (roll < 0.38) {
      what = "an object registered again";
      const x = pick(resources.filter((o) => o.type !== "space"));
      if (x) events = [ev("resource.created", { id: x.id, type: x.type, parent_id: pick(containers.filter((c) => c !== x.id)), label: Math.floor(r() * 4), owner_id: pick(people), holds: Math.floor(r() * 3) })];
    }
    else if (roll < 0.41) { what = "a boot-time object"; const id = `rt_boot_${seed}_${++n}`; events = [{ seq: -1, type: "resource.created", payload: { id, type: "record_type", parent_id: SPACE, label: 0, owner_id: "usr_owner", holds: 0 } }]; resources.push({ id, type: "record_type" }); }
    else if (roll < 0.44) { what = "an event already folded"; events = [pick(log)]; }
    else if (roll < 0.47) {
      what = "a role";
      const id = `rol_custom_${seed}_${++n}`;
      roles.push(id);
      events = [ev("role.defined", { id, name: `Custom ${n}`, perms: perms.filter(() => r() < 0.5), clearance: Math.floor(r() * 4) })];
    }
    else if (roll < 0.50) {
      what = "a person or an agent";
      if (r() < 0.5) { const id = `usr_p${seed}_${++n}`; people.push(id); events = [ev("principal.created", { id, kind: "person", name: `P ${n}`, status: "active" })]; }
      else { const id = `agt_a${seed}_${++n}`; agents.push(id); const owner = pick(people); events = [ev("principal.created", { id, kind: "agent", name: `A ${n}`, status: "active", owner }), ev("principal.role_set", { holder: id, role: "rol_member" })]; }
    }
    else if (roll < 0.54) { what = "a role given"; events = [ev("principal.role_set", { holder: pick([...people, ...agents, ...groups]), role: pick(roles) })]; }
    else if (roll < 0.57) { what = "a group member"; events = [ev("group.member_added", { group: pick(groups), member: pick([...people, ...agents]) })]; }
    else if (roll < 0.63) {
      what = "a grant";
      const id = `gr_${seed}_${++n}`;
      grants.push(id);
      const res = pick(resources);
      const kind = pick(["actor", "actor", "group", "role"] as const);
      const subject = kind === "actor" ? pick([...people, ...agents]) : kind === "group" ? pick(groups) : pick(roles);
      const conditions = r() < 0.3 ? { hiddenFields: ["email"] } : r() < 0.2 ? { rowFilter: { op: "owner_me" } } : r() < 0.1 ? { notBefore: NOW - 1000, notAfter: NOW + 1000 } : {};
      events = [ev("grant.created", { id, subject_kind: kind, subject_id: subject, resource_type: res.type, resource_id: r() < 0.1 ? null : res.id, level: pick(["view", "use", "edit", "manage"]), conditions, ...(r() < 0.1 ? { expires_at: NOW + 5000 } : {}), by: "usr_owner" })];
    }
    else if (roll < 0.66 && grants.length) { what = "a grant revoked"; events = [ev("grant.revoked", { grantId: pick(grants) })]; }
    else if (roll < 0.70) {
      what = "a person suspended, back, or removed";
      const who = pick(people.filter((p) => p !== "usr_owner"));
      events = [ev(pick(["principal.suspended", "principal.reactivated", "member.removed"]), { principalId: who, personId: who })];
    }
    else if (roll < 0.72 && agents.length) { what = "an agent made private"; events = [ev("agent.privacy_set", { agentId: pick(agents), private: r() < 0.7, assistant: r() < 0.5 })]; }
    else if (roll < 0.80) {
      what = "a handler";
      counts.handler++;
      const h = ctxOf(raw);
      const x = pick(resources.filter((o) => o.type !== "space"));
      const k = Math.floor(r() * 6);
      try {
        if (k === 0 && x) await labelsSet(h, { resource: { type: x.type, id: x.id }, label: pick(["public", "internal", "confidential", "restricted"] as const) });
        else if (k === 1 && x) setLabel(h, { resource: { type: x.type, id: x.id }, label: pick(["public", "internal", "confidential", "restricted"] as const) });
        else if (k === 2 && x) transfer(h, { resource: { type: x.type, id: x.id }, from: pick(people), to: pick(people) });
        else if (k === 3) await rolesAssign(h, { subject: { kind: "person", id: pick(people.filter((p) => p !== "usr_owner")) }, roleId: pick(roles.filter((id) => id !== "rol_admin")) });
        else if (k === 4) await rolesUnassign(h, { subject: { kind: "person", id: pick(people.filter((p) => p !== "usr_owner")) }, roleId: pick(roles) });
        else await (r() < 0.5 ? groupsAddMember(h, { groupId: "grp_sales", member: { kind: "person", id: pick(people) } }) : groupsRemoveMember(h, { groupId: "grp_sales", member: { kind: "person", id: pick(people) } }));
      } catch { /* a refusal (no such role, not allowed): nothing written, as in the app */ }
    }
    else if (roll < 0.88) {
      what = "plain SQL behind the store";
      counts.external++;
      const x = pick(resources.filter((o) => o.type !== "space"));
      const k = Math.floor(r() * 4);
      if (k === 0 && x) raw.run("UPDATE access_resources SET label = ?, owner_id = ? WHERE id = ?", pick(["public", "internal", "confidential", "restricted"]), pick(people), x.id);
      else if (k === 1 && x) { const id = `gr_sql_${seed}_${++n}`; raw.run(`INSERT INTO access_grants (id, "subjectKind", "subjectId", "resourceType", "resourceId", level, conditions, "expiresAt", by, source, version) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, id, "person", pick(people), x.type, x.id, pick(["view", "edit"]), "{}", null, "usr_owner", null, 1); }
      else if (k === 2) raw.run("DELETE FROM access_grants WHERE id = (SELECT id FROM access_grants ORDER BY id LIMIT 1 OFFSET ?)", Math.floor(r() * 3));
      else raw.run("UPDATE access_principals SET status = ? WHERE id = ?", pick(["active", "suspended"]), pick(people.filter((p) => p !== "usr_owner")));
    }
    else if (roll < 0.92) {
      what = "a restart";
      counts.restarts++;
      raw.close();
      raw = openDb(file);
      events = [...log];   // the daemon reads its whole log at start and hands every access event over
    }
    else what = "nothing new";
    const got = sync(ctxOf(raw), { events });
    sameSnapshots(got, fromTables(ctxOf(raw)), `seed ${seed} step ${step} (${what})`, perms);
  }
  raw.close();
  counts.inPlace = syncCounts.inPlace - start.inPlace;
  counts.rebuilt = syncCounts.rebuilt - start.rebuilt;
  counts.hydrated = syncCounts.hydrated - start.hydrated;
  return counts;
}

for (const seed of [1, 7, 42, 1905, 31337]) {
  test(`1 seed ${seed}: after every step the kept snapshot equals one built from the tables, and authorize answers the same`, async () => {
    const c = await stream(seed, 300);
    console.log(`seed ${seed}: in place ${c.inPlace}, rebuilt from the kept store ${c.rebuilt}, read from the tables ${c.hydrated}, restarts ${c.restarts}, handler calls ${c.handler}, plain SQL ${c.external}`);
    assert.ok(c.inPlace > 50, "the stream changed the kept snapshot in place");
    assert.ok(c.rebuilt > 20, "the stream built a new snapshot from the kept store");
    assert.ok(c.hydrated > c.restarts, "the stream read the tables again after other writers");
  });
}

test("1b a batch of new objects changes the kept snapshot in place; nothing new answers the same snapshot", () => {
  const { db: raw } = fresh("inplace");
  const a = sync(ctxOf(raw), { events: [{ seq: 1, type: "resource.created", payload: { id: SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_owner", holds: 0 } }] });
  const epoch = a.epoch;
  const b = sync(ctxOf(raw), { events: [{ seq: 2, type: "resource.created", payload: { id: "rec_1", type: "record", parent_id: SPACE, label: 1, owner_id: "usr_owner", holds: 0 } }] });
  assert.equal(b, a, "the same object");
  assert.ok(b.epoch > epoch, "its epoch moved, so every derived view was dropped");
  assert.equal(b.resource("rec_1")?.label, 1);
  assert.equal(sync(ctxOf(raw), { events: [] }), b);
  const c = sync(ctxOf(raw), { events: [{ seq: 3, type: "principal.created", payload: { id: "usr_new", kind: "person", name: "New", status: "active" } }] });
  assert.notEqual(c, b, "any other change builds a new snapshot");
  assert.equal(b.principal("usr_new"), undefined, "and the one a reader still holds does not change under it");
  assert.equal(b.rowSource?.("rec_2"), undefined);
  sync(ctxOf(raw), { events: [{ seq: 4, type: "resource.created", payload: { id: "rec_2", type: "record", parent_id: SPACE, label: 0, owner_id: "usr_owner", holds: 0 } }] });
  assert.equal(b.resource("rec_2"), undefined, "a snapshot no longer kept is never changed again");
  assert.equal(b.rowSource?.("rec_2"), undefined, "nor are the rows it reads");
  raw.close();
});

test("2 a handler's change that is never written does not reach a sync that runs while the handler waits", async () => {
  const { db: raw } = fresh("phantom");
  sync(ctxOf(raw), { events: [
    { seq: 1, type: "resource.created", payload: { id: SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_owner", holds: 0 } },
    { seq: 2, type: "principal.created", payload: { id: "usr_eve", kind: "person", name: "Eve", status: "active" } },
    { seq: 3, type: "resource.created", payload: { id: "fld_secret", type: "folder", parent_id: SPACE, label: 0, owner_id: "usr_owner", holds: 0 } },
  ] });
  const canEdit = (snap: AccessSnapshot): string => authorize(snap, { principal: "usr_eve", action: { perm: null, level: "edit" }, resource: { type: "folder", id: "fld_secret" }, now: NOW }).effect;
  assert.equal(canEdit(sync(ctxOf(raw), { events: [] })), "deny");
  const before = { ...syncCounts };
  // the handler: its own store, a grant and a role in memory, then it waits (a call out, an approval) and fails without writing
  const handler = (async () => {
    const store = storeOf(ctxOf(raw));
    store.grants.set("gr_phantom", { id: "gr_phantom", subject: { kind: "person", id: "usr_eve" }, resource: { type: "folder", id: "fld_secret" }, level: "manage", conditions: {}, by: "usr_owner", createdAt: NOW });
    store.setRoles("usr_eve", ["rol_admin"]);
    store.bump();
    await new Promise((done) => setTimeout(done, 20));
    throw new Error("the handler failed before it wrote");
  })();
  // meanwhile commits land: objects, and a forced sync
  await new Promise((done) => setTimeout(done, 5));
  const during = sync(ctxOf(raw), { events: [{ seq: 4, type: "resource.created", payload: { id: "rec_x", type: "record", parent_id: "fld_secret", label: 0, owner_id: "usr_owner", holds: 0 } }] });
  assert.equal(canEdit(during), "deny", "the sync's snapshot has none of the handler's unwritten change");
  assert.equal(during.grantsOn("fld_secret"), undefined);
  assert.equal(during.info("usr_eve")?.keys.has("role:rol_admin"), false);
  assert.equal(syncCounts.inPlace - before.inPlace, 1, "and it came from the kept store, which the handler never held");
  await assert.rejects(handler);
  const after = sync(ctxOf(raw), { events: [] });
  assert.equal(canEdit(after), "deny");
  assert.equal(canEdit(fromTables(ctxOf(raw))), "deny");
  raw.close();
});

test("3 a row changed with plain SQL, on this connection or another, is seen by the next sync", () => {
  const { file, db: raw } = fresh("external");
  const base: LogEvent[] = [
    { seq: 1, type: "resource.created", payload: { id: SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_owner", holds: 0 } },
    { seq: 2, type: "principal.created", payload: { id: "usr_dan", kind: "person", name: "Dan", status: "active" } },
    { seq: 3, type: "principal.role_set", payload: { holder: "usr_dan", role: "rol_member" } },
    { seq: 4, type: "resource.created", payload: { id: "fld_a", type: "folder", parent_id: SPACE, label: 0, owner_id: "usr_owner", holds: 0 } },
  ];
  sync(ctxOf(raw), { events: base });
  const kept = sync(ctxOf(raw), { events: [{ seq: 5, type: "resource.created", payload: { id: "rec_a", type: "record", parent_id: "fld_a", label: 0, owner_id: "usr_owner", holds: 0 } }] });
  const view = (snap: AccessSnapshot, id: string): string => authorize(snap, { principal: "usr_dan", action: { perm: null, level: "view" }, resource: { type: "record", id }, now: NOW }).effect;
  assert.equal(view(kept, "rec_a"), "allow");
  // this connection: the folder becomes Restricted, as a copy from another computer writes it
  raw.run("UPDATE access_resources SET label = 'restricted' WHERE id = 'fld_a'");
  const one = sync(ctxOf(raw), { events: [] });
  assert.notEqual(one, kept, "read again");
  assert.equal(one.effectiveLabel("rec_a"), 3);
  assert.equal(view(one, "rec_a"), "deny");
  // another connection (another process on the same file): Dan's role row goes
  const other = openDb(file);
  other.run("DELETE FROM access_assignments WHERE holder = 'usr_dan'");
  other.close();
  const two = sync(ctxOf(raw), { events: [] });
  assert.equal(two.info("usr_dan")?.keys.has("role:rol_member"), false);
  // a grant row put in behind the store, then removed
  raw.run(`INSERT INTO access_grants (id, "subjectKind", "subjectId", "resourceType", "resourceId", level, conditions, "expiresAt", by, source, version) VALUES ('gr_sql','person','usr_dan','record','rec_a','view','{}',NULL,'usr_owner',NULL,1)`);
  raw.run("UPDATE access_resources SET label = 'public' WHERE id = 'fld_a'");
  assert.equal(view(sync(ctxOf(raw), { events: [] }), "rec_a"), "allow");
  raw.run("DELETE FROM access_grants WHERE id = 'gr_sql'");
  assert.equal(view(sync(ctxOf(raw), { events: [] }), "rec_a"), "deny");
  // the store's own cursor row, changed behind it, is read again too
  raw.run("UPDATE access_local_cursor SET seq = 1 WHERE id = 'seed_cursor'");
  const again = sync(ctxOf(raw), { events: [{ seq: 4, type: "resource.created", payload: { id: "fld_a", type: "folder", parent_id: SPACE, label: 2, owner_id: "usr_owner", holds: 0 } }] });
  assert.equal(again.resource("fld_a")?.label, 2, "an event above the cursor as the table now holds it is folded");
  raw.close();
});

test("4 every table the store reads moves the write counter on insert, update and delete", () => {
  const { db: raw } = fresh("triggers");
  const read = new Set<string>();
  const spy: Db = { all: (sql, ...a) => { const m = /\bFROM\s+"?([A-Za-z0-9_]+)/i.exec(sql); if (m) read.add(m[1]!); return raw.all(sql, ...a); }, run: (sql, ...a) => raw.run(sql, ...a) };
  loadStore(spy);   // seeds the empty tables
  loadStore(spy);   // reads them
  read.delete("access_local_stamp");
  assert.ok(read.size >= 12, [...read].join(", "));
  const triggers = raw.all("SELECT tbl_name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'access_stamp_%'") as { tbl_name: string; sql: string }[];
  for (const t of read) for (const op of ["INSERT", "UPDATE", "DELETE"]) {
    assert.ok(triggers.some((x) => x.tbl_name === t && new RegExp(`AFTER ${op} ON`, "i").test(x.sql)), `${t} has a counter trigger AFTER ${op}`);
  }
  const n = (): number => Number((raw.all(`SELECT n FROM access_local_stamp WHERE id = 1`)[0] as { n: number }).n);
  const at = n();
  raw.run("INSERT INTO access_fields (k, rank) VALUES ('x.y', 1)");
  raw.run("UPDATE access_fields SET rank = 2 WHERE k = 'x.y'");
  raw.run("INSERT OR REPLACE INTO access_fields (k, rank) VALUES ('x.y', 3)");
  raw.run("INSERT INTO access_fields (k, rank) VALUES ('x.y', 4) ON CONFLICT(k) DO UPDATE SET rank = max(rank, excluded.rank)");
  raw.run("DELETE FROM access_fields WHERE k = 'x.y'");
  assert.equal(n(), at + 5, "one step per row written, which is what each statement's change count says");
  raw.close();
});

test("5 a restart does not fold again objects registered since the last other change, so a label set on one since is kept", () => {
  const { file, db: first } = fresh("cursor");
  const log: LogEvent[] = [
    { seq: 1, type: "resource.created", payload: { id: SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_owner", holds: 0 } },
    { seq: 2, type: "principal.created", payload: { id: "usr_fay", kind: "person", name: "Fay", status: "active" } },
    { seq: 3, type: "principal.role_set", payload: { holder: "usr_fay", role: "rol_member" } },
  ];
  sync(ctxOf(first), { events: log });
  const made: LogEvent = { seq: 4, type: "resource.created", payload: { id: "fld_hr", type: "folder", parent_id: SPACE, label: 0, owner_id: "usr_owner", holds: 0 } };
  log.push(made);
  sync(ctxOf(first), { events: [made] });   // an objects-only batch
  assert.equal(setLabel(ctxOf(first), { resource: { type: "folder", id: "fld_hr" }, label: "restricted" }), true);
  sync(ctxOf(first), { events: [] });
  first.close();
  const raw = openDb(file);   // the server starts again and hands its whole log over
  const snap = sync(ctxOf(raw), { events: log });
  assert.equal(snap.resource("fld_hr")?.label, 3, "the folder is still Restricted");
  assert.equal(authorize(snap, { principal: "usr_fay", action: { perm: null, level: "view" }, resource: { type: "folder", id: "fld_hr" }, now: NOW }).effect, "deny");
  assert.deepEqual(raw.all("SELECT id, seq FROM access_local_cursor").map((row) => ({ ...(row as object) })), [{ id: "seed_cursor", seq: 4 }]);
  raw.close();
});
