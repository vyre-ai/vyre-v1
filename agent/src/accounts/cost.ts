// Which Space AI account is cheapest (owner ruling 9: among the Space accounts that fit a turn, the cheapest pays). Vyre does not price turns yet, so this is a price tier per kind of account:
// a model on this computer costs nothing, a flat monthly plan (OpenCode Go) less than a key billed per token, a router or a custom endpoint in between. Ties keep the order the Vault lists them in.
const TIER: Readonly<Record<string, number>> = { local: 0, opencode_go: 1, openrouter: 2, custom: 2, google: 2, xai: 3, openai: 3, anthropic: 3 };

/** Lower is cheaper. An unknown driver sits with the per-token keys. */
export function costTier(driver: string): number {
  return TIER[driver] ?? 3;
}
