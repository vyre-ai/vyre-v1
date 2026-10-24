// Prefix cache (ARCH 6.6): the system prefix and the tool list are hashed (`prefixHash`) and sent in a fixed order with cache markers on the stable part, so a resumed chat's first
// token reads the provider's cached prefix. Anthropic and OpenRouter-to-Anthropic take explicit markers; OpenAI takes a cache key; Google and xAI cache the leading bytes by themselves,
// which only works when those bytes do not change, so the order here is deterministic for every provider.
import { createHash } from "node:crypto";
import type { ApiTool, SystemBlock } from "./types.ts";

/** Tools sorted by name: a set that differs only in order must hash and send the same. */
export function sortTools(tools: readonly ApiTool[]): ApiTool[] {
  return [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Stable blocks first, volatile blocks after, each group in the order given. */
export function orderSystem(system: readonly SystemBlock[]): SystemBlock[] {
  return [...system.filter((b) => b.stable), ...system.filter((b) => !b.stable)];
}

export function prefixHash(system: readonly SystemBlock[], tools: readonly ApiTool[], model: string): string {
  const h = createHash("sha256");
  h.update(model);
  h.update("\u0000");
  for (const b of system) if (b.stable) { h.update(b.text); h.update("\u0000"); }
  h.update("\u0001");
  for (const t of sortTools(tools)) { h.update(t.name); h.update("\u0000"); h.update(t.description); h.update("\u0000"); h.update(JSON.stringify(t.inputSchema ?? null)); h.update("\u0000"); }
  return h.digest("hex").slice(0, 16);
}

export interface PrefixStats {
  /** Calls whose stable prefix was the same as the call before (the provider should read it from cache). */
  expectedHits: number;
  /** Calls whose prefix changed or was the first. */
  expectedMisses: number;
  /** Tokens the provider reported reading from its cache, summed. */
  cacheReadTokens: number;
  cacheWriteTokens: number;
  lastHash: string | null;
}

export interface PrefixTracker {
  /** Record a call about to be made; returns whether the prefix equals the previous call's. */
  note(hash: string): boolean;
  /** Record what the provider said it cached. */
  settle(read: number, write: number): void;
  stats(): PrefixStats;
}

export function createPrefixTracker(): PrefixTracker {
  const s: PrefixStats = { expectedHits: 0, expectedMisses: 0, cacheReadTokens: 0, cacheWriteTokens: 0, lastHash: null };
  return {
    note(hash) {
      const same = s.lastHash === hash;
      if (same) s.expectedHits += 1; else s.expectedMisses += 1;
      s.lastHash = hash;
      return same;
    },
    settle(read, write) { s.cacheReadTokens += read; s.cacheWriteTokens += write; },
    stats: () => ({ ...s }),
  };
}
