// A failed action reads as one plain sentence. The error's code and trace id are not part of it: they are kept here, keyed by the sentence, so a note can offer a quiet "Details" that shows both with Copy.
// A person never meets "(provider.auth_failed)" or "Trace 3f9a..." in the text; support asks for Details.

export interface ErrorDetails { code?: string; traceId?: string }

const kept = new Map<string, ErrorDetails>();
const MAX = 200;

const clean = (s: string | undefined): string => (s ?? "").trim();

/** The plain sentence for a failure: its message, ending in a full stop, with no code and no trace id in it. The code and trace id are remembered for `detailsOf`. */
export function errorSentence(e: unknown, fallback = "Couldn’t complete this action"): string {
  const error = (e ?? {}) as { code?: string; traceId?: string; message?: string };
  const base = clean(error.message) || fallback;
  const sentence = /[.!?]$/.test(base) ? base : `${base}.`;
  const code = clean(error.code), traceId = clean(error.traceId);
  if (code || traceId) {
    kept.set(sentence, { ...(code ? { code } : {}), ...(traceId ? { traceId } : {}) });
    if (kept.size > MAX) kept.delete(kept.keys().next().value as string);
  }
  return sentence;
}

/** What `errorSentence` kept for this sentence, or null when it had no code or trace id. */
export const detailsOf = (sentence: unknown): ErrorDetails | null => (typeof sentence === "string" ? kept.get(sentence) ?? null : null);

/** The one line Details shows and Copy copies: "Code provider.auth_failed. Trace 3f9a". */
export function detailsText(d: ErrorDetails): string {
  return [d.code ? `Code ${d.code}` : "", d.traceId ? `Trace ${d.traceId}` : ""].filter(Boolean).join(". ");
}
