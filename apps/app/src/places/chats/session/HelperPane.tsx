// A helper's pane (prototype t-session): what a person sees when a crew row opens. Its own thread and last steps (the peek), the files it changed, and, when it works in a workspace of its own, a terminal tab named
// "helper: <name>" that shows that workspace. A helper with no workspace has no terminal tab. The peek is the one the Crew pane always had; this wraps it with the tab and keeps its back button.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TabStrip } from "../../../../../../ui/src/TabStrip/index.tsx";
import { CrewPeek } from "../crew/pane.tsx";
import { nameOf as memberName } from "../crew/model.ts";
import type { CrewMember } from "../crew/model.ts";
import type { Call } from "../crew/status.ts";
import type { TerminalData } from "../terminal/data.ts";
import { TerminalTab } from "../terminal/TerminalTab.tsx";
import { openHere, openOn } from "../rightpane/TerminalPaneTab.tsx";
import { errorWords } from "../mounts/live.ts";

export interface Workspace { jobId: string; repo: string; base: string; branch: string; name: string }

/** The name of a helper's terminal tab. */
export const terminalTitle = (m: Pick<CrewMember, "name" | "title">): string => `helper: ${m.name && m.name !== "" ? m.name : m.title}`;

/** The workspace a helper works in, or null: only a coder in a workspace of its own has one. */
export function useWorkspace(call: Call, threadId: string): Workspace | null | undefined {
  const [ws, setWs] = useState<Workspace | null | undefined>(undefined);
  useEffect(() => {
    let dead = false;
    setWs(undefined);
    void Promise.resolve(call("engine.crew.workspace", { threadId })).then((r) => { if (!dead) setWs((r as { workspace: Workspace | null } | undefined)?.workspace ?? null); }, () => { if (!dead) setWs(null); });
    return () => { dead = true; };
  }, [call, threadId]);
  return ws;
}

/** The terminal of one helper: the session already named for it, else one opened in its workspace. */
export function HelperTerminal({ member, workspace, data }: { member: CrewMember; workspace: Workspace; data: TerminalData }): ReactElement {
  const title = terminalTitle(member);
  const [id, setId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    void (data.call("terminal.list", {}) as Promise<{ terminals: Array<{ terminalId: string; name: string; state: string; lastActiveAt: number }> }>).then(
      (o) => { if (!dead) setId(o.terminals.filter((t) => t.name === title && t.state !== "exited").sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]?.terminalId ?? null); },
      () => { if (!dead) setId(null); },
    );
    return () => { dead = true; };
  }, [data, title]);
  const open = async (): Promise<void> => {
    setBusy(true); setLine(null);
    try {
      // the crew runs on the Space server: start there, in the workspace; when this Space has no server (or the path is not there), open it where the chat runs
      try { setId(await openOn(data, { key: "server", label: "", kind: "server", online: true }, { name: title, cwd: workspace.repo })); return; } catch { /* fall through */ }
      const o = await openHere(data, { name: title });
      if (o.s === "opened") setId(o.terminalId); else setLine("There is no computer to open a terminal on.");
    } catch (e) { setLine(errorWords(e, "Could not open a terminal.")); } finally { setBusy(false); }
  };
  if (id === undefined) return <View testID="helper-terminal-loading" style={st.pad}><Text style={st.hint}>Looking for its terminal…</Text></View>;
  if (id === null) {
    return (
      <View testID="helper-terminal-none" style={st.pad}>
        <Text style={st.hint}>{`${memberName(member)} works in ${workspace.branch}. Open a terminal in its workspace to see what it sees.`}</Text>
        <Pressable accessibilityRole="button" testID="helper-terminal-open" disabled={busy} onPress={() => { void open(); }} style={st.btn}><Text style={st.btnText}>Open terminal</Text></Pressable>
        {line ? <Text testID="helper-terminal-line" style={st.hint}>{line}</Text> : null}
      </View>
    );
  }
  return <View testID="helper-terminal" style={{ flex: 1, minHeight: 320 }}><TerminalTab key={id} data={data} terminalId={id} /></View>;
}

export function HelperPane({ member, call, nameOfId, onBack, onOpenChat, onRefresh, terminal }: { member: CrewMember; call: Call; nameOfId?: ((id: string) => string) | undefined; onBack: () => void; onOpenChat: (threadId: string) => void; onRefresh: () => void; terminal?: TerminalData | undefined }): ReactElement {
  const ws = useWorkspace(call, member.id);
  const [tab, setTab] = useState<"helper" | "term">("helper");
  const hasTerminal = ws !== undefined && ws !== null && terminal !== undefined;
  const shown = hasTerminal ? tab : "helper";
  const tabs = [{ key: "helper", title: "Thread" }, { key: "term", title: terminalTitle(member) }];
  const peek = <CrewPeek member={member} call={call} {...(nameOfId ? { nameOfId } : {})} onBack={onBack} onOpenChat={onOpenChat} onRefresh={onRefresh} />;
  if (!hasTerminal) return peek;
  return (
    <View testID="helper-pane">
      <View style={st.tabs}><TabStrip tabs={tabs} active={shown} onSelect={(k) => setTab(k === "term" ? "term" : "helper")} tight bare underline noOptions label={`${memberName(member)}'s tabs`} /></View>
      {shown === "term" ? <HelperTerminal member={member} workspace={ws} data={terminal} /> : peek}
    </View>
  );
}

const st = StyleSheet.create({
  tabs: { paddingTop: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  pad: { padding: 16, gap: 12 },
  hint: { fontSize: 13, lineHeight: 19, color: "var(--ink-3)" as string },
  btn: { alignSelf: "flex-start", height: 32, paddingHorizontal: 12, borderRadius: 12, justifyContent: "center", backgroundColor: "var(--sel)" as string },
  btnText: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
});
