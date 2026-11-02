// The work under way in a chat: the children of the plans made here, one line each, live. It is a view of the tasks, so it is right after a reload and for anyone who opens the chat later, and a press opens that task. It
// draws nothing when nothing is open, reads the list only when a task changed, and stays a few lines however big the plan is.
import { memo, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { useLive } from "../mounts/live.ts";
import { holderOf, openWork, WORK_SHOWN, workStep } from "./model.ts";
import type { TaskRow, Who } from "./model.ts";
import { FaceButton, LiveWords, useLiveTurn } from "./parts.tsx";
import { storeFor } from "./store.ts";

export interface ChatWorkProps {
  rt: ShellRuntime;
  threadId: string;
  nameOf(id: string): string;
  openTask(id: string): void;
  openProfile(who: Who): void;
}

const Line = memo(function Line({ row, rt, keyOf, nameOf, openTask, openProfile }: Omit<ChatWorkProps, "threadId"> & { row: TaskRow; keyOf(id: string): string | undefined }): ReactElement {
  const turn = useLiveTurn(rt.turns, row.workerThread ?? row.threadId);
  const who = holderOf(row) ?? row.assigned;
  return <Pressable accessibilityRole="link" accessibilityLabel={`${row.title}, ${nameOf(who.id)}`} testID={`chat-work-${row.id}`} onPress={() => openTask(row.id)} style={st.row}>
    <FaceButton who={who} name={nameOf(who.id)} size={24} onPress={() => openProfile(who)} />
    <View style={st.text}>
      <Text numberOfLines={1} style={st.title}>{row.title}</Text>
      {turn ? <View style={st.step}><LiveWords turn={turn} turns={rt.turns} name={nameOf(turn.agentId)} /></View> : <Text numberOfLines={1} style={st.quiet}>{workStep(row, keyOf, nameOf)}</Text>}
    </View>
  </Pressable>;
});

export function ChatWork({ rt, threadId, nameOf, openTask, openProfile }: ChatWorkProps): ReactElement | null {
  const store = useMemo(() => storeFor(rt, rt.call, { scope: "everyone", underThread: threadId }), [rt, threadId]);
  const snap = useSyncExternalStore(store.subscribe, store.get, store.get);
  const rev = useLive<{ rev: string }>(rt.screens, "tasks.my-work", "rev", {});
  const revValue = rev.status === "ready" ? rev.data.rev : undefined;
  useEffect(() => { store.refresh(revValue); }, [store, revValue]);
  const rows = useMemo(() => openWork(snap.rows), [snap.rows]);
  const keys = useMemo(() => new Map(snap.rows.map((r) => [r.id, r.key] as const)), [snap.rows]);
  if (rows.length === 0) return null;
  const lines: ReactElement[] = [];
  for (const r of rows.slice(0, WORK_SHOWN)) lines.push(<Line key={r.id} row={r} rt={rt} keyOf={(id) => keys.get(id)} nameOf={nameOf} openTask={openTask} openProfile={openProfile} />);
  const more = rows.length - WORK_SHOWN;
  const parent = rows[0]!.parentTaskId;
  return <View testID="chat-work" style={st.box}>
    {lines}
    {more > 0 && parent ? <Pressable accessibilityRole="link" accessibilityLabel={`${more} more`} testID="chat-work-more" onPress={() => openTask(parent)} style={st.more}><Text style={st.quiet}>{`${more} more`}</Text></Pressable> : null}
  </View>;
}

const st = StyleSheet.create({
  box: { marginTop: 14, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 7, borderRadius: 10 },
  text: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", gap: 9 },
  step: { flexShrink: 1, minWidth: 0 },
  title: { flexShrink: 0, maxWidth: "60%", fontSize: 14.5, fontWeight: "500", color: "var(--ink)" as string },
  quiet: { flexShrink: 1, fontSize: 13, color: "var(--ink-3)" as string },
  more: { paddingVertical: 6, paddingLeft: 36 },
});
