// ui/ZonePicker: choose a time zone by city. One button showing the zone now ("Pacific Time, Los Angeles, 2:28 PM"); pressing it opens a sheet (ui/Dialog) with a search field and every zone: city, UTC offset, the time there now, a tick on the current one.
// The same picker is the Space's zone in Console and a person's own in Settings. `extra` adds a first row above the list (Settings: "Use this computer's time zone"). It holds no state about what is saved: the caller saves `onChange`.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Dialog } from "../Dialog/index.tsx";
import { clockIn, validZone, zoneChoices, zoneCity, zoneMatches, zoneName } from "../../../lib/zones.ts";

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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const at = now ?? Date.now();
  const choices = useMemo(() => zoneChoices(at), [at]);
  const shown = useMemo(() => choices.filter((c) => zoneMatches(c, query)).slice(0, 500), [choices, query]);
  const close = (): void => { setOpen(false); setQuery(""); };
  const choose = (zone: string): void => { close(); if (zone !== value) onChange(zone); };
  return (
    <View>
      <Pressable
        accessibilityRole="button" accessibilityLabel={`${label}: ${zoneLine(value, at)}`} accessibilityState={{ disabled }} disabled={disabled} testID={testID}
        onPress={() => setOpen(true)}
        style={({ hovered }: { hovered?: boolean }) => [s.pick, hovered === true && s.over, disabled && s.off]}
      >
        <Text numberOfLines={1} style={s.text}>{zoneLine(value, at)}</Text>
        <Text style={s.chev}>{"\u2304"}</Text>
      </Pressable>
      {open ? (
        <Dialog title={label} onClose={close} width={460} testID="zone-sheet">
          <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Find a city or time zone" placeholderTextColor="var(--ink-4)" accessibilityLabel="Find a city or time zone" testID="zone-search" style={s.search} />
          <ScrollView style={s.list} testID="zone-list" keyboardShouldPersistTaps="handled">
            {extra && query.trim() === "" ? (
              <Pressable accessibilityRole="button" testID="zone-extra" onPress={() => { close(); extra.onSelect(); }} style={({ hovered }: { hovered?: boolean }) => [s.row, hovered === true && s.over]}>
                <Text style={s.city}>{extra.label}</Text>
              </Pressable>
            ) : null}
            {shown.length === 0 ? <Text testID="zone-none" style={s.none}>Nothing matches.</Text> : null}
            {shown.map((c) => (
              <Pressable key={c.zone} accessibilityRole="button" accessibilityState={{ selected: c.zone === value }} accessibilityLabel={c.label} testID={`zone-row-${c.zone}`} onPress={() => choose(c.zone)} style={({ hovered }: { hovered?: boolean }) => [s.row, hovered === true && s.over]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={s.city}>{c.city}</Text>
                  <Text numberOfLines={1} style={s.name}>{c.name}</Text>
                </View>
                <Text style={s.offset}>{c.offset}</Text>
                <Text style={s.when}>{c.time}</Text>
                <Text style={s.tick}>{c.zone === value ? "\u2713" : ""}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Dialog>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  pick: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 30, paddingHorizontal: 10, borderRadius: 7, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--win)" as string, maxWidth: 360 },
  over: { backgroundColor: "var(--hover)" as string },
  off: { opacity: 0.5 },
  text: { fontSize: 13, color: "var(--ink)" as string, flexShrink: 1 },
  chev: { fontSize: 12, color: "var(--ink-3)" as string },
  search: { height: 36, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, borderRadius: 8, paddingHorizontal: 10, fontSize: 13.5, color: "var(--ink)" as string, marginBottom: 8 },
  list: { maxHeight: 360 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 8, borderRadius: 8 },
  city: { fontSize: 13.5, color: "var(--ink)" as string },
  name: { fontSize: 11.5, color: "var(--ink-3)" as string },
  offset: { fontSize: 12, color: "var(--ink-3)" as string, width: 74, textAlign: "right" },
  when: { fontSize: 13, color: "var(--ink)" as string, width: 72, textAlign: "right", fontVariant: ["tabular-nums"] },
  tick: { width: 16, fontSize: 13, color: "var(--accent)" as string, textAlign: "center" },
  none: { fontSize: 13, color: "var(--ink-3)" as string, padding: 12 },
});
