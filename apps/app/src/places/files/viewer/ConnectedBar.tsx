// A file of a connected Google Drive or OneDrive folder says what is true of it there, in one quiet line above the file: it is view only (before anyone types), a change has not reached the
// provider yet (the reason on hover and on press), or it changed there too (the edit is kept in Vyre and the person picks Keep both or Use theirs).
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { changedThereWords } from "./model.ts";
import type { Connected } from "./model.ts";

export function ConnectedBar({
  connected,
  now,
  onChoose,
}: {
  connected: Connected;
  now: number;
  /** Settle a file that changed there too: both are kept, or theirs is used. */
  onChoose(choice: "keep_both" | "use_theirs"): void;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  if (connected.changedThere !== undefined)
    return (
      <View style={s.bar} testID="file-connected-changed">
        <Text style={s.text}>{changedThereWords(connected, now)}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => onChoose("keep_both")}
          style={s.btn}
          testID="file-keep-both"
        >
          <Text style={s.btnText}>Keep both</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onChoose("use_theirs")}
          style={s.btn}
          testID="file-use-theirs"
        >
          <Text style={s.btnText}>Use theirs</Text>
        </Pressable>
      </View>
    );
  if (connected.notSent !== undefined) {
    const reason = connected.notSent.reason;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Not yet at ${connected.provider}. ${reason}`}
        onPress={() => setOpen(!open)}
        style={s.bar}
        testID="file-connected-notsent"
        {...({ title: reason } as object)}
      >
        <View style={s.dot} />
        <Text style={s.text}>{open ? reason : `Not yet at ${connected.provider}`}</Text>
      </Pressable>
    );
  }
  if (connected.viewOnly === true)
    return (
      <View style={s.bar} testID="file-connected-viewonly">
        <Text style={s.text}>{`View only. You cannot change this at ${connected.provider}.`}</Text>
      </View>
    );
  return null;
}

const s = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 7,
    backgroundColor: "var(--raised)" as string,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--ink-4)" as string },
  text: { fontSize: 12.5, color: "var(--ink-2)" as string, flexShrink: 1 },
  btn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 7, backgroundColor: "var(--sunk)" as string },
  btnText: { fontSize: 12.5, fontWeight: "600", color: "var(--accent)" as string },
});
