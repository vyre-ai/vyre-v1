// Seeded access worlds for the checker property test. The same seed is the same world.
import type { Expr } from "../../../kernel/src/authorize/index.ts";
import type { AccessStore, Cond, Label, Level, PKind, SubjectKind } from "../projections.ts";

export interface Case {
  principal: { kind: PKind; id: string };
  actingFor?: { kind: PKind; id: string };
  action: { perm: string; level: Level };
  resource: { type: string; id: string };
}

const LEVELS: readonly Level[] = ["view", "use", "edit", "manage"];
const LABELS: readonly Label[] = ["public", "internal", "confidential", "restricted"];
const PEOPLE = ["p1", "p2", "p3"] as const;
const ROLES = ["rol_member", "rol_guest", "rol_w_edit", "rol_w_none"] as const;

function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)]!;
  const chance = (p: number): boolean => next() < p;
  return { int, pick, chance };
}
type R = ReturnType<typeof rng>;

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

function addPrincipal(store: AccessStore, id: string, kind: PKind, status: "active" | "suspended", owner?: string): void {
  const rec: { id: string; kind: PKind; name: string; status: "active" | "suspended"; createdAt: number; owner?: string } = {
    id, kind, name: id, status, createdAt: 1,
  };
  if (owner) rec.owner = owner;
  store.principals.set(id, rec);
}

/** Built-ins stay. Adds a small Space plus two fixed cases: an allow and a role denial. */
export function loadWorld(store: AccessStore, seed: number, now: number): Case[] {
  const r = rng(seed);
  store.roles.set("rol_w_edit", {
    id: "rol_w_edit", name: "Worker", builtIn: false, clearance: "restricted", assignableToAgents: true,
    permissions: ["records.edit", "records.delete"],
  });
  store.roles.set("rol_w_none", {
    id: "rol_w_none", name: "Blank", builtIn: false, clearance: "public", assignableToAgents: true, permissions: [],
  });
  for (const id of PEOPLE) addPrincipal(store, id, "person", r.chance(0.08) ? "suspended" : "active");
  addPrincipal(store, "a1", "agent", r.chance(0.05) ? "suspended" : "active", "p1");
  addPrincipal(store, "s1", "service", "active", "p2");
  addPrincipal(store, "p_allow", "person", "active");
  addPrincipal(store, "p_deny", "person", "active");
  store.setRoles("p_allow", ["rol_w_edit"]);
  store.setRoles("p_deny", ["rol_w_none"]);

  const members = [...PEOPLE, "a1"];
  for (const gid of ["grp_w1", "grp_w2"] as const) {
    const picked = members.filter(() => r.chance(0.5)).map((id) => ({ kind: (id === "a1" ? "agent" : "person") as PKind, id }));
    store.groups.set(gid, { id: gid, name: gid, builtIn: false, members: picked, managers: [] });
    if (r.chance(0.5)) store.setRoles(gid, [r.pick(ROLES)]);
  }
  for (const id of [...PEOPLE, "a1", "s1"]) {
    const n = r.int(3);
    const roles: string[] = [];
    for (let i = 0; i < n; i++) roles.push(r.pick(ROLES));
    if (roles.length) store.setRoles(id, roles);
  }

  store.resources.set("fld_root", { id: "fld_root", type: "folder", parentId: null, label: "public", ownerId: null, holds: 0 });
  store.resources.set("fld_a", { id: "fld_a", type: "folder", parentId: "fld_root", label: "public", ownerId: null, holds: 0 });
  store.resources.set("fld_b", { id: "fld_b", type: "folder", parentId: "fld_root", label: "internal", ownerId: null, holds: 0 });
  const records: string[] = [];
  for (let i = 0; i < 6; i++) {
    const id = `rec_w${i}`;
    records.push(id);
    const owner = r.pick(["p1", "p2", "p3", null]);
    const label = r.pick(LABELS);
    store.resources.set(id, {
      id, type: "record", parentId: r.pick(["fld_a", "fld_b", "fld_root"]), label, ownerId: owner, holds: r.chance(0.15) ? 1 : 0,
      row: { stage: r.pick(["a", "b", "c"]), amount: r.int(100), region: r.pick([null, "eu", "us"]) },
    });
  }
  store.resources.set("rec_fxa", {
    id: "rec_fxa", type: "record", parentId: "fld_root", label: "public", ownerId: null, holds: 0,
    row: { stage: "a", amount: 1, region: "us" },
  });
  store.resources.set("rec_fxd", {
    id: "rec_fxd", type: "record", parentId: "fld_root", label: "public", ownerId: null, holds: 0,
    row: { stage: "a", amount: 1, region: "us" },
  });

  for (let i = 0; i < 6; i++) {
    const which = r.int(3);
    let subjectKind: SubjectKind;
    let subjectId: string;
    if (which === 0) {
      subjectKind = r.pick(["person", "agent", "service"] as const);
      subjectId = subjectKind === "person" ? r.pick(PEOPLE) : subjectKind === "agent" ? "a1" : "s1";
    } else if (which === 1) {
      subjectKind = "role";
      subjectId = r.pick(ROLES);
    } else {
      subjectKind = "group";
      subjectId = r.pick(["grp_w1", "grp_w2"] as const);
    }
    const place = r.int(3);
    const resource = place === 0
      ? { type: "record", id: "*" }
      : place === 1
        ? { type: "folder", id: r.pick(["fld_root", "fld_a", "fld_b"] as const) }
        : { type: "record", id: r.pick(records) };
    const conditions: Cond = {};
    if (r.chance(0.45)) conditions.rowFilter = expr(r, 1);
    if (r.chance(0.2)) conditions.expiresAt = r.chance(0.5) ? now - 1 : now + 50_000;
    if (r.chance(0.15)) conditions.window = r.chance(0.5) ? { from: now + 5_000, to: now + 9_000 } : { from: now - 5_000, to: now + 5_000 };
    if (r.chance(0.1)) conditions.hiddenFields = ["secret"];
    const id = `gnt_w${seed}_${i}`;
    store.grants.set(id, {
      id, subject: { kind: subjectKind, id: subjectId }, resource, level: r.pick(LEVELS), conditions, by: "usr_admin", createdAt: now,
    });
  }
  store.grants.set("gnt_fxa", {
    id: "gnt_fxa", subject: { kind: "person", id: "p_allow" }, resource: { type: "record", id: "*" },
    level: "manage", conditions: {}, by: "usr_admin", createdAt: now,
  });

  const fixed: Case[] = [
    { principal: { kind: "person", id: "p_allow" }, action: { perm: "records.edit", level: "view" }, resource: { type: "record", id: "rec_fxa" } },
    { principal: { kind: "person", id: "p_deny" }, action: { perm: "records.edit", level: "view" }, resource: { type: "record", id: "rec_fxd" } },
  ];
  const random: Case[] = [];
  for (let i = 0; i < 2; i++) {
    const who = r.pick(["p1", "p2", "p3", "a1", "s1"] as const);
    const kind: PKind = who === "a1" ? "agent" : who === "s1" ? "service" : "person";
    const row: Case = {
      principal: { kind, id: who },
      action: { perm: r.pick(["records.edit", "records.delete"] as const), level: r.pick(LEVELS) },
      resource: { type: "record", id: r.pick(records) },
    };
    if (who === "a1" && r.chance(0.75)) row.actingFor = { kind: "person", id: r.pick(PEOPLE) };
    random.push(row);
  }
  store.bump();
  return [...fixed, ...random];
}
