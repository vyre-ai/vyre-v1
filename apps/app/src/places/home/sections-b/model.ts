// Home sections B (spec 3.1, 2.23, 2.1): the pure rules behind Today, Starred, the first-run checklist, the Ask box and the Personal Space variant.
// No React here: the components draw what these functions return, and the tests read them directly.
import type { CapMap } from "../../../../../../generated/types.ts";
import { DAY_MS, clockTime, dayNumber } from "../sections-a/model.ts";
import type { Clock } from "../sections-a/model.ts";

export type CalEvent = CapMap["calendar.list_events"]["out"]["events"][number];
export type Star = CapMap["stars.list"]["out"]["stars"][number];
export type StarType = Star["resource"]["type"];
export type TerminalRow = CapMap["terminal.status"]["out"]["rows"][number];
export type Checklist = CapMap["home.checklist"]["out"];
export type ChecklistKey = Checklist["items"][number]["key"];

/** The generated screen the three lower sections read (calendar.list_events, stars.list, terminal.status). Registered by the contract steward; see the packet comment. */
export const TODAY_SCREEN = "home.today-starred-ask";
export const CHECKLIST_SCREEN = "home.checklist";
/** Stars shown before "Show all". */
export const STARRED_LIMIT = 6;

// ---------------------------------------------------------------- Today

/** The person's day as [from, to) in epoch ms. */
export function dayWindow(c: Clock): { from: number; to: number } {
  const from = dayNumber(c.now, c.offsetMin) * DAY_MS - c.offsetMin * 60_000;
  return { from, to: from + DAY_MS };
}

export interface TodayRow {
  id: string;
  title: string;
  /** The leading column: "9:00 am" or "All day". */
  when: string;
  /** The second line: "9:00 am to 9:30 am · Room 2" */
  note: string;
  state: "past" | "now" | "next" | "later";
  allDay: boolean;
  joinUrl?: string;
  joinProvider: CalEvent["joinProvider"];
}

const PROVIDER: Record<CalEvent["joinProvider"], string> = { zoom: "Zoom", meet: "Google Meet", teams: "Teams", none: "" };

/** Events that touch the person's day: all-day first, then by start. The running one is "now"; the first one still to come is "next". */
export function todayRows(events: readonly CalEvent[], c: Clock): TodayRow[] {
  const { from, to } = dayWindow(c);
  const here = events.filter((e) => e.startsAt < to && Math.max(e.endsAt, e.startsAt + 1) > from);
  here.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt - b.startsAt || a.title.localeCompare(b.title));
  let nextTaken = false;
  const rows: TodayRow[] = [];
  for (const e of here) {
    const state: TodayRow["state"] = e.allDay ? "later" : e.endsAt <= c.now ? "past" : e.startsAt <= c.now ? "now" : nextTaken ? "later" : "next";
    if (state === "next") nextTaken = true;
    const span = e.allDay ? "All day" : `${clockTime(e.startsAt, c.offsetMin)} to ${clockTime(e.endsAt, c.offsetMin)}`;
    const via = PROVIDER[e.joinProvider];
    const bits = [span, e.location ?? "", via].filter((b) => b.length > 0);
    rows.push({
      id: e.id, title: e.title, when: e.allDay ? "All day" : clockTime(e.startsAt, c.offsetMin), note: bits.join(" · "), state, allDay: e.allDay,
      ...(e.joinUrl ? { joinUrl: e.joinUrl } : {}), joinProvider: e.joinProvider,
    });
  }
  return rows;
}

/** "3 left" while the day goes on, "Nothing left" when every event is over. */
export function todayCount(rows: readonly TodayRow[]): string {
  const left = rows.filter((r) => r.state !== "past").length;
  if (rows.length === 0) return "";
  return left === 0 ? "Done for the day" : `${left} left`;
}

// ---------------------------------------------------------------- Starred

export const STAR_LABEL: Record<StarType, string> = {
  space: "Space", record_type: "Record type", record: "Record", project: "Project", folder: "Folder", file: "File", channel: "Channel", thread: "Chat",
  inbox: "Inbox", mailbox: "Mailbox", vault_folder: "Vault folder", vault_item: "Vault item", automation_group: "Automations", automation: "Automation",
  agent: "Agent", connector: "Connector", connection: "Connection", site: "Site", form: "Form", campaign: "Campaign", kit: "Kit", terminal: "Terminal",
  computer: "Agent computer", task: "Task", run: "Run", number: "Number", domain: "Domain", calendar: "Calendar",
};

export type StarIcon = "terminal" | "chat" | "file" | "record" | "run" | "calendar" | "person" | "star";
export function starIcon(t: StarType): StarIcon {
  switch (t) {
    case "terminal": case "computer": return "terminal";
    case "thread": case "channel": return "chat";
    case "file": case "folder": case "vault_folder": case "vault_item": return "file";
    case "record": case "record_type": case "project": case "task": return "record";
    case "run": case "automation": case "automation_group": return "run";
    case "calendar": return "calendar";
    case "agent": return "person";
    default: return "star";
  }
}

/** What a terminal's line says: "Running · npm run dev", "Exited 1 · build failed", "Idle". */
export function terminalLine(t: TerminalRow | undefined): { text: string; tone: "plain" | "live" | "warn" } {
  if (t === undefined) return { text: "Terminal", tone: "plain" };
  const last = t.lastLine && t.lastLine.length > 0 ? ` · ${t.lastLine}` : "";
  if (t.state === "running") return { text: `Running${last}`, tone: "live" };
  if (t.state === "exited") return { text: `${t.exitCode === null ? "Exited" : `Exited ${t.exitCode}`}${last}`, tone: t.exitCode === 0 || t.exitCode === null ? "plain" : "warn" };
  return { text: `Idle${last}`, tone: "plain" };
}

export interface StarRow {
  key: string;
  type: StarType;
  id: string;
  title: string;
  note: string;
  icon: StarIcon;
  tone: "plain" | "live" | "warn";
  terminal: boolean;
}

/** Newest first, as the capability returns them. A terminal's note is its live status; anything else shows its kind. */
export function starRows(stars: readonly Star[], status: readonly TerminalRow[]): StarRow[] {
  const byId = new Map(status.map((t) => [t.terminalId, t] as const));
  return stars.map((s) => {
    const terminal = s.resource.type === "terminal";
    const line = terminal ? terminalLine(byId.get(s.resource.id)) : { text: STAR_LABEL[s.resource.type], tone: "plain" as const };
    return { key: `star:${s.resource.type}:${s.resource.id}`, type: s.resource.type, id: s.resource.id, title: s.title, note: line.text, icon: starIcon(s.resource.type), tone: line.tone, terminal };
  });
}

/** Terminal ids the status query asks about. */
export function terminalIds(stars: readonly Star[]): string[] {
  return stars.filter((s) => s.resource.type === "terminal").map((s) => s.resource.id);
}

// ---------------------------------------------------------------- Personal Space (spec 2.1 matrix)

/** Starred things a Personal Space cannot hold: agent computers and the Apps (public sites, forms, campaigns) need a Team Space. */
const TEAM_ONLY: ReadonlySet<StarType> = new Set<StarType>(["computer", "site", "form", "campaign"]);
export const needsTeamSpace = (t: StarType): boolean => TEAM_ONLY.has(t);

const TEAM_WORDS: Partial<Record<StarType, string>> = { computer: "Agent computers", site: "Sites", form: "forms", campaign: "campaigns" };

/** "Agent computers, sites, forms and campaigns" for the kinds present, in a fixed order. */
export function teamOnlyWhat(types: readonly StarType[]): string {
  const order: StarType[] = ["computer", "site", "form", "campaign"];
  const words = order.filter((t) => types.includes(t)).map((t, i) => (i === 0 ? TEAM_WORDS[t]! : TEAM_WORDS[t]!.toLowerCase()));
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export interface StarSplit { rows: StarRow[]; blocked: StarType[] }

/** In a Personal Space the team-only stars leave the list and become one "Needs a Team Space" line. */
export function splitForSpace(rows: readonly StarRow[], personal: boolean): StarSplit {
  if (!personal) return { rows: [...rows], blocked: [] };
  const keep = rows.filter((r) => !needsTeamSpace(r.type));
  const blocked = [...new Set(rows.filter((r) => needsTeamSpace(r.type)).map((r) => r.type))];
  return { rows: keep, blocked };
}

// ---------------------------------------------------------------- the first-run checklist

export type ChecklistItemKey = ChecklistKey | "ai";
export interface ChecklistRow {
  key: ChecklistItemKey;
  title: string;
  note: string;
  action: string;
  done: boolean;
  locked: boolean;
}

const COPY: Record<ChecklistItemKey, { note: (space: string) => string; action: string }> = {
  ai: { note: () => "Your assistant stays locked until you do", action: "Connect" },
  photo_and_title: { note: (s) => `Next to your name in ${s}`, action: "Add" },
  connect_mailbox_and_calendar: { note: () => "So agents can draft and schedule for you", action: "Connect" },
  meet_assistant: { note: () => "Say hello in a chat", action: "Open" },
  open_first_project: { note: () => "Pick the one to start with", action: "Open" },
  import: { note: () => "Bring in your contacts, records or files", action: "Import" },
};

/**
 * The card's rows. A missing AI account adds the first row and locks "Meet your assistant". A Personal Space is the assistant and the checklist only,
 * so its list has no project row and no import row (four rows: account, photo, mailbox and calendar, assistant). `done` flags come from the capability; the AI row is done when an account is connected.
 */
export function checklistRows(list: Checklist, o: { spaceName: string; personal: boolean; aiConnected: boolean }): ChecklistRow[] {
  const rows: ChecklistRow[] = [{ key: "ai", title: "Connect an AI account", note: COPY.ai.note(o.spaceName), action: COPY.ai.action, done: o.aiConnected, locked: false }];
  for (const it of list.items) {
    if (o.personal && (it.key === "open_first_project" || it.key === "import")) continue;
    const locked = it.key === "meet_assistant" && !o.aiConnected && !it.done;
    const c = COPY[it.key];
    rows.push({ key: it.key, title: it.title, note: it.done ? "Done" : locked ? "Connect an AI account first" : c.note(o.spaceName), action: c.action, done: it.done, locked });
  }
  return rows;
}

export function checklistProgress(rows: readonly ChecklistRow[]): { done: number; total: number } {
  return { done: rows.filter((r) => r.done).length, total: rows.length };
}

// ---------------------------------------------------------------- the Ask box

export const ASK_PLACEHOLDER = "Ask your assistant…";
export const ASK_LOCKED = "Connect an AI account to ask your assistant";

/** The text that starts a chat: trimmed, empty means nothing to send. */
export function askText(raw: string): string | null {
  const t = raw.trim();
  return t.length > 0 ? t : null;
}
