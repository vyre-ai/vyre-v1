// The Journey as a path (rc.41): stage columns with the Automations of each stage, a strip that says how it starts and ends, where one record is on it, and a test of the whole path.
// Pure: the page draws what these return. The whole-path test is a small state machine (idle, starting, started, failed) so no press can leave it stuck.
import type { CapMap } from "../../../../../../generated/types.ts";
import { countOf, limitWords, plural, startRuleWords } from "./model.ts";
import type { Journey, StageCounts } from "./model.ts";

export type Where = CapMap["journeys.where"]["out"];
export type PathRun = CapMap["journeys.test_path"]["out"]["runs"][number];

export interface Card {
  id: string;
  name: string;
}
export interface Column {
  key: string;
  title: string;
  count: number;
  over: number;
  /** "2 days, then Maya is told", or "No limit". */
  limit: string;
  final: boolean;
  cards: Card[];
}

/** The columns, in stage order, each with its members' names (an Automation that is gone shows by what it was, never as a blank). */
export function columns(j: Journey, counts: StageCounts, name: (id: string) => string): Column[] {
  return [...j.stages]
    .sort((a, b) => a.order - b.order)
    .map((s) => {
      const c = countOf(counts, s.key);
      return {
        key: s.key,
        title: s.title,
        count: c.count,
        over: c.over,
        limit: s.timeLimit ? limitWords(s.timeLimit, name) : "No limit",
        final: s.final === true,
        cards: s.automations.map((id) => ({ id, name: name(id) || "An Automation" })),
      };
    });
}

/** The three facts on top of the page: how a record gets in, where it is finished, and what travels with it. */
export function strip(j: Journey): { starts: string; finishes: string; carried: string } {
  const done = [...j.stages].filter((s) => s.final).map((s) => s.title);
  return {
    starts: startRuleWords(j.startRule),
    finishes: done.length === 0 ? "Nowhere yet" : done.join(" or "),
    carried: j.variables && j.variables.length > 0 ? j.variables.map((v) => v.title).join(", ") : "Nothing",
  };
}

const days = (h: number): string => plural(Math.floor(h / 24), "day");
/** One line for a record's place on the path. */
export function whereLine(w: Where): string {
  if (w.completed) return `Finished in ${w.stageTitle}.`;
  const there = w.hoursIn < 24 ? `${plural(w.hoursIn, "hour")}` : days(w.hoursIn);
  if (w.limitHours === undefined) return `In ${w.stageTitle} for ${there}.`;
  if ((w.overByHours ?? 0) > 0)
    return `In ${w.stageTitle} for ${there}, ${w.overByHours! < 24 ? plural(w.overByHours!, "hour") : days(w.overByHours!)} past its limit.`;
  return `In ${w.stageTitle} for ${there} of ${w.limitHours % 24 === 0 ? days(w.limitHours) : plural(w.limitHours, "hour")}.`;
}

// ---- the whole-path test ----
// idle --start--> starting --started--> started --reset--> idle
//                    \--failed--> failed --start--> starting      (a press while starting is ignored: one test at a time)
export type PathTest =
  | { phase: "idle" }
  | { phase: "starting"; recordName?: string }
  | { phase: "started"; runs: readonly PathRun[]; recordName?: string }
  | { phase: "failed"; message: string };
export type PathTestEvent =
  | { type: "start"; recordName?: string }
  | { type: "started"; runs: readonly PathRun[] }
  | { type: "failed"; message: string }
  | { type: "reset" };

export function pathTest(s: PathTest, e: PathTestEvent): PathTest {
  switch (e.type) {
    case "start":
      return s.phase === "starting" ? s : { phase: "starting", ...(e.recordName ? { recordName: e.recordName } : {}) };
    case "started":
      return s.phase === "starting"
        ? { phase: "started", runs: e.runs, ...(s.recordName ? { recordName: s.recordName } : {}) }
        : s;
    case "failed":
      return s.phase === "starting" ? { phase: "failed", message: e.message } : s;
    case "reset":
      return { phase: "idle" };
  }
}

/** What the bar says once the tests have started. */
export function testLine(s: PathTest): string {
  if (s.phase === "starting") return "Starting the tests…";
  if (s.phase === "failed") return s.message;
  if (s.phase !== "started") return "";
  const bad = s.runs.filter((r) => r.error !== undefined).length;
  const on = s.recordName ? ` with ${s.recordName}` : "";
  if (s.runs.length === 0) return "No stage has an Automation to try yet.";
  return `Testing the whole path${on}: ${plural(s.runs.length - bad, "Automation")} started${bad ? `, ${bad} could not start` : ""}. Nothing is sent.`;
}
/** The test line for one Automation card: what happened to its test, or nothing when it was not tried. */
export const runOf = (s: PathTest, automationId: string, stage: string): PathRun | undefined =>
  s.phase === "started" ? s.runs.find((r) => r.automationId === automationId && r.stage === stage) : undefined;
