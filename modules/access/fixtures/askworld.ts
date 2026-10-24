// A small Space for the access request and review tests: an admin, two people who hold Manage on folders, two members and a guest.
import { authorize } from "../../../kernel/src/authorize/index.ts";
import type { Level } from "../../../kernel/src/authorize/index.ts";
import { storeOf } from "../projections.ts";
import type { AccessStore, GrantRec } from "../projections.ts";
import { harness, NOW } from "./requestdb.ts";
import type { Answer, Harness } from "./requestdb.ts";

export const PEOPLE = {
  usr_admin: "rol_admin", usr_mgr: "rol_member", usr_mgr2: "rol_member", usr_maya: "rol_member", usr_other: "rol_member", usr_gus: "rol_guest",
} as const;

export function grant(id: string, person: string, resource: { type: string; id: string }, level: GrantRec["level"], extra: Partial<GrantRec> = {}): GrantRec {
  return { id, subject: { kind: "person", id: person }, resource, level, conditions: {}, by: "usr_admin", createdAt: NOW - 1000, ...extra };
}

/** Folder fld_1 (Rivera matters) is managed by usr_mgr, fld_2 by usr_mgr2. usr_maya may view fld_1. */
export function world(answers: Record<string, Answer> = {}): { h: Harness; store: AccessStore } {
  const h = harness(answers);
  const store = storeOf(h.as("usr_admin"));
  for (const [id, role] of Object.entries(PEOPLE)) {
    store.principals.set(id, { id, kind: "person", name: id.replace("usr_", ""), status: "active", createdAt: 1 });
    store.setRoles(id, [role]);
  }
  store.resources.set("fld_1", { id: "fld_1", type: "folder", parentId: null, label: "internal", ownerId: null, holds: 0, row: { name: "Rivera matters" } });
  store.resources.set("fld_2", { id: "fld_2", type: "folder", parentId: null, label: "internal", ownerId: null, holds: 0, row: { name: "Intake" } });
  for (const g of [
    grant("gnt_mgr1", "usr_mgr", { type: "folder", id: "fld_1" }, "manage"),
    grant("gnt_mgr2", "usr_mgr2", { type: "folder", id: "fld_2" }, "manage"),
    grant("gnt_maya", "usr_maya", { type: "folder", id: "fld_1" }, "view"),
  ]) store.grants.set(g.id, g);
  store.bump();
  return { h, store };
}

/** What the authorize kernel says about a person at a level, straight from the store. */
export function can(h: Harness, store: AccessStore, person: string, level: Level, resource: { type: string; id: string }): boolean {
  return authorize(store.snapshot(), { principal: person, action: { perm: null, level }, resource, now: h.now() }).effect === "allow";
}
