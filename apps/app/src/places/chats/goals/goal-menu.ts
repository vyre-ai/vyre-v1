// The goal's right-click menu, built the same on the goal page, on a goal card in a chat, and in the sidebar row (menus/kinds-b.ts goalMenu): its facts from the goal and who is asking, each item one capability call.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { goalMenu } from "../menus/kinds-b.ts";
import type { GoalFacts } from "../menus/kinds-b.ts";
import { copyToClipboard, vyreLink } from "../menus/actions-b.ts";
import type { Status } from "./model.ts";

/** The goal's state as the menu knows it. A draft has nothing to pause yet. */
export function menuStatus(s: Status): GoalFacts["status"] {
  switch (s) {
    case "paused": return "paused";
    case "stuck": return "stuck";
    case "done": return "done";
    case "missed": case "stopped": return "stopped";
    case "draft": return "done";
    default: return "running";
  }
}

export interface GoalMenuDeps {
  /** One capability call for this goal (goalId is added): the result says whether it went through. */
  run(cap: string, input: Record<string, unknown>, done?: string): Promise<unknown>;
  open?: (() => void) | undefined;
  /** Words from the person: Mark Stuck asks why, Report Progress asks what to say. */
  ask(kind: "stuck" | "report"): void;
}
export function goalMenuEntries(goal: { id: string; title: string; status: Status; owner: string }, me: string | undefined, d: GoalMenuDeps): MenuEntry[] {
  return goalMenu(
    { title: goal.title, status: menuStatus(goal.status), manage: me !== undefined && goal.owner === me },
    {
      ...(d.open ? { open: d.open } : {}),
      pause: () => void d.run("goals.pause", {}, "Paused. Nothing wakes until you resume."),
      resume: () => void d.run("goals.resume", {}, "Resumed"),
      markStuck: () => d.ask("stuck"),
      report: () => d.ask("report"),
      stop: () => void d.run("goals.stop", {}, "Stopped. Its open tasks were withdrawn."),
      copyLink: () => copyToClipboard(vyreLink("goal", goal.id)),
    },
  );
}

/** What a typed answer calls: stuck with its reason and the two ways on, or a report. */
export function askedCall(kind: "stuck" | "report", text: string): { cap: string; input: Record<string, unknown>; done: string } {
  return kind === "stuck"
    ? { cap: "goals.mark_stuck", input: { reason: text.slice(0, 400), options: ["Keep going", "Stop the goal"] }, done: "Marked stuck. It waits for your answer." }
    : { cap: "goals.report", input: { summary: text.slice(0, 600) }, done: "Reported in the goal chat" };
}
