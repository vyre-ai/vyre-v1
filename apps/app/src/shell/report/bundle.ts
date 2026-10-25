// The bundle a report sends, built from what the rings hold (spec 5). Secrets are never captured; Restricted and sealed values are redacted by label.
// What the person previews in the sheet is this same object, so the preview cannot differ from what is sent.
import type { CapMap } from "../../../../../generated/types.ts";
import type { CapturedError, Snapshot } from "./ring.ts";

export type Bundle = CapMap["reports.submit"]["in"]["bundle"];
export type SubmitIn = CapMap["reports.submit"]["in"];
export type ReportContext = Bundle["context"];

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
  /\b(?:sk|pk|rk|xox[abprs]|ghp|gho|ghu|ghs|glpat|AKIA|AIza)[-_A-Za-z0-9]{12,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
  /\b(?:password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*\S+/gi,
  /\b[A-Fa-f0-9]{40,}\b/g,
];

export interface Scrubbed { text: string; removed: number }

/** Removes anything that looks like a credential from free text. Counted so the sheet can say how much was left out. */
export function scrubText(input: string): Scrubbed {
  let removed = 0;
  let text = input;
  for (const re of SECRET_PATTERNS) {
    text = text.replace(re, () => { removed += 1; return "[removed]"; });
  }
  return { text, removed };
}

export interface Capture {
  context: ReportContext;
  snapshot: Snapshot;
  versions: Bundle["versions"];
  note?: string;
  screenshotFileId?: string;
  clientLogFileId?: string;
}

export interface Built { bundle: Bundle; redactions: number }

/** Builds the bundle. `traceIds` is at most the last 20; errors keep their code and time, and their message unless it carries a Restricted value. */
export function buildBundle(c: Capture): Built {
  let redactions = 0;
  const errors: NonNullable<Bundle["errors"]> = [];
  for (const e of c.snapshot.errors.slice(-50)) {
    errors.push(redactError(e, (n) => { redactions += n; }));
  }
  const note = c.note?.trim() ? scrubText(c.note.trim().slice(0, 500)) : null;
  if (note) redactions += note.removed;
  const bundle: Bundle = {
    context: { place: c.context.place, ...(c.context.itemId ? { itemId: c.context.itemId } : {}), ...(c.context.hash ? { hash: c.context.hash } : {}) },
    traceIds: c.snapshot.traceIds.slice(-20),
    events: c.snapshot.events.slice(-50).map((e) => ({ type: e.type, at: e.at, ...(e.traceId ? { traceId: e.traceId } : {}) })),
    versions: { ...c.versions },
    ...(c.screenshotFileId ? { screenshotFileId: c.screenshotFileId } : {}),
    ...(errors.length ? { errors } : {}),
    ...(c.clientLogFileId ? { clientLogFileId: c.clientLogFileId } : {}),
    ...(note && note.text ? { note: note.text } : {}),
  };
  return { bundle, redactions };
}

function redactError(e: CapturedError, count: (n: number) => void): NonNullable<Bundle["errors"]>[number] {
  const base = { code: e.code, at: e.at, ...(e.traceId ? { traceId: e.traceId } : {}) };
  if (e.restricted) { count(1); return { ...base, message: `[Restricted: ${e.code}]` }; }
  const s = scrubText(e.message);
  count(s.removed);
  return { ...base, message: s.text };
}
