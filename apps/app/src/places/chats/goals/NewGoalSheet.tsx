// The New goal sheet: what the goal is, which agent leads it, and by when. Enter makes it and the goal opens, a draft the person starts. A refused create shows on the sheet. On a phone the sheet fills the window.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { TextField } from "../../../../../../ui/src/TextField/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Glyph } from "../sidebar/parts.tsx";
import { DEADLINES, MAX_TITLE, canCreateGoal, defaultLead, goalError, goalInput } from "./new-goal.ts";
import type { GoalCreateIn } from "./new-goal.ts";

export interface NewGoalSheetProps {
  agents: readonly { agentId: string; name: string }[];
  assistantId: string;
  /** Makes the goal; rejects with the Space's error. Resolves with the new goal's id. */
  create(input: GoalCreateIn): Promise<string>;
  onCreated(goalId: string): void;
  onClose(): void;
  now?(): number;
}

export function NewGoalSheet({
  agents,
  assistantId,
  create,
  onCreated,
  onClose,
  now = Date.now,
}: NewGoalSheetProps): ReactElement {
  const [title, setTitle] = useState("");
  const [outcome, setOutcome] = useState("");
  const [lead, setLead] = useState(() => defaultLead(agents, assistantId));
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menu = useMenu();
  // the agents may load after the sheet opens: the lead is the assistant until the person picks
  const leadId = lead !== "" && agents.some((a) => a.agentId === lead) ? lead : defaultLead(agents, assistantId);
  const form = { title, outcome, leadAgentId: leadId, days };
  const ok = canCreateGoal(form) && !busy;
  const submit = (): void => {
    if (!ok) return;
    setBusy(true);
    setError(null);
    create(goalInput(form, now())).then(
      (id) => {
        setBusy(false);
        onCreated(id);
      },
      (e: unknown) => {
        setBusy(false);
        setError(goalError(e));
      },
    );
  };
  const open = (items: MenuEntry[]) => (e: unknown) => {
    const ev = e as {
      currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } };
      nativeEvent?: { pageX?: number; pageY?: number };
    };
    const box = ev.currentTarget?.getBoundingClientRect?.();
    menu.show(
      items,
      box ? box.left : (ev.nativeEvent?.pageX ?? 0),
      box ? box.bottom + 4 : (ev.nativeEvent?.pageY ?? 0),
      "other",
    );
  };
  const leadName = agents.find((a) => a.agentId === leadId)?.name ?? "No agent yet";
  const dueLabel = DEADLINES.find((d) => d.days === days)?.label ?? "In a week";
  return (
    <Dialog
      title="New goal"
      onClose={onClose}
      width={480}
      fill
      testID="new-goal-sheet"
      actions={[
        { label: "Cancel", onPress: onClose, testID: "new-goal-cancel" },
        {
          label: busy ? "Creating" : "Create",
          onPress: submit,
          primary: true,
          disabled: !ok,
          testID: "new-goal-create",
        },
      ]}
    >
      <TextField
        value={title}
        onChangeText={(v) => {
          setTitle(v);
          if (error) setError(null);
        }}
        placeholder="What should get done"
        accessibilityLabel="Goal"
        testID="new-goal-title"
        maxLength={MAX_TITLE}
        autoFocus
        onSubmitEditing={submit}
      />
      <TextField
        value={outcome}
        onChangeText={setOutcome}
        placeholder="How you will know it is done (optional)"
        accessibilityLabel="Finish line"
        testID="new-goal-outcome"
        onSubmitEditing={submit}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Led by ${leadName}`}
        testID="new-goal-lead"
        onPress={open(
          agents.map((a) => ({ label: a.name, checked: a.agentId === leadId, onSelect: () => setLead(a.agentId) })),
        )}
        style={({ hovered }: { hovered?: boolean }) => [s.pick, hovered === true && s.pickOver]}
      >
        <Glyph name="task" size={14} />
        <Text numberOfLines={1} style={s.pickText}>
          {`Led by ${leadName}`}
        </Text>
        <Glyph name="chev" size={11} color="var(--ink-4)" />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Due ${dueLabel}`}
        testID="new-goal-due"
        onPress={open(
          DEADLINES.map((d) => ({ label: d.label, checked: d.days === days, onSelect: () => setDays(d.days) })),
        )}
        style={({ hovered }: { hovered?: boolean }) => [s.pick, hovered === true && s.pickOver]}
      >
        <Glyph name="clock" size={14} />
        <Text numberOfLines={1} style={s.pickText}>
          {`Due ${dueLabel.toLowerCase()}`}
        </Text>
        <Glyph name="chev" size={11} color="var(--ink-4)" />
      </Pressable>
      {error ? (
        <Text testID="new-goal-error" accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}
      <View />
      {menu.element}
    </Dialog>
  );
}

const s = StyleSheet.create({
  pick: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
  },
  pickOver: { backgroundColor: "var(--hover)" as string },
  pickText: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink)" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
});
