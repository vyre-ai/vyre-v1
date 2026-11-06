// The quiet rows of a long session (prototype t-session): an hour mark, a jump point and "While you were away". Calm pass: no boxes, 13 px muted text, one 12 px radius on the hover, the accent only on the flag.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Glyph } from "../conversation/parts.tsx";
import { awayWords } from "./model.ts";
import type { SessionItem } from "./model.ts";

type Away = Extract<SessionItem, { kind: "away" }>;
type Jump = Extract<SessionItem, { kind: "jump" }>;

/** The hour spine: the hour in the face gutter, a hairline running on from it. */
export function HourMark({ id, label }: { id: string; label: string }): ReactElement {
  return (
    <View testID={`hour-${id}`} accessibilityRole="text" accessibilityLabel={label} style={st.hour}>
      <Text style={st.hourText}>{label}</Text>
      <View style={st.rule} />
    </View>
  );
}

/** A moment worth coming back to: a flag, what happened, the detail and the time. The Overview jumps here. */
export function JumpRow({ row }: { row: Jump }): ReactElement {
  return (
    <View testID={`jump-${row.messageId}`} accessibilityRole="text" accessibilityLabel={`${row.label}. ${row.sub}`} style={st.jump}>
      <View style={st.flag}><Glyph name="flag" size={13} color="var(--accent)" /></View>
      <Text numberOfLines={1} style={st.jumpWhat}>{row.label}</Text>
      <Text numberOfLines={1} style={st.jumpSub}>{row.sub !== "" ? `${row.sub} · ${row.time}` : row.time}</Text>
    </View>
  );
}

/** Lines an opened away row shows before "N more, all quiet". */
export const AWAY_SHOWN = 8;

/** "While you were away": one row that opens in place to one line per quiet thing. What needs you stays visible outside it. */
export function AwayRow({ row }: { row: Away }): ReactElement {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const shown = all ? row.lines : row.lines.slice(0, AWAY_SHOWN);
  return (
    <View testID={`away-${row.key}`} style={st.away}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`While you were away. ${awayWords(row)}`} testID={`away-${row.key}-toggle`} onPress={() => setOpen((o) => !o)} style={({ hovered }: { hovered?: boolean }) => [st.awayHead, hovered === true && st.hover]}>
        <View style={st.dot} />
        <Text numberOfLines={2} style={st.awayText}><Text style={st.awayLead}>While you were away </Text>{awayWords(row)}</Text>
        <Text style={st.awaySpan}>{row.span}</Text>
      </Pressable>
      {open ? (
        <View testID={`away-${row.key}-items`} style={st.lines}>
          {shown.map((l) => <Text key={l.id} numberOfLines={2} style={st.line}>{l.who !== "" ? <Text style={st.lineWho}>{`${l.who}  `}</Text> : null}{l.text}<Text style={st.lineTime}>{`  ${l.time}`}</Text></Text>)}
          {row.lines.length > shown.length ? <Pressable accessibilityRole="button" testID={`away-${row.key}-more`} onPress={() => setAll(true)}><Text style={st.more}>{`${row.lines.length - shown.length} more, all quiet`}</Text></Pressable> : null}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  hour: { flexDirection: "row", alignItems: "center", gap: 8, height: 20, marginTop: 24, marginBottom: 4 },
  hourText: { fontSize: 12, color: "var(--ink-3)" as string },
  rule: { flex: 1, height: 1, backgroundColor: "var(--line)" as string },
  jump: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 12 },
  flag: { width: 20, alignItems: "center" },
  jumpWhat: { flexShrink: 0, fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  jumpSub: { flexShrink: 1, minWidth: 0, fontSize: 13, color: "var(--ink-3)" as string },
  away: { marginVertical: 12 },
  awayHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 12 },
  hover: { backgroundColor: "var(--hover)" as string },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--accent)" as string },
  awayText: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink-2)" as string },
  awayLead: { fontWeight: "600", color: "var(--ink)" as string },
  lines: { gap: 4, marginLeft: 20, marginTop: 4, marginBottom: 4 },
  line: { fontSize: 13, lineHeight: 20, color: "var(--ink-2)" as string },
  lineWho: { fontWeight: "600", color: "var(--ink)" as string },
  lineTime: { fontSize: 12, color: "var(--ink-4)" as string },
  more: { fontSize: 13, color: "var(--ink-3)" as string },
  awaySpan: { fontSize: 12, color: "var(--ink-4)" as string },
});
