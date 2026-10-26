// The All agents picker (spec 3.2, registry screen chats.all-agents): every agent the Space has, found by name or role, under the control that opened it (the Agents header's menu or
// the arrow row). A press starts or returns to a chat with the agent (chat.start through the shell's openAgentChat), right-click offers its page, and New agent opens the place
// where agents are made. The rows are the shared PaneList over ui/Row with the agent's face in the leading slot, so hover, selection and the keyboard are the list's own.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { ScreenHooks } from "../../../../../../client/src/index.ts";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Face, PaneList, TextButton } from "../rightpane/parts.tsx";
import type { Entry } from "../rightpane/parts.tsx";
import { LayerHead, Popover } from "./Layers.tsx";
import { useLive } from "./live.ts";

export const ALL_AGENTS_SCREEN = "chats.all-agents";

type AgentsOut = CapMap["agents.list"]["out"];
export type AgentRow = AgentsOut["agents"][number];

export interface AllAgentsProps {
  screens: ScreenHooks;
  space: { name: string };
  x: number;
  y: number;
  /** Start (or return to) a chat with this agent. */
  onChat(agentId: string): void;
  onOpenPage(agentId: string): void;
  /** Where agents are made; the button is left out when the shell has no such place. */
  onNewAgent?: () => void;
  onClose: () => void;
  window?: VirtualWindow;
}

const STATUS: Readonly<Record<AgentRow["status"], string>> = { working: "Working", awake: "", asleep: "Asleep", paused: "Paused" };

/** Working agents first, then by name; a query keeps the agents whose name or role holds every word of it. */
export function pickAgents(list: readonly AgentRow[], query: string): AgentRow[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  const hit = (a: AgentRow): boolean => { const hay = `${a.name} ${a.role ?? ""}`.toLowerCase(); return words.every((w) => hay.includes(w)); };
  const rank = (a: AgentRow): number => (a.status === "working" ? 0 : a.status === "paused" ? 2 : 1);
  return list.filter(hit).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function AllAgents({ screens, space, x, y, onChat, onOpenPage, onNewAgent, onClose, window }: AllAgentsProps): ReactElement {
  const q = useLive<AgentsOut>(screens, ALL_AGENTS_SCREEN, "agents", {});
  const [find, setFind] = useState("");
  const all = q.status === "ready" ? q.data.agents : [];
  const shown = pickAgents(all, find);

  const entries: Entry[] = [];
  if (q.status === "loading") entries.push({ key: "loading", type: "empty", text: "Loading", testID: "all-agents-loading" });
  else if (shown.length === 0) entries.push({ key: "none", type: "empty", text: all.length === 0 ? "This Space has no agents yet." : `No agent matches "${find.trim()}".`, testID: "all-agents-empty" });
  for (const a of shown) {
    const word = STATUS[a.status];
    entries.push({
      key: a.agentId, type: "row", title: a.name, testID: `agent-${a.agentId}`, ...(a.role ? { note: a.role } : {}),
      leading: <Face name={a.name} seedId={a.agentId} size={22} pulse={a.status === "working"} />,
      ...(word ? { trailing: <Text style={st.status}>{word}</Text> } : {}),
      onPress: () => { onChat(a.agentId); onClose(); },
      menu: [
        { label: "Chat", onSelect: () => { onChat(a.agentId); onClose(); } },
        { label: `Open ${a.name}'s Page`, onSelect: () => { onOpenPage(a.agentId); onClose(); } },
      ],
    });
  }

  return (
    <Popover x={x} y={y} width={360} label="All agents" testID="all-agents" onClose={onClose}>
      <LayerHead title="All agents" sub={q.status === "ready" ? `${all.length} in ${space.name}` : space.name} onClose={onClose} />
      <View style={st.findBox}>
        <TextInput
          testID="all-agents-search" accessibilityLabel="Find an agent" autoFocus value={find} onChangeText={setFind} placeholder="Find an agent" placeholderTextColor="var(--ink-4)"
          autoCapitalize="none" autoCorrect={false} style={st.find}
        />
      </View>
      <View style={st.list}><PaneList entries={entries} testID="all-agents-rows" {...(window ? { window } : {})} /></View>
      {onNewAgent ? (
        <View style={st.foot}><TextButton label="New agent" onPress={() => { onNewAgent(); onClose(); }} testID="all-agents-new" /></View>
      ) : null}
    </Popover>
  );
}

const st = StyleSheet.create({
  findBox: { paddingHorizontal: 12, paddingBottom: 6 },
  find: { height: 30, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--win)" as string, color: "var(--ink)" as string, fontSize: 13 },
  list: { height: 280, paddingHorizontal: 4 },
  status: { fontSize: 11.5, color: "var(--ink-3)" as string },
  foot: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
});
