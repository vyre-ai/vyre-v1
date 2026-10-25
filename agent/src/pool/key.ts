// The warm pool's key (ARCH 6.6): (driver.id, accountRef, model, sandboxId, mcpProfile). Two turns that agree on all five can share a warm session; any difference is a different engine.

export interface PoolKey {
  /** 'anthropic' | 'openai' | 'openrouter' | 'google' | 'xai' | 'opencode_go' | 'local' | 'claude_code' | 'codex' | 'grok'. */
  driver: string;
  /** The account that pays: a vault handle or a subscription reference. Never a secret value. */
  accountRef: string | null;
  model: string;
  /** The sandbox a CLI runs in (per-person container, Seatbelt profile); null for an API driver. */
  sandboxId: string | null;
  /** The tool set the session's MCP endpoint offers. */
  mcpProfile: string | null;
}

export const keyString = (k: PoolKey): string => JSON.stringify([k.driver, k.accountRef, k.model, k.sandboxId, k.mcpProfile]);
