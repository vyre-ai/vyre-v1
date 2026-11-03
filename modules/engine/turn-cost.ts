// What one turn cost, from what was recorded with it (chat.reply_details). The rule is accuracy: a figure is either the provider's own, or our list price times the provider's own counts.
// Nothing is estimated and nothing unknown becomes 0.
//   subscription  a sign-in (Claude, ChatGPT, Grok): the turn is in the person's plan and has no per-token price, whatever figure the engine printed
//   reported      the provider priced the call itself (Claude Code's total_cost_usd on an API key, OpenRouter's usage.cost)
//   catalog       prices.json times the counts: input, output and cache reads; a count with no listed price is named in `missing`, so the total says it is partial
//   unknown       none of the above: the Details say the provider did not report it
import { readFileSync } from "node:fs";
import { resolvePick, shippedModels } from "./live-models.ts";

export interface Price { in: number; out: number; cacheRead?: number; cacheWrite?: number; longPrompt?: { over: number; in: number; out: number } }
export interface CostLine { kind: "input" | "output" | "cache_read" | "cache_write"; tokens: number; perMillion: number; micros: number }
export interface TurnCost { source: "subscription" | "reported" | "catalog" | "unknown"; micros?: number; lines?: CostLine[]; priceAsOf?: string; missing?: string[] }
export interface CostIn {
  model: string; driver?: string; provider?: string; accountKind?: string;
  tokensIn: number; tokensOut: number; cacheReadTokens?: number; cacheWriteTokens?: number; costUsd?: number;
}

interface PriceFile { asOf: string; providers: Record<string, Record<string, Price>> }
let book: PriceFile | null = null;
function prices(): PriceFile {
  book ??= JSON.parse(readFileSync(new URL("./prices.json", import.meta.url), "utf8")) as PriceFile;
  return book;
}

/** Engines and drivers that bill at a provider's list prices: Claude Code on an API key is Anthropic's. */
const PRICED_AS: Record<string, string> = { anthropic: "anthropic", claude_code: "anthropic" };

/** The list price of a model on the provider the turn ran through, its alias (opus) read as the model it means today. */
export function priceFor(model: string, driver?: string, provider?: string): { price: Price; asOf: string } | null {
  const key = PRICED_AS[driver ?? ""] ?? PRICED_AS[provider ?? ""] ?? provider ?? "";
  const table = prices().providers[key];
  if (!table || model === "") return null;
  const id = table[model] ? model : driver ? resolvePick(shippedModels(driver), model) : model;
  const price = table[id];
  return price ? { price, asOf: prices().asOf } : null;
}

const micros = (tokens: number, perMillion: number): number => Math.round(tokens * perMillion);

export function costOf(c: CostIn): TurnCost {
  if (c.accountKind === "subscription") return { source: "subscription" };
  if (c.costUsd !== undefined) return { source: "reported", micros: Math.round(c.costUsd * 1e6) };
  const found = priceFor(c.model, c.driver, c.provider);
  if (!found) return { source: "unknown" };
  const p = found.price;
  // the input count holds the cache reads and writes too: what is left is the input billed at the full rate
  const cached = (c.cacheReadTokens ?? 0) + (c.cacheWriteTokens ?? 0);
  const plain = Math.max(0, c.tokensIn - cached);
  const long = p.longPrompt && c.tokensIn > p.longPrompt.over ? p.longPrompt : null;
  const lines: CostLine[] = [];
  const missing: string[] = [];
  const add = (kind: CostLine["kind"], tokens: number, rate: number | undefined): void => {
    if (tokens <= 0) return;
    if (rate === undefined) { missing.push(kind); return; }
    lines.push({ kind, tokens, perMillion: rate, micros: micros(tokens, rate) });
  };
  add("input", plain, long ? long.in : p.in);
  add("output", c.tokensOut, long ? long.out : p.out);
  if (c.cacheReadTokens !== undefined) add("cache_read", c.cacheReadTokens, p.cacheRead);
  if (c.cacheWriteTokens !== undefined) add("cache_write", c.cacheWriteTokens, p.cacheWrite);
  return { source: "catalog", micros: lines.reduce((a, l) => a + l.micros, 0), lines, priceAsOf: found.asOf, ...(missing.length > 0 ? { missing } : {}) };
}
