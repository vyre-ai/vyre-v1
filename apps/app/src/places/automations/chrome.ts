// Labels the Automation Studio screens share. The UI imports these. Empty screens stay empty.

export const STUDIO_NAV = [
  { id: "automations", label: "Automations" },
  { id: "needs", label: "Needs you" },
  { id: "runs", label: "All runs" },
  { id: "events", label: "Live Event Explorer" },
  { id: "analytics", label: "Analytics" },
  { id: "dependencies", label: "Dependencies" },
  { id: "packages", label: "Packages" },
] as const;

export type StudioView = (typeof STUDIO_NAV)[number]["id"];

export const BUILDER_MODES = ["Basic", "Advanced"] as const;
export type BuilderMode = "basic" | "advanced";

export const INSPECTOR_TABS = ["Configure", "Data", "Test"] as const;
export type InspectorTab = "configure" | "data" | "test";

export const DATA_SHELF_NAME = "Universal Data Shelf";
export const SHELF_SEARCH = "Search fields and values";
export const ABSENCE = ["Missing", "Null", "Empty"] as const;
export const VAL_LABEL = "Advanced · VAL representation";
export const NO_OUTWARD_EFFECT = "No outward effect. Writes and sends stay stubbed.";
export const DRAFT_HAS_EDITS = "Draft has edits";
export const PINNED_ENROLLMENTS = "New enrollments only";
export const PARALLEL_JOIN = "Join after child Runs complete";
export const LOOP_CHILD = "Each iteration is a child Run";

export const NEEDS_LINE = "Only decisions and missing human input.";
export const ALL_RUNS_LINE = "Every enrollment across the Space, searchable by subject, automation, or status.";
export const ALL_RUNS_SEARCH = "Search runs";
export const EVENTS_LINE = "Watch real events and their typed payloads.";
export const LISTENING = "Listening";
export const EMPTY_EVENTS = "Listening for events. A trigger event will show here when one is published. None have arrived.";
export const ANALYTICS_LINE = "Outcomes for this Automation.";
export const SPACE_ANALYTICS_TITLE = "Automation analytics";
export const SPACE_ANALYTICS_LINE = "The operational home for every Automation in this Space.";
export const EMPTY_COMPLETED = "No completed Runs yet";
export const DEPS_LINE = "See what breaks before changing a field, connection, template, sub-Automation or capability.";
export const EMPTY_DEPENDENCIES = "Choose a dependency. This fills when an Automation names another Automation, a mailbox, a number, or a connection. None are recorded yet.";
export const PACKAGES_LINE = "Export a definition, schemas, fixtures and dependency manifest without secrets.";
export const EMPTY_PACKAGES = "No packages. Installed automation packages will list here when the catalog has any.";

const ACTIVE_RUN = new Set(["queued", "running", "waiting"]);
const UNNAMED_ACCOUNT = new Set(["No accounts yet", "Choose an account"]);

/** A count renders only when the list actually has one. */
export function needsBadge(count: number | null | undefined): string | null {
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) return null;
  return String(count);
}

/** Lane chip on a parallel card. The lane is a child Run. No run id is invented. */
export function parallelLaneMark(label: string): string {
  const name = label.trim() || "Lane";
  return `${name} · child Run`;
}

/** Names a saved connection. A picker that has not chosen one stays quiet. */
export function accountFixedLine(value: string | null | undefined): string | null {
  if (!value) return null;
  const name = value.trim();
  if (!name || UNNAMED_ACCOUNT.has(name)) return null;
  return `Saved connection ${name}. It does not switch by itself.`;
}

/** Tool-row crumb. The pin clause appears only when a loaded run list has work still going. */
export function definitionCrumb(input: { status?: string; dirty?: boolean; pinned?: boolean }): string {
  const draft = input.dirty === true || input.status === "draft";
  const live = !draft && input.status === "on";
  const word = draft ? "Draft" : live ? "Live" : "Current";
  const base = `Current definition ${word}`;
  return input.pinned === true ? `${base} · ${PINNED_ENROLLMENTS}` : base;
}

export function enrollmentsPinned(runs: readonly { status?: string }[] | undefined, ready: boolean): boolean {
  if (!ready || !runs) return false;
  return runs.some((run) => typeof run.status === "string" && ACTIVE_RUN.has(run.status));
}
