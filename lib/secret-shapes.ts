// Text that looks like a credential, taken out of a line of words that is about to be shown to a person (a notice, a status line) when the line came from somewhere that could not know which
// secrets exist: an app's own error text, say. It cannot find a secret by its value (see lib/vault-use/scrub.ts, which does that for values the Vault filled); it removes what a secret LOOKS like.
export const REMOVED = "…";

const SHAPES: readonly RegExp[] = [
  // Authorization headers and their schemes
  /\b(?:Bearer|Basic|Digest|Token)\s+[A-Za-z0-9._~+/=:-]{6,}/gi,
  // name=value or name: value, for the names credentials travel under (the value to the next separator)
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passwd|pwd|token|authorization|x-api-key)\s*[:=]\s*["']?[^\s"',;&)]+/gi,
  // user:password@ inside an address
  /(?<=:\/\/)[^\s/@:]+:[^\s/@]+@/g,
  // cookies, whole header value
  /\b(?:Set-Cookie|Cookie)\s*:\s*[^\n]+/gi,
  // JSON web tokens
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
  // well-known key prefixes
  /\b(?:sk|pk|rk|whsec|xox[abprs]|ghp|gho|ghu|ghs|github_pat|glpat|AKIA|AIza)[-_A-Za-z0-9]{8,}/g,
  // long runs of key-like characters and long hex
  /[A-Za-z0-9+/_=-]{32,}/g,
];

/** The text with every credential-looking part replaced by `…`. */
export function scrubShapes(text: string): string {
  let out = text;
  for (const re of SHAPES) out = out.replace(re, REMOVED);
  return out;
}
