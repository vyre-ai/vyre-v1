// The quiet note a held act carries when the server wrote one for it (a send of a preview copy that is not the exact one): the sentence, and the names it goes to on a line of their own, never inside the sentence.
// One component for the chat's approval card and the Needs-you detail, so the person reads the same words wherever they press Allow.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";

export interface HoldNoteProps {
  note: string;
  names?: readonly string[] | undefined;
  testID: string;
  /** space around it: the chat card sits inside its own inset, the Needs-you detail does not */
  inset?: number | string;
}

export function HoldNote({ note, names, testID, inset = 0 }: HoldNoteProps): ReactElement {
  return (
    <View testID={testID} style={[st.note, { paddingHorizontal: inset } as never]}>
      <Text style={st.text}>{note}</Text>
      {names && names.length > 0 ? (
        <Text testID={`${testID}-signers`} style={st.names}>
          {`To: ${names.join(", ")}`}
        </Text>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  note: { gap: 2, paddingBottom: 6 },
  text: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  names: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
});
