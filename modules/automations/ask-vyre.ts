// Scrubbed context for Ask Vyre. The agent may explain a failure and propose a fix.
// Live publish, permission changes, and Gate decisions stay on their own confirmation path.
// Secrets, auth headers, cookies, and restricted values never enter the bundle.

export interface AskBundle {
  resource: "automation" | "run" | "connector" | "connection" | "schedule" | "migration";
  errorCode?: string;
  message?: string;
  traceId?: string;
  definitionVersion?: number;
  connectorKey?: string;
  connectorVersion?: string;
  connectionId?: string;
  connectionState?: string;
  nodeId?: string;
  stepKey?: string;
  attempt?: number;
  laneId?: string;
  iterationIndex?: number;
  fields?: { name: string; valueType: string; presence: string }[];
  docs?: string[];
}

const DROP_KEY = /(secret|password|authorization|cookie|set-cookie|token|api[-_]?key|credential|private[-_]?key)/i;
const BEARER = /bearer\s+[a-z0-9._~+/-]{8,}/gi;
const KEY_LITERAL = /\b(?:sk|pk|rk|ghp|xox[baprs])-[a-z0-9_-]{8,}\b/gi;
const JWT = /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g;

function scrubString(value: string): string {
  return value.replace(BEARER, "Bearer [redacted]").replace(KEY_LITERAL, "[redacted]").replace(JWT, "[redacted]");
}

/** Walk a diagnostic object. Drop secret-shaped keys. Scrub secret-shaped strings. Keep ids and codes. */
export function scrubDiagnostics(input: unknown): unknown {
  if (typeof input === "string") return scrubString(input);
  if (typeof input === "number" || typeof input === "boolean" || input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map((item) => scrubDiagnostics(item));
  if (typeof input !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (DROP_KEY.test(key)) continue;
    out[key] = scrubDiagnostics(value);
  }
  return out;
}

export function askBundle(raw: AskBundle & Record<string, unknown>): AskBundle {
  const clean = scrubDiagnostics(raw) as AskBundle;
  return {
    resource: clean.resource,
    ...(clean.errorCode ? { errorCode: clean.errorCode } : {}),
    ...(clean.message ? { message: clean.message } : {}),
    ...(clean.traceId ? { traceId: clean.traceId } : {}),
    ...(clean.definitionVersion !== undefined ? { definitionVersion: clean.definitionVersion } : {}),
    ...(clean.connectorKey ? { connectorKey: clean.connectorKey } : {}),
    ...(clean.connectorVersion ? { connectorVersion: clean.connectorVersion } : {}),
    ...(clean.connectionId ? { connectionId: clean.connectionId } : {}),
    ...(clean.connectionState ? { connectionState: clean.connectionState } : {}),
    ...(clean.nodeId ? { nodeId: clean.nodeId } : {}),
    ...(clean.stepKey ? { stepKey: clean.stepKey } : {}),
    ...(clean.attempt !== undefined ? { attempt: clean.attempt } : {}),
    ...(clean.laneId ? { laneId: clean.laneId } : {}),
    ...(clean.iterationIndex !== undefined ? { iterationIndex: clean.iterationIndex } : {}),
    ...(clean.fields ? { fields: clean.fields } : {}),
    ...(clean.docs ? { docs: clean.docs } : {}),
  };
}

export const ASK_VYRE_LIMIT =
  "Ask Vyre can explain this and propose a fix. Publishing, live reruns, permission changes, and Gate decisions still need their usual confirmation.";
