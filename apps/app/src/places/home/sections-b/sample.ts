// The sample Spaces behind the Home sections B tests and screenshots. They extend the sections A sample (same replica, same clock, Friday 24 October 2025, 10:00) with the calendar
// day, the starred things with their terminal status, the first-run checklist and the writes those sections make (unstar, hide the checklist, start a chat from the Ask box).
// Variants: northwind (default), harbor, personal (a Personal Space, nothing connected yet), firstrun (a new member of Northwind).
import { createScreenHooks } from "../../../../../../client/src/index.ts";
import type { Row } from "../../../../../../client/src/index.ts";
import type { ScreenIndexEntry } from "../../../../../../generated/screens.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import { SAMPLE_NOW, createSampleHome, harbor, northwind } from "../sections-a/sample.ts";
import type { SampleHome, SampleSpace } from "../sections-a/sample.ts";
import type { HomeBExtras, GoTarget } from "./data.tsx";
import { TODAY_SCREEN } from "./model.ts";
import type { CalEvent, Star, TerminalRow } from "./model.ts";

/** The screen the contract steward registers for the lower sections (packet comment). The samples register the same shape so the sections read it the way they will in the app. */
export const TODAY_SCREEN_ENTRY: ScreenIndexEntry = {
  id: TODAY_SCREEN, module: "home", place: "home", slot: "main", builtin: "ui:TodayStarredAsk", caller: "principal",
  queries: {
    events: { cap: "calendar.list_events", input: { from: "/state/from", to: "/state/to" }, live: true },
    stars: { cap: "stars.list", input: {}, live: true },
    terminals: { cap: "terminal.status", input: { terminalIds: "/state/terminalIds" }, live: true },
  },
  actions: {
    unstar: { cap: "stars.toggle", input: { resource: "/state/resource", on: "/state/on" } },
    ask: { cap: "chat.start", input: { kind: "/state/kind", agentIds: "/state/agentIds", first: "/state/first", idempotencyKey: "/state/idempotencyKey" } },
  },
  needs: [], perf: { firstPaintMs: 50, completeMs: 100 },
};

const at = (h: number, m = 0): number => Date.UTC(2025, 9, 24, h, m, 0);
const MIN = 60_000;
const row = (x: object): Row => x as unknown as Row;

const ev = (id: string, title: string, start: number, mins: number, o: Partial<CalEvent> = {}): CalEvent => ({
  id, calendarId: "cal_work", title, startsAt: start, endsAt: start + mins * MIN, allDay: false, joinProvider: "none", attendees: [], recordIds: [], status: "confirmed", ...o,
});

export const northwindEvents: CalEvent[] = [
  ev("evt_stand", "Team standup", at(9), 15, { joinProvider: "zoom", joinUrl: "https://zoom.example/j/standup" }),
  ev("evt_pruitt", "Pruitt retainer check-in", at(9, 45), 45, { location: "Room 2" }),
  ev("evt_rivera", "Rivera intake call", at(11, 30), 30, { joinProvider: "zoom", joinUrl: "https://zoom.example/j/rivera" }),
  ev("evt_bill", "Review Q4 billing", at(14, 30), 45, { joinProvider: "meet", joinUrl: "https://meet.example/q4" }),
  ev("evt_plan", "Weekly planning", at(16), 60, { location: "Studio" }),
];

const star = (type: Star["resource"]["type"], id: string, title: string, minutesAgo: number): Star => ({ resource: { type, id }, title, at: SAMPLE_NOW - minutesAgo * MIN });

export const northwindStars: Star[] = [
  star("terminal", "trm_dev", "Dev server", 20),
  star("thread", "thr_rivera", "Elena Rivera", 55),
  star("terminal", "trm_migrate", "Migrate staging", 120),
  star("project", "rec_rivera", "Rivera matter", 300),
  star("terminal", "trm_backup", "Nightly backup", 600),
  star("agent", "agt_intake", "Intake", 900),
  star("file", "fil_intake", "client-intake.pdf", 1400),
  star("automation", "aut_billing", "Weekly billing run", 2000),
];

export const northwindTerminals: TerminalRow[] = [
  { terminalId: "trm_dev", state: "running", lastLine: "ready on http://localhost:3000", exitCode: null },
  { terminalId: "trm_migrate", state: "exited", lastLine: "Error: column amount_cents is missing", exitCode: 1 },
  { terminalId: "trm_backup", state: "exited", lastLine: "Backed up 4,212 files", exitCode: 0 },
];

const harborEvents: CalEvent[] = [
  ev("evt_hkick", "Moreno kickoff", at(11), 45, { joinProvider: "zoom", joinUrl: "https://zoom.example/j/moreno" }),
  ev("evt_hvisit", "Studio visit with Abel", at(14), 60, { location: "Harbor Studio" }),
];
const harborStars: Star[] = [star("project", "rec_moreno", "Moreno rebrand", 40), star("thread", "thr_sched", "Scheduler", 200)];

export type Variant = "northwind" | "harbor" | "personal" | "firstrun";

const personalSpace: SampleSpace = {
  ...northwind, name: "Personal", tasks: [], needs: [], risk: [], routines: [],
  digest: { ...northwind.digest, id: "dgs_p0", headline: [], items: [] },
};
const newcomerSpace: SampleSpace = {
  ...northwind, me: { id: "usr_dana", name: "Dana Whitfield", kind: "person" }, principals: [...northwind.principals, { id: "usr_dana", name: "Dana Whitfield", kind: "person" }],
  tasks: [], needs: [], risk: [], routines: [], digest: { ...northwind.digest, id: "dgs_d0", person: "usr_dana", headline: [], items: [] },
};

export interface SampleHomeB extends SampleHome {
  extras: HomeBExtras;
  /** every button the sections pressed that leads out of Home, in order */
  went: string[];
  urls: string[];
  /** the checklist rows the capability returns, by key */
  setDone(key: string, done: boolean): void;
  setAi(connected: boolean): void;
}

export function createSampleHomeB(variant: Variant = "northwind", o: { online?: boolean; aiConnected?: boolean; calendarConnected?: boolean; stars?: Star[]; terminals?: TerminalRow[]; events?: CalEvent[] } = {}): SampleHomeB {
  const space = variant === "harbor" ? harbor : variant === "personal" ? personalSpace : variant === "firstrun" ? newcomerSpace : northwind;
  const base = createSampleHome(space, o.online === undefined ? {} : { online: o.online });
  const { replica } = base;
  const personal = variant === "personal";
  const fresh = personal || variant === "firstrun";
  let ai = o.aiConnected ?? !fresh;
  const connectedCal = o.calendarConnected ?? !personal;

  const events = o.events ?? (variant === "harbor" ? harborEvents : fresh ? [] : northwindEvents);
  const stars = o.stars ?? (variant === "harbor" ? harborStars : fresh ? [] : northwindStars);
  const terminals = o.terminals ?? (fresh ? [] : variant === "harbor" ? [] : northwindTerminals);
  replica.put("events", events.map((e) => row({ ...e })));
  replica.put("stars", stars.map((s) => row({ id: `${s.resource.type}:${s.resource.id}`, ...s })));
  replica.put("terminals", terminals.map((t) => row({ id: t.terminalId, ...t })));
  const doneAtStart: Record<string, boolean> = fresh ? {} : { photo_and_title: true, connect_mailbox_and_calendar: true, meet_assistant: true, open_first_project: true, import: true };
  const keys = ["photo_and_title", "connect_mailbox_and_calendar", "meet_assistant", "open_first_project", "import"] as const;
  const titles: Record<(typeof keys)[number], string> = {
    photo_and_title: "Add a photo and title", connect_mailbox_and_calendar: "Connect your mailbox and calendar", meet_assistant: "Meet your assistant",
    open_first_project: "Open your first project", import: "Import your data",
  };
  replica.put("checklist", keys.map((k) => row({ id: k, key: k, title: titles[k], done: doneAtStart[k] === true })));
  replica.put("checklist_state", [{ id: "state", dismissed: false }]);

  replica.resolve("calendar.list_events", (_t, input) => ({ events: (replica.rows("events") as unknown as CalEvent[]).filter((e) => e.startsAt < input.to && e.endsAt > input.from) }) as CapMap["calendar.list_events"]["out"]);
  replica.resolve("stars.list", () => {
    const rows = (replica.rows("stars") as unknown as Star[]).slice().sort((a, b) => b.at - a.at);
    return { stars: rows.map(({ resource, title, at: when }) => ({ resource, title, at: when })) };
  });
  replica.resolve("terminal.status", (_t, input) => {
    const want = new Set(input.terminalIds);
    return { rows: (replica.rows("terminals") as unknown as TerminalRow[]).filter((t) => want.has(t.terminalId)).map(({ terminalId, state, lastLine, exitCode }) => ({ terminalId, state, ...(lastLine ? { lastLine } : {}), exitCode })) };
  });
  replica.resolve("home.checklist", () => {
    const items = (replica.rows("checklist") as unknown as { key: (typeof keys)[number]; title: string; done: boolean }[]).map(({ key, title, done }) => ({ key, title, done }));
    const dismissed = (replica.rows("checklist_state")[0] as unknown as { dismissed: boolean }).dismissed;
    return { visible: !dismissed && items.some((i) => !i.done), items };
  });

  const went: string[] = [];
  const urls: string[] = [];
  const extras: HomeBExtras = {
    space: { kind: personal ? "personal" : "team", name: space.name },
    assistant: { id: "agt_assistant", name: "Assistant" },
    get aiConnected() { return ai; },
    calendarConnected: connectedCal,
    go: (target: GoTarget) => void went.push(target),
    openUrl: (u) => void urls.push(u),
  };

  const baseCall = base.data.call;
  let chats = 0;
  const data = {
    ...base.data,
    screens: createScreenHooks(replica, new Map<string, ScreenIndexEntry>([...screensById, [TODAY_SCREEN, TODAY_SCREEN_ENTRY]])),
    async call(cap: string, input: unknown): Promise<unknown> {
      if (cap === "stars.toggle") {
        base.calls.push({ cap, input });
        const i = input as { resource: Star["resource"]; on: boolean };
        const id = `${i.resource.type}:${i.resource.id}`;
        if (!i.on) replica.remove("stars", [id]);
        else {
          const known = stars.find((s) => s.resource.type === i.resource.type && s.resource.id === i.resource.id);
          replica.put("stars", [{ id, resource: i.resource, title: known?.title ?? i.resource.id, at: SAMPLE_NOW }]);
        }
        return { starred: i.on, following: false };
      }
      if (cap === "home.dismiss_checklist") {
        base.calls.push({ cap, input });
        replica.put("checklist_state", [{ id: "state", dismissed: true }]);
        return { ok: true };
      }
      if (cap === "chat.start") {
        base.calls.push({ cap, input });
        return { thread: { threadId: `thr_new${++chats}`, kind: "chat", listed: true, planMode: false } };
      }
      return baseCall(cap, input);
    },
  };
  return {
    ...base, data, extras, went, urls,
    setDone(key, done) { const r = replica.rows("checklist").find((x) => x.id === key); if (r) replica.put("checklist", [{ ...r, done }]); },
    setAi(v) { ai = v; replica.put("checklist_state", [{ id: "state", dismissed: false }]); },
  };
}
