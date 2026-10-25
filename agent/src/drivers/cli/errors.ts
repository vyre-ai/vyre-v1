// A failed CLI turn as a code the engine and the accounts module understand (accounts/fallback.ts): a sign-in that is gone or a rate limit moves the turn to the backup key, the rest is surfaced.
const AUTH = /invalid api key|please run \/login|not logged in|log ?in required|unauthori[sz]ed|authentication|expired.{0,20}(token|login|session)|\b401\b|sign in/i;
const RATE = /rate.?limit|usage limit|quota|too many requests|\b429\b|overloaded|credit balance/i;
const CONTEXT = /context.{0,20}(length|window)|prompt is too long|too many tokens/i;

export function classifyCli(message: string): string {
  if (CONTEXT.test(message)) return "provider.context_too_long";
  if (AUTH.test(message)) return "provider.auth_failed";
  if (RATE.test(message)) return "provider.rate_limited";
  return "engine.cli_error";
}
