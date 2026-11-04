// The one overflow tab strip logic, shared by the Chats right pane and the agent page: fit what the width allows, fold the rest behind a More tab, open its menu.
// The strip itself is ui/TabStrip (the pane draws it through ui/SidePane); only the choice of tabs and the More menu live here, so the two places cannot drift.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { MORE_KEY, TAB_EXTRA, fitTabs, tabWidth } from "./model.ts";

/** Real text widths, by tab title, measured by onLayout of a hidden row set in the strip's own type. Until they arrive the fit uses the model's estimate. */
export function useTitleWidths(): { widths: ReadonlyMap<string, number>; set(title: string, w: number): void } {
  const [widths, setWidths] = useState<ReadonlyMap<string, number>>(new Map());
  return { widths, set: (title, w) => setWidths((cur) => (cur.get(title) === w ? cur : new Map(cur).set(title, w))) };
}

/** The hidden row that measures tab titles at the strip's 12.5 px type; it takes no room and takes no touches. */
export function TabMeasure({ titles, onWidth }: { titles: readonly string[]; onWidth(title: string, w: number): void }): ReactElement | null {
  // Drawn after mount only: the static export and server render keep the model's estimate and carry no hidden copy of the titles.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  const items: ReactElement[] = [];
  for (const t of titles) items.push(<Text key={t} testID={`measure-${t}`} numberOfLines={1} onLayout={(e) => onWidth(t, Math.ceil(e.nativeEvent.layout.width))} style={ms.text}>{t}</Text>);
  return <View pointerEvents="none" aria-hidden style={ms.row}>{items}</View>;
}
const ms = StyleSheet.create({
  row: { position: "absolute", left: 0, top: 0, opacity: 0, flexDirection: "row", height: 0, overflow: "hidden" },
  text: { fontSize: 12.5, lineHeight: 16, fontWeight: "500" },
});

/** The down chevron that folds the rest of the tabs, as the prototype draws it. */
export const CHEVRON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';

export interface FitMenu { show(entries: MenuEntry[], x: number, y: number, kind: "other"): void }

/**
 * The tabs to draw at `width` (the strip's own width, the same number fitTabs takes) and the select handler that opens the More menu for the folded ones.
 * `left` is the strip's left edge in the window; the menu opens just under the More tab, which is the last one drawn.
 */
export function useFittedTabs<K extends string>(
  tabs: readonly { key: K; title: string }[], active: K, width: number,
  o: { menu: FitMenu; left: number; top: number; pick(key: K): void; chrome?: number; measured?: ReadonlyMap<string, number>; extra?: number; chevron?: boolean },
): { strip: readonly { key: string; title: string; pinned?: boolean; label?: string; iconOnly?: boolean; icon?: string }[]; select(key: string): void } {
  const measured = o.measured;
  /** What a tab adds around its text: the strip's own (TAB_EXTRA, with a close slot) unless the caller has tabs without one. */
  const extra = o.extra ?? TAB_EXTRA;
  const widthOf = useMemo(() => (title: string): number => { const w = measured?.get(title); return w === undefined ? tabWidth(title) : w + extra; }, [measured, extra]);
  const fitted = useMemo(() => fitTabs(tabs, active, width, { ...(o.chrome !== undefined ? { chrome: o.chrome } : {}), widthOf }), [tabs, active, width, o.chrome, widthOf]);
  const strip = fitted.hidden.length === 0 ? tabs : [...fitted.shown, o.chevron === true ? { key: MORE_KEY, title: "More tabs", label: "More tabs", iconOnly: true, icon: CHEVRON, pinned: true } : { key: MORE_KEY, title: "More", pinned: o.extra !== undefined }];
  const select = (key: string): void => {
    if (key === MORE_KEY) {
      const rest: MenuEntry[] = fitted.hidden.map((t) => ({ label: t.title, onSelect: () => o.pick(t.key) }));
      const x = o.left + fitted.shown.reduce((n, t) => n + widthOf(t.title), 0);
      o.menu.show(rest, Math.max(0, x), o.top, "other");
      return;
    }
    const hit = tabs.find((t) => t.key === key);
    if (hit) o.pick(hit.key);
  };
  return { strip, select };
}
