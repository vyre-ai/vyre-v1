// The rail (spec 3.0): fixed beside the sheets, the Space tile at the top, then the Kit's main places in one soft track. At the foot one button expands upward into the rest (Apps, Vault, Settings, Console) and
// shows the open place when it is one of them, with the person's own face under it. Thin icons; the open place carries the accent wash; a quiet count or a coral dot says something is waiting. Every button has a click, a hover, a right-click menu (open in a new tab)
// and keyboard focus with Enter or Space. Colours are skin tokens, so a skin switch repaints with no re-render. A place that joins the rail while you work (Inbox, when the first
// mailbox or calendar arrives) opens into its slot with the same height-and-fade the foot island uses, once, with an optional quiet label beside it that leaves on its own.
import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { menuTrigger, useMenu } from "../../../../../ui/src/Menu/index.tsx";
import { sq } from "../../../../../ui/src/SidePane/host.tsx";
import { Tooltip } from "../../../../../ui/src/Tooltip/index.tsx";
import { ShellIcon, iconMarkup } from "./icons.tsx";
import { PHONE_BAR, phoneMore } from "./kits.ts";
import type { PlaceId, RailEntry, RailGroups } from "./kits.ts";

export const RAIL_WIDTH = 60;
/** How long a fresh place's tip stays before it leaves by itself. */
export const FRESH_TIP_MS = 6000;

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
  /** A place that just joined the rail: it comes in with the reveal and, when given, its one-time tip. */
  fresh?: { place: PlaceId; tip: string | null } | null;
  /** The fresh place has been seen: pressed, or its tip has had its time. */
  onSettle?: () => void;
}

export function Rail({ groups, active, onSelect, onOpenInTab, onPrefetch, header, foot, bottom, fresh, onSettle }: RailProps): ReactElement {
  const { element, show } = useMenu();
  const plain = (e: RailEntry): ReactElement => (
    <RailButton
      key={e.place}
      entry={e}
      flat={bottom === true}
      on={e.place === active}
      onPress={() => { if (fresh?.place === e.place) onSettle?.(); onSelect(e.place); }}
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
  const button = (e: RailEntry): ReactElement => {
    const b = plain(e);
    return bottom !== true && fresh?.place === e.place ? <Reveal key={e.place} place={e.place} tip={fresh.tip} onSettle={onSettle}>{b}</Reveal> : b;
  };
  const buttons = (entries: readonly RailEntry[]): ReactElement[] => {
    const out: ReactElement[] = [];
    for (const e of entries) out.push(button(e));
    return out;
  };
  if (bottom === true) {
    // The bar is the prototype's five places; the bottom group sits behind More.
    const barEntries = groups.top.filter((e) => PHONE_BAR.includes(e.place));
    const more = phoneMore(groups);
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
      {/* folded, the button stands for the open place; unfolded, that place is in the list above, so the button is only the fold (a second gear under Settings read as a duplicate) */}
      <Tooltip text={open ? "Fold" : "More"}>
        <Pressable role="button" aria-label="More places" aria-expanded={open} testID="rail-isle-more" onPress={() => setOpen((o) => !o)} style={[styles.button, cur && !open ? styles.on : null]} {...sq("tile")}>
          <ShellIcon name={open ? "chev" : (cur?.place ?? "more")} size={18} weight={1.15} color={cur && !open ? "var(--accent)" : "var(--ink-3)"} />
          {waiting && !open ? <View testID="rail-isle-dot" style={styles.dot} /> : null}
        </Pressable>
      </Tooltip>
    </View>
  );
}

/** A place joining the rail: its slot opens from nothing to one button's height while it fades in (the island's own timing), then a quiet label sits beside it for a few seconds. */
function Reveal({ place, tip, onSettle, children }: { place: PlaceId; tip: string | null; onSettle?: (() => void) | undefined; children: ReactElement }): ReactElement {
  const [open, setOpen] = useState(Platform.OS !== "web");
  const [tipOn, setTipOn] = useState(false);
  const settle = useRef(onSettle);
  settle.current = onSettle;
  useEffect(() => {
    if (open) return undefined;
    const raf = (globalThis as { requestAnimationFrame?: (f: () => void) => number }).requestAnimationFrame;
    let t: ReturnType<typeof setTimeout> | null = null;
    if (raf) raf(() => { t = setTimeout(() => setOpen(true), 0); }); else t = setTimeout(() => setOpen(true), 0);
    return () => { if (t !== null) clearTimeout(t); };
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    if (tip === null) { const t = setTimeout(() => settle.current?.(), 260); return () => clearTimeout(t); }
    const show = setTimeout(() => setTipOn(true), 220);
    const fade = setTimeout(() => setTipOn(false), 220 + FRESH_TIP_MS);
    const done = setTimeout(() => settle.current?.(), 220 + FRESH_TIP_MS + 200);
    return () => { clearTimeout(show); clearTimeout(fade); clearTimeout(done); };
  }, [open, tip]);
  return (
    <View testID={`rail-fresh-${place}`} style={styles.fresh}>
      <View style={[styles.freshSlot, ISLE_REVEAL, { maxHeight: open ? 38 : 0, opacity: open ? 1 : 0 }]}>{children}</View>
      {tip !== null ? (
        <View testID={`rail-tip-${place}`} role="tooltip" aria-hidden={!tipOn} pointerEvents="none" style={[styles.tip, TIP_FADE, { opacity: tipOn ? 1 : 0 }]}>
          <Text numberOfLines={1} style={styles.tipText}>{tip}</Text>
        </View>
      ) : null}
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
const TIP_FADE = (Platform.OS === "web" ? { transitionProperty: "opacity", transitionDuration: "200ms", transitionTimingFunction: "ease" } : {}) as object;

const styles = StyleSheet.create({
  isle: { alignItems: "center", gap: 3, padding: 5, borderRadius: 19 },
  isleOpen: { backgroundColor: "var(--side)" as string },
  islePlaces: { gap: 3, overflow: "hidden" },
  count: { position: "absolute", top: 2, right: 0, minWidth: 14, height: 14, paddingHorizontal: 3, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent-wash)" as string, ...({ boxShadow: "0 0 0 2px var(--side)" } as object) },
  countText: { fontSize: 9.5, lineHeight: 14, fontWeight: "600", color: "var(--accent)" as string, fontVariant: ["tabular-nums"] },
  // above the sheets beside it (every web View is its own stacking layer), so a fresh place's tip sits over the main sheet, not under it
  rail: { width: RAIL_WIDTH, flexShrink: 0, alignItems: "center", gap: 8, paddingTop: 2, paddingBottom: 2, zIndex: 1 },
  track: { gap: 3, padding: 5, borderRadius: 19, backgroundColor: "var(--side)" as string },
  bar2: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", height: 56, paddingHorizontal: 6, backgroundColor: "var(--rail)" as string, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  spacer: { flexGrow: 1 },
  button: { width: 38, height: 38, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  flat: { width: 44, height: 44 },
  over: { backgroundColor: "var(--hover)" as string },
  on: { backgroundColor: "var(--accent-wash)" as string },
  fresh: { position: "relative" },
  freshSlot: { overflow: "hidden" },
  tip: { position: "absolute", left: 46, top: 9, zIndex: 80, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, backgroundColor: "var(--ink)" as string },
  tipText: { fontSize: 12, lineHeight: 16, color: "var(--win)" as string, ...({ whiteSpace: "nowrap" } as object) },
  dot: { position: "absolute", top: 6, right: 6, width: 5, height: 5, borderRadius: 3, backgroundColor: "var(--beacon)" as string, ...({ boxShadow: "0 0 0 2px var(--side)" } as object) },
});
