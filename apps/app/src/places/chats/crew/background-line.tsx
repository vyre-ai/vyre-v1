// The line above the composer while helpers or jobs work and no reply is being written (owner, rc.28 report, 16 Nov 2026: the Assistant ended its turn with "I'm waiting for all four" and nothing on screen said anyone
// was working). One calm pill in the Island's form: the mark, "3 helpers working, 1 of 4 done, 2 min", and Stop. It reads the crew status the strip and the pane read, so the three agree, and it is gone the moment the
// last one ends. Pressing the words opens the Crew pane; Stop ends every helper and job of the chat. Under reduced motion the mark is still (WorkingMark honours it).
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { WorkingMark } from "../../../../../../ui/src/WorkingMark/index.tsx";
import { backgroundWords } from "./model.ts";
import type { CrewStatusOut } from "./model.ts";
import { useNow } from "./strip.tsx";

export function BackgroundLine({
  status,
  onOpen,
  onStop,
}: {
  status: CrewStatusOut;
  onOpen: () => void;
  onStop: () => void;
}): ReactElement | null {
  const t = status.totals;
  const now = useNow(t.working > 0);
  if (t.working === 0) return null;
  // the time runs between reads: the oldest working row's start, not the last read's total
  const started = Math.min(...status.members.filter((m) => m.state === "working").map((m) => m.startedAt));
  const words = backgroundWords({ ...t, elapsedMs: Math.max(t.elapsedMs, now - started) });
  return (
    <View style={st.wrap}>
      <View testID="background-line" accessibilityLiveRegion="polite" style={st.pill}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${words}. Open the crew`}
          testID="background-open"
          onPress={onOpen}
          style={st.open}
        >
          <WorkingMark state="thinking" step={words} size={18} />
          <Text testID="background-text" numberOfLines={1} style={st.text}>
            {words}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop"
          testID="background-stop"
          onPress={onStop}
          style={st.stop}
        >
          <Text style={st.stopText}>Stop</Text>
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { alignItems: "center", paddingBottom: 6, paddingHorizontal: 12 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 34,
    maxWidth: "100%",
    minWidth: 0,
    paddingLeft: 14,
    paddingRight: 6,
    borderRadius: 17,
    backgroundColor: "var(--raised)" as string,
    boxShadow: "var(--sh-1)",
  } as object,
  open: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 1, height: 34 },
  text: { flexShrink: 1, minWidth: 0, fontSize: 13, color: "var(--ink)" as string },
  stop: { height: 26, justifyContent: "center", paddingHorizontal: 10, borderRadius: 13 },
  stopText: { fontSize: 13, color: "var(--ink-2)" as string },
});
