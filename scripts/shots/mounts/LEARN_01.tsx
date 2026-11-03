// Mount for LEARN_01 (lane l-learn, owner approval 3 Nov 2026): learn from every correction. ?part=chat shows the conversation with the quiet "Learned: ..." line under the message that taught a lesson
// (Only you, Undo, See) and "Used a lesson" under the reply that followed; ?part=knows shows the chat's right pane on Knows with the lessons the agent kept (how it was caught, when, how often it was used,
// who may read it, and Edit, Where it came from, Share with the Space, Make it an instruction, Forget, and the switch); ?part=settings shows Settings > Memory and privacy with Lessons from your corrections.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { ChatRightPane } from "../../../apps/app/src/places/chats/rightpane/ChatRightPane.tsx";
import { ASSISTANT, MESSAGE_IDS, createChatMemorySample } from "../../../apps/app/src/places/chats/memory/sample.ts";
import { SettingsDataProvider } from "../../../apps/app/src/places/settings/data.tsx";
import { SettingsPlace } from "../../../apps/app/src/places/settings/SettingsPlace.tsx";
import { createSampleSettings, northwind } from "../../../apps/app/src/places/settings/sample.ts";

export const title = "Learn from every correction";

const READS: Array<[string, unknown]> = [
  ["memory.knows", { threadId: "c1", agentId: ASSISTANT }], ["memory.facts.list", { status: ["proposed"], layer: "agent", agentId: ASSISTANT }], ["memory.map.get", { agentId: ASSISTANT }],
  ["memory.used", { threadId: "c1", messageId: MESSAGE_IDS.reply }], ["memory.used", { threadId: "c1", messageId: MESSAGE_IDS.held }],
  ["memory.facts.list", { status: ["current"], agentId: ASSISTANT, kind: "lesson" }], ["memory.facts.list", { status: ["current"], agentId: ASSISTANT }], ["settings.get", { key: "memory.lessons" }],
];

function Chat({ part }: { part: "chat" | "knows" }): ReactNode {
  const s = useMemo(() => createChatMemorySample({ lessons: true }), []);
  const [ready, setReady] = useState(false);
  useEffect(() => { void s.warm(READS).then(() => setReady(true)); }, [s]);
  if (!ready) return <View style={{ flex: 1 }} />;
  if (part === "knows") {
    return (
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ flex: 1 }}><Conversation data={s.data} /></View>
        <ChatRightPane data={s.pane} open onToggle={() => undefined} initialTab="memory" window={{ start: 0, end: 500 }} />
      </View>
    );
  }
  return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}><Conversation data={s.data} /></View>;
}

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const q = useMemo(() => new URLSearchParams(search ?? ""), [search]);
  const sample = useMemo(() => createSampleSettings(northwind), []);
  const { height } = useWindowDimensions();
  // the Lessons section is under About you: bring it into view once the page has drawn
  useEffect(() => {
    if (search === null || q.get("part") !== "settings") return undefined;
    const doc = (globalThis as { document?: { querySelector(s: string): { scrollIntoView(o?: unknown): void } | null } }).document;
    const t = setInterval(() => { const el = doc?.querySelector("[data-testid='lessons']"); if (el) { el.scrollIntoView({ block: "start" }); clearInterval(t); } }, 100);
    return () => clearInterval(t);
  }, [search, q]);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const part = q.get("part");
  if (part === "chat" || part === "knows") return <Chat part={part} />;
  return (
    <SettingsDataProvider value={sample.data}>
      <View style={{ height }}><SettingsPlace initialPage="memory" /></View>
    </SettingsDataProvider>
  );
}
