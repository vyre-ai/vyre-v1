// The card on a task page when someone else changed the task while this person was editing: for each field their value beside the task's current one, a choice per field, and one Save that
// writes only what they keep. Until they save or choose to take everything as it is now, their words stay on the card.
import type { ReactElement } from "react";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { setAll, setPick, shortDiff, wordsOf } from "./conflict.ts";
import type { Clash, ClashRow, Pick } from "./conflict.ts";

export interface ConflictProps { clash: Clash; by: string; now: number; offsetMin: number; busy?: boolean; onChange(c: Clash): void; onSave(): void }

export function ConflictCard({ clash, by, now, offsetMin, busy, onChange, onSave }: ConflictProps): ReactElement {
  const mine = clash.rows.filter((r) => r.pick === "mine").length;
  const theirs = clash.rows.length - mine;
  return (
    <View testID="task-conflict" accessibilityRole="alert" style={st.card}>
      <View style={st.head}>
        <View style={st.icon}><Text style={st.iconText}>⇄</Text></View>
        <View style={st.headText}>
          <Text style={st.title}>{`${by} changed this task while you were editing`}</Text>
          <Text style={st.lede}>Your changes are not saved yet and nothing is lost. For each field, keep yours or take what it is now.</Text>
        </View>
      </View>
      {clash.rows.map((r) => <Row key={r.key} row={r} by={by} now={now} offsetMin={offsetMin} onPick={(p) => onChange(setPick(clash, r.key, p))} />)}
      <View style={st.foot}>
        <Pressable accessibilityRole="button" accessibilityLabel="Save" testID="task-conflict-save" disabled={busy} onPress={onSave} style={[st.btn, st.btnPrimary]}><Text style={[st.btnText, st.btnPrimaryText]}>Save</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Use all of ${by}'s`} testID="task-conflict-all-current" onPress={() => onChange(setAll(clash, "current"))} style={st.btn}><Text style={st.btnText}>{`Use all of ${by}'s`}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Keep all of mine" testID="task-conflict-all-mine" onPress={() => onChange(setAll(clash, "mine"))} style={st.btn}><Text style={st.btnText}>Keep all of mine</Text></Pressable>
        <Text testID="task-conflict-count" style={st.count}>{`${mine} yours, ${theirs} ${by}'s`}</Text>
      </View>
    </View>
  );
}

function Row({ row, by, now, offsetMin, onPick }: { row: ClashRow; by: string; now: number; offsetMin: number; onPick(p: Pick): void }): ReactElement {
  const { width } = useWindowDimensions();
  const [all, setAll_] = useState(false);
  const short = all ? null : shortDiff(row.mine, row.current);
  const mine = short ? short[0] : wordsOf(row.key, row.mine, now, offsetMin);
  const cur = short ? short[1] : wordsOf(row.key, row.current, now, offsetMin);
  const narrow = width < 640;
  const long = shortDiff(row.mine, row.current) !== null;
  return (
    <View testID={`task-conflict-row-${row.key}`} style={[st.row, narrow && st.rowNarrow]}>
      <Text style={[st.label, narrow && st.labelNarrow]}>{row.label}</Text>
      <View style={[st.options, narrow && st.optionsNarrow]}>
        <Option testID={`task-conflict-mine-${row.key}`} on={row.pick === "mine"} who="Yours" text={mine} onPress={() => onPick("mine")} />
        <Option testID={`task-conflict-current-${row.key}`} on={row.pick === "current"} who={`Now, from ${by}`} text={cur} onPress={() => onPick("current")} />
        {long ? <Pressable accessibilityRole="button" accessibilityLabel={all ? "Show less" : "Show all"} testID={`task-conflict-more-${row.key}`} onPress={() => setAll_((v) => !v)} style={st.more}><Text style={st.moreText}>{all ? "Show less" : "Show all"}</Text></Pressable> : null}
      </View>
    </View>
  );
}

function Option({ on, who, text, onPress, testID }: { on: boolean; who: string; text: string; onPress(): void; testID: string }): ReactElement {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${who}: ${text}`} testID={testID} onPress={onPress} style={[st.option, on && st.optionOn]}>
      <View style={[st.radio, on && st.radioOn]} />
      <View style={st.optionText}><Text style={st.who}>{who}</Text><Text style={st.value}>{text}</Text></View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  card: { marginTop: 16, marginLeft: 36, padding: 14, paddingBottom: 12, borderRadius: 14, backgroundColor: "var(--sunk)" as string, boxShadow: "inset 0 0 0 1px var(--line)" } as object,
  head: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  icon: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sel)" as string },
  iconText: { fontSize: 15, color: "var(--warn)" as string },
  headText: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  lede: { marginTop: 2, fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, paddingTop: 10 },
  rowNarrow: { flexDirection: "column", alignItems: "stretch", gap: 6 },
  labelNarrow: { width: "100%" },
  optionsNarrow: { flexDirection: "column", flexBasis: "auto" },
  more: { width: "100%", paddingTop: 2 },
  moreText: { fontSize: 12.5, color: "var(--accent)" as string },
  label: { width: 78, fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string },
  options: { flex: 1, flexBasis: 240, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { flex: 1, flexBasis: 150, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 11, backgroundColor: "var(--win)" as string, boxShadow: "inset 0 0 0 1px var(--line)" } as object,
  optionOn: { boxShadow: "inset 0 0 0 1.5px var(--accent)" } as object,
  radio: { width: 16, height: 16, borderRadius: 8, boxShadow: "inset 0 0 0 1.5px var(--ink-4)" } as object,
  radioOn: { boxShadow: "inset 0 0 0 5px var(--accent)" } as object,
  optionText: { flexShrink: 1, minWidth: 0 },
  who: { fontSize: 11.5, color: "var(--ink-3)" as string },
  value: { fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  foot: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingTop: 14 },
  btn: { height: 32, justifyContent: "center", paddingHorizontal: 13, borderRadius: 9 },
  btnPrimary: { backgroundColor: "var(--accent)" as string },
  btnText: { fontSize: 13.5, fontWeight: "600", color: "var(--ink-2)" as string },
  btnPrimaryText: { color: "var(--accent-ink)" as string },
  count: { marginLeft: "auto", fontSize: 12.5, color: "var(--ink-3)" as string },
});
