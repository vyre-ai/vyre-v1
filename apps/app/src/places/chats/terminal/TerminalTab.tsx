// The terminal as a tab beside the chat (spec 2.7, registry screen chats.terminal-tab): ui/Terminal over one session of the terminal module. terminal.attach gives the scrollback,
// terminal.read the live output after it, and the screen's keys go back through terminal.input, its size through terminal.resize, Ctrl-C through terminal.interrupt. The star puts
// the session on Home; the host menu starts a session on another host (an agent computer, the Space server, this computer); the server shell stays locked until server.services is
// granted and then asks for access, never shows a disabled prompt. A right-click anywhere on it (or the menu key) opens the same actions as a menu: star, interrupt, a new session
// on a host, all terminals, the rules, close.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Terminal, hostMenu } from "../../../../../../ui/src/Terminal/index.tsx";
import type { TerminalHost, TerminalSource, TerminalViewProps } from "../../../../../../ui/src/Terminal/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { errorWords, isRefusal, useLive, useOnline } from "../mounts/live.ts";
import { TextButton } from "../rightpane/parts.tsx";
import { STARS_SCREEN, TAB_SCREEN } from "./data.ts";
import type { TerminalData } from "./data.ts";
import { chipLabel, uiHost, uiState } from "./model.ts";
import type { TerminalRow } from "./model.ts";
import { askServerAccess, attach, closeSession, createSender, openSession, toggleStar } from "./session.ts";
import type { SessionDeps } from "./session.ts";

type GetOut = CapMap["terminal.get"]["out"];
type StarsOut = CapMap["stars.list"]["out"];

type Attach =
  | { status: "loading" }
  | { status: "ready"; replay: string; source: TerminalSource }
  | { status: "locked" }
  | { status: "error"; message: string };

/** What ui/Terminal is given for one session: its name and host, whether it still runs, the scrollback attach returned and the live output after it. */
export function sessionProps(row: TerminalRow, o: { replay: string; source?: TerminalSource; starred: boolean; note?: string }): TerminalViewProps {
  return {
    sessionId: row.terminalId, title: row.name, host: uiHost(row.host), hostLabel: chipLabel(row), state: uiState(row.state), output: o.replay, starred: o.starred,
    ...(o.source ? { source: o.source } : {}), ...(o.note !== undefined ? { note: o.note } : {}),
  };
}

export function TerminalLoading(): ReactElement {
  return <View testID="terminal-loading" accessibilityLabel="Loading" style={st.root}><View style={st.bar} /><View style={st.screen} /></View>;
}

export function TerminalTab({ data, terminalId }: { data: TerminalData; terminalId: string }): ReactElement {
  const deps = useMemo<SessionDeps>(() => ({ call: data.call, newKey: data.newKey }), [data.call, data.newKey]);
  const q = useLive<GetOut>(data.screens, TAB_SCREEN, "terminal", { terminalId });
  const stars = useLive<StarsOut>(data.screens, STARS_SCREEN, "stars", {});
  const online = useOnline(data.connection);
  const menu = useMenu();
  const [att, setAtt] = useState<Attach>({ status: "loading" });
  const [again, setAgain] = useState(0);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [asked, setAsked] = useState(false);
  const [serverLocked, setServerLocked] = useState(false);
  const sender = useMemo(() => createSender(deps, terminalId, setNote), [deps, terminalId]);

  useEffect(() => {
    let live = true;
    setAtt({ status: "loading" });
    void attach(deps, terminalId).then(
      (a) => { if (live) setAtt({ status: "ready", replay: a.replay, source: a.source }); },
      (e: unknown) => { if (live) setAtt(isRefusal(e) ? { status: "locked" } : { status: "error", message: errorWords(e, "Could not attach to this terminal.") }); },
    );
    return () => { live = false; };
  }, [deps, terminalId, again]);

  useEffect(() => {
    if (note === undefined) return undefined;
    const t = setTimeout(() => setNote(undefined), 3000);
    return () => clearTimeout(t);
  }, [note]);

  const who = useMemo(
    () => (data.agent ? { agentId: data.agent.agentId, ...(data.agent.computerId ? { computerId: data.agent.computerId } : {}) } : {}),
    [data.agent],
  );
  const openOn = useCallback((h: TerminalHost): void => {
    void openSession(deps, h, who).then(
      (t) => data.nav.openTerminal(t.terminalId),
      (e: unknown) => { if (h === "server" && isRefusal(e)) setServerLocked(true); else setNote(errorWords(e, "Could not open it.")); },
    );
  }, [deps, who, data.nav]);
  const onGap = useCallback((): void => setAgain((n) => n + 1), []);

  if (q.status === "loading") return <TerminalLoading />;
  const row = q.data.terminal;
  const starred = stars.status === "ready" && stars.data.stars.some((s) => s.resource.type === "terminal" && s.resource.id === row.terminalId);
  const star = (): void => { void toggleStar(deps, row.terminalId, !starred).then((ok) => { if (!ok) setNote("Could not change the star"); }); };
  const host = uiHost(row.host);

  const items: MenuEntry[] = [
    { label: starred ? "Remove Star" : "Star", onSelect: star },
    { label: "Interrupt", onSelect: () => void sender.interrupt() },
    { separator: true },
    { head: "New terminal on" },
    ...hostMenu(host, false, openOn),
    { separator: true },
    { label: "All Terminals", onSelect: () => data.nav.openList() },
    { label: "Terminal Rules", onSelect: () => data.nav.openRules() },
    { separator: true },
    { label: "Close Session", danger: true, onSelect: () => void closeSession(deps, row.terminalId).then((ok) => { if (ok) data.nav.closeTab(); else setNote("Could not close it"); }) },
  ];
  const trigger = menuTrigger((x, y) => menu.show(items, x, y, "context", { label: "Terminal" }));

  if (att.status === "locked" || serverLocked) {
    return (
      <View testID="terminal-tab" style={st.root} {...trigger}>
        <Terminal
          sessionId={row.terminalId} title="" host="server" hostLabel="Space server" locked asked={asked}
          {...(data.owner ? { owner: data.owner } : {})}
          {...(data.agent ? { fallbackLabel: `${data.agent.name}'s computer` } : {})}
          onHost={openOn} onBack={() => openOn("agent")}
          onAskAccess={() => void askServerAccess(deps, data.space.id).then((ok) => { if (ok) setAsked(true); else setNote("Could not send the request"); })}
        />
        {menu.element}
      </View>
    );
  }
  if (att.status === "error") {
    return (
      <View testID="terminal-tab" style={st.root} {...trigger}>
        <View testID="terminal-error" accessibilityRole="alert" style={st.err}>
          <Text style={st.errTitle}>This terminal did not open</Text>
          <Text style={st.errText}>{att.message}</Text>
          <TextButton label="Try again" primary onPress={onGap} testID="terminal-retry" />
        </View>
        {menu.element}
      </View>
    );
  }
  if (att.status === "loading") return <TerminalLoading />;
  return (
    <View testID="terminal-tab" style={st.root} {...trigger}>
      <Terminal
        key={`${row.terminalId}:${again}`}
        {...sessionProps(row, { replay: att.replay, source: att.source, starred, ...(online ? (note !== undefined ? { note } : {}) : { note: "Offline" }) })}
        onInput={(d) => void sender.input(d)} onResize={(c, r) => void sender.resize(c, r)} onInterrupt={() => void sender.interrupt()}
        onStar={star} onGap={onGap} onHost={openOn}
      />
      {menu.element}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: "var(--sunk)" as string },
  bar: { height: 38, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
  screen: { flex: 1 },
  err: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  errTitle: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  errText: { fontSize: 13, color: "var(--ink-3)" as string, textAlign: "center", maxWidth: 320 },
});
