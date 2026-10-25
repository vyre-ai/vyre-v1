// Suspend, reactivate and the removal wizard (spec 2.1 lifecycle, 3.10 offboarding, ARCH 7.10, 5.7).
// The wizard lists each kind of thing the person owns with a default (spec 3.10): routines pause, owned automations, agents, records, files, channels and projects are reassigned
// with a diff, mailbox connections are revoked (filed mail stays), Mine items are exportable for 30 days then destroyed, private chats are retained then deleted per retention,
// "From you" facts are kept unless erased. Applying the plan ends every device of the person (their replicas purge on next contact), takes their roles and groups away,
// and leaves the Space key epoch rotation to the admin's device, which is the only place that can wrap a new key (the server holds ciphertext only).
import type { MembersCtx, OwnedItem, RemovalAction, RemovalKind } from "../projections.ts";
import { DAY_MS, EXPORT_DAYS, OWNER_ROLE, me, raise, statusOf } from "../projections.ts";

const ok = { ok: true } as const;

export const KINDS: readonly RemovalKind[] = [
  "routines", "automations", "agents", "records", "files", "channels", "projects", "mailbox_connections", "vault_mine", "private_chats", "memory_from_you",
];
/** Default action and the choices offered, per kind. */
export const WIZARD: Readonly<Record<RemovalKind, { def: RemovalAction; options: readonly RemovalAction[] }>> = {
  routines: { def: "pause", options: ["pause", "reassign", "delete"] },
  automations: { def: "reassign", options: ["reassign", "pause", "delete"] },
  agents: { def: "reassign", options: ["reassign", "pause", "delete"] },
  records: { def: "reassign", options: ["reassign", "retain"] },
  files: { def: "reassign", options: ["reassign", "retain"] },
  channels: { def: "reassign", options: ["reassign", "retain"] },
  projects: { def: "reassign", options: ["reassign", "retain"] },
  mailbox_connections: { def: "revoke", options: ["revoke"] },
  vault_mine: { def: "export", options: ["export", "delete"] },
  private_chats: { def: "retain", options: ["retain", "delete"] },
  memory_from_you: { def: "keep", options: ["keep", "delete"] },
};
const REASSIGNABLE = new Set<RemovalAction>(["reassign"]);

interface PrincipalOut { principal: { id: string; kind: string; name: string; status: string; roles: string[]; groups: string[] } }

async function principalOf(ctx: MembersCtx, personId: string): Promise<PrincipalOut["principal"]> {
  const out = (await ctx.call("access.principals.get", { principal: { kind: "person", id: personId } })) as PrincipalOut;
  if (out.principal.kind !== "person") raise(ctx.trace.traceId, "validation.bad_input", "members are people");
  return out.principal;
}

/** Guard shared by suspend and remove: not yourself, not the owner. */
async function guardTarget(ctx: MembersCtx, personId: string, what: string) {
  const tid = ctx.trace.traceId;
  const who = me(ctx);
  if (who.id === personId) raise(tid, "validation.precondition_failed", `you cannot ${what} yourself; leave the Space instead`);
  const p = await principalOf(ctx, personId);
  if (p.roles.includes(OWNER_ROLE)) raise(tid, "validation.precondition_failed", `the owner cannot be ${what === "remove" ? "removed" : "suspended"}; transfer ownership first`);
  return p;
}

async function endDevices(ctx: MembersCtx, personId: string): Promise<number> {
  let n = 0;
  let cursor: string | undefined;
  do {
    const out = (await ctx.call("devices.list", { person: personId, ...(cursor ? { cursor } : {}), limit: 200 })) as { devices: { id: string; revokedAt?: number }[]; next?: string };
    for (const d of out.devices) {
      if (d.revokedAt) continue;
      await ctx.call("devices.revoke", { deviceId: d.id });
      n++;
    }
    cursor = out.next;
  } while (cursor);
  return n;
}

/** Gate rejectAllOf (0.6 core/gate): every hold the person asked for, or that an agent asked for on their behalf, is dropped with a note, so nothing they started goes out after they left. */
export async function rejectAllOf(ctx: MembersCtx, personId: string): Promise<number> {
  let n = 0;
  let cursor: string | undefined;
  do {
    const out = (await ctx.call("gate.holds.list", { states: ["held"], ...(cursor ? { cursor } : {}), limit: 200 })) as
      { holds: { id: string; taskId: string; principal: { id: string }; actingFor?: string }[]; next?: string };
    for (const h of out.holds) {
      if (h.principal.id !== personId && h.actingFor !== personId) continue;
      try {
        await ctx.call("gate.deny", { holdId: h.id, taskId: h.taskId, mode: "drop", note: "The person who asked was removed from the Space." });
        n++;
      } catch { /* a hold that was resolved in the meantime is already out of the way */ }
    }
    cursor = out.next;
  } while (cursor);
  return n;
}

export async function suspend(ctx: MembersCtx, input: { personId: string; reason?: string }) {
  const tid = ctx.trace.traceId;
  const who = me(ctx);
  const st = statusOf(ctx, input.personId);
  if (st?.status === "removed") raise(tid, "validation.precondition_failed", "that person was removed");
  if (st?.status === "suspended") return ok;
  await guardTarget(ctx, input.personId, "suspend");
  ctx.db.run(`INSERT OR REPLACE INTO members_status (person_id, status, reason, by, at, plan, export_until, key_rotation_pending) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    input.personId, "suspended", input.reason ?? null, who.id, ctx.now(), null, null, 0);
  ctx.emit("principal.suspended", input.personId, { principalId: input.personId, ...(input.reason ? { reason: input.reason } : {}) });
  await endDevices(ctx, input.personId);
  return ok;
}

export async function reactivate(ctx: MembersCtx, input: { personId: string }) {
  const tid = ctx.trace.traceId;
  me(ctx);
  const st = statusOf(ctx, input.personId);
  if (!st) return ok;
  if (st.status === "removed") raise(tid, "validation.precondition_failed", "a removed person is invited again, not reactivated");
  ctx.db.run(`DELETE FROM members_status WHERE person_id = ?`, input.personId);
  ctx.emit("principal.reactivated", input.personId, { principalId: input.personId });
  return ok;
}

export async function removePreview(ctx: MembersCtx, input: { personId: string }) {
  const tid = ctx.trace.traceId;
  const who = me(ctx);
  const st = statusOf(ctx, input.personId);
  if (st?.status === "removed") raise(tid, "validation.precondition_failed", "that person was already removed");
  await guardTarget(ctx, input.personId, "remove");
  const owned = (await ctx.owned?.of(input.personId)) ?? {};
  const items = KINDS.map((kind) => {
    const o: OwnedItem = owned[kind] ?? { count: 0, sample: [] };
    const w = WIZARD[kind];
    const row: { kind: RemovalKind; count: number; defaultAction: RemovalAction; options: RemovalAction[]; reassignTo?: string; sample: OwnedItem["sample"] } = {
      kind, count: o.count, defaultAction: w.def, options: [...w.options], sample: o.sample.slice(0, 5),
    };
    if (w.options.some((a) => REASSIGNABLE.has(a))) row.reassignTo = who.id;
    return row;
  });
  return { items, exportUntil: ctx.now() + EXPORT_DAYS * DAY_MS };
}

export async function remove(ctx: MembersCtx, input: { personId: string; plan: { kind: RemovalKind; action: RemovalAction; to?: string }[]; reason?: string }) {
  const tid = ctx.trace.traceId;
  const who = me(ctx);
  // The Gate holds an agent's removal for a person and resumes it as that person; a handler never removes people on an agent's own say-so.
  if (who.kind !== "person") raise(tid, "permission.needs_approval", "removing a person needs a person's approval");
  const st = statusOf(ctx, input.personId);
  if (st?.status === "removed") return ok;
  await guardTarget(ctx, input.personId, "remove");
  const owned = (await ctx.owned?.of(input.personId)) ?? {};

  // one action per kind: what the plan says, else the wizard default
  const chosen = new Map<RemovalKind, { action: RemovalAction; to?: string }>();
  for (const step of input.plan) {
    if (!KINDS.includes(step.kind)) raise(tid, "validation.bad_input", `unknown kind ${String(step.kind)}`);
    if (chosen.has(step.kind)) raise(tid, "validation.bad_input", `${step.kind} appears twice in the plan`);
    if (!WIZARD[step.kind].options.includes(step.action)) raise(tid, "validation.bad_input", `${step.action} is not offered for ${step.kind}`);
    chosen.set(step.kind, step.to ? { action: step.action, to: step.to } : { action: step.action });
  }
  for (const kind of KINDS) if (!chosen.has(kind)) chosen.set(kind, { action: WIZARD[kind].def });

  for (const [kind, c] of chosen) {
    const count = owned[kind]?.count ?? 0;
    if (c.action === "reassign" && count > 0) {
      const to = c.to ?? who.id;
      if (to === input.personId) raise(tid, "validation.precondition_failed", `${kind} cannot be reassigned to the person being removed`);
      const target = await principalOf(ctx, to);
      if (target.status !== "active" || statusOf(ctx, to)) raise(tid, "validation.precondition_failed", `${kind} must go to an active member`);
      chosen.set(kind, { action: "reassign", to });
    } else if (c.action === "reassign") chosen.set(kind, { action: "reassign", to: c.to ?? who.id });
    if (c.action === "delete" && (ctx.owned?.holds(input.personId) ?? 0) > 0) raise(tid, "permission.on_hold", `${kind} cannot be deleted while items the person owns are on hold`);
  }

  // apply: the wizard first, then the person
  const kinds: { kind: RemovalKind; action: RemovalAction; count: number }[] = [];
  for (const kind of KINDS) {
    const c = chosen.get(kind)!;
    const count = (owned[kind]?.count ?? 0) === 0 ? 0 : (await ctx.owned?.apply(input.personId, kind, c.action, c.to)) ?? 0;
    kinds.push({ kind, action: c.action, count });
  }
  const target = await principalOf(ctx, input.personId);
  for (const roleId of target.roles) await ctx.call("access.roles.unassign", { subject: { kind: "person", id: input.personId }, roleId });
  for (const groupId of target.groups) await ctx.call("access.groups.remove_member", { groupId, member: { kind: "person", id: input.personId } });
  await rejectAllOf(ctx, input.personId);
  await endDevices(ctx, input.personId);
  ctx.db.run(`INSERT OR REPLACE INTO members_status (person_id, status, reason, by, at, plan, export_until, key_rotation_pending) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    input.personId, "removed", input.reason ?? null, who.id, ctx.now(), JSON.stringify(kinds), ctx.now() + EXPORT_DAYS * DAY_MS, 1);
  ctx.emit("member.removal_plan_applied", input.personId, { personId: input.personId, kinds });
  ctx.emit("principal.suspended", input.personId, { principalId: input.personId, reason: "removed" });
  ctx.emit("member.removed", input.personId, { personId: input.personId, by: who.id, ...(input.reason ? { reason: input.reason } : {}) });
  return ok;
}
