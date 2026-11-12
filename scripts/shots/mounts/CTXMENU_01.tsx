// Mount for CTXMENU_01 (lane l-calendar): the Chats sidebar over the Northwind sample, so the shoot can right-click a row and show the menu of that kind. ?kind=agent | agentmember | chat | person | channel.
// The sample gives the first starred agent a working computer; "agentmember" is the same agent for a member who is not an admin (the menu is shorter). The query is read after hydration.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ChatsSidebar } from "../../../apps/app/src/places/chats/sidebar/ChatsSidebar.tsx";
import { createSampleSidebar, northwind } from "../../../apps/app/src/places/chats/sidebar/sample.ts";
import { ShellRuntimeProvider } from "../../../apps/app/src/shell/providers/runtime.tsx";

export const title = "Right-click menus in the Chats sidebar";

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  const sample = useMemo(() => { const pin = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("pin"); const s = createSampleSidebar(pin ? { ...northwind, agents: northwind.agents.map((a) => (a.agentId === pin ? { ...a, starred: true } : a)) } : northwind); s.menus.computers.set("agt_intake", { computerId: "cmp_intake", state: "working" }); return s; }, []);
  const data = useMemo(() => ({ ...sample.data, nav: { ...sample.data.nav, openSubject: () => undefined }, people: (northwind.people ?? []).map((p) => ({ id: p.id, name: p.name })) }), [sample]);
  if (!q) return <View style={{ flex: 1 }} />;
  const member = q.get("kind") === "agentmember";
  const tree = <View style={{ width: 300, flex: 1, borderRightWidth: 1, borderRightColor: "var(--line)" as string }}><ChatsSidebar data={data} window={{ start: 0, end: 500 }} open={null} /></View>;
  return member ? <ShellRuntimeProvider value={{ permissions: new Set(["chats.private", "channels.create", "agents.create"]), space: { id: "spc_1", kind: "team", name: "Northwind" }, assistant: { id: "agt_assistant", name: "Assistant" } } as never}>{tree}</ShellRuntimeProvider> : tree;
}
