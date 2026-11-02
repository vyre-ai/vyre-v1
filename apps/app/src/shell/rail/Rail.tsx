// The rail (spec 3.0): fixed beside the sheets, the Space tile at the top, then the Kit's main places in one soft track. At the foot one button expands upward into the rest (Apps, Vault, Settings, Console) and
// shows the open place when it is one of them, with the person's own face under it. Thin icons; the open place carries the accent wash; a quiet count or a coral dot says something is waiting. Every button has a click, a hover, a right-click menu (open in a new tab)
// and keyboard focus with Enter or Space. Colours are skin tokens, so a skin switch repaints with no re-render.
import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
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
      {groups.bottom.length > 0 ? <Isle entries={groups.bottom} active={active} render={buttons} /> : null}
      {foot}
      {element}
    </View>
  );
}

/** The one foot button. It opens upward into the rest of the places; the open place, when it is one of them, is what the button shows. Outside press or Escape folds it. */
function Isle({ entries, active, render }: { entries: readonly RailEntry[]; active: PlaceId; render: (e: readonly RailEntry[]) => ReactElement[] }): ReactElement {
  const [open, setOpen] = useState(false);
  const box = useRef<{ contains?: (n: unknown) => boolean } | null>(null);
  useEffect(() => {
    if (!open || Platform.OS !== "web") return undefined;
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: never) => void): void; removeEventListener(t: string, f: (e: never) => void): void } }).document;
    const down = (e: { target?: unknown }): void => { if (!box.current?.contains?.(e.target)) setOpen(false); };
    const key = (e: { key?: string }): void => { if (e.key === "Escape") setOpen(false); };
    doc?.addEventListener("mousedown", down as never);
    doc?.addEventListener("keydown", key as never);
    return () => { doc?.removeEventListener("mousedown", down as never); doc?.removeEventListener("keydown", key as never); };
  }, [open]);
  useEffect(() => { setOpen(false); }, [active]);
  const cur = entries.find((e) => e.place === active);
  const waiting = entries.some((e) => e.count > 0 || e.dot);
  return (
    <View ref={box as never} testID="rail-isle" style={[styles.isle, ISLE_MOVE, open ? styles.isleOpen : null]} {...sq("track")}>
      <View testID="rail-isle-places" aria-hidden={!open} pointerEvents={open ? "auto" : "none"} style={[styles.islePlaces, ISLE_REVEAL, { maxHeight: open ? entries.length * 41 : 0, opacity: open ? 1 : 0 }]}>{render(entries)}</View>
      <Tooltip text="More">
        <Pressable role="button" aria-label="More places" aria-expanded={open} testID="rail-isle-more" onPress={() => setOpen((o) => !o)} style={[styles.button, cur ? styles.on : null]} {...sq("tile")}>
          <ShellIcon name={cur?.place ?? "more"} size={18} weight={1.15} color={cur ? "var(--accent)" : "var(--ink-3)"} />
          {waiting && !open ? <View testID="rail-isle-dot" style={styles.dot} /> : null}
        </Pressable>
      </Tooltip>
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
        <ShellIcon name={entry.place} size={18} weight={1.15} color={on ? "var(--accent)" : over ? "var(--ink)" : "var(--ink-3)"} />
        {entry.count > 0 ? <View testID={`rail-count-${entry.place}`} style={styles.count}><Text style={styles.countText}>{entry.count > 99 ? "99+" : entry.count}</Text></View> : null}
        {entry.dot ? <View testID={`rail-dot-${entry.place}`} style={styles.dot} /> : null}
      </Pressable>
    </Tooltip>
  );
}

const ISLE_MOVE = (Platform.OS === "web" ? { transitionProperty: "background-color", transitionDuration: "180ms", transitionTimingFunction: "ease" } : {}) as object;
const ISLE_REVEAL = (Platform.OS === "web" ? { transitionProperty: "max-height, opacity", transitionDuration: "200ms, 160ms", transitionTimingFunction: "ease" } : {}) as object;

const styles = StyleSheet.create({
  isle: { alignItems: "center", gap: 3, padding: 5, borderRadius: 19 },
  isleOpen: { backgroundColor: "var(--side)" as string },
  islePlaces: { gap: 3, overflow: "hidden" },
  count: { position: "absolute", top: 2, right: 0, minWidth: 14, height: 14, paddingHorizontal: 3, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent-wash)" as string, ...({ boxShadow: "0 0 0 2px var(--side)" } as object) },
  countText: { fontSize: 9.5, lineHeight: 14, fontWeight: "600", color: "var(--accent)" as string, fontVariant: ["tabular-nums"] },
  rail: { width: RAIL_WIDTH, flexShrink: 0, alignItems: "center", gap: 8, paddingTop: 2, paddingBottom: 2 },
  track: { gap: 3, padding: 5, borderRadius: 19, backgroundColor: "var(--side)" as string },
  bar2: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", height: 56, paddingHorizontal: 6, backgroundColor: "var(--rail)" as string, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  spacer: { flexGrow: 1 },
  button: { width: 38, height: 38, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  flat: { width: 44, height: 44 },
  over: { backgroundColor: "var(--hover)" as string },
  on: { backgroundColor: "var(--accent-wash)" as string },
  dot: { position: "absolute", top: 6, right: 6, width: 5, height: 5, borderRadius: 3, backgroundColor: "var(--beacon)" as string, ...({ boxShadow: "0 0 0 2px var(--side)" } as object) },
});
