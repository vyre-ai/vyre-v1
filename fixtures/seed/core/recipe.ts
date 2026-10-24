// The `core` seed recipe (ARCH 10.3, F6), FROZEN: 6 people with every role, 3 groups, 2 agents, one record type, one channel, one folder tree. It is a list of events, so the seed is built
// from what the kernel has (the event log and the access projection) and needs no module code; the owning lanes' stubs can go live without touching it.
// Changing anything here changes `CORE_SHAPE_HASH` in core.seed.test.ts, which only the lead updates.
import type { NewEvent } from "../../../kernel/src/log/types.ts";
import { ROLE_IDS, ROLE_PERMS } from "../../../kernel/src/grants/roles.ts";

export const CORE_SPACE = "spc_core";
const TRACE = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";

/** The people, one per role plus a second member. */
export const PEOPLE = [
  { id: "usr_olivia", name: "Olivia Park", role: "owner" },
  { id: "usr_adam", name: "Adam Reyes", role: "admin" },
  { id: "usr_mia", name: "Mia Chen", role: "manager" },
  { id: "usr_noah", name: "Noah Berg", role: "member" },
  { id: "usr_sana", name: "Sana Iqbal", role: "member" },
  { id: "usr_tess", name: "Tess Okoye", role: "temp" },
] as const;
export const GROUPS = [
  { id: "grp_everyone", name: "Everyone", members: PEOPLE.map((p) => p.id) },
  { id: "grp_staff", name: "Staff", members: ["usr_olivia", "usr_adam", "usr_mia", "usr_noah", "usr_sana"] },
  { id: "grp_leads", name: "Lead team", members: ["usr_mia", "usr_noah"] },
] as const;
export const AGENTS = [
  { id: "agt_scout", name: "Scout", owner: "usr_noah" },
  { id: "agt_helper", name: "Helper", owner: "usr_mia" },
] as const;
/** Role clearance: owner and admin see Privileged (3), manager and member Sensitive (2)... temp Normal (0). */
export const CLEARANCE: Record<string, number> = { owner: 3, admin: 3, manager: 2, member: 1, temp: 0 };

export const RECORD_TYPE = "rt_contact";
export const CHANNEL = "chn_general";
/** A three-level folder tree under the Space. */
export const FOLDERS = [
  { id: "fld_root", parent: CORE_SPACE, name: "Shared" },
  { id: "fld_clients", parent: "fld_root", name: "Clients" },
  { id: "fld_acme", parent: "fld_clients", name: "Acme" },
] as const;

let n = 0;
const ev = (type: string, entity: string, entityId: string, payload: unknown): NewEvent => ({
  id: `evt_seed_${String(++n).padStart(4, "0")}`, type, sv: 1, trace_id: TRACE, actor: "svc_seed", vis: "space", entity, entity_id: entityId, payload,
});

/** The recipe: the same list every call, in order. */
export function coreEvents(): NewEvent[] {
  n = 0;
  const out: NewEvent[] = [];
  out.push(ev("space.created", "space", CORE_SPACE, { id: CORE_SPACE, name: "Core" }));
  for (const role of ROLE_IDS) out.push(ev("role.defined", "role", role, { id: role, clearance: CLEARANCE[role], perms: [...ROLE_PERMS[role]], name: role }));
  for (const p of PEOPLE) {
    out.push(ev("principal.created", "principal", p.id, { id: p.id, kind: "person", status: "active", name: p.name }));
    out.push(ev("principal.role_set", "principal", p.id, { holder: p.id, role: p.role }));
  }
  for (const a of AGENTS) {
    out.push(ev("principal.created", "principal", a.id, { id: a.id, kind: "agent", owner: a.owner, status: "active", name: a.name }));
    out.push(ev("principal.role_set", "principal", a.id, { holder: a.id, role: "member" }));
  }
  for (const g of GROUPS) {
    out.push(ev("group.created", "group", g.id, { id: g.id, name: g.name }));
    for (const m of g.members) out.push(ev("group.member_added", "group", g.id, { group: g.id, member: m }));
  }
  out.push(ev("resource.created", "resource", CORE_SPACE, { id: CORE_SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_olivia", holds: 0 }));
  out.push(ev("resource.created", "resource", RECORD_TYPE, { id: RECORD_TYPE, type: "record_type", parent_id: CORE_SPACE, label: 0, owner_id: "usr_olivia", holds: 0 }));
  out.push(ev("resource.created", "resource", CHANNEL, { id: CHANNEL, type: "channel", parent_id: CORE_SPACE, label: 0, owner_id: "usr_olivia", holds: 0 }));
  for (const f of FOLDERS) out.push(ev("resource.created", "resource", f.id, { id: f.id, type: "folder", parent_id: f.parent, label: 0, owner_id: "usr_olivia", holds: 0 }));
  // sharing: Staff edit the Shared tree; the lead team manages Clients; the temp person sees one folder
  out.push(ev("grant.created", "grant", "gr_staff_shared", { id: "gr_staff_shared", subject_kind: "group", subject_id: "grp_staff", resource_type: "folder", resource_id: "fld_root", level: "edit", by: "usr_olivia" }));
  out.push(ev("grant.created", "grant", "gr_leads_clients", { id: "gr_leads_clients", subject_kind: "group", subject_id: "grp_leads", resource_type: "folder", resource_id: "fld_clients", level: "manage", by: "usr_olivia" }));
  out.push(ev("grant.created", "grant", "gr_tess_acme", { id: "gr_tess_acme", subject_kind: "actor", subject_id: "usr_tess", resource_type: "folder", resource_id: "fld_acme", level: "view", by: "usr_mia" }));
  return out;
}
