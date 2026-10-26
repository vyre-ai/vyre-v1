// Space and person configuration of the engine (spec 3.10, 4.14; ARCH 6.4, 7.10):
//   engine.policy.get/set, engine.defaults.get/set, engine.subscription_share.set, engine.runtime.opt_in, engine.use_policy.export.
// Policy rows are the one source of "which accounts, models and providers may run" and "which providers a label may reach"; the account resolver,
// models.list, providers.list and turn.retry all read them through readPolicy(). The hop and loop limits stay settings rows (engine.agent_hops, ...).
import { setSpaceUse } from "../../../../agent/src/accounts/index.ts";
import { actorOf, raise } from "../../projections.ts";
import type { EngineCtx } from "../../projections.ts";
import { ensureExtra } from "./schema.ts";
import { rows, str } from "./util.ts";

export type Label = "public" | "internal" | "confidential" | "restricted";
const LABELS: readonly Label[] = ["public", "internal", "confidential", "restricted"];
type Effort = "low" | "medium" | "high" | "max";
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "max"];

export interface Policy {
  allowedAccounts: "any" | "company";
  allowedModels: string[];
  allowedProviders: string[];
  labelProviders: Record<string, string[]>;
  hops: { agentHops: number; reviewLoops: number; ciFixLoops: number };
}

const HOP_SETTINGS = [["agentHops", "engine.agent_hops", 4], ["reviewLoops", "engine.review_loops", 2], ["ciFixLoops", "engine.ci_fix_loops", 3]] as const;

function policyRow<T>(ctx: EngineCtx, key: string): T | undefined {
  const r = rows(ctx, "SELECT value FROM engine_policy WHERE key = ?", key)[0];
  return r ? (JSON.parse(str(r["value"])) as T) : undefined;
}

async function settingValue(ctx: EngineCtx, key: string): Promise<unknown> {
  try {
    const out = (await ctx.call("settings.get", { key })) as { row?: { value?: unknown } };
    return out.row?.value;
  } catch {
    return undefined;
  }
}

/** The AI policy of the Space. An empty model or provider list means every one is allowed. */
export async function readPolicy(ctx: EngineCtx): Promise<Policy> {
  ensureExtra(ctx.db);
  let allowedAccounts = policyRow<"any" | "company">(ctx, "allowedAccounts");
  if (allowedAccounts === undefined) {
    const s = await settingValue(ctx, "engine.allowed_accounts");
    allowedAccounts = s === "company" ? "company" : "any";
  }
  const hops = { agentHops: 4, reviewLoops: 2, ciFixLoops: 3 };
  for (const [field, key, fallback] of HOP_SETTINGS) {
    const v = await settingValue(ctx, key);
    hops[field] = typeof v === "number" && Number.isInteger(v) ? v : fallback;
  }
  return {
    allowedAccounts,
    allowedModels: policyRow<string[]>(ctx, "allowedModels") ?? [],
    allowedProviders: policyRow<string[]>(ctx, "allowedProviders") ?? [],
    labelProviders: policyRow<Record<string, string[]>>(ctx, "labelProviders") ?? {},
    hops,
  };
}

export const policyGet = (ctx: EngineCtx, _input: Record<string, never>): Promise<Policy> => readPolicy(ctx);

const uniq = (list: readonly string[]): string[] => [...new Set(list.map((s) => s.trim()).filter((s) => s !== ""))];

export async function policySet(
  ctx: EngineCtx,
  input: { allowedAccounts?: "any" | "company"; allowedModels?: string[]; allowedProviders?: string[]; labelProviders?: Record<string, string[]> },
): Promise<{ ok: boolean }> {
  ensureExtra(ctx.db);
  // Every refusal comes before the first write: a refused call leaves the policy as it was.
  if (input.allowedAccounts !== undefined && input.allowedAccounts !== "any" && input.allowedAccounts !== "company") raise(ctx, "validation.bad_input", "Allowed accounts is any or company.", { field: "allowedAccounts" });
  let cleanLabels: Record<string, string[]> | undefined;
  if (input.labelProviders !== undefined) {
    cleanLabels = {};
    for (const [label, providers] of Object.entries(input.labelProviders)) {
      if (!(LABELS as readonly string[]).includes(label)) raise(ctx, "validation.bad_input", `${label} is not a label. Use public, internal, confidential or restricted.`, { field: "labelProviders", label });
      cleanLabels[label] = uniq(providers);
    }
  }
  const keys: string[] = [];
  const put = (key: string, value: unknown): void => {
    ctx.db.run("INSERT OR REPLACE INTO engine_policy (key, value, updated_at) VALUES (?, ?, ?)", key, JSON.stringify(value), ctx.now());
    keys.push(key);
  };
  if (input.allowedAccounts !== undefined) {
    put("allowedAccounts", input.allowedAccounts);
    // The settings page shows the same choice; keep its row in step. A caller without the settings permission still changes the policy.
    try { await ctx.call("settings.set_space", { key: "engine.allowed_accounts", value: input.allowedAccounts }); } catch (e) { ctx.log.warn("settings row was not updated", { error: e instanceof Error ? e.message : "unknown" }); }
  }
  if (input.allowedModels !== undefined) put("allowedModels", uniq(input.allowedModels));
  if (input.allowedProviders !== undefined) put("allowedProviders", uniq(input.allowedProviders));
  if (cleanLabels !== undefined) put("labelProviders", cleanLabels);
  if (keys.length === 0) return { ok: true };
  ctx.emit("engine.policy_changed", actorOf(ctx), { keys, by: actorOf(ctx) });
  return { ok: true };
}

/** Why a provider or model may not run, or null. `label` is the label of the open record or thread, when there is one. */
export function blockedBy(policy: Policy, o: { provider?: string | undefined; model?: string | undefined; label?: string | undefined }): "label_provider" | "policy_model" | null {
  if (o.label !== undefined && o.provider !== undefined) {
    const allowed = policy.labelProviders[o.label];
    if (allowed !== undefined && !allowed.includes(o.provider)) return "label_provider";
  }
  if (o.provider !== undefined && policy.allowedProviders.length > 0 && !policy.allowedProviders.includes(o.provider)) return "policy_model";
  if (o.model !== undefined && policy.allowedModels.length > 0 && !policy.allowedModels.includes(o.model)) return "policy_model";
  return null;
}

// ---- defaults

interface FallbackEntry { provider: string; model: string; accountRef?: string }
interface Defaults { provider?: string; model?: string; effort?: Effort; fallback: FallbackEntry[] }

function defaultsOf(ctx: EngineCtx, person: string): Defaults {
  const r = rows(ctx, "SELECT value FROM engine_defaults WHERE person_id = ?", person)[0];
  return r ? (JSON.parse(str(r["value"])) as Defaults) : { fallback: [] };
}

export function defaultsGet(ctx: EngineCtx, _input: Record<string, never>): Defaults {
  ensureExtra(ctx.db);
  return defaultsOf(ctx, actorOf(ctx));
}

export async function defaultsSet(
  ctx: EngineCtx,
  input: { provider?: string; model?: string; effort?: Effort; fallback?: FallbackEntry[] },
): Promise<{ ok: boolean }> {
  ensureExtra(ctx.db);
  const me = actorOf(ctx);
  const cur = defaultsOf(ctx, me);
  const policy = await readPolicy(ctx);
  const check = (o: { provider?: string; model?: string }): void => {
    const why = blockedBy(policy, o);
    if (why !== null) raise(ctx, "validation.bad_input", `${o.model ?? o.provider ?? "That model"} is not allowed by this Space's AI policy.`, { reason: why });
  };
  if (input.effort !== undefined && !EFFORTS.includes(input.effort)) raise(ctx, "validation.bad_input", "Effort is low, medium, high or max.", { field: "effort" });
  const next: Defaults = { ...cur };
  if (input.provider !== undefined) { check({ provider: input.provider }); next.provider = input.provider; }
  if (input.model !== undefined) { check({ model: input.model, ...(next.provider === undefined ? {} : { provider: next.provider }) }); next.model = input.model; }
  if (input.effort !== undefined) next.effort = input.effort;
  if (input.fallback !== undefined) {
    next.fallback = input.fallback.map((f) => {
      if (f.provider.trim() === "" || f.model.trim() === "") raise(ctx, "validation.bad_input", "Each fallback needs a provider and a model.", { field: "fallback" });
      check({ provider: f.provider, model: f.model });
      return { provider: f.provider, model: f.model, ...(f.accountRef === undefined ? {} : { accountRef: f.accountRef }) };
    });
  }
  ctx.db.run("INSERT OR REPLACE INTO engine_defaults (person_id, value, updated_at) VALUES (?, ?, ?)", me, JSON.stringify(next), ctx.now());
  return { ok: true };
}

// ---- person switches

function setFlag(ctx: EngineCtx, person: string, flag: string, enabled: boolean, wrappedKey: string | null): void {
  ctx.db.run("INSERT OR REPLACE INTO engine_person_flags (person_id, flag, enabled, wrapped_key, updated_at) VALUES (?, ?, ?, ?, ?)", person, flag, enabled ? 1 : 0, wrappedKey, ctx.now());
}

export function flagOn(ctx: EngineCtx, person: string, flag: "subscription_share" | "runtime_opt_in"): boolean {
  ensureExtra(ctx.db);
  return Number(rows(ctx, "SELECT enabled FROM engine_person_flags WHERE person_id = ? AND flag = ?", person, flag)[0]?.["enabled"] ?? 0) === 1;
}

type SandboxStopper = (personId: string) => Promise<boolean>;
let stopper: SandboxStopper | null = null;
/** The sandbox host (P-L2_05) binds how a person's server sandbox is killed at boot. Without it, turning the switch off reports sandboxStopped false. */
export function bindSandboxStopper(fn: SandboxStopper | null): void { stopper = fn; }

export async function subscriptionShareSet(ctx: EngineCtx, input: { enabled: boolean }): Promise<{ enabled: boolean; sandboxStopped: boolean }> {
  ensureExtra(ctx.db);
  const me = actorOf(ctx);
  const was = flagOn(ctx, me, "subscription_share");
  const out = await setSpaceUse(
    {
      setSwitch: async (owner, enabled) => { setFlag(ctx, owner, "subscription_share", enabled, null); },
      stopSandbox: async (owner) => (stopper === null ? false : stopper(owner)),
    },
    me, input.enabled,
  );
  if (was !== input.enabled) ctx.emit("engine.subscription_share_changed", me, { personId: me, enabled: input.enabled });
  return out;
}

export function runtimeOptIn(ctx: EngineCtx, input: { enabled: boolean; wrappedRuntimeKey?: string }): { enabled: boolean } {
  ensureExtra(ctx.db);
  const me = actorOf(ctx);
  if (input.enabled && (input.wrappedRuntimeKey === undefined || input.wrappedRuntimeKey === "")) {
    raise(ctx, "validation.bad_input", "Opting in needs the runtime key wrapped for the Space.", { field: "wrappedRuntimeKey" });
  }
  const was = flagOn(ctx, me, "runtime_opt_in");
  // Turning it off deletes the wrapped key: the Space can no longer continue this person's chats.
  setFlag(ctx, me, "runtime_opt_in", input.enabled, input.enabled ? (input.wrappedRuntimeKey ?? null) : null);
  if (was !== input.enabled) ctx.emit("engine.runtime_opt_in_changed", me, { personId: me, enabled: input.enabled });
  return { enabled: input.enabled };
}

/** The wrapped runtime key of a person who opted in, for the host that continues their chats. Null when they have not. */
export function wrappedRuntimeKey(ctx: EngineCtx, person: string): string | null {
  ensureExtra(ctx.db);
  const r = rows(ctx, "SELECT wrapped_key FROM engine_person_flags WHERE person_id = ? AND flag = 'runtime_opt_in' AND enabled = 1", person)[0];
  return r && r["wrapped_key"] !== null && r["wrapped_key"] !== undefined ? str(r["wrapped_key"]) : null;
}

// ---- use policy export

const list = (items: readonly string[]): string => (items.length === 0 ? "All" : items.join(", "));

/** The AI use policy as a Markdown file in the Space's shared knowledge folder. */
export async function usePolicyExport(ctx: EngineCtx, _input: Record<string, never>): Promise<{ fileId: string }> {
  ensureExtra(ctx.db);
  const policy = await readPolicy(ctx);
  const caps = rows(ctx, "SELECT scope, scope_id, caps FROM engine_spend_caps ORDER BY scope, scope_id");
  const tree = (await ctx.call("files.tree", {})) as { roots: Array<{ key: string; title: string; kind: string; folderId?: string }> };
  const folders = tree.roots.filter((r) => r.kind === "folder" && r.folderId !== undefined);
  const root = folders.find((r) => r.key === "knowledge" || r.key === "shared_knowledge") ?? folders[0];
  if (!root || root.folderId === undefined) raise(ctx, "validation.precondition_failed", "There is no folder to save the policy in.");
  const date = new Date(ctx.now()).toISOString().slice(0, 10);
  const lines = [
    `# AI use policy (${date})`, "",
    `Allowed accounts: ${policy.allowedAccounts === "company" ? "company accounts only" : "company and personal accounts"}`,
    `Allowed providers: ${list(policy.allowedProviders)}`,
    `Allowed models: ${list(policy.allowedModels)}`, "",
    "## Providers by label", "",
    ...LABELS.map((l) => `- ${l}: ${policy.labelProviders[l] === undefined ? "all allowed providers" : list(policy.labelProviders[l] ?? [])}`), "",
    "## Limits", "",
    `- Agent-to-agent hops before a person must reply: ${policy.hops.agentHops}`,
    `- Review send-backs before a person decides: ${policy.hops.reviewLoops}`,
    `- CI fix attempts before a person decides: ${policy.hops.ciFixLoops}`, "",
    "## Spend caps", "",
    ...(caps.length === 0 ? ["No caps are set."] : caps.map((c) => `- ${str(c["scope"])}${str(c["scope_id"]) === "" ? "" : ` ${str(c["scope_id"])}`}: ${str(c["caps"])}`)), "",
  ];
  const out = (await ctx.call("files.create", { folderId: root.folderId, name: `AI use policy ${date} ${new Date(ctx.now()).toISOString().slice(11, 16).replace(":", "")}.md`, content: { text: lines.join("\n") }, mime: "text/markdown", idempotencyKey: `ai-use-policy-${ctx.now()}` })) as { file: { fileId: string } };
  return { fileId: out.file.fileId };
}
