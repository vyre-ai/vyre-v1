// Runs stay on the definition version they started with. Apply stays disabled: migration is a separate reviewed action.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAutomationsData } from "../canvas/data.tsx";
import { stepsFromCall } from "../runs/ledger.ts";
import { MIGRATION_DISABLED, cohortPreview, cohortsOf } from "./cohorts.ts";
import type { CohortRun, CohortStep } from "./cohorts.ts";

export function CohortMigration({ automationId, currentVersion }: { automationId: string; currentVersion: number }): ReactElement {
  const data = useAutomationsData();
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("Loading pinned runs");
  const [runs, setRuns] = useState<CohortRun[]>([]);
  const [steps, setSteps] = useState<Record<string, CohortStep[]>>({});

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const listed = await data.call("runs.list", { scope: "subject", subject: { type: "automation", id: automationId }, limit: 20 });
        const rows = listed && typeof listed === "object" && Array.isArray((listed as { runs?: unknown }).runs) ? (listed as { runs: Record<string, unknown>[] }).runs : null;
        if (!rows) throw new Error("The runs list did not return rows.");
        const cohortRuns: CohortRun[] = [];
        const byRun: Record<string, CohortStep[]> = {};
        for (const row of rows) {
          if (typeof row["id"] !== "string" || typeof row["status"] !== "string") continue;
          cohortRuns.push({
            id: row["id"],
            status: row["status"],
            ...(typeof row["definitionVersion"] === "number" ? { definitionVersion: row["definitionVersion"] } : {}),
            ...(typeof row["summary"] === "string" ? { summary: row["summary"] } : {}),
          });
          try {
            const detail = await data.call("runs.steps", { runId: row["id"] });
            const parsed = stepsFromCall(detail) ?? [];
            byRun[row["id"]] = parsed.map((step) => ({ step: step.step, state: step.state }));
          } catch {
            byRun[row["id"]] = [];
          }
        }
        if (!live) return;
        setRuns(cohortRuns);
        setSteps(byRun);
        setPhase("ready");
      } catch (e) {
        if (!live) return;
        setPhase("error");
        setMessage(e instanceof Error ? e.message : "Pinned runs did not load.");
      }
    })();
    return () => { live = false; };
  }, [data, automationId]);

  const cohorts = phase === "ready" ? cohortsOf(currentVersion, runs, steps) : [];
  return (
    <View testID="version-cohorts" style={c.wrap}>
      <Text style={c.head}>Pinned versions</Text>
      {phase === "loading" ? <Text style={c.dim}>Loading pinned runs</Text> : null}
      {phase === "error" ? <Text style={c.err}>{message}</Text> : null}
      {phase === "ready" && cohorts.length === 0 ? <Text style={c.dim}>No runs are pinned to a definition version yet.</Text> : null}
      {cohorts.map((cohort) => (
        <View key={cohort.version} style={c.group}>
          <Text style={c.ver}>{cohort.current ? `Version ${cohort.version}, current definition` : `Version ${cohort.version}, pinned`}</Text>
          {cohort.runs.map((member) => <Text key={member.id} style={c.dim}>{`${member.summary ?? member.id}. ${cohortPreview(member)}`}</Text>)}
        </View>
      ))}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled testID="apply-migration" style={c.apply}>
        <Text style={c.applyText}>Apply</Text>
      </Pressable>
      <Text style={c.dim}>{MIGRATION_DISABLED}</Text>
    </View>
  );
}

const c = StyleSheet.create({
  wrap: { gap: 8, marginTop: 16 },
  head: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  ver: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string },
  group: { gap: 4 },
  dim: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  err: { fontSize: 12.5, lineHeight: 18, color: "var(--danger)" as string },
  apply: { alignSelf: "flex-start", opacity: 0.45, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: "var(--hover)" as string },
  applyText: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
