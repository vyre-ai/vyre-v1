// The left side as ONE list (design 2.6): his Automations, what needs him first, a dot for the state and a quiet scope word. A row opens that Automation. No Failed runs, Templates, Watching, Analytics, Dependencies, Event Explorer or Packages rows.
import type { ReactElement } from "react";
import { SIDEBAR, useAutomationsData, useScreenQuery } from "../canvas/data.tsx";
import type { ListRowIn } from "../list/model.ts";
import { ListView } from "../screens/ListView.tsx";
import { needsYou } from "./model.ts";
import type { AutoRow } from "./model.ts";

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
  if (list.status !== "ready") return null;
  return (
    <ListView
      rows={list.data.automations.map((a) => listRowOf(a, data.me.id))}
      query={query}
      selectedId={selectedId}
      onHome={onChoose}
      onOpen={(id) => {
        data.nav.openAutomation(id);
        onChoose();
      }}
    />
  );
}
