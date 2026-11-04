// What a model reads when a tool fails (owner, 4 Nov 2026): a code and a plain sentence, never a trace id or an internal id. Dex pasted "(trace 14d3abcd...)" into a chat because the id was in the
// error it was given; the person did not ask for it. The full error, with its trace, still travels beside the result (ToolOutcome.error and traceId) for the turn's Details, where a person can copy it.
import type { VyreError } from "../../../packages/contracts/src/types.ts";

// A prefixed id has a digit in its tail (usr_5cf430c0..., agt_01a1a388...); a reason word such as agent_settings or server_error does not, and must reach the model.
const ID_SRC = String.raw`\b(?:[a-z]{2,6}_(?=[a-z0-9]*[0-9])[a-z0-9]{8,}|[0-9a-f]{16,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b`;
const ID = new RegExp(ID_SRC, "gi");
const IS_ID = new RegExp(ID_SRC, "i");

/** The words of a message with every id and trace taken out. */
export const withoutIds = (s: string): string => s.replace(ID, "that item").replace(/\s{2,}/g, " ").trim();

/** The error as a model may read it: code, a scrubbed message, whether to retry, and the labels of what to do next. */
export function modelError(error: VyreError): { code: string; message: string; retryable?: boolean; next?: Array<{ label: string }>; details?: { reason?: string; tool?: string } } {
  const next = (error.next ?? []).map((n) => ({ label: withoutIds(String((n as { label?: unknown }).label ?? "")) })).filter((n) => n.label !== "");
  const d = error.details as { reason?: unknown; tool?: unknown } | undefined;
  const reason = typeof d?.reason === "string" && !IS_ID.test(d.reason) ? d.reason : undefined;
  const tool = typeof d?.tool === "string" && /^[a-z][a-z0-9_]*$/.test(d.tool) ? d.tool : undefined;
  return {
    code: error.code, message: withoutIds(error.message ?? ""),
    ...(reason || tool ? { details: { ...(reason ? { reason } : {}), ...(tool ? { tool } : {}) } } : {}),
    ...(error.retryable === true ? { retryable: true } : {}),
    ...(next.length ? { next } : {}),
  };
}

/** A tool result's content with its error (if it has one) made safe for a model. */
export function safeContent(content: unknown): unknown {
  if (content === null || typeof content !== "object") return content;
  const o = content as { error?: VyreError };
  return o.error && typeof o.error === "object" && typeof o.error.code === "string" ? { ...o, error: modelError(o.error) } : content;
}
