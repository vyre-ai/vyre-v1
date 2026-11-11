// Shared by the access.sync equivalence tests (tests/sync.incremental*.test.ts): a real SQLite db with every migration, the host's db handles, the complete comparison of two snapshots,
// and the seeded stream of events, handler calls, plain SQL and restarts.
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

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const NOW = 1_800_000_000_000;
export const SPACE = "spc_inc";
export const TRACE = "0123456789abcdef0123456789abcdef";

export type Call = (ctx: unknown, input: unknown) => unknown;
export const sync = hostCalls["access.sync"] as unknown as (ctx: unknown, input: { events: LogEvent[] }) => AccessSnapshot;
export const fromTables = hostCalls["access.snapshot"] as unknown as (ctx: unknown) => AccessSnapshot;
export const setLabel = hostCalls["access.set_resource_label"] as unknown as Call;
export const transfer = hostCalls["access.transfer_ownership"] as unknown as Call;

export function tempFile(tag: string): string {
  const dir = fs.mkdtempSync(path.join(process.env["TMPDIR"] ?? os.tmpdir(), `access-inc-${tag}-`));
  return path.join(dir, "modules.db");
}
export function fresh(tag: string): { file: string; db: HostDb } {
  const file = tempFile(tag);
  const db = openDb(file);
  migrate(db, ROOT, () => NOW);
  return { file, db };
}
/** A call's ctx as the host builds it: a new scoped handle on the daemon database every time. */
export function ctxOf(raw: HostDb, principal = "usr_owner"): AccessCtx & { origin: string; depth: number } {
  return {
    space: SPACE, principal: { kind: "person", id: principal }, trace: { traceId: TRACE }, now: () => NOW,
    db: scopedDb("access", raw, TRACE), emit: () => undefined, origin: "hook", depth: 0,
  };
}

// ---- comparing two snapshots completely

export const canon = (v: unknown): unknown => {
  if (v instanceof Map) return [...v.entries()].map(([k, x]) => [k, canon(x)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  if (v instanceof Set) return [...v].map(canon).map((x) => JSON.stringify(x)).sort();
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, canon((v as Record<string, unknown>)[k])]));
  return v;
};
/** Everything authorize can read from a snapshot. Order is left out: the old path built the snapshot in the order its own store held, which was never the tables' order either. */
export function dump(snap: AccessSnapshot): unknown {
  const s = snap as unknown as Record<string, unknown>;
  const sortedLists = (m: unknown): unknown => new Map([...(m as Map<string, string[]>)].map(([k, l]) => [k, [...l].sort()]));
  const resources = [...snap.allResources()].map((r) => r.id).sort();
  return canon({
    principals: s["principals"], roles: s["roles"], holderRoles: sortedLists(s["holderRoles"]), members: sortedLists(s["members"]), grants: s["grants"], resources: s["resources"],
    fieldLabels: s["fieldLabels"], policies: [...(s["policyList"] as unknown[])].map((p) => JSON.stringify(canon(p))).sort(), assistants: s["assistants"], labelNames: s["labelNames"],
    rows: resources.map((id) => [id, snap.rowSource?.(id)]),
  });
}

export function sameSnapshots(got: AccessSnapshot, want: AccessSnapshot, where: string, perms: readonly string[]): void {
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

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export async function stream(seed: number, steps: number): Promise<{ inPlace: number; rebuilt: number; hydrated: number; restarts: number; handler: number; external: number }> {
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

