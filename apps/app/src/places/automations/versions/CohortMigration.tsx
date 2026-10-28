// Runs stay on the definition version they started with until a reviewed Apply moves a safe group.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAutomationsData } from "../canvas/data.tsx";
import { stepsFromCall } from "../runs/ledger.ts";
import { MIGRATION_DISABLED, cohortGroupLabel, cohortPreview, cohortsOf, previewGroups, safeRunIds } from "./cohorts.ts";
import type { CohortRun, CohortStep, PreviewGroup } from "./cohorts.ts";

export function CohortMigration({ automationId, currentVersion }: { automationId: string; currentVersion: number }): ReactElement {
  const data = useAutomationsData();
  const [reload, setReload] = useState(0);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("Loading pinned runs");
  const [runs, setRuns] = useState<CohortRun[]>([]);
  const [steps, setSteps] = useState<Record<string, CohortStep[]>>({});
  const [safeIds, setSafeIds] = useState<string[]>([]);
  const [groups, setGroups] = useState<PreviewGroup[]>([]);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setConfirming(false);
    setApplyError(null);
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
        let nextSafe: string[] = [];
        let nextGroups: PreviewGroup[] = [];
        let note: string | null = null;
        try {
          const preview = await data.call("automations.migration_preview", { automationId, toVersion: currentVersion });
          nextSafe = safeRunIds(preview);
          nextGroups = previewGroups(preview);
        } catch (e) {
          note = e instanceof Error ? e.message : "The migration preview did not load.";
        }
        if (!live) return;
        setRuns(cohortRuns);
        setSteps(byRun);
        setSafeIds(nextSafe);
        setGroups(nextGroups);
        setPreviewNote(note);
        setPhase("ready");
      } catch (e) {
        if (!live) return;
        setPhase("error");
        setMessage(e instanceof Error ? e.message : "Pinned runs did not load.");
      }
    })();
    return () => { live = false; };
  }, [data, automationId, currentVersion, reload]);

  async function apply(): Promise<void> {
    if (busy || safeIds.length === 0) return;
    if (!confirming) { setConfirming(true); return; }
    setBusy(true);
    setApplyError(null);
    try {
      await data.call("automations.migrate_runs", { automationId, toVersion: currentVersion, runIds: safeIds });
      setConfirming(false);
      setReload((n) => n + 1);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Those runs were not moved.");
    } finally {
      setBusy(false);
    }
  }

  const cohorts = phase === "ready" ? cohortsOf(currentVersion, runs, steps) : [];
  const canApply = phase === "ready" && safeIds.length > 0;
  return (
    <View testID="version-cohorts" style={c.wrap}>
      <Text style={c.head}>Pinned versions</Text>
      {phase === "loading" ? <Text style={c.dim}>Loading pinned runs</Text> : null}
      {phase === "error" ? <Text style={c.err}>{message}</Text> : null}
      {phase === "ready" && cohorts.length === 0 && groups.length === 0 ? <Text style={c.dim}>No runs are pinned to a definition version yet.</Text> : null}
      {phase === "ready" && groups.length > 0 ? <CohortGroups currentVersion={currentVersion} groups={groups} /> : null}
      {phase === "ready" && groups.length === 0 ? cohorts.map((cohort) => (
        <View key={cohort.version} style={c.group}>
          <Text style={c.ver}>{cohort.current ? `Version ${cohort.version}, current definition` : `Version ${cohort.version}, pinned`}</Text>
          {cohort.runs.map((member) => <Text key={member.id} style={c.dim}>{`${member.summary ?? member.id}. ${cohortPreview(member)}`}</Text>)}
        </View>
      )) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canApply || busy }}
        disabled={!canApply || busy}
        testID="apply-migration"
        onPress={() => { if (canApply) void apply(); }}
        style={canApply ? c.applyOn : c.apply}
      >
        <Text style={canApply ? c.applyOnText : c.applyText}>{confirming ? "Apply" : "Apply safe groups"}</Text>
      </Pressable>
      {canApply && confirming ? <Text style={c.dim}>{`Move ${safeIds.length} runs to version ${currentVersion}. Finished steps stay finished.`}</Text> : null}
      {canApply && confirming ? (
        <Pressable accessibilityRole="button" disabled={busy} testID="cancel-migration" onPress={() => { setConfirming(false); setApplyError(null); }}>
          <Text style={c.dim}>Cancel</Text>
        </Pressable>
      ) : null}
      {!canApply && phase === "ready" ? <Text style={previewNote ? c.err : c.dim}>{previewNote ?? MIGRATION_DISABLED}</Text> : null}
      {applyError ? <Text style={c.err}>{applyError}</Text> : null}
    </View>
  );
}

export function CohortGroups({ currentVersion, groups }: { currentVersion: number; groups: readonly PreviewGroup[] }): ReactElement {
  return (
    <View testID="cohort-groups" style={c.wrap}>
      {groups.map((group, index) => (
        <View key={`${group.disposition}-${group.definitionVersion}-${index}`} testID={`cohort-${group.disposition}-${group.definitionVersion}`} style={c.group}>
          <Text style={c.ver}>{cohortGroupLabel(currentVersion, group)}</Text>
          {group.runIds.map((id) => <Text key={id} style={c.dim}>{id}</Text>)}
          {group.reason ? <Text style={c.dim}>{group.reason}</Text> : null}
        </View>
      ))}
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
  applyOn: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: "var(--hover)" as string },
  applyOnText: { fontSize: 12.5, color: "var(--ink)" as string },
});
