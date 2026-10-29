// The chat benchmark harness (test/chat-brain.benchmark.test.ts): a seeded Space, a model stand-in that acts only on what the prompt tells it, and the tool-use helpers its policies share.
//
// What this measures, and what it does not. No real model runs here. The stand-in is a deterministic policy that behaves like a competent model that has only what is in front of it: the system
// prompt and the messages exactly as a driver builds them (roleBlocks and threadMessages), and the tools, found with tool_search when they are not in the default list. When a fact is not in the
// prompt it looks it up with a tool, the way a model would, within a budget of tool calls; when no tool can supply it (which record "this" is, what thread it is in) it cannot act on it.
// So the score is how far the information a model needs is in front of it. It is a regression guard for the turn context, the skills and the tools; it is not a measure of model quality.
import type { DriverEvent, TurnInput, ToolResult } from "../../agent/src/turn-engine/types.ts";
import { loadGenerated } from "../../agent/src/tools/harness.ts";
import { threadMessages } from "../../agent/src/drivers/api/messages.ts";
import { roleBlocks } from "../../modules/engine/session.ts";
import type { RunTool } from "./live.ts";

export const MAX_CALLS = 8;
const gen = loadGenerated();
export const isListed = (name: string): boolean => gen.defaults.has(name);

export class BudgetExceeded extends Error { constructor() { super("out of tool calls"); } }

/** The envelope tools answer with: { data } or { error }. */
export type Env = { data?: any; error?: { code: string; message: string } };   // eslint-disable-line @typescript-eslint/no-explicit-any
export type Use = (name: string, input: unknown) => AsyncGenerator<DriverEvent, Env>;
export type Say = (text: string) => DriverEvent;

export interface Facts {
  /** The prompt as the model reads it: the system blocks and the messages. */
  view: string;
  mode: "before" | "after";
  agentName: string;
  agentId?: string;
  threadId?: string;
  askerId?: string;
  askerName?: string;
  tz?: string;
  /** The local time the prompt states, as { weekday, hour, minute }. */
  localNow?: { weekday: string; hour: number; minute: number };
  vaultHandles: string[];
  hasComputer?: boolean;
  routines: Array<{ id: string; title: string; kind: "schedule" | "watcher"; cron?: string }>;
  /** Open objects named by the screen. */
  open: Array<{ type: string; id: string; title?: string }>;
  /** Things the prompt teaches. */
  teaches: { utc: boolean; inPlace: boolean; testFirst: boolean; routineTool: boolean; draftNotSend: boolean };
}

export function factsOf(view: string, mode: "before" | "after"): Facts {
  const m = (re: RegExp): string | undefined => re.exec(view)?.[1];
  const now = /It is (\w+), (\d+) \w+ \d{4}, (\d\d):(\d\d) \(([^)]+)\)\./.exec(view);
  const handles = /Vault items you may use by handle: (.*?) \(call vault_use/.exec(view)?.[1];
  const routines = [...view.matchAll(/^- (schedule|watcher) "([^"]+)"(?: cron "([^"]+)")?[^\n]*\((rtn_[a-z0-9]+)\)$/gm)].map((r) => ({ id: r[4]!, title: r[2]!, kind: r[1] as "schedule" | "watcher", ...(r[3] ? { cron: r[3] } : {}) }));
  const open = [...(/Open: ([^\n]+)\./.exec(view)?.[1] ?? "").matchAll(/(\w+) ((?:rec|fil|aut|prj|tsk)_[a-z0-9]+)(?: "([^"]*)")?/g)].map((o) => ({ type: o[1]!, id: o[2]!, ...(o[3] ? { title: o[3] } : {}) }));
  return {
    view, mode,
    agentName: m(/You are (.+?)(?: \(agentId agt_[a-z0-9]+\))?, an agent in Vyre/) ?? "",
    ...(m(/agentId (agt_[a-z0-9]+)/) ? { agentId: m(/agentId (agt_[a-z0-9]+)/)! } : {}),
    ...(m(/threadId (thr_[a-z0-9]+)/) ? { threadId: m(/threadId (thr_[a-z0-9]+)/)! } : {}),
    ...(m(/\((usr_[a-z0-9_]+);/) ? { askerId: m(/\((usr_[a-z0-9_]+);/)! } : {}),
    ...(m(/You are talking with (.+?) \(usr_/) ? { askerName: m(/You are talking with (.+?) \(usr_/)! } : {}),
    ...(now ? { tz: now[5]!, localNow: { weekday: now[1]!, hour: Number(now[3]), minute: Number(now[4]) } } : {}),
    vaultHandles: handles ? [...handles.matchAll(/#([A-Za-z0-9_]+)/g)].map((h) => h[1]!) : [],
    ...(/You have no computer/.test(view) ? { hasComputer: false } : /Your computer is/.test(view) ? { hasComputer: true } : {}),
    routines, open,
    teaches: {
      utc: /cron runs in UTC/i.test(view), inPlace: /give routineId to change/.test(view) || /pass its `?routineId`?/.test(view),
      testFirst: /automations_test runs it with sample data/.test(view) || /Test before enabling|test before you turn/i.test(view),
      routineTool: /agents_routine_save/.test(view), draftNotSend: /Prefer a draft/.test(view),
    },
  };
}

/** The prompt text of a turn, as a driver builds it: system blocks in order, then the messages. */
export async function viewOf(call: (cap: string, input: unknown, as?: string) => Promise<unknown>, input: TurnInput): Promise<string> {
  const spec = { threadId: input.threadId, agent: input.agent, asker: input.asker, turnId: input.turnId, traceId: "bench" };
  const blocks = await roleBlocks(call)(spec, input);
  const msgs = threadMessages(input).map((m) => (m.role === "user" ? m.text : m.role === "assistant" ? m.text : ""));
  return `${blocks.map((b) => b.text).join("\n\n")}\n\n${msgs.join("\n\n")}`;
}

/** The tool helper a policy uses: a tool that is not in the default list is found with tool_search first; every call counts against the budget. */
export function makeUse(run: RunTool, counter: { calls: number; log: string[] }): Use {
  const searched = new Set<string>();
  return async function* use(name, input) {
    if (!isListed(name) && !searched.has(name)) {
      searched.add(name);
      if (++counter.calls > MAX_CALLS) throw new BudgetExceeded();
      counter.log.push("tool_search");
      yield* run("tool_search", { query: name.replaceAll("_", " ") });
    }
    if (++counter.calls > MAX_CALLS) throw new BudgetExceeded();
    counter.log.push(name);
    const r: ToolResult = yield* run(name, input);
    if (process.env["VYRE_BENCH_DEBUG"]) console.log(`  ${name}(${JSON.stringify(input).slice(0, 160)}) -> ${JSON.stringify(r.content).slice(0, 300)}`);
    return (r.content ?? {}) as Env;
  };
}

/** Look a missing fact up the way a model would, with tools. Each returns undefined when no tool can supply it. */
export async function* agentIdOf(f: Facts, use: Use): AsyncGenerator<DriverEvent, string | undefined> {
  if (f.agentId) return f.agentId;
  const r = yield* use("agents_list", {});
  const hit = (r.data?.agents as Array<{ agentId: string; name: string }> | undefined)?.find((a) => a.name === f.agentName);
  if (hit) f.agentId = hit.agentId;
  return f.agentId;
}

export async function* zoneOf(f: Facts, use: Use): AsyncGenerator<DriverEvent, string | undefined> {
  if (f.tz) return f.tz;
  const r = yield* use("settings_get", { key: "profile.timezone" });
  const v = r.data?.row?.value;
  if (typeof v === "string") f.tz = v;
  return f.tz;
}

/** Whole-hour offset of a zone from UTC, right now. */
export function offsetHours(zone: string, at = Date.now()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const g = (t: string): number => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
  return Math.round((asUtc - at) / 3_600_000);
}

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Cron fields for "weekday at hour:00 in zone", in UTC when `utc` (day moves when the hour crosses midnight), else as the person said it. */
export function cronFor(weekday: string, hour: number, zone: string | undefined, utc: boolean): string {
  let dow = DOW.indexOf(weekday);
  let h = hour;
  if (utc && zone) {
    h = hour - offsetHours(zone);
    while (h < 0) { h += 24; dow = (dow + 6) % 7; }
    while (h > 23) { h -= 24; dow = (dow + 1) % 7; }
  }
  return `0 ${h} * * ${dow}`;
}
