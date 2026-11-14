// The note under your own message while it waits for the agent's next step (prototype c-render.js case 'me'): "At the next step  Edit  Stop and send", left under the bubble, not centred above the composer.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { TextButton } from "./parts.tsx";

export function QueueLine({
  note,
  onEdit,
  onSendNow,
}: {
  note: string;
  onEdit(): void;
  onSendNow(): void;
}): ReactElement {
  return (
    <View testID="queue-row" style={st.row}>
      <Text testID="queue-note" accessibilityLiveRegion="polite" style={st.note}>
        {note}
      </Text>
      <TextButton link label="Edit" testID="queue-edit" onPress={onEdit} />
      <TextButton link label="Stop and send" testID="queue-send-now" onPress={onSendNow} />
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 2, paddingTop: 2 },
  note: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
