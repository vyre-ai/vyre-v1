// Seeded random worlds for the authorize property tests (scopeFor agreement, agent rules). Deterministic: the same seed is the same world, so a failure names its seed and replays.
import { AccessSnapshot } from "./snapshot.ts";
import type { Conditions, Expr, GrantRow, Level } from "./types.ts";

export const NOW = 1_000;
export type Row = { id: string; owner_id: string | null; label: number; holds: number; stage: string; amount: number; region: string | null };

export function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0;
  const next = (): number => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const int = (n: number): number => Math.floor(next() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)]!;
  const chance = (p: number): boolean => next() < p;
  return { next, int, pick, chance };
}
type R = ReturnType<typeof rng>;

export const PERSONS = ["p1", "p2", "p3"] as const;
export const AGENT = "a1", SVC = "s1";
export const LEVELS: readonly Level[] = ["view", "use", "edit", "manage"];

function expr(r: R, depth: number): Expr {
  if (depth > 0 && r.chance(0.3)) return { op: r.pick(["and", "or"] as const), args: [expr(r, depth - 1), expr(r, depth - 1)] };
  switch (r.int(6)) {
    case 0: return { op: "eq", field: "stage", value: r.pick(["a", "b", "c"]) };
    case 1: return { op: "ne", field: "stage", value: r.pick(["a", "b"]) };
    case 2: return { op: r.pick(["lt", "lte", "gt", "gte"] as const), field: "amount", value: r.int(100) };
    case 3: return { op: "in", field: "stage", values: r.pick([["a", "b"], ["c"], []]) };
    case 4: return { op: r.pick(["eq", "ne"] as const), field: "region", value: r.pick([null, "eu", "us"]) };
    default: return { op: "owner_me" };
  }
}

export interface World {
  snap: AccessSnapshot;
  rows: Row[];
  byId: Map<string, Row>;
}

/** Roles: owner and admin carry everything (and `access.manage`, which only they hold); member reads and writes; guest reads. */
export function buildWorld(seed: number, opts: { agentElevated?: boolean } = {}): World {
  const r = rng(seed);
  const snap = new AccessSnapshot();
  snap.putRole({ id: "owner", clearance: 3, perms: ["records.read", "records.write", "access.manage", "access.view_as"], name: "Owner" });
  snap.putRole({ id: "admin", clearance: 3, perms: ["records.read", "records.write", "access.manage"], name: "Admin" });
  snap.putRole({ id: "member", clearance: 1 + r.int(2), perms: ["records.read", "records.write"], name: "Member" });
  snap.putRole({ id: "guest", clearance: r.int(2), perms: ["records.read"], name: "Guest" });
  snap.putRole({ id: "none", clearance: 0, perms: [], name: "None" });
  for (const p of PERSONS) snap.putPrincipal({ id: p, kind: "person", status: r.chance(0.07) ? "suspended" : "active", name: p });
  snap.putPrincipal({ id: AGENT, kind: "agent", owner: "p1", status: r.chance(0.05) ? "suspended" : "active", name: AGENT });
  snap.putPrincipal({ id: SVC, kind: "svc", owner: "p2", status: "active", name: SVC });
  const roleNames = ["member", "guest", "none", "owner", "admin"];
  // Keep legacy Owner assignments in the worlds, and include valid direct Admin roles for people/services.
  const holders = [...PERSONS, AGENT, SVC, "g1", "g2"];
  for (const h of holders) {
    const n = r.int(3);
    for (let i = 0; i < n; i++) {
      const role = h === AGENT && !opts.agentElevated ? r.pick(["member", "guest", "none"]) : h === AGENT || h.startsWith("g") ? r.pick(roleNames) : r.pick(["member", "guest", "none", "owner", "admin"]);
      snap.addPrincipalRole({ holder: h, role });
    }
  }
  for (const m of [...PERSONS, AGENT, SVC]) for (const g of ["g1", "g2"]) if (r.chance(0.3)) snap.addMember({ group: g, member: m });
  if (r.chance(0.3)) snap.addMember({ group: "g1", member: "g2" });

  snap.putResource({ id: "root", type: "folder", parent_id: null, label: 0, owner_id: null, holds: 0 });
  snap.putResource({ id: "f1", type: "folder", parent_id: "root", label: r.int(2), owner_id: r.pick(["p1", "p2", null]), holds: 0 });
  snap.putResource({ id: "f2", type: "folder", parent_id: "root", label: r.int(2), owner_id: null, holds: 0 });
  snap.putResource({ id: "rt_deal", type: "record_type", parent_id: r.pick(["f1", "root"]), label: 0, owner_id: null, holds: 0 });
  const rows: Row[] = [];
  for (let i = 0; i < 12; i++) {
    const row: Row = { id: `r${i}`, owner_id: r.pick(["p1", "p2", "p3", null]), label: r.int(3), holds: r.chance(0.15) ? 1 : 0, stage: r.pick(["a", "b", "c"]), amount: r.int(100), region: r.pick([null, "eu", "us"]) };
    rows.push(row);
    snap.putResource({ id: row.id, type: "deal", parent_id: r.pick(["rt_deal", "f1", "f2"]), label: row.label, owner_id: row.owner_id, holds: row.holds });
  }
  const byId = new Map(rows.map((x) => [x.id, x]));
  snap.rowSource = (id) => byId.get(id) as unknown as Record<string, unknown> | undefined;

  const ng = 2 + r.int(8);
  for (let i = 0; i < ng; i++) {
    const kind = r.pick(["actor", "role", "group"] as const);
    const subject_id = kind === "actor" ? r.pick([...PERSONS, AGENT, SVC]) : kind === "role" ? r.pick(["member", "guest", "none"]) : r.pick(["g1", "g2"]);
    const w4 = r.int(10), where = w4 < 4 ? 0 : w4 < 6 ? 1 : w4 < 8 ? 2 : 3;
    const [resource_type, resource_id] = where === 0 ? ["deal", null] as const : where === 1 ? ["deal", `r${r.int(12)}`] as const : where === 2 ? ["folder", r.pick(["root", "f1", "f2"])] as const : ["record_type", "rt_deal"] as const;
    const c: Conditions = {};
    if (r.chance(0.55)) c.rowFilter = expr(r, 2);
    if (r.chance(0.15)) c.notBefore = r.pick([500, 1500]);
    if (r.chance(0.1)) c.notAfter = r.pick([500, 1500]);
    const g: GrantRow = { id: `gr${i}`, subject_kind: kind, subject_id, resource_type, resource_id, level: r.pick(LEVELS), conditions: c, expires_at: r.chance(0.15) ? r.pick([500, 1500]) : null };
    snap.putGrant(g);
  }
  return { snap, rows, byId };
}
