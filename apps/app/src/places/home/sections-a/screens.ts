// Screen index for the five Home sections in this packet. Field for field with generated/screens.ts
// (home.needs-you-top3, tasks.my-work, home.projects-at-risk, home.away-digest, home.routines-today).
// apps may not import generated/, so the hook map is held here. The manifest is frozen.

export interface HomeQuery {
  cap: string;
  input: Record<string, string>;
  live: boolean;
}

export interface HomeAction {
  cap: string;
  input: Record<string, string>;
  confirm?: string;
}

export interface HomeScreenEntry {
  id: string;
  module: string;
  place: string;
  slot: string;
  builtin: string | null;
  caller: string;
  queries: Record<string, HomeQuery>;
  actions: Record<string, HomeAction>;
  needs: string[];
  perf: { firstPaintMs: number; completeMs: number } | null;
}

function entry(
  id: string,
  module: string,
  builtin: string,
  queries: Record<string, HomeQuery>,
  actions: Record<string, HomeAction>,
): HomeScreenEntry {
  return {
    id,
    module,
    place: "home",
    slot: "main",
    builtin,
    caller: "principal",
    queries,
    actions,
    needs: [],
    perf: { firstPaintMs: 50, completeMs: 100 },
  };
}

export const HOME_SCREEN_INDEX: ReadonlyMap<string, HomeScreenEntry> = new Map([
  ["home.needs-you-top3", entry("home.needs-you-top3", "home", "ui:NeedsYouTop3", {
    items: { cap: "tasks.needs_you", input: { limit: "/state/limit" }, live: true },
  }, {
    act: { cap: "tasks.act", input: { taskId: "/state/taskId", action: "/state/action", note: "/state/note" } },
  })],
  ["tasks.my-work", entry("tasks.my-work", "tasks", "ui:MyWork", {
    list: { cap: "tasks.my_work", input: { section: "/state/section" }, live: true },
  }, {
    assign: { cap: "tasks.assign", input: { taskId: "/state/taskId", slot: "/state/slot", to: "/state/to" } },
    create: { cap: "tasks.create", input: { kind: "/draft/kind", title: "/draft/title", assigned: "/draft/assigned", recordId: "/draft/recordId" } },
    transition: { cap: "tasks.transition", input: { taskId: "/state/taskId", to: "/state/to", note: "/state/note" } },
  })],
  ["home.projects-at-risk", entry("home.projects-at-risk", "home", "ui:ProjectsAtRisk", {
    projects: { cap: "home.at_risk", input: { limit: "/state/limit" }, live: true },
  }, {})],
  ["home.away-digest", entry("home.away-digest", "home", "ui:AwayDigest", {
    digest: { cap: "home.digest", input: {}, live: true },
    activity: { cap: "home.activity", input: { since: "/state/since", until: "/state/until", kinds: "/state/kinds" }, live: false },
  }, {
    seen: { cap: "home.mark_digest_seen", input: { digestId: "/state/digestId" } },
    undo: { cap: "runs.undo", input: { runId: "/state/runId" }, confirm: "Undo what this run changed?" },
    back: { cap: "notifications.away.clear", input: {} },
  })],
  ["home.routines-today", entry("home.routines-today", "home", "ui:RoutinesToday", {
    routines: { cap: "home.routines_today", input: {}, live: true },
  }, {})],
]);
