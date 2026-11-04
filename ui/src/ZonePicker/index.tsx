// ui/ZonePicker: choose a time zone by city. One button showing the zone now ("Pacific Time, Los Angeles, 2:28 PM"); pressing it opens a searchable list of every zone with the time there right now, in clock order.
// The same picker is the Space's zone in Console and a person's own in Settings. `extra` adds a first row above the list (Settings: "Use this computer's time zone"). It holds no state about what is saved: the caller saves `onChange`.
import { useMemo } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { clockIn, validZone, zoneChoices, zoneCity, zoneName } from "../../../lib/zones.ts";

export interface ZonePickerProps {
  /** The zone now (IANA). */
  value: string;
  onChange(zone: string): void;
  /** The time the list reads at (tests); left out, now. */
  now?: number;
  disabled?: boolean;
  label?: string;
  testID?: string;
  extra?: { label: string; onSelect(): void };
}

/** "Pacific Time, Los Angeles, 2:28 PM" for a zone at a moment: the row's words, and the button's. */
export function zoneLine(zone: string, now: number): string {
  if (!validZone(zone)) return zone;
  const name = zoneName(zone, now), city = zoneCity(zone);
  return `${name === city ? name : `${name}, ${city}`}, ${clockIn(now, zone)}`;
}

export function ZonePicker({ value, onChange, now, disabled = false, label = "Time zone", testID, extra }: ZonePickerProps): ReactElement {
  const menu = useMenu();
  const at = now ?? Date.now();
  const choices = useMemo(() => zoneChoices(at), [at]);
  const open = (x: number, y: number): void => {
    const rows: MenuEntry[] = [];
    if (extra) rows.push({ label: extra.label, pinned: true, onSelect: extra.onSelect }, { separator: true });
    for (const c of choices) rows.push({ label: c.label, hint: c.offset, ...(c.zone === value ? { checked: true } : {}), onSelect: () => { if (c.zone !== value) onChange(c.zone); } });
    menu.show(rows, x, y, "other", undefined, { search: "Find a city or time zone", width: 380 });
  };
  return (
    <View>
      <Pressable
        accessibilityRole="button" accessibilityLabel={`${label}: ${zoneLine(value, at)}`} accessibilityState={{ disabled }} disabled={disabled} testID={testID}
        onPress={(e) => { const box = (e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }).currentTarget?.getBoundingClientRect?.(); open(box?.left ?? 0, (box?.bottom ?? 0) + 4); }}
        style={({ hovered }: { hovered?: boolean }) => [s.pick, hovered === true && s.over, disabled && s.off]}
      >
        <Text numberOfLines={1} style={s.text}>{zoneLine(value, at)}</Text>
        <Text style={s.chev}>{"⌄"}</Text>
      </Pressable>
      {menu.element}
    </View>
  );
}

const s = StyleSheet.create({
  pick: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 30, paddingHorizontal: 10, borderRadius: 7, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--win)" as string, maxWidth: 360 },
  over: { backgroundColor: "var(--hover)" as string },
  off: { opacity: 0.5 },
  text: { fontSize: 13, color: "var(--ink)" as string, flexShrink: 1 },
  chev: { fontSize: 12, color: "var(--ink-3)" as string },
});
