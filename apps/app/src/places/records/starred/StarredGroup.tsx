// Records > the sidebar's Starred group (prototype Records): what the person starred, newest first, a face for a person and the type's tile for anything else. The stars are the stars module's
// stars.list (a live query the shell builds over the replica); a record's type, which stars.list does not carry, comes from `typeOf`. The sidebar draws it between Sites and Manage.
import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { LiveQuery } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Face, Glyph, TypeTile, typeHue, typeIcon } from "../sidebar/parts.tsx";

export type StarsOut = CapMap["stars.list"]["out"];
export type Star = StarsOut["stars"][number];

/** The record type a star shows as: a record's own type when `typeOf` knows it, else the kind of thing starred. */
export function starKind(s: Star, typeOf: (recordId: string) => string | undefined): string {
  return s.resource.type === "record" ? typeOf(s.resource.id) ?? "table" : s.resource.type;
}

/** People are shown as faces; everything else as a tile of its type. */
const PEOPLE = new Set(["clients", "contacts", "agent", "hires"]);

export function StarredGroup({ query, typeOf, onOpen, closed = false, onToggle }: {
  query: LiveQuery<StarsOut>;
  typeOf: (recordId: string) => string | undefined;
  onOpen: (s: Star) => void;
  closed?: boolean;
  onToggle?: () => void;
}): ReactElement | null {
  const snap = useSyncExternalStore(query.subscribe, query.getSnapshot, query.getSnapshot);
  if (snap.status !== "ready" || snap.data.stars.length === 0) return null;
  const rows: ReactElement[] = [];
  if (!closed) {
    for (const s of snap.data.stars) {
      const kind = starKind(s, typeOf);
      const lead = PEOPLE.has(kind) ? <Face name={s.title} seedId={s.resource.id} size={18} /> : <TypeTile icon={typeIcon(kind)} hue={typeHue(kind)} />;
      rows.push(<Row key={`${s.resource.type}:${s.resource.id}`} id={`nav:star:${s.resource.id}`} title={s.title} leading={<View style={styles.glyph}>{lead}</View>} trailing={<View />} selected={false} onPress={() => onOpen(s)} />);
    }
  }
  return (
    <View testID="records-starred">
      <Pressable accessibilityRole="button" accessibilityLabel="Starred" accessibilityState={{ expanded: !closed }} testID="sec-starred" onPress={onToggle} style={({ hovered }: { hovered?: boolean }) => [styles.sec, hovered === true && styles.secOver]}>
        <View style={closed ? styles.chevShut : undefined}><Glyph name="chevd" size={10} /></View>
        <Text style={styles.secText}>Starred</Text>
      </Pressable>
      {rows}
    </View>
  );
}

const styles = StyleSheet.create({
  glyph: { width: 20, alignItems: "center", justifyContent: "center", marginRight: 6 },
  sec: { flexDirection: "row", alignItems: "center", gap: 5, height: 26, marginTop: 10, paddingHorizontal: 8, borderRadius: 6 },
  secOver: { backgroundColor: "var(--hover)" as string },
  secText: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  chevShut: { transform: [{ rotate: "-90deg" }] },
});
