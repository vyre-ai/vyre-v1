// Ask Vyre sees a scrubbed bundle. Only these fields are copied. A name that looks like a secret is dropped.
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

const ALLOWED = ["resource", "errorCode", "message", "traceId", "definitionVersion", "nodeId", "stepKey", "attempt", "connectionId", "connectionState"] as const;

function safeString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  if (BANNED.test(v) && v.length > 80) return undefined;
  return v;
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
      kept.push({ name, type: typeof type === "string" && !BANNED.test(type) ? type : "unknown" });
    }
    if (kept.length > 0) out.fields = kept;
  }
  return out;
}

export function bundleMentionsBanned(bundle: AskBundle): boolean {
  return BANNED.test(JSON.stringify(bundle));
}
