// Which issuer a sign-in provider may name. Google and Microsoft are fixed by the code (an admin never types a URL for them): Google is accounts.google.com, Microsoft is login.microsoftonline.com
// with only the tenant configurable. Only a provider with no fixed issuer (Okta) takes an address from the admin, and that address is refused when it is a private or local one.
import { isIP } from "node:net";
import { normalizedHost, refusesAddress } from "./address-guard.ts";

export const GOOGLE_ISSUER = "https://accounts.google.com";
const MS_TENANT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|common|organizations|consumers|[a-z0-9][a-z0-9.-]*\.[a-z]{2,})$/i;
const MS_ISSUER = /^https:\/\/login\.microsoftonline\.com\/([^/]+)\/v2\.0$/i;
/** Tenant names whose discovery document names the real tenant by the {tenantid} placeholder. */
export const MS_SHARED_TENANTS: readonly string[] = ["common", "organizations", "consumers"];

/** A host a server must not be sent to: a local name, or an address that is not public. */
export function refusedHost(raw: string): boolean {
  const host = normalizedHost(raw);
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || !host.includes(".") && isIP(host) === 0) return true;
  return isIP(host) !== 0 && refusesAddress(host);
}

/** The issuer to use for a provider, or why the typed one cannot be used. `typed` matters only for Microsoft (its tenant) and a provider with no fixed issuer. */
export function pinIssuer(key: string, typed: string | undefined): { issuer: string; free: boolean } | { error: string } {
  const t = (typed ?? "").trim().replace(/\/+$/, "");
  if (key === "google") return { issuer: GOOGLE_ISSUER, free: false };
  if (key === "microsoft") {
    const tenant = MS_ISSUER.exec(t)?.[1] ?? (MS_TENANT.test(t) ? t : undefined);
    if (!tenant || !MS_TENANT.test(tenant)) return { error: "Microsoft takes only the tenant: a tenant id, or the domain of the tenant" };
    return { issuer: `https://login.microsoftonline.com/${tenant}/v2.0`, free: false };
  }
  let url: URL;
  try { url = new URL(t); } catch { return { error: "the issuer is not a web address" }; }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return { error: "the issuer must be a plain https address" };
  if (refusedHost(url.hostname)) return { error: "the issuer must be a public address" };
  return { issuer: t, free: true };
}
