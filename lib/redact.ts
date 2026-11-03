// Redaction for AI (owner 3 Nov, rc.20): the pure part, shared by the files module, the host's read gate and the indexes.
// A file's redactions, highlights and comments are Vyre's own layer on one version of it; the file itself never changes. People see the original. An agent sees the literal [REDACTED] where a
// redaction is (text, a box's words, a transcript range, a piece of a name), highlights as plain ==context marks==, and never a comment.
// Nothing here reads a database or calls a model: the detectors are patterns and a list of names, and re-anchoring is text search with a little context.

export const REDACTED = "[REDACTED]";
/** Agent access on a folder or a file: Available, Redacted (agents read reviewed, redacted versions only) or Not available. Inherited down the tree; a file or subfolder can set its own. */
export type AgentAccess = "on" | "redact" | "off";
export const AGENT_ACCESS: readonly AgentAccess[] = ["on", "redact", "off"];
export const isAgentAccess = (v: unknown): v is AgentAccess => v === "on" || v === "redact" || v === "off";

/**
 * Who counts as an agent for the read gate: an agent, an outside actor (an API caller may be an AI), or any call an agent's machinery makes, whoever it runs as: the engine reading context as the
 * person, the agent's computer, the MCP door (a setup-grant call reruns as the person and keeps origin mcp), and the email and form helpers. A person's own screens are none of these.
 */
export const AGENT_ORIGINS: ReadonlySet<string> = new Set(["agent", "mcp", "engine", "computers", "email-ask", "forms-ask"]);
export function agentBound(c: { principal: { kind: string }; origin?: string | undefined; forAgent?: string | undefined }): boolean {
  return c.principal.kind === "agent" || c.principal.kind === "actor" || (c.origin !== undefined && AGENT_ORIGINS.has(c.origin)) || (typeof c.forAgent === "string" && c.forAgent !== "");
}

/**
 * One mark of the layer. `text` is what a span covers; a box or a transcript range keeps the words under it when they are known (on-server text recognition, the transcript line), so the text an
 * agent reads is redacted as well as the picture. `occurrence` picks one match of `text` (0 based); null means every match. A `name` mark is a piece of the file's own name.
 */
export interface Mark {
  id: string;
  kind: "redact" | "highlight";
  shape: "span" | "box" | "range" | "name";
  text?: string | null;
  occurrence?: number | null;
  page?: number | null;
  box?: { x: number; y: number; w: number; h: number } | null;
  from?: number | null;
  to?: number | null;
  label?: string | null;
}

/** Start offsets of every match of `needle` in `text`, left to right, not overlapping. */
export function occurrences(text: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let from = 0;
  for (;;) {
    const i = text.indexOf(needle, from);
    if (i < 0) return out;
    out.push(i);
    from = i + needle.length;
  }
}

type Span = [number, number];

/** Where marks of one kind sit in `text`. A mark whose chosen match is gone falls back to every match: a redaction never fails open because the text moved. */
function spansOf(text: string, marks: readonly Mark[], kind: Mark["kind"]): Span[] {
  const out: Span[] = [];
  for (const m of marks) {
    if (m.kind !== kind || m.shape === "name" || !m.text) continue;
    const at = occurrences(text, m.text);
    const k = m.occurrence;
    const pick = k !== null && k !== undefined && k >= 0 && k < at.length ? [at[k]!] : at;
    for (const s of pick) out.push([s, s + m.text.length]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

const inside = (spans: readonly Span[], a: number, b: number): boolean => spans.some(([s, e]) => s <= a && b <= e);

/**
 * The text an agent reads: every redaction becomes [REDACTED] (touching or overlapping ones become one), highlights are wrapped in ==...== when `highlights` is on (text kinds; a code file reads
 * without them), and nothing of a comment appears. Overlaps keep the redaction: a highlight around a redaction reads ==... [REDACTED] ...==.
 */
export function renderForAgent(text: string, marks: readonly Mark[], opts: { highlights?: boolean } = {}): string {
  const red = spansOf(text, marks, "redact");
  const hl = opts.highlights === false ? [] : spansOf(text, marks, "highlight");
  if (!red.length && !hl.length) return text;
  const cuts = new Set<number>([0, text.length]);
  for (const [s, e] of [...red, ...hl]) { cuts.add(s); cuts.add(e); }
  const pts = [...cuts].sort((a, b) => a - b);
  let out = "", inHl = false, lastRed = false;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    if (a === b) continue;
    const r = inside(red, a, b), h = inside(hl, a, b);
    if (h && !inHl) { out += "=="; inHl = true; lastRed = false; }
    if (!h && inHl) { out += "=="; inHl = false; lastRed = false; }
    if (r) { if (!lastRed) out += REDACTED; lastRed = true; }
    else { out += text.slice(a, b); lastRed = false; }
  }
  if (inHl) out += "==";
  return out;
}

/** Every match of every one of `texts`, longest first, in one string: for a diff line, a sheet cell, a snippet or a path, where one chosen match cannot be told apart. Fails closed. */
export function scrubAll(s: string, texts: readonly string[]): string {
  if (!s || !texts.length) return s;
  let out = s;
  for (const t of [...new Set(texts.filter((x) => x && x.length > 0))].sort((a, b) => b.length - a.length)) out = out.split(t).join(REDACTED);
  return out;
}

/** scrubAll over every string inside a value (objects and arrays copied, keys kept). */
export function scrubDeep<T>(v: T, texts: readonly string[]): T {
  if (!texts.length) return v;
  const walk = (x: unknown): unknown => {
    if (typeof x === "string") return scrubAll(x, texts);
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") { const o: Record<string, unknown> = {}; for (const [k, y] of Object.entries(x as Record<string, unknown>)) o[k] = walk(y); return o; }
    return x;
  };
  return walk(v) as T;
}

/** The redacted texts of a mark list, for scrubAll: spans, and the words under boxes and ranges. */
export const redactedTexts = (marks: readonly Mark[]): string[] => marks.filter((m) => m.kind === "redact" && m.shape !== "name" && m.text).map((m) => m.text!);

/** A file or folder name as an agent reads it: each hidden piece is [REDACTED]. */
export function agentName(name: string, marks: readonly Mark[]): string {
  return scrubAll(name, marks.filter((m) => m.kind === "redact" && m.shape === "name" && m.text).map((m) => m.text!));
}

// ---- detectors: pattern rules on the server, no model ----

export type DetectKind = "name" | "ssn" | "dob" | "account" | "phone" | "email" | "address";
export interface Suggestion { kind: DetectKind; label: string; text: string; count: number }

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
/** A date of birth: a date whose year is before 2010 (a date of an event this year is not one). */
const DOB = new RegExp(`\\b(?:\\d{1,2}/\\d{1,2}/(?:19\\d{2}|200\\d)|(?:19\\d{2}|200\\d)-\\d{2}-\\d{2}|(?:${MONTHS}) \\d{1,2}, (?:19\\d{2}|200\\d))\\b`, "g");
const RULES: { kind: DetectKind; label: string; re: RegExp }[] = [
  { kind: "ssn", label: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: "dob", label: "Date of birth", re: DOB },
  { kind: "account", label: "Account or case number", re: /\b(?:[A-Z]{2,4}-\d{4,5}-\d{3,6}|\d{4}-\d{4}-\d{4}(?:-\d{4})?|\d{2}-\d{7})\b/g },
  { kind: "phone", label: "Phone", re: /\(\d{3}\) \d{3}-\d{4}|\b\d{3}[ .-]\d{3}[ .-]\d{4}\b|\+\d{1,3} \d{2,4} \d{3,4} \d{3,4}\b/g },
  { kind: "email", label: "Email", re: /\b[\w.+-]+@[\w-]+(?:\.[a-z]{2,})+\b/g },
  { kind: "address", label: "Address", re: /\b\d{1,5} [A-Z][a-z]+(?: [A-Z][a-z]+)? (?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|Way)\b(?:,? (?:Apt|Apartment|Suite|Unit|#) ?\w+)?/g },
];

/**
 * Things in `text` a person may want hidden from AI: names from the Space's Records, then SSNs, dates of birth, account and case numbers, phones, emails and addresses. Each text is suggested once,
 * with how often it appears; `skip` (already redacted, or skipped) is left out. Patterns only: no AI reads the file to make these.
 */
export function detect(text: string, opts: { names?: readonly string[]; skip?: readonly string[] } = {}): Suggestion[] {
  const out: Suggestion[] = [], skip = new Set(opts.skip ?? []);
  const add = (kind: DetectKind, label: string, t: string): void => {
    const v = t.trim();
    if (v.length < 3 || skip.has(v) || out.some((o) => o.text === v)) return;
    const count = occurrences(text, v).length;
    if (count) out.push({ kind, label, text: v, count });
  };
  const names = opts.names ?? [];
  for (const n of names) if (n.trim().includes(" ") || n.trim().length >= 4) add("name", "Name", n);
  for (const d of builtFromNames(text, names)) add(d.kind, d.label, d.text);
  for (const r of RULES) { r.re.lastIndex = 0; let m: RegExpExecArray | null; while ((m = r.re.exec(text))) add(r.kind, r.label, m[0]); }
  return out;
}

/** An email, handle, web address or user name: a run of word characters joined by . _ - + @ / : that a name can hide inside. */
const IDENT = /[\p{L}\p{N}][\p{L}\p{N}._+@/:-]*[\p{L}\p{N}]/gu;
const EMAIL = /^[\w.+-]+@[\w-]+(?:\.[a-z]{2,})+$/i;

/**
 * Identifiers built from a name: an email, a handle or a user name that carries a piece of a name (elena.rivera@fastmail.example beside a redacted Elena Rivera, @erivera, rivera_e). Hiding the
 * name and leaving these gives the name away, so they are suggested for review with the name. A piece is a word of a name of three letters or more; a bare piece, or a piece with only 's after
 * it, is the name itself (the name rule covers it), and a piece inside an ordinary word only counts when the word is joined by an identifier mark or a digit.
 */
export function builtFromNames(text: string, names: readonly string[]): { kind: DetectKind; label: string; text: string }[] {
  const pieces = [...new Set(names.flatMap((n) => n.toLowerCase().split(/[^\p{L}]+/u)).filter((p) => [...p].length >= 3))];
  if (pieces.length === 0) return [];
  const out: { kind: DetectKind; label: string; text: string }[] = [];
  IDENT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IDENT.exec(text))) {
    const t = m[0], low = t.toLowerCase();
    if (pieces.includes(low) || pieces.some((p) => low === `${p}'s`)) continue;
    const joined = /[._+@/:\d-]/.test(t);
    const hit = pieces.some((p) => low.includes(p) && (joined || [...p].length >= 4));
    if (!hit) continue;
    // a capitalised word that merely starts or ends with a name piece (Riverside) is a word, not an identifier
    if (!joined && /^\p{Lu}\p{Ll}+$/u.test(t)) continue;
    if (out.some((o) => o.text === t)) continue;
    out.push(EMAIL.test(t) ? { kind: "email", label: "Email with a name in it", text: t } : { kind: "name", label: "Built from a name", text: t });
  }
  return out;
}

/** What a detector would call a span a person picked: the label the hover card shows. Agents never see it. */
export function classify(t: string, names: readonly string[] = []): string {
  if (names.includes(t.trim())) return "Name";
  for (const r of RULES) { r.re.lastIndex = 0; const m = r.re.exec(t); if (m && m[0].length === t.trim().length) return r.label; }
  return "Text";
}

// ---- re-anchoring on a new version ----

const commonSuffix = (a: string, b: string): number => { let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n; };
const commonPrefix = (a: string, b: string): number => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };
const CONTEXT = 32;

/**
 * Carry marks from one version's text to the next. A mark whose text is still there is placed (a chosen match moves to the match whose surroundings fit best); a mark whose text is gone, or a box
 * with no words under it (its place on a new picture cannot be known), is unplaced. Unplaced redactions send the file back to Needs review: agents wait until a person places or drops them.
 */
export function reanchor(oldText: string, newText: string, marks: readonly Mark[]): { placed: Mark[]; unplaced: Mark[] } {
  const placed: Mark[] = [], unplaced: Mark[] = [];
  for (const m of marks) {
    if (m.shape === "name") { placed.push(m); continue; }
    if (!m.text) { (m.kind === "redact" ? unplaced : placed).push(m); continue; }
    const now = occurrences(newText, m.text);
    if (!now.length) { unplaced.push(m); continue; }
    const k = m.occurrence;
    if (k === null || k === undefined) { placed.push(m); continue; }
    const before = occurrences(oldText, m.text);
    const at = before[Math.min(Math.max(k, 0), Math.max(before.length - 1, 0))];
    if (at === undefined) { placed.push({ ...m, occurrence: null }); continue; }
    const left = oldText.slice(Math.max(0, at - CONTEXT), at), right = oldText.slice(at + m.text.length, at + m.text.length + CONTEXT);
    let best = 0, score = -1;
    now.forEach((p, j) => {
      const s = commonSuffix(left, newText.slice(Math.max(0, p - CONTEXT), p)) + commonPrefix(right, newText.slice(p + m.text!.length, p + m.text!.length + CONTEXT)) - Math.abs(j - k) * 0.01;
      if (s > score) { score = s; best = j; }
    });
    placed.push({ ...m, occurrence: best });
  }
  return { placed, unplaced };
}
