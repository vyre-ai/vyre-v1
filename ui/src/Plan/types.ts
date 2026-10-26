// ui/Plan types: the prototype's mountPlanIn timeline (VyreUI.plan, view "timeline"), as one shared component.
// A task is a bar from its start to its end day; a milestone is one day. Dates travel as ISO "2026-10-24" strings, so the host never sees day numbers.

export type PlanStatus = "todo" | "doing" | "blocked" | "review" | "approval" | "done";

export interface PlanWho {
  name: string;
  kind: "person" | "agent" | "group" | "role";
  /** The person's or agent's id: the face is seeded by it, so one person has one face everywhere (the name is the fallback). */
  id?: string;
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
  reviewer?: PlanWho | null;
  approver?: PlanWho | null;
  status?: PlanStatus;
  /** Free text the host shows ("2d"). */
  effort?: string;
  /** Ids of the tasks this one waits on. */
  deps?: readonly string[];
  /** A pinned date: the cascade never moves it. */
  fixed?: boolean;
}

export type PlanView = "timeline" | "board" | "list" | "calendar";

export interface PlanProps {
  /** Today, ISO. */
  today: string;
  /** The view it opens in (default timeline); the toolbar changes it and `viewKey` remembers the pick. */
  view?: PlanView;
  /** Where the view pick is remembered (the browser's localStorage under "vyre-ui:plan:<key>:view"). Without it nothing is remembered. */
  viewKey?: string;
  onViewChange?: (view: PlanView) => void;
  /** Adds the New task button and the stage "+" buttons. Return the task to add, or nothing to let the Plan make one ("New task", today to two days on, in that stage). */
  onAddTask?: (stageId: string | null) => PlanTask | undefined;
  /** The host makes the task (a capability call) and it comes back through `tasks`: New task and the stage "+" call this instead of inserting a task locally. Wins over onAddTask. */
  onCreate?: (stageId: string | null) => void;
  /** Hides the view switcher (a place that fixes the view). */
  fixedView?: boolean;
  /** Shows New task and the stage "+" buttons (default true). Home creates tasks in its own header and turns it off. */
  canAdd?: boolean;
  stages: readonly PlanStage[];
  tasks: readonly PlanTask[];
  /** Everyone a task can be reassigned to. Without it the menu has no Reassign. */
  people?: readonly PlanWho[];
  /** Called with the whole list and a sentence saying what changed, after every edit (drag, nudge, done, reassign, apply a slip, undo). */
  onChange?: (tasks: PlanTask[], reason: string) => void;
  onOpenTask?: (task: PlanTask) => void;
  /** Delete in the menu and Cmd-Backspace remove tasks and tell the host through onChange (default true). Home keeps its tasks and turns it off. */
  canDelete?: boolean;
  /** Height of the chart in px; the chart scrolls inside it. */
  height?: number;
  testID?: string;
}
