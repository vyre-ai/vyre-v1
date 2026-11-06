// A failed CLI turn as a code the engine and the accounts module understand (accounts/fallback.ts): a sign-in that is gone or a rate limit moves the turn to the backup key, the rest is surfaced.
const AUTH = /invalid api key|please run \/login|not logged in|log ?in required|unauthori[sz]ed|authentication|expired.{0,20}(token|login|session)|\b401\b|sign in/i;
const RATE = /rate.?limit|usage limit|limit reached|hit your (usage |weekly |5.?hour )?limit|quota|too many requests|\b429\b|credit balance/i;
/** The vendor is busy: not a limit of this account (owner ruling, 3 Nov 2026). The engine tries the same account once more, then the backup, and says so. */
const OVERLOADED = /overloaded|\b529\b|server(?:s)? (?:is|are) (?:busy|at capacity)/i;
const NETWORK = /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|fetch failed|network (?:error|is unreachable)|could not resolve host|getaddrinfo|socket hang up|connection (?:refused|reset|timed out)/i;
/** The engine itself could not run here (a copy tied to a desktop app, a missing runtime): no computer of the person's can run it as it is. */
const UNUSABLE = /routing discovery failed|workspace routing|cannot be used outside|command not found|no such file or directory/i;
const CONTEXT = /context.{0,20}(length|window)|prompt is too long|too many tokens/i;

/** A sandbox that could not start the program says so on stderr (bwrap, sandbox-exec). The program's name is what the chat needs, never the rest of the line. */
const NOT_THERE = /\bexecvp(?:\(\))?(?: of)? '?([\w./-]+?)'?(?: failed)?: No such file or directory/;
export function missingProgram(message: string): string | null {
  const path = NOT_THERE.exec(message)?.[1];
  return path === undefined ? null : path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The engine says the picked model is not there or not this account's. Checked against Claude Code's own words ("There's an issue with the selected model (x). It may not exist or you may not have
 * access to it. Run --model to pick a different model.") and the same thing from the other CLIs. Not a failure of the engine: the turn moves to another model (modules/engine/model-switch.ts).
 */
const MODEL_GONE = /issue with the selected model|model (?:[\w./:-]+ )?(?:may|might) not exist|(?:selected )?model [\w./:-]* ?(?:does not exist|not found|is not available|isn't available)|unknown model|invalid model|no access to (?:the )?model|do not have access to (?:the )?model|model is not supported when using codex/i;
export const modelGone = (message: string): boolean => MODEL_GONE.test(message);

/** The model a "selected model (x)" line names, or null. */
export function goneModel(message: string): string | null {
  return /selected model \(([^)\s]+)\)/i.exec(message)?.[1] ?? /The '([^'\s]+)' model is not supported/i.exec(message)?.[1] ?? null;
}

/** A line the engine's own command line wrote for its own user ("Run --model to pick a different model.") is no use to a person in a chat: it is cut from what they read. */
const USAGE = /\s*\b(?:Run|Use|Try|Pass|Specify)\s+(?:`?[\w-]*\s)?`?--[\w-]+[^.\n]*\.?/gi;
export function plainCli(message: string): string {
  const cut = message.replace(USAGE, "").replace(/\s{2,}/g, " ").trim();
  return cut === "" ? message : cut;
}

export function classifyCli(message: string): string {
  if (MODEL_GONE.test(message)) return "engine.model_unavailable";
  if (CONTEXT.test(message)) return "provider.context_too_long";
  if (UNUSABLE.test(message)) return "engine.cli_unusable";
  if (AUTH.test(message)) return "provider.auth_failed";
  if (NETWORK.test(message)) return "provider.network";
  if (OVERLOADED.test(message)) return "provider.overloaded";
  if (RATE.test(message)) return "provider.rate_limited";
  return "engine.cli_error";
}

/**
 * The engine says the session it was asked to resume is not there (its files were removed, or it never was). Checked against the CLIs' own words: Claude Code 2.1 "No conversation found with session
 * ID: <id>", Codex 0.164 "No saved session found with ID <id>", Grok 1.0.70 "Session does not exist" and "No session found with id <id>".
 */
const GONE = /no conversation found with session id|no saved session found with id|no session found with id|session does not exist|no (?:saved )?(?:session|conversation|rollout|thread) (?:was )?found/i;
export const sessionGone = (message: string): boolean => GONE.test(message);
