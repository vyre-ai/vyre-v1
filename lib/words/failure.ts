// A failed turn in a sentence about an agent, in plain words (docs: ACTIVITY-2026-11-13 1.4). The code itself never goes into a sentence; callers keep it in the row's data for an admin.
// The longer table of every code a chat can show lives in the app (conversation/status.ts, wordsFor); a module cannot import the app, so this holds only the clauses a turn of a goal's lead can produce.
const CLAUSES: Readonly<Record<string, string>> = {
  host_lost: "Vyre's server restarted while it was working",
  "provider.unavailable": "the AI provider did not answer",
  "provider.network": "the AI provider did not answer",
  "provider.overloaded": "the AI provider was too busy",
  "provider.rate_limited": "the AI account reached its usage limit",
  "provider.auth_failed": "the AI account needs someone to sign in again",
  "provider.context_too_long": "the goal chat grew too long for the AI model",
  turn_timeout: "it took too long",
  agent_paused: "the agent is paused",
  agent_gone: "the agent is no longer in the Space",
  "engine.no_account": "no AI account can answer for it",
  "engine.no_model": "no AI account can answer for it",
  "engine.no_model_works": "no AI account can answer for it",
};

/** The reason a turn failed, as a clause that follows "because" or a colon. Any other provider code, and any code Vyre has no words for, still reads plainly. */
export function failureClause(code: string | undefined): string {
  if (!code) return "it ended without writing a check-in";
  const known = CLAUSES[code];
  if (known) return known;
  if (code.startsWith("provider.")) return "the AI provider could not answer this one";
  return "something went wrong that Vyre has no words for yet";
}
