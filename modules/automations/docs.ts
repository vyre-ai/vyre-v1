// One allowlisted official document. A URL the person typed is never a fetch target.
// Official specs are several megabytes, so the timeout is 20 seconds and the body cap is 12 MB.

export const KNOWN_DOCS: Readonly<Record<string, string>> = {
  stripe: "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
};

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

/** Fetch and narrow. The returned document is what generate() should see. */
export async function draftKnown(app: string, intent: string, fetchImpl: typeof fetch, sources?: Readonly<Record<string, string>>): Promise<Loaded> {
  const loaded = await loadKnownDocument(app, fetchImpl, sources);
  if (!loaded.ok) return loaded;
  const document = narrowDocument(loaded.document, intent);
  if (!hasDraft(document)) return { ok: false, reason: NO_MATCH };
  return { ok: true, document, docsUrl: loaded.docsUrl };
}
