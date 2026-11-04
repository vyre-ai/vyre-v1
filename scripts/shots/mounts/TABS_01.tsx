// Mount for the one-tab-per-place rule (lane l-chrome2a). ?part=
//   before  the tab strip as a saved list shows it: a chat tab named Chats next to the Chats place, and a New chat tab
//   after   the same saved list read by the tab controller: chat tabs named for the chat (its name, else New chat), Chats opened again from the rail adds nothing
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { TabStrip } from "../../../ui/src/TabStrip/index.tsx";
import { MainTabs, tabSpecs } from "../../../apps/app/src/shell/tabs/MainTabs.tsx";
import { createTabsController, tabsStorageKey, writeTabs } from "../../../apps/app/src/shell/tabs/store.ts";
import type { TabEntry } from "../../../apps/app/src/shell/tabs/store.ts";

export const title = "One tab per place";

const SAVED: TabEntry[] = [
  { key: "files", title: "Files", place: "files", at: 4 },
  { key: "chats", title: "Chats", place: "chats", at: 20 },
  { key: "chats:subject=thread:thr_9", title: "Chats", place: "chats", hash: "subject=thread:thr_9", at: 10 },
  { key: "chats:subject=thread:thr_8", title: "Chats", place: "chats", hash: "subject=thread:thr_8", at: 8 },
  { key: "new:1", title: "New chat", place: "chats", isNew: true, at: 30 },
];

export default function Mount(): ReactNode {
  const part = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "after";
  const controller = useMemo(() => {
    const data = new Map<string, string>([[tabsStorageKey("mac", "olivia", "firm"), writeTabs({ tabs: SAVED, active: "chats" })]]);
    const c = createTabsController({ deviceId: "mac", personId: "olivia", spaceId: "firm", storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } }, start: "chats" });
    c.openPlace("chats");
    c.retitle("chats:subject=thread:thr_9", "Renewal letter for the Rivera account");
    return c;
  }, []);
  return (
    <View style={{ flex: 1, minHeight: 160, padding: 24, backgroundColor: "var(--win)" as string }}>
      <View data-testid="tabs-shot" style={{ maxWidth: 900, width: "100%" }}>
        {part === "before" ? <TabStrip label="Open tabs" hideLoneClose noOptions tabs={tabSpecs(SAVED)} active="chats" /> : <MainTabs controller={controller} />}
      </View>
    </View>
  );
}
