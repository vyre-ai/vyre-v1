// Not-in-v1 absence checks (V1-SPEC section 6 and "Not in v1 (owner, 24 Oct)"; ARCH Appendix B items 1 and 4).
// Nothing in v1 may import, or add a file for: Lumen, Mac or Windows control (local/hands-*), voice agents and the
// meeting bot, billing, phone AutoFill providers, Vault passkeys and WebAuthn (including vault-apple and vault-android).
// The check reads tracked source only. Contracts and docs are out of scope on purpose: generated/, manifests/,
// packages/contracts and docs/ name some of these words as frozen capability ids or prose, and a frozen id is not code.
// Softphone calls (Twilio Voice JS, 2.18) and Stripe as a customer connector are in v1 and are not matched.

export interface AbsenceRule {
  id: string;
  /** What the spec says, shown in the failure. */
  reason: string;
  /** Matches a repo path (forward slashes). A tracked source file that matches is a violation. */
  path: RegExp;
  /** Matches an import specifier. An import that matches is a violation. */
  spec: RegExp;
}

export interface AbsenceFinding {
  rule: string;
  file: string;
  kind: "path" | "import";
  detail: string;
  reason: string;
}

export interface SourceFile {
  path: string;
  /** Source text. Left out for a file that is only checked by its path. */
  text?: string;
}

/** A path segment or file stem, so `modules/billing/x.ts` and `billing.ts` match and `billingish` or `rebilling` do not. */
function word(...names: string[]): RegExp {
  return new RegExp(`(^|/)(?:${names.join("|")})(?=[/.\\-_]|$)`, "i");
}

function specWord(...names: string[]): RegExp {
  return new RegExp(`(^|[/@\\-_.])(?:${names.join("|")})(?=[/.\\-_@]|$)`, "i");
}

export const RULES: readonly AbsenceRule[] = [
  {
    id: "lumen",
    reason: "Lumen is not in v1 (owner, 24 Oct)",
    path: word("lumen"),
    spec: specWord("lumen"),
  },
  {
    id: "mac-windows-control",
    reason: "Mac and Windows control (computer use on the person's own machine) is not in v1; agent computers on the Space server stay in",
    path: /(^|\/)local\/hands(-|\/|$)|(^|\/)hands-(mac|windows|win|desktop)(?=[/.\-_]|$)/i,
    spec: /(^|\/)local\/hands(-|\/|$)|(^|\/)hands-(mac|windows|win|desktop)(?=[/.\-_]|$)/i,
  },
  {
    id: "voice-agents",
    reason: "Voice agents answering calls and the meeting bot are not in v1 (agents own a number for texts and voicemail)",
    path: word("voice-agents?", "voiceagents?", "voice_agents?", "meeting-bot", "meetingbot", "meeting_bot"),
    spec: new RegExp(specWord("voice-agents?", "voiceagents?", "voice_agents?", "meeting-bot", "meetingbot", "meeting_bot").source + "|@elevenlabs/|@vapi-ai/|retell-sdk", "i"),
  },
  {
    id: "billing",
    reason: "Billing, seats and plan limits are not in v1 (the Console shows the design-beta sentence only)",
    path: word("billing", "seats", "plan-limits", "plan_limits"),
    spec: specWord("billing", "seats", "plan-limits", "plan_limits"),
  },
  {
    id: "autofill",
    reason: "Phone AutoFill providers are not in v1 (owner, 24 Oct); the phone Vault reads and copies",
    path: word("autofill", "auto-fill-provider", "credential-provider"),
    spec: specWord("autofill", "auto-fill-provider", "credential-provider") ,
  },
  {
    id: "passkeys",
    reason: "Vault passkeys, WebAuthn interception and passkey sign-in are not in v1 (owner, 24 Oct)",
    path: word("passkeys?", "webauthn", "vault-apple", "vault-android"),
    spec: new RegExp(specWord("passkeys?", "webauthn", "vault-apple", "vault-android").source + "|@simplewebauthn/|react-native-passkey", "i"),
  },
];

/** Roots the check reads (the layer packages and apps). Contracts, generated output, docs and manifests are not code. */
export const SCAN_ROOTS: readonly string[] = [
  "lib/", "kernel/", "host/", "sync/", "agent/", "sandbox/", "client/", "ui/", "apps/", "relay/", "kits/", "modules/", "connectors/", "testkit/", "local/",
];

/** Never scanned, even under a root: tests of this check name every forbidden word on purpose. */
export const SKIP: readonly RegExp[] = [/^scripts\/absence\//, /(^|\/)node_modules\//, /\.(md|json|png|svg|txt)$/];

const SOURCE = /\.(?:m?js|cjs|tsx?|jsx)$/;

/** Every import, export-from, dynamic import and require specifier in a source text. */
export function importSpecifiers(text: string): string[] {
  const out = new Set<string>();
  const res = [
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of res) for (const m of text.matchAll(re)) if (m[1] !== undefined) out.add(m[1]);
  return [...out];
}

export function inScope(path: string): boolean {
  return SCAN_ROOTS.some((root) => path.startsWith(root)) && !SKIP.some((re) => re.test(path));
}

/** Check files against the rules. Pure: the caller supplies paths and source texts. */
export function checkAbsence(files: readonly SourceFile[], rules: readonly AbsenceRule[] = RULES): AbsenceFinding[] {
  const found: AbsenceFinding[] = [];
  for (const file of files) {
    if (!inScope(file.path)) continue;
    for (const rule of rules) {
      if (rule.path.test(file.path)) found.push({ rule: rule.id, file: file.path, kind: "path", detail: file.path, reason: rule.reason });
      if (file.text === undefined || !SOURCE.test(file.path)) continue;
      for (const spec of importSpecifiers(file.text)) {
        if (rule.spec.test(spec)) found.push({ rule: rule.id, file: file.path, kind: "import", detail: spec, reason: rule.reason });
      }
    }
  }
  return found;
}

export function formatFindings(findings: readonly AbsenceFinding[]): string[] {
  return findings.map((f) => `not-in-v1 ${f.rule}: ${f.file} ${f.kind === "import" ? `imports "${f.detail}"` : "is a forbidden path"} (${f.reason})`);
}

export interface AdrIndexInput {
  /** File names directly under docs/adr/ (for example "0001-absence-checks.md"). */
  files: readonly string[];
  /** Text of docs/adr/README.md. */
  index: string;
}

const ADR_FILE = /^(\d{4})-[a-z0-9][a-z0-9-]*\.md$/;

/** The ADR index lists every ADR file, numbers are unique and contiguous from 0001, and no listed file is missing. */
export function checkAdrIndex(input: AdrIndexInput): string[] {
  const errors: string[] = [];
  const adrs = input.files.filter((f) => f !== "README.md").sort();
  const numbers: number[] = [];
  for (const file of adrs) {
    const m = ADR_FILE.exec(file);
    if (!m || m[1] === undefined) {
      errors.push(`adr: ${file} is not named NNNN-kebab-title.md`);
      continue;
    }
    numbers.push(Number(m[1]));
    if (!input.index.includes(`(${file})`)) errors.push(`adr: ${file} is not linked from docs/adr/README.md`);
  }
  numbers.forEach((n, i) => {
    if (n !== i + 1) errors.push(`adr: numbers must run 0001, 0002, ... without gaps or repeats (found ${String(n).padStart(4, "0")} at position ${i + 1})`);
  });
  for (const m of input.index.matchAll(/\]\(([^)\s]+\.md)\)/g)) {
    const target = m[1];
    if (target !== undefined && !target.includes("/") && !input.files.includes(target)) errors.push(`adr: README.md links ${target}, which does not exist`);
  }
  return errors;
}
