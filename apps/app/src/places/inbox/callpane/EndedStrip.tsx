// Inbox > the strip under the conversation header after a call: "Call ended 00:02", where it was saved, Log a task, and a close. Full width, as the prototype draws it; the call itself is in the
// thread as an Incoming or Outgoing call row with its player and Transcript.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { formatClock } from "../../../../../../ui/src/Softphone/index.tsx";
import type { SoftphoneViewProps } from "../../../../../../ui/src/Softphone/index.tsx";
import { Icon } from "../contacttab/icons.tsx";

type Hover = { hovered?: boolean };

export function CallEndedStrip(p: SoftphoneViewProps): ReactElement {
  const [logged, setLogged] = useState(false);
  const c = p.caller;
  const name = c?.name !== undefined && c.name.length > 0 ? c.name : (c?.number ?? "the caller");
  const secs = p.endedSecs ?? p.secs ?? 0;
  const ready = p.summary !== undefined || (p.transcript ?? []).length > 0 || p.endedNote !== undefined;
  return (
    <View testID="call-ended-strip" accessibilityLabel="Call ended" style={s.strip}>
      <Avatar name={name} kind="person" size={22} />
      <View style={s.who}>
        <Text numberOfLines={1} style={s.title}>{`Call ended · ${formatClock(secs)}`}</Text>
        <Text numberOfLines={1} style={s.note}>{ready ? (p.endedNote ?? `Saved to ${name}'s conversation`) : "Saving your notes"}</Text>
      </View>
      <View style={s.grow} />
      {logged ? (
        <View style={s.done}><Icon name="check" size={13} color="var(--ok)" /><Text style={s.doneText}>Task logged</Text></View>
      ) : (
        <Pressable accessibilityRole="button" testID="call-strip-log-task" onPress={() => { p.onLogTask?.(`Follow up with ${name}`); setLogged(true); }} style={({ hovered }: Hover) => [s.btn, hovered === true && s.btnHover]}>
          <Icon name="check" size={13} color="var(--ink-2)" />
          <Text style={s.btnText}>Log a task</Text>
        </Pressable>
      )}
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" testID="call-strip-dismiss" onPress={p.onDismiss ?? p.onClose} style={({ hovered }: Hover) => [s.x, hovered === true && s.btnHover]}>
        <Icon name="x" size={13} color="var(--ink-3)" />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 16, alignSelf: "stretch" },
  who: { minWidth: 0, flexShrink: 1 },
  grow: { flex: 1 },
  title: { color: "var(--ink)" as string, fontSize: 12.5, fontWeight: "600" },
  note: { color: "var(--ink-3)" as string, fontSize: 11.5 },
  btn: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 7, borderWidth: 1, borderColor: "var(--line)" as string },
  btnHover: { backgroundColor: "var(--sel)" as string },
  btnText: { color: "var(--ink-2)" as string, fontSize: 12.5, fontWeight: "500" },
  x: { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  done: { flexDirection: "row", alignItems: "center", gap: 6 },
  doneText: { color: "var(--ok)" as string, fontSize: 12.5 },
});
