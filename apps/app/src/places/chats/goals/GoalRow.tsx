// One goal in the Goals group of the Chats sidebar: the lead agent's face, the title, and a second line with a steady bar and what changes what you do (waiting on you, stuck), else the
// number and the next check-in. Nothing moves: the bar is drawn at its value and only changes when the number does.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Avatar, avatarOf } from "../../../../../../ui/src/Avatar/index.tsx";
import { fractionOf, rowNote } from "./model.ts";
import type { GoalLine, Tone } from "./model.ts";

/** A goal's row is the Row with a note: 44 px, the same as any two-line row. */
export const GOAL_ROW_H = 44;

export const TONE: Readonly<Record<Tone, string>> = { plain: "var(--ink-3)", need: "var(--warn)", stuck: "var(--danger)", ok: "var(--ok)", dim: "var(--ink-4)" };

export function Bar({ value, tone = "plain", width = 44, testID }: { value: number; tone?: Tone; width?: number | "100%"; testID?: string }): ReactElement {
  const fill = tone === "ok" ? "var(--ok)" : tone === "dim" ? "var(--ink-4)" : "var(--accent)";
  return (
    <View testID={testID} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }} style={[st.bar, { width }]}>
      <View style={[st.fill, { width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` as `${number}%`, backgroundColor: fill as string }]} />
    </View>
  );
}

export function GoalRow({ goal, selected, hovered, now, offsetMin, me, leadName, onPress }: { goal: GoalLine; selected: boolean; hovered: boolean; now: number; offsetMin: number; me: string | undefined; leadName: string; onPress(): void }): ReactElement {
  const note = rowNote(goal, now, offsetMin, me);
  const tone: Tone = goal.status === "done" ? "ok" : goal.status === "paused" || goal.status === "missed" || goal.status === "stopped" || goal.status === "draft" ? "dim" : "plain";
  return (
    <View testID={`goal-row-${goal.id}`} style={{ height: GOAL_ROW_H }}>
      <Row
        id={`g:${goal.id}`} title={goal.title} note={note.text} {...(note.lead ? { noteLead: note.lead, noteLeadTone: note.tone === "stuck" || note.tone === "need" ? "warning" as const : "accent" as const } : {})}
        selected={selected} hovered={hovered} onPress={onPress}
        leading={<View style={st.face}><Avatar {...avatarOf({ id: goal.leadAgentId, name: leadName, kind: "agent" })} size={20} /></View>}
        trailing={<Bar value={fractionOf(goal.progress)} tone={tone} testID={`goal-bar-${goal.id}`} />}
      />
    </View>
  );
}

const st = StyleSheet.create({
  face: { marginRight: 9 },
  bar: { height: 3, borderRadius: 2, backgroundColor: "var(--sel)" as string, overflow: "hidden" },
  fill: { height: 3, borderRadius: 2 },
});

export const toneColor = (t: Tone): string => TONE[t];
export function ToneText({ tone, children, testID }: { tone: Tone; children: string; testID?: string }): ReactElement {
  return <Text testID={testID} style={{ color: TONE[tone] as string, fontSize: 12, lineHeight: 16 }}>{children}</Text>;
}
