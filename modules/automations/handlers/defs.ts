// Automation definitions (spec 2.12, 3.7; ARCH 7.7): create, update with versions, validation against the step and trigger catalogue, Groups, followers, alerts,
// webhook URL, Promote to the Space with its access diff, and the Personal copy. Starting Runs and the trigger consumer are in triggers.ts.
// DECISION: a new Automation is a draft. It turns on only when validate finds no error; saving a definition with errors is allowed while it is not on, refused while it is.
// DECISION: a definition change appends a version; a name or description change does not.
// DECISION: Promote keeps the id, history and versions, makes the Automation a Space one owned by the named person and run as its own Service principal. The access it was
// confirmed with is stored (automations_access) with the vault names it may use (automations_vault); subscription keys must be replaced by shared API keys first.
import { isTrustedService } from "../../../lib/trust.ts";
import { registry } from "../../../generated/registry.ts";
import {
  allAutomations, clean, defaultAlerts, emitAuto, findGroup, getAutomation, isOwner, listGroups, listVersions, markDeleted, markRestored, me, newId, newSecret, out, page,
  raise, readPolicy, saveAutomation, saveVersion, touch, versionById,
} from "../projections.ts";
import type { Alerts, AutoCtx, Automation, Definition, Grant, Node, Policy } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

// ---- the catalogue ----

const STEPS = new Map(registry.steps.map((s) => [s.key, s] as const));
const TRIGGERS = new Map(registry.triggers.map((t) => [t.key, t] as const));
export interface Issue { nodeId?: string; severity: "error" | "warning"; message: string }
const issue = (severity: Issue["severity"], message: string, nodeId?: string): Issue => clean({ nodeId, severity, message });
const requiredOf = (schema: unknown): string[] => {
  const r = (schema as { required?: unknown } | null)?.required;
  return Array.isArray(r) ? r.filter((x): x is string => typeof x === "string") : [];
};
/** `{{ trigger.x }}` style values count as present: they are filled when the Run starts. */
const present = (v: unknown): boolean => v !== undefined && v !== null && v !== "";

function edges(n: Node): string[] {
  return [...(n.next ?? []), ...(n.branches ?? []).map((b) => b.to), ...(n.onError?.mode === "route" && n.onError.route ? [n.onError.route] : [])];
}

/** The structural problems that make a definition unreadable: duplicate ids, references to nodes that do not exist, steps and triggers that are not in the catalogue. */
export function structuralIssues(def: Definition): Issue[] {
  const out: Issue[] = [];
  const ids = new Set<string>();
  for (const n of def.nodes) {
    if (ids.has(n.id)) out.push(issue("error", `Two steps share the id ${n.id}.`, n.id));
    ids.add(n.id);
  }
  for (const t of def.triggers) if (!TRIGGERS.has(t.key)) out.push(issue("error", `There is no trigger called ${t.key}.`));
  for (const n of def.nodes) {
    if (!STEPS.has(n.key)) out.push(issue("error", `There is no step called ${n.key}.`, n.id));
    for (const to of edges(n)) if (!ids.has(to)) out.push(issue("error", `This step points at ${to}, which does not exist.`, n.id));
  }
  for (const s of def.start ?? []) if (!ids.has(s)) out.push(issue("error", `The start step ${s} does not exist.`));
  return out;
}

/** Check a definition against the step and trigger catalogue: structure, missing inputs, steps nothing reaches, loops without a Loop step, triggers a Personal Space cannot use. */
export function validateDefinition(def: Definition, policy: Policy): Issue[] {
  const out = structuralIssues(def);
  const byId = new Map(def.nodes.map((n) => [n.id, n] as const));
  for (const t of def.triggers) {
    const d = TRIGGERS.get(t.key);
    if (d && !d.personalOk && policy.personalSpace) out.push(issue("error", `${d.title} needs a Team Space.`));
  }
  if (def.nodes.length === 0) out.push(issue("warning", "This Automation has no steps yet."));
  for (const n of def.nodes) {
    const s = STEPS.get(n.key);
    if (!s) continue;
    const have = { ...(n.ai ?? {}), ...n.input } as Record<string, unknown>;
    for (const k of requiredOf(s.input)) if (!present(have[k])) out.push(issue("error", `${s.title} needs ${k}.`, n.id));
    if (s.kind === "ai" && !n.ai?.agentId && !n.ai?.keyId && !present(have.agentId) && !present(have.keyId)) out.push(issue("error", `${s.title} needs an agent or a key.`, n.id));
    if (n.onError?.mode === "route" && !n.onError.route) out.push(issue("error", "On error: route needs a step to go to.", n.id));
  }
  const starts = (def.start && def.start.length ? def.start : def.nodes[0] ? [def.nodes[0].id] : []).filter((s) => byId.has(s));
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const to of edges(byId.get(id)!)) if (byId.has(to)) stack.push(to);
  }
  for (const n of def.nodes) if (!seen.has(n.id)) out.push(issue("warning", "No path reaches this step.", n.id));
  // a cycle is fine only when it passes through a Loop step
  const state = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];
  const dfs = (id: string): void => {
    state.set(id, 1); path.push(id);
    for (const to of edges(byId.get(id)!)) {
      if (!byId.has(to)) continue;
      const st = state.get(to) ?? 0;
      if (st === 0) dfs(to);
      else if (st === 1) {
        const cycle = path.slice(path.indexOf(to));
        if (!cycle.some((c) => byId.get(c)!.key === "loop")) out.push(issue("error", `This path loops back to ${to} without a Loop step.`, id));
      }
    }
    path.pop(); state.set(id, 2);
  };
  for (const n of def.nodes) if ((state.get(n.id) ?? 0) === 0) dfs(n.id);
  return out;
}
const hasErrors = (issues: readonly Issue[]): boolean => issues.some((i) => i.severity === "error");

// AI, Code, and scheduled starts are visible in the builder but the live host cannot run them yet.
// A draft may contain them. Turning the Automation on may not.
const PREVIEW_STEPS = new Set(["ai", "code"]);
export function previewLiveIssues(def: Definition): Issue[] {
  const out: Issue[] = [];
  for (const n of def.nodes) {
    if (!PREVIEW_STEPS.has(n.key)) continue;
    const title = n.key === "ai" ? "AI step" : "Run code";
    out.push(issue("error", `${title} is a preview and cannot be turned on.`, n.id));
  }
  if (def.triggers.some((t) => t.key === "schedule")) {
    out.push(issue("error", "On a schedule is a preview until a schedule can start runs. Remove it before turning this Automation on."));
  }
  return out;
}

// ---- reads ----

export async function get(ctx: AutoCtx, input: In): Promise<unknown> {
  return { automation: out(visible(ctx, getAutomation(ctx, input.automationId))) };
}

/** Who may see an Automation: the owner, a follower, a service caller, or anyone the kernel lets view it. */
export function canView(ctx: AutoCtx, a: Automation): boolean {
  if (isTrustedService(ctx.principal) || isOwner(ctx, a) || a.followers.includes(me(ctx)) || a.createdBy === ctx.principal.id) return true;
  return !!ctx.authorize && ctx.authorize({ perm: null, level: "view" }, { type: "automation", id: a.id }).effect === "allow";
}
function visible(ctx: AutoCtx, a: Automation): Automation {
  if (!canView(ctx, a)) raise(ctx, "permission.not_found", "That automation is not available.");
  return a;
}

async function runStats(ctx: AutoCtx, id: string): Promise<{ lastRun?: { runId: string; status: string; at: number }; failedRuns: number }> {
  if (!ctx.call) return { failedRuns: 0 };
  try {
    const subject = { type: "automation", id };
    const last = (await ctx.call("runs.list", { scope: "subject", subject, limit: 1 })) as { runs?: { id: string; status: string; startedAt: number }[] } | null;
    const failed = (await ctx.call("runs.list", { scope: "subject", subject, statuses: ["failed"], limit: 1 })) as { total?: number } | null;
    const r = last?.runs?.[0];
    return clean({ lastRun: r ? { runId: r.id, status: r.status, at: r.startedAt } : undefined, failedRuns: failed?.total ?? 0 });
  } catch { return { failedRuns: 0 }; }
}

export async function list(ctx: AutoCtx, input: In): Promise<unknown> {
  const who = me(ctx);
  let rows = allAutomations(ctx.db).filter((a) => canView(ctx, a));
  if (input.section === "personal") rows = rows.filter((a) => a.kind === "personal" && a.ownerId === who);
  else if (input.section === "shared") rows = rows.filter((a) => a.kind === "personal" && a.ownerId !== who);
  else if (input.section === "space") rows = rows.filter((a) => a.kind === "space");
  if (input.folder) rows = rows.filter((a) => a.folderId === input.folder);
  if (input.groupId) rows = rows.filter((a) => a.groupId === input.groupId);
  if (input.status) rows = rows.filter((a) => a.status === input.status);
  if (typeof input.q === "string" && input.q.trim()) { const q = input.q.trim().toLowerCase(); rows = rows.filter((a) => a.name.toLowerCase().includes(q)); }
  const p = page(rows, input.cursor, input.limit);
  const automations = [];
  for (const a of p.rows) {
    const s = await runStats(ctx, a.id);
    automations.push(clean({
      id: a.id, name: a.name, kind: a.kind, groupId: a.groupId, ownerId: a.ownerId, status: a.status, version: a.version, triggers: a.definition.triggers.map((t) => t.key),
      updatedAt: a.updatedAt, lastRun: s.lastRun, failedRuns: s.failedRuns,
    }));
  }
  return clean({ automations, next: p.next, total: p.total });
}

export async function validate(ctx: AutoCtx, input: In): Promise<unknown> {
  const issues = validateDefinition(input.definition as Definition, readPolicy(ctx.db));
  return { ok: !hasErrors(issues), issues };
}
export async function triggersList(): Promise<unknown> {
  return { triggers: registry.triggers.map((t) => ({ key: t.key, title: t.title, payload: t.payload, sample: t.sample, personalOk: t.personalOk, allowSelfTrigger: t.allowSelfTrigger })) };
}
export async function stepsList(_ctx: AutoCtx, input: In): Promise<unknown> {
  const steps = registry.steps.filter((s) => !input.category || s.category === input.category);
  return { steps: steps.map((s) => clean({ key: s.key, title: s.title, category: s.category, kind: s.kind, input: s.input, output: s.output, effects: s.effects, gateAct: s.gateAct })) };
}

// ---- create, update, versions ----

const EMPTY: Definition = { triggers: [{ key: "manual" }], nodes: [] };

function checkStructure(ctx: AutoCtx, def: Definition): void {
  const bad = structuralIssues(def);
  if (bad.length) raise(ctx, "validation.bad_input", bad[0]!.message, { issues: bad });
}

export async function create(ctx: AutoCtx, input: In): Promise<unknown> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) raise(ctx, "validation.bad_input", "An automation needs a name.");
  const def: Definition = input.definition ?? EMPTY;
  checkStructure(ctx, def);
  if (input.groupId && !findGroup(ctx.db, input.groupId)) raise(ctx, "validation.not_found", "That Group does not exist.", { reason: "no_group" });
  const now = ctx.now();
  const owner = me(ctx);
  const a: Automation = clean({
    id: newId("aut", now), name, description: input.description, kind: "personal" as const, groupId: input.groupId, folderId: input.folderId, ownerId: owner, status: "draft" as const,
    version: 1, definition: def, followers: [owner], alerts: defaultAlerts(readPolicy(ctx.db), owner), createdBy: ctx.principal.id, createdAt: now, updatedAt: now,
  });
  saveAutomation(ctx.db, a);
  saveVersion(ctx, a, "Created");
  emitAuto(ctx, "automation.created", a.id, { name: a.name, kind: a.kind });
  return { automation: out(a) };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export async function update(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = visible(ctx, getAutomation(ctx, input.automationId));
  if (input.expectedVersion !== undefined && input.expectedVersion !== a.version) {
    raise(ctx, "validation.version_conflict", `This automation is at version ${a.version} now.`, { current: a.version, expected: input.expectedVersion });
  }
  const fields: string[] = [];
  if (typeof input.name === "string" && input.name.trim() && input.name.trim() !== a.name) { a.name = input.name.trim(); fields.push("name"); }
  if (typeof input.description === "string" && input.description !== (a.description ?? "")) { a.description = input.description; fields.push("description"); }
  let definitionChanged = false;
  if (input.definition !== undefined && !same(input.definition, a.definition)) {
    checkStructure(ctx, input.definition);
    const policy = readPolicy(ctx.db);
    const blocking = [...validateDefinition(input.definition, policy), ...(a.status === "on" ? previewLiveIssues(input.definition) : [])];
    if (a.status === "on" && hasErrors(blocking)) {
      raise(ctx, "validation.precondition_failed", "Turn the automation off before saving a definition with errors.", { reason: "invalid_definition" });
    }
    a.definition = input.definition;
    a.version += 1;
    fields.push("definition");
    definitionChanged = true;
  }
  if (fields.length === 0) return { automation: out(a) };
  touch(ctx, a);
  if (definitionChanged) saveVersion(ctx, a);
  emitAuto(ctx, "automation.updated", a.id, { version: a.version, fields });
  return { automation: out(a) };
}

export async function setEnabled(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = visible(ctx, getAutomation(ctx, input.automationId));
  if (input.enabled) {
    if (a.status === "on") return { automation: out(a) };
    const issues = [...validateDefinition(a.definition, readPolicy(ctx.db)), ...previewLiveIssues(a.definition)];
    if (hasErrors(issues)) {
      const preview = previewLiveIssues(a.definition);
      const reason = preview.length > 0 ? "preview" : "invalid_definition";
      raise(ctx, "validation.precondition_failed", issues.find((i) => i.severity === "error")!.message, { reason, issues });
    }
    a.status = "on";
    delete a.pausedReason;
    touch(ctx, a);
    emitAuto(ctx, "automation.enabled", a.id, {});
  } else {
    if (a.status === "off" || a.status === "draft") return { automation: out(a) };
    a.status = "off";
    delete a.pausedReason;
    touch(ctx, a);
    emitAuto(ctx, "automation.disabled", a.id, {});
  }
  return { automation: out(a) };
}

export async function remove(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = visible(ctx, getAutomation(ctx, input.automationId));
  markDeleted(ctx, a.id);
  emitAuto(ctx, "automation.deleted", a.id, {});
  return { deleted: true };
}
export async function undelete(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = getAutomation(ctx, input.automationId, true);
  visible(ctx, a);
  const row = ctx.db.all("SELECT deleted_at FROM automations_defs WHERE id = ?", a.id) as { deleted_at: number | null }[];
  if (row[0]?.deleted_at == null) return { automation: out(a) };
  markRestored(ctx, a.id);
  const back = getAutomation(ctx, a.id);
  // it comes back off: nothing fires until someone turns it on
  if (back.status === "on" || back.status === "paused") { back.status = "off"; delete back.pausedReason; touch(ctx, back); }
  emitAuto(ctx, "automation.restored", a.id, {});
  return { automation: out(back) };
}

export async function versions(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = visible(ctx, getAutomation(ctx, input.automationId));
  return { versions: listVersions(ctx.db, a.id) };
}

export async function restoreVersion(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = visible(ctx, getAutomation(ctx, input.automationId));
  const v = versionById(ctx.db, a.id, input.versionId);
  if (!v) raise(ctx, "validation.not_found", "That version does not exist.", { reason: "no_version" });
  const restored = [...validateDefinition(v.definition, readPolicy(ctx.db)), ...(a.status === "on" ? previewLiveIssues(v.definition) : [])];
  if (a.status === "on" && hasErrors(restored)) {
    raise(ctx, "validation.precondition_failed", "Turn the automation off before restoring a version with errors.", { reason: "invalid_definition" });
  }
  a.definition = v.definition;
  a.version += 1;
  touch(ctx, a);
  const row = saveVersion(ctx, a, `Restored version ${v.n}`);
  emitAuto(ctx, "automation.version_restored", a.id, { versionId: row.versionId, version: a.version });
  emitAuto(ctx, "automation.updated", a.id, { version: a.version, fields: ["definition"] });
  return { automation: out(a) };
}

// ---- Groups ----

const groupOut = (g: { id: string; name: string; count: number; order: number }): Record<string, unknown> => ({ id: g.id, name: g.name, count: g.count, order: g.order });
const cleanName = (ctx: AutoCtx, n: unknown): string => {
  const s = typeof n === "string" ? n.trim() : "";
  if (!s) raise(ctx, "validation.bad_input", "A Group needs a name.");
  return s;
};
function noDuplicateGroup(ctx: AutoCtx, name: string, exceptId?: string): void {
  if (listGroups(ctx.db).some((g) => g.id !== exceptId && g.name.toLowerCase() === name.toLowerCase())) raise(ctx, "validation.duplicate", "A Group with that name exists.", { reason: "group_name" });
}
export async function groupsList(ctx: AutoCtx): Promise<unknown> { return { groups: listGroups(ctx.db).map(groupOut) }; }
export async function groupsCreate(ctx: AutoCtx, input: In): Promise<unknown> {
  const name = cleanName(ctx, input.name);
  noDuplicateGroup(ctx, name);
  const id = newId("agr", ctx.now());
  const ord = Math.max(-1, ...listGroups(ctx.db).map((g) => g.order)) + 1;
  ctx.db.run("INSERT INTO automations_groups (id, name, ord) VALUES (?, ?, ?)", id, name, ord);
  ctx.emit("automation.group_created", `entity/${id}`, { groupId: id, name });
  return { group: groupOut(findGroup(ctx.db, id)!) };
}
export async function groupsRename(ctx: AutoCtx, input: In): Promise<unknown> {
  if (!findGroup(ctx.db, input.groupId)) raise(ctx, "permission.not_found", "That Group is not available.");
  const name = cleanName(ctx, input.name);
  noDuplicateGroup(ctx, name, input.groupId);
  ctx.db.run("UPDATE automations_groups SET name = ? WHERE id = ?", name, input.groupId);
  ctx.emit("automation.group_renamed", `entity/${input.groupId}`, { groupId: input.groupId, name });
  return { group: groupOut(findGroup(ctx.db, input.groupId)!) };
}
export async function groupsDelete(ctx: AutoCtx, input: In): Promise<unknown> {
  if (!findGroup(ctx.db, input.groupId)) raise(ctx, "permission.not_found", "That Group is not available.");
  ctx.db.run("UPDATE automations_defs SET group_id = NULL WHERE group_id = ?", input.groupId);
  ctx.db.run("DELETE FROM automations_groups WHERE id = ?", input.groupId);
  ctx.emit("automation.group_deleted", `entity/${input.groupId}`, { groupId: input.groupId });
  return { deleted: true };
}
export async function move(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = visible(ctx, getAutomation(ctx, input.automationId));
  const gid: string | null = input.groupId ?? null;
  if (gid !== null && !findGroup(ctx.db, gid)) raise(ctx, "validation.not_found", "That Group does not exist.", { reason: "no_group" });
  if (gid === null) delete a.groupId; else a.groupId = gid;
  touch(ctx, a);
  emitAuto(ctx, "automation.moved", a.id, { groupId: gid });
  return { automation: out(a) };
}

// ---- alerts, followers, webhook ----

export async function alertsGet(ctx: AutoCtx, input: In): Promise<unknown> {
  return { alerts: visible(ctx, getAutomation(ctx, input.automationId)).alerts };
}
export async function alertsSet(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = visible(ctx, getAutomation(ctx, input.automationId));
  const al = input.alerts as Alerts;
  if (al.when.mode === "after_n" && al.when.n === undefined) raise(ctx, "validation.bad_input", "Say after how many failures in a row.", { reason: "n_required" });
  const hours = al.escalation.map((e) => e.afterHours);
  if (hours.some((h, i) => i > 0 && h <= hours[i - 1]!)) raise(ctx, "validation.bad_input", "Each step of the escalation chain comes later than the one before.", { reason: "escalation_order" });
  a.alerts = al;
  touch(ctx, a);
  emitAuto(ctx, "automation.alerts_changed", a.id, {});
  return { alerts: a.alerts };
}
export async function followersAdd(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = visible(ctx, getAutomation(ctx, input.automationId));
  if (!a.followers.includes(input.follower)) {
    a.followers = [...a.followers, input.follower];
    touch(ctx, a);
    emitAuto(ctx, "automation.follower_added", a.id, { follower: input.follower });
  }
  return { followers: a.followers };
}
export async function followersRemove(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = visible(ctx, getAutomation(ctx, input.automationId));
  if (a.followers.includes(input.follower)) {
    a.followers = a.followers.filter((f) => f !== input.follower);
    touch(ctx, a);
    emitAuto(ctx, "automation.follower_removed", a.id, { follower: input.follower });
  }
  return { followers: a.followers };
}

function webhookUrl(ctx: AutoCtx, id: string, secret: string): string { return `${ctx.baseUrl ?? ""}/hooks/automation/${id}/${secret}`; }
function needWebhookTrigger(ctx: AutoCtx, a: Automation): void {
  if (!a.definition.triggers.some((t) => t.key === "webhook")) raise(ctx, "validation.precondition_failed", "Add a webhook trigger first.", { reason: "no_webhook_trigger" });
}
export async function webhookGet(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = visible(ctx, getAutomation(ctx, input.automationId));
  needWebhookTrigger(ctx, a);
  const have = (ctx.db.all("SELECT secret FROM automations_webhooks WHERE automation_id = ?", a.id) as { secret: string }[])[0];
  let secret = have?.secret;
  if (!secret) {
    secret = newSecret();
    ctx.db.run("INSERT INTO automations_webhooks (automation_id, secret, rotated_at) VALUES (?, ?, ?)", a.id, secret, ctx.now());
  }
  return { url: webhookUrl(ctx, a.id, secret), method: "POST" };
}
export async function webhookRotate(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = visible(ctx, getAutomation(ctx, input.automationId));
  needWebhookTrigger(ctx, a);
  const secret = newSecret();
  ctx.db.run("INSERT OR REPLACE INTO automations_webhooks (automation_id, secret, rotated_at) VALUES (?, ?, ?)", a.id, secret, ctx.now());
  return { url: webhookUrl(ctx, a.id, secret) };
}
/** The webhook receiver asks this: does the secret in the URL belong to this Automation. */
export function webhookSecretMatches(ctx: AutoCtx, automationId: string, secret: string): boolean {
  const have = (ctx.db.all("SELECT secret FROM automations_webhooks WHERE automation_id = ?", automationId) as { secret: string }[])[0];
  return !!have && have.secret === secret;
}

// ---- Promote and the Personal copy ----

const HANDLE = /#[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)?/g;
const RESOURCE_PREFIX: Record<string, string> = { rec: "record", fil: "file", fld: "folder", chn: "channel", prj: "project", frm: "form", sit: "site", kit: "kit", cmp: "campaign", mbx: "mailbox", num: "number" };
const LEVELS = ["view", "use", "edit", "manage"] as const;

function walk(v: unknown, f: (s: string) => void): void {
  if (typeof v === "string") f(v);
  else if (Array.isArray(v)) for (const x of v) walk(x, f);
  else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x, f);
}

export interface Diff {
  grants: Grant[]; vaultNames: string[]; connections: string[]; keysToReplace: { stepId: string; keyId: string; reason: string }[];
}
interface VaultItem { id: string; handle?: string; name?: string; kind?: string }

/** What a Space Automation would hold as itself: the resources its steps touch, the vault names and connections it uses, the subscription keys that must change. */
export async function accessDiff(ctx: AutoCtx, a: Automation): Promise<Diff> {
  const vault = new Set<string>();
  const connections = new Set<string>();
  const need = new Map<string, number>();
  for (const n of a.definition.nodes) {
    const effects = STEPS.get(n.key)?.effects ?? "read";
    const lvl = effects === "write" ? 2 : effects === "outward" ? 1 : 0;
    walk(n.input, (s) => {
      for (const m of s.match(HANDLE) ?? []) vault.add(m);
      if (/^con_[a-z0-9]+$/.test(s)) connections.add(s);
      const m = /^([a-z]{3})_[a-z0-9]+$/.exec(s);
      const type = m ? RESOURCE_PREFIX[m[1]!] : undefined;
      if (type) { const k = `${type}/${s}`; need.set(k, Math.max(need.get(k) ?? 0, lvl)); }
    });
  }
  const grants: Grant[] = [...need.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([resource, l]) => {
    const level = LEVELS[l]!;
    const [type, id] = resource.split("/") as [string, string];
    const holds = !!ctx.authorize && ctx.authorize({ perm: null, level }, { type, id }).effect === "allow";
    return { resource, level, via: holds ? "owner_access" : "new_grant" };
  });
  const keysToReplace: Diff["keysToReplace"] = [];
  const subs = await subscriptionKeys(ctx);
  for (const n of a.definition.nodes) {
    for (const k of [n.ai?.keyId, n.ai?.backupKeyId]) {
      if (k && subs.has(k)) keysToReplace.push({ stepId: n.id, keyId: k, reason: "A subscription belongs to one person. A Space automation needs a shared API key." });
    }
  }
  return { grants, vaultNames: [...vault].sort(), connections: [...connections].sort(), keysToReplace };
}

async function subscriptionKeys(ctx: AutoCtx): Promise<Set<string>> {
  const s = new Set<string>();
  if (!ctx.call) return s;
  try {
    const r = (await ctx.call("vault.items.list", { kind: "ai_subscription", limit: 500 })) as { items?: VaultItem[] } | null;
    for (const i of r?.items ?? []) if (i.kind === undefined || i.kind === "ai_subscription") for (const k of [i.id, i.handle, i.name]) if (k) s.add(k);
  } catch { /* without the vault list nothing is flagged; promote then trusts the caller */ }
  return s;
}

export async function previewPromote(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = visible(ctx, getAutomation(ctx, input.automationId));
  const diff = await accessDiff(ctx, a);
  return { diff, ready: diff.keysToReplace.length === 0 };
}

export async function promote(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = visible(ctx, getAutomation(ctx, input.automationId));
  if (a.kind === "space") raise(ctx, "validation.precondition_failed", "That automation is already a Space automation.", { reason: "already_space" });
  const diff = await accessDiff(ctx, a);
  const replace = new Map<string, string>();
  for (const r of (input.replaceKeys ?? []) as { stepId: string; keyId: string }[]) replace.set(r.stepId, r.keyId);
  const open = diff.keysToReplace.filter((k) => !replace.has(k.stepId));
  if (open.length) {
    raise(ctx, "validation.precondition_failed", "Replace the subscription keys with shared API keys before promoting.", { reason: "keys_not_replaced", steps: open.map((k) => k.stepId) });
  }
  const issues = validateDefinition(a.definition, readPolicy(ctx.db));
  if (hasErrors(issues)) raise(ctx, "validation.precondition_failed", issues.find((i) => i.severity === "error")!.message, { reason: "invalid_definition", issues });
  let replaced = 0;
  if (diff.keysToReplace.length) {
    const def = JSON.parse(JSON.stringify(a.definition)) as Definition;
    for (const n of def.nodes) {
      const k = replace.get(n.id);
      if (!k || !n.ai) continue;
      const wasSub = new Set(diff.keysToReplace.filter((x) => x.stepId === n.id).map((x) => x.keyId));
      if (n.ai.keyId && wasSub.has(n.ai.keyId)) { n.ai.keyId = k; replaced += 1; }
      if (n.ai.backupKeyId && wasSub.has(n.ai.backupKeyId)) { n.ai.backupKeyId = k; replaced += 1; }
    }
    a.definition = def;
    a.version += 1;
  }
  a.kind = "space";
  a.ownerId = typeof input.ownerId === "string" && input.ownerId ? input.ownerId : me(ctx);
  touch(ctx, a);
  if (replaced > 0) saveVersion(ctx, a, "Promoted to the Space: shared keys");
  ctx.db.run("DELETE FROM automations_access WHERE automation_id = ?", a.id);
  for (const g of diff.grants) ctx.db.run("INSERT INTO automations_access (automation_id, resource, level, via) VALUES (?, ?, ?, ?)", a.id, g.resource, g.level, g.via);
  ctx.db.run("DELETE FROM automations_vault WHERE automation_id = ?", a.id);
  for (const v of diff.vaultNames) ctx.db.run("INSERT INTO automations_vault (automation_id, name) VALUES (?, ?)", a.id, v);
  emitAuto(ctx, "automation.promoted", a.id, { ownerId: a.ownerId, grants: diff.grants.length, keysReplaced: replaced });
  return { automation: out(a), diff };
}

export async function makePersonalCopy(ctx: AutoCtx, input: In): Promise<unknown> {
  const src = visible(ctx, getAutomation(ctx, input.automationId));
  if (src.kind !== "space") raise(ctx, "validation.precondition_failed", "Only a Space automation can be copied to Personal.", { reason: "not_space" });
  const now = ctx.now();
  const owner = me(ctx);
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : `${src.name} (copy)`;
  const copy: Automation = clean({
    id: newId("aut", now), name, description: src.description, kind: "personal" as const, ownerId: owner, status: "draft" as const, version: 1,
    definition: JSON.parse(JSON.stringify(src.definition)) as Definition, followers: [owner], alerts: defaultAlerts(readPolicy(ctx.db), owner), createdBy: ctx.principal.id,
    createdAt: now, updatedAt: now,
  });
  saveAutomation(ctx.db, copy);
  saveVersion(ctx, copy, `Copied from ${src.name}`);
  emitAuto(ctx, "automation.copied", copy.id, { fromId: src.id });
  emitAuto(ctx, "automation.created", copy.id, { name: copy.name, kind: copy.kind });
  return { automation: out(copy) };
}

