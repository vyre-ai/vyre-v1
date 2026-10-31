// Work in a Run (work baton, lane W2): one row per task the Run made, with the face of whoever holds the baton and what they are doing. A tap opens the task's thread in the side pane.
// Nothing is drawn when the Run made no work. A finished task keeps its row with Done, so the Run reads as a record of what was handed to whom.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useRunsData } from "./data.tsx";
import { Face } from "./parts.tsx";
import { loadRunWork, markOf, workLabel } from "./work.ts";
import type { WorkTask } from "./work.ts";

const DONE_WORD: Readonly<Record<string, string>> = { done: "Done", canceled: "Canceled" };

export function RunWork({ runId, status }: { runId: string; /** The Run's status: a change reads the tasks again. */ status: string }): ReactElement | null {
  const data = useRunsData();
  const [tasks, setTasks] = useState<readonly WorkTask[]>([]);
  useEffect(() => {
    let live = true;
    void loadRunWork(data.call, runId).then((t) => { if (live) setTasks(t); });
    return () => { live = false; };
  }, [data, runId, status]);
  if (tasks.length === 0) return null;
  return (
    <View testID="run-work" accessibilityLabel="Work in this run" style={s.box}>
      <Text accessibilityRole="header" style={s.head}>Work</Text>
      {/* ui-rows-lint: not a list (a few rows of the run's own tasks) */}
      {tasks.map((t) => {
        const mark = markOf(t);
        const who = mark?.who ?? t.assigned;
        const name = data.name(who.id);
        return (
          <Row
            key={t.id} id={`work-${t.id}`} title={t.title} note={mark ? workLabel(mark, name) : (DONE_WORD[t.state] ?? t.state)}
            leading={<Face name={name} seedId={who.id} kind={who.kind === "person" ? "person" : "agent"} size={22} />}
            onPress={data.nav.openTaskSide ? () => data.nav.openTaskSide!(t.id) : undefined}
          />
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  box: { paddingHorizontal: 12, paddingBottom: 8 },
  head: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, paddingHorizontal: 4, paddingBottom: 4 },
});
