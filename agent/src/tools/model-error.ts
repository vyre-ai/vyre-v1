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

/**
 * The few things an agent cannot do for a person even though it made or was asked to make them (owner rule, 14 Nov 2026: an agent is never left unable to use what it made; these are the real exceptions, where
 * the thing is not the agent's to make at all). The refusal says the true reason and the one next step, in a line, instead of the general "ask for access", which would send the model round a loop that cannot end.
 * Keyed by the capability the refusal came from.
 */
const CAP_WORDS: Readonly<Record<string, { what: string; next: string }>> = {
  "skills.add": {
    what: "A skill for the whole Space is added by an admin.",
    next: "For a skill that is only the person's, use the tool for their own skills instead.",
  },
  "connectors.init": {
    what: "Building a connector is something an admin has to let an agent do.",
    next: "Tell the person, say an admin can allow it for me, and stop.",
  },
  "connectors.define": {
    what: "Building a connector is something an admin has to let an agent do.",
    next: "Tell the person, say an admin can allow it for me, and stop.",
  },
};

/** Refusals that carry their own reason word (details.reason): the sentence is that reason, not the general one for the code. */
const REASON_WORDS: Readonly<Record<string, { what: string; next: string }>> = {
  // an agent asking for a computer: the answer is that it has others, so the line leads with that and not with "ask for access"
  no_new_desktop: {
    what: "Agents no longer get a new desktop computer.",
    next: "Use the terminal in your own workspace (terminal_run, terminal_open) and the Space browser (chrome_open, chrome_snapshot, chrome_act) instead, and the person's own Chrome only if they ask for it.",
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
  const d = error.details as { reason?: unknown; tool?: unknown; cap?: unknown } | undefined;
  const cap =
    error.code.startsWith("permission.") && typeof d?.cap === "string"
      ? CAP_WORDS[d.cap]
      : typeof d?.reason === "string" && error.code.startsWith("permission.")
        ? REASON_WORDS[d.reason]
        : undefined;
  const reason = typeof d?.reason === "string" && !IS_ID.test(d.reason) ? d.reason : undefined;
  const tool = typeof d?.tool === "string" && /^[a-z][a-z0-9_]*$/.test(d.tool) ? d.tool : undefined;
  const message = withoutIds(error.message ?? "");
  const words = describeError(error.code, { message });
  const own = cap ?? AGENT_WORDS[error.code];
  // a plain message the server raised for this very failure wins over the table; the table's next step follows it
  const said = own && (cap || words.text === describeError(error.code).text) ? own.what : words.text;
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
