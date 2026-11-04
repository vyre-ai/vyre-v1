// Mount for lane l-memory (MEMORY-RULES 4, 5, 7, 9): what memory shows in a shared place. ?part=knows (the Knows tab in the side pane), noted (the quiet "Noted ... Undo" line and the open question with a choice per answer),
// chip (an agent's answer with its source chip). The query is read after mount (rule 25), so the first frame is empty and the client draws the same one.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Knows, SourceChip } from "../../../ui/src/Knows/index.tsx";
import type { KnowsItem } from "../../../ui/src/Knows/model.ts";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { MESSAGE_IDS, createChatMemorySample } from "../../../apps/app/src/places/chats/memory/sample.ts";
import { ChatMemoryProvider, ReplyMemory, createMemoryStore } from "../../../apps/app/src/places/chats/memory/index.ts";
import { LinkCard } from "../../../ui/src/blocks/link-card/LinkCard.tsx";

export const title = "Memory in a shared place: Knows, the Noted line, the open question, the source chip";

const ITEMS: KnowsItem[] = [
  { factId: "f1", kind: "decision", text: "Waive the consult fee for referrals", state: "current", by: "Omar Haddad", at: "Today 9:50 am", canEdit: true },
  { factId: "f2", kind: "decision", text: "The consult stays Tuesday at 2:00 with Maya", state: "current", by: "Maya Chen", at: "Yesterday 4:20 pm", canEdit: true },
  { factId: "f3", kind: "decision", text: "Consult on Monday at 11:00", state: "replaced", replacedBy: "The consult stays Tuesday at 2:00 with Maya", by: "Maya Chen", at: "Yesterday 4:12 pm", canEdit: true },
  { factId: "f4", kind: "fact", text: "Elena Rivera was referred by Maya Chen", state: "current", by: "Omar Haddad", at: "Yesterday 4:12 pm", canEdit: true },
  { factId: "f5", kind: "commitment", text: "Intake chases the intake form on Monday at 5:00 pm if it is not back", state: "current", by: "Intake", at: "Yesterday 4:20 pm", owes: "Mon 5:00 pm", canEdit: true },
  { factId: "f6", kind: "preference", text: "Short replies in this chat", state: "current", by: "Maya Chen", at: "Yesterday 4:20 pm", canEdit: true },
  { factId: "l1", kind: "decision", text: "Beta invites go out in waves of fifty", state: "current", by: "Olivia", at: "Today 8:40 am", canEdit: false, scope: "linked", from: "Beta invites task" },
  { factId: "s1", kind: "decision", text: "The consult stays Tuesday at 2:00 with Maya", state: "current", by: "Maya Chen", at: "Yesterday 4:20 pm", canEdit: false, scope: "space", from: "Rivera account" },
  { factId: "f7", kind: "decision", text: "Billing runs on the first", state: "disputed", by: "Maya Chen", at: "Monday", canEdit: true, questionId: "q1", qside: "a", short: "The first" },
  { factId: "f8", kind: "decision", text: "Billing runs on the fifteenth", state: "disputed", by: "Omar Haddad", at: "today", canEdit: true, questionId: "q1", qside: "b", short: "The fifteenth" },
  { factId: "f9", kind: "role", text: "Maya leads the Rivera account", state: "current", by: "Omar Haddad", at: "Yesterday 4:12 pm", canEdit: true },
];
const names = (id: string): string => ({ usr_maya: "Maya", usr_omar: "Omar" } as Record<string, string>)[id] ?? id;

const READS: Array<[string, unknown]> = [["memory.used", { threadId: "c1", messageId: MESSAGE_IDS.reply }], ["memory.used", { threadId: "c1", messageId: MESSAGE_IDS.held }]];
/** An agent's reply with its "Used N memories" line under it: the citation rule 7 asks for, with each memory's source chip. */
function Reply(): ReactNode {
  const s = useMemo(() => createChatMemorySample({}), []);
  const [ready, setReady] = useState(false);
  useEffect(() => { void s.warm(READS).then(() => setReady(true)); }, [s]);
  if (!ready) return <View style={{ flex: 1 }} />;
  return <View testID="memory-reply" style={{ flex: 1, backgroundColor: "var(--win)" as string }}><Conversation data={s.data} /></View>;
}

const REPLY = "We use Meridian for freight shipping now. It replaced Harbor.";
const NOW = Date.now();
/** A real answer's citation: "Used 2 memories" opened, each fact with its source chip (a press jumps to the message), who said it and how long ago. */
function Cite(): ReactNode {
  const memory = useMemo(() => ({
    store: createMemoryStore(async (cap: string) => {
      if (cap === "memory.used") {
        return { messageId: "msg_q", at: NOW, quotes: [], facts: [
          { factId: "f1", layer: "agent", ownerRef: "agt_a", text: "We decided to go with Meridian for freight shipping instead.", validFrom: NOW - 3_600_000, learnedAt: NOW - 3_600_000, sourceKind: "channel", sourceRef: "thr_deals", sourceLink: "/chats/thr_deals?m=msg_1", sourceTitle: "deals", status: "current", lowRisk: false, by: "usr_olivia", byKind: "person" },
          { factId: "f2", layer: "agent", ownerRef: "agt_a", text: "Freight shipping is billed monthly.", validFrom: NOW - 86_400_000, learnedAt: NOW - 86_400_000, sourceKind: "channel", sourceRef: "thr_deals", sourceLink: "/chats/thr_deals?m=msg_2", sourceTitle: "deals", status: "current", lowRisk: false, by: "usr_adam", byKind: "person" },
        ] };
      }
      if (cap === "memory.learned") return { items: [], total: 0 };
      return { pages: [], total: 0 };
    }),
    now: () => NOW, me: { id: "usr_noah", name: "Noah" }, nameOf: (id: string) => ({ usr_olivia: "Olivia Park", usr_adam: "Adam Reyes", usr_noah: "Noah" } as Record<string, string>)[id] ?? id, nav: {} as never,
  }), []);
  return (
    <View testID="memory-cite" style={{ padding: 16, maxWidth: 620, backgroundColor: "var(--win)" as string, minHeight: 500, gap: 6 }}>
      <Text style={{ fontSize: 14, fontWeight: "600", color: "var(--ink)" as string }}>Scout</Text>
      <Text style={{ fontSize: 14, lineHeight: 22, color: "var(--ink)" as string }}>{REPLY}</Text>
      <ChatMemoryProvider memory={memory as never} threadId="thr_q"><ReplyMemory messageId="msg_q" threadId="thr_q" reply={REPLY} startOpen /></ChatMemoryProvider>
    </View>
  );
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "knows"), []);
  if (part === null) return null;
  if (part === "reply") return <Reply />;
  if (part === "cite") return <Cite />;
  const wrap = (kids: ReactNode): ReactNode => <View style={{ padding: 16, maxWidth: 520, backgroundColor: "var(--paper)" as string, minHeight: 700 }}>{kids}</View>;
  if (part === "noted") {
    return wrap(
      <View testID="memory-noted" style={{ gap: 12 }}>
        <LinkCard id="n1" time="9:50 am" data={{ icon: "fact", lead: "Noted: decision", style: "noted", title: "Waive the consult fee for referrals", target: { type: "fact", id: "f1" }, actions: [{ key: "undo", label: "Undo", cap: "memory.undo", input: { factId: "f1" } }] }} nameOf={names} />
        <LinkCard id="n2" time="4:21 pm" data={{ icon: "fact", lead: "Noted: commitment", style: "noted", title: "Intake chases the form on Monday at 5:00 pm", target: { type: "fact", id: "f5" }, actions: [{ key: "undo", label: "Undo", cap: "memory.undo", input: { factId: "f5" } }] }} nameOf={names} />
        <LinkCard id="q1" data={{ icon: "fact", lead: "Open question", style: "question", title: "Maya and Omar disagree", sub: "Which holds? Vyre will not guess.", body: "Maya said Thursday on Monday.\nOmar said Friday today.", actions: [{ key: "a", label: "Thursday", cap: "memory.question.resolve", input: {} }, { key: "b", label: "Friday", cap: "memory.question.resolve", input: {} }] }} nameOf={names} />
      </View>,
    );
  }
  if (part === "chip") {
    return wrap(
      <View testID="memory-chip" style={{ gap: 6 }}>
        <Text style={{ fontSize: 14, color: "var(--ink)" as string }}>The consult stays Tuesday at 2:00 with Maya.</Text>
        <SourceChip by="Maya Chen" at="Yesterday 4:20 pm" />
      </View>,
    );
  }
  return wrap(<Knows place="Rivera account" items={ITEMS} onSource={() => undefined} onEdit={() => undefined} onRemove={() => undefined} />);
}
