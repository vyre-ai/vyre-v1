// Which model a learning pass runs on (owner ruling 3 Nov 2026): the cheapest one the asker's own account offers, read from the account's live model list (engine.models.list), and only
// when that list says nothing about price, a small table of cost tiers by name. A Claude subscription learns with Haiku through Claude Code; Codex with the smallest model on its list; OpenCode
// Go, OpenRouter and API keys with the cheapest model by the catalog's price fields. A free OpenRouter model (":free") is never picked: those may keep what they are sent, and this is personal.
// No list and no table entry for the driver means no model: learning stays on the free rules for that pass rather than guess at something that may cost more.

/** One row of engine.models.list, with the price fields a live catalog may carry (lane l-livemodels). Prices are compared within one list, so their unit does not matter. */
export interface ListedModel {
  model: string; provider?: string; allowed?: boolean;
  priceIn?: number; priceOut?: number;
  price?: { in?: number; out?: number };
  pricing?: { prompt?: number | string; completion?: number | string };
}

/** Not a chat model: embeddings, speech, images, moderation and the like. */
const NOT_CHAT = /embed|tts|whisper|dall-?e|image|audio|realtime|moderation|transcri|speech|rerank|computer-use|search-preview/i;

/** Cost tiers by name, cheapest first; the first pattern that matches wins, so "o3-mini" is a mini and "gemini-flash-lite" is a lite. Unknown names sit in the middle (3). */
const TIERS: ReadonlyArray<readonly [RegExp, number]> = [
  [/nano|tiny|lite|\b(?:1|3|7|8)b\b/i, 0],
  [/haiku|mini|flash|small|fast|instant|gemma|\b(?:9|12)b\b/i, 1],
  [/opus|ultra|\bmax\b|405b|\bpro\b|large|\bo1\b|\bo3\b/i, 4],
  [/sonnet|medium|turbo|70b/i, 2],
];
export function tierOf(model: string): number {
  for (const [re, tier] of TIERS) if (re.test(model)) return tier;
  return 3;
}

const n = (v: unknown): number | undefined => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined;
};
/** A learning pass reads far more than it writes (a few thousand tokens in, a few hundred out), so input price weighs ten times output. Undefined when the row carries no price. */
export function costOf(m: ListedModel): number | undefined {
  const pin = n(m.priceIn) ?? n(m.price?.in) ?? n(m.pricing?.prompt);
  const pout = n(m.priceOut) ?? n(m.price?.out) ?? n(m.pricing?.completion);
  if (pin === undefined && pout === undefined) return undefined;
  return (pin ?? 0) * 10 + (pout ?? 0);
}

/** When the live list is empty or unreadable: the one model per driver we know is the cheap one. Other drivers learn by rules until their list answers. */
export const FALLBACK_MODEL: Readonly<Record<string, string>> = { claude_code: "haiku", anthropic: "claude-haiku-5-5" };

/** The cheapest model for a learning pass on an account of this driver, from its live list. Null: no model we can call cheap; the pass uses the rules. */
export function cheapestModel(driver: string, listed: readonly ListedModel[]): string | null {
  const usable = listed.filter((m) => m.allowed !== false && m.model !== "" && !NOT_CHAT.test(m.model) && !/:free$/i.test(m.model));
  if (driver === "claude_code") {
    // a Claude subscription: Haiku through Claude Code, the newest Haiku the list names, else the CLI's own alias
    const haiku = usable.map((m) => m.model).filter((id) => /haiku/i.test(id)).sort();
    return haiku.at(-1) ?? FALLBACK_MODEL["claude_code"]!;
  }
  if (usable.length === 0) return FALLBACK_MODEL[driver] ?? null;
  const priced = usable.map((m) => ({ m, cost: costOf(m) })).filter((x): x is { m: ListedModel; cost: number } => x.cost !== undefined);
  if (priced.length > 0) {
    priced.sort((a, b) => a.cost - b.cost || tierOf(a.m.model) - tierOf(b.m.model) || a.m.model.localeCompare(b.m.model));
    return priced[0]!.m.model;
  }
  const byTier = [...usable].sort((a, b) => tierOf(a.model) - tierOf(b.model) || a.model.length - b.model.length || a.model.localeCompare(b.model));
  return byTier[0]!.model;
}
