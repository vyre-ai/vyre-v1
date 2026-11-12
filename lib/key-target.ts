// Where a Vault key would go: one reading of a request's host, shared by the Gate's hold on a test read, the card that asks the person, the host that sends it, and the HTTP step's check, so the
// four cannot disagree. A host is the URL's own hostname, lower case, trailing dot removed; an IPv4 or IPv6 literal is kept as the URL writes it ("[2001:db8::1]"). Anything else is null, and a
// caller that gets null must refuse or hold, never send.

/** The host of an absolute https URL, or null. */
export function hostOfUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.username !== "" || u.password !== "") return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  return h === "" ? null : h;
}

/** The URL a connector's test read sends: the path when it is a full address, else the first listed domain with the path. Null when it names no https host. */
export function keyReadUrl(input: unknown): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const r = input as Record<string, unknown>;
  const path = typeof r["path"] === "string" ? r["path"].trim() : "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return hostOfUrl(path) === null ? null : path;
  const first = Array.isArray(r["domains"]) && typeof r["domains"][0] === "string" ? r["domains"][0].trim() : "";
  if (first === "" || !path.startsWith("/")) return null;
  const url = `https://${first}${path}`;
  return hostOfUrl(url) === null ? null : url;
}

/** The host a connector's test read sends its key to, or null. */
export function keyReadHost(input: unknown): string | null {
  const url = keyReadUrl(input);
  return url === null ? null : hostOfUrl(url);
}

/** A host as a person approves it: a DNS name or an IP literal, in the spelling hostOfUrl gives. Null otherwise. */
export function approvableHost(raw: string): string | null {
  const h = hostOfUrl(`https://${raw.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "")}/`);
  return h;
}
