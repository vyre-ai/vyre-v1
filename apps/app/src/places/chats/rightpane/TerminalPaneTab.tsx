// The Terminal tab of the chat's right pane (rc.8): a terminal in the chat's agent's workspace (12 Nov: the same sessions its commands use), else on the machine this chat runs on. The first open picks
// the session already there or starts one; the host chip
// switches to any other computer. Everything else is the terminal tab of the terminal place, drawn in the pane.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { TerminalData } from "../terminal/data.ts";
import { TerminalTab } from "../terminal/TerminalTab.tsx";
import { loadHosts, openHostCall, thisDeviceId } from "../terminal/hosts.ts";
import type { HostChoice } from "../terminal/hosts.ts";
import { errorWords } from "../mounts/live.ts";
import { collect } from "../conversation/model.ts";
import { Icon } from "./parts.tsx";

type Row = CapMap["terminal.list"]["out"]["terminals"][number];

/**
 * The session this chat's pane starts on: in the lead agent's workspace, the agent's own tab (the one its commands go to), else its newest tab there; else the newest live one on this computer. An agent
 * computer named by its id alone (an older desktop) is matched by that id.
 */
export function startSession(rows: readonly Row[], agent: { agentId?: string; computerId?: string } | string | undefined): Row | undefined {
  const who = typeof agent === "string" ? { computerId: agent } : agent ?? {};
  const live = rows.filter((r) => r.state !== "exited").sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  const theirs = live.filter((r) => r.host === "agent_computer" && ((who.agentId !== undefined && r.agentId === who.agentId) || (who.computerId !== undefined && r.computerId === who.computerId)));
  return theirs.find((r) => r.by === undefined || r.by.kind === "agent") ?? theirs[0] ?? live.find((r) => r.host === "device");
}

/** A name for the new session, and where it starts (a helper's terminal is named for the helper and starts in its workspace). */
export interface OpenOpts { name?: string; cwd?: string }
export type Opened = { s: "opened"; terminalId: string } | { s: "choose"; hosts: HostChoice[] } | { s: "none" };

/**
 * What Open terminal does. The chat's agent computer when it has one. Otherwise this computer, named by its device (a terminal on a computer must say which); when this one is not a computer
 * (the web, a phone) the person picks among the online hosts they do have, and when there are none the pane says so.
 */
export async function openHere(d: Pick<TerminalData, "call" | "newKey" | "agent" | "team" | "nameOf" | "clock">, opts: OpenOpts = {}): Promise<Opened> {
  let host: HostChoice | undefined;
  // the chat's agent has a workspace this person may enter: the terminal opens there, in the same sessions the agent's commands use
  if (d.agent && (await inWorkspace(d, d.agent.agentId))) host = { key: `agent:${d.agent.agentId}`, label: "", kind: "agent", online: true, agentId: d.agent.agentId };
  else if (d.agent?.computerId) host = { key: `agent:${d.agent.computerId}`, label: "", kind: "agent", online: true, agentId: d.agent.agentId, computerId: d.agent.computerId };
  else {
    const deviceId = await thisDeviceId(d.call);
    if (deviceId) host = { key: `device:${deviceId}`, label: "This computer", kind: "device", online: true, deviceId };
  }
  if (!host) {
    const hosts = (await loadHosts(d.call, { team: d.team === true, now: d.clock().now, nameOf: d.nameOf ?? ((id) => id) })).filter((h) => h.online);
    return hosts.length > 0 ? { s: "choose", hosts } : { s: "none" };
  }
  return { s: "opened", terminalId: await openOn(d, host, opts) };
}

/** Does this agent have a workspace this person may open (terminal.workspace: running, asleep or not made yet, and theirs to enter)? */
async function inWorkspace(d: Pick<TerminalData, "call">, agentId: string): Promise<boolean> {
  try {
    const w = (await d.call("terminal.workspace", { agentId })) as { state?: string; canAttach?: boolean } | undefined;
    return w?.canAttach === true && w.state !== "unavailable";
  } catch { return false; }
}

/** Open a session on one host and return its id. */
export async function openOn(d: Pick<TerminalData, "call" | "newKey">, h: HostChoice, opts: OpenOpts = {}): Promise<string> {
  const c = openHostCall(h, d.newKey());
  return ((await d.call(c.cap, { ...c.input, ...opts })) as { terminal: { terminalId: string } }).terminal.terminalId;
}

export function TerminalPaneTab({ data }: { data: TerminalData }): ReactElement {
  const [id, setId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void (data.call("terminal.list", {}) as Promise<CapMap["terminal.list"]["out"]>).then(
      (o) => { if (live) setId(startSession(o.terminals, data.agent)?.terminalId ?? null); },
      () => { if (live) setId(null); },
    );
    return () => { live = false; };
  }, [data]);
  // inside the pane a session opened from the tab replaces the one shown; the list and the rules still open in their own layers
  const paneData = useMemo<TerminalData>(() => ({ ...data, nav: { ...data.nav, openTerminal: (t: string) => setId(t), closeTab: () => setId(null) } }), [data]);
  const [choices, setChoices] = useState<HostChoice[] | null>(null);
  const fail = (e: unknown): void => setLine(errorWords(e, "Could not open it."));
  const open = (): void => {
    setBusy(true); setLine(null);
    void openHere(data).then(
      (o) => { if (o.s === "opened") setId(o.terminalId); else if (o.s === "choose") setChoices(o.hosts); else setLine("No computer to open a terminal on. Open Vyre on a computer, or add a server."); },
      fail,
    ).finally(() => setBusy(false));
  };
  const pick = (h: HostChoice): void => {
    setBusy(true); setLine(null);
    void openOn(data, h).then((t) => { setChoices(null); setId(t); }, fail).finally(() => setBusy(false));
  };
  if (id === undefined) return <View testID="terminal-pane-loading" style={st.center} />;
  if (id === null) {
    return (
      <View testID="terminal-pane-empty" style={st.center}>
        <Icon name="terminal" size={22} />
        {choices ? (
          <View testID="terminal-pane-hosts" style={st.hosts}>
            <Text style={st.hint}>Open it on</Text>
            {collect(choices, (h) => (
              <Pressable key={h.key} accessibilityRole="button" accessibilityLabel={`Open terminal on ${h.label}`} testID={`terminal-pane-host-${h.key}`} disabled={busy} onPress={() => pick(h)} style={[st.btn, busy && { opacity: 0.5 }]}>
                <Text style={st.btnText}>{h.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel="Open terminal" testID="terminal-pane-open" disabled={busy} onPress={open} style={[st.btn, busy && { opacity: 0.5 }]}><Text style={st.btnText}>Open terminal</Text></Pressable>
        )}
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
  hosts: { gap: 8, alignItems: "center" },
  hint: { fontSize: 12.5, color: "var(--ink-3)" as string },
  err: { fontSize: 12.5, color: "var(--danger)" as string },
});
