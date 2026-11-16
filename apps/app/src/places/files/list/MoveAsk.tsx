// The question a drop asks when it takes a file out of a connected folder (it leaves the provider too, for everyone it is shared with there) or puts one into it (it is uploaded).
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MoveAsk as Ask } from "../tree/model.ts";
import { providerWord } from "../tree/model.ts";
import { tellIfRefused } from "../tree/refusal.ts";

export function MoveAsk({
  ask,
  onMove,
  onCopy,
  onCancel,
}: {
  ask: Ask;
  onMove: () => void;
  onCopy: () => void;
  onCancel: () => void;
}): ReactElement {
  const label = ask.names.length === 1 ? ask.names[0] : `${ask.names.length} files`;
  return (
    <View style={s.bar} accessibilityRole="alert" testID="move-ask">
      <Text style={s.text} testID="move-ask-text">
        {`${label}: ${ask.sentence}`}
      </Text>
      <Pressable accessibilityRole="button" testID="move-ask-move" onPress={onMove} style={[s.btn, s.pri]}>
        <Text style={[s.btnText, s.priText]}>{ask.dir === "out" ? "Move it" : "Upload it"}</Text>
      </Pressable>
      {ask.dir === "out" && ask.copies.length > 0 ? (
        <Pressable accessibilityRole="button" testID="move-ask-copy" onPress={onCopy} style={s.btn}>
          <Text style={s.btnText}>{`Keep a copy at ${providerWord(ask.provider)}`}</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" testID="move-ask-cancel" onPress={onCancel} style={s.btn}>
        <Text style={s.btnText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

/** The sheet with its answers wired: Move it, Keep a copy, Cancel. The list and the tree draw this one component; a call the folder refuses is said to the person. */
export function MoveAskSheet({
  ask,
  call,
  onDone,
}: {
  ask: Ask;
  call: (cap: string, input: unknown) => Promise<unknown>;
  onDone: () => void;
}): ReactElement {
  const label = ask.names.length === 1 ? (ask.names[0] ?? "it") : "the files";
  const run = (moves: Ask["moves"], what: string): void => {
    for (const m of moves) tellIfRefused(call(m.cap, m.input), `Could not ${what} ${label}`);
    onDone();
  };
  return (
    <MoveAsk
      ask={ask}
      onMove={() => run(ask.moves, ask.dir === "out" ? "move" : "upload")}
      onCopy={() => run(ask.copies, "copy")}
      onCancel={onDone}
    />
  );
}

const s = StyleSheet.create({
  bar: {
    minHeight: 44,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 8,
    backgroundColor: "var(--sunk)" as string,
    borderBottomWidth: 1,
    borderBottomColor: "var(--line)" as string,
  },
  text: { flex: 1, minWidth: 220, fontSize: 13, color: "var(--ink)" as string },
  btn: { height: 28, paddingHorizontal: 12, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  pri: { backgroundColor: "var(--accent)" as string },
  priText: { color: "var(--accent-ink)" as string, fontWeight: "600" },
});
