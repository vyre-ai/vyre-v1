// Mount for one name per chat (lane l-learn2): the sidebar and the header of the same chat side by side, agreeing. ?part=
//   untitled (a chat with no title yet: both read who is in it), titled (the title the server made after the first real request), dm (a direct message: both read the person, whatever the stored title says)
// The query is read after mount (the static export keeps the first frame's markup).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { createSample as createConversationSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import { ChatsSidebar } from "../../../apps/app/src/places/chats/sidebar/ChatsSidebar.tsx";
import { createSampleSidebar, northwind } from "../../../apps/app/src/places/chats/sidebar/sample.ts";

export const title = "One name per chat";

const TITLES: Record<string, string> = { untitled: "", titled: "GHL onboarding goal", dm: "Heyy", group: "Lab 8 launch" };
const GROUP = [{ kind: "person", id: "usr_irfad" }, { kind: "person", id: "usr_maya" }, { kind: "person", id: "usr_omar" }, { kind: "person", id: "usr_priya" }, { kind: "agent", id: "agt_intake" }, { kind: "agent", id: "agt_docs" }] as never;

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "untitled"), []);
  const { width } = useWindowDimensions();
  const stored = TITLES[part ?? "untitled"] ?? "";
  const side = useMemo(() => {
    const sb = createSampleSidebar(northwind);
    const rows = sb.replica.rows("threads") as unknown as { id: string; threadId: string }[];
    const row = rows.find((r) => r.threadId === "c1");
    if (row) sb.replica.put("threads", [{ ...row, title: stored, agents: ["agt_intake", "agt_docs"] }]);
    return sb.data;
  }, [stored]);
  const conv = useMemo(() => createConversationSample("idle", { title: stored, ...(part === "group" ? { members: GROUP } : {}) }).data, [stored, part]);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const narrow = width < 700;
  return (
    <View style={{ flex: 1, flexDirection: narrow ? "column" : "row", backgroundColor: "var(--win)" as string }}>
      <View style={narrow ? { height: 300 } : { width: 272, flexShrink: 0 }}><ChatsSidebar data={side} window={{ start: 0, end: 500 }} open="c1" /></View>
      <View style={{ flex: 1, minHeight: 0 }}><Conversation data={conv} /></View>
    </View>
  );
}
