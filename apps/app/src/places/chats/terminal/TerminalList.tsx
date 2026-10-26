// The Terminals list (spec 2.7, registry screen chats.terminal-list): every session the person may see, running ones first, with where it runs and when it was last used. A press shows
// it as the terminal tab; the star puts it on Home; "New terminal" asks which host (an agent computer, the Space server, this computer) in the shared menu, under the button.
// One shared PaneList draws the rows, so hover, right-click and the keyboard are the ones every list has.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MenuIcon, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { HOST_NAMES, TERMINAL_HOSTS } from "../../../../../../ui/src/Terminal/index.tsx";
import type { TerminalHost } from "../../../../../../ui/src/Terminal/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { errorWords, isRefusal, useLive } from "../mounts/live.ts";
import { LayerHead, Popover } from "../mounts/Layers.tsx";
import { Icon, LeadIcon, PaneList, Tool } from "../rightpane/parts.tsx";
import type { Entry } from "../rightpane/parts.tsx";
import { LIST_SCREEN, STARS_SCREEN } from "./data.ts";
import type { TerminalData } from "./data.ts";
import { ago, chipLabel, ordered, sessionLine } from "./model.ts";
import { closeSession, openSession, toggleStar } from "./session.ts";

type ListOut = CapMap["terminal.list"]["out"];
type StarsOut = CapMap["stars.list"]["out"];

function StarButton({ on, onPress, testID }: { on: boolean; onPress: () => void; testID: string }): ReactElement {
  return (
    <Pressable role="button" aria-pressed={on} accessibilityLabel={on ? "Remove star" : "Star"} onPress={onPress} testID={testID} style={({ hovered }: { hovered?: boolean }) => [st.star, hovered === true && st.starOver]}>
      <MenuIcon icon="star" size={14} color={on ? "var(--warn)" : "var(--ink-3)"} />
    </Pressable>
  );
}

export function TerminalList({ data, x, y, onClose, window }: { data: TerminalData; x: number; y: number; onClose: () => void; window?: VirtualWindow }): ReactElement {
  const q = useLive<ListOut>(data.screens, LIST_SCREEN, "terminals", {});
  const stars = useLive<StarsOut>(data.screens, STARS_SCREEN, "stars", {});
  const menu = useMenu();
  const [line, setLine] = useState<string | null>(null);
  const deps = { call: data.call, newKey: data.newKey };
  const starred = new Set(stars.status === "ready" ? stars.data.stars.filter((s) => s.resource.type === "terminal").map((s) => s.resource.id) : []);
  const now = data.clock().now;

  const openOn = (h: TerminalHost): void => {
    const who = data.agent ? { agentId: data.agent.agentId, ...(data.agent.computerId ? { computerId: data.agent.computerId } : {}) } : {};
    void openSession(deps, h, who).then(
      (t) => { data.nav.openTerminal(t.terminalId); onClose(); },
      (e: unknown) => setLine(h === "server" && isRefusal(e) ? "The Space server's shell needs server.services. Ask an Owner or a Developer." : errorWords(e, "Could not open it.")),
    );
  };
  const newMenu = (px: number, py: number): void => {
    const items: MenuEntry[] = [{ head: "New terminal on" }];
    for (const h of TERMINAL_HOSTS) items.push({ label: HOST_NAMES[h], onSelect: () => openOn(h) });
    menu.show(items, px, py, "other", { label: "New terminal" });
  };

  const entries: Entry[] = [];
  if (q.status === "ready") {
    const rows = ordered(q.data.terminals);
    if (rows.length === 0) entries.push({ key: "none", type: "empty", text: "No terminals yet. New terminal starts one on a host.", testID: "terminals-empty" });
    for (const t of rows) {
      const on = starred.has(t.terminalId);
      const flip = (): void => { void toggleStar(deps, t.terminalId, !on).then((ok) => { if (!ok) setLine("Could not change the star."); }); };
      const items: MenuEntry[] = [
        { label: "Open", onSelect: () => { data.nav.openTerminal(t.terminalId); onClose(); } },
        { label: on ? "Remove Star" : "Star", onSelect: flip },
        { separator: true },
        { label: "Close Session", danger: true, onSelect: () => void closeSession(deps, t.terminalId).then((ok) => { if (!ok) setLine("Could not close it."); }) },
      ];
      entries.push({
        key: t.terminalId, type: "row", title: t.name, note: `${sessionLine(t)} · ${ago(now, t.lastActiveAt)}`, testID: `terminal-${t.terminalId}`,
        leading: <LeadIcon name="terminal" color={t.state === "exited" ? "var(--ink-4)" : "var(--ok)"} />,
        trailing: (over) => (over || on ? <StarButton on={on} onPress={flip} testID={`star-${t.terminalId}`} /> : <Text style={st.host}>{chipLabel(t)}</Text>),
        onPress: () => { data.nav.openTerminal(t.terminalId); onClose(); },
        menu: items,
      });
    }
  } else {
    entries.push({ key: "loading", type: "empty", text: "Loading", testID: "terminals-loading" });
  }

  return (
    <Popover x={x} y={y} width={380} label="Terminals" testID="terminal-list" onClose={onClose}>
      <LayerHead
        title="Terminals" {...(q.status === "ready" ? { sub: `${q.data.terminals.length} in ${data.space.name}` } : {})}
        lead={<Icon name="terminal" size={16} />} onClose={onClose}
      />
      <View style={st.bar}>
        <Tool icon="plus" label="New terminal" onPress={newMenu} testID="terminal-new" />
        <Text style={st.barText}>New terminal</Text>
        <View style={{ flex: 1 }} />
        <Tool icon="filter" label="Terminal rules" onPress={() => { data.nav.openRules(); onClose(); }} testID="terminal-rules-open" />
      </View>
      <View style={st.list}><PaneList entries={entries} testID="terminal-rows" {...(window ? { window } : {})} /></View>
      {line ? <Text testID="terminal-list-line" accessibilityRole="alert" style={st.line}>{line}</Text> : null}
      {menu.element}
    </Popover>
  );
}

const st = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingBottom: 6 },
  barText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  list: { height: 260, paddingHorizontal: 4 },
  host: { fontSize: 11.5, color: "var(--ink-4)" as string },
  star: { width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  starOver: { backgroundColor: "var(--press)" as string },
  line: { fontSize: 12.5, color: "var(--danger)" as string, paddingHorizontal: 14, paddingVertical: 8 },
});
