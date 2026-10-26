// The rail (spec 3.0): the Space tile at the top, then the Kit's places; the bottom group sits below a spacer. The open place carries the quiet selected
// state with a bar on the left edge; a count or a dot says something is waiting. Every button has a click, a hover, a right-click menu (open in a new tab)
// and keyboard focus with Enter or Space. Colours are skin tokens, so a skin switch repaints with no re-render.
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { menuTrigger, useMenu } from "../../../../../ui/src/Menu/index.tsx";
import { ShellIcon, iconMarkup } from "./icons.tsx";
import type { PlaceId, RailEntry, RailGroups } from "./kits.ts";

export const RAIL_WIDTH = 56;

export interface RailProps {
  groups: RailGroups;
  active: PlaceId;
  onSelect: (place: PlaceId) => void;
  /** Cmd-click and the right-click menu open the place as a tab beside the current one. */
  onOpenInTab?: (place: PlaceId) => void;
  /** Pointer-enter or keyboard focus on a place: the session reads that place's first queries ahead of the click. Idempotent, safe on every hover. */
  onPrefetch?: (place: PlaceId) => void;
  /** The Space tile, drawn above the places. */
  header?: ReactNode;
  /** The phone: the rail lies along the bottom of the screen. The top group's places are the bar; the bottom group's places sit behind a "More" button (a menu anchored to it). */
  bottom?: boolean;
}

export function Rail({ groups, active, onSelect, onOpenInTab, onPrefetch, header, bottom }: RailProps): ReactElement {
  const { element, show } = useMenu();
  const button = (e: RailEntry): ReactElement => (
    <RailButton
      key={e.place}
      entry={e}
      on={e.place === active}
      onPress={() => onSelect(e.place)}
      onPrefetch={onPrefetch === undefined ? undefined : () => onPrefetch(e.place)}
      trigger={menuTrigger((x, y) => show(
        [
          { label: `Open ${e.title}`, icon: iconMarkup(e.place), onSelect: () => onSelect(e.place) },
          ...(onOpenInTab === undefined ? [] : [{ label: "Open in New Tab", icon: iconMarkup("join"), onSelect: () => onOpenInTab(e.place) }]),
        ],
        x, y, "context", { label: e.title },
      ))}
    />
  );
  const buttons = (entries: readonly RailEntry[]): ReactElement[] => {
    const out: ReactElement[] = [];
    for (const e of entries) out.push(button(e));
    return out;
  };
  if (bottom === true) {
    const more = groups.bottom;
    const moreOn = more.some((e) => e.place === active);
    const openMore = (x: number, y: number): void => show(
      more.map((e) => ({ label: e.title, icon: iconMarkup(e.place), onSelect: () => onSelect(e.place), ...(e.place === active ? { checked: true } : {}) })),
      x, y, "context", { label: "More places" },
    );
    return (
      <View testID="shell-rail-bottom" accessibilityRole="navigation" aria-label="Places" style={styles.bar2}>
        {header}
        {buttons(groups.top)}
        {more.length === 0 ? null : (
          <Pressable
            role="button" aria-label="More places" aria-haspopup="menu" testID="rail-more"
            onPress={(e) => {
              const box = (e as unknown as { currentTarget?: { getBoundingClientRect?: () => { left: number; top: number } } }).currentTarget?.getBoundingClientRect?.();
              openMore(box?.left ?? 0, box?.top ?? 0);
            }}
            style={[styles.button, moreOn ? styles.on : null]}
            {...menuTrigger(openMore)}
          >
            <ShellIcon name="more" color={moreOn ? "var(--ink)" : "var(--ink-3)"} />
          </Pressable>
        )}
        {element}
      </View>
    );
  }
  return (
    <View testID="shell-rail" accessibilityRole="navigation" aria-label="Places" style={styles.rail}>
      {header}
      {buttons(groups.top)}
      <View style={styles.spacer} />
      {buttons(groups.bottom)}
      {element}
    </View>
  );
}

function RailButton({ entry, on, onPress, onPrefetch, trigger }: { entry: RailEntry; on: boolean; onPress: () => void; onPrefetch?: (() => void) | undefined; trigger: Record<string, unknown> }): ReactElement {
  const [over, setOver] = useState(false);
  const web = Platform.OS === "web" ? { title: entry.title } : {};
  return (
    <Pressable
      role="button"
      aria-label={entry.count > 0 ? `${entry.title}, ${entry.count} waiting` : entry.title}
      testID={on ? `rail-${entry.place}-selected` : `rail-${entry.place}`}
      onPress={onPress}
      onHoverIn={() => { setOver(true); onPrefetch?.(); }}
      onHoverOut={() => setOver(false)}
      onFocus={() => onPrefetch?.()}
      style={[styles.button, over && !on ? styles.over : null, on ? styles.on : null]}
      {...(on ? { "aria-current": "page" as const } : {})}
      {...trigger}
      {...web}
    >
      {on ? <View testID="rail-bar" style={styles.bar} /> : null}
      <ShellIcon name={entry.place} color={on || over ? "var(--ink)" : "var(--ink-3)"} />
      {entry.count > 0 ? <View testID={`rail-count-${entry.place}`} style={styles.count}><Text style={styles.countText}>{entry.count > 99 ? "99+" : entry.count}</Text></View> : null}
      {entry.dot ? <View testID={`rail-dot-${entry.place}`} style={styles.dot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rail: { width: RAIL_WIDTH, flexShrink: 0, alignItems: "center", gap: 2, paddingTop: 10, paddingBottom: 12, backgroundColor: "var(--rail)" as string, borderRightWidth: 1, borderRightColor: "var(--line)" as string },
  bar2: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", height: 56, paddingHorizontal: 6, backgroundColor: "var(--rail)" as string, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  spacer: { flexGrow: 1 },
  button: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  over: { backgroundColor: "var(--hover)" as string },
  on: { backgroundColor: "var(--sel)" as string },
  bar: { position: "absolute", left: -8, top: 10, bottom: 10, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: "var(--ink)" as string },
  count: { position: "absolute", top: 3, right: 2, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent)" as string },
  countText: { fontSize: 10, fontWeight: "700", color: "var(--accent-ink)" as string },
  dot: { position: "absolute", top: 7, right: 7, width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--accent)" as string, borderWidth: 2, borderColor: "var(--rail)" as string },
});
