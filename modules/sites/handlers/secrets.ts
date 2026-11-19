// Does an env var look like a secret? Asked before a plain value is kept: a name or a value that says "secret" goes to the Vault unless the person said plain on purpose. The web app has the same rules in
// apps/app/src/places/apps/shell/site/model.ts (isSecretVar); both are pinned by the same table of cases in their tests.

/** Names that are public by design, whatever they hold: they are shipped to the browser on purpose. */
const PUBLIC_NAME = /^(NEXT_PUBLIC_|PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|NUXT_PUBLIC_)/i;
const SECRET_NAME =
  /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|PWD|PRIVATE|CREDENTIAL|AUTH|SALT|DSN|SIGNING|COOKIE|SESSION|WEBHOOK|BEARER|^SK_|_SK$|^JWT|_JWT$|^SENDGRID|^MAILGUN|^TWILIO)/i;
const PLAIN_SHAPE = /^(true|false|yes|no|on|off|null|\d{1,10}(\.\d+)?)$/i;
const VALUE_SHAPES: readonly RegExp[] = [
  /(^|[^A-Za-z0-9])(sk|rk)_(live|test)_[A-Za-z0-9]{8,}/,
  /(^|[^A-Za-z0-9])(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /xox[abprs]-[A-Za-z0-9-]{10,}/,
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /^eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*$/,
  /-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE|PGP)/,
  /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i,
  /[?&](password|passwd|pwd|token|secret|key|apikey|api_key|access_token|sig|signature)=[^&\s]{4,}/i,
  /hooks\.slack\.com\/services\//,
  /discord(app)?\.com\/api\/webhooks\//,
];

/** Bits per character of a string: random keys sit above 3.5, words and paths below. */
export function entropy(s: string): number {
  if (s.length === 0) return 0;
  const n = new Map<string, number>();
  for (const c of s) n.set(c, (n.get(c) ?? 0) + 1);
  let h = 0;
  for (const k of n.values()) h -= (k / s.length) * Math.log2(k / s.length);
  return h;
}

export function looksSecret(name: string, value: string): boolean {
  if (VALUE_SHAPES.some((r) => r.test(value))) return true;
  if (value.length >= 24 && !/\s/.test(value) && !value.includes("/") && entropy(value) >= 3.9) return true;
  if (PUBLIC_NAME.test(name) || PLAIN_SHAPE.test(value.trim())) return false;
  return SECRET_NAME.test(name);
}
