// The project Overview page: the pure parts. What a live block is called and what it can be set to, how a page's properties, history and an agent's edit read in words, and the ops that change them.
// The page itself is the shared Markdown editor with live blocks (ui/src/RichEditor); the server keeps it as blocks and revisions (projects.overview_doc.*).
import type { CapMap } from "../../../../../../../generated/types.ts";
import { partsIn } from "../../../../../../../lib/zones.ts";

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
/** The plain blocks of the "/" menu, each the editor node it inserts (ProseMirror JSON). */
export const BASIC_BLOCKS: readonly { id: string; label: string; note: string; node(): unknown }[] = [
  { id: "text", label: "Text", note: "A paragraph", node: () => ({ type: "paragraph" }) },
  { id: "heading", label: "Heading", note: "A section title", node: () => ({ type: "heading", attrs: { level: 2 } }) },
  { id: "check", label: "Checklist", note: "Things to tick off", node: () => ({ type: "taskList", attrs: { marker: "-" }, content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] }] }) },
  { id: "table", label: "Table", note: "Rows and columns", node: () => ({ type: "rawBlock", attrs: { kind: "table" }, content: [{ type: "text", text: "| Name | Detail |\n| --- | --- |\n|  |  |" }] }) },
  { id: "callout", label: "Callout", note: "A note that stands out", node: () => ({ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "[!NOTE] Write a callout" }] }] }) },
  { id: "diagram", label: "Diagram", note: "Steps and arrows", node: () => ({ type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: "flowchart LR\n  A[Start] --> B[Next]" }] }) },
  { id: "chart", label: "Chart", note: "Bars from numbers", node: () => ({ type: "codeBlock", attrs: { language: "chart" }, content: [{ type: "text", text: '{"type":"bar","labels":["A","B"],"series":[{"name":"Count","data":[3,5]}]}' }] }) },
];
export const kindOf = (type: string): LiveKind | undefined => LIVE_KINDS.find((k) => k.type === type);

/** The kinds of record a live block can show are named by the Space; `plural` and `title` come from the record types. */
export interface TypeName { key: string; title: string; plural: string }

/** What a live block shows, in one line: "Tasks where status is open". Shown on hover and in the block's Edit sheet. */
export function liveDescription(type: string, spec: unknown, types: readonly TypeName[] = []): string {
  const s = (spec ?? {}) as Record<string, unknown>;
  const named = (k: unknown): string => types.find((x) => x.key === k)?.plural ?? (typeof k === "string" && k !== "" ? k : "Records");
  switch (type) {
    case "tasks": {
      const st = String(s["status"] ?? "open");
      const where = st === "all" ? "" : ` where status is ${st === "wait" || st === "waiting" ? "waiting or blocked" : st}`;
      return `Tasks${where}${typeof s["assigned"] === "string" && s["assigned"] !== "" ? ", assigned to me" : ""}`;
    }
    case "milestones": return "Milestones that are not done";
    case "links": return s["kind"] ? `Linked items of kind ${String(s["kind"]).replace(/_/g, " ")}` : "Linked items";
    case "records": return `${named(s["type"])}${s["filter"] ? " that match a filter" : ""}`;
    case "metric": return s["op"] === "sum" ? `Sum of ${String(s["field"] ?? "")} of ${named(s["type"]).toLowerCase()}` : `Count of ${named(s["type"]).toLowerCase()}`;
    case "ci": return "Recent CI runs";
    case "goal": return "Goals of this project";
    case "people": return "People and agents on the project";
    case "status": return "Health, open and late work";
    default: return "Live block";
  }
}

/** The tone a row's state reads in: warning for late or failed, quiet green for done or paid, muted for anything else. */
export function stateTone(state: string | undefined): "bad" | "good" | "plain" {
  const s = (state ?? "").toLowerCase();
  if (/^(late|overdue|failed|failure|error|blocked|rejected|past_due|unpaid)$/.test(s)) return "bad";
  if (/^(done|paid|succeeded|success|passed|complete|completed|merged|signed)$/.test(s)) return "good";
  return "plain";
}

/** A task's server state as the Plan's status mark names it. */
export function planStatus(state: string | undefined): "todo" | "doing" | "blocked" | "review" | "approval" | "done" {
  switch (state) {
    case "doing": return "doing";
    case "in_review": case "review": return "review";
    case "awaiting_approval": case "approval": return "approval";
    case "blocked": case "waiting": return "blocked";
    case "done": case "canceled": return "done";
    default: return "todo";
  }
}

const DAY = 86_400_000;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 25": a due date is a calendar day (kept at UTC midnight), so it is read in UTC through lib/zones, never by a hand-rolled formatter (shared-time ratchet). */
const shortDay = (ms: number): string => { const p = partsIn(ms, "UTC"); return `${MON[p.month - 1]} ${p.day}`; };
/** The due date of a task row: "Due Oct 25", or "2 days late" when it is open and past. */
export function dueWords(due: number | undefined, state: string | undefined, now: number): { text: string; late: boolean } | null {
  if (due === undefined) return null;
  const open = state !== "done" && state !== "canceled";
  if (open && due < now) { const n = Math.max(1, Math.floor((now - due) / DAY)); return { text: `${n} ${n === 1 ? "day" : "days"} late`, late: true }; }
  return { text: `Due ${shortDay(due)}`, late: false };
}

/** A sum or count as the page reads it: "$6,250 unpaid across 3 invoices". `unit` is the currency code of a money field. Amounts in more than one currency come as `parts` (one total each) and read
 *  "$4,550 and €900 unpaid across 4 invoices": they are never added into one number. */
export function metricLine(o: { value?: number | undefined; parts?: readonly { unit?: string | undefined; value: number }[] | undefined; title: string; total: number; noun: string; unit?: string | undefined; sum: boolean }): { big: string; rest: string } {
  const money = (v: number, unit?: string): string => (unit ? new Intl.NumberFormat("en-US", { style: "currency", currency: unit, maximumFractionDigits: 0 }).format(v) : new Intl.NumberFormat("en-US").format(v));
  const shown = o.parts && o.parts.length > 1 ? o.parts.map((p) => money(p.value, p.unit)) : [money(o.value ?? 0, o.sum ? o.unit : undefined)];
  const big = shown.length === 1 ? shown[0]! : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]!}`;
  const label = o.title.trim().toLowerCase();
  const across = o.sum ? ` across ${o.total} ${o.total === 1 ? o.noun.replace(/s$/, "") : o.noun.toLowerCase()}` : "";
  return { big, rest: `${label}${across}` };
}

export interface Choice { id: string; label: string }
/** The settings a kind of live block has, besides its title and view: each is one field of its spec and a list of choices. */
export const SPEC_CHOICES: Readonly<Partial<Record<LiveType, readonly { key: string; label: string; choices: readonly Choice[] }[]>>> = {
  tasks: [{ key: "status", label: "Show", choices: [{ id: "open", label: "Status is open" }, { id: "waiting", label: "Status is waiting or blocked" }, { id: "late", label: "Status is late" }, { id: "done", label: "Status is done" }, { id: "all", label: "All tasks" }] }, { key: "assigned", label: "Assigned to", choices: [{ id: "", label: "Anyone" }, { id: "me", label: "Me" }] }],
  links: [{ key: "kind", label: "Kind of link", choices: [{ id: "", label: "Any kind" }, { id: "mail_thread", label: "Mail" }, { id: "github.pr", label: "Pull requests" }, { id: "calendar_event", label: "Events" }, { id: "file", label: "Files" }, { id: "record", label: "Records" }] }],
  metric: [{ key: "op", label: "Measure", choices: [{ id: "count", label: "Count of rows" }, { id: "sum", label: "Sum of a field" }] }],
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

/** A project's stage as a person reads it ("planning" is "Planning"): the one function the header, the Status property and the Status block all use. */
export const STAGE_WORD: Readonly<Record<string, string>> = { planning: "Planning", active: "Active", hold: "On hold", done: "Done" };
export const stageWord = (x: string): string => STAGE_WORD[x] ?? (x === "" ? x : x.charAt(0).toUpperCase() + x.slice(1));
