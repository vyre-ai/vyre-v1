// "Running and asleep" in the Crew pane (lane r42-subagents, prototype sub42): everything of the Space that runs or sleeps, read from runs.activity.list when the person asks for it (never on its own, never a timer
// while it is shut). A server that has no such read shows nothing at all. A press opens the run's own chat when it has one and says so when it has not.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useDueText } from "../../../../../../../ui/src/Time/index.tsx";
import { ActivityList } from "./views.tsx";
import { readActivity, threadOfRun } from "./reads.ts";
import type { ActivityRow } from "./model.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;

export function ActivitySection({
  call,
  onOpenThread,
}: {
  call: Call;
  onOpenThread?: (threadId: string) => void;
}): ReactElement | null {
  // a time shows in the Space's zone, the shared way
  const when = useDueText();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<readonly ActivityRow[] | null | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);
  // not asked until it is opened; then read again every few seconds while it stays open
  useEffect(() => {
    if (!open) return undefined;
    let dead = false;
    const read = (): void => {
      void readActivity(call).then((r) => {
        if (!dead) setRows(r);
      });
    };
    read();
    const t = setInterval(read, 5000);
    (t as { unref?: () => void }).unref?.();
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [open, call]);
  if (rows === null) return null; // this server cannot say: nothing is drawn
  const press = (runId: string): void => {
    setNote(null);
    void threadOfRun(call, runId).then((threadId) => {
      if (threadId !== null && onOpenThread) onOpenThread(threadId);
      else setNote("It has no chat to open.");
    });
  };
  return (
    <View testID="crew-activity" style={st.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID="crew-activity-toggle"
        onPress={() => setOpen((o) => !o)}
        style={st.toggle}
      >
        <Text style={st.toggleText}>{open ? "Hide running and asleep" : "Everything running or asleep"}</Text>
      </Pressable>
      {open && rows ? <ActivityList rows={rows} when={when} onOpen={press} /> : null}
      {open && rows === undefined ? (
        <Text testID="crew-activity-reading" style={st.note}>
          Reading…
        </Text>
      ) : null}
      {note ? (
        <Text testID="crew-activity-note" style={st.note}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { marginTop: 14, gap: 6 },
  toggle: {
    alignSelf: "flex-start",
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 9,
    justifyContent: "center",
    backgroundColor: "var(--hover)" as string,
  },
  toggleText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  note: { fontSize: 12, color: "var(--ink-3)" as string },
});
