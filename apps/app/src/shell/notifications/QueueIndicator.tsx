// The title-bar line for the offline queue (spec 3.0 Title bar, 4.11): "Offline, 3 changes waiting". A click opens Waiting and Conflicts.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { queueLine } from "./model.ts";

export interface QueueIndicatorProps {
  online: boolean;
  waiting: number;
  conflicts?: number;
  onOpen(): void;
}

export function QueueIndicator({ online, waiting, conflicts = 0, onOpen }: QueueIndicatorProps): ReactElement | null {
  const line = queueLine(online, waiting, conflicts);
  if (!line) return null;
  return (
    <Pressable
      testID="queue-indicator"
      accessibilityRole="button"
      accessibilityLabel={line.text}
      onPress={onOpen}
      style={({ hovered }: { hovered?: boolean }) => [styles.box, hovered === true ? { backgroundColor: "var(--hover)" } : null]}
    >
      <Text style={[styles.text, line.tone === "attention" ? { color: "var(--warn)" } : null]}>{line.text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { height: 22, paddingHorizontal: 8, borderRadius: 6, justifyContent: "center" },
  text: { fontSize: 12, color: "var(--ink-3)" },
});
