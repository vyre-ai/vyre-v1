// Records views, part B: Calendar, Timeline, Map and Charts, and the list of kinds that part A's switch takes (`EXTRA_KINDS`).
import type { ExtraKind } from "../views-a/index.ts";
import { CalendarView } from "./CalendarView.tsx";
import { ChartsView } from "./ChartsView.tsx";
import { MapView } from "./MapView.tsx";
import { TimelineView } from "./TimelineView.tsx";

export { CalendarView } from "./CalendarView.tsx";
export { ChartsView, chartDefaults } from "./ChartsView.tsx";
export { MapView } from "./MapView.tsx";
export { TimelineView } from "./TimelineView.tsx";
export { TodayProvider, useToday } from "./today.tsx";
export { decideCascade, dropRecord, moveBar, moveError, patchRecord } from "./actions.ts";
export { useViewRows } from "./data.ts";
export * from "./model.ts";

/** Pass to `<RecordViews extraKinds={EXTRA_KINDS} />` to add the four kinds to the switch. */
export const EXTRA_KINDS: readonly ExtraKind[] = [
  { kind: "calendar", label: "Calendar", render: (ctx) => <CalendarView ctx={ctx} /> },
  { kind: "timeline", label: "Timeline", render: (ctx) => <TimelineView ctx={ctx} /> },
  { kind: "map", label: "Map", render: (ctx) => <MapView ctx={ctx} /> },
  { kind: "charts", label: "Charts", render: (ctx) => <ChartsView ctx={ctx} /> },
];
