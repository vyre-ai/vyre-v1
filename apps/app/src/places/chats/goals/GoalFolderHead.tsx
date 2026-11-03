// The goal a Files folder belongs to, as one quiet line at the top of the folder: "Goal: <title>", its number and bar, and a press opens the goal. Asked only for a folder that sits in a
// folder named Goals, so an ordinary folder costs nothing.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Bar } from "./GoalRow.tsx";
import { fractionOf, numberOf, statusOf } from "./model.ts";
import type { GoalLine } from "./model.ts";

export function GoalFolderHead({ folderId, parentName, call, openGoal }: { folderId: string; parentName: string | undefined; call(cap: string, input: unknown): Promise<unknown>; openGoal?: (goalId: string) => void }): ReactElement | null {
  const [goal, setGoal] = useState<GoalLine | null>(null);
  useEffect(() => {
    setGoal(null);
    if (parentName !== "Goals") return;
    let live = true;
    void call("goals.list", { scope: "all" }).then((o) => { if (live) setGoal(((o as { goals?: GoalLine[] }).goals ?? []).find((g) => g.folderId === folderId) ?? null); }, () => undefined);
    return () => { live = false; };
  }, [folderId, parentName, call]);
  if (!goal) return null;
  const s = statusOf(goal);
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`Open the goal ${goal.title}`} testID="files-goal-head" onPress={() => openGoal?.(goal.id)}
      style={({ hovered }: { hovered?: boolean }) => [st.head, hovered === true && { backgroundColor: "var(--hover)" as string }]}>
      <Text style={st.label}>Goal</Text>
      <Text numberOfLines={1} style={st.title}>{goal.title}</Text>
      <View style={{ flex: 1 }} />
      <Text style={st.num}>{`${numberOf(goal.progress)} · ${s.word}`}</Text>
      <Bar value={fractionOf(goal.progress)} tone={goal.status === "done" ? "ok" : "plain"} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8, height: 34, paddingHorizontal: 12, marginHorizontal: 8, marginTop: 6, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  label: { color: "var(--ink-3)" as string, fontSize: 12, fontWeight: "600" },
  title: { color: "var(--ink)" as string, fontSize: 13, flexShrink: 1 },
  num: { color: "var(--ink-3)" as string, fontSize: 12, fontVariant: ["tabular-nums"] },
});
