// from vyre 0.6.9 core/transcripts/links.js@dbd2dfbab
// What a turn touched, found without a model: a tool call's file, a commit's hash, a url. A link is a plain lookup key (kind, ref) hung on a turn, so
// "every turn that touched auth.ts" and "the turn that made commit a1b2c3d" are an index read, not a search. Deliberately not a graph walk.
import { redact } from "./sanitize.ts";
import type { Link } from "./types.ts";

/** At most this many links hang on one turn: a turn that touched a thousand files is not more findable for it. */
export const LINKS_PER_TURN = 40;
/** The link kinds, in the order a pointer line lists them. */
export const LINK_KINDS = ["file", "read", "commit", "url"] as const;
const CHANGES = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
/** A git commit hash worth keeping: 7 to 40 hex characters with at least one digit and one letter, so a plain number or a word cut from prose is not one. */
const hashOk = (h: string): boolean => /^[0-9a-f]{7,40}$/.test(h) && /\d/.test(h) && /[a-f]/.test(h);
const COMMIT_WORD = /\bcommit(?:ted|s)?\s+`?([0-9a-f]{7,40})`?(?![0-9A-Za-z])/gi;
const COMMIT_BRACKET = /\[[\w./@+-]+(?: \(root-commit\))? ([0-9a-f]{7,40})\]/g;
const URL_RE = /https?:\/\/[^\s<>"'`)\]]{4,300}/g;

/** A path as a link's ref: relative to the session's folder when it is inside it, so the same file is one ref whichever way a tool spelled it. */
export function pathRef(p: unknown, cwd: string | null): string {
  let r = String(p ?? "").trim();
  if (!r) return "";
  if (cwd) {
    const base = cwd.endsWith("/") ? cwd : `${cwd}/`;
    if (r.startsWith(base)) r = r.slice(base.length);
  }
  return r.slice(0, 300);
}

/** The links one tool call makes, from its name and input. */
export function toolLinks(name: string, input: unknown, cwd: string | null): Link[] {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: Link[] = [];
  if (CHANGES.has(name)) {
    const r = pathRef(i["file_path"] ?? i["notebook_path"] ?? i["path"], cwd);
    if (r) out.push({ kind: "file", ref: r });
  } else if (name === "Read") {
    const r = pathRef(i["file_path"], cwd);
    if (r) out.push({ kind: "read", ref: r });
  } else if (name === "WebFetch" && typeof i["url"] === "string") out.push({ kind: "url", ref: i["url"].slice(0, 300) });
  return out;
}

/** The links a turn's own words make: commits it names and urls it quotes. */
export function textLinks(text: string): Link[] {
  const out: Link[] = [];
  const seen = new Set<string>();
  const add = (kind: Link["kind"], ref: string): void => {
    const k = `${kind}\0${ref}`;
    if (!seen.has(k)) { seen.add(k); out.push({ kind, ref }); }
  };
  for (const re of [COMMIT_WORD, COMMIT_BRACKET]) {
    for (const m of text.matchAll(re)) {
      const h = (m[1] ?? "").toLowerCase();
      if (hashOk(h)) add("commit", h);
    }
  }
  for (const m of text.matchAll(URL_RE)) add("url", m[0].replace(/[.,;:!?]+$/, ""));
  return out;
}

/** The commits a `git commit` printed in its result: "[main a1b2c3d] message". */
export function commitLinks(output: string): Link[] {
  const out: Link[] = [];
  for (const m of String(output ?? "").matchAll(COMMIT_BRACKET)) {
    const h = (m[1] ?? "").toLowerCase();
    if (hashOk(h)) out.push({ kind: "commit", ref: h });
  }
  return out;
}

/** A tool result's text, whichever way a CLI shaped it. */
export function resultText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p: unknown) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("\n");
  return "";
}

/** Keep a turn's links clean: a ref that a redaction rule would change is dropped whole (half a secret is still a secret), duplicates go, and the count is capped. */
export function cleanLinks(links: readonly Link[]): Link[] {
  const seen = new Set<string>();
  const out: Link[] = [];
  for (const l of links) {
    if (!l || !l.ref || out.length >= LINKS_PER_TURN) continue;
    const k = `${l.kind}\0${l.ref}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (redact(l.ref).text !== l.ref) continue;
    out.push({ kind: l.kind, ref: l.ref });
  }
  return out;
}
