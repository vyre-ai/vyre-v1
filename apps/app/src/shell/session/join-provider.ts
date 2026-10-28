import type { JoinValues } from "../../join/JoinFlow.tsx";
import type { CapCall } from "./caps.ts";

/** Only a verified new member may connect a Mine provider. The caller owns retry state. */
export async function addJoinedApiKey(call: CapCall, ai: JoinValues["ai"], idempotencyKey: string): Promise<string> {
  if (ai.choice !== "key" || !ai.key?.trim() || !ai.providerKey) throw new Error("Choose the provider for your API key.");
  const out = await call("providers.add", { providerKey: ai.providerKey, connection: "api_key", apiKey: ai.key.trim(), scope: "mine", idempotencyKey }) as { provider: { id: string } };
  return out.provider.id;
}
