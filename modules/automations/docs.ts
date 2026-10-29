// Official documents come from a fixed directory host, or from one pinned map in tests.
// A URL the person typed is never a fetch target.
// Specs are several megabytes, so the timeout is 20 seconds and the body cap is 12 MB.

export const KNOWN_DOCS: Readonly<Record<string, string>> = {
  stripe: "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
};

export const DIRECTORY_URL = "https://api.apis.guru/v2/list.json";
export const DIRECTORY_HOST = "api.apis.guru";

export const DOC_CAP = 12_000_000;

const TIMEOUT_MS = 20_000;
const STOP = new Set(["the", "and", "for", "with", "from", "this", "that", "your", "into", "what", "want", "step", "app", "use", "using"]);
const METHODS = ["get", "head", "options", "post", "put", "patch", "delete", "trace"] as const;
const READS = new Set(["get", "head", "options"]);
const SECRET_NAME = /secret|authorization|token|api[-_]?key|password/i;

const UNKNOWN = "That app is not on the official list. Paste the OpenAPI document you already have. A web address is not opened.";
const REDIRECT = "The official document redirected. A web address is not opened.";
const TOO_LARGE = "The official document is too large to draft. Paste the OpenAPI document you already have.";
const NOT_JSON = "The official document was not JSON.";
const UNREACHABLE = "The official document did not load. Paste the OpenAPI document you already have.";
export const NO_MATCH = "That official document has no matching path. Paste the OpenAPI document you already have.";

export type Loaded =
  | { ok: true; document: unknown; docsUrl: string }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hostOf(raw: string): string | null {
  try { return new URL(raw).hostname.toLowerCase(); } catch { return null; }
}

function tokensOf(intent: string): string[] {
  const found = intent.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  const out: string[] = [];
  for (const word of found) {
    if (STOP.has(word) || out.includes(word)) continue;
    out.push(word);
  }
  return out;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function matches(path: string, operation: unknown, tokens: readonly string[]): boolean {
  const record = isRecord(operation) ? operation : {};
  const hay = `${path} ${textOf(record.operationId)} ${textOf(record.summary)}`.toLowerCase();
  return tokens.some((token) => hay.includes(token));
}

/** Load the allowlisted document for an app name. sources defaults to the official list. */
export async function loadKnownDocument(app: string, fetchImpl: typeof fetch, sources: Readonly<Record<string, string>> = KNOWN_DOCS): Promise<Loaded> {
  const key = app.trim().toLowerCase();
  const docsUrl = sources[key];
  if (!docsUrl) return { ok: false, reason: UNKNOWN };
  let response: Response;
  try {
    response = await fetchImpl(docsUrl, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { ok: false, reason: UNREACHABLE };
  }
  if (response.status >= 300 && response.status < 400) return { ok: false, reason: REDIRECT };
  const finalHost = response.url ? hostOf(response.url) : null;
  if (finalHost && finalHost !== hostOf(docsUrl)) return { ok: false, reason: REDIRECT };
  if (response.status < 200 || response.status >= 300) return { ok: false, reason: UNREACHABLE };
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > DOC_CAP) return { ok: false, reason: TOO_LARGE };
  let text = "";
  try { text = await response.text(); } catch { return { ok: false, reason: UNREACHABLE }; }
  if (text.length > DOC_CAP) return { ok: false, reason: TOO_LARGE };
  const trimmed = text.trim();
  if (trimmed.startsWith("<")) return { ok: false, reason: NOT_JSON };
  try {
    const document = JSON.parse(trimmed) as unknown;
    if (!isRecord(document)) return { ok: false, reason: NOT_JSON };
    return { ok: true, document, docsUrl };
  } catch {
    return { ok: false, reason: NOT_JSON };
  }
}

/** Keep only paths that match the intent. No path is invented. */
export function narrowDocument(doc: unknown, intent: string): unknown {
  if (!isRecord(doc)) return {};
  const tokens = tokensOf(intent);
  const paths: Record<string, Record<string, unknown>> = {};
  const picked: { path: string; method: string; operation: unknown; read: boolean }[] = [];
  const source = isRecord(doc.paths) ? doc.paths : {};
  for (const [path, item] of Object.entries(source)) {
    if (!isRecord(item)) continue;
    for (const method of METHODS) {
      const operation = item[method];
      if (operation == null) continue;
      const read = READS.has(method);
      if (tokens.length === 0) {
        if (read) picked.push({ path, method, operation, read });
        continue;
      }
      if (matches(path, operation, tokens)) picked.push({ path, method, operation, read });
    }
  }
  picked.sort((a, b) => Number(b.read) - Number(a.read));
  const cap = tokens.length === 0 ? 12 : 24;
  for (const row of picked.slice(0, cap)) {
    const item = paths[row.path] ?? {};
    item[row.method] = row.operation;
    paths[row.path] = item;
  }
  const webhooks: Record<string, unknown> = {};
  const hooks = isRecord(doc.webhooks) ? doc.webhooks : {};
  const names = Object.keys(hooks).filter((name) => !SECRET_NAME.test(name) && (tokens.length === 0 || tokens.some((token) => name.toLowerCase().includes(token))));
  for (const name of names.slice(0, tokens.length === 0 ? 8 : names.length)) webhooks[name] = hooks[name];
  const components = isRecord(doc.components)
    ? {
        ...(isRecord(doc.components.securitySchemes) ? { securitySchemes: doc.components.securitySchemes } : {}),
        ...(isRecord(doc.components.schemas) ? { schemas: doc.components.schemas } : {}),
      }
    : undefined;
  return {
    ...(doc.openapi !== undefined ? { openapi: doc.openapi } : {}),
    ...(doc.info !== undefined ? { info: doc.info } : {}),
    ...(doc.servers !== undefined ? { servers: doc.servers } : {}),
    ...(components && Object.keys(components).length > 0 ? { components } : {}),
    paths,
    ...(Object.keys(webhooks).length > 0 ? { webhooks } : {}),
  };
}

function hasDraft(doc: unknown): boolean {
  if (!isRecord(doc)) return false;
  if (isRecord(doc.paths) && Object.keys(doc.paths).length > 0) return true;
  return isRecord(doc.webhooks) && Object.keys(doc.webhooks).length > 0;
}

const SUFFIXES = [".com", ".io", ".us", ".net", ".org", ".app", ".ai", ".dev"];
const INDEX_TTL_MS = 10 * 60 * 1000;

let directoryCache: { at: number; index: Record<string, string> } | null = null;

export function clearDirectoryCache(): void {
  directoryCache = null;
}

function onDirectory(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === DIRECTORY_HOST;
  } catch {
    return false;
  }
}

/** Pick one provider key. A name inside another provider does not match. */
export function specUrlFor(app: string, index: Readonly<Record<string, string>>): string | null {
  const name = app.trim().toLowerCase();
  if (!/^[a-z0-9]{2,40}$/.test(name)) return null;
  const keys = [name, ...SUFFIXES.map((suffix) => name + suffix)];
  for (const key of keys) {
    const url = index[key];
    if (url && onDirectory(url)) return url;
  }
  return null;
}

export function indexFrom(doc: unknown): Record<string, string> {
  const index: Record<string, string> = {};
  if (!isRecord(doc)) return index;
  for (const [key, hit] of Object.entries(doc)) {
    if (!isRecord(hit)) continue;
    const preferred = textOf(hit.preferred);
    const versions = isRecord(hit.versions) ? hit.versions : {};
    const version = isRecord(versions[preferred]) ? versions[preferred] : null;
    const url = version ? textOf(version.swaggerUrl) : "";
    if (!url || !onDirectory(url)) continue;
    index[key.toLowerCase()] = url;
  }
  return index;
}

async function directoryIndex(fetchImpl: typeof fetch): Promise<Loaded & { index?: Record<string, string> }> {
  if (directoryCache && Date.now() - directoryCache.at < INDEX_TTL_MS) {
    return { ok: true, document: {}, docsUrl: DIRECTORY_URL, index: directoryCache.index };
  }
  const loaded = await loadKnownDocument("directory", fetchImpl, { directory: DIRECTORY_URL });
  if (!loaded.ok) return loaded;
  if (!onDirectory(loaded.docsUrl)) return { ok: false, reason: REDIRECT };
  const index = indexFrom(loaded.document);
  directoryCache = { at: Date.now(), index };
  return { ok: true, document: loaded.document, docsUrl: loaded.docsUrl, index };
}

async function loadFromDirectory(app: string, fetchImpl: typeof fetch): Promise<Loaded> {
  const found = await directoryIndex(fetchImpl);
  if (!found.ok) return found;
  const docsUrl = specUrlFor(app, found.index ?? {});
  if (!docsUrl) return { ok: false, reason: UNKNOWN };
  return loadKnownDocument(app, fetchImpl, { [app.trim().toLowerCase()]: docsUrl });
}

/** Fetch and narrow. The returned document is what generate() should see. */
export async function draftKnown(app: string, intent: string, fetchImpl: typeof fetch, sources?: Readonly<Record<string, string>>): Promise<Loaded> {
  const loaded = sources ? await loadKnownDocument(app, fetchImpl, sources) : await loadFromDirectory(app, fetchImpl);
  if (!loaded.ok) return loaded;
  const document = narrowDocument(loaded.document, intent);
  if (!hasDraft(document)) return { ok: false, reason: NO_MATCH };
  return { ok: true, document, docsUrl: loaded.docsUrl };
}
