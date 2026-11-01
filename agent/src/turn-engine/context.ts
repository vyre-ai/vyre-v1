// The turn context: what an agent is told every turn, in one order, for every engine. The engine module builds it (modules/engine/context.ts) as the asker, from capabilities the asker may
// call, and puts it on the turn input. An API driver renders it as system blocks (stable sections first, so the provider's prefix cache holds); a CLI engine gets it in front of the message
// (agent/src/drivers/cli/prompt.ts), where a resumed session is sent only the sections that changed since it last saw them.
//
//   identity    who the agent is: its name, its role line and its AGENT.md
//   rules       how it works with memory and secrets in short
//   where       the Space, the project, what this chat is for, who is in it by name
//   memory      the agent's MAP.md as the nightly job wrote it
//   skills      the index of skills it may load, one line each
//   can         a map of what it can do here: grants, routines and watchers, its computer, the Vault handles it may use
//   task        in a task thread: your seat, the brief, what counts as done, the fixes asked for and the baton tools to finish with (modules/engine/context.ts)
//   earlier     a summary of the turns older than the recent ones shown word for word
//   handoff     one turn only: the chat moved to this engine, with the summary it starts from
//   screen      what the person has open (ScreenContext)
//   focus       the focus skill of the place the person is in
//   now         the time, in the person's zone
//   waiting     what the agent itself is waiting on
//
// What memory recalled for the message (input.recall) is the memory module's and follows this context unchanged.
// Nothing here holds a secret value: the Vault appears by handle and field name only.
import type { SystemBlock } from "../drivers/api/types.ts";
import { fingerprint } from "../drivers/api/prefix.ts";

export type SectionId = "identity" | "rules" | "where" | "memory" | "skills" | "can" | "task" | "parent" | "earlier" | "handoff" | "screen" | "focus" | "now" | "waiting";

export const SECTION_ORDER: readonly SectionId[] = ["identity", "rules", "where", "memory", "skills", "can", "task", "parent", "earlier", "handoff", "screen", "focus", "now", "waiting"];

export interface ContextSection {
  id: SectionId;
  /** Does not change from turn to turn for the same agent, person and place: it goes first and carries the cache marker. */
  stable: boolean;
  text: string;
}

/** One thing on a person's screen: an object by type and id, with the title they read. */
export interface ScreenObject { type: string; id: string; title?: string }

/**
 * What a place tells the agent about itself (one shape for every place, Ask Vyre and every workspace chat). Only ids, titles and short summaries: the agent reads the objects themselves
 * through its tools, as the asker, so nothing here widens access.
 */
export interface ScreenContext {
  /** The place: home, records, files, automations, vault, console, inbox, apps, chats, agents, tasks, projects, calendar, journeys. */
  place: string;
  /** The page or view title the person reads. */
  title?: string;
  /** Objects open on the screen. */
  open?: readonly ScreenObject[];
  /** What the person has selected (rows, text, a step on a canvas). */
  selection?: readonly ScreenObject[];
  /** Filters and sort in force, as the person set them. */
  filters?: Readonly<Record<string, string | readonly string[]>>;
  /** The visible rows, summed up: how many are shown, how many there are, and a few lines. */
  rows?: { shown: number; total?: number; sample?: readonly string[] };
  /** What the place lets the person do here, by capability name (the agent calls the capability itself). */
  actions?: readonly string[];
  /** The focus skill the place asks for (name of a skill). */
  focus?: string;
}

export interface TurnContext {
  sections: readonly ContextSection[];
  /** Display names by principal id, for the people and agents of this chat. A raw id is never a name. */
  names: Readonly<Record<string, string>>;
  /** The screen the message was sent from, as parsed. */
  screen?: ScreenContext;
  /** When the sections hold a summary of older turns, only this many of the newest messages go word for word. */
  keepHistory?: number;
}

const MAX_SECTION = 6_000;
const cut = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const line = (s: unknown, n = 160): string => cut(String(s ?? "").replace(/\s+/g, " ").trim(), n);

/** The name of a principal for a reader: the display name when known, else a plain word for its kind. */
export function nameOf(names: Readonly<Record<string, string>> | undefined, id: string): string {
  const n = names?.[id];
  if (n) return n;
  if (id.startsWith("agt_")) return "an agent";
  if (id.startsWith("usr_")) return "a teammate";
  return id;
}

/** `Name` for a speaker label in the transcript the model reads. */
export const speaker = (ctx: TurnContext | undefined, id: string): string => ctx?.names[id] ?? id;

const obj = (o: ScreenObject): string => `${o.type} ${o.id}${o.title ? ` "${line(o.title, 80)}"` : ""}`;

/** The screen section's words. Empty when the place said nothing worth saying. */
export function screenText(s: ScreenContext | undefined): string {
  if (!s) return "";
  const out: string[] = [`The person is in ${s.place}${s.title ? `, on "${line(s.title, 100)}"` : ""}.`];
  if (s.open?.length) out.push(`Open: ${s.open.slice(0, 12).map(obj).join("; ")}.`);
  if (s.selection?.length) out.push(`Selected: ${s.selection.slice(0, 20).map(obj).join("; ")}.`);
  if (s.filters) {
    const f = Object.entries(s.filters).slice(0, 12).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : String(v)}`);
    if (f.length) out.push(`Filters: ${f.join(", ")}.`);
  }
  if (s.rows) {
    out.push(`Rows on screen: ${s.rows.shown}${s.rows.total !== undefined ? ` of ${s.rows.total}` : ""}.`);
    for (const r of (s.rows.sample ?? []).slice(0, 8)) out.push(`- ${line(r, 140)}`);
  }
  if (s.actions?.length) out.push(`Here the person can: ${s.actions.slice(0, 16).join(", ")}.`);
  return cut(out.join("\n"), MAX_SECTION);
}

/** Parse what a client sent as screen context, leniently: anything that is not the shape is dropped, nothing throws. */
export function parseScreen(raw: unknown): ScreenContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r["place"] !== "string" || r["place"] === "") return undefined;
  const objs = (v: unknown): ScreenObject[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const o = v.flatMap((x): ScreenObject[] => (x && typeof x === "object" && typeof (x as ScreenObject).type === "string" && typeof (x as ScreenObject).id === "string"
      ? [{ type: (x as ScreenObject).type, id: (x as ScreenObject).id, ...(typeof (x as ScreenObject).title === "string" ? { title: (x as ScreenObject).title as string } : {}) }] : []));
    return o.length > 0 ? o.slice(0, 40) : undefined;
  };
  const out: { -readonly [K in keyof ScreenContext]: ScreenContext[K] } = { place: r["place"] };
  if (typeof r["title"] === "string") out.title = r["title"];
  const open = objs(r["open"]); if (open) out.open = open;
  const selection = objs(r["selection"]); if (selection) out.selection = selection;
  if (r["filters"] && typeof r["filters"] === "object") {
    const f: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(r["filters"] as Record<string, unknown>).slice(0, 20)) {
      if (typeof v === "string") f[k] = v;
      else if (Array.isArray(v)) f[k] = v.filter((x): x is string => typeof x === "string").slice(0, 20);
    }
    if (Object.keys(f).length > 0) out.filters = f;
  }
  const rows = r["rows"] as { shown?: unknown; total?: unknown; sample?: unknown } | undefined;
  if (rows && typeof rows.shown === "number") {
    out.rows = { shown: rows.shown, ...(typeof rows.total === "number" ? { total: rows.total } : {}), ...(Array.isArray(rows.sample) ? { sample: rows.sample.filter((x): x is string => typeof x === "string").slice(0, 8) } : {}) };
  }
  if (Array.isArray(r["actions"])) out.actions = (r["actions"] as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 24);
  if (typeof r["focus"] === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(r["focus"])) out.focus = r["focus"];
  return out;
}

/** The sections in the fixed order, empty ones dropped. */
export function ordered(sections: readonly ContextSection[]): ContextSection[] {
  return SECTION_ORDER.flatMap((id) => sections.filter((s) => s.id === id && s.text.trim() !== ""));
}

/** The title a section is shown under in a prompt. */
const TITLE: Readonly<Record<SectionId, string>> = {
  identity: "", rules: "", where: "Where you are", memory: "", skills: "", can: "What you can do here", task: "Your task", earlier: "Earlier in this chat (a summary of turns before the recent ones below; search the transcript for exact words)", handoff: "You are taking over this chat",
  screen: "On the person's screen", focus: "Focus for this place", now: "", waiting: "You are waiting on",
};

const bodyOf = (s: ContextSection): string => (TITLE[s.id] ? `${TITLE[s.id]}:\n${s.text}` : s.text);

/** System blocks for an API driver: one block per section, in order; the driver puts the stable ones first. */
export function contextBlocks(ctx: TurnContext): SystemBlock[] {
  return ordered(ctx.sections).map((s) => ({ text: bodyOf(s), stable: s.stable }));
}

/** A fingerprint of a section, to tell a resumed CLI session what it already holds. */
export const sectionHash = (s: ContextSection): string => fingerprint(`${s.id}\u0000${s.text}`);

/**
 * The context as the front of a CLI prompt. A fresh session gets every section; a resumed one only the volatile sections and the stable ones whose text changed since `sent`
 * (updated here). Wrapped in <vyre-context> so the engine and the transcript can tell it from the person's words.
 */
export function contextPrompt(ctx: TurnContext | undefined, fresh: boolean, sent?: Map<string, string>): string {
  if (!ctx) return "";
  const parts: string[] = [];
  for (const s of ordered(ctx.sections)) {
    const h = sectionHash(s);
    if (!fresh && s.stable && sent?.get(s.id) === h) continue;
    sent?.set(s.id, h);
    parts.push(bodyOf(s));
  }
  return parts.length === 0 ? "" : `<vyre-context>\n${parts.join("\n\n")}\n</vyre-context>`;
}
