// Test world for the pull and snapshot packets: three people with different clearance, and the grants that decide who sees which contact.
// ada (owner role, clearance 3) sees every record. bo (member, clearance 1) sees contacts in region eu only, and never their phone field. cy (guest, clearance 0) holds no grant.
import { AccessSnapshot } from "../../../kernel/src/authorize/snapshot.ts";
import type { Expr } from "../../../kernel/src/authorize/types.ts";

export const ADA = "usr_ada";
export const BO = "usr_bo";
export const CY = "usr_cy";
export const NOW = 1_760_000_000_000;

export function buildAccess(opts: { boFilter?: Expr | null; boHidden?: string[] } = {}): AccessSnapshot {
  const snap = new AccessSnapshot();
  snap.putRole({ id: "owner", clearance: 3, perms: ["records.read"], name: "Owner" });
  snap.putRole({ id: "member", clearance: 1, perms: ["records.read"], name: "Member" });
  snap.putRole({ id: "guest", clearance: 0, perms: ["records.read"], name: "Guest" });
  for (const id of [ADA, BO, CY]) snap.putPrincipal({ id, kind: "person", status: "active", name: id });
  snap.addPrincipalRole({ holder: ADA, role: "owner" });
  snap.addPrincipalRole({ holder: BO, role: "member" });
  snap.addPrincipalRole({ holder: CY, role: "guest" });
  for (const type of ["record", "thread", "space", "file", "number"]) {
    snap.putGrant({ id: `gr_ada_${type}`, subject_kind: "actor", subject_id: ADA, resource_type: type, resource_id: null, level: "manage" });
    snap.putGrant({
      id: `gr_bo_${type}`, subject_kind: "actor", subject_id: BO, resource_type: type, resource_id: null, level: "view",
      conditions: { rowFilter: opts.boFilter === undefined ? { op: "eq", field: "region", value: "eu" } : opts.boFilter ?? undefined, hiddenFields: opts.boHidden ?? ["phone"] },
    });
  }
  return snap;
}

export const CONTACT_TYPE = Object.freeze({
  name: "contact",
  fields: ["name", "email", "phone", "region", "stage", "owner", "amount"].map((n) => ({ name: n, kind: n === "amount" ? "number" : "text" })),
});
