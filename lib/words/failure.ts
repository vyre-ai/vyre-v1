// A failed turn in plain words, for every place that says why an agent did not answer: the chat's failure line (apps/app conversation/status.ts reads `what` from here) and a goal's check-in that did not run
// (modules/goals). One sentence per cause, so a chat turn and a goal's check-in say the same thing for the same cause. The code itself never goes into a sentence; callers keep it in the row's data for an admin.
//
// `cause` says who can fix it, which decides what a wake-up does next:
//   person     only the person can fix it (the Vault is locked, a sign-in is missing): wait, and go on when it clears
//   limit      the AI account is at its usage limit: wait for the reset time
//   transient  a passing trouble (the server restarted, the provider did not answer): try again, a few times, with a longer wait each time
//   other      anything Vyre has no words for: tried again like a passing trouble, then said plainly
export type Cause = "person" | "limit" | "transient" | "other";
export interface Why {
  cause: Cause;
  /** what happened, a sentence that starts with a capital and ends with a full stop */
  what: string;
  /** the one thing that fixes it, a sentence; empty when nothing the person does fixes it */
  fix: string;
}

const W = (cause: Cause, what: string, fix = ""): Why => ({ cause, what, fix });
const SIGN_IN = "Sign in to it again in Settings, under AI accounts.";
export const FAILURE_WORDS: Readonly<Record<string, Why>> = {
  "engine.vault_locked": W(
    "person",
    "Your Vault key is not on this server.",
    "Open Vyre on your computer and unlock your Vault. It goes on by itself.",
  ),
  "engine.signin_missing": W("person", "Your sign-in for this AI is missing.", SIGN_IN),
  "engine.signin_unopenable": W(
    "person",
    "Your AI sign-in can't be opened on this device.",
    "Sign in to it again to replace it.",
  ),
  "provider.auth_failed": W("person", "Your AI account needs you to sign in again.", SIGN_IN),
  "engine.no_account": W("person", "Connect your AI to get replies.", "Connect an AI account in Settings."),
  "engine.account_unavailable": W(
    "person",
    "Your AI account could not be reached just now.",
    "Check your AI account in Settings.",
  ),
  "engine.no_model": W("person", "No model is set for this chat.", "Pick a model for the agent in its settings."),
  "engine.no_model_works": W(
    "person",
    "None of your AI accounts can answer right now.",
    "Check your AI accounts in Settings.",
  ),
  "provider.rate_limited": W(
    "limit",
    "Your AI account reached its usage limit.",
    "Wait for it to reset, or let the agent use another AI account.",
  ),
  host_lost: W("transient", "The server stopped while this was running."),
  "provider.unavailable": W("transient", "Your AI provider is busy or down just now."),
  "provider.overloaded": W("transient", "Your AI provider is busy just now."),
  "provider.network": W("transient", "Your AI provider could not be reached."),
  turn_timeout: W("transient", "That took too long, so it was stopped."),
  "engine.timeout": W("transient", "The engine did not answer in time."),
  "engine.no_first_token": W("transient", "Your AI didn't answer in time."),
  "provider.context_too_long": W(
    "other",
    "This chat is too long for the model.",
    "Ask the agent to compact the goal chat.",
  ),
  agent_paused: W("other", "This agent is paused, so it did not answer.", "Resume the agent from its page."),
  agent_gone: W("other", "This agent is no longer available to you.", "Give the goal another lead agent."),
};

/** The words for a failed turn's code: its own, else its family's, else a plain line that still says what happened. */
export function failureWhy(code: string | undefined): Why {
  if (!code) return W("other", "It ended without writing a check-in.");
  const known = FAILURE_WORDS[code];
  if (known) return known;
  if (code.startsWith("provider.")) return W("transient", "Your AI provider could not answer this one.");
  return W("other", "Something went wrong that Vyre has no words for yet.");
}

/** The sentence's first letter in lower case, for a clause that follows a colon or "because". */
export const lower = (s: string): string => (s === "" ? s : s[0]!.toLowerCase() + s.slice(1));

/** The reason a turn failed, as a clause that follows "because" or a colon, with no full stop. */
export function failureClause(code: string | undefined): string {
  return lower(failureWhy(code).what).replace(/\.$/, "");
}
