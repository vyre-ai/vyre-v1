// "Tasks it holds" on the agent page (work baton; the Chats tab already has its own "Working on"): the tasks whose baton is with this agent right now, each with where it is in its steps. Nothing is drawn when the agent holds none, so a page of
// an agent that does no task work stays as it was. A tap opens the task. Read through tasks.list as the person looking; a list that cannot be read draws nothing.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useAgentPageData } from "./data.tsx";

export interface HeldTask { id: string; title: string; state: string; assigned?: { kind: string; id: string }; reviewer?: { kind: string; id: string }; approver?: { kind: string; id: string }; takenBy?: string }
const OPEN = ["todo", "doing", "in_review", "awaiting_approval"];
const SHOWN = 4;

/** What the agent does with the task now: the baton of a work task is with the doer, the reviewer or the approver by state. */
export function actionOf(t: HeldTask, agentId: string): "Doing" | "Reviewing" | "Approving" | null {
  if ((t.state === "todo" || t.state === "doing") && (t.assigned?.id === agentId || t.takenBy === agentId)) return "Doing";
  if (t.state === "in_review" && t.reviewer?.id === agentId) return "Reviewing";
  if (t.state === "awaiting_approval" && t.approver?.id === agentId) return "Approving";
  return null;
}

export function heldBy(tasks: readonly HeldTask[], agentId: string): Array<{ task: HeldTask; doing: "Doing" | "Reviewing" | "Approving" }> {
  const out: Array<{ task: HeldTask; doing: "Doing" | "Reviewing" | "Approving" }> = [];
  for (const t of tasks) { const doing = actionOf(t, agentId); if (doing) out.push({ task: t, doing }); }
  return out;
}

export function WorkingOn(): ReactElement | null {
  const data = useAgentPageData();
  const agentId = data.agent.agentId;
  const [held, setHeld] = useState<ReturnType<typeof heldBy>>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const out = (await data.call("tasks.list", { scope: "all", kinds: ["work"], states: OPEN, limit: 100 })) as { tasks?: HeldTask[] };
        if (live) setHeld(heldBy(out.tasks ?? [], agentId));
      } catch { if (live) setHeld([]); }
    })();
    return () => { live = false; };
  }, [data, agentId]);
  if (held.length === 0) return null;
  return (
    <View testID="working-on" accessibilityLabel="Tasks it holds" style={s.box}>
      <Text accessibilityRole="header" style={s.head}>{`Tasks it holds  ${held.length}`}</Text>
      {/* ui-rows-lint: not a list (the few tasks the agent holds, under its header) */}
      {held.slice(0, SHOWN).map(({ task, doing }) => <Row key={task.id} id={`working-${task.id}`} title={task.title} note={doing} onPress={data.nav.openTask ? () => data.nav.openTask!(task.id) : undefined} />)}
      {held.length > SHOWN ? <Text style={s.more}>{`${held.length - SHOWN} more`}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { paddingBottom: 8 },
  head: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, paddingVertical: 4 },
  more: { fontSize: 12, color: "var(--ink-3)" as string, paddingHorizontal: 8, paddingTop: 2 },
});
