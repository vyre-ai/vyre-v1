// Mount for PROFILE_01 (lane l-profile, owner ruling 3 Nov): the person profile. ?part=settings shows Settings > Memory and privacy over the Northwind sample (About you, public and private,
// then Who pays for memory); ?part=knows shows the chat's right pane on Knows with About you at the top, for a chat only you read (?audience=private, the default) or one other people read
// (?audience=shared).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { SettingsDataProvider } from "../../../apps/app/src/places/settings/data.tsx";
import { SettingsPlace } from "../../../apps/app/src/places/settings/SettingsPlace.tsx";
import { createSampleSettings, northwind } from "../../../apps/app/src/places/settings/sample.ts";
import { ChatRightPane } from "../../../apps/app/src/places/chats/rightpane/ChatRightPane.tsx";
import { ASSISTANT, MESSAGE_IDS, createChatMemorySample } from "../../../apps/app/src/places/chats/memory/sample.ts";

export const title = "Profile: About you";

function Knows({ audience }: { audience: "private" | "shared" }): ReactNode {
  const s = useMemo(() => createChatMemorySample({ audience }), [audience]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void s.warm([
      ["memory.profile.get", { threadId: "c1" }], ["memory.knows", { threadId: "c1", agentId: ASSISTANT }], ["memory.facts.list", { status: ["proposed"], layer: "agent", agentId: ASSISTANT }],
      ["memory.map.get", { agentId: ASSISTANT }], ["memory.used", { threadId: "c1", messageId: MESSAGE_IDS.reply }], ["memory.used", { threadId: "c1", messageId: MESSAGE_IDS.held }],
    ]).then(() => setReady(true));
  }, [s]);
  if (!ready) return <View style={{ flex: 1 }} />;
  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "var(--ink-4)" as string, fontSize: 13 }}>{audience === "private" ? "Your chat with Assistant" : "A channel with Maya and Omar"}</Text></View>
      <ChatRightPane data={s.pane} open onToggle={() => undefined} initialTab="memory" window={{ start: 0, end: 500 }} />
    </View>
  );
}

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const q = useMemo(() => new URLSearchParams(search ?? ""), [search]);
  const sample = useMemo(() => createSampleSettings(northwind), []);
  const { height } = useWindowDimensions();
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (q.get("part") === "knows") return <Knows audience={q.get("audience") === "shared" ? "shared" : "private"} />;
  return (
    <SettingsDataProvider value={sample.data}>
      <View style={{ height }}><SettingsPlace initialPage="memory" /></View>
    </SettingsDataProvider>
  );
}
