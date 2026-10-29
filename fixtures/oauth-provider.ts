// A disposable OAuth provider for the connector tests: authorization-code with PKCE, a bearer API, rotating refresh tokens and revoke. It is a transport port (the daemon's connector network seam), so the
// daemon, the connector pipeline and the Vault are all real and no real account is contacted.
import { createHash } from "node:crypto";

export const CLIENT_SECRET = "client-secret-LIVE-VALUE";
export const PAY_DOMAIN = "api.livepay.test";
/** A connector.toml for the stand-in app: OAuth, a client secret slot, refresh and revoke, one health action. */
export const PAY_TOML = `key = "livepay"\ntitle = "Live Pay"\nmode = "oauth_app"\nscope = "person"\nversion = "0.0.0"\ndomains = ["${PAY_DOMAIN}"]\nhealth = "me"\n\n[auth]\ntype = "oauth2"\nsecret = "Pay_Token"\nclientId = "live-client"\nclientSecret = "Pay_Client"\nauthUrl = "https://${PAY_DOMAIN}/authorize"\ntokenUrl = "https://${PAY_DOMAIN}/token"\nrevokeUrl = "https://${PAY_DOMAIN}/revoke"\nscopes = ["read"]\n\n[[secrets]]\nname = "Pay_Token"\ndescription = "access token"\n\n[[secrets]]\nname = "Pay_Token_refresh"\ndescription = "refresh token"\n\n[[secrets]]\nname = "Pay_Client"\ndescription = "client secret"\n`;
export const PAY_ACTION = JSON.stringify({ name: "me", url: `https://${PAY_DOMAIN}/me`, output: "/user" });

export function oauthProvider() {
  const p = {
    /** code to the PKCE challenge it was issued for; a code the test did not register is refused */
    codes: new Map<string, string>(),
    issued: 0, access: "", refresh: "", refreshes: 0,
    expired: new Set<string>(), usedRefresh: new Set<string>(), seen: [] as string[], revoked: [] as string[],
    expect(code: string, challenge: string): void { p.codes.set(code, challenge); },
    issue() { p.issued++; p.access = `at_ACCESS_${p.issued}`; p.refresh = `rt_REFRESH_${p.issued}`; return { access_token: p.access, refresh_token: p.refresh, token_type: "Bearer", expires_in: 3600 }; },
    network: {
      resolve: async (): Promise<string[]> => ["203.0.113.9"],
      request: async (url: URL, o: { method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; text: string }> => {
        p.seen.push(`${o.method} ${url.pathname}`);
        const form = new URLSearchParams(o.body ?? "");
        const reply = (status: number, body: unknown) => ({ status, text: JSON.stringify(body) });
        if (url.pathname === "/token") {
          if (form.get("client_secret") !== CLIENT_SECRET) return reply(401, { error: "invalid_client" });
          if (form.get("grant_type") === "authorization_code") {
            const challenge = p.codes.get(form.get("code") ?? "");
            if (!challenge || createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") !== challenge) return reply(400, { error: "invalid_grant" });
            p.codes.delete(form.get("code")!);
            return reply(200, p.issue());
          }
          if (form.get("grant_type") === "refresh_token") {
            const token = form.get("refresh_token")!;
            if (token !== p.refresh || p.usedRefresh.has(token)) return reply(400, { error: "invalid_grant" });
            p.usedRefresh.add(token); p.refreshes++;
            return reply(200, p.issue());
          }
        }
        if (url.pathname === "/revoke") { p.revoked.push(form.get("token") ?? ""); return reply(200, {}); }
        if (url.pathname === "/me") {
          const bearer = (o.headers["Authorization"] ?? "").replace(/^Bearer /, "");
          return bearer === p.access && !p.expired.has(bearer) ? reply(200, { user: { name: "Dana" } }) : reply(401, { error: "expired" });
        }
        return reply(404, {});
      },
    },
  };
  return p;
}
