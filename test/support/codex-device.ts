// The ChatGPT (Codex) device sign-in as the providers answer it, for tests that need a Codex subscription connected on a booted daemon (lifted from test/providers.signin.live.test.ts):
// the host's network seam answers OpenAI's three device endpoints, with the person's approval already given. connectCodex() runs the flow the way the app does and allows the Space to use it.
import assert from "node:assert/strict";
import type { SeamFetch } from "../../host/src/seams/ports.ts";
import type { Daemon } from "../../host/src/daemon/daemon.ts";

export const CODEX_ACCESS = "codex-access-LIVE-0123456789"; // secret-scan: fake

export function codexDeviceFetch(): SeamFetch {
  const reply = (status: number, json: unknown) => ({ status, text: async () => JSON.stringify(json), arrayBuffer: async () => new ArrayBuffer(0) });
  return async (url) => {
    if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") return reply(200, { device_auth_id: "dev_live", user_code: "LIVE-1234", interval: "1" });
    if (url === "https://auth.openai.com/api/accounts/deviceauth/token") return reply(200, { authorization_code: "AC-live", code_challenge: "c", code_verifier: "V-live" });
    if (url === "https://auth.openai.com/oauth/token") return reply(200, { id_token: "a.b.c", access_token: CODEX_ACCESS, refresh_token: "rt-live" });
    return reply(404, {});
  };
}

/** Sign in with ChatGPT on the daemon (the vault already unlocked): start, wait out the poll gap, complete, and let the Space use it. Answers the provider's id. */
export async function connectCodex(d: Daemon, call: (d: Daemon, cap: string, input: unknown) => Promise<{ status: number; data: any }>): Promise<string> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const started = await call(d, "providers.subscription_start", { providerKey: "codex", idempotencyKey: "cx-flow" });
  assert.equal(started.status, 200, JSON.stringify(started.data));
  let done = await call(d, "providers.subscription_complete", { flowId: started.data.flowId });
  for (let i = 0; i < 8 && done.data.waiting === true; i++) { await new Promise((r) => setTimeout(r, 1_200)); done = await call(d, "providers.subscription_complete", { flowId: started.data.flowId }); }
  assert.equal(done.status, 200, JSON.stringify(done.data));
  const id = done.data.provider.id as string;
  const allowed = await call(d, "providers.set_space_use", { idempotencyKey: "cx-spaceuse", providerId: id, allow: true });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
  return id;
}
