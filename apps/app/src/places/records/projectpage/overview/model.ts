// The project Overview page: the pure parts. What a live block is called and what it can be set to, how a page's properties, history and an agent's edit read in words, and the ops that change them.
// The page itself is the shared Markdown editor with live blocks (ui/src/RichEditor); the server keeps it as blocks and revisions (projects.overview_doc.*).
import type { CapMap } from "../../../../../../../generated/types.ts";

export type OverviewDoc = CapMap["projects.overview_doc.get"]["out"];
export type LiveOut = CapMap["projects.live_block.query"]["out"];
export type LiveRowOut = LiveOut["rows"][number];
export type PageTemplate = CapMap["projects.overview_doc.templates.list"]["out"]["templates"][number];
export type Revision = CapMap["projects.overview_doc.history"]["out"]["revisions"][number];
export type Property = OverviewDoc["properties"][number];
export type LiveType = LiveOut["type"];

export type View = "list" | "table" | "count" | "cards";
export const VIEWS: readonly { id: View; label: string }[] = [{ id: "list", label: "List" }, { id: "table", label: "Table" }, { id: "cards", label: "Cards" }, { id: "count", label: "Count" }];

export interface LiveKind { type: LiveType; label: string; note: string; views: readonly View[]; defaultView: View; spec: () => Record<string, unknown> }
/** The kinds of live block in the order the "/" menu offers them. `spec` is what a new one starts with. */
export const LIVE_KINDS: readonly LiveKind[] = [
  { type: "tasks", label: "Tasks", note: "The project's tasks, filtered", views: ["list", "table", "cards", "count"], defaultView: "list", spec: () => ({ title: "Open tasks", status: "open" }) },
  { type: "milestones", label: "Milestones", note: "What is due next", views: ["list", "table", "cards"], defaultView: "list", spec: () => ({ title: "Next milestones", limit: 3 }) },
  { type: "links", label: "Linked items", note: "Mail, files, pull requests and more", views: ["list", "table", "cards", "count"], defaultView: "list", spec: () => ({ title: "Linked" }) },
  { type: "records", label: "Records", note: "Rows of one record type", views: ["table", "list", "cards", "count"], defaultView: "table", spec: () => ({ title: "Records", type: "" }) },
  { type: "metric", label: "Metric", note: "A count or a sum", views: ["count"], defaultView: "count", spec: () => ({ title: "Count", type: "", op: "count" }) },
  { type: "ci", label: "CI status", note: "The latest checks", views: ["list", "table", "count"], defaultView: "list", spec: () => ({ title: "CI runs" }) },
  { type: "goal", label: "Goal progress", note: "The project's goals", views: ["list", "cards"], defaultView: "list", spec: () => ({ title: "Goal" }) },
  { type: "people", label: "People and agents", note: "Who is on the project", views: ["list", "cards"], defaultView: "list", spec: () => ({ title: "People and agents" }) },
  { type: "status", label: "Status update", note: "Health, open and late work", views: ["list"], defaultView: "list", spec: () => ({ title: "Status" }) },
];
export const kindOf = (type: string): LiveKind | undefined => LIVE_KINDS.find((k) => k.type === type);

export interface Choice { id: string; label: string }
/** The settings a kind of live block has, besides its title and view: each is one field of its spec and a list of choices. */
export const SPEC_CHOICES: Readonly<Partial<Record<LiveType, readonly { key: string; label: string; choices: readonly Choice[] }[]>>> = {
  tasks: [{ key: "status", label: "Show tasks that are", choices: [{ id: "open", label: "open" }, { id: "late", label: "late" }, { id: "done", label: "done" }, { id: "all", label: "any" }] }],
  links: [{ key: "kind", label: "Kind of link", choices: [{ id: "", label: "any" }, { id: "mail_thread", label: "mail" }, { id: "github.pr", label: "pull requests" }, { id: "calendar_event", label: "events" }, { id: "file", label: "files" }, { id: "record", label: "records" }] }],
  metric: [{ key: "op", label: "Measure", choices: [{ id: "count", label: "Count" }, { id: "sum", label: "Sum" }] }],
};

/** What a live block is called on the page: its own title, else its kind. */
export const liveTitle = (type: string, spec: unknown): string => {
  const t = (spec as { title?: unknown } | null)?.title;
  return typeof t === "string" && t.trim() !== "" ? t.trim() : kindOf(type)?.label ?? "Live block";
};

/** Whether a live block has what it needs to show anything (a records or metric block needs a record type; a sum needs its field). */
export function liveReady(type: string, spec: unknown): boolean {
  const s = (spec ?? {}) as Record<string, unknown>;
  if (type === "records" || type === "metric") { if (typeof s["type"] !== "string" || s["type"] === "") return false; }
  if (type === "metric" && s["op"] === "sum" && (typeof s["field"] !== "string" || s["field"] === "")) return false;
  return true;
}

/** "3 tasks", "1 task", with what the reader may not open: "3 tasks, 2 you can't open". */
export function countLine(out: Pick<LiveOut, "rows" | "hidden" | "total">, noun: string): string {
  const shown = out.rows.length;
  const hid = out.hidden > 0 ? `, ${out.hidden} you can't open` : "";
  return `${shown} ${shown === 1 ? noun : `${noun}s`}${hid}`;
}

/** The line under a list that hides rows from the reader. */
export const hiddenLine = (n: number): string => `${n} more you can't open`;

/* ---------- properties ---------- */

/** A property's value as the page shows it. */
export function propertyText(p: Pick<Property, "type" | "value">): string {
  const v = p.value;
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** The value a typed field of a property becomes: numbers are numbers, an empty field is cleared. */
export function propertyValue(type: string, text: string): unknown {
  const t = text.trim();
  if (t === "") return null;
  if (type === "number" || type === "currency") { const n = Number(t.replace(/[,$\s]/g, "")); return Number.isFinite(n) ? n : t; }
  if (type === "boolean") return /^(yes|true|1)$/i.test(t);
  return t;
}

export const propertyOp = (key: string, value: unknown): { op: "set_property"; key: string; value: unknown } => ({ op: "set_property", key, value });

/* ---------- history and an agent's edit ---------- */

const STAMP = (at: number): string => new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const when = (at: number, now: number): string => {
  const mins = Math.floor((now - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return STAMP(at);
};

/** The line of one version: what changed, by whom, when. `who` says the author's name (or "you"). */
export function revisionLine(r: Revision, who: string, now: number): { title: string; note: string } {
  const title = r.undoOf !== undefined ? `Undid version ${r.undoOf}` : capital(r.summary);
  return { title, note: `Edited by ${who}${r.authorKind === "agent" ? " (Agent)" : ""} · ${when(r.at, now)}` };
}
const capital = (s: string): string => (s === "" ? "Edited the page" : s.charAt(0).toUpperCase() + s.slice(1));

/** The quiet bar after an agent edited the page: who and what, with Undo. Null when the latest change is not an agent's, is an undo, or was the reader's own. */
export function agentNotice(latest: OverviewDoc["latest"], me: string | undefined, name: (id: string) => string): { text: string; rev: number } | null {
  if (!latest || latest.authorKind !== "agent" || latest.undoOf !== undefined) return null;
  if (me !== undefined && latest.by === me) return null;
  return { text: `${name(latest.by)} ${latest.summary}`, rev: latest.rev };
}

/** A page's template line under the toolbar: how many versions it has. */
export const pageLine = (versions: number): string => `${versions} ${versions === 1 ? "version" : "versions"}`;

/** Blocks changed by this author at this moment, for the quiet highlight after an agent's edit. */
export function freshIds(doc: Pick<OverviewDoc, "blocks" | "latest">): ReadonlySet<string> {
  const l = doc.latest;
  if (!l || l.authorKind !== "agent") return new Set();
  return new Set(doc.blocks.filter((b) => b.by === l.by && b.at !== undefined && l.at - b.at < 5_000 && b.at <= l.at + 5_000).map((b) => b.id));
}

/** Words for a failed save. A stale page is the one the person must reload. */
export function saveFailure(e: unknown): { stale: boolean; text: string } {
  const err = e as { code?: string; details?: { reason?: string }; message?: string } | null;
  const stale = err?.code === "validation.precondition_failed" && (err.details?.reason === "stale_revision" || /changed the page/i.test(err.message ?? ""));
  return { stale, text: stale ? "Someone changed this page. Reload it to see their change; your edit here is not saved." : (err?.message || "The page could not be saved.") };
}
