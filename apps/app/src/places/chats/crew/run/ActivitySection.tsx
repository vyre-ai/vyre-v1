// "Running and asleep" in the Crew pane (lane r42-subagents, prototype sub42): everything of the Space that runs or sleeps, read from runs.activity.list when the person asks for it (never on its own, never a timer
// while it is shut). A server that has no such read shows nothing at all. A press opens the run's own chat when it has one and says so when it has not.
import { useEffect, useRef, useState } from "react";
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
  const [rows, setRows] = useState<readonly ActivityRow[] | undefined>(undefined);
  const [absent, setAbsent] = useState(false);
  const [stale, setStale] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const pressed = useRef(0);
  // not asked until it is opened; then read again every few seconds while it stays open, one request at a time; a request that fails keeps what was shown and says so quietly
  useEffect(() => {
    if (!open) return undefined;
    let dead = false;
    let busy = false;
    const read = (): void => {
      if (busy) return;
      busy = true;
      void readActivity(call).then((r) => {
        busy = false;
        if (dead) return;
        if (r === "absent") setAbsent(true);
        else if (r === "failed") setStale(true);
        else {
          setStale(false);
          setRows(r);
        }
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
  if (absent) return null; // this server has no such read: nothing is drawn
  const press = (runId: string): void => {
    setNote(null);
    const mine = ++pressed.current;
    void threadOfRun(call, runId).then((threadId) => {
      if (mine !== pressed.current) return; // a later press has taken over
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
        <Text style={st.toggleText}>{open ? "Hide running and asleep" : "Running and asleep"}</Text>
      </Pressable>
      {open && rows ? <ActivityList rows={rows} when={when} onOpen={press} /> : null}
      {open && rows === undefined && !stale ? (
        <Text testID="crew-activity-reading" style={st.note}>
          Reading…
        </Text>
      ) : null}
      {open && stale ? (
        <Text testID="crew-activity-stale" style={st.note}>
          Could not refresh.
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
