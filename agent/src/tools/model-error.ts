// What a model reads when a tool fails (owner, 4 Nov 2026): a code and a plain sentence, never a trace id or an internal id. Dex pasted "(trace 14d3abcd...)" into a chat because the id was in the
// error it was given; the person did not ask for it. The full error, with its trace, still travels beside the result (ToolOutcome.error and traceId) for the turn's Details, where a person can copy it.
// 13 Nov 2026 (owner): an agent repeats what a failed call hands it, and printed `permission.above_clearance` and `validation.precondition_failed` in its replies. So the error now LEADS with `say`, the plain sentence
// and what the person can do, then `reply`, the instruction on how to report it; the code is kept as `supportCode`, marked as a reference for support and never for showing.
import { peopleWords } from "../../../lib/probe.ts";
import { describeError, plainSentence } from "../../../lib/words/errors.ts";
import type { VyreError } from "../../../packages/contracts/src/types.ts";

// A prefixed id has a digit in its tail (usr_5cf430c0..., agt_01a1a388...); a reason word such as agent_settings or server_error does not, and must reach the model.
const ID_SRC = String.raw`\b(?:[a-z]{2,6}_(?=[a-z0-9]*[0-9])[a-z0-9]{8,}|[0-9a-f]{16,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b`;
const ID = new RegExp(ID_SRC, "gi");
const IS_ID = new RegExp(ID_SRC, "i");

/** The words of a message with every id and trace taken out. */
export const withoutIds = (s: string): string =>
  peopleWords(s.replace(ID, "that item"))
    .replace(/\s{2,}/g, " ")
    .trim();

/** The standing instruction that travels with every failure a model reads: say it in plain words, never the code. */
export const REPLY_RULE =
  "Tell the person what happened and what they can do next, in plain words like the line above. Do not show codes, tool names or ids unless they ask.";

/** Words for the codes where the agent itself, not the person, is the one refused: "you" in the person's table would read as the person's own role. */
const AGENT_WORDS: Readonly<Record<string, { what: string; next: string }>> = {
  "permission.role_lacks_permission": {
    what: "I am not allowed to do that here.",
    next: "An admin can allow it for me. Say what is needed and stop; do not look for another way.",
  },
  "permission.above_clearance": {
    what: "That is restricted beyond what I am cleared to open.",
    next: "Only an admin can change what I may open. Say so and stop; do not look for another way.",
  },
  "permission.no_grant": {
    what: "I do not have access to that.",
    next: "Offer to ask for access if there is an Ask for access step; otherwise say who can share it.",
  },
  "validation.bad_input": {
    what: "That request was not right.",
    next: "Check it against the tool's description and try once more; if it fails again, say what you need.",
  },
  "validation.precondition_failed": {
    what: "That cannot be done in the current state.",
    next: "Check where things stand before you try again.",
  },
  "validation.not_found": {
    what: "I could not find that. It may have been removed.",
    next: "Look it up again, or ask the person which one they mean.",
  },
  "validation.too_large": { what: "That is too big.", next: "Use less text or a smaller file, or split it." },
  "internal.unexpected": {
    what: "Something went wrong on Vyre's side.",
    next: "Tell the person. Try once more only if the error says it can be retried.",
  },
};

/** The error as a model may read it: first the plain sentence and what to do (`say`), the rule for reporting it (`reply`), the scrubbed message, whether to retry, the labels of what to do next, and last the code as a reference for support. */
export function modelError(error: VyreError): {
  say: string;
  reply: string;
  message: string;
  retryable?: boolean;
  next?: Array<{ label: string }>;
  details?: { reason?: string; tool?: string };
  supportCode: string;
} {
  const next = (error.next ?? [])
    .map((n) => ({ label: withoutIds(String((n as { label?: unknown }).label ?? "")) }))
    .filter((n) => n.label !== "");
  const d = error.details as { reason?: unknown; tool?: unknown } | undefined;
  const reason = typeof d?.reason === "string" && !IS_ID.test(d.reason) ? d.reason : undefined;
  const tool = typeof d?.tool === "string" && /^[a-z][a-z0-9_]*$/.test(d.tool) ? d.tool : undefined;
  const message = withoutIds(error.message ?? "");
  const words = describeError(error.code, { message });
  const own = AGENT_WORDS[error.code];
  // a plain message the server raised for this very failure wins over the table; the table's next step follows it
  const said = own && words.text === describeError(error.code).text ? own.what : words.text;
  const say = `${plainSentence(said)} ${own ? own.next : words.next}`;
  return {
    say,
    reply: REPLY_RULE,
    message,
    ...(reason || tool ? { details: { ...(reason ? { reason } : {}), ...(tool ? { tool } : {}) } } : {}),
    ...(error.retryable === true ? { retryable: true } : {}),
    ...(next.length ? { next } : {}),
    supportCode: error.code,
  };
}

/** A tool result's content with its error (if it has one) made safe for a model. */
export function safeContent(content: unknown): unknown {
  if (content === null || typeof content !== "object") return content;
  const o = content as { error?: VyreError };
  return o.error && typeof o.error === "object" && typeof o.error.code === "string"
    ? { ...o, error: modelError(o.error) }
    : content;
}
