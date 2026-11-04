// ui/Time: the one way a time shows in a shared place. It reads in the Space's time zone and, when the viewer's own zone shows a different clock, adds a quiet "(10:00 PM your time)" beside it.
// Hover (web) or a long press shows both zones with the full date. In a private place (a DM, a chat with your own agents, a note) pass `personal`: only the viewer's zone is used and nothing extra shows.
// The zones come from ZonesProvider, which the shell fills from the Space profile and the person's own setting. Without one, both are this computer's zone and no second reading appears.
// Zone math is lib/zones.ts. Do not format a time by hand in a shared place: use `When`, or `whenOf` where a plain string is needed (a row note, a menu line). scripts/lint/shared-time.test.ts holds the line.
import { createElement, createContext, useContext, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import { deviceZone, dueIn, dueText, titleOf, titleParts, whenIn, whenText } from "../../../lib/zones.ts";
import type { When as WhenParts, Zones } from "../../../lib/zones.ts";

export type { Zones } from "../../../lib/zones.ts";
export { dueText, whenText } from "../../../lib/zones.ts";

const Ctx = createContext<Zones | null>(null);

export function ZonesProvider({ value, children }: { value: Zones; children: ReactElement | ReactElement[] }): ReactElement {
  const v = useMemo(() => ({ space: value.space, viewer: value.viewer }), [value.space, value.viewer]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

/** The two zones for this place. `personal` folds both to the viewer's own: what is private is read in your own time. */
export function useZones(personal = false): Zones {
  const z = useContext(Ctx);
  const here = useMemo(() => deviceZone(), []);
  return useMemo(() => {
    const base = z ?? { space: here, viewer: here };
    return personal ? { space: base.viewer, viewer: base.viewer } : base;
  }, [z, here, personal]);
}

/** The Space's zone when a ZonesProvider is above, else null (a place that can fall back to something of its own). */
export function useSpaceZone(): string | null {
  return useContext(Ctx)?.space ?? null;
}
/** The same from the zones in context. */
export function useWhenText(personal = false): (at: number, now: number) => string {
  const z = useZones(personal);
  return (at, now) => whenText(at, now, z);
}

export function useDueText(personal = false): (at: number) => string {
  const z = useZones(personal);
  return (at) => dueText(at, z);
}

export interface WhenProps {
  at: number;
  now: number;
  /** a private place: your own zone only */
  personal?: boolean;
  /** "date": a date line ("Fri 7 Nov, 6:00 PM") rather than "from now" words */
  as?: "relative" | "date";
  style?: StyleProp<TextStyle>;
  testID?: string;
}

const MINE = "var(--ink-3)";
export const LONG_PRESS_MS = 450;

/** The time, in the Space zone, with "(10:00 PM your time)" quietly beside it. Hover or long press: both zones and the full date. */
export function When({ at, now, personal = false, as = "relative", style, testID }: WhenProps): ReactElement {
  const z = useZones(personal);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = (): void => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  // a long press is a finger held for LONG_PRESS_MS without moving; it never takes the click or the right-click, which belong to the row
  const press = { onPointerDown: (): void => { stop(); timer.current = setTimeout(() => { timer.current = null; setOpen((v) => !v); }, LONG_PRESS_MS); }, onPointerUp: stop, onPointerMove: stop, onPointerCancel: stop, onPointerLeave: stop };
  const w: WhenParts = as === "date" ? { ...whenIn(at, now, z), text: dueIn(at, z) } : whenIn(at, now, z);
  const title = titleOf(at, z);
  return (
    <TimePop at={at} personal={personal}>
      <View accessibilityLabel={title} testID={testID} {...(press as object)} style={s.row}>
        <Text style={style}>
          {w.text}
          {w.mine ? <Text style={s.mine} testID={testID ? `${testID}-mine` : undefined}>{` (${w.mine} your time)`}</Text> : null}
        </Text>
        {open ? <Text style={s.full} testID={testID ? `${testID}-full` : undefined} onPress={() => setOpen(false)}>{title}</Text> : null}
      </View>
    </TimePop>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "column" },
  mine: { color: MINE as string, fontWeight: "400" },
  full: { color: MINE as string, fontSize: 11.5, marginTop: 2 },
});

interface Open { left: number; top: number }

/** Hover or keyboard focus on what it wraps opens a raised card with three lines: the full date, the time in the Space zone, and yours when it differs (the app's popover look: 12 px radius, a shadow). Off the web it draws the children as they are.
 * The wrapper has no box of its own (display: contents), so a row lays out as it did without it. */
export function TimePop({ at, personal = false, children }: { at: number; personal?: boolean; children: ReactElement }): ReactElement {
  const z = useZones(personal);
  const [open, setOpen] = useState<Open | null>(null);
  if (Platform.OS !== "web") return children;
  const parts = titleParts(at, z);
  const show = (e: { target?: unknown }): void => {
    const box = (e.target as { getBoundingClientRect?: () => { left: number; bottom: number } } | undefined)?.getBoundingClientRect?.();
    setOpen({ left: Math.max(8, box?.left ?? 8), top: (box?.bottom ?? 0) + 6 });
  };
  const hide = (): void => setOpen(null);
  return createElement("div", { style: { display: "contents" }, "data-testid": "time-pop", onMouseOver: show, onMouseOut: hide, onFocus: show, onBlur: hide, onKeyDown: (e: { key?: string }) => { if (e.key === "Escape") hide(); } },
    children,
    open ? createElement("div", { role: "tooltip", "data-testid": "time-pop-card", style: { position: "fixed", left: open.left, top: open.top, zIndex: 2147483000, background: "var(--raised)", color: "var(--ink)", borderRadius: 12, boxShadow: "0 8px 28px rgba(0,0,0,0.18), 0 0 0 1px var(--line)", padding: "10px 12px", fontSize: 12.5, lineHeight: "18px", minWidth: 220, pointerEvents: "none" } },
      createElement("div", { style: { fontWeight: 600 }, "data-testid": "time-pop-date" }, parts.date),
      createElement("div", { "data-testid": "time-pop-space" }, createElement("span", { style: { color: "var(--ink-3)", display: "inline-block", width: 44 } }, "Space"), parts.space),
      parts.mine ? createElement("div", { "data-testid": "time-pop-mine" }, createElement("span", { style: { color: "var(--ink-3)", display: "inline-block", width: 44 } }, "You"), parts.mine) : null,
    ) : null);
}
