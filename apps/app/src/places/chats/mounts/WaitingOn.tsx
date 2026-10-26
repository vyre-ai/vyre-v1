// The Waiting on line of a thread (spec 2.5): an agent that waits on background work (a build, a deploy, a long job) says so in the thread it was working in, and wakes there when the
// work ends. The wait is a run of kind "wait" on the thread (runs.mark_waiting / the engine's wait step), so the line reads the thread's runs from the kept copy: "Waiting on:
// build 42. Intake wakes here when it is done." It leaves when the run ends. A person can also stop the wait from the line's menu.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { ScreenHooks } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Icon } from "../rightpane/parts.tsx";
import { useLive } from "./live.ts";

export const RUNS_SCREEN = "runs.history";

type RunsOut = CapMap["runs.list"]["out"];
export type RunRow = RunsOut["runs"][number];

/** The runs that hold a thread open: waits that have not ended, newest first. */
export function waitsOf(runs: readonly RunRow[]): RunRow[] {
  return runs.filter((r) => r.kind === "wait" && (r.status === "waiting" || r.status === "running" || r.status === "queued")).sort((a, b) => b.startedAt - a.startedAt);
}

/** What the line says: what it waits on, and who wakes. */
export function waitingWords(run: Pick<RunRow, "name" | "summary">, agent: string): string {
  const on = (run.name ?? run.summary ?? "background work").replace(/\.+$/, "");
  return `Waiting on: ${on}. ${agent} wakes here when it is done.`;
}

export interface WaitingLineProps {
  screens: ScreenHooks;
  call(cap: string, input: unknown): Promise<unknown>;
  threadId: string;
  /** The lead agent of the thread: the one that wakes. */
  agent: string;
}

export function WaitingLine({ screens, call, threadId, agent }: WaitingLineProps): ReactElement | null {
  const q = useLive<RunsOut>(screens, RUNS_SCREEN, "runs", { scope: "subject", subject: { type: "thread", id: threadId }, statuses: ["queued", "running", "waiting"] });
  const menu = useMenu();
  if (q.status !== "ready") return null;
  const waits = waitsOf(q.data.runs);
  const first = waits[0];
  if (!first) return null;
  const extra = waits.length - 1;
  const items = [
    { label: "Stop Waiting", danger: true, onSelect: () => void call("runs.stop", { runId: first.id }).catch(() => undefined) },
  ];
  return (
    <View testID="waiting-on" accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={waitingWords(first, agent)} style={st.line} {...menuTrigger((x, y) => menu.show(items, x, y, "context", { label: "Waiting" }))}>
      <Icon name="clock" size={13} />
      <Text numberOfLines={2} style={st.text}>{waitingWords(first, agent)}{extra > 0 ? ` And ${extra} more.` : ""}</Text>
      {menu.element}
    </View>
  );
}

const st = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 6 },
  text: { flexShrink: 1, fontSize: 12.5, color: "var(--ink-3)" as string },
});
