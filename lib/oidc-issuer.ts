// Which issuer a sign-in provider may name. Google and Microsoft are fixed by the code (an admin never types a URL for them): Google is accounts.google.com, Microsoft is login.microsoftonline.com
// with only the tenant id configurable (a specific tenant, never a shared one). Only a provider with no fixed issuer (Okta) takes an address from the admin, and that address is refused when it is a private or local one.
import { isIP } from "node:net";
import { normalizedHost, refusesAddress } from "./address-guard.ts";

export const GOOGLE_ISSUER = "https://accounts.google.com";
const MS_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MS_ISSUER = /^https:\/\/login\.microsoftonline\.com\/([^/]+)\/v2\.0$/i;

/** The tenant a Microsoft sign-in is for, read back from its pinned issuer. */
export function tenantOf(issuer: string): string | undefined { const t = MS_ISSUER.exec(issuer)?.[1]; return t && MS_GUID.test(t) ? t.toLowerCase() : undefined; }
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
    // Sign-in needs one specific tenant: the shared ones (common, organizations, consumers) would let a user of any tenant present a token
    const tenant = MS_ISSUER.exec(t)?.[1] ?? t;
    if (!MS_GUID.test(tenant)) return { error: "Microsoft sign-in needs the tenant id (a GUID), not common, organizations or consumers" };
    return { issuer: `https://login.microsoftonline.com/${tenant.toLowerCase()}/v2.0`, free: false };
  }
  let url: URL;
  try { url = new URL(t); } catch { return { error: "the issuer is not a web address" }; }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return { error: "the issuer must be a plain https address" };
  if (refusedHost(url.hostname)) return { error: "the issuer must be a public address" };
  return { issuer: t, free: true };
}
