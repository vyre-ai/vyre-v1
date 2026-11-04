// One question with one line of text (lane l-chrome2a): the little dialog a menu item opens when its capability needs words from the person (why a goal is stuck, what to report, a new name). The ui/Dialog card, the
// field takes focus, the primary action is off until something is typed, and Cancel changes nothing.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, TextInput } from "react-native";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";

export interface TextAskProps { title: string; label: string; action: string; initial?: string; multiline?: boolean; onDone(text: string): void; onClose(): void }

export function TextAsk({ title, label, action, initial = "", multiline = false, onDone, onClose }: TextAskProps): ReactElement {
  const [text, setText] = useState(initial);
  const ok = text.trim() !== "";
  return (
    <Dialog title={title} onClose={onClose} testID="text-ask" actions={[{ label: "Cancel", onPress: onClose, testID: "text-ask-cancel" }, { label: action, primary: true, disabled: !ok, why: "Write something first", onPress: () => { if (ok) onDone(text.trim()); }, testID: "text-ask-go" }]}>
      <TextInput accessibilityLabel={label} testID="text-ask-field" value={text} onChangeText={setText} placeholder={label} placeholderTextColor="var(--ink-4)" multiline={multiline} autoFocus style={[st.input, multiline && st.multi]} />
    </Dialog>
  );
}

const st = StyleSheet.create({
  input: { minHeight: 36, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, color: "var(--ink)" as string, fontSize: 14 },
  multi: { minHeight: 84, textAlignVertical: "top" },
});
