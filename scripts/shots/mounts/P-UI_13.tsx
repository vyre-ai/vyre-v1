// Mount for P-UI_13: the shared TabStrip with overflow="more" and eight tabs. On a phone width the strip folds the tabs that do not fit into "N more" and keeps the active tab visible.
// @reads ../../../ui/src/TabStrip/index.tsx
import { useState } from "react";
import { View } from "react-native";
import { TabStrip } from "../../../ui/src/TabStrip/index.tsx";

export const title = "TabStrip overflow";

const TABS = ["Chats", "Memory", "Files", "Computer", "Automation runs", "Settings", "Agents", "Notes"].map((t) => ({ key: t.toLowerCase().replace(/\s+/g, "-"), title: t }));

export default function Mount() {
  const [active, setActive] = useState("settings");
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <TabStrip label="Agent tabs" tabs={TABS} active={active} onSelect={setActive} onPlus={() => undefined} overflow="more" />
    </View>
  );
}
