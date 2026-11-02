// The host half of Talk (lib/voice.ts). The module asks; this runs the provider's grant from the server. A key is read at the last moment, put in one header and dropped: it is never logged, stored or returned.
// Every failure is one plain line with a reason the client can act on, and no provider text: a provider's error can echo what it was sent.
import { fail } from "../routes/errors.ts";
import { TOKEN_SECONDS, voiceProvider } from "../../../lib/voice.ts";
import type { GrantFailure } from "../../../lib/voice.ts";
import type { SeamCtx, SeamFetch, VaultPort } from "./ports.ts";

export interface VoiceHostDeps { vault: Pick<VaultPort, "secret">; fetch: SeamFetch }
/** Structural: the module's own VoiceHost accepts this (host never imports a module). */
export interface VoiceHostSeam {
  check(ctx: Pick<SeamCtx, "trace">, p: { provider: string; apiKey: string }): Promise<void>;
  mint(ctx: Pick<SeamCtx, "trace" | "space">, p: { provider: string; handle: string; asker?: string; own: boolean }): Promise<{ token: string; expiresIn: number }>;
}

const refused = (trace: string, name: string, why: GrantFailure, stored: { own: boolean } | null): never => {
  if (why === "key") throw fail("provider.auth_failed", trace, { message: stored === null ? `${name} did not accept that key. Check it and try again.` : stored.own ? `${name} no longer accepts your key. Add a new one in Settings, AI, Talk.` : `${name} no longer accepts your Space's key. An admin can replace it in Console, Voice.`, details: { reason: "revoked" } });
  if (why === "role") throw fail("provider.auth_failed", trace, { message: "That key cannot make short-lived tokens. Make one with the Member role.", details: { reason: "role" } });
  if (why === "busy") throw fail("provider.rate_limited", trace, { message: `${name} is busy. Try again in a moment.` });
  throw fail("provider.unavailable", trace, { message: `${name} is not answering. Try again in a moment.` });
};

export function createVoiceHost(d: VoiceHostDeps): VoiceHostSeam {
  const grant = async (trace: string, provider: string, apiKey: string, ttl: number, stored: { own: boolean } | null): Promise<{ token: string; expiresIn: number }> => {
    const p = voiceProvider(provider);
    if (!p) throw fail("validation.bad_input", trace, { message: "That voice provider is not known." });
    const req = p.grant(apiKey, ttl);
    let status: number, body: string;
    try {
      const r = await d.fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
      status = r.status; body = await r.text();
    } catch { throw fail("provider.network", trace, { message: `Could not reach ${p.name}. Check the connection and try again.` }); }
    const out = p.readGrant(status, body);
    if (!out.ok) return refused(trace, p.name, out.why, stored);
    return { token: out.token, expiresIn: out.expiresIn };
  };
  return {
    check: async (ctx, p) => { await grant(ctx.trace.traceId, p.provider, p.apiKey, 1, null); },
    async mint(ctx, p) {
      let key: string;
      try { key = await d.vault.secret(p.handle, ctx.space, p.asker); }
      catch (e) {
        if (e instanceof Error && /locked/i.test(e.message)) throw fail("auth.unauthenticated", ctx.trace.traceId, { message: "Your Vault is locked. Unlock it, then press the mic again.", details: { reason: "vault_locked" } });
        throw fail("validation.precondition_failed", ctx.trace.traceId, { message: p.own ? "Talk needs a key." : "The Space key is gone from the Vault. An admin can add it again in Console, Voice.", details: { reason: "no_key" } });
      }
      return grant(ctx.trace.traceId, p.provider, key, TOKEN_SECONDS, { own: p.own });
    },
  };
}
