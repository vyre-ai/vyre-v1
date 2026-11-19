// Text shaped like a secret, for a reader that sends text outward (chrome_search's query, chrome_read's address): a vendor token, a bearer token, a JWT, a private key header, a long hex run and, for a
// short free-text query, any long run of token characters. Every pattern is a flat run with a fixed lead-in: no nested or overlapping repeats, so it costs time in proportion to the text, and the callers
// cap the text first. It names the kind and never the value. (The transcript redactor has the full vendor list; when its linear version lands on this line this can read from it.)
const VENDOR: readonly [string, RegExp][] = [
  ["an API key (sk- or pk-)", /\b[sp]k-[A-Za-z0-9_-]{16,}/],
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ["a Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["an AWS key", /\bAKIA[0-9A-Z]{16}\b/],
  ["a Google key", /\bAIza[0-9A-Za-z_-]{30,}/],
  ["a JSON web token", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ["a bearer token", /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i],
  ["a private key", /-----BEGIN [A-Z ]{0,20}PRIVATE KEY-----/],
  ["a long hex value", /\b[A-Fa-f0-9]{32,}\b/],
];
const LONG_RUN = /[A-Za-z0-9+/_=-]{40,}/;

/** The kind of secret this text looks like, or null. `free` also treats any long run of token characters as one: right for a typed question, wrong for an address (which has long slugs). */
export function secretShape(text: string, o: { free?: boolean } = {}): string | null {
  const t = text.length > 4000 ? text.slice(0, 4000) : text;
  for (const [kind, re] of VENDOR) if (re.test(t)) return kind;
  if (o.free && LONG_RUN.test(t)) return "a long token";
  return null;
}
