// Changing the AI account after one was connected (the Connect your AI step, reopened). Pure words and rules; the card does the calls (providers.list, providers.remove).
export interface AccountRow { id: string; providerKey: string; name: string; via?: string; scope?: string; itemName?: string }

const LABELS: Record<string, string> = { "claude-code": "Claude", anthropic: "Claude API", codex: "ChatGPT (Codex)", openai: "OpenAI", grok: "Grok", xai: "xAI", openrouter: "OpenRouter", "opencode-go": "OpenCode Go" };

/** One line for an account: the name the Vault gives it, else the provider as people say it. */
export function accountLine(a: Pick<AccountRow, "providerKey" | "name" | "itemName">): string {
  return (a.itemName ?? "").trim() || LABELS[a.providerKey] || (a.name ?? "").trim() || a.providerKey;
}

/** After an account is disconnected here: with none left the step is open again ("reopen"); otherwise it stays done. */
export function afterRemoval(left: readonly AccountRow[]): "reopen" | "stay" {
  return left.length === 0 ? "reopen" : "stay";
}
