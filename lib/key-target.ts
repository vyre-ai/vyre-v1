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
  /** The branch of a git source and the app's folder inside it: another branch or folder is another source (an agent can often push a branch it cannot push the production branch). */
  branch?: string;
  root?: string;
  /** For uploaded files: a fingerprint of what the files are now (their ids and versions), so replaced files are other code. */
  fp?: string;
}

/**
 * Where a site's code comes from, as one canonical string; the approved-key store keeps its hash (sourceKeyHost). A git repo is its scheme, host, port (the default dropped) and path as written, with ".." resolved and a trailing
 * ".git" removed; only the host is lowercased, and on github.com the owner and the name too (GitHub is not case-sensitive, other hosts are). Uploaded files are the site (or the folder or file before it exists) and the fingerprint of
 * the files: replace them and it is another source. Null when no source can be named (it holds).
 */
/** A git source: where it is, which branch and which folder of it (the branch and the folder are part of what the code is). */
const gitKey = (url: string, s: SiteSource): string =>
  `git:${JSON.stringify([url, (s.branch ?? "").trim(), (s.root ?? "").trim()])}`;

export function sourceKey(s: SiteSource | null | undefined, siteId?: string): string | null {
  if (!s) return null;
  if (typeof s.repo === "string" && s.repo.trim() !== "") {
    const raw = s.repo.trim();
    const gh = /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(
      raw,
    );
    if (gh) {
      const [o, n] = [(gh[1] as string).toLowerCase(), (gh[2] as string).toLowerCase()];
      if (/^\.+$/.test(o) || /^\.+$/.test(n)) return null;
      return gitKey(`https://github.com/${o}/${n}`, s);
    }
    if (!/^https:\/\//i.test(raw)) return null;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }
    if (u.username !== "" || u.password !== "" || u.search !== "" || u.hash !== "") return null;
    const path = u.pathname.replace(/\/+$/, "").replace(/\.git$/i, "");
    if (path === "" || path === "/") return null;
    if (path.split("/").some((x) => /^\.+$/.test(x) && x !== "")) return null;
    return gitKey(`https://${u.hostname.toLowerCase()}${u.port ? `:${u.port}` : ""}${path}`, s);
  }
  const id = siteId ?? s.folderId ?? s.fileId;
  if ((s.folderId || s.fileId) && id && /^[A-Za-z0-9_]+$/.test(id) && s.fp)
    return `upload:${JSON.stringify([id, s.fp, (s.root ?? "").trim()])}`;
  if (s.path && siteId && /^[A-Za-z0-9_]+$/.test(siteId)) return `path:${siteId}`;
  return null;
}

/** The name the approved-key store keeps for a source: the SHA-256 of its canonical string in two labels under .invalid (the name never resolves, and two sources never share one). */
export async function sourceKeyHost(key: string): Promise<string> {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  const hex = Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 32)}.${hex.slice(32)}.src.invalid`;
}

/** Folders that are never part of a deploy (the fetcher skips them, so the fingerprint does too). */
export const SKIP_DIRS: readonly string[] = [".git", "node_modules", ".next", ".venv", "venv", "__pycache__"];
/** The most files and folders a fingerprint reads, and how deep it goes; a folder past either cannot be fingerprinted, which holds (a deploy refuses more than 5000 files anyway). */
const FP_MAX = 20_000;
export const FP_DEPTH = 64;

/** One file as the fingerprint counts it: which file, which version and size, and where it sits and what it is called (renaming or moving a file is a change). */
export const fileLine = (id: string, version: number, size: number, where: string): string =>
  JSON.stringify(["f", id, version, size, where]);
/** One folder as the fingerprint counts it: its place in the tree. (JSON, so a newline or a colon in a name can never pass for another line.) */
export const folderLine = (id: string, where: string): string => JSON.stringify(["d", id, where]);
/** The fingerprint of a list of file and folder lines: their hash, in an order that does not depend on how the listing was paged. */
export async function fingerprintOf(lines: string[]): Promise<string> {
  const d = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode([...lines].sort().join("\n"))),
  );
  return Array.from(d, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/**
 * A fingerprint of the uploaded files a source names: every file's id, version, size, name and place in the folders, and every folder's place (a replaced, renamed or moved file is a change). Folders are read in pages up to FP_MAX
 * entries. Null when it cannot be read or is larger than that, which holds. `call` reads Files as the person the caller works for, in the Gate, and as the deploy's caller when a deploy is asked for.
 */
export async function uploadFingerprint(
  s: SiteSource,
  call: (cap: string, input: unknown) => Promise<unknown>,
): Promise<string | null> {
  const lines: string[] = [];
  try {
    if (s.fileId) {
      const f = (
        (await call("files.get", { fileId: s.fileId })) as {
          file?: { fileId?: string; name?: string; version?: number; size?: number };
        } | null
      )?.file;
      if (!f || typeof f.version !== "number") return null;
      lines.push(fileLine(s.fileId, f.version, f.size ?? 0, f.name ?? ""));
    } else if (s.folderId) {
      const walk = async (folder: string, where: string, depth: number): Promise<boolean> => {
        // the same depth the fetcher reads to: deeper cannot be fingerprinted, so it cannot be built
        if (depth > FP_DEPTH) return false;
        let cursor: string | undefined;
        do {
          const page = (await call("files.list", { folder, limit: 500, ...(cursor ? { cursor } : {}) })) as {
            files?: { fileId: string; name?: string; version?: number; size?: number }[];
            folders?: { folderId: string; name?: string }[];
            next?: string;
          } | null;
          if (!page || !Array.isArray(page.files)) return false;
          for (const f of page.files) {
            if (typeof f.version !== "number") return false;
            lines.push(fileLine(f.fileId, f.version, f.size ?? 0, `${where}${f.name ?? ""}`));
          }
          if (lines.length > FP_MAX) return false;
          for (const sub of page.folders ?? []) {
            if (SKIP_DIRS.includes(sub.name ?? "")) continue;
            const at = `${where}${sub.name ?? ""}/`;
            lines.push(folderLine(sub.folderId, at));
            if (!(await walk(sub.folderId, at, depth + 1))) return false;
          }
          cursor = page.next;
        } while (cursor);
        return true;
      };
      if (!(await walk(s.folderId, "", 0))) return null;
    } else return null;
  } catch {
    return null;
  }
  return fingerprintOf(lines);
}

/**
 * The fingerprint the Gate read for a call, kept for the handler that runs the same call (in this process), so the build checks the files it fetches against the files the Gate judged, not a later look. Keyed by the trace and the site: the Gate
 * sees the caller's span and the handler its own new one, so the span is no common key, and the trace is. Notes of one trace and site are taken in the order they were made (a nested deploy of the same site is the next note, never an overwrite).
 * A short-lived note: taken once (and remembered as used, for recording what a yes approved), gone after ten minutes. A call the Gate did not read (a person's) has none.
 */
type CallId = { traceId: string; spanId?: string } | undefined;
type Note = { fp: string; at: number; used: boolean };
const gateFps = new Map<string, Note[]>();
const GATE_FP_TTL_MS = 10 * 60 * 1000;
const callKey = (call: CallId, siteId: string): string | null => (call?.traceId ? `${call.traceId}:${siteId}` : null);
const live = (n: Note, now: number): boolean => now - n.at <= GATE_FP_TTL_MS;
export function noteGateFp(call: CallId, siteId: string, fp: string, now: number = Date.now()): void {
  const k = callKey(call, siteId);
  if (!k) return;
  for (const [key, list] of gateFps) {
    const keep = list.filter((n) => live(n, now));
    if (keep.length === 0 || gateFps.size > 1000) gateFps.delete(key);
    else gateFps.set(key, keep);
  }
  const list = gateFps.get(k) ?? [];
  // the same files noted again before the first was taken are one note
  const last = list[list.length - 1];
  if (last && !last.used && last.fp === fp) last.at = now;
  else list.push({ fp, at: now, used: false });
  gateFps.set(k, list);
}
/** The fingerprint last noted for this call, without taking it. */
export function peekGateFp(call: CallId, siteId: string, now: number = Date.now()): string | null {
  const k = callKey(call, siteId);
  const list = (k ? gateFps.get(k) : undefined)?.filter((n) => live(n, now));
  return list && list.length > 0 ? list[list.length - 1]!.fp : null;
}
/** Take the oldest fingerprint noted for this trace and site that is not taken yet. */
export function takeGateFp(call: CallId, siteId: string, now: number = Date.now()): string | null {
  const k = callKey(call, siteId);
  const n = (k ? gateFps.get(k) : undefined)?.find((x) => !x.used && live(x, now));
  if (!n) return null;
  n.used = true;
  return n.fp;
}
/** What the build of this call was held to, after it took it: what a yes approved. */
export function usedGateFp(call: CallId, siteId: string, now: number = Date.now()): string | null {
  const k = callKey(call, siteId);
  const used = (k ? gateFps.get(k) : undefined)?.filter((x) => x.used && live(x, now));
  return used && used.length > 0 ? used[used.length - 1]!.fp : null;
}

/** Calls a person approved (the Gate verified the token on the resume): the build of such a call may go on where an agent's own would refuse. Keyed like the fingerprint note. */
const approvedCalls = new Map<string, number>();
export function noteApproved(call: CallId, siteId: string, now: number = Date.now()): void {
  const k = callKey(call, siteId);
  if (!k) return;
  for (const [key, at] of approvedCalls) if (now - at > GATE_FP_TTL_MS) approvedCalls.delete(key);
  // a bounded map: past the cap the oldest go first
  while (approvedCalls.size >= 1000) approvedCalls.delete(approvedCalls.keys().next().value as string);
  approvedCalls.set(k, now);
}
export function wasApproved(call: CallId, siteId: string, now: number = Date.now()): boolean {
  const k = callKey(call, siteId);
  const at = k ? approvedCalls.get(k) : undefined;
  // a yes is for one build: it is spent when it is used
  if (k) approvedCalls.delete(k);
  return at !== undefined && now - at <= GATE_FP_TTL_MS;
}

/**
 * The fingerprint read when a hold was made, kept by the held call's own hash: the person's yes approves exactly those files. When the held call resumes, the Gate hands that fingerprint to the build, which refuses other files. Gone after a day.
 */
const heldFps = new Map<string, { fp: string; at: number }>();
const HELD_FP_TTL_MS = 24 * 60 * 60 * 1000;
export function holdGateFp(hash: string, fp: string, now: number = Date.now()): void {
  for (const [k, v] of heldFps) if (now - v.at > HELD_FP_TTL_MS) heldFps.delete(k);
  while (heldFps.size >= 1000) heldFps.delete(heldFps.keys().next().value as string);
  heldFps.set(hash, { fp, at: now });
}
export function heldGateFp(hash: string, now: number = Date.now()): string | null {
  const v = heldFps.get(hash);
  return v && now - v.at <= HELD_FP_TTL_MS ? v.fp : null;
}

/** What the Gate knows about a site the call names: where its code comes from now, its stored Vault env rows, where a preview of a branch was built from, and what the files were when it was last deployed. */
export interface SiteFacts {
  source: SiteSource | null;
  env: { name: string; handle: string; scope: string }[];
  builtFrom: SiteSource | null;
  /** The fingerprint of the uploaded files the live deploy was built from. */
  deployedFp?: string | null;
  /** What a person last found out about the production branch on the host (GitHub): protected, open or unknown, which branch and when (ms). */
  protection?: { state: string; branch?: string; at?: number } | null;
  /** The site has a webhook secret now (GitHub is using it). */
  hookLive?: boolean;
}

const envEntries = (input: unknown): { name: string; handle: string }[] => {
  const i = (input ?? {}) as Record<string, unknown>;
  const out: { name: string; handle: string }[] = [];
  for (const list of [i["entries"], i["env"]])
    if (Array.isArray(list))
      for (const e of list as { name?: unknown; vaultHandle?: unknown }[]) {
        if (typeof e?.vaultHandle === "string" && e.vaultHandle.trim() !== "")
          out.push({ name: typeof e.name === "string" ? e.name : "", handle: e.vaultHandle.trim() });
      }
  return out;
};

/** The source a call names, as given (a fingerprint is added by whoever can read the files). */
export function sourceOfInput(input: unknown): SiteSource | null {
  const src = ((input ?? {}) as Record<string, unknown>)["source"];
  if (src === null || typeof src !== "object") return null;
  const out: SiteSource = {};
  for (const k of ["repo", "folderId", "fileId", "path", "branch", "root"] as const) {
    const v = (src as Record<string, unknown>)[k];
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * The (Vault key, source) pairs a call to a site makes new: each is a key that will reach code from that source, and an agent's call waits for a person unless every one is already approved. One rule for every way a key and code meet:
 *   - a key added or changed in the call (sites_env_set, sites_ship env) reaches the code of the site's source, or of the source the call names;
 *   - a call that names another source than the site has (update, deploy, plan, ship) puts every key the site stores, and every key in the call, in front of that code;
 *   - uploaded files that are not the ones that were deployed (their fingerprint changed) are other code: the same;
 *   - promoting a preview built from somewhere else than the site's source puts the production keys in front of that code (a branch of the site's own repo is the same source).
 * The same source with the same keys is no pair: an agent's redeploy never waits. A null source is one this cannot name, which holds. `given` and the facts carry fingerprints where the caller could read the files.
 */
export function siteKeyPairs(
  input: unknown,
  facts: SiteFacts | null,
  given: SiteSource | null = sourceOfInput(input),
): { handle: string; source: string | null }[] {
  const i = (input ?? {}) as Record<string, unknown>;
  const siteId = typeof i["siteId"] === "string" ? i["siteId"] : undefined;
  const entries = envEntries(input);
  const pairs: { handle: string; source: string | null }[] = [];
  const add = (handle: string, source: string | null): void => {
    if (!pairs.some((p) => p.handle === handle && p.source === source)) pairs.push({ handle, source });
  };
  if (siteId === undefined) {
    for (const e of entries) add(e.handle, sourceKey(given, undefined));
    return pairs;
  }
  // the site's facts could not be read: with a source named, keys given or a preview promoted, nothing can be judged, which holds
  if (facts === null) {
    if (given || entries.length > 0 || typeof i["branch"] === "string") add("?", null);
    return pairs;
  }
  const storedKey = sourceKey(facts?.source ?? null, siteId);
  const stored = (facts?.env ?? []).filter((e) => e.handle !== "");
  const target = given ?? facts?.source ?? null;
  const toward = sourceKey(target, siteId);
  for (const e of entries) if (!stored.some((s) => s.name === e.name && s.handle === e.handle)) add(e.handle, toward);
  // what the keys were last approved to reach: the site's source, and for uploaded files the files as they were when last deployed (a deploy records them; none recorded is a baseline no call matches)
  const uploaded = !!(facts.source && (facts.source.folderId || facts.source.fileId) && !facts.source.repo);
  const baseline = uploaded
    ? facts.deployedFp
      ? sourceKey({ ...facts.source, fp: facts.deployedFp }, siteId)
      : null
    : storedKey;
  if (target && (stored.length > 0 || entries.length > 0)) {
    // a source that cannot be named (uploaded files whose fingerprint could not be read are one) is never "the same" as another: it holds
    if (toward === null) {
      if (given || uploaded) add("?", null);
    } else if (toward !== baseline) {
      for (const s of stored) add(s.handle, toward);
      for (const e of entries) add(e.handle, toward);
    }
  }
  const promote =
    typeof i["branch"] === "string" &&
    !Array.isArray(i["entries"]) &&
    !Array.isArray(i["env"]) &&
    i["source"] === undefined;
  if (promote) {
    const prod = stored.filter((s) => s.scope !== "previews");
    // a build from before the origin was recorded is not known to be the site's own: it holds
    if (!facts.builtFrom) {
      if (prod.length > 0) add("?", null);
    } else {
      const builtKey = sourceKey(facts.builtFrom, siteId);
      if (builtKey === null || builtKey !== storedKey) for (const s of prod) add(s.handle, builtKey);
      else if (storedKey === null && prod.length > 0) add("?", null);
    }
  }
  return pairs;
}

/**
 * A deploy to production by anything but a person, on a site whose production env holds Vault keys and whose code is a git repo: anyone who can push to that branch can use the keys, so the deploy waits for a person unless the branch is protected on the host
 * (required reviews or restricted pushes, and enforced on admins too), as the site last found out. That is only the Gate's pre-filter: every such deploy looks again, fresh, when it runs, and a look that fails or finds it open refuses
 * the build unless a person approved it (modules/sites/handlers/release.ts). A branch that is open, unknown, never looked at, or another than the one that was looked at holds.
 */
export function protectionHolds(facts: SiteFacts | null): boolean {
  if (facts === null) return true;
  const keyed = facts.env.some((e) => e.handle !== "" && e.scope !== "previews");
  if (!keyed || !facts.source?.repo) return false;
  const p = facts.protection;
  if (!p || p.state !== "protected") return true;
  return !!facts.source.branch && p.branch !== facts.source.branch;
}

/**
 * Does a call change what reaches production on a site that stores Vault keys: turning a webhook on or changing which branches it builds, turning deploy on push on, or writing the site's settings. An agent's such call waits for a person;
 * the keys' own approval is by source (siteKeyPairs), but a change in what gets built for production is no pair. Facts that could not be read hold.
 */
export function exposesKeys(input: unknown, facts: SiteFacts | null): boolean {
  const i = (input ?? {}) as Record<string, unknown>;
  const changes =
    Array.isArray(i["follow"]) ||
    i["enabled"] === true ||
    i["autoDeploy"] === true ||
    (i["settings"] !== undefined && i["settings"] !== null);
  if (!changes || typeof i["siteId"] !== "string") return false;
  if (facts === null) return true;
  return facts.env.some((e) => e.handle !== "" && e.scope !== "previews");
}

/**
 * Rotating the webhook secret (or switching it on again) while one is live breaks the webhook GitHub is using until someone gives GitHub the new one: an agent's such call waits for a person. With no secret yet it changes nothing that works, so it is free.
 */
export function rotatesLiveSecret(input: unknown, facts: SiteFacts | null): boolean {
  const i = (input ?? {}) as Record<string, unknown>;
  if (typeof i["siteId"] !== "string" || !(i["rotate"] === true || i["enabled"] === true)) return false;
  return facts === null ? true : facts.hookLive === true;
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
  "sites.preview_promote",
  "sites.webhook_set",
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
