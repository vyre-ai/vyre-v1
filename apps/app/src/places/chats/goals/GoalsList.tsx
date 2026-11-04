// Goals where the work lives: a project's Goals, a record's goals, the goals under the first screen's composer. The same row the sidebar draws, read by capability, following the Space's
// changes. Nothing shows when there are none: an empty Goals section would only add noise.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Changes } from "../conversation/use-follow.ts";
import { useGoals, useGoalsOf } from "./data.ts";
import type { Call } from "./data.ts";
import { GOAL_ROW_H, GoalRow } from "./GoalRow.tsx";
import { LIVE, sidebarGoals } from "./model.ts";
import type { GoalLine } from "./model.ts";

interface Props { call: Call; changes: Changes | undefined; now: number; offsetMin: number; me?: string; nameOf(id: string): string; openGoal(goalId: string): void; testID?: string }

function List({ goals, now, offsetMin, me, nameOf, openGoal, title, testID }: Omit<Props, "call" | "changes"> & { goals: readonly GoalLine[]; title: string }): ReactElement | null {
  if (goals.length === 0) return null;
  return (
    <View testID={testID} style={st.box}>
      <Text style={st.head}>{title}</Text>
      {/* ui-rows-lint: not a list (each GoalRow draws a ui/Row) */}
      {goals.map((g) => <GoalRow key={g.id} goal={g} selected={false} hovered={false} now={now} me={me} leadName={nameOf(g.leadAgentId)} onPress={() => openGoal(g.id)} />)}
    </View>
  );
}

/** A project's or a record's goals. */
export function GoalsOf({ scope, id, ...p }: Props & { scope: "project" | "record"; id: string }): ReactElement | null {
  const { state } = useGoalsOf(p.call, p.changes, scope, id);
  const goals = state.status === "ready" ? sidebarGoals(state.data, p.now) : [];
  return <List {...p} goals={goals} title="Goals" testID={p.testID ?? `goals-of-${scope}`} />;
}

/** Under the first screen's composer: the goals that need you, then the ones running, at most three. */
export function GoalsNow(p: Props): ReactElement | null {
  const { state } = useGoals(p.call, p.changes);
  const goals = state.status === "ready" ? sidebarGoals(state.data, p.now).filter((g) => LIVE.has(g.status)).slice(0, 3) : [];
  return <List {...p} goals={goals} title="Goals" testID={p.testID ?? "goals-now"} />;
}

const st = StyleSheet.create({
  box: { marginTop: 12, minHeight: GOAL_ROW_H },
  head: { color: "var(--ink-3)" as string, fontSize: 11.5, fontWeight: "600", marginBottom: 4, paddingHorizontal: 8 },
});
