// Providers (spec 3.8, 2.17): the words a person reads about an AI provider. How it connects, whose it is, what it cost this month, and who uses it. Pure, so the list, the detail and the tests agree.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { Provider } from "../layout/model.ts";

export type Catalog = CapMap["providers.catalog"]["out"]["providers"][number];
export type ConnectionKind = Provider["connection"];

export const CONNECTION_NAME: Readonly<Record<ConnectionKind, string>> = { subscription: "Subscription", api_key: "API key", local_model: "Local model" };
/** What each way of connecting means, in one line, for the gallery. */
export const CONNECTION_NOTE: Readonly<Record<ConnectionKind, string>> = {
  subscription: "Sign in with your own plan. It stays yours and follows you across Spaces and devices.",
  api_key: "Paste a key once. It can be shared with people and agents.",
  local_model: "A model running on a computer you control. Give its address.",
};

/** "Subscription, yours" or "API key #Northwind_Anthropic": how a provider signs in, as the row says it. */
export function howConnected(p: Pick<Provider, "connection" | "via">): string {
  return p.connection === "subscription" ? "Subscription, yours" : p.via;
}

/** "Subscription or API key": the ways a catalog provider connects. */
export function connectionList(c: Pick<Catalog, "connections">): string {
  const names: string[] = [];
  for (const k of c.connections) names.push(CONNECTION_NAME[k]);
  return names.join(" or ");
}

export const scopeWords = (p: Pick<Provider, "scope">): string => (p.scope === "mine" ? "Mine" : "Shared");

/** A subscription sign-in is never shareable (spec 3.8); an API key and a local model can be. */
export const canShare = (p: Pick<Provider, "connection">): boolean => p.connection !== "subscription";

export function stateWords(state: Provider["state"]): string {
  return state === "ok" ? "Working" : state === "needs_sign_in" ? "Needs you to sign in again" : "Failing, check the key";
}

export function tokenWords(tokens: number): string {
  if (tokens >= 1_000_000) return `${trim(tokens / 1_000_000)}M tokens`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k tokens`;
  return `${tokens} tokens`;
}
const trim = (n: number): string => (Math.round(n * 10) / 10).toString();

export const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/** "4.2M tokens this month" and, when it costs money, "4.2M tokens, $13.20 this month". A subscription costs nothing per token. */
export function usageWords(p: Pick<Provider, "usage">): string {
  const { tokens, costCents } = p.usage;
  if (tokens === 0) return "Not used this month";
  return costCents > 0 ? `${tokenWords(tokens)}, ${dollars(costCents)} this month` : `${tokenWords(tokens)} this month`;
}

/** An Automation id starts aut_; everything else that uses a provider is an agent. */
export const userKind = (id: string): "automation" | "agent" => (id.startsWith("aut_") ? "automation" : "agent");

export function countWords(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The line a test result becomes. */
export function testWords(out: { ok: boolean; models: readonly string[]; latencyMs: number; detail?: string }): string {
  if (!out.ok) return out.detail ? `That did not connect. ${out.detail}` : "That did not connect.";
  return `Connected in ${out.latencyMs} ms. ${countWords(out.models.length, "model")} available.`;
}

/** Local model addresses must name a host; a bare "localhost:11434" gets http. Returns null when it cannot be an address. */
export function normalizeAddress(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : `http://${t}`;
  return /^https?:\/\/[^\s/]+(:\d+)?(\/\S*)?$/i.test(withScheme) ? withScheme : null;
}
