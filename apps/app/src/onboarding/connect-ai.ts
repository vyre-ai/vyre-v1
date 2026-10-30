// Connect your AI, as onboarding does it. A subscription sign-in or an API key ends as a provider in the person's own Mine Vault (providers.subscription_start / providers.add).
// The key is typed into a secure field and goes straight to providers.add; it is never put in a chat line, an event or a card, and the Assistant sees only the provider id that comes back.
import type { CapCall } from "../shell/session/caps.ts";

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

export interface SignInFlow { flowId: string; instruction: string }

export async function startSubscription(call: CapCall, providerKey: string, idempotencyKey: string): Promise<SignInFlow> {
  if (!SUBSCRIPTIONS.some((o) => o.key === providerKey)) throw new Error("Choose Claude, ChatGPT or Grok.");
  const out = await call("providers.subscription_start", { providerKey, idempotencyKey }) as SignInFlow;
  return { flowId: out.flowId, instruction: out.instruction };
}

/** Resolves with the provider id once the sign-in has finished on this computer; rejects with a plain line when it has not. */
export async function finishSubscription(call: CapCall, flowId: string): Promise<string> {
  try {
    const out = await call("providers.subscription_complete", { flowId }) as { provider: { id: string } };
    return out.provider.id;
  } catch (e) {
    const code = (e as { code?: string }).code;
    throw new Error(code === "validation.precondition_failed" ? "The sign-in has not finished yet. Finish it on your computer, then press Done again." : "Could not finish the sign-in. Try again.");
  }
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
