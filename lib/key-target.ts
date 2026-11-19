// Where a Vault key would go: one reading of a request's host, shared by the Gate's hold on a test read, the card that asks the person, the host that sends it, and the HTTP step's check, so the
// four cannot disagree. A host is the URL's own hostname, lower case, trailing dot removed; an IPv4 or IPv6 literal is kept as the URL writes it ("[2001:db8::1]"). Anything else is null, and a
// caller that gets null must refuse or hold, never send.

/** The host of an absolute https URL, or null. */
export function hostOfUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
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
  const bare = raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
  // a connector's "*.x.com" (its declared format) stays a wildcard: it covers every name under x.com, not x.com itself, as the connector port reads it
  if (bare.startsWith("*.")) {
    const rest = hostOfUrl(`https://${bare.slice(2)}/`);
    return rest !== null && rest.includes(".") && !rest.startsWith("[") ? `*.${rest}` : null;
  }
  return hostOfUrl(`https://${bare}/`);
}

/** Does a listed host cover this host: the same name, or a "*.x.com" wildcard over a name under x.com (the connector port's rule). */
export function hostCovers(listed: string, host: string): boolean {
  if (listed === "" || host === "") return false;
  if (listed.startsWith("*.")) return host.endsWith(listed.slice(1)) && host.length > listed.length - 1;
  return listed === host;
}

/** A Vault handle (#Name or #Name.field) anywhere in a call's input, a few levels deep. */
export function carriesHandle(v: unknown, depth = 0): boolean {
  if (typeof v === "string") return /^#[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)?$/.test(v.trim());
  if (v === null || typeof v !== "object" || depth > 5) return false;
  return Object.values(v as Record<string, unknown>).some((x) => carriesHandle(x, depth + 1));
}

export interface SiteSource {
  repo?: string;
  folderId?: string;
  fileId?: string;
  path?: string;
}

/**
 * Where a site's code comes from, as one DNS-shaped name the approved-host store can keep for a Vault key (the name never resolves: it ends in .invalid). A git repo is name.owner.host.repo.invalid (GitHub when only
 * owner/name is given, lowercase as GitHub reads it); files an agent uploaded are <site id>.uploaded.invalid, or <folder or file id>.uploaded.invalid before the site exists. Null when no source can be named (it holds).
 */
export function sourceHost(s: SiteSource | null | undefined, siteId?: string): string | null {
  if (!s) return null;
  if (typeof s.repo === "string" && s.repo.trim() !== "") {
    const raw = s.repo.trim();
    let host = "github.com";
    let path = raw.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "");
    if (/^https:\/\//i.test(raw) && !/^https:\/\/(www\.)?github\.com\//i.test(raw)) {
      const h = hostOfUrl(raw);
      if (h === null) return null;
      host = h;
      try {
        path = new URL(raw).pathname;
      } catch {
        return null;
      }
    }
    const segs = path
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean)
      .map((x) => x.toLowerCase());
    if (segs.length < 2 || segs.some((x) => !/^[a-z0-9._-]+$/.test(x))) return null;
    return approvableHost(`${[...segs].reverse().join(".")}.${host}.repo.invalid`);
  }
  const id = siteId ?? s.folderId ?? s.fileId;
  if ((s.folderId || s.fileId || s.path) && id && /^[A-Za-z0-9_]+$/.test(id))
    return approvableHost(`${id.toLowerCase()}.uploaded.invalid`);
  return null;
}

/** What a call that gives a site Vault keys as env names: the handles, and the site's source when the call carries one (a site that exists is read by its id). */
export function envKeyUse(input: unknown): { handles: string[]; source: SiteSource | null; siteId: string | null } {
  const i = (input ?? {}) as Record<string, unknown>;
  const src = i["source"];
  const source =
    src !== null && typeof src === "object"
      ? (Object.fromEntries(
          ["repo", "folderId", "fileId", "path"].flatMap((k) => {
            const v = (src as Record<string, unknown>)[k];
            return typeof v === "string" ? [[k, v]] : [];
          }),
        ) as SiteSource)
      : null;
  return { handles: envHandles(input), source, siteId: typeof i["siteId"] === "string" ? i["siteId"] : null };
}

/** A Vault handle given as a site's env (sites_env_set entries, sites_ship env): the key goes into the process the site runs, so code a caller chose can send it anywhere. */
export function envHandles(input: unknown): string[] {
  const i = (input ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  for (const list of [i["entries"], i["env"]])
    if (Array.isArray(list))
      for (const e of list) {
        const h = (e as { vaultHandle?: unknown } | null)?.vaultHandle;
        if (typeof h === "string" && h.trim() !== "") out.push(h.trim());
      }
  return out;
}

/** Calls that send a Vault key to a place the call names: a sync spec's or a sample read's app domain, a site's git repo. One rule for them all: the key goes only to a host a person approved for that item. */
export const KEY_HOST_CAPS: ReadonlySet<string> = new Set([
  "sync_specs.sample",
  "sync_specs.survey",
  "sync_specs.validate",
  "sync_specs.preview",
  "sync_specs.apply",
  "sites.create",
  "sites.update",
  "sites.plan",
  "sites.deploy",
  "sites.ship",
  "sites.env_set",
]);

/**
 * The key and the host a call sends it to, read from the input the way the sender will read it: `{ handle, host }`; `host` null when the call names a key but no host this can read (it holds);
 * undefined when no key is involved. Shapes: a spec ({ spec: { auth.vaultHandle, app.domain } }), a sample or survey ({ auth.vaultHandle, domain }), a site ({ source: { tokenHandle, repo } }).
 */
export function keySendOf(input: unknown): { handle: string; host: string | null } | undefined {
  const i = (input ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const hostOfDomain = (d: unknown): string | null =>
    typeof d === "string" ? hostOfUrl(`https://${d.trim()}/`) : null;
  if (i["spec"]?.auth?.vaultHandle !== undefined)
    return { handle: String(i["spec"].auth.vaultHandle), host: hostOfDomain(i["spec"]?.app?.domain) };
  if (i["auth"]?.vaultHandle !== undefined)
    return { handle: String(i["auth"].vaultHandle), host: hostOfDomain(i["domain"]) };
  if (i["source"]?.tokenHandle !== undefined) {
    const repo = typeof i["source"]?.repo === "string" ? i["source"].repo.trim() : "";
    // owner/name is GitHub; anything else is the host of the https address
    const host = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)
      ? "github.com"
      : repo.startsWith("https://")
        ? hostOfUrl(repo)
        : null;
    return { handle: String(i["source"].tokenHandle), host };
  }
  return undefined;
}
