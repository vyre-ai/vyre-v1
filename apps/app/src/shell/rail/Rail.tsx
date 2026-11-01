// The rail (spec 3.0): fixed beside the sheets, the Space tile at the top, then the Kit's places in one soft track and the bottom group in another below a spacer, with the person's own face at its foot.
// The open place carries the accent wash; a coral dot says something is waiting. Every button has a click, a hover, a right-click menu (open in a new tab)
// and keyboard focus with Enter or Space. Colours are skin tokens, so a skin switch repaints with no re-render.
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { menuTrigger, useMenu } from "../../../../../ui/src/Menu/index.tsx";
import { sq } from "../../../../../ui/src/SidePane/host.tsx";
import { Tooltip } from "../../../../../ui/src/Tooltip/index.tsx";
import { ShellIcon, iconMarkup } from "./icons.tsx";
import type { PlaceId, RailEntry, RailGroups } from "./kits.ts";

export const RAIL_WIDTH = 60;

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
  /** The person's own face, at the foot of the lower track. */
  foot?: ReactNode;
  /** The phone: the rail lies along the bottom of the screen. The top group's places are the bar; the bottom group's places sit behind a "More" button (a menu anchored to it). */
  bottom?: boolean;
}

export function Rail({ groups, active, onSelect, onOpenInTab, onPrefetch, header, foot, bottom }: RailProps): ReactElement {
  const { element, show } = useMenu();
  const button = (e: RailEntry): ReactElement => (
    <RailButton
      key={e.place}
      entry={e}
      flat={bottom === true}
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
    // The bar is the prototype's five places; the bottom group sits behind More.
    const barPlaces: readonly PlaceId[] = ["chats", "inbox", "records", "files"];
    const inBar = (e: RailEntry): boolean => barPlaces.includes(e.place);
    const barEntries = groups.top.filter(inBar);
    const more = [...groups.top.filter((e) => !inBar(e)), ...groups.bottom];
    const moreOn = more.some((e) => e.place === active);
    const openMore = (x: number, y: number): void => show(
      more.map((e) => ({ label: e.title, icon: iconMarkup(e.place), onSelect: () => onSelect(e.place), ...(e.place === active ? { checked: true } : {}) })),
      x, y, "context", { label: "More places" },
    );
    return (
      <View testID="shell-rail-bottom" accessibilityRole="navigation" aria-label="Places" style={styles.bar2}>
        {header}
        {buttons(barEntries)}
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
      <View testID="rail-track" style={styles.track} {...sq("track")}>{buttons(groups.top)}</View>
      <View style={styles.spacer} />
      <View testID="rail-track-foot" style={styles.track} {...sq("track")}>
        {buttons(groups.bottom)}
        {foot}
      </View>
      {element}
    </View>
  );
}

function RailButton({ entry, on, onPress, onPrefetch, trigger, flat = false }: { entry: RailEntry; on: boolean; flat?: boolean; onPress: () => void; onPrefetch?: (() => void) | undefined; trigger: Record<string, unknown> }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Tooltip text={entry.title}>
      <Pressable
        role="button"
        aria-label={entry.count > 0 ? `${entry.title}, ${entry.count} waiting` : entry.title}
        testID={on ? `rail-${entry.place}-selected` : `rail-${entry.place}`}
        onPress={onPress}
        onHoverIn={() => { setOver(true); onPrefetch?.(); }}
        onHoverOut={() => setOver(false)}
        onFocus={() => onPrefetch?.()}
        style={[styles.button, flat ? styles.flat : null, over && !on ? styles.over : null, on ? styles.on : null]}
        {...sq("tile")}
        {...(on ? { "aria-current": "page" as const } : {})}
        {...trigger}
      >
        <ShellIcon name={entry.place} size={18} color={on ? "var(--accent)" : over ? "var(--ink)" : "var(--ink-3)"} />
        {entry.count > 0 ? <View testID={`rail-count-${entry.place}`} style={styles.dot} /> : null}
        {entry.dot ? <View testID={`rail-dot-${entry.place}`} style={styles.dot} /> : null}
      </Pressable>
    </Tooltip>
  );
}

const styles = StyleSheet.create({
  rail: { width: RAIL_WIDTH, flexShrink: 0, alignItems: "center", gap: 8, paddingTop: 2 },
  track: { gap: 3, padding: 5, borderRadius: 19, backgroundColor: "var(--side)" as string },
  bar2: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", height: 56, paddingHorizontal: 6, backgroundColor: "var(--rail)" as string, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  spacer: { flexGrow: 1 },
  button: { width: 38, height: 38, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  flat: { width: 44, height: 44 },
  over: { backgroundColor: "var(--hover)" as string },
  on: { backgroundColor: "var(--accent-wash)" as string },
  dot: { position: "absolute", top: 4, right: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: "var(--beacon)" as string, ...({ boxShadow: "0 0 0 2px var(--side)" } as object) },
});
