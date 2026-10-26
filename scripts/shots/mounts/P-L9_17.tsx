// Mount for P-L9_17 (phone shell): the phone shell over the Northwind sample Space (?space=harbor for Harbor Studio). ?tab=chats (default), inbox, records, files or you opens that tab. The Chats tab is the real
// Chats sidebar as a full-screen list: tap a chat and the conversation opens on top (Back returns to the list), tap a Needs you row for the same. You is the real You screen. Swipe a chat row left
// (or right-click it) for Star and Mark read.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { createSample as createConversationSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import { ChatsSidebar } from "../../../apps/app/src/places/chats/sidebar/ChatsSidebar.tsx";
import { createSampleSidebar, harbor, northwind } from "../../../apps/app/src/places/chats/sidebar/sample.ts";
import { MobileShell, YouScreen } from "../../../apps/app/src/mobile/shell/index.ts";
import type { Entry, MobileNav, TabId } from "../../../apps/app/src/mobile/shell/index.ts";

export const title = "Phone shell";

const TABS: readonly TabId[] = ["chats", "inbox", "records", "files", "you"];

/** The conversation, made once when its screen first draws. */
function ChatOpen({ make }: { make: () => ReturnType<typeof createConversationSample>["data"] }): ReactNode {
  const data = useMemo(make, [make]);
  return <Conversation data={data} />;
}

export default function Mount(): ReactNode {
  // The query is read after mount: the static export renders the first frame without it, and the client must render that same frame or React leaves the exported markup behind.
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const params = useMemo(() => new URLSearchParams(search ?? ""), [search]);
  const team = params.get("space") === "harbor" ? harbor : northwind;
  const tabParam = params.get("tab") ?? "";
  const tab: TabId = TABS.find((t) => t === tabParam) ?? "chats";
  const sidebar = useMemo(() => createSampleSidebar(team), [team]);
  // the conversation sample is made when a chat is opened, not at start (startup draws the tab bar and the first list only)
  const conversation = useMemo(() => ({ get data() { return createConversationSample("idle").data; } }), []);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  // ?empty=1 draws nothing but the page: a blank baseline.
  if (params.get("empty") === "1") return <View testID="mobile-tabs" style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const render = (e: Entry, nav: MobileNav): ReactNode => {
    if (e.screen === "chats") {
      // a tap on a chat, a face or a Needs you row opens the conversation on top
      const open = (id: string, name: string): void => nav.open({ tab: "chats", screen: `chat:${id}`, title: name });
      const data = { ...sidebar.data, nav: { ...sidebar.data.nav, openChat: (id: string) => open(id, "Chats"), openAgentChat: (id: string) => open(id, "Chats"), openNeedsYou: (id?: string) => open(id ?? "needs", "Chats") } };
      return <ChatsSidebar data={data} {...(params.get("all") === "1" ? { window: { start: 0, end: 500 } } : {})} />;
    }
    if (e.screen.startsWith("chat:")) return <ChatOpen make={() => conversation.data} />;
    if (e.screen === "you") return <YouScreen nav={nav} data={{ name: "Irfad Imtiaz", space: team.name, workOpen: 4, starred: 3 }} />;
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "var(--ink-3)" as string, fontSize: 14 }}>{e.title ?? e.screen}</Text></View>;
  };
  return (
    <View style={{ flex: 1, alignItems: "center", backgroundColor: "var(--win)" as string }}>
      <View style={{ flex: 1, width: "100%", maxWidth: 480 }}>
        <MobileShell renderScreen={render} needsYou={team.needsTotal} initialTab={tab} />
      </View>
    </View>
  );
}
