// The main-view tab strip (spec 3.0): ui/TabStrip bound to one Space's tab controller. Click selects, the x or middle-click closes, drag or Alt-Arrow reorders,
// the "+" (or Cmd-T) opens a new tab with one search. The tab menu gets "Open in Place" for an item tab; ui/Menu appends Report a problem.
import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { TabStrip } from "../../../../../ui/src/TabStrip/index.tsx";
import type { TabSpec } from "../../../../../ui/src/TabStrip/index.tsx";
import { iconMarkup } from "../rail/icons.tsx";
import { PLACE_TITLE } from "../rail/kits.ts";
import type { PlaceId } from "../rail/kits.ts";
import { keysToTheRight } from "./store.ts";
import type { TabEntry, TabsController, TabsState } from "./store.ts";
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";
import { tabMenu } from "../../places/chats/menus/kinds-b.ts";
import { copyToClipboard, vyreLink } from "../../places/chats/menus/actions-b.ts";

export function useTabs(controller: TabsController): TabsState {
  return useSyncExternalStore(controller.subscribe, controller.state, controller.state);
}

export function tabSpecs(tabs: readonly TabEntry[]): TabSpec[] {
  const out: TabSpec[] = [];
  for (const t of tabs) out.push({ key: t.key, title: t.title, icon: iconMarkup(t.place), ...(t.pinned === true ? { pinned: true } : {}) });
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
  const goActive = (): void => {
    const now = controller.state();
    const tab = now.tabs.find((t) => t.key === now.active);
    if (tab !== undefined && onNavigate !== undefined) onNavigate(tab);
  };
  const closeKey = (key: string): void => { controller.close(key); goActive(); };
  /** The tab's whole menu (chats/menus/kinds-b.ts): what Close, Pin and Reopen mean for this tab now. */
  const entries = (key: string): MenuEntry[] => {
    const tab = find(key);
    if (tab === undefined) return [];
    const place = tab.hash !== undefined && onGoToPlace !== undefined ? [{ label: `Open in ${PLACE_TITLE[tab.place]}`, onSelect: () => onGoToPlace(tab.place) } as MenuEntry, { separator: true } as MenuEntry] : [];
    return [...place, ...tabMenu(
      { title: tab.title, pinned: tab.pinned === true, count: state.tabs.length, toTheRight: keysToTheRight(state, key).length, item: tab.hash !== undefined && tab.isNew !== true, canReopen: controller.canReopen() },
      {
        close: () => closeKey(key),
        closeOthers: () => { controller.closeMany(state.tabs.filter((t) => t.key !== key).map((t) => t.key)); controller.select(key); goActive(); },
        closeRight: () => { controller.closeRight(key); goActive(); },
        copyLink: () => copyToClipboard(vyreLink(tab.place, tab.hash ?? "")),
        pin: (on) => controller.pin(key, on),
        reopen: () => { controller.reopen(); goActive(); },
      },
    )];
  };
  return (
    <TabStrip
      label="Open tabs"
      hideLoneClose
      noOptions
      tabs={tabSpecs(state.tabs)}
      active={state.active}
      onSelect={(key) => {
        controller.select(key);
        const tab = find(key);
        if (tab !== undefined && onNavigate !== undefined) onNavigate(tab);
      }}
      onClose={closeKey}
      onReorder={(keys) => controller.reorder(keys)}
      onPlus={() => (onNewTab === undefined ? controller.newTab(find(state.active)?.place ?? "chats") : onNewTab())}
      plusTitle="New tab (Cmd-T)"
      entries={entries}
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
