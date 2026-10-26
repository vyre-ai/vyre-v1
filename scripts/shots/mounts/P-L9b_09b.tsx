// Mount for P-L9b_09b: the agent page whose tab strip folds at the phone width (390 px: Settings behind More) and shows all five tabs on desktop.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { AgentPage } from "../../../apps/app/src/places/chats/agentpage/AgentPage.tsx";
import { DEFAULT_TAB, isTabKey } from "../../../apps/app/src/places/chats/agentpage/model.ts";
import { createSample } from "../../../apps/app/src/places/chats/agentpage/sample.ts";

export const title = "Agent page tab strip";

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const tabParam = useMemo(() => new URLSearchParams(search ?? "").get("tab") ?? "", [search]);
  const sample = useMemo(() => createSample("owner"), []);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <AgentPage data={sample.data} initialTab={isTabKey(tabParam) ? tabParam : DEFAULT_TAB} window={{ start: 0, end: 500 }} />
    </View>
  );
}
