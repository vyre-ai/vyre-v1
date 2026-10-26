// The review surfaces without a renderer (spec 3.5 Files, 2.16 Changesets, 2.14 History): the words of the changeset header, when approve is blocked by a protected branch's gate,
// how a capability's diff becomes the hunks ui/DiffTab draws, how versions become ui/HistoryTab rows, what the lint bar shows, and the small agent.toml reader behind the Form view.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { DiffBody, DiffComment, DiffFile, DiffHunk } from "../../../../../../ui/src/DiffTab/index.tsx";
import type { HistoryVersion } from "../../../../../../ui/src/HistoryTab/index.tsx";

export type ChangesetOut = CapMap["changesets.get"]["out"];
export type Changeset = ChangesetOut["changeset"];
export type ChangesetFile = ChangesetOut["files"][number];
export type StatusOut = CapMap["git.status"]["out"];
export type BranchesOut = CapMap["git.list_branches"]["out"];
export type BranchRow = BranchesOut["branches"][number];
export type DiffOut = CapMap["files.diff"]["out"];
export type RawHunk = DiffOut["hunks"][number];
export type VersionRow = CapMap["files.versions"]["out"]["versions"][number];
export type LintOut = CapMap["files.lint"]["out"];
export type CommentRow = CapMap["changesets.comments.list"]["out"]["comments"][number];

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/* ---------- the changeset header ---------- */

/** "Docs changed 3 files": who made the changes and how many files. */
export function changedLine(by: string, fileCount: number): string {
  return `${by} changed ${plural(fileCount, "file", "files")}`;
}

/** The totals under the title: "+42 -9" as two words, the minus sign is the real one. */
export function totalsWords(added: number, removed: number): { added: string; removed: string } {
  return { added: `+${added}`, removed: `−${removed}` };
}

/** Only an open changeset (or one sent back and edited again) can be approved, discarded or sent back. */
export function isOpen(state: Changeset["state"]): boolean {
  return state === "open" || state === "changes_requested";
}

/** What the header says once the changeset is no longer open. */
export function settledWords(cs: Pick<Changeset, "state">): string {
  if (cs.state === "approved") return "Committed. These changes are in the folder now.";
  if (cs.state === "discarded") return "Discarded. Nothing was changed.";
  if (cs.state === "changes_requested") return "Sent back. The agent is working on your notes.";
  return "";
}

/** The line under the title: what version the changes are based on, and what happens if a file moved on since. */
export function baseLine(cs: Pick<Changeset, "baseVersion">): string {
  return cs.baseVersion
    ? `Based on version ${cs.baseVersion} of each file. If a file changed since, Vyre merges both edits in three parts (base, theirs, yours) and asks only where the same lines changed.`
    : "";
}

export const APPROVE_LABEL = "Approve and commit";

/** The label with the number of unsent comments: "Request changes (2)". */
export function requestLabel(unsent: number): string {
  return unsent > 0 ? `Request changes (${unsent})` : "Request changes";
}

/* ---------- the gate on a protected branch ---------- */

export type GateState = "waiting" | "cleared" | "cancelled";

export interface GateView { branch: string; state: GateState }

/** A protected branch is not pushed to without the Gate: the row shows while the folder is a repository on a protected branch. */
export function needsGate(status: Pick<StatusOut, "isRepo" | "protected"> | undefined): boolean {
  return status !== undefined && status.isRepo && status.protected;
}

export function gateWords(g: GateView): string {
  if (g.state === "cleared") return `Push to ${g.branch} is approved`;
  if (g.state === "cancelled") return `Push to ${g.branch} was cancelled`;
  return `Push to ${g.branch} waits for approval in Needs you`;
}

/** Approve is blocked while the gate waits. A folder with no protected branch has no gate and is never blocked. */
export function approveBlocked(gate: GateView | null): boolean {
  return gate !== null && gate.state !== "cleared";
}

export function blockedReason(gate: GateView | null): string {
  if (gate === null || gate.state === "cleared") return "";
  return gate.state === "cancelled" ? `Approve the push to ${gate.branch} first, or commit without pushing` : `Waiting for the Gate on ${gate.branch}`;
}

/* ---------- the git row ---------- */

/** "main" with what is ahead or behind: "2 ahead, 1 behind". */
export function aheadBehind(s: Pick<StatusOut, "ahead" | "behind">): string {
  const parts: string[] = [];
  if (s.ahead > 0) parts.push(`${s.ahead} ahead`);
  if (s.behind > 0) parts.push(`${s.behind} behind`);
  return parts.join(", ");
}

export function changesWords(s: Pick<StatusOut, "changes" | "clean">): string {
  return s.clean || s.changes.length === 0 ? "No changes" : plural(s.changes.length, "change", "changes");
}

/** The branches to switch to: local ones first, the current one marked. */
export function branchChoices(b: BranchesOut): readonly { name: string; current: boolean; protected: boolean; remote: boolean }[] {
  const local = b.branches.filter((x) => !x.remote);
  const remote = b.branches.filter((x) => x.remote && !local.some((l) => l.name === x.name));
  return [...local, ...remote].map((x) => ({ name: x.name, current: x.name === b.current, protected: x.protected, remote: x.remote }));
}

/* ---------- diffs ---------- */

function bodyOf(kind: DiffOut["kind"]): DiffBody {
  return kind === "binary" ? "text" : kind;
}

/** A capability's hunk as the hunk ui/DiffTab draws: the unchanged lines above and below are context, the rest is removed and added. */
export function hunkOf(h: RawHunk): DiffHunk {
  const lines = h.lines;
  let from = 0;
  while (from < lines.length && lines[from]?.op === "ctx") from++;
  let to = lines.length;
  while (to > from && lines[to - 1]?.op === "ctx") to--;
  const text = (ls: readonly { text: string }[]): string => ls.map((l) => l.text).join("\n");
  const mid = lines.slice(from, to);
  const before = text(lines.slice(0, from));
  const after = text(lines.slice(to));
  return {
    id: h.hunkId,
    context: `Line ${h.newStart}`,
    removed: text(mid.filter((l) => l.op !== "add")),
    added: text(mid.filter((l) => l.op !== "del")),
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  };
}

/** One file's diff out of files.diff, changesets.diff or git.show. An image has no lines: its two addresses ride in the one hunk, removed (before) and added (after). */
export function diffFileOf(path: string, out: Pick<DiffOut, "kind" | "added" | "removed" | "hunks"> & { images?: DiffOut["images"] }): DiffFile {
  const body = bodyOf(out.kind);
  const hunks: DiffHunk[] = body === "image" && out.images
    ? [{ id: `${path}:image`, context: "Image", removed: out.images.left ?? "", added: out.images.right ?? "" }]
    : out.hunks.map(hunkOf);
  return { path, added: out.added, removed: out.removed, body, hunks };
}

/** The files of a commit (git.show gives one list of hunks for the whole commit, so they go to the file they belong to when there is one file, else to the first). */
export function commitFiles(show: CapMap["git.show"]["out"], onlyPath?: string): DiffFile[] {
  const files = onlyPath ? show.files.filter((f) => f.path === onlyPath) : show.files;
  return files.map((f, i): DiffFile => ({ path: f.path, added: f.added, removed: f.removed, body: "text", hunks: i === 0 ? show.hunks.map(hunkOf) : [] }));
}

/** The comments of a changeset placed on a hunk: the one whose text holds the quote, else the file's first change. */
export function commentsOf(rows: readonly CommentRow[], files: readonly DiffFile[], nameOf: (id: string) => string): DiffComment[] {
  const out: DiffComment[] = [];
  for (const c of rows) {
    const file = files.find((f) => f.path === c.anchor.path) ?? files[0];
    if (!file) continue;
    const quote = c.anchor.quote;
    const hit = quote ? file.hunks.find((h) => h.added.includes(quote) || h.removed.includes(quote)) : undefined;
    const hunk = hit ?? file.hunks[0];
    if (!hunk) continue;
    out.push({ id: c.commentId, hunkId: hunk.id, author: nameOf(c.by), body: c.text, mentions: c.mentions.map(nameOf) });
  }
  return out;
}

/* ---------- history ---------- */

/** The versions of a file as ui/HistoryTab rows. A version is undoable only while it is the current one. */
export function historyVersions(rows: readonly VersionRow[], nameOf: (id: string) => string): HistoryVersion[] {
  const top = rows.reduce((n, r) => Math.max(n, r.n), 0);
  return rows.map((r): HistoryVersion => ({
    id: r.versionId, n: r.n, who: nameOf(r.by), why: r.name ?? r.reason ?? "", at: new Date(r.at).toISOString(), runId: null, undoable: r.n === top,
  }));
}

/** Naming a version: an empty name clears it. */
export function nameInput(fileId: string, versionId: string, name: string): { fileId: string; versionId: string; name: string } {
  return { fileId, versionId, name: name.trim() };
}

/* ---------- the lint bar ---------- */

export type Sev = "ok" | "warn" | "err" | "info";
export interface LintPlace { line: number; msg: string }
export interface LintItem { k: string; sev: Sev; label: string; tip: string; line: number; list: readonly LintPlace[] }

export const LINE_LIMITS: Readonly<Record<LintOut["file"], number | null>> = { vyre_md: 120, agent_md: 150, agent_toml: null, routine_prompt: 150, other: null };

/** What the bar shows: lines against the limit, Inherits VYRE.md, Override: lines, a secret scan, and any other problem the check found. */
export function lintItems(out: LintOut): LintItem[] {
  const items: LintItem[] = [];
  const limit = LINE_LIMITS[out.file];
  if (limit !== null) {
    const sev: Sev = out.lines > 200 ? "err" : out.lines > limit ? "warn" : "ok";
    items.push({ k: "len", sev, label: `${out.lines} / ${limit} lines`, line: Math.min(out.lines, limit + 1), list: [], tip: out.lines > 200 ? "Over 200 lines is an error" : out.lines > limit ? `Over ${limit} lines: move steps into a skill or knowledge/` : `Limit ${limit} lines` });
  } else items.push({ k: "len", sev: "ok", label: plural(out.lines, "line", "lines"), line: 1, list: [], tip: "" });
  if (out.file === "agent_md") {
    items.push({ k: "inherits", sev: out.inherits ? "ok" : "warn", label: out.inherits ? "Inherits VYRE.md" : "Does not say it inherits VYRE.md", line: 1, list: [], tip: "Say 'Inherits VYRE.md' near the top" });
  }
  if (out.file === "agent_md" || out.file === "vyre_md") {
    const list = out.overrides.map((o): LintPlace => ({ line: o.line, msg: o.text }));
    items.push({ k: "overrides", sev: list.length ? "info" : "ok", label: list.length ? plural(list.length, "override", "overrides") : "No overrides", line: list[0]?.line ?? 1, list, tip: "Only an Override: line may loosen a VYRE.md rule" });
  }
  const secrets = out.secrets.map((s): LintPlace => ({ line: s.line, msg: `Possible ${s.kind}` }));
  items.push({ k: "secrets", sev: secrets.length ? "err" : "ok", label: secrets.length ? plural(secrets.length, "possible secret", "possible secrets") : "No secrets", line: secrets[0]?.line ?? 1, list: secrets, tip: "Never put a secret in a file; use the vault key name" });
  const problems = out.problems;
  const list = problems.map((p): LintPlace => ({ line: p.line ?? 1, msg: p.message }));
  const errs = problems.filter((p) => p.severity === "error").length;
  const warns = problems.filter((p) => p.severity === "warn").length;
  if (out.file === "agent_toml") {
    const label = errs ? plural(errs, "schema error", "schema errors") : warns ? `Schema valid, ${plural(warns, "warning", "warnings")}` : "Schema valid";
    items.push({ k: "schema", sev: errs ? "err" : warns ? "warn" : "ok", label, line: list[0]?.line ?? 1, list, tip: "Unknown keys warn, they never crash" });
  } else if (problems.length) {
    items.push({ k: "problems", sev: errs ? "err" : warns ? "warn" : "info", label: plural(problems.length, "problem", "problems"), line: list[0]?.line ?? 1, list, tip: "" });
  }
  return items;
}

/** The lines a press on a lint item can jump to: one place jumps, several open a menu. */
export function jumpLabel(p: LintPlace): string {
  return `Line ${p.line}: ${p.msg}`;
}

/** A red check blocks the save; amber saves after the person accepts the warnings. */
export function saveBlocked(out: LintOut | undefined): boolean {
  return out?.state === "red";
}

/* ---------- agent.toml, Form view ---------- */

export interface TomlEntry {
  /** 1-based line of the key. */
  line: number;
  /** Last line of the value (a list can run over several). */
  end: number;
  section: string;
  key: string;
  raw: string;
}

export type TomlKind = "string" | "number" | "bool" | "list" | "other";

export function tomlKind(raw: string): TomlKind {
  const v = raw.trim();
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2 && !v.startsWith('"""')) return "string";
  if (v === "true" || v === "false") return "bool";
  if (/^-?\d[\d_]*(\.\d+)?$/.test(v)) return "number";
  if (v.startsWith("[")) return "list";
  return "other";
}

const depth = (s: string): number => {
  let d = 0;
  let q = false;
  for (const ch of s) {
    if (ch === '"') q = !q;
    else if (!q && ch === "[") d++;
    else if (!q && ch === "]") d--;
  }
  return d;
};

/** The keys of a TOML file by section, with the line each sits on. A list that runs over several lines is one entry. Comments and blank lines are skipped. */
export function parseToml(text: string): TomlEntry[] {
  const lines = text.split("\n");
  const out: TomlEntry[] = [];
  let section = "";
  for (let i = 0; i < lines.length; i++) {
    const l = (lines[i] ?? "").trim();
    if (!l || l.startsWith("#")) continue;
    const head = /^\[\[?([^\]]+)\]\]?\s*(#.*)?$/.exec(l);
    if (head) { section = (head[1] ?? "").trim() + (l.startsWith("[[") ? "[]" : ""); continue; }
    const kv = /^([A-Za-z0-9_.-]+|"[^"]*")\s*=\s*(.*)$/.exec(l);
    if (!kv) continue;
    let raw = (kv[2] ?? "").replace(/\s+#[^"]*$/, "").trim();
    let end = i + 1;
    if (raw.startsWith("[") && depth(raw) > 0) {
      while (depth(raw) > 0 && end < lines.length) { raw += ` ${(lines[end] ?? "").trim()}`; end++; }
    }
    out.push({ line: i + 1, end, section, key: (kv[1] ?? "").replaceAll('"', ""), raw });
    i = end - 1;
  }
  return out;
}

/** Entries grouped by section, in file order. */
export function tomlGroups(entries: readonly TomlEntry[]): { section: string; entries: TomlEntry[] }[] {
  const groups: { section: string; entries: TomlEntry[] }[] = [];
  for (const e of entries) {
    const g = groups.find((x) => x.section === e.section);
    if (g) g.entries.push(e); else groups.push({ section: e.section, entries: [e] });
  }
  return groups;
}

/** The value as the Form shows it: a string without its quotes, the rest as written. */
export function formValue(raw: string): string {
  return tomlKind(raw) === "string" ? raw.trim().slice(1, -1).replaceAll('\\"', '"') : raw.trim();
}

/** The value the Form writes back: a string gets its quotes again. */
export function rawFromForm(kind: TomlKind, value: string): string {
  return kind === "string" ? `"${value.replaceAll('"', '\\"')}"` : value.trim();
}

/** Replace the value of the entry at a line, keeping the key, its indent and the lines around it. */
export function setTomlValue(text: string, entry: TomlEntry, raw: string): string {
  const lines = text.split("\n");
  const old = lines[entry.line - 1] ?? "";
  const indent = /^\s*/.exec(old)?.[0] ?? "";
  lines.splice(entry.line - 1, entry.end - entry.line + 1, `${indent}${entry.key} = ${raw}`);
  return lines.join("\n");
}

/* ---------- the diff before a save ---------- */

const MAX_CELLS = 400_000;
const CONTEXT = 2;

/** The hunks between the saved text and the draft, by line, with two unchanged lines of context on each side. */
export function lineHunks(saved: string, draft: string): DiffHunk[] {
  if (saved === draft) return [];
  const a = saved.split("\n");
  const b = draft.split("\n");
  type Op = { op: "ctx" | "del" | "add"; text: string };
  let ops: Op[];
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    ops = [...a.map((text): Op => ({ op: "del", text })), ...b.map((text): Op => ({ op: "add", text }))];
  } else {
    const w = b.length + 1;
    const t = new Uint32Array((a.length + 1) * w);
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        t[i * w + j] = a[i] === b[j] ? (t[(i + 1) * w + j + 1] ?? 0) + 1 : Math.max(t[(i + 1) * w + j] ?? 0, t[i * w + j + 1] ?? 0);
      }
    }
    ops = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { ops.push({ op: "ctx", text: a[i] ?? "" }); i++; j++; }
      else if ((t[(i + 1) * w + j] ?? 0) >= (t[i * w + j + 1] ?? 0)) { ops.push({ op: "del", text: a[i] ?? "" }); i++; }
      else { ops.push({ op: "add", text: b[j] ?? "" }); j++; }
    }
    while (i < a.length) ops.push({ op: "del", text: a[i++] ?? "" });
    while (j < b.length) ops.push({ op: "add", text: b[j++] ?? "" });
  }
  const hunks: DiffHunk[] = [];
  let at = 0;
  let newLine = 1;
  const newLineAt: number[] = [];
  for (const o of ops) { newLineAt.push(newLine); if (o.op !== "del") newLine++; }
  while (at < ops.length) {
    if (ops[at]?.op === "ctx") { at++; continue; }
    let end = at;
    while (end < ops.length && ops[end]?.op !== "ctx") end++;
    const lead = ops.slice(Math.max(0, at - CONTEXT), at).filter((o) => o.op === "ctx");
    const trail = ops.slice(end, end + CONTEXT).filter((o) => o.op === "ctx");
    const mid = ops.slice(at, end);
    const text = (ls: readonly Op[]): string => ls.map((l) => l.text).join("\n");
    const before = text(lead);
    const after = text(trail);
    hunks.push({
      id: `h${hunks.length + 1}`, context: `Line ${newLineAt[at] ?? 1}`,
      removed: text(mid.filter((o) => o.op === "del")), added: text(mid.filter((o) => o.op === "add")),
      ...(before ? { before } : {}), ...(after ? { after } : {}),
    });
    at = end;
  }
  return hunks;
}

export function draftDiff(path: string, saved: string, draft: string): DiffFile {
  const hunks = lineHunks(saved, draft);
  const count = (s: string): number => (s ? s.split("\n").length : 0);
  return { path, added: hunks.reduce((n, h) => n + count(h.added), 0), removed: hunks.reduce((n, h) => n + count(h.removed), 0), body: "text", hunks };
}

/* ---------- words for a failed press ---------- */

/** A capability's error code as a sentence. The code is never shown. */
export function errorWords(e: unknown, what: string): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "validation.conflict") return `Someone changed this first. Reload and try ${what} again.`;
  if (code === "auth.forbidden" || code === "auth.denied") return `You cannot ${what} here.`;
  if (code === "validation.precondition_failed") return `That is no longer possible, so ${what} did not happen.`;
  return `Could not ${what}. Try again.`;
}
