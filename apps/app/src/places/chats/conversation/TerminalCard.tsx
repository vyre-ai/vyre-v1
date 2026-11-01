// The Run this card in a chat (rc.8): an agent asked the person to run a command (terminal.request, a question block with a terminal card). It shows the command, why and its risk. Run in my terminal types
// it on the host and waits for Enter; Copy puts it on the clipboard; Decline says no. What the command printed goes back to the agent as the answer. Collapses to one line afterwards.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { RiskDot } from "../terminal/RiskDot.tsx";
import type { Risk } from "../terminal/RiskDot.tsx";
import { answerOf, sessionFor, typeCommand, waitForRun } from "../terminal/request.ts";
import type { RunDeps } from "../terminal/request.ts";
import { TextButton } from "./parts.tsx";

export interface TerminalCardProps {
  id: string;
  why: string;
  command: string;
  risk: Risk;
  host?: "agent_computer" | "space_server" | "device";
  /** The agent that asked: an agent-computer host means its computer. */
  agentId?: string;
  deps: RunDeps;
  copy(text: string): void;
  /** Shows the session beside the chat so the person can press Enter in it. */
  openTerminal(terminalId: string): void;
  answer(id: string, answer: unknown): void;
}

type State = { s: "ask" } | { s: "typed"; terminalId: string } | { s: "done"; line: string } | { s: "error" };

export function TerminalCard({ id, why, command, risk, host, agentId, deps, copy, openTerminal, answer }: TerminalCardProps): ReactElement {
  const [st, setSt] = useState<State>({ s: "ask" });
  if (st.s === "done") return <Text testID={`terminal-card-done-${id}`} style={s.done}>{st.line}</Text>;
  const run = (): void => {
    void (async () => {
      try {
        const terminalId = await sessionFor(deps, { ...(host ? { host } : {}), ...(agentId ? { agentId } : {}) });
        const { cursor } = await typeCommand(deps, terminalId, command);
        setSt({ s: "typed", terminalId });
        openTerminal(terminalId);
        const w = await waitForRun(deps, terminalId, cursor);
        answer(id, answerOf(w, command));
        setSt({ s: "done", line: w.state === "done" ? "Ran in your terminal" : "Stopped waiting" });
      } catch { setSt({ s: "error" }); }
    })();
  };
  const typed = st.s === "typed";
  return (
    <View testID={`terminal-card-${id}`} style={s.card} accessibilityRole="summary" accessibilityLabel={why}>
      <Text style={s.why}>{why}</Text>
      <View style={s.cmd}>
        <RiskDot risk={risk} />
        <Text testID={`terminal-card-command-${id}`} selectable style={s.code}>{command}</Text>
      </View>
      {typed ? (
        <View style={s.row}>
          <Text testID={`terminal-card-wait-${id}`} style={s.wait}>Press Enter in the terminal</Text>
          <View style={{ flex: 1 }} />
          <TextButton label="Show" onPress={() => openTerminal((st as { terminalId: string }).terminalId)} testID={`terminal-card-show-${id}`} />
        </View>
      ) : (
        <View style={s.row}>
          {st.s === "error" ? <Text accessibilityRole="alert" style={s.err}>Could not reach the terminal</Text> : null}
          <View style={{ flex: 1 }} />
          <TextButton label="Decline" onPress={() => { answer(id, "decline"); setSt({ s: "done", line: "Declined" }); }} testID={`terminal-card-decline-${id}`} />
          <TextButton label="Copy" onPress={() => { copy(command); answer(id, "copy"); setSt({ s: "done", line: "Copied. You run it" }); }} testID={`terminal-card-copy-${id}`} />
          <TextButton label="Run in my terminal" primary onPress={run} testID={`terminal-card-run-${id}`} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginTop: 8, padding: 12, gap: 10, borderRadius: 12, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--raised)" as string, maxWidth: 560 },
  why: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  cmd: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 10, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  code: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18, color: "var(--ink)" as string, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  wait: { fontSize: 12.5, color: "var(--ink-3)" as string },
  err: { fontSize: 12.5, color: "var(--danger)" as string },
  done: { marginTop: 6, fontSize: 12.5, color: "var(--ink-3)" as string },
});
