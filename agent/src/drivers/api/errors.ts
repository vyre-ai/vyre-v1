// Provider failures as codes the engine and the accounts module understand (accounts/fallback.ts): auth and rate limits move a turn to the backup key, the rest is surfaced.
export interface ApiError { code: string; message: string; status: number; retryable: boolean; retryAfterMs?: number }

const CONTEXT = /context.{0,20}(length|window)|too many tokens|prompt is too long|maximum context|input.{0,20}too long/i;

/** Class of a failed call. `text` is the body the provider sent, already cut short by the caller. */
export function classify(status: number, text: string, code?: string): { code: string; retryable: boolean } {
  if (CONTEXT.test(text)) return { code: "provider.context_too_long", retryable: false };
  if (status === 401 || status === 403) return { code: "provider.auth_failed", retryable: false };
  if (status === 429 || status === 402) return { code: "provider.rate_limited", retryable: status === 429 };
  // "Overloaded" (Anthropic 529, overloaded_error) is the vendor being busy, not a limit (owner ruling, 3 Nov 2026). The session does not retry it: the engine tries the same account once
  // more, then the backup, and the chat says so.
  if (status === 529 || code === "overloaded_error") return { code: "provider.overloaded", retryable: false };
  if (status === 408 || status === 409 || status >= 500 || status === 0) return { code: "provider.unavailable", retryable: true };
  if (code === "rate_limit_error") return { code: "provider.rate_limited", retryable: true };
  if (code === "authentication_error" || code === "permission_error") return { code: "provider.auth_failed", retryable: false };
  return { code: "provider.bad_request", retryable: false };
}

/** OpenCode Go's refusal of a request without its session header (400 MissingSessionID, "Request is missing x-opencode-session"). */
const OPENCODE_SESSION_MISSING = /MissingSessionID|missing x-opencode-session/i;

/**
 * A provider refusal in plain words, when Vyre knows what it means; null for the rest, which keep "The provider answered <status>: <text>".
 */
export function plainRefusal(status: number, text: string): string | null {
  if (status === 400 && OPENCODE_SESSION_MISSING.test(text)) return "OpenCode Go turned the chat away because it carried no session id, which this version of Vyre should send. Update Vyre, or use another AI account until then.";
  return null;
}

/** Retry-After in seconds or as a date; undefined when absent or unreadable. */
export function retryAfterMs(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** An error message never carries a header value the caller sent. `secrets` are the auth header values of this call. */
export function scrub(message: string, secrets: readonly string[]): string {
  let out = message;
  for (const s of secrets) {
    if (s.length < 6) continue;
    out = out.split(s).join("[key]");
    // "Bearer <key>" is split on the token itself.
    const tail = s.split(/\s+/).pop() ?? "";
    if (tail.length >= 6) out = out.split(tail).join("[key]");
  }
  return out.slice(0, 300);
}
