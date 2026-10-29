// Ask Vyre sees a scrubbed bundle. Only these fields are copied. A name that looks like a secret is dropped.
// Bearer tokens, key literals, and JWTs inside a kept string are redacted. Patterns are duplicated because the app cannot import modules.
export interface AskField {
  name: string;
  type: string;
}

export interface AskBundle {
  resource?: string;
  errorCode?: string;
  message?: string;
  traceId?: string;
  definitionVersion?: number;
  nodeId?: string;
  stepKey?: string;
  attempt?: number;
  connectionId?: string;
  connectionState?: string;
  fields?: AskField[];
}

const BANNED = /secret|authorization|cookie|password|token|api[-_]?key|auth[-_]?header/i;
const BEARER = /bearer\s+[a-z0-9._~+/-]{8,}/gi;
const KEY_LITERAL = /\b(?:sk|pk|rk|ghp|xox[baprs])-[a-z0-9_-]{8,}\b/gi;
const JWT = /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g;

const ALLOWED = ["resource", "errorCode", "message", "traceId", "definitionVersion", "nodeId", "stepKey", "attempt", "connectionId", "connectionState"] as const;

function scrubString(value: string): string {
  return value.replace(BEARER, "Bearer [redacted]").replace(KEY_LITERAL, "[redacted]").replace(JWT, "[redacted]");
}

function safeString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  if (BANNED.test(v) && v.length > 80) return undefined;
  return scrubString(v);
}

export function scrubAskContext(input: Record<string, unknown>): AskBundle {
  const out: AskBundle = {};
  for (const key of ALLOWED) {
    if (!(key in input)) continue;
    if (BANNED.test(key)) continue;
    const value = input[key];
    if (key === "definitionVersion" || key === "attempt") {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
      continue;
    }
    const text = safeString(value);
    if (text !== undefined) out[key] = text;
  }
  const fields = input["fields"];
  if (Array.isArray(fields)) {
    const kept: AskField[] = [];
    for (const field of fields) {
      if (!field || typeof field !== "object") continue;
      const name = (field as { name?: unknown }).name;
      const type = (field as { type?: unknown }).type;
      if (typeof name !== "string" || BANNED.test(name)) continue;
      kept.push({ name: scrubString(name), type: typeof type === "string" && !BANNED.test(type) ? scrubString(type) : "unknown" });
    }
    if (kept.length > 0) out.fields = kept;
  }
  return out;
}

export function bundleMentionsBanned(bundle: AskBundle): boolean {
  return BANNED.test(JSON.stringify(bundle));
}
