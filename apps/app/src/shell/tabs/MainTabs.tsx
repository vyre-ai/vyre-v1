// The main-view tab strip (spec 3.0): ui/TabStrip bound to one Space's tab controller. Click selects, the x or middle-click closes, drag or Alt-Arrow reorders,
// the "+" (or Cmd-T) opens a new tab with one search. The tab menu gets "Open in Place" for an item tab; ui/Menu appends Report a problem.
import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { TabStrip } from "../../../../../ui/src/TabStrip/index.tsx";
import type { TabSpec } from "../../../../../ui/src/TabStrip/index.tsx";
import { PLACE_TITLE } from "../rail/kits.ts";
import type { PlaceId } from "../rail/kits.ts";
import type { TabEntry, TabsController, TabsState } from "./store.ts";

export function useTabs(controller: TabsController): TabsState {
  return useSyncExternalStore(controller.subscribe, controller.state, controller.state);
}

export function tabSpecs(tabs: readonly TabEntry[]): TabSpec[] {
  const out: TabSpec[] = [];
  for (const t of tabs) out.push({ key: t.key, title: t.title, ...(t.pinned === true ? { pinned: true } : {}) });
  return out;
}

export interface MainTabsProps {
  controller: TabsController;
  /** The selected tab changed place or item: the shell shows it. */
  onNavigate?: (tab: TabEntry) => void;
  /** The "+" and Cmd-T. The shell opens the new tab; this only tells it. */
  onNewTab?: () => void;
  onGoToPlace?: (place: PlaceId) => void;
}

export function MainTabs({ controller, onNavigate, onNewTab, onGoToPlace }: MainTabsProps): ReactElement {
  const state = useTabs(controller);
  const find = (key: string): TabEntry | undefined => state.tabs.find((t) => t.key === key);
  return (
    <TabStrip
      label="Open tabs"
      tabs={tabSpecs(state.tabs)}
      active={state.active}
      onSelect={(key) => {
        controller.select(key);
        const tab = find(key);
        if (tab !== undefined && onNavigate !== undefined) onNavigate(tab);
      }}
      onClose={(key) => {
        controller.close(key);
        const now = controller.state();
        const tab = now.tabs.find((t) => t.key === now.active);
        if (tab !== undefined && onNavigate !== undefined) onNavigate(tab);
      }}
      onReorder={(keys) => controller.reorder(keys)}
      onPlus={() => (onNewTab === undefined ? controller.newTab(find(state.active)?.place ?? "home") : onNewTab())}
      plusTitle="New tab (Cmd-T)"
      menu={(key) => {
        const tab = find(key);
        if (tab === undefined || tab.hash === undefined || onGoToPlace === undefined) return [];
        // ui/TabStrip reads onSelect from an extra when present (its frozen type lists label and icon only)
        const extra = { label: `Open in ${PLACE_TITLE[tab.place]}`, onSelect: () => onGoToPlace(tab.place) };
        return [extra];
      }}
    />
  );
}
