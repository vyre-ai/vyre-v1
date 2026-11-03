// A failed CLI turn as a code the engine and the accounts module understand (accounts/fallback.ts): a sign-in that is gone or a rate limit moves the turn to the backup key, the rest is surfaced.
const AUTH = /invalid api key|please run \/login|not logged in|log ?in required|unauthori[sz]ed|authentication|expired.{0,20}(token|login|session)|\b401\b|sign in/i;
const RATE = /rate.?limit|usage limit|limit reached|hit your (usage |weekly |5.?hour )?limit|quota|too many requests|\b429\b|credit balance/i;
/** The vendor is busy: not a limit of this account (owner ruling, 3 Nov 2026). The engine tries the same account once more, then the backup, and says so. */
const OVERLOADED = /overloaded|\b529\b|server(?:s)? (?:is|are) (?:busy|at capacity)/i;
const CONTEXT = /context.{0,20}(length|window)|prompt is too long|too many tokens/i;

/** A sandbox that could not start the program says so on stderr (bwrap, sandbox-exec). The program's name is what the chat needs, never the rest of the line. */
const NOT_THERE = /\bexecvp(?:\(\))?(?: of)? '?([\w./-]+?)'?(?: failed)?: No such file or directory/;
export function missingProgram(message: string): string | null {
  const path = NOT_THERE.exec(message)?.[1];
  return path === undefined ? null : path.slice(path.lastIndexOf("/") + 1);
}

export function classifyCli(message: string): string {
  if (CONTEXT.test(message)) return "provider.context_too_long";
  if (AUTH.test(message)) return "provider.auth_failed";
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
