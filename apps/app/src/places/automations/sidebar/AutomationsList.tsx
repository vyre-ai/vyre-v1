// The left side as ONE list (design 2.6): his Automations, what needs him first, a dot for the state and a quiet scope word. A row opens that Automation. No Failed runs, Templates, Watching, Analytics, Dependencies, Event Explorer or Packages rows.
import type { ReactElement } from "react";
import { SIDEBAR, useAutomationsData, useScreenQuery } from "../canvas/data.tsx";
import type { ListRowIn } from "../list/model.ts";
import { ListView } from "../screens/ListView.tsx";
import { needsYou } from "./model.ts";
import type { AutoRow, JourneyRow } from "./model.ts";

export const listRowOf = (a: AutoRow, me: string): ListRowIn => ({
  id: a.id,
  name: a.name,
  state: needsYou(a) ? "needs" : a.status === "on" ? "on" : "off",
  scope: a.kind === "space" ? "Space" : a.ownerId !== me ? "Shared" : null,
});

export function AutomationsList({
  selectedId,
  query,
  onChoose,
}: {
  selectedId: string | null;
  query: string;
  onChoose(): void;
}): ReactElement | null {
  const data = useAutomationsData();
  const list = useScreenQuery<{ automations: readonly AutoRow[] }>(SIDEBAR, "automations", {});
  // a Journey is a row in the same list (design 2.2), opened in its own record-by-stage view
  const journeys = useScreenQuery<{ journeys: readonly JourneyRow[] }>(SIDEBAR, "journeys", {});
  if (list.status !== "ready") return null;
  const journeyIds = new Set(journeys.status === "ready" ? journeys.data.journeys.map((j) => j.id) : []);
  const journeyRows: ListRowIn[] =
    journeys.status === "ready"
      ? journeys.data.journeys.map((j) => ({ id: j.id, name: j.name, state: "off", scope: "Journey" }))
      : [];
  return (
    <ListView
      rows={[...list.data.automations.map((a) => listRowOf(a, data.me.id)), ...journeyRows]}
      query={query}
      selectedId={selectedId}
      onHome={onChoose}
      onOpen={(id) => {
        if (journeyIds.has(id)) data.nav.openJourney(id);
        else data.nav.openAutomation(id);
        onChoose();
      }}
    />
  );
}
