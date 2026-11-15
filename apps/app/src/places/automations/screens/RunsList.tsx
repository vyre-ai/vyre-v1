// The Runs tab of an Automation and All runs, as rows (AUTOMATIONS-BUILD-RC29 round four, item 3): a dot for how it went, what it was, when (in the Space's time), and the failure in one sentence. A row opens that run as a page of numbered rows.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useWhenText } from "../../../../../../ui/src/Time/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import { look } from "./look.ts";

interface RunLine {
  id: string;
  name?: string;
  status: string;
  startedAt: number;
  summary?: string;
}
const DOT: Record<string, string> = { failed: "var(--warn)", succeeded: "var(--ok)" };
const WORDS: Record<string, string> = {
  succeeded: "Ran",
  failed: "Failed",
  running: "Running",
  queued: "Waiting to start",
  waiting: "Waiting",
  stopped: "Stopped",
};

export function RunsList({ automationId }: { automationId?: string }): ReactElement {
  const data = useAutomationsData();
  const when = useWhenText();
  const [runs, setRuns] = useState<RunLine[] | null>(null);
  useEffect(() => {
    let live = true;
    void data
      .call("runs.list", automationId ? { scope: "subject", subject: { type: "automation", id: automationId } } : { scope: "mine" })
      .then(
        (o) => live && setRuns(((o as { runs?: RunLine[] }).runs ?? []).filter((r) => r.status !== undefined)),
        () => live && setRuns([]),
      );
    return () => {
      live = false;
    };
  }, [data, automationId]);
  if (runs === null) return <View testID="runs-loading" />;
  const now = data.clock().now;
  return (
    <View style={s.col} testID="runs-list">
      {runs.length === 0 ? <Text style={look.quiet}>Nothing has run yet.</Text> : null}
      {/* ui-rows-lint: ui/Row items */}
      {runs.map((r) => (
        <Row
          key={r.id}
          id={`run-${r.id}`}
          title={`${r.name ? `${r.name}, ` : ""}${WORDS[r.status] ?? r.status}`}
          {...(r.summary && r.status === "failed" ? { note: r.summary } : {})}
          leading={<View style={[s.dot, { backgroundColor: DOT[r.status] ?? "var(--ink-4)" }]} />}
          trailing={<Text style={look.quiet}>{when(r.startedAt, now)}</Text>}
          onPress={() => data.nav.openRun(r.id)}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 2, padding: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
});
