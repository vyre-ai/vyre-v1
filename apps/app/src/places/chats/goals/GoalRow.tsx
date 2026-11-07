// One goal in the Goals group of the Chats sidebar: the lead agent's face, the title, and a second line with a steady bar and what changes what you do (waiting on you, stuck), else the
// number and the next check-in. Nothing moves: the bar is drawn at its value and only changes when the number does.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Avatar, avatarOf } from "../../../../../../ui/src/Avatar/index.tsx";
import { countOf, rowNote } from "./model.ts";
import { ROW } from "../../../../../../ui/src/tokens/calm.ts";
import { useZones } from "../../../../../../ui/src/Time/index.tsx";
import type { GoalLine, Tone } from "./model.ts";

/** A goal's row is one line like every row: 32 px, the face, the title, the quiet count. A dot only when it needs you. */
export const GOAL_ROW_H = ROW;

export const TONE: Readonly<Record<Tone, string>> = { plain: "var(--ink-3)", need: "var(--warn)", stuck: "var(--danger)", ok: "var(--ok)", dim: "var(--ink-4)" };

export function Bar({ value, tone = "plain", width = 44, testID }: { value: number; tone?: Tone; width?: number | "100%"; testID?: string }): ReactElement {
  const fill = tone === "ok" ? "var(--ok)" : tone === "dim" ? "var(--ink-4)" : "var(--accent)";
  return (
    <View testID={testID} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }} style={[st.bar, { width }]}>
      <View style={[st.fill, { width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` as `${number}%`, backgroundColor: fill as string }]} />
    </View>
  );
}

export function GoalRow({ goal, selected, hovered, now, me, leadName, onPress }: { goal: GoalLine; selected: boolean; hovered: boolean; now: number; me: string | undefined; leadName: string; onPress(): void }): ReactElement {
  const zones = useZones();
  const note = rowNote(goal, now, zones, me);
  const needs = note.tone === "need" || note.tone === "stuck";
  const count = countOf(goal.progress);
  return (
    <View testID={`goal-row-${goal.id}`} style={{ height: GOAL_ROW_H }}>
      <Row
        id={`g:${goal.id}`} title={goal.title}
        selected={selected} hovered={hovered} onPress={onPress}
        leading={<View style={st.face}><Avatar {...avatarOf({ id: goal.leadAgentId, name: leadName, kind: "agent" })} size={20} /></View>}
        trailing={<View style={st.tail}>{needs ? <View testID={`goal-needs-${goal.id}`} accessibilityLabel={note.lead ?? "Needs you"} style={[st.needs, { backgroundColor: note.tone === "stuck" ? "var(--danger)" : "var(--warn)" }]} /> : null}{count ? <Text testID={`goal-count-${goal.id}`} style={st.count}>{count}</Text> : null}</View>}
      />
    </View>
  );
}

const st = StyleSheet.create({
  face: { marginRight: 9 },
  tail: { flexDirection: "row", alignItems: "center", gap: 8 },
  needs: { width: 7, height: 7, borderRadius: 4 },
  count: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] } as object,
  bar: { height: 3, borderRadius: 2, backgroundColor: "var(--sel)" as string, overflow: "hidden" },
  fill: { height: 3, borderRadius: 2 },
});

export const toneColor = (t: Tone): string => TONE[t];
export function ToneText({ tone, children, testID }: { tone: Tone; children: string; testID?: string }): ReactElement {
  return <Text testID={testID} style={{ color: TONE[tone] as string, fontSize: 12, lineHeight: 16 }}>{children}</Text>;
}
