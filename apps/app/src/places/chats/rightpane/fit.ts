// The one overflow tab strip logic, shared by the Chats right pane and the agent page: fit what the width allows, fold the rest behind a More tab, open its menu.
// The strip itself is ui/TabStrip (the pane draws it through ui/SidePane); only the choice of tabs and the More menu live here, so the two places cannot drift.
import { useMemo } from "react";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { MORE_KEY, fitTabs, tabWidth } from "./model.ts";

export interface FitMenu { show(entries: MenuEntry[], x: number, y: number, kind: "other"): void }

/**
 * The tabs to draw at `width` (the strip's own width, the same number fitTabs takes) and the select handler that opens the More menu for the folded ones.
 * `left` is the strip's left edge in the window; the menu opens just under the More tab, which is the last one drawn.
 */
export function useFittedTabs<K extends string>(
  tabs: readonly { key: K; title: string }[], active: K, width: number, o: { menu: FitMenu; left: number; top: number; pick(key: K): void },
): { strip: readonly { key: string; title: string }[]; select(key: string): void } {
  const fitted = useMemo(() => fitTabs(tabs, active, width), [tabs, active, width]);
  const strip = fitted.hidden.length === 0 ? tabs : [...fitted.shown, { key: MORE_KEY, title: "More" }];
  const select = (key: string): void => {
    if (key === MORE_KEY) {
      const rest: MenuEntry[] = fitted.hidden.map((t) => ({ label: t.title, onSelect: () => o.pick(t.key) }));
      const x = o.left + fitted.shown.reduce((n, t) => n + tabWidth(t.title), 0);
      o.menu.show(rest, Math.max(0, x), o.top, "other");
      return;
    }
    const hit = tabs.find((t) => t.key === key);
    if (hit) o.pick(hit.key);
  };
  return { strip, select };
}
