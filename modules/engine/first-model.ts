// The model a turn runs on when nothing names one (no chat pick, no thread record, no agent model) on a person's API key: the first hour of a Personal Space, where the Assistant has no
// model and the person has not picked one (lead, 12 Nov 2026). It is the default nobody chose, so it is resolved per turn and never written anywhere: a later pick or agent model wins at
// once, and the reply's label shows the model that ran, so the person sees it and can change it.
//   source   the list the key's check kept (one GET /models through providers.test when the engine has none kept): never a completion, never the model checks the menu starts
//   chat     the adapter's chat filter where it has one (OpenAI), and abilities().tools for the rest: no image, speech, embedding or moderation model
//   order    a model a chat turn already ran on this account ("ran"; a probe's "ok" does not count: it sends no tools), then the provider's balanced tier below (its own order per provider), then the vendor's order (the rule fitModel uses for the Space AI key)
//   avoid    pro, preview, audio, realtime, search, transcribe, image, tts, whisper, translate and diarize models, unless nothing else passes
//   policy   only what the Space's AI policy allows; when the key lists chat models but the policy allows none, the turn says so in the policy's words
//   never    a subscription (its CLI keeps its own default) or OpenRouter (it runs its own default)
import { ADAPTERS } from "../../agent/src/drivers/api/driver.ts";
import { blockedBy, PROVIDER_DEFAULT_DRIVERS } from "./handlers/extra/config.ts";
import { abilities } from "./handlers/extra/models.ts";
import type { Policy } from "./handlers/extra/config.ts";
import { markRan, ranFor, unavailableFor } from "./model-health.ts";
import { saveTested, savedTested } from "./live-models.ts";

/**
 * The default nobody chose: balanced cost and ability per provider. The owner may change this table. A provider with no entry takes the vendor's first chat model.
 * order: "vendor" where the provider's own list is newest first (Anthropic's /v1/models), so the first match listed wins and a dated id is never compared as a number;
 *        "newest" where the vendor's order means nothing (OpenAI, Google, xAI), so the matches are sorted newest first by name.
 * A "-latest" alias in a vendor-ordered list comes after the dated ids (an old alias must not win), and serves only when it is the one match.
 */
export const BALANCED_TIER: Readonly<Record<string, { match: RegExp; order: "vendor" | "newest" }>> = {
  anthropic: { match: /sonnet/i, order: "vendor" },
  openai: { match: /^gpt-\d[\d.]*o?$/i, order: "newest" },   // the plain flagship: gpt-5, gpt-5.5, gpt-4o, gpt-4.1; no -mini, -nano, -pro, no dated or preview suffix
  google: { match: /gemini-[\d.]+-flash$/i, order: "newest" },
  xai: { match: /^grok-\d[\d.]*$/i, order: "newest" },
};
/** Never the default while anything else passes: costly or not a plain chat model. */
export const AVOID_DEFAULT = /pro$|-pro-|preview|audio|realtime|search|transcribe|image|tts|whisper|translate|diarize/i;

/** Newest first by the version in the id (gpt-4.1 after gpt-5, before gpt-4o: 4.1 is above 4), then by name. */
const versionOf = (m: string): number[] => (/(\d+(?:\.\d+)*)/.exec(m)?.[1] ?? "").split(".").filter(Boolean).map(Number);
const newestFirst = (a: string, b: string): number => {
  const va = versionOf(a), vb = versionOf(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) { const d = (vb[i] ?? 0) - (va[i] ?? 0); if (d !== 0) return d; }
  return b.localeCompare(a, "en", { numeric: true });
};
const alias = (m: string): boolean => /-latest$/i.test(m);
/** A model id as a policy writes it: Google may list "models/<id>" where the policy says "<id>". */
export const policyId = (m: string): string => m.replace(/^models\//, "");

/** The pure rule. `blocked(model)` is the Space policy's answer for that model on this provider. */
export function pickDefault(models: readonly string[], o: { provider: string; driver?: string; confirmed: ReadonlySet<string>; blocked: (model: string) => boolean }): string | undefined {
  const filter = (ADAPTERS as Record<string, { chatModels?: RegExp }>)[o.driver ?? o.provider]?.chatModels;
  const chat = models.filter((m) => (filter === undefined || filter.test(m)) && abilities(m, o.provider).tools);
  const allowed = chat.filter((m) => !o.blocked(m));
  const plain = allowed.filter((m) => !AVOID_DEFAULT.test(m));
  const pool = plain.length > 0 ? plain : allowed;
  const ran = pool.find((m) => o.confirmed.has(m));
  if (ran) return ran;
  const tier = BALANCED_TIER[o.provider];
  const matches = tier ? pool.filter((m) => tier.match.test(m)) : [];
  const balanced = tier?.order === "vendor" ? [...matches.filter((m) => !alias(m)), ...matches.filter(alias)][0] : [...matches].sort(newestFirst)[0];
  return balanced ?? pool[0];
}

type Db = Parameters<typeof savedTested>[0];
export interface DefaultFor {
  db: Db; now: number;
  call(cap: string, input: unknown): Promise<unknown>;
  policy: Pick<Policy, "allowedModels" | "allowedProviders" | "labelProviders">;
}
/** What a turn with no model named runs on for this account: { model }, { why: "policy" } when the key lists chat models but the policy allows none, or {} (none: the plain words). */
export async function defaultModelFor(d: DefaultFor, account: { ref: string; driver: string; provider: string; kind: string; providerId?: string | undefined; models?: readonly string[] | undefined }): Promise<{ model?: string; why?: "policy" }> {
  if (account.kind !== "api_key" || PROVIDER_DEFAULT_DRIVERS.has(account.driver)) return {};
  let listed: string[] = account.models?.length ? [...account.models] : [];
  if (listed.length === 0) { try { listed = savedTested(d.db, account.ref); } catch { /* nothing kept */ } }
  if (listed.length === 0 && account.providerId) {
    // the key's own check: one GET /models, kept; no completion and no model checks are started here
    try {
      const r = (await d.call("providers.test", { providerId: account.providerId })) as { ok?: boolean; models?: string[] };
      if (r.ok === true && Array.isArray(r.models) && r.models.length > 0) { listed = r.models; try { saveTested(d.db, account.ref, account.driver, d.now, listed); } catch { /* kept next time */ } }
    } catch { /* the key could not be asked now: none */ }
  }
  if (listed.length === 0) return {};
  const pol = { allowedAccounts: "any", allowedModels: d.policy.allowedModels ?? [], allowedProviders: d.policy.allowedProviders ?? [], labelProviders: d.policy.labelProviders ?? {} } as unknown as Policy;
  let confirmed: ReadonlySet<string> = new Set();
  try { confirmed = new Set([...ranFor(d.db, account.ref, d.now)].map(bare)); } catch { /* none known */ }
  // a model the account refused lately (a turn, a probe, or a default refused below) is not the default
  try { const bad = new Set([...unavailableFor(d.db, account.ref, d.now)].map(bare)); if (bad.size > 0) listed = listed.filter((m) => !bad.has(bare(m))); } catch { /* none marked */ }
  const model = pickDefault(listed, { provider: account.provider, driver: account.driver, confirmed, blocked: (m) => blockedBy(pol, { provider: account.provider, model: policyId(m) }) !== null });
  if (model) return { model };
  const anyChat = pickDefault(listed, { provider: account.provider, driver: account.driver, confirmed, blocked: () => false });
  return anyChat ? { why: "policy" } : {};
}

/** The model id without a provider prefix ("openai/gpt-5" and "gpt-5" are one model of one account). */
const bare = (m: string): string => m.replace(/^[a-z][a-z0-9_-]*\//i, "");
/** After a chat turn: a completed turn marks its model "ran" for the account, the one mark the default's first rule reads. (A failed default is not marked tonight: rc.27 BACKLOG.) */
export function afterChatTurn(db: Db, turn: { state: string; model: string | null }, ref: string, now: number): void {
  if (turn.model && turn.state === "completed") markRan(db as never, ref, turn.model, now);
}
