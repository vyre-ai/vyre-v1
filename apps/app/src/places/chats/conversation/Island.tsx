// The Island: a pill that floats above the composer while anyone in the chat is working, and goes away when nobody is. It holds the Vyre mark (moving with the lead's real state), the live state word,
// a divider, and one face per working agent in the one state language of every face (a moving ring: working, an amber ring: waiting, a green dot: finished; the one writing now is lifted). A press on
// a face steers that agent; a press on the pill opens the list of everyone working with the background jobs and their Stop; a computer button opens Watch the computer while an agent uses its computer.
// Everything comes from the live turns and their activity frames, never invented. Reduced motion stops the rings and the mark.
import { useEffect, useReducer, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Tooltip } from "../../../../../../ui/src/Tooltip/index.tsx";
import { WorkingMark } from "../../../../../../ui/src/WorkingMark/index.tsx";
import type { ActivityStore, LiveTurn } from "../../../shell/session/turn-streams.ts";
import { turnRowId } from "../../../shell/session/turn-streams.ts";
import { elapsedWords } from "./activity.ts";
import { agentOf, capFaces, hoverOf, islandOpen, wordOf } from "./island.ts";
import type { IslandAgent } from "./island.ts";

export interface IslandJob { threadId: string; title: string; startedAt: number }
export interface IslandProps {
  turns: readonly LiveTurn[];
  activityOf?: ((rowId: string) => ActivityStore | undefined) | undefined;
  nameOf(id: string): string;
  jobs: readonly IslandJob[];
  now(): number;
  onSteer(agentId: string): void;
  onStopJob(threadId: string): void;
  onOpenComputer(agentId: string): void;
}

/** The agents behind the live turns, one row each (an agent's newest turn), read from the stores now. A re-render comes with any store's change. */
function useAgents(p: IslandProps): IslandAgent[] {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const offs: Array<() => void> = [];
    for (const t of p.turns) {
      offs.push(t.store.subscribe(bump));
      const a = p.activityOf?.(turnRowId(t.turnId));
      if (a) offs.push(a.subscribe(bump));
    }
    return () => { for (const o of offs) o(); };
  }, [p.turns, p.activityOf]);
  const now = p.now();
  const byAgent = new Map<string, IslandAgent>();
  for (const t of p.turns) {
    const act = p.activityOf?.(turnRowId(t.turnId))?.get();
    byAgent.set(t.agentId, agentOf(t, act, t.store.getSnapshot().blocks.length > 0, p.nameOf(t.agentId), now));
  }
  return [...byAgent.values()];
}

const faceState = (a: IslandAgent): "working" | "waiting" | "done" => a.ring;

export function Island(p: IslandProps): ReactElement | null {
  const agents = useAgents(p);
  const [open, setOpen] = useState(false);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 640;
  if (!islandOpen(agents, p.jobs.length)) return null;
  const word = wordOf(agents) || (p.jobs.length > 0 ? `${p.jobs.length} in the background` : "");
  const { shown, more } = capFaces(agents, phone ? 3 : 8);
  const lead = agents.find((a) => a.writing) ?? agents.find((a) => a.ring !== "done");
  const computerAgent = agents.find((a) => a.computer);
  const now = p.now();
  return (
    <View testID="island" accessibilityLiveRegion="polite" style={st.wrap}>
      {open ? (
        <View testID="island-list" style={st.list}>
          {agents.map((a) => (
            <Pressable key={a.agentId} accessibilityRole="button" accessibilityLabel={`Steer ${a.name}`} testID={`island-row-${a.agentId}`} onPress={() => { p.onSteer(a.agentId); setOpen(false); }} style={st.row}>
              <Avatar name={a.name} seedId={a.agentId} kind="agent" size={24} state={faceState(a)} />
              <Text style={st.name}>{a.name}</Text>
              <Text numberOfLines={1} style={st.what}>{a.line}</Text>
              <Text style={st.time}>{a.ring === "done" ? "" : elapsedWords(a.seconds)}</Text>
            </Pressable>
          ))}
          {p.jobs.length > 0 ? <Text style={st.group}>In the background</Text> : null}
          {p.jobs.map((j) => (
            <View key={j.threadId} testID={`island-job-${j.threadId}`} style={st.row}>
              <WorkingMark state="thinking" size={20} />
              <Text numberOfLines={1} style={[st.name, { flex: 1 }]}>{j.title}</Text>
              <Text style={st.time}>{elapsedWords(Math.max(0, Math.round((now - j.startedAt) / 1000)))}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Stop ${j.title}`} testID={`island-stop-${j.threadId}`} onPress={() => p.onStopJob(j.threadId)} style={st.stop}><Text style={st.stopText}>Stop</Text></Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <View testID="island-pill" style={st.pill}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel="Everyone working" testID="island-toggle" onPress={() => setOpen((o) => !o)} style={st.lead}>
          <WorkingMark state={lead?.writing ? "writing" : "thinking"} step={lead?.line ?? ""} size={20} testID="island-mark" />
          <Text testID="island-word" style={st.word}>{word}</Text>
        </Pressable>
        {agents.length > 0 ? <View style={st.sep} /> : null}
        {shown.map((a) => (
          <Tooltip key={a.agentId} text={hoverOf(a)}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${hoverOf(a)}. Steer ${a.name}`} testID={`island-face-${a.agentId}`} onPress={() => p.onSteer(a.agentId)} style={[st.face, a.writing && st.faceLifted]}>
              <Avatar name={a.name} seedId={a.agentId} kind="agent" size={22} state={faceState(a)} />
            </Pressable>
          </Tooltip>
        ))}
        {more > 0 ? <Text testID="island-more" style={st.more}>{`+${more}`}</Text> : null}
        {computerAgent ? (
          <Tooltip text="Watch the computer">
            <Pressable accessibilityRole="button" accessibilityLabel="Watch the computer" testID="island-computer" onPress={() => p.onOpenComputer(computerAgent.agentId)} style={st.comp}><Text style={st.compText}>Watch</Text></Pressable>
          </Tooltip>
        ) : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { alignItems: "center", paddingBottom: 8, gap: 6 },
  pill: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 18, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string, maxWidth: "94%" },
  lead: { flexDirection: "row", alignItems: "center", gap: 8 },
  word: { color: "var(--ink-2)" as string, fontSize: 13 },
  sep: { width: 1, height: 16, backgroundColor: "var(--line)" as string },
  face: { padding: 3, borderRadius: 9 },
  faceLifted: { backgroundColor: "var(--accent-wash)" as string },
  more: { color: "var(--ink-3)" as string, fontSize: 12 },
  comp: { height: 24, paddingHorizontal: 8, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string },
  compText: { color: "var(--ink-2)" as string, fontSize: 12 },
  list: { width: "100%", maxWidth: 420, padding: 6, borderRadius: 14, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 34, paddingHorizontal: 8 },
  name: { color: "var(--ink)" as string, fontSize: 13 },
  what: { flex: 1, color: "var(--ink-3)" as string, fontSize: 12.5 },
  time: { color: "var(--ink-4)" as string, fontSize: 12, minWidth: 40, textAlign: "right", fontVariant: ["tabular-nums"] },
  group: { color: "var(--ink-4)" as string, fontSize: 11.5, paddingHorizontal: 8, paddingTop: 8 },
  stop: { height: 24, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: "var(--line)" as string, alignItems: "center", justifyContent: "center" },
  stopText: { color: "var(--ink-2)" as string, fontSize: 12 },
});
