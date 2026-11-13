// The one overflow tab strip logic, shared by the Chats right pane and the agent page: fit what the width allows, fold the rest behind a More tab, open its menu.
// The strip itself is ui/TabStrip (the pane draws it through ui/SidePane); only the choice of tabs and the More menu live here, so the two places cannot drift.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { anchorOfFocus } from "../mounts/route.ts";
import { MORE_KEY, TAB_EXTRA, fitTabs, tabWidth } from "./model.ts";

/** Real text widths, by tab title, measured by onLayout of a hidden row set in the strip's own type. Until they arrive the fit uses the model's estimate. */
export function useTitleWidths(): { widths: ReadonlyMap<string, number>; set(title: string, w: number): void } {
  const [widths, setWidths] = useState<ReadonlyMap<string, number>>(new Map());
  return { widths, set: (title, w) => setWidths((cur) => (cur.get(title) === w ? cur : new Map(cur).set(title, w))) };
}

/** The hidden row that measures tab titles at the strip's 12.5 px type; it takes no room and takes no touches. */
export function TabMeasure({
  titles,
  onWidth,
}: {
  titles: readonly string[];
  onWidth(title: string, w: number): void;
}): ReactElement | null {
  // Drawn after mount only: the static export and server render keep the model's estimate and carry no hidden copy of the titles.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  const items: ReactElement[] = [];
  for (const t of titles)
    items.push(
      <Text
        key={t}
        testID={`measure-${t}`}
        numberOfLines={1}
        onLayout={(e) => onWidth(t, Math.ceil(e.nativeEvent.layout.width))}
        style={ms.text}
      >
        {t}
      </Text>,
    );
  return (
    <View pointerEvents="none" aria-hidden style={ms.row}>
      {items}
    </View>
  );
}
const ms = StyleSheet.create({
  row: { position: "absolute", left: 0, top: 0, opacity: 0, flexDirection: "row", height: 0, overflow: "hidden" },
  text: { fontSize: 12.5, lineHeight: 16, fontWeight: "500" },
});

/** The down chevron that folds the rest of the tabs, as the prototype draws it. */
export const CHEVRON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';

/** Three dots: the one overflow of a pane's tabs. */
export const DOTS =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>';

/** The control that was pressed last (a mouse or touch press, or Enter or Space on it), as the browser said it: the menu opens at it, not at whatever has the focus (Safari does not focus a button on a click). */
let pressed: { target: unknown; at: number } | null = null;
export const notePress = (target: unknown, at: number = Date.now()): void => {
  pressed = { target, at };
};
type Box = { left: number; bottom: number; width: number; height: number };
type Pressable = { closest?(sel: string): Pressable | null; getBoundingClientRect?(): Box };
/** Just under the control that was pressed (the More tab it belongs to), when it was pressed a moment ago; null when none was. */
export function pressedAnchor(now: number = Date.now()): { x: number; y: number } | null {
  if (!pressed || now - pressed.at > 1500) return null;
  const el = pressed.target as Pressable | null;
  const control = el?.closest?.('[aria-label="More tabs"], [role="tab"], button') ?? el;
  const box = control?.getBoundingClientRect?.();
  return box && (box.width > 0 || box.height > 0) ? { x: box.left, y: box.bottom + 4 } : null;
}
let tracking = false;
function trackPresses(): void {
  const doc = (
    globalThis as {
      document?: {
        addEventListener(t: string, f: (e: { target?: unknown; key?: string }) => void, capture: boolean): void;
      };
    }
  ).document;
  if (tracking || !doc) return;
  tracking = true;
  doc.addEventListener("pointerdown", (e) => notePress(e.target), true);
  doc.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter" || e.key === " ") notePress(e.target);
    },
    true,
  );
}

export interface FitMenu {
  show(entries: MenuEntry[], x: number, y: number, kind: "other"): void;
}

/**
 * The tabs to draw at `width` (the strip's own width, the same number fitTabs takes) and the select handler that opens the More menu for the folded ones.
 * The menu opens just under the More tab that was pressed (read from the focused control); `left` and `top` are the fallback when nothing is focused: the strip's left edge in the window, and its row.
 */
export function useFittedTabs<K extends string>(
  tabs: readonly { key: K; title: string }[],
  active: K,
  width: number,
  o: {
    menu: FitMenu;
    left: number;
    top: number;
    pick(key: K): void;
    chrome?: number;
    measured?: ReadonlyMap<string, number>;
    extra?: number;
    chevron?: boolean;
    dots?: boolean;
  },
): {
  strip: readonly { key: string; title: string; pinned?: boolean; label?: string; iconOnly?: boolean; icon?: string }[];
  select(key: string): void;
} {
  useEffect(trackPresses, []);
  const measured = o.measured;
  /** What a tab adds around its text: the strip's own (TAB_EXTRA, with a close slot) unless the caller has tabs without one. */
  const extra = o.extra ?? TAB_EXTRA;
  const widthOf = useMemo(
    () =>
      (title: string): number => {
        const w = measured?.get(title);
        return w === undefined ? tabWidth(title) : w + extra;
      },
    [measured, extra],
  );
  const fitted = useMemo(
    () => fitTabs(tabs, active, width, { ...(o.chrome !== undefined ? { chrome: o.chrome } : {}), widthOf }),
    [tabs, active, width, o.chrome, widthOf],
  );
  const strip =
    fitted.hidden.length === 0
      ? tabs
      : [
          ...fitted.shown,
          o.dots === true
            ? { key: MORE_KEY, title: "More tabs", label: "More tabs", iconOnly: true, icon: DOTS, pinned: true }
            : o.chevron === true
              ? { key: MORE_KEY, title: "More tabs", label: "More tabs", iconOnly: true, icon: CHEVRON, pinned: true }
              : { key: MORE_KEY, title: "More", pinned: o.extra !== undefined },
        ];
  const select = (key: string): void => {
    if (key === MORE_KEY) {
      const rest: MenuEntry[] = fitted.hidden.map((t) => ({ label: t.title, onSelect: () => o.pick(t.key) }));
      // the menu opens where the control was pressed: just under the More tab that was pressed (the press itself, else the focus). The window position worked out from the tabs' widths is only for a press that left no focus to read.
      const guess = { x: Math.max(0, o.left + fitted.shown.reduce((n, t) => n + widthOf(t.title), 0)), y: o.top };
      const at = pressedAnchor() ?? anchorOfFocus(guess);
      o.menu.show(rest, at.x, at.y, "other");
      return;
    }
    const hit = tabs.find((t) => t.key === key);
    if (hit) o.pick(hit.key);
  };
  return { strip, select };
}
