// The quiet lines of background jobs at the foot of the chat (G45): a running one reads "Tests  2 min  Background", a finished one reads "Tests finished in 2 min". Calm: no box, 13 px muted text.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { finishedWords, runningWords } from "./jobs.ts";
import type { Finished, Job } from "./jobs.ts";

export function JobLines({
  running,
  finished,
  now,
}: {
  running: readonly Job[];
  finished: readonly Finished[];
  now: number;
}): ReactElement | null {
  if (running.length === 0 && finished.length === 0) return null;
  return (
    <View testID="job-lines" style={st.box}>
      {finished.map((f) => (
        <View key={`f-${f.id}`} testID={`job-done-${f.id}`} accessibilityRole="text" style={st.line}>
          <View style={[st.dot, f.ok ? st.ok : st.bad]} />
          <Text style={st.words}>{finishedWords(f)}</Text>
        </View>
      ))}
      {running.map((j) => {
        const w = runningWords(j, now);
        return (
          <View
            key={`r-${j.id}`}
            testID={`job-running-${j.id}`}
            accessibilityRole="text"
            accessibilityLabel={`${w.title}, ${w.time}, running in the background`}
            accessibilityLiveRegion="polite"
            style={st.line}
          >
            <View style={[st.dot, st.live]} />
            <Text style={st.lead}>{w.title}</Text>
            <Text style={st.words}>{w.time}</Text>
            <Text style={st.tag}>{w.tag}</Text>
          </View>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  box: { marginTop: 8, marginBottom: 4, gap: 2 },
  line: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--ink-4)" as string },
  live: { backgroundColor: "var(--accent)" as string },
  ok: { backgroundColor: "var(--ok)" as string },
  bad: { backgroundColor: "var(--danger)" as string },
  lead: { fontSize: 13, fontWeight: "500", color: "var(--ink-2)" as string },
  words: { fontSize: 13, color: "var(--ink-3)" as string },
  tag: { fontSize: 12, color: "var(--ink-4)" as string },
});
