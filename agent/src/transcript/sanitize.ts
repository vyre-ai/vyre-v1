// from vyre 0.6.9 lib/sanitize.js@dbd2dfbab and lib/credential-shapes.js@dbd2dfbab (the vendor shapes that matter for a conversation)
// Keep credentials out of everything built from a transcript. People paste keys into conversations; copying them into a searchable index, a summary or
// another engine's first message is the mistake. Every piece of text that enters the transcript goes through redact() first.
// The marker keeps the kind of secret and its last four characters, so "rotate the billing token" stays readable and findable while the value is gone.
// The rules are written as patterns only: no example key appears in this file, so a scan of the source finds nothing.

type Rule = readonly [name: string, re: RegExp, label: string, group?: number];

const VENDOR: readonly Rule[] = [
  ["digitalocean", /\bdop_v1_[a-f0-9]{32,}/gi, "DO token"],
  ["anthropic", /\bsk-ant-[A-Za-z0-9_-]{20,}/g, "Anthropic key"],
  ["openai", /\bsk-(?:proj-|svcacct-|admin-|live-)?[A-Za-z0-9_-]{20,}/g, "API key"],
  ["stripe", /\b[prs]k_(?:live|test)_[A-Za-z0-9]{20,}/g, "Stripe key"],
  ["github", /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g, "GitHub token"],
  ["aws", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "AWS key id"],
  ["aws-secret", /(?<=aws_secret_access_key\s*[=:]\s*)[A-Za-z0-9/+=]{40}/gi, "AWS secret"],
  ["slack", /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "Slack token"],
  ["slack-app", /\bxapp-[0-9]-[A-Za-z0-9]+-[0-9]+-[A-Za-z0-9]{16,}/g, "Slack app token"],
  ["google", /\bAIza[0-9A-Za-z_-]{30,}/g, "Google key"],
  ["sendgrid", /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "SendGrid key"],
  ["npm", /\bnpm_[A-Za-z0-9]{36}\b/g, "npm token"],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g, "JWT"],
  ["bearer", /\bBearer\s+[A-Za-z0-9._-]{24,}/g, "bearer token"],
];

/** Rules found by a secret's NAME or place rather than its prefix. A rule with a group replaces only that group, so the name in front of the value survives. */
const GENERIC: readonly Rule[] = [
  ["db-flag-password", /\b(?:mysql|mysqldump|mariadb|psql|mongosh?|redis-cli)\b[^\n]{0,120}?\s-p([^\s]{8,})/g, "password", 1],
  ["curl-userpass", /\B-u\s+[^\s:]{1,64}:([^\s]{6,})/g, "password", 1],
  ["pem", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "private key"],
  // A key block with no end takes the rest of the text with it: a clipped paste loses its END line all the time.
  ["pem-open", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*$/g, "private key"],
  ["conn-url", /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/?#]+):([^\s@/?&=#]{3,})@/gi, "url password", 2],
  ["password", /(?:^|[\s{,"'`_-])((?:[A-Za-z0-9_.-]*[_.-])?pass(?:word|wd)?|passphrase)["']?\s*[:=]\s*["']?((?!\$\{|<|your|xxx|process\.env)[^\s"',;}\n]{8,})/gi, "password", 2],
  ["named-secret", /\b(?:export\s+)?["']?((?:[A-Za-z0-9_.-]*[_.-])?(?:apikey|apisecret|authtoken|accesstoken|accesskey|secretkey|privatekey|clientsecret|refreshtoken|sessiontoken|token|secret|key|password|passwd|passphrase|credential|auth)(?:[_.-][A-Za-z0-9_.-]*)?)(?<!_FILE)(?<!_PATH)(?<!_file)(?<!_path)["']?\s*[:=]\s*["']?((?!\$\{|<|your|xxx|\.\.\.|changeme|placeholder|example|process\.env|import\.meta|\.{0,2}\/)[^\s"',;}()\n]{12,})/gi, "secret", 2],
  ["camel-secret", /\b([a-z][A-Za-z0-9]*(?:Key|Secret|Token|Password|Passphrase|Credential|Auth))["']?\s*[:=]\s*["']?((?!\$\{|<|your|xxx|process\.env)[^\s"',;}()\n]{12,})/g, "secret", 2],
];

export const PATTERNS: readonly Rule[] = [...VENDOR, ...GENERIC];

/** Names that contain a secret word and are not secrets: a token count is a number, a cache key an identifier, a secretary a person. */
const NOT_SECRET_NAME = /^(?:.*_(?:count|id|ids|name|names|length|size|type|version|at|on)|cache_key|idempotency_key|keychain|secretar\w*|authors?|public_key|ssh_public_key|.*_public_key)$/i;

export interface Redacted { text: string; hits: string[] }

/** Replace each secret with a marker that keeps its kind and last four characters. Never throws, whatever it is given. */
export function redact(input: unknown): Redacted {
  if (input === null || input === undefined || input === "") return { text: "", hits: [] };
  let out = String(input);
  const hits: string[] = [];
  for (const [name, re, label, group] of PATTERNS) {
    out = out.replace(re, (m: string, ...rest: unknown[]) => {
      // For a name/value rule the first group is the NAME, and some names contain a secret word without meaning one.
      if (group === 2 && NOT_SECRET_NAME.test(String(rest[0] ?? ""))) return m;
      const secret = group ? String(rest[group - 1] ?? m) : m;
      if (!secret || secret.length < 8) return m;
      // Placeholders help nobody when redacted, and markers must never be redacted again, or every re-index would chew further into the text.
      if (/^(\[|x{4,}|\*{4,}|<[^>]+>|\$\{?\w+\}?|redacted|changeme|your[-_])/i.test(secret)) return m;
      // The checks below apply only to generic name/value rules. A vendor rule has proved what it found by its prefix.
      if (group) {
        if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(secret)) return m;            // a dotted identifier is code
        if (/^[A-Z][A-Z0-9_]*$/.test(secret) || /^[A-Z][A-Za-z_$]*$/.test(secret)) return m; // a CONSTANT or a TypeName is a variable
        if (name !== "password" && /^[A-Za-z_$]+(?:[-_][A-Za-z_$]+)+$/.test(secret)) return m; // words joined by hyphens are prose or configuration
        if (/^[.*$|\\]/.test(secret)) return m;                                              // a shell or sed fragment
      }
      hits.push(name);
      // A private key shows nothing of itself, not even its last four characters: they are key material.
      const marker = label === "private key" ? "[private key redacted]" : `[${label} redacted …${secret.slice(-4)}]`;
      return group ? m.replace(secret, marker) : marker;
    });
  }
  return { text: out, hits };
}

/** The kinds of secret in a text, without changing it. */
export const scan = (text: unknown): string[] => redact(text).hits;
