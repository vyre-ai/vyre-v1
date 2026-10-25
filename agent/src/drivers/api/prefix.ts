// Prefix cache (ARCH 6.6): the system prefix and the tool list are hashed (`prefixHash`) and sent in a fixed order with cache markers on the stable part, so a resumed chat's first
// token reads the provider's cached prefix. Anthropic and OpenRouter-to-Anthropic take explicit markers; OpenAI takes a cache key; Google and xAI cache the leading bytes by themselves,
// which only works when those bytes do not change, so the order here is deterministic for every provider.
import type { ApiTool, SystemBlock } from "./types.ts";

/** Tools sorted by name: a set that differs only in order must hash and send the same. */
export function sortTools(tools: readonly ApiTool[]): ApiTool[] {
  return [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Stable blocks first, volatile blocks after, each group in the order given. */
export function orderSystem(system: readonly SystemBlock[]): SystemBlock[] {
  return [...system.filter((b) => b.stable), ...system.filter((b) => !b.stable)];
}

/**
 * A 64-bit fingerprint (two cyrb53-style lanes). It names a prefix for the cache; it protects nothing, so it is not a cryptographic hash (crypto primitives stay in kernel and
 * vault, boundary B3). Two different prefixes colliding would only mean one missed cache note, never a wrong answer.
 */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

export function prefixHash(system: readonly SystemBlock[], tools: readonly ApiTool[], model: string): string {
  const parts: string[] = [model, "\u0000"];
  for (const b of system) if (b.stable) { parts.push(b.text, "\u0000"); }
  parts.push("\u0001");
  for (const t of sortTools(tools)) parts.push(t.name, "\u0000", t.description, "\u0000", JSON.stringify(t.inputSchema ?? null), "\u0000");
  return fingerprint(parts.join(""));
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
