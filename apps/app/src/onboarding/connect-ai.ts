// Connect your AI, as onboarding does it. A subscription sign-in (the provider's own, started by the server) or an API key ends as a provider in the person's own Mine Vault (providers.subscription_start / providers.add).
// The key is typed into a secure field and goes straight to providers.add; it is never put in a chat line, an event or a card, and the Assistant sees only the provider id that comes back.
import type { CapCall } from "../shell/session/caps.ts";
import { startFlow } from "../ai-signin/flow.ts";
import type { Flow } from "../ai-signin/flow.ts";

export interface AiOption { key: string; label: string; help: string }
/** Sign in with a subscription: the provider keys are the Vault's own (modules/vault/providers). */
export const SUBSCRIPTIONS: readonly AiOption[] = [
  { key: "claude-code", label: "Claude", help: "Your Claude subscription" },
  { key: "codex", label: "ChatGPT", help: "Your ChatGPT subscription through Codex" },
  { key: "grok", label: "Grok", help: "Your Grok subscription" },
];
/** Paste an API key. */
export const API_KEYS: readonly AiOption[] = [
  { key: "anthropic", label: "Anthropic", help: "Claude API key" },
  { key: "openai", label: "OpenAI", help: "OpenAI API key" },
  { key: "xai", label: "xAI", help: "Grok API key" },
  { key: "openrouter", label: "OpenRouter", help: "One key, many models" },
];

export type SignInFlow = Flow;

/** Press "Sign in with X": the server starts that provider's own sign-in and answers its link (and the code to type, where the provider shows one). */
export async function startSubscription(call: CapCall, providerKey: string, idempotencyKey: string): Promise<SignInFlow> {
  if (!SUBSCRIPTIONS.some((o) => o.key === providerKey)) throw new Error("Choose Claude, ChatGPT or Grok.");
  return startFlow(call, providerKey, idempotencyKey);
}

/** The key goes to the Vault in this one call. The caller clears its field whether this resolves or rejects. */
export async function saveApiKey(call: CapCall, providerKey: string, key: string, idempotencyKey: string): Promise<string> {
  if (!API_KEYS.some((o) => o.key === providerKey)) throw new Error("Choose the provider this key belongs to.");
  const value = key.trim();
  if (value === "") throw new Error("Paste your API key.");
  try {
    const out = await call("providers.add", { providerKey, connection: "api_key", apiKey: value, scope: "mine", idempotencyKey }) as { provider: { id: string } };
    return out.provider.id;
  } catch (e) {
    // the message never repeats the key
    throw new Error((e as { code?: string }).code === "auth.unauthenticated" ? "Your Mine Vault is locked on this device. Unlock it, then try again." : "Could not save this key. Check it and try again.");
  }
}
