// Whether Ask may try a read. Catalog reads use steps.test. A connector read is a dry-run preview.
// An outward call is not given a capability. Secret fields never enter the call.

import { scrubAskContext } from "./bundle.ts";

export interface ReadRequest {
  stepKey: string | null;
  effect?: "read" | "outward" | null;
  connectionId?: string | null;
  connector?: string | null;
  action?: string | null;
  input?: Record<string, unknown>;
}

export type ReadOffer =
  | { kind: "catalog"; cap: "steps.test"; input: { key: string; input: Record<string, unknown> }; say: string }
  | { kind: "preview"; cap: "connectors.run"; input: { key: string; action: string; connectionId: string; input: Record<string, unknown>; dryRun: true }; say: string }
  | { kind: "hold"; say: string };

const HOLD = "An outward call waits until you run it.";
const NEED = "A read needs the saved connection.";
const NOT_READ = "This step is not a read.";
const TRY = "Trying this read with the saved connection.";
const PREVIEW = "A read can be tried with the saved connection. This preview is not sent.";

const SECRET_KEY = /secret|authorization|cookie|password|token|api[-_]?key|credential/i;
const BEARER = /bearer\s+[a-z0-9._~+/-]{8,}/i;
const KEY_LITERAL = /\b(?:sk|pk|rk|ghp|xox[baprs])-[a-z0-9_-]{8,}\b/i;
const JWT = /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/;
const OUTWARD = /(?:^|\.)(?:send_|create_|append_|update_|delete_|add_)|comment|assign/;
const READ = /(?:^|\.)(?:list_|get_|find_)|read_all$|^records\.find$/;

function text(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function catalogKind(key: string): "read" | "outward" | "other" {
  if (OUTWARD.test(key)) return "outward";
  if (READ.test(key)) return "read";
  return "other";
}

function secretString(value: string): boolean {
  return BEARER.test(value) || KEY_LITERAL.test(value) || JWT.test(value);
}

function cleanInput(input: Record<string, unknown> | undefined, connectionId: string): Record<string, unknown> {
  const out: Record<string, unknown> = { connectionId };
  for (const [key, value] of Object.entries(input ?? {})) {
    if (key === "connectionId" || SECRET_KEY.test(key)) continue;
    if (typeof value === "string" && secretString(value)) continue;
    out[key] = value;
  }
  return out;
}

export function readOffer(req: ReadRequest): ReadOffer {
  const stepKey = text(req.stepKey);
  const connectionId = text(req.connectionId);
  const connector = text(req.connector);
  const action = text(req.action);
  if (stepKey === "connector_request" || req.effect === "read" || req.effect === "outward") {
    if (req.effect !== "read") return { kind: "hold", say: HOLD };
    if (!connectionId) return { kind: "hold", say: NEED };
    if (!connector || !action) return { kind: "hold", say: NOT_READ };
    return {
      kind: "preview",
      cap: "connectors.run",
      input: { key: connector, action, connectionId, input: cleanInput(req.input, connectionId), dryRun: true },
      say: PREVIEW,
    };
  }
  if (!stepKey) return { kind: "hold", say: NOT_READ };
  const kind = catalogKind(stepKey);
  if (kind === "outward") return { kind: "hold", say: HOLD };
  if (kind !== "read") return { kind: "hold", say: NOT_READ };
  if (!connectionId) return { kind: "hold", say: NEED };
  return { kind: "catalog", cap: "steps.test", input: { key: stepKey, input: cleanInput(req.input, connectionId) }, say: TRY };
}

/** One line for the Ask tab. Secret shapes are removed. */
export function publicResult(out: unknown): string {
  let text = "";
  try { text = JSON.stringify(out) ?? ""; } catch { text = ""; }
  if (text.length > 800) text = text.slice(0, 800);
  const safe = (scrubAskContext({ message: text }).message ?? "").replaceAll("undefined", "").trim();
  if (!safe) return "The read finished. No details were kept.";
  return safe.length > 400 ? safe.slice(0, 400) : safe;
}
