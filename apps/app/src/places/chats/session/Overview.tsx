// The session Overview (prototype t-session): the first tab of the right pane in a long chat. What the session is for, who is on it, the files they touched, what was decided, what is still open, a jump to each
// moment worth coming back to, and how full the context is. Everything is read from the chat, its crew and the engine; nothing is written here. `OverviewView` draws from plain values (tests, shots); `SessionOverview` reads them.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Glyph } from "../conversation/parts.tsx";
import { faceSeed, nameOf as memberName } from "../crew/model.ts";
import type { CrewMember, CrewStatusOut } from "../crew/model.ts";
import { statusWord, whoOf } from "./CrewBlock.tsx";
import { contextWords, ranWords } from "./model.ts";
import type { SessionSummary } from "./model.ts";

export interface OverviewProps {
  goal: string;
  summary: SessionSummary;
  members: readonly CrewMember[];
  /** "38% of 1M", or "" while unknown. */
  context: { words: string; frac: number } | null;
  clock: (ts: number) => string;
  /** a person or agent id as a name ("You" for the viewer) */
  who?: (id: string) => string;
  onHelper(id: string): void;
  onJump(messageId: string): void;
}

const Section = ({ title, children }: { title: string; children: ReactElement | ReactElement[] | null }): ReactElement | null => (children === null || (Array.isArray(children) && children.length === 0) ? null : <View style={st.section}><Text accessibilityRole="header" style={st.h}>{title}</Text>{children}</View>);

/** Every file the crew touched, once, with the helper that touched it. */
export function filesOf(members: readonly CrewMember[]): Array<{ path: string; by: string; added: number; deleted: number }> {
  const seen = new Map<string, { path: string; by: string; added: number; deleted: number }>();
  for (const m of members) for (const f of m.files ?? []) if (!seen.has(f.path)) seen.set(f.path, { path: f.path, by: whoOf(m).name, added: f.added, deleted: f.deleted });
  return [...seen.values()];
}

/** What waits on the person besides the questions in the chat: a helper that needs a yes. */
export const waitingOf = (members: readonly CrewMember[]): Array<{ id: string; text: string; who: string }> => members.filter((m) => m.state === "needs_you").map((m) => ({ id: m.id, text: m.step ?? "needs your OK", who: whoOf(m).name }));

const Quiet = ({ children, wait = false }: { children: string; wait?: boolean }): ReactElement => <Text numberOfLines={1} style={[st.rowEnd, wait && st.wait]}>{children}</Text>;

export function OverviewView({ goal, summary, members, context, clock, who = (id) => id, onHelper, onJump }: OverviewProps): ReactElement {
  const files = filesOf(members);
  const waiting = waitingOf(members);
  const questions = summary.questions.length + waiting.length;
  return (
    <ScrollView testID="session-overview" style={st.root} contentContainerStyle={st.body}>
      <Section title="Goal">{goal !== "" ? <Text testID="overview-goal" style={st.p}>{goal}</Text> : null}</Section>
      <Section title="Helpers">
        {members.map((m) => {
          const w = whoOf(m);
          return <Row key={m.id} id={`overview-helper-${m.id}`} title={w.name} leading={<View style={{ marginRight: 8 }}><Avatar name={memberName(m)} seedId={faceSeed(m)} kind="agent" size={20} /></View>} trailing={<Text numberOfLines={1} style={[st.rowEnd, m.state === "needs_you" && st.wait]}>{w.task !== "" ? `${w.task}   ${statusWord(m.state)}` : statusWord(m.state)}</Text>} onPress={() => onHelper(m.id)} />;
        })}
      </Section>
      <Section title="Files touched">
        {files.map((f) => <Row key={f.path} id={`overview-file-${f.path}`} title={f.path.split("/").pop() ?? f.path} leading={<View style={{ marginRight: 8 }}><Glyph name="file" size={14} /></View>} trailing={<Quiet>{f.by}</Quiet>} inert />)}
      </Section>
      <Section title="Decisions">
        {summary.decisions.map((d) => <Row key={d.messageId} id={`overview-decision-${d.messageId}`} title={d.sub} trailing={<Quiet>{d.by !== "" ? `${who(d.by)}, ${clock(d.at)}` : clock(d.at)}</Quiet>} onPress={() => onJump(d.messageId)} />)}
      </Section>
      <Section title="Open questions">
        {questions === 0 ? null : [
          ...summary.questions.map((q) => <Row key={q.messageId} id={`overview-question-${q.messageId}`} title={q.text} trailing={<Quiet>{who(q.by)}</Quiet>} onPress={() => onJump(q.messageId)} />),
          ...waiting.map((w) => <Row key={w.id} id={`overview-waiting-${w.id}`} title={w.text} trailing={<Quiet>{w.who}</Quiet>} onPress={() => onHelper(w.id)} />),
        ]}
      </Section>
      <Section title="Jump to">
        {summary.jumps.map((j) => <Row key={j.messageId} id={`overview-jump-${j.messageId}`} title={j.label} trailing={<Quiet>{clock(j.at)}</Quiet>} onPress={() => onJump(j.messageId)} />)}
      </Section>
      <Section title="Usage">
        {[
          ...(context ? [<View key="ctx" testID="overview-context" style={st.meter}><View style={st.meterHead}><Text style={st.rowSub}>Context</Text><Text style={st.meterVal}>{context.words}</Text></View><View style={st.track}><View style={[st.fill, { width: `${Math.round(Math.min(1, context.frac) * 100)}%` }]} /></View></View>] : []),
          ...(summary.to > summary.from ? [<View key="ran" testID="overview-ran" style={st.meterHead}><Text style={st.rowSub}>Session</Text><Text style={st.meterVal}>{ranWords(summary.from, summary.to)}</Text></View>] : []),
        ]}
      </Section>
    </ScrollView>
  );
}

type Call = (cap: string, input: unknown) => Promise<unknown>;

/** The goal of this chat (the goal whose thread it is), else what the person first asked for; the context share from the engine. */
export function useOverviewReads(call: Call, threadId: string, agentId: string): { goal: string; context: OverviewProps["context"] } {
  const [goal, setGoal] = useState("");
  const [context, setContext] = useState<OverviewProps["context"]>(null);
  useEffect(() => {
    let dead = false;
    void Promise.resolve(call("goals.list", { scope: "all" })).then((r) => {
      if (dead) return;
      const g = ((r as { goals?: Array<{ title: string; threadId?: string; status: string }> } | undefined)?.goals ?? []).find((x) => x.threadId === threadId && x.status !== "stopped");
      setGoal(g?.title ?? "");
    }, () => undefined);
    const readUsage = (): void => {
      void Promise.resolve(call("engine.usage.get", { threadId, agentId })).then((r) => {
        if (dead) return;
        const c = (r as { context?: { used: number; window: number; approximate?: boolean } | null } | undefined)?.context ?? null;
        const words = contextWords(c);
        setContext(c && words !== "" ? { words, frac: c.used / c.window } : null);
      }, () => undefined);
    };
    readUsage();
    const t = setInterval(readUsage, 20_000);
    (t as { unref?: () => void }).unref?.();
    return () => { dead = true; clearInterval(t); };
  }, [call, threadId, agentId]);
  return { goal, context };
}

export function SessionOverview({ call, threadId, agentId, summary, status, clock, who, onHelper, onJump }: { call: Call; threadId: string; agentId: string; summary: SessionSummary; status: CrewStatusOut | null; clock: (ts: number) => string; who?: (id: string) => string; onHelper(id: string): void; onJump(messageId: string): void }): ReactElement {
  const { goal, context } = useOverviewReads(call, threadId, agentId);
  return <OverviewView goal={goal !== "" ? goal : summary.firstAsk} summary={summary} members={status?.members ?? []} context={context} clock={clock} {...(who ? { who } : {})} onHelper={onHelper} onJump={onJump} />;
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  body: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24, gap: 24 },
  section: { gap: 4 },
  h: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string, marginBottom: 4 },
  p: { fontSize: 14, lineHeight: 21, color: "var(--ink)" as string },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 12 },
  hover: { backgroundColor: "var(--hover)" as string },
  rowMain: { flexShrink: 1, minWidth: 0, fontSize: 14, color: "var(--ink)" as string },
  rowSub: { flexShrink: 1, minWidth: 0, fontSize: 13, color: "var(--ink-3)" as string },
  rowStatus: { width: 96, textAlign: "right", fontSize: 12, color: "var(--ink-3)" as string },
  rowEnd: { marginLeft: "auto", fontSize: 12, color: "var(--ink-3)" as string },
  wait: { color: "var(--warn)" as string },
  meter: { gap: 4, marginBottom: 8 },
  meterHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  meterVal: { fontSize: 13, color: "var(--ink-2)" as string },
  track: { height: 4, borderRadius: 2, backgroundColor: "var(--line)" as string, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2, backgroundColor: "var(--accent)" as string },
});
