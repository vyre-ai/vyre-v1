// ui/Plan types: the prototype's mountPlanIn timeline (VyreUI.plan, view "timeline"), as one shared component.
// A task is a bar from its start to its end day; a milestone is one day. Dates travel as ISO "2026-10-24" strings, so the host never sees day numbers.

export type PlanStatus = "todo" | "doing" | "blocked" | "review" | "approval" | "done";

export interface PlanWho {
  name: string;
  kind: "person" | "agent" | "group" | "role";
}

export interface PlanStage {
  id: string;
  name: string;
}

export interface PlanTask {
  id: string;
  stage: string;
  kind: "task" | "milestone";
  title: string;
  /** ISO date. */
  start: string;
  /** ISO date; a milestone has none. */
  end?: string;
  assigned?: PlanWho | null;
  status?: PlanStatus;
  /** Free text the host shows ("2d"). */
  effort?: string;
  /** Ids of the tasks this one waits on. */
  deps?: readonly string[];
  /** A pinned date: the cascade never moves it. */
  fixed?: boolean;
}

export interface PlanProps {
  /** Today, ISO. */
  today: string;
  stages: readonly PlanStage[];
  tasks: readonly PlanTask[];
  /** Everyone a task can be reassigned to. Without it the menu has no Reassign. */
  people?: readonly PlanWho[];
  /** Called with the whole list and a sentence saying what changed, after every edit (drag, nudge, done, reassign, apply a slip, undo). */
  onChange?: (tasks: PlanTask[], reason: string) => void;
  onOpenTask?: (task: PlanTask) => void;
  /** Adds Delete to the menu and Cmd-Backspace. */
  onDelete?: (ids: readonly string[]) => void;
  /** Height of the chart in px; the chart scrolls inside it. */
  height?: number;
  testID?: string;
}
