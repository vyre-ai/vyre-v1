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
  // raised when the agent alone lacks the permission (it holds only a Member's: the rc.26 dead end), when the person alone does, or both: one sentence true in each case, with the one thing that can be done
  "permission.role_lacks_permission": {
    what: "That is not allowed for me here, or for the person I work for.",
    next: "An admin decides who may do it, and can allow it for me when only I am short of it. Tell the person what is missing and to ask an admin by name, then stop; do not look for another way.",
  },
  // raised by the access check when the label is above the clearance of the agent, of the person it acts for, or of both (clearance is per subject): one sentence true in each case
  "permission.above_clearance": {
    what: "That is labelled above what I am cleared to open here.",
    next: "An admin decides who may open it. Tell the person it is restricted, do not ask for access for me, and stop.",
  },
  "permission.no_grant": {
    what: "I do not have access to that.",
    next: "Offer to ask for access if there is an Ask for access step; otherwise say who can share it.",
  },
  "permission.not_found": {
    what: "I could not find that, or it is not open to me.",
    next: "Ask the person which one they mean, or who can share it.",
  },
  "permission.expired": { what: "That access has run out.", next: "Say so; the person can ask for it again." },
  "permission.revoked": {
    what: "That access was taken away.",
    next: "Say so and stop; the person can ask for it again.",
  },
  "permission.on_hold": { what: "A hold stops this change.", next: "Say so; an admin can lift the hold." },
  "validation.bad_input": {
    what: "That request was not right.",
    next: "Check it against the tool's description and try once more; if it fails again, say what you need.",
  },
  "validation.precondition_failed": {
    what: "That cannot be done in the current state.",
    next: "Check where things stand before you try again.",
  },
  // 14 Nov 2026 (F50): a write refused because the thing changed after the agent last read it. The agent is told what to do, never to write the old content back; who changed it is said only where the server's own
  // sentence says it (a person may be told who edited a task; the agent is handed only what the server chose to put in the message).
  "validation.version_conflict": {
    what: "That changed after you last read it, so your change was not saved.",
    next: "Read it again, look at what changed, and make your change on top of what is there now. Do not write the old content back, and do not retry the same call as it was.",
  },
  "validation.precondition_failed#stale_version": {
    what: "That changed after you last read it, so your change was not saved.",
    next: "Read it again, look at what changed, and make your change on top of what is there now. Do not retry the same call as it was.",
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
  const own = (reason ? AGENT_WORDS[`${error.code}#${reason}`] : undefined) ?? AGENT_WORDS[error.code];
  // a plain message the server raised for this very failure wins over the table; the table's next step follows it
  // a version conflict's own words always stand in for the server's (a record's says "at version 3, not 1"), except the tool layer's own refusal, which says when the thing changed
  const ownWords =
    own !== undefined &&
    (words.text === describeError(error.code).text ||
      (error.code === "validation.version_conflict" && reason !== "changed_since_turn"));
  const said = ownWords ? own.what : words.text;
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
