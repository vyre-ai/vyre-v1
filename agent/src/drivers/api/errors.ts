// Provider failures as codes the engine and the accounts module understand (accounts/fallback.ts): auth and rate limits move a turn to the backup key, the rest is surfaced.
export interface ApiError { code: string; message: string; status: number; retryable: boolean; retryAfterMs?: number }

const CONTEXT = /context.{0,20}(length|window)|too many tokens|prompt is too long|maximum context|input.{0,20}too long/i;

/** Class of a failed call. `text` is the body the provider sent, already cut short by the caller. */
export function classify(status: number, text: string, code?: string): { code: string; retryable: boolean } {
  if (CONTEXT.test(text)) return { code: "provider.context_too_long", retryable: false };
  if (status === 401 || status === 403) return { code: "provider.auth_failed", retryable: false };
  if (status === 429 || status === 402) return { code: "provider.rate_limited", retryable: status === 429 };
  if (status === 408 || status === 409 || status >= 500 || status === 0) return { code: "provider.unavailable", retryable: true };
  if (code === "overloaded_error" || code === "rate_limit_error") return { code: code === "overloaded_error" ? "provider.unavailable" : "provider.rate_limited", retryable: true };
  if (code === "authentication_error" || code === "permission_error") return { code: "provider.auth_failed", retryable: false };
  return { code: "provider.bad_request", retryable: false };
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
