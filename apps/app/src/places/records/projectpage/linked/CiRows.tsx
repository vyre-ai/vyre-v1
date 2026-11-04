// The CI rows of a GitHub-linked project, in the Code group of Linked: each run with its status, how long and what it cost; a failed run says why in one line (the failure line), and one card under the list offers
// to ask the Assistant to fix the newest failure. Runs come from ci.runs.list (anyone who can see the project may read them).
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../../ui/src/Row/index.tsx";
import { RUN_WORD, failedRun, fixAsk, runLine, runLook } from "./model.ts";
import type { Run } from "./model.ts";

const MARK = { failed: "✕", passed: "✓", running: "◔", waiting: "◷", stopped: "○" } as const;

export function CiGroup({ repo, runs, now, projectTitle, askAssistant }: { repo: string; runs: readonly Run[]; now: number; projectTitle: string; askAssistant?: (text: string) => void }): ReactElement {
  const bad = failedRun(runs);
  const live = runs.filter((r) => runLook(r) === "running").length;
  return (
    <View testID="ci-rows">
      <View style={st.head}><Text style={st.repo} testID="ci-repo">{repo}</Text>{live > 0 ? <Text style={st.run} testID="ci-live">{`${live} running`}</Text> : null}</View>
      {/* ui-rows-lint: not a list (each run is a ui/Row inside its test-id wrapper) */}
      {runs.map((r) => {
        const look = runLook(r);
        return (
          <View key={r.runId} testID={`ci-run-${r.runId}`} accessibilityLabel={`${r.jobName}, ${RUN_WORD[look]}`}>
            <Row id={`ci-run-${r.runId}`} inert tall title={r.jobName} note={runLine(r, now)}
              leading={<View style={st.mark}><Text style={[st.markText, look === "failed" && st.bad, look === "passed" && st.ok, look === "running" && st.accent]}>{MARK[look]}</Text></View>}
              trailing={<Text style={st.state}>{RUN_WORD[look]}</Text>} />   {/* the status word in muted ink; the colour sits on the tile */}
            {look === "failed" && r.note ? <Text numberOfLines={2} testID={`ci-why-${r.runId}`} style={st.why}>{r.note}</Text> : null}
          </View>
        );
      })}
      {bad !== null && askAssistant !== undefined ? (
        <View testID="ci-fix" style={st.card}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.cardTitle}>{`Checks failed on ${bad.repo}`}</Text>
            <Text style={st.sub}>{bad.note ?? `${bad.jobName} did not pass.`}</Text>
          </View>
          <Pressable accessibilityRole="button" testID="ci-fix-ask" onPress={() => askAssistant(fixAsk(projectTitle, bad))} style={st.ask}><Text style={st.askText}>Ask Assistant to fix</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 28 },
  repo: { fontSize: 12.5, color: "var(--ink-3)" as string },
  run: { fontSize: 12, color: "var(--accent)" as string },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 50, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 11 },
  mark: { width: 28, height: 28, marginRight: 10, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string },
  markText: { fontSize: 13, color: "var(--ink-2)" as string },
  title: { fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  sub: { fontSize: 12, color: "var(--ink-3)" as string },
  // the failure line sits under its run's own text: the row's 8 px inset, the 28 px tile and its 10 px gap
  why: { fontSize: 12, lineHeight: 16, color: "var(--danger)" as string, marginLeft: 46, marginRight: 8, marginTop: -10, marginBottom: 8 },
  state: { fontSize: 12.5, color: "var(--ink-3)" as string },
  bad: { color: "var(--danger)" as string }, ok: { color: "var(--ok)" as string }, accent: { color: "var(--accent)" as string },
  card: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6, marginBottom: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--raised)" as string },
  cardTitle: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  ask: { height: 30, paddingHorizontal: 12, borderRadius: 9, justifyContent: "center", backgroundColor: "var(--accent)" as string },
  askText: { fontSize: 13, fontWeight: "500", color: "var(--accent-ink)" as string },
});
