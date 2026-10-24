// Access checker, policies, labels, outside actors. access.check is authorize with the plain-words trace on.
import { authorize } from "../../../kernel/src/authorize/index.ts";
import type { Level, Req } from "../../../kernel/src/authorize/index.ts";
import type { AccessCtx, ActorRec, Label, PKind, PolicyKind, PolicyRec, Ref, ResourceRef } from "../projections.ts";
import { changed, kindFor, LABELS, nid, page, pkey, raise, storeOf } from "../projections.ts";
import { putPrincipal, rolesAssign } from "./roles.ts";

const DESTRUCTIVE = new Set(["records.delete", "files.delete", "members.remove"]);
const TOKEN_MS = 10 * 60 * 1000;

export interface CheckIn {
  principal: Ref;
  actingFor?: Ref;
  action: { perm?: string; level: Level };
  resource: ResourceRef;
  fields?: string[];
  provider?: string;
}

/** The request the checker, authorize and scopeFor share, so the three stay on the same inputs. */
export function toReq(ctx: AccessCtx, input: CheckIn): Req {
  const store = storeOf(ctx);
  const perm = input.action.perm ?? null;
  const row = store.resourceRow(input.resource.id);
  let provider = input.provider;
  if (!provider) {
    const actor = store.actors.get(input.principal.id);
    if (actor?.provider) provider = actor.provider;
  }
  const req: Req = {
    principal: input.principal.id,
    action: { perm, level: input.action.level, destructive: perm !== null && DESTRUCTIVE.has(perm) },
    resource: { type: input.resource.type, id: input.resource.id },
    explain: true,
    now: ctx.now(),
  };
  if (input.actingFor && input.actingFor.id !== input.principal.id) req.actingFor = input.actingFor.id;
  if (input.fields) req.fields = input.fields;
  if (row) req.row = row;
  if (provider) req.provider = provider;
  return req;
}

export async function check(ctx: AccessCtx, input: CheckIn) {
  const store = storeOf(ctx);
  const d = authorize(store.snapshot(), toReq(ctx, input));
  return {
    decision: {
      effect: d.effect,
      reason: d.reason,
      steps: d.steps.map((s) => ({ ok: s.ok, text: s.text })),
      decisionId: d.decisionId,
    },
  };
}

export async function viewAs(ctx: AccessCtx, input: { person: string }) {
  const store = storeOf(ctx);
  if (!store.principals.has(input.person)) raise(ctx.trace.traceId, "validation.not_found", "no such person");
  const expiresAt = ctx.now() + TOKEN_MS;
  const previewToken = `vas_${nid("tok").slice(4)}`;
  ctx.emit("view_as.started", input.person, { target: input.person, expiresAt });
  return { previewToken, expiresAt };
}

export async function policiesList(ctx: AccessCtx, input: { kind?: PolicyKind }) {
  const store = storeOf(ctx);
  const policies = [...store.policies.values()].filter((p) => !input.kind || p.kind === input.kind).sort((a, b) => (a.key < b.key ? -1 : 1)).map(policyView);
  return { policies };
}

export async function policiesSet(ctx: AccessCtx, input: { key: string; scope: string; value: unknown }) {
  const store = storeOf(ctx);
  const kind = kindFor(input.key);
  const rec: PolicyRec = { key: input.key, scope: input.scope, kind, value: input.value, updatedAt: ctx.now() };
  store.policies.set(pkey(rec.key, rec.scope), rec);
  store.bump();
  ctx.emit("policy.changed", rec.key, { key: rec.key, scope: rec.scope, kind: rec.kind, by: ctx.principal.id });
  try { store.persist(ctx.db); } catch (e) { store.bump(); throw e; }
  return { policy: policyView(rec) };
}

const DEFAULTS: Record<string, { kind: PolicyKind; value: unknown }> = {
  "labels.provider": { kind: "provider_label", value: { allow: { local: 3 }, defaultMax: 1 } },
  "sharing.public_links": { kind: "sharing", value: "admins" },
  "sign_in.second_factor": { kind: "sign_in", value: { floor: "optional" } },
  "retention.default": { kind: "retention", value: { days: 0 } },
  "vault.ladder": { kind: "vault", value: { order: ["use", "view", "edit", "manage"] } },
};

export async function policiesReset(ctx: AccessCtx, input: { key: string; scope: string }) {
  const store = storeOf(ctx);
  const id = pkey(input.key, input.scope);
  const cur = store.policies.get(id);
  const spec = DEFAULTS[input.key];
  if (!cur && !spec) raise(ctx.trace.traceId, "validation.not_found", "no such policy");
  if (spec) store.policies.set(id, { key: input.key, scope: input.scope, kind: spec.kind, value: spec.value, updatedAt: ctx.now() });
  else store.policies.delete(id);
  const kind = spec?.kind ?? cur!.kind;
  store.bump();
  ctx.emit("policy.changed", input.key, { key: input.key, scope: input.scope, kind, by: ctx.principal.id });
  try { store.persist(ctx.db); } catch (e) { store.bump(); throw e; }
  return { ok: true };
}

function policyView(p: PolicyRec) {
  return { key: p.key, scope: p.scope, kind: p.kind, value: p.value, updatedAt: p.updatedAt };
}

export async function labelsList(_ctx: AccessCtx, _input: Record<string, unknown>) {
  return { labels: LABELS.map((l) => ({ ...l })) };
}

export async function labelsSet(ctx: AccessCtx, input: { resource: ResourceRef; label: Label }) {
  const store = storeOf(ctx);
  const cur = store.resources.get(input.resource.id);
  if (cur) cur.label = input.label;
  else store.resources.set(input.resource.id, {
    id: input.resource.id, type: input.resource.type, parentId: null, label: input.label, ownerId: null, holds: 0,
  });
  changed(ctx, store, "label");
  return { ok: true };
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function secret(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function actorView(store: ReturnType<typeof storeOf>, a: ActorRec) {
  const p = store.principals.get(a.id);
  const out: {
    id: string; name: string; owner: string; provider: string; roles: string[];
    status: ActorRec["status"]; engineerMcp: boolean; lastSeenAt?: number;
  } = {
    id: a.id, name: p?.name ?? a.id, owner: p?.owner ?? "", provider: a.provider,
    roles: store.rolesOf(a.id), status: a.status, engineerMcp: a.engineerMcp,
  };
  if (a.lastSeenAt !== undefined) out.lastSeenAt = a.lastSeenAt;
  return out;
}

export async function actorsList(ctx: AccessCtx, input: { cursor?: string; limit?: number }) {
  const store = storeOf(ctx);
  const all = [...store.actors.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((a) => actorView(store, a));
  const p = page(all, input.cursor, input.limit);
  return { actors: p.rows, total: p.total, ...(p.next ? { next: p.next } : {}) };
}

export async function actorsCreate(ctx: AccessCtx, input: { name: string; provider: string; roleIds?: string[]; idempotencyKey: string }) {
  const store = storeOf(ctx);
  const key = `actors.create:${input.idempotencyKey}`;
  const hit = store.idem.get(key);
  if (hit) return hit as { actor: ReturnType<typeof actorView>; oneTimeToken: string; expiresAt: number };
  const name = input.name.trim();
  if (!name || !input.provider.trim()) raise(ctx.trace.traceId, "validation.bad_input", "name and provider are required");
  const id = nid("act");
  const token = secret();
  const expiresAt = ctx.now() + TOKEN_MS;
  putPrincipal(store, { id, kind: "actor", name, owner: ctx.principal.id, status: "invited", createdAt: ctx.now() });
  const actor: ActorRec = {
    id, provider: input.provider.trim(), status: "pending", engineerMcp: false,
    tokenHash: await sha256(token), tokenExpires: expiresAt, tokenUsed: false,
  };
  store.actors.set(id, actor);
  for (const roleId of input.roleIds ?? []) await rolesAssign(ctx, { subject: { kind: "actor", id }, roleId });
  ctx.emit("principal.created", id, { principalId: id, kind: "actor" as PKind, owner: ctx.principal.id });
  changed(ctx, store, "actor");
  const out = { actor: actorView(store, actor), oneTimeToken: token, expiresAt };
  store.idem.set(key, out);
  return out;
}

export async function actorsRedeem(ctx: AccessCtx, input: { token: string }) {
  const store = storeOf(ctx);
  const hash = await sha256(input.token);
  const actor = [...store.actors.values()].find((a) => a.tokenHash === hash);
  if (!actor || actor.tokenUsed || actor.status === "revoked") raise(ctx.trace.traceId, "auth.invalid_code", "the token is wrong or already used");
  if ((actor.tokenExpires ?? 0) <= ctx.now()) raise(ctx.trace.traceId, "permission.expired", "the one-time token has expired");
  const credential = secret();
  actor.tokenUsed = true;
  actor.status = "active";
  actor.credHash = await sha256(credential);
  actor.lastSeenAt = ctx.now();
  const p = store.principals.get(actor.id);
  if (p) p.status = "active";
  store.bump();
  try { store.persist(ctx.db); } catch (e) { store.bump(); throw e; }
  return { actorId: actor.id, credential };
}

export async function actorsUpdate(ctx: AccessCtx, input: { actorId: string; roleIds?: string[]; provider?: string }) {
  const store = storeOf(ctx);
  const actor = store.actors.get(input.actorId);
  if (!actor) raise(ctx.trace.traceId, "validation.not_found", "no such actor");
  if (input.provider !== undefined) actor.provider = input.provider.trim();
  if (input.roleIds) {
    for (const roleId of input.roleIds) if (!store.roles.has(roleId)) raise(ctx.trace.traceId, "validation.not_found", "no such role");
    store.setRoles(actor.id, [...input.roleIds]);
  }
  changed(ctx, store, "actor");
  return { actor: actorView(store, actor) };
}

export async function actorsRevoke(ctx: AccessCtx, input: { actorId: string }) {
  const store = storeOf(ctx);
  const actor = store.actors.get(input.actorId);
  if (!actor) raise(ctx.trace.traceId, "validation.not_found", "no such actor");
  actor.status = "revoked";
  actor.tokenUsed = true;
  delete actor.credHash;
  const p = store.principals.get(actor.id);
  if (p) p.status = "removed";
  store.bump();
  ctx.emit("token.revoked", actor.id, { actorId: actor.id, by: ctx.principal.id });
  ctx.emit("access.changed", String(store.epoch), { epoch: store.epoch, what: "actor", by: ctx.principal.id });
  try { store.persist(ctx.db); } catch (e) { store.bump(); throw e; }
  return { ok: true };
}

export async function actorsEngineer(ctx: AccessCtx, input: { actorId: string; enabled: boolean }) {
  const store = storeOf(ctx);
  const actor = store.actors.get(input.actorId);
  if (!actor) raise(ctx.trace.traceId, "validation.not_found", "no such actor");
  actor.engineerMcp = input.enabled;
  changed(ctx, store, "actor");
  return { actor: actorView(store, actor) };
}

export async function projectionHealth(ctx: AccessCtx, _input: Record<string, unknown>) {
  const t0 = Date.now();
  const store = storeOf(ctx);
  const snap = store.snapshot();
  const latencyMs = Date.now() - t0;
  if (!snap) return { state: "down" as const, detail: "snapshot missing", latencyMs };
  return { state: "healthy" as const, detail: `epoch ${store.epoch}`, latencyMs };
}

