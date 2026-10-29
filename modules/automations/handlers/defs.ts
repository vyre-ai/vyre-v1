// Automation definitions (spec 2.12, 3.7; ARCH 7.7): create, update with versions, validation against the step and trigger catalogue, Groups, followers, alerts,
// webhook URL, Promote to the Space with its access diff, and the Personal copy. Starting Runs and the trigger consumer are in triggers.ts.
// DECISION: a new Automation is a draft. It turns on only when validate finds no error; saving a definition with errors is allowed while it is not on, refused while it is.
// A pasted secret is refused in every status, including a draft. The connection holds it.
// DECISION: a definition change appends a version; a name or description change does not.
// DECISION: Promote keeps the id, history and versions, makes the Automation a Space one owned by the named person and run as its own Service principal. The access it was
// confirmed with is stored (automations_access) with the vault names it may use (automations_vault); subscription keys must be replaced by shared API keys first.
import { isTrustedService } from "../../../lib/trust.ts";
import { registry } from "../../../generated/registry.ts";
import {
  allAutomations, clean, defaultAlerts, emitAuto, findGroup, getAutomation, isOwner, listGroups, listVersions, markDeleted, markRestored, me, newId, newSecret, out, page,
  raise, readPolicy, saveAutomation, saveVersion, touch, versionById,
} from "../projections.ts";
import { rememberAccountPicks } from "../accounts.ts";
import { publishAllowed } from "../connector-breadth.ts";
import { storedLevel } from "../connector-level.ts";
import { admit, contractOf } from "../val.ts";
import { containsSecret } from "../trust.ts";
import type { Alerts, AutoCtx, Automation, Db, Definition, Grant, Node, Policy } from "../projections.ts";

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

function laneEntries(n: Node): string[] {
  if (n.branches && n.branches.length > 0) return n.branches.map((b) => b.to ?? "");
  const raw = n.input?.["branches"];
  if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) return raw;
  return [];
}

function afterIds(n: Node): string[] {
  if (n.key === "loop") return n.next ?? [];
  const lanes = laneEntries(n);
  if (n.branches && n.branches.length > 0) return lanes;
  if (n.key === "parallel" && lanes.length > 0) return lanes;
  return n.next ?? [];
}

function reached(byId: Map<string, Node>, from: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (!id || seen.has(id)) return;
    const n = byId.get(id);
    if (!n) return;
    seen.add(id);
    out.push(id);
    if (n.key === "loop") {
      const body = laneEntries(n)[0];
      if (body) walk(body);
    }
    for (const s of afterIds(n)) walk(s);
  };
  walk(from);
  return out;
}

function joinId(byId: Map<string, Node>, n: Node): string | null {
  const heads = laneEntries(n).filter((id) => id.length > 0);
  if (heads.length < 2) return null;
  const sets = heads.map((h) => new Set(reached(byId, h)));
  for (const id of reached(byId, heads[0]!)) if (sets.every((s) => s.has(id))) return id;
  return null;
}

// The host refuses a Loop whose body contains another Loop. The body starts at the first branch and stops at this Loop and at what follows it.
function loopBody(byId: Map<string, Node>, loop: Node): Node[] {
  const entry = laneEntries(loop)[0] ?? "";
  if (!entry) return [];
  const stop = new Set<string>([loop.id, ...(loop.next ?? [])]);
  const out: Node[] = [];
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (!id || seen.has(id) || stop.has(id)) return;
    const n = byId.get(id);
    if (!n) return;
    seen.add(id);
    out.push(n);
    if (n.key === "parallel") {
      const join = joinId(byId, n);
      if (join) walk(join);
      else for (const s of n.next ?? []) walk(s);
      return;
    }
    if (n.key === "loop") {
      for (const s of n.next ?? []) walk(s);
      return;
    }
    const lanes = laneEntries(n);
    if ((n.key === "if" || n.key === "paths") && lanes.some((lane) => lane.length > 0)) {
      for (const lane of lanes) walk(lane);
      for (const s of n.next ?? []) walk(s);
      return;
    }
    for (const s of afterIds(n)) walk(s);
  };
  walk(entry);
  return out;
}

// A stored row is the only tested level. An input claim of tested or draft is still a draft.
function connectorLevel(n: Node, db?: Db): "draft" | "tested" | undefined {
  if (db) {
    const stored = storedLevel(db, n.key);
    if (stored === "tested" || stored === "draft") return stored;
  }
  const level = n.input["connectorLevel"];
  if (level === "draft" || level === "tested") return "draft";
  return undefined;
}

const VAULT_HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;
/** The HTTP request step: an https address (a template is checked when it runs), a method that fits its body, and a key that is a Vault handle, never a value. */
function httpIssues(id: string, have: Record<string, unknown>): Issue[] {
  const out: Issue[] = [];
  const method = typeof have["method"] === "string" ? have["method"].toUpperCase() : "";
  const url = have["url"];
  if (method !== "" && !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)) out.push(issue("error", `${method} is not an HTTP request method this step sends.`, id));
  if (typeof url === "string" && !url.includes("{{") && !/^https:\/\//i.test(url.trim())) out.push(issue("error", "An HTTP request address must start with https://.", id));
  if ((method === "GET" || method === "HEAD") && (present(have["json"]) || present(have["text"]))) out.push(issue("error", `${method} cannot carry a body.`, id));
  if (present(have["json"]) && present(have["text"])) out.push(issue("error", "An HTTP request carries a JSON body or a text body, not both.", id));
  const auth = have["auth"];
  if (auth !== undefined && auth !== null) {
    const a = (typeof auth === "object" && !Array.isArray(auth) ? auth : {}) as Record<string, unknown>;
    if (a["kind"] !== "bearer" && a["kind"] !== "basic" && a["kind"] !== "header") out.push(issue("error", "Auth is bearer, basic or a named header.", id));
    if (typeof a["handle"] !== "string" || !VAULT_HANDLE.test(a["handle"])) out.push(issue("error", "Auth needs a Vault handle such as #Acme_API. Pick the key in the Vault; do not paste it.", id));
    if (a["kind"] === "basic" && !present(a["username"])) out.push(issue("error", "Basic auth needs a user name.", id));
    if (a["kind"] === "header" && !present(a["header"])) out.push(issue("error", "Auth by header needs the header name.", id));
  }
  return out;
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
    if (!STEPS.has(n.key) && connectorLevel(n) === undefined) out.push(issue("error", `There is no step called ${n.key}.`, n.id));
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
    if (n.key === "send_email" && !present(have["mailboxId"])) out.push(issue("error", "Send an email needs a mailbox.", n.id));
    if (n.key === "send_sms" && !present(have["numberId"])) out.push(issue("error", "Send a text needs a number.", n.id));
    if (n.key === "connector_request" && !present(have["connector"])) out.push(issue("error", "An authenticated request needs a connector.", n.id));
    if (n.key === "connector_request" && !present(have["action"])) out.push(issue("error", "An authenticated request needs an action.", n.id));
    if (n.key === "connector_request" && !present(have["connectionId"])) out.push(issue("error", "An authenticated request needs a connection.", n.id));
    if (n.key === "connector_request" && containsSecret(have["input"])) out.push(issue("error", "An authenticated request cannot hold a secret. Use the connection.", n.id));
    if (n.key === "http_request") out.push(...httpIssues(n.id, have));
    if (n.key === "loop") {
      const max = have["maxIterations"];
      if (typeof max === "number" && max > 1000) out.push(issue("error", "A loop allows at most 1000 iterations.", n.id));
    }
    if (n.onError?.mode === "route" && !n.onError.route) out.push(issue("error", "On error: route needs a step to go to.", n.id));
  }
  const nested = new Set<string>();
  for (const n of def.nodes) {
    if (n.key !== "loop") continue;
    for (const inner of loopBody(byId, n)) {
      if (inner.key !== "loop" || nested.has(inner.id)) continue;
      nested.add(inner.id);
      out.push(issue("error", "A loop cannot contain another loop.", inner.id));
    }
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
  if (hasPastedSecret(def)) out.push(issue("error", "A definition cannot hold a secret. Use a connection."));
  return out;
}

// `pageToken` is a normal cursor. The letters "token" inside it are not a secret field.
function pageTokenField(key: string): boolean {
  if (!/page[-_]?tokens?/i.test(key)) return false;
  const rest = key.replace(/page[-_]?tokens?/gi, "");
  return !containsSecret({ [rest || "ok"]: 1 });
}

/** A secret anywhere in the definition: a secret-like field, or a value that is a bearer, sk-, or key_ secret. */
function hasPastedSecret(value: unknown): boolean {
  if (typeof value === "string") return containsSecret(value);
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasPastedSecret(item));
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => {
    if (pageTokenField(key)) return hasPastedSecret(item);
    if (containsSecret({ [key]: 1 })) return true;
    return hasPastedSecret(item);
  });
}

function refuseSecret(ctx: AutoCtx, def: Definition): void {
  if (!hasPastedSecret(def)) return;
  raise(ctx, "validation.bad_input", "A definition cannot hold a secret. Use a connection.", { reason: "secret" });
}
const hasErrors = (issues: readonly Issue[]): boolean => issues.some((i) => i.severity === "error");

// AI and Code are live steps. A draft may hold either. Turning the Automation on checks that this server can run them and that the AI step has an account to pay for it.
//   Run code needs the sandbox (steps.support says whether this server has it), and is refused with the reason where it does not.
//   An AI step in a Personal automation runs on its owner's own account (keyId may pick one); in a Space automation it needs a Space-shared key in keyId. The message names what to add.
interface Support { code: { available: boolean; reason?: string }; ai: { available: boolean; reason?: string } }
interface ProviderLite { id: string; handle?: string; itemId: string; name: string; connection: string; scope: string; spaceMayUse: boolean; state: string }

async function supportOf(ctx: AutoCtx): Promise<Support> {
  const none = { available: false, reason: "This server has not started the part that runs it." };
  if (!ctx.call) return { code: none, ai: none };
  try {
    const r = (await ctx.call("steps.support", {})) as Partial<Support> | null;
    return { code: r?.code ?? none, ai: r?.ai ?? none };
  } catch {
    return { code: none, ai: none };
  }
}

/** The steps this server cannot run, hidden from the catalogue. A step that is here but not yet usable is not hidden: its problem shows when it is turned on. */
async function hiddenSteps(ctx: AutoCtx): Promise<Set<string>> {
  const s = await supportOf(ctx);
  return new Set([...(s.code.available ? [] : ["code"]), ...(s.ai.available ? [] : ["ai"])]);
}

async function providersOf(ctx: AutoCtx): Promise<ProviderLite[] | null> {
  if (!ctx.call) return null;
  try {
    const r = (await ctx.call("providers.list", {})) as { providers?: ProviderLite[] } | null;
    return Array.isArray(r?.providers) ? r!.providers : [];
  } catch {
    return null;
  }
}

const refOf = (p: ProviderLite): string[] => [p.handle, p.itemId, p.id, p.name].filter((x): x is string => typeof x === "string" && x !== "");
const works = (p: ProviderLite): boolean => p.state === "ok" && (p.connection !== "subscription" || p.spaceMayUse);

/** Why the AI steps of this definition cannot pay for their turns when it goes live, one issue per step. */
async function aiAccountIssues(ctx: AutoCtx, kind: Automation["kind"], def: Definition): Promise<Issue[]> {
  const nodes = def.nodes.filter((n) => n.key === "ai");
  if (nodes.length === 0) return [];
  const providers = await providersOf(ctx);
  const out: Issue[] = [];
  for (const n of nodes) {
    const have = { ...(n.ai ?? {}), ...n.input } as Record<string, unknown>;
    const key = typeof have["keyId"] === "string" && have["keyId"] !== "" ? have["keyId"] : undefined;
    const backup = typeof have["backupKeyId"] === "string" && have["backupKeyId"] !== "" ? have["backupKeyId"] : undefined;
    const pick = (ref: string): ProviderLite | undefined => providers?.find((p) => refOf(p).includes(ref));
    if (providers === null) { out.push(issue("error", "AI steps run on the agent runtime, which this server has not started.", n.id)); continue; }
    if (kind === "space") {
      if (!key) { out.push(issue("error", "A Space AI step needs a Space-shared AI key. Add one in the Vault under AI providers (Shared), then choose it in this step.", n.id)); continue; }
      for (const ref of [key, ...(backup ? [backup] : [])]) {
        const p = pick(ref);
        if (!p) out.push(issue("error", `The AI key ${ref} is not in the Vault. Add a Space-shared AI key and choose it in this step.`, n.id));
        else if (p.scope !== "shared") out.push(issue("error", `The AI key ${p.name} belongs to one person. A Space automation needs a Space-shared AI key: share it with the Space in the Vault, or add one.`, n.id));
        else if (!works(p)) out.push(issue("error", `The AI key ${p.name} does not work right now (${p.state === "ok" ? "it needs a sign-in" : p.state.replace("_", " ")}). Fix it in AI settings or choose another.`, n.id));
      }
      continue;
    }
    if (key) {
      const p = pick(key);
      if (!p) { out.push(issue("error", `The AI key ${key} is not in the Vault. Pick one of your AI accounts, or clear the choice to use your default.`, n.id)); continue; }
      if (!works(p)) out.push(issue("error", p.connection === "subscription" && p.state === "ok" ? `${p.name} is your subscription, and the Space may not use it yet. Turn on Let the Space run work on my subscription in AI settings.` : `${p.name} does not work right now. Fix it in AI settings or choose another.`, n.id));
      continue;
    }
    if (!providers.some(works)) out.push(issue("error", "This AI step runs on your own AI account and you have none that works on the server. Add an API key, or sign in with Claude or Codex and turn on Let the Space run work on my subscription, in AI settings.", n.id));
  }
  return out;
}

/** What stops this definition going live because of the live steps in it. */
export async function liveStepIssues(ctx: AutoCtx, kind: Automation["kind"], def: Definition): Promise<Issue[]> {
  const out: Issue[] = [];
  if (def.nodes.some((n) => n.key === "code")) {
    const code = (await supportOf(ctx)).code;
    if (!code.available) for (const n of def.nodes) if (n.key === "code") out.push(issue("error", `Run code cannot be turned on here. ${code.reason ?? "This server has no sandbox."}`, n.id));
  }
  return [...out, ...(await aiAccountIssues(ctx, kind, def))];
}

/** Live publish runs admit() on every catalogue step. */
export function admissionIssues(def: Definition): Issue[] {
  const out: Issue[] = [];
  for (const n of def.nodes) {
    const step = STEPS.get(n.key);
    if (!step) continue;
    const verdict = admit(contractOf(step));
    if (verdict.stable) continue;
    for (const item of verdict.issues) out.push(issue("error", item.message, n.id));
  }
  return out;
}

function draftedActionIssues(def: Definition, db: Db): Issue[] {
  const out: Issue[] = [];
  for (const n of def.nodes) {
    const level = connectorLevel(n, db);
    if (level === undefined) continue;
    const verdict = publishAllowed(level);
    if (!verdict.ok) out.push(issue("error", verdict.reason, n.id));
  }
  return out;
}

async function blocksGoingLive(ctx: AutoCtx, kind: Automation["kind"], def: Definition, policy: Policy): Promise<Issue[]> {
  return [...validateDefinition(def, policy), ...admissionIssues(def), ...draftedActionIssues(def, ctx.db), ...(await liveStepIssues(ctx, kind, def))];
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
export async function stepsList(ctx: AutoCtx, input: In): Promise<unknown> {
  const hidden = await hiddenSteps(ctx);
  const steps = registry.steps.filter((s) => !hidden.has(s.key) && (!input.category || s.category === input.category));
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
  refuseSecret(ctx, def);
  if (input.groupId && !findGroup(ctx.db, input.groupId)) raise(ctx, "validation.not_found", "That Group does not exist.", { reason: "no_group" });
  const now = ctx.now();
  const owner = me(ctx);
  const a: Automation = clean({
    id: newId("aut", now), name, description: input.description, kind: "personal" as const, groupId: input.groupId, folderId: input.folderId, ownerId: owner, status: "draft" as const,
    version: 1, definition: def, followers: [owner], alerts: defaultAlerts(readPolicy(ctx.db), owner), createdBy: ctx.principal.id, createdAt: now, updatedAt: now,
  });
  saveAutomation(ctx.db, a);
  saveVersion(ctx, a, "Created");
  rememberAccountPicks(ctx.db, owner, def, now);
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
    refuseSecret(ctx, input.definition);
    const policy = readPolicy(ctx.db);
    const blocking = a.status === "on" ? await blocksGoingLive(ctx, a.kind, input.definition, policy) : validateDefinition(input.definition, policy);
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
  if (definitionChanged) {
    saveVersion(ctx, a);
    rememberAccountPicks(ctx.db, me(ctx), a.definition, ctx.now());
  }
  emitAuto(ctx, "automation.updated", a.id, { version: a.version, fields });
  return { automation: out(a) };
}

export async function setEnabled(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = visible(ctx, getAutomation(ctx, input.automationId));
  if (input.enabled) {
    if (a.status === "on") return { automation: out(a) };
    const issues = await blocksGoingLive(ctx, a.kind, a.definition, readPolicy(ctx.db));
    if (hasErrors(issues)) {
      const live = await liveStepIssues(ctx, a.kind, a.definition);
      const drafted = draftedActionIssues(a.definition, ctx.db);
      const reason = live.length > 0 ? "live_step" : drafted.length > 0 ? "draft" : "invalid_definition";
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
  refuseSecret(ctx, v.definition);
  const restored = a.status === "on" ? await blocksGoingLive(ctx, a.kind, v.definition, readPolicy(ctx.db)) : validateDefinition(v.definition, readPolicy(ctx.db));
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
  if (!have) return false;
  // Every character is compared whatever the first mismatch, so the time taken does not say how much of a guess was right.
  const a = have.secret, b = secret;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
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
    walk({ input: n.input, ai: n.ai }, (s) => {
      for (const m of s.match(HANDLE) ?? []) vault.add(m);
      if (/^con_[a-z0-9]+$/.test(s)) connections.add(s);
      const m = /^([a-z]{3})_[a-z0-9]+$/.exec(s);
      const type = m ? RESOURCE_PREFIX[m[1]!] : undefined;
      if (type) { const k = `${type}/${s}`; need.set(k, Math.max(need.get(k) ?? 0, lvl)); }
    });
  }
  // the AI step's key is named by provider id; the Vault item behind it is what the Space automation must be allowed to use
  const providers = await providersOf(ctx);
  for (const n of a.definition.nodes) {
    if (n.key !== "ai") continue;
    for (const k of [n.ai?.keyId, n.ai?.backupKeyId]) {
      const p = k ? providers?.find((x) => refOf(x).includes(k)) : undefined;
      if (p?.handle) vault.add(p.handle);
    }
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
    // an AI step that used its owner's own account has no key to carry over: the Space automation needs one
    const picked = (n.ai?.keyId ?? (n.input as Record<string, unknown>)["keyId"]) as unknown;
    if (n.key === "ai" && (typeof picked !== "string" || picked === "")) keysToReplace.push({ stepId: n.id, keyId: "", reason: "This AI step ran on your own account. A Space automation needs a Space-shared AI key." });
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
      if (!k) continue;
      if (!n.ai) n.ai = {};
      const wasSub = new Set(diff.keysToReplace.filter((x) => x.stepId === n.id).map((x) => x.keyId));
      if (n.ai.keyId && wasSub.has(n.ai.keyId)) { n.ai.keyId = k; replaced += 1; }
      else if (!n.ai.keyId && wasSub.has("")) { n.ai.keyId = k; replaced += 1; }
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

