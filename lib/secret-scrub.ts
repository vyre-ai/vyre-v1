// The credential redactor, shared by the server, the host and the agent (lane r42-mcp, 19 Nov 2026; moved from agent/src/transcript/sanitize.ts, built on the final r40-redos version). agent/src/transcript/sanitize.ts re-exports it.
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
  // No lookbehind over a space run (it was quadratic): the name is matched and only group 1, the value, is replaced.
  ["aws-secret", /aws_secret_access_key\s{0,32}[=:]\s{0,32}([A-Za-z0-9/+=]{40})/gi, "AWS secret", 1],
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
  [
    // Found by the flag, then the command is looked for in the 130 characters before it on the same line: scanning forward from every
    // "mysql" with a lazy gap cost 120 steps per start (0.7 s on 5 MB of "mysql ").
    "db-flag-password",
    /\s-p([^\s]{8,})/g,
    "password",
    1,
  ],
  ["curl-userpass", /\B-u\s+[^\s:]{1,64}:([^\s]{6,})/g, "password", 1],
  // A key block with no end takes the rest of the text with it: a clipped paste loses its END line all the time. One rule, so the first
  // BEGIN always ends the scan (at its END or at the end of the text); two rules rescanned to the end from every BEGIN.
  ["pem", /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]{0,40}PRIVATE KEY-----|$)/g, "private key"],
  ["conn-url", /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,31}:\/\/[^\s:@/?#]+):([^\s@/?&=#]{3,})@/gi, "url password", 2],
  // The name is read as one run of name characters that starts where the run starts (the lookbehind is one character), so a long run is scanned once.
  // The optional prefix of the old pattern only fed the name check, which reads the whole run now.
  [
    "password",
    /(?<=^|[\s{,"'`_.-])(pass(?:word|wd)?|passphrase)["']?\s{0,32}[:=]\s{0,32}["']?((?!\$\{|<|your|xxx|process\.env)[^\s"',;}\n]{8,})/gim,
    "password",
    2,
  ],
  [
    "named-secret",
    // The name is one run of name characters, read from where the run starts. The lookahead asks for a secret word as a whole segment of the
    // name ("API_KEY", "db.password", "clientSecret"); at most 20 segments of 200 characters are looked at, so nothing here backtracks over a long run.
    /(?<![A-Za-z0-9_.-])(?=(?:[A-Za-z0-9]{0,200}[_.-]){0,20}(?:apikey|apisecret|authtoken|accesstoken|accesskey|secretkey|privatekey|clientsecret|refreshtoken|sessiontoken|token|secret|key|password|passwd|passphrase|credential|auth)(?![A-Za-z0-9]))([A-Za-z0-9_.-]{1,200})(?<!_FILE)(?<!_PATH)["']?\s{0,32}[:=]\s{0,32}["']?((?!\$\{|<|your|xxx|\.\.\.|changeme|placeholder|example|process\.env|import\.meta|\.{0,2}\/)[^\s"',;}()\n]{12,})/gi,
    "secret",
    2,
  ],
  [
    "camel-secret",
    /\b([a-z][A-Za-z0-9]*(?:Key|Secret|Token|Password|Passphrase|Credential|Auth))["']?\s*[:=]\s*["']?((?!\$\{|<|your|xxx|process\.env)[^\s"',;}()\n]{12,})/g,
    "secret",
    2,
  ],
];

export const PATTERNS: readonly Rule[] = [...VENDOR, ...GENERIC];

/**
 * Lowercase text a rule needs somewhere in the input before it can match at all (any one of them). A long output with none of them skips the
 * rule's scan, which is most of the time spent on a 5 MB tool result. Every entry is a literal the rule's pattern cannot match without.
 */
const NEEDS: Readonly<Record<string, readonly string[]>> = {
  digitalocean: ["dop_v1_"],
  anthropic: ["sk-ant-"],
  openai: ["sk-"],
  stripe: ["k_live_", "k_test_"],
  github: ["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_"],
  aws: ["akia", "asia"],
  "aws-secret": ["aws_secret_access_key"],
  slack: ["xox"],
  "slack-app": ["xapp-"],
  google: ["aiza"],
  sendgrid: ["sg."],
  npm: ["npm_"],
  jwt: ["eyj"],
  bearer: ["bearer"],
  "db-flag-password": ["-p"],
  "curl-userpass": ["-u"],
  pem: ["-----begin"],
  "conn-url": ["://"],
  password: ["pass"],
  "named-secret": ["=", ":"],
  "camel-secret": ["=", ":"],
};

/** Names that contain a secret word and are not secrets: a token count is a number, a cache key an identifier, a secretary a person. */
const NOT_SECRET_NAME =
  /^(?:.*_(?:count|id|ids|name|names|length|size|type|version|at|on)|cache_key|idempotency_key|keychain|secretar\w*|authors?|public_key|ssh_public_key|.*_public_key)$/i;

export interface Redacted {
  text: string;
  hits: string[];
}

/** Replace each secret with a marker that keeps its kind and last four characters. Never throws, whatever it is given. */
export function redact(input: unknown): Redacted {
  if (input === null || input === undefined || input === "") return { text: "", hits: [] };
  let out = String(input);
  const hits: string[] = [];
  let low = out.toLowerCase();
  for (const [name, re, label, group] of PATTERNS) {
    const needs = NEEDS[name];
    if (needs && !needs.some((w) => low.includes(w))) continue;
    const before = out;
    out = out.replace(re, (m: string, ...rest: unknown[]) => {
      // For a name/value rule the first group is the NAME, and some names contain a secret word without meaning one.
      if (name === "db-flag-password") {
        const off = rest[rest.length - 2] as number;
        if (
          !/\b(?:mysql|mysqldump|mariadb|psql|mongosh?|redis-cli)\b[^\n]*$/.test(out.slice(Math.max(0, off - 130), off))
        )
          return m;
      }
      if (group === 2 && NOT_SECRET_NAME.test(String(rest[0] ?? ""))) return m;
      const secret = group ? String(rest[group - 1] ?? m) : m;
      if (!secret || secret.length < 8) return m;
      // Placeholders help nobody when redacted, and markers must never be redacted again, or every re-index would chew further into the text.
      if (/^(\[|x{4,}|\*{4,}|<[^>]+>|\$\{?\w+\}?|redacted|changeme|your[-_])/i.test(secret)) return m;
      // The checks below apply only to generic name/value rules. A vendor rule has proved what it found by its prefix.
      if (group && name !== "aws-secret") {
        if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(secret)) return m; // a dotted identifier is code
        if (/^[A-Z][A-Z0-9_]*$/.test(secret) || /^[A-Z][A-Za-z_$]*$/.test(secret)) return m; // a CONSTANT or a TypeName is a variable
        if (name !== "password" && /^[A-Za-z_$]+(?:[-_][A-Za-z_$]+)+$/.test(secret)) return m; // words joined by hyphens are prose or configuration
        if (/^[.*$|\\]/.test(secret)) return m; // a shell or sed fragment
      }
      hits.push(name);
      // A private key shows nothing of itself, not even its last four characters: they are key material.
      const marker = label === "private key" ? "[private key redacted]" : `[${label} redacted …${secret.slice(-4)}]`;
      return group ? m.replace(secret, marker) : marker;
    });
    if (out !== before) low = out.toLowerCase();
  }
  return { text: out, hits };
}

/** The kinds of secret in a text, without changing it. */
export const scan = (text: unknown): string[] => redact(text).hits;

// ---- text for a log -------------------------------------------------------------------------------------------------------------------------------------
// redact() above is for text that is kept (transcripts, tool results) and keeps what looks like prose. A log line made from an error needs more: the error may echo anything an upstream said, a request body, a header, a
// connection string. scrubLog() reads the text one word at a time (no pattern runs over the whole text, so it is linear), removes the value of anything named like a secret in any common spelling, then runs redact()
// over the result, and cuts to the limit last, at a word boundary, so a key is never split by the cut.

// A secret word ends the name. snake_case, kebab-case and dotted names in any letter case (api_key, API_KEY, x-api-key, db.password); camelCase after a lower-case letter or digit (accessToken, authToken, secretKey, clientSecret, apiKey).
const SECRET_WORDS = "pass(?:word|wd|phrase)?|pw|pwd|jwt|otp|session[-_]?id|secret|token|apikey|api[-_]?key|key|auth|authorization|credentials?|session|sid|cookie|signature";
const SECRET_SNAKE = new RegExp(`(?:^|[-_.])(?:${SECRET_WORDS})$`, "i");
const SECRET_CAMEL = /[a-z0-9](?:Pass(?:word|wd|phrase)?|Pw|Pwd|Jwt|Otp|SessionId|Secret|Token|Apikey|ApiKey|Key|Auth|Authorization|Credentials?|Session|Sid|Cookie|Signature)$/;
// run together in one case (AUTHTOKEN, dbpassword): the words that are never anything else need no boundary; "key" does (monkey)
const SECRET_STRONG = /(?:token|secret|password|passwd|passphrase|apikey|credentials?)$/i;
const SECRET_NAME = { test: (w: string): boolean => SECRET_SNAKE.test(w) || SECRET_CAMEL.test(w) || SECRET_STRONG.test(w) };
const LINE_HEADER = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-amz-security-token):$/i; // the colon is required: "Authorization failed for bob" and "the cookie banner" are prose
const FLAG = /^-{1,2}(?:password|passwd|pass|token|secret|api-?key|auth)$/i;
// -p and -u mean a secret only after a client that takes one (a database client or curl); elsewhere they are "make parents" and "set upstream"
const SHORT_FLAG = /^-(?:p|u)$/;
const SCHEME_WORD = /^(?:bearer|basic)$/i;
const VENDOR_PREFIX =
  /^(?:sk[-_]|pk_(?:live|test)_|rk_(?:live|test)_|gh[pousr]_|github_pat_|xox[abprs]-|xapp-|AKIA|ASIA|AIza|eyJ|SG\.|npm_|dop_v1_)/;
const LONG_RUN = /[A-Za-z0-9_\-+/=]{20,}/g;
const DB_TOOL = /^(?:mysql|mysqldump|mariadb|psql|mongosh?|redis-cli|curl|wget|http|https)$/i;
const MAX_WORD = 2000;

const REMOVED = "[removed]";

/** Is this word, once its quotes and brackets are taken off, the name of something secret? Names are short; a long word is not a name. */
function isSecretName(raw: string): boolean {
  if (raw.length > 80) return false; // a name is short: nothing longer is looked at, so no pattern below sees a long run
  const w = raw.replace(/^[{[(,"'`]+/, "").replace(/["'`:=,)\]}]+$/, "");
  return w.length > 0 && w.length <= 60 && SECRET_NAME.test(w);
}

const PAIR = /(["'`]?)([A-Za-z0-9_.-]{1,60})\1([:=])("[^"]{0,500}"|'[^']{0,500}'|[^\s,;&}\])]{0,500})/g;

/**
 * The word with the value of every secret-named pair taken out (name=value, "name":"value", a query or a JSON text in one word); the rest of the word is kept, so a JSON text still reads. Null when no pair
 * in it is secret. A pair whose value is in the next word ("password:" then the value) is the caller's: it sees the word ends in the separator.
 */
function inlineSecret(word: string): string | null {
  let hit = false;
  const out = word.replace(PAIR, (m, q: string, name: string, sep: string, value: string) => {
    if (!isSecretName(name) || value === "") return m;
    hit = true;
    return `${q}${name}${q}${sep}${REMOVED}`;
  });
  return hit ? out : null;
}

/** An address keeps scheme, host and path: no user name or password, no query, no fragment. */
function trimAddress(word: string): string {
  const at = word.indexOf("://");
  if (at <= 0 || at > 40) return word;
  let rest = word.slice(at + 3);
  const cut = rest.search(/[?#]/);
  if (cut >= 0) rest = rest.slice(0, cut);
  const slash = rest.indexOf("/");
  const authority = slash >= 0 ? rest.slice(0, slash) : rest;
  const sign = authority.lastIndexOf("@");
  if (sign >= 0) rest = rest.slice(sign + 1);
  return word.slice(0, at + 3) + rest;
}

/**
 * Not caught, on purpose: a name word followed by a bare value with no separator ("Password hunter2") and user:pass@host with no scheme read as prose; adding them would remove ordinary sentences from every log.
 * Remove the secrets from a text before it is written to a log, then cut it to `limit` characters at a word boundary. Never throws; takes time proportional to the text. */
export function scrubLog(input: unknown, limit = 4000): string {
  try {
    let text = String(input ?? "");
    // only the first few times the limit can reach the output, so only that much is read (a key that straddles the limit is inside it, and whole); the rest could only cost time
    const window = Math.max(limit * 4, 16_000);
    if (text.length > window) {
      const at = text.lastIndexOf(" ", window);
      text = text.slice(0, at > window / 2 ? at : window);
    }
    const parts = text.split(/(\s+)/);
    const out: string[] = [];
    let hide = 0; // words still to remove
    let toNewline = false; // a header: the rest of the line goes
    let quote = ""; // a quoted value that spans words: removed to its closing quote
    let last = ""; // the word before this one, for a separator that stands alone
    let lineStart = true; // a header is a header only at the start of a line
    let userinfo = 0; // a password with a space in it: words until the one that carries the @
    let dbCommand = 0; // words since a database client was named: its -pPASSWORD flag takes the password glued on
    for (const part of parts) {
      if (part === "" || /^\s+$/.test(part)) {
        out.push(part);
        if (/[\r\n]/.test(part)) {
          lineStart = true;
          toNewline = false;
          dbCommand = 0; // -p and -u are read only on the line where the client is named
        }
        continue;
      }
      const before = last;
      const atStart = lineStart;
      lineStart = false;
      last = part;
      if (DB_TOOL.test(part)) dbCommand = 24;
      else if (dbCommand > 0) dbCommand -= 1;
      if (userinfo > 0) {
        userinfo -= 1;
        const at = part.lastIndexOf("@");
        if (at >= 0) {
          userinfo = 0;
          out.push(part.slice(at + 1));
        } else out.push(REMOVED);
        continue;
      }
      if (toNewline) {
        out.push(REMOVED);
        continue;
      }
      if (quote !== "") {
        out.push(REMOVED);
        if (part.endsWith(quote) || part.includes(`${quote},`) || part.includes(`${quote}}`)) quote = "";
        continue;
      }
      if (hide > 0) {
        if (SCHEME_WORD.test(part)) {
          out.push(part);
          continue;
        }
        hide -= 1;
        out.push(REMOVED);
        if (/^["'`]/.test(part) && !/["'`][,;}\])]*$/.test(part.slice(1))) quote = part[0] as string;
        continue;
      }
      if (part.length > MAX_WORD) {
        out.push("[long text removed]");
        continue;
      }
      let w = part;
      if (dbCommand > 0 && /^-p[^\s=]{3,}$/.test(w)) {
        out.push("-p" + REMOVED);
        continue;
      }
      if (atStart && LINE_HEADER.test(w)) {
        toNewline = true;
        out.push(w);
        continue;
      }
      if (SCHEME_WORD.test(w) || FLAG.test(w) || (dbCommand > 0 && SHORT_FLAG.test(w))) {
        hide = 1;
        out.push(w);
        continue;
      }
      const inline = inlineSecret(w);
      if (inline !== null) {
        out.push(inline);
        continue;
      }
      // name: or name= with the value in the next word ("password: x", {"token": "x"})
      if (/[:=]$/.test(w) && isSecretName(w.replace(/[^A-Za-z0-9_.-]+$/, "").replace(/^[^A-Za-z0-9_.-]+/, ""))) {
        hide = 1;
        out.push(w);
        continue;
      }
      if (isSecretName(w) || /^[:=]$/.test(w)) {
        // the name is a word of its own: "password = x", "password : x"; the separator may be a word too
        if (/^[:=]$/.test(w)) {
          if (isSecretName(before)) hide = 1;
        }
        out.push(w);
        continue;
      }
      // "scheme://user:pa ss@host": a word with a user and the start of a password and no @ is followed by the rest of the password, then the @
      const open = /^([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/@?#:]*:([^\s/@?#]*)$/i.exec(w);
      if (open && !/^\d+$/.test(open[2] ?? "")) {
        userinfo = 3;
        out.push(open[1] as string);
        continue;
      }
      w = trimAddress(w);
      if (VENDOR_PREFIX.test(w.replace(/^[{[("'`,]+/, "")) && w.length >= 12) {
        out.push(REMOVED);
        continue;
      }
      out.push(w.replace(LONG_RUN, (run) => (/[A-Za-z]/.test(run) && /\d/.test(run) ? REMOVED : run)));
    }
    let scrubbed = redact(out.join("")).text;
    if (scrubbed.length > limit) {
      const cut = scrubbed.lastIndexOf(" ", limit);
      scrubbed = scrubbed.slice(0, cut > limit / 2 ? cut : limit);
    }
    return scrubbed;
  } catch {
    return "[unreadable]";
  }
}
