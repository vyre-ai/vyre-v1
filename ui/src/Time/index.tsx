// ui/Time: the one way a time shows in a shared place. It reads in the Space's time zone and, when the viewer's own zone shows a different clock, adds a quiet "(10:00 PM your time)" beside it.
// Hover (web) or a long press shows both zones with the full date. In a private place (a DM, a chat with your own agents, a note) pass `personal`: only the viewer's zone is used and nothing extra shows.
// The zones come from ZonesProvider, which the shell fills from the Space profile and the person's own setting. Without one, both are this computer's zone and no second reading appears.
// Zone math is lib/zones.ts. Do not format a time by hand in a shared place: use `When`, or `whenOf` where a plain string is needed (a row note, a menu line). scripts/lint/shared-time.test.ts holds the line.
import { createContext, useContext, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import { deviceZone, dueIn, dueText, titleOf, whenIn, whenText } from "../../../lib/zones.ts";
import type { When as WhenParts, Zones } from "../../../lib/zones.ts";
import { Tooltip } from "../Tooltip/index.tsx";

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
    <Tooltip text={title}>
      <View accessibilityLabel={title} testID={testID} {...(press as object)} style={s.row}>
        <Text style={style}>
          {w.text}
          {w.mine ? <Text style={s.mine} testID={testID ? `${testID}-mine` : undefined}>{` (${w.mine} your time)`}</Text> : null}
        </Text>
        {open ? <Text style={s.full} testID={testID ? `${testID}-full` : undefined} onPress={() => setOpen(false)}>{title}</Text> : null}
      </View>
    </Tooltip>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "column" },
  mine: { color: MINE as string, fontWeight: "400" },
  full: { color: MINE as string, fontSize: 11.5, marginTop: 2 },
});
