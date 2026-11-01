// The Terminal tab of the chat's right pane (rc.8): a terminal on the machine this chat runs on. The first open picks the session already there (the newest of this host) or starts one; the host chip
// switches to any other computer. Everything else is the terminal tab of the terminal place, drawn in the pane.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { TerminalData } from "../terminal/data.ts";
import { TerminalTab } from "../terminal/TerminalTab.tsx";
import { Icon } from "./parts.tsx";

type Row = CapMap["terminal.list"]["out"]["terminals"][number];

/** The session this chat's pane starts on: the newest live one on the lead agent's computer, else on this computer. */
export function startSession(rows: readonly Row[], agentComputer: string | undefined): Row | undefined {
  const live = rows.filter((r) => r.state !== "exited").sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  return (agentComputer ? live.find((r) => r.host === "agent_computer" && r.computerId === agentComputer) : undefined) ?? live.find((r) => r.host === "device");
}

export function TerminalPaneTab({ data }: { data: TerminalData }): ReactElement {
  const [id, setId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void (data.call("terminal.list", {}) as Promise<CapMap["terminal.list"]["out"]>).then(
      (o) => { if (live) setId(startSession(o.terminals, data.agent?.computerId)?.terminalId ?? null); },
      () => { if (live) setId(null); },
    );
    return () => { live = false; };
  }, [data]);
  // inside the pane a session opened from the tab replaces the one shown; the list and the rules still open in their own layers
  const paneData = useMemo<TerminalData>(() => ({ ...data, nav: { ...data.nav, openTerminal: (t: string) => setId(t), closeTab: () => setId(null) } }), [data]);
  const open = (): void => {
    setBusy(true); setLine(null);
    const here = data.agent?.computerId ? { host: "agent_computer", agentId: data.agent.agentId, computerId: data.agent.computerId } : { host: "device" };
    void (data.call("terminal.open", { ...here, idempotencyKey: data.newKey() }) as Promise<{ terminal: { terminalId: string } }>).then(
      (o) => setId(o.terminal.terminalId),
      () => setLine("Could not open"),
    ).finally(() => setBusy(false));
  };
  if (id === undefined) return <View testID="terminal-pane-loading" style={st.center} />;
  if (id === null) {
    return (
      <View testID="terminal-pane-empty" style={st.center}>
        <Icon name="terminal" size={22} />
        <Pressable accessibilityRole="button" accessibilityLabel="Open terminal" testID="terminal-pane-open" disabled={busy} onPress={open} style={[st.btn, busy && { opacity: 0.5 }]}><Text style={st.btnText}>Open terminal</Text></Pressable>
        {line ? <Text accessibilityRole="alert" style={st.err}>{line}</Text> : null}
      </View>
    );
  }
  return <TerminalTab key={id} data={paneData} terminalId={id} />;
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 20 },
  btn: { minHeight: 34, paddingHorizontal: 14, borderRadius: 9, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 13.5, fontWeight: "600", color: "var(--accent-ink)" as string },
  err: { fontSize: 12.5, color: "var(--danger)" as string },
});
