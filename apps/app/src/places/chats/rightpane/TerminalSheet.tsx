// A terminal, full screen (AGENT-COMPUTER-2026-11-13.md part B): pressing a terminal row in the Computer tab opens it over the chat. The screen is the terminal tab's own (live, scrollable);
// on the left is every terminal of the computer by owner, so another is one press away without closing. You watch until you take the keyboard with one deliberate press (the button, or Return on the screen;
// a letter only nudges): then the agent's commands wait, your keys go to the terminal and Esc goes with them. Give back returns it. Esc closes the sheet while you only watch; Cmd+Shift+. (or Close) closes it while you hold.
// Closing while you hold the keyboard hands it back, so a closed window never leaves the agent waiting.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Overlay } from "../../../../../../ui/src/Overlay/index.tsx";
import { useEscapeLayer } from "../../../../../../ui/src/Overlay/escape.ts";
import type { TerminalData } from "../terminal/data.ts";
import { TerminalTab } from "../terminal/TerminalTab.tsx";
import { TmuxScreen } from "./TmuxScreen.tsx";
import { Icon, TextButton } from "./parts.tsx";
import { Dot, GroupHead } from "./WorkParts.tsx";
import { groupSessions, sessionWords } from "./work-model.ts";
import type { WorkspaceSession } from "./work-model.ts";

const RAIL = 208;

export function TerminalSheet({
  data,
  agentName,
  asleep,
  sessions,
  start,
  me,
  nameOf,
  onClose,
}: {
  data: TerminalData;
  agentName: string;
  asleep: boolean;
  sessions: readonly WorkspaceSession[];
  start: string;
  me?: string | undefined;
  nameOf?: ((id: string) => string) | undefined;
  onClose(): void;
}): ReactElement {
  const win = useWindowDimensions();
  const [sel, setSel] = useState(start);
  const narrow = win.width < 720;
  const current0 = sessions.find((s) => s.terminalId === sel);
  // taking the keyboard: you hold it as soon as the server's answer comes, not at the next refresh of the list; keys pressed in between are kept, in order (the ref is set the instant Take over is pressed)
  const [took, setTook] = useState<string | null>(null);
  const takingRef = useRef(false);
  // handing it back is just as immediate: the list still says you hold it until its next refresh
  const [gave, setGave] = useState<string | null>(null);
  const mine =
    gave !== sel &&
    ((current0?.heldBy !== undefined && current0.heldBy === me) ||
      (took === sel && (current0?.heldBy === undefined || current0.heldBy === me)));
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [nudge, setNudge] = useState(false);
  // the screen is tmux's own with colours and raw keys where the host has tmux; a host without it falls back to the line terminal
  const [lines, setLines] = useState<Record<string, true>>({});
  const [hiddenPrompt, setHiddenPrompt] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  // Esc closes while you only watch; while you hold the keyboard it goes to the terminal
  const mineRef = useRef(false);
  mineRef.current = mine;
  const close = (): void => {
    if (mineRef.current && sel) void data.call("terminal.give_back", { terminalId: sel }).catch(() => undefined);
    onClose();
  };
  useEscapeLayer(!mine, close);
  // taking the keyboard puts it straight on the screen: the next key goes to the terminal, nothing to click first
  useEffect(() => {
    if (!mine || Platform.OS !== "web") return undefined;
    const doc = (globalThis as { document?: Document }).document;
    let tries = 0;
    const focus = (): void => {
      const el = doc?.querySelector(
        '[data-testid="terminal-popup"] [data-testid="terminal-screen"]',
      ) as HTMLElement | null;
      if (el && doc?.activeElement !== el) el.focus();
      if (++tries >= 8) clearInterval(t);
    };
    const t = setInterval(focus, 120);
    focus();
    return () => clearInterval(t);
  }, [mine, sel]);
  const take = (): void => {
    if (takingRef.current) return;
    takingRef.current = true;
    setBusy(true);
    setAsking(false);
    void data
      .call("terminal.take_over", { terminalId: sel })
      .then(() => {
        setGave(null);
        setTook(sel);
      })
      .catch((e: unknown) => setSaid(e instanceof Error && e.message ? e.message : "That did not work. Try again."))
      .finally(() => {
        takingRef.current = false;
        setBusy(false);
      });
  };
  const give = (): void => {
    setBusy(true);
    setTook(null);
    setGave(sel);
    void data
      .call("terminal.give_back", { terminalId: sel })
      .catch((e: unknown) => setSaid(e instanceof Error && e.message ? e.message : "That did not work. Try again."))
      .finally(() => setBusy(false));
  };
  // keys: Return takes the keyboard (deliberate, one key); a letter while you watch only nudges; Cmd+Shift+. closes while you hold
  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === ".") {
        e.preventDefault();
        close();
        return;
      }
      if (mineRef.current || takingRef.current || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Enter" && current0?.heldBy === undefined && current0?.state !== "exited") {
        e.preventDefault();
        take();
      } else if (e.key.length === 1) {
        setNudge(true);
        setTimeout(() => setNudge(false), 1000);
      }
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
    // take and close read the latest state through refs and the selected terminal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, current0?.heldBy, current0?.state]);
  // inside the sheet a terminal opened from the tab replaces the one shown; closing the tab closes the sheet
  const inner = useMemo<TerminalData>(
    () => ({ ...data, nav: { ...data.nav, openTerminal: (t: string) => setSel(t), closeTab: onClose } }),
    [data, onClose],
  );
  const current = current0;
  const groups = groupSessions(sessions, agentName, { me, nameOf });
  const w = current ? sessionWords(current, asleep, { me, nameOf }) : { word: "", dot: "idle" as const };
  const owner =
    current?.owner?.kind === "helper"
      ? `${current.owner.name ?? "A helper"}, ${agentName}'s helper`
      : current?.owner?.kind === "person"
        ? current.ownerId !== undefined && current.ownerId === me
          ? "Your tab"
          : `${(current.ownerId !== undefined ? nameOf?.(current.ownerId) : undefined) ?? current.owner.name ?? "Someone"}'s tab`
        : `${agentName}'s terminal`;
  const holder = current?.heldBy;
  const hn = holder !== undefined && holder !== me ? (nameOf?.(holder) ?? "Someone") : "";
  const bar: { title: string; note?: string; action: "take" | "ask" | "confirm" | "give" | null } = said
    ? { title: said, action: null }
    : asking
      ? { title: `Take the keyboard from ${hn}?`, note: `${hn} is told.`, action: "confirm" }
      : !current || current.state === "exited"
        ? { title: current ? "This terminal ended" : "", action: null }
        : mine && hiddenPrompt
          ? {
              title: "The agent cannot see what you type here",
              note: `${agentName} is told only that it finished.`,
              action: "give",
            }
          : mine
            ? { title: "You have the keyboard", note: `${agentName}'s commands wait.`, action: "give" }
            : holder !== undefined
              ? { title: `${hn} has the keyboard`, action: "ask" }
              : {
                  title: current.state === "running" ? `${agentName} is typing` : "Nobody is typing",
                  note: "Press Take over, or Return, to type.",
                  action: "take",
                };
  return (
    <Overlay>
      <View testID="terminal-popup" role="dialog" aria-modal accessibilityLabel={owner} style={st.veil}>
        <View style={st.head}>
          <Icon name="terminal" size={16} color="var(--ink-2)" />
          <Text style={st.title} numberOfLines={1}>
            {current?.name ?? "Terminal"}
          </Text>
          <Text style={st.sub} numberOfLines={1}>
            {owner}
          </Text>
          <View style={{ flex: 1 }} />
          <View
            testID="terminal-popup-bar"
            style={[st.bar, current?.heldBy !== undefined && !mine && st.barWait, mine && st.barMine]}
          >
            {bar.title ? (
              <Text style={st.barBold} numberOfLines={1}>
                {bar.title}
              </Text>
            ) : null}
            {bar.note ? (
              <Text style={[st.barNote, nudge && st.barNudge]} numberOfLines={1}>
                {nudge ? "Press Take over to type." : bar.note}
              </Text>
            ) : null}
            {bar.action === "take" ? (
              <TextButton label="Take over" primary disabled={busy} onPress={take} testID="terminal-take" />
            ) : null}
            {bar.action === "ask" ? (
              <TextButton
                label="Take over"
                primary
                disabled={busy}
                onPress={() => setAsking(true)}
                testID="terminal-take"
              />
            ) : null}
            {bar.action === "confirm" ? (
              <>
                <TextButton label="Cancel" onPress={() => setAsking(false)} testID="terminal-take-cancel" />
                <TextButton label="Take over" primary disabled={busy} onPress={take} testID="terminal-take-confirm" />
              </>
            ) : null}
            {bar.action === "give" ? (
              <TextButton label="Give back" primary disabled={busy} onPress={give} testID="terminal-give" />
            ) : null}
          </View>
          {mine ? <Text style={st.chord}>{"\u2318\u21E7. closes"}</Text> : null}
          <TextButton label="Close" onPress={close} testID="terminal-popup-close" />
        </View>
        <View style={[st.body, narrow && { flexDirection: "column" }]}>
          {sessions.length > 1 ? (
            <View testID="terminal-rail" accessibilityRole="tablist" style={[st.rail, narrow && st.railTop]}>
              {groups.map((g) => (
                <View key={g.key}>
                  <GroupHead name={g.name} tag={g.tag} agent={g.kind !== "person"} />
                  {g.rows.map((s) => {
                    const x = sessionWords(s, asleep);
                    const on = s.terminalId === sel;
                    return (
                      <Pressable
                        key={s.terminalId ?? s.name}
                        accessibilityRole="tab"
                        accessibilityLabel={`${s.name}, ${x.word}`}
                        accessibilityState={{ selected: on }}
                        testID={`rail-${s.name}`}
                        onPress={() => (s.terminalId ? setSel(s.terminalId) : undefined)}
                        style={[st.tab, on && st.tabOn]}
                      >
                        <Dot tone={x.dot} />
                        <Text style={st.tabText} numberOfLines={1}>
                          {s.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          ) : null}
          <View testID="terminal-popup-screen" style={st.screen}>
            {lines[sel] ? (
              <TerminalTab key={sel} data={inner} terminalId={sel} readonly={!mine} />
            ) : (
              <TmuxScreen
                key={sel}
                call={data.call}
                terminalId={sel}
                keys={mine}
                taking={takingRef}
                onHidden={setHiddenPrompt}
                onUnsupported={() => setLines((m) => ({ ...m, [sel]: true }))}
              />
            )}
          </View>
        </View>
      </View>
    </Overlay>
  );
}

const st = StyleSheet.create({
  veil: {
    position: "fixed" as never,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99998,
    backgroundColor: "var(--win)" as string,
  },
  head: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "var(--line-2)" as string,
  },
  title: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string, flexShrink: 1 },
  sub: { fontSize: 12.5, color: "var(--ink-3)" as string, flexShrink: 1 },
  word: { fontSize: 12.5, color: "var(--ink-3)" as string },
  chord: { fontSize: 11.5, color: "var(--ink-4)" as string },
  bar: {
    minHeight: 34,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: "var(--sunk)" as string,
  },
  barWait: { backgroundColor: "var(--warn-soft, var(--sunk))" as string },
  barMine: { backgroundColor: "var(--accent-soft, var(--sunk))" as string },
  barBold: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  barNote: { fontSize: 12.5, color: "var(--ink-3)" as string, flexShrink: 1 },
  barNudge: { color: "var(--ink)" as string },
  body: { flex: 1, minHeight: 0, flexDirection: "row" },
  rail: { width: RAIL, paddingVertical: 8, borderRightWidth: 1, borderRightColor: "var(--line-2)" as string },
  railTop: {
    width: "100%" as unknown as number,
    borderRightWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: "var(--line-2)" as string,
    maxHeight: 160,
  },
  tab: {
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    marginHorizontal: 8,
    borderRadius: 7,
  },
  tabOn: { backgroundColor: "var(--sel)" as string },
  tabText: { fontSize: 13, color: "var(--ink)" as string, flexShrink: 1 },
  screen: { flex: 1, minWidth: 0, minHeight: 0 },
});
