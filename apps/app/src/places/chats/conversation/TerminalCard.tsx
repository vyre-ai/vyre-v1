// The Run this card in a chat (rc.8): an agent asked the person to run a command (terminal.request, a question block with a terminal card). It shows the command, why and its risk. Run in my terminal types
// it on the host and waits for Enter; Copy puts it on the clipboard; Decline says no. What the command printed goes back to the agent as the answer. Collapses to one line afterwards.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { RiskDot } from "../terminal/RiskDot.tsx";
import type { Risk } from "../terminal/RiskDot.tsx";
import { answerOf, sessionFor, typeCommand, waitForRun } from "../terminal/request.ts";
import type { RunDeps } from "../terminal/request.ts";
import { Card, CardActions, CardBody, CardDone, CardHead } from "../../../../../../ui/src/Card/index.tsx";

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
  if (st.s === "done") return <CardDone testID={`terminal-card-done-${id}`} text={st.line} />;
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
    <Card kind="decision" testID={`terminal-card-${id}`} label={why}>
      <CardHead title={why} />
      <CardBody>
        <View style={s.cmd}>
          <RiskDot risk={risk} />
          <Text testID={`terminal-card-command-${id}`} selectable style={s.code}>{command}</Text>
        </View>
      </CardBody>
      {typed ? (
        <CardActions note={<Text testID={`terminal-card-wait-${id}`} style={s.wait}>Press Enter in the terminal</Text>} secondary={[{ label: "Show", onPress: () => openTerminal((st as { terminalId: string }).terminalId), testID: `terminal-card-show-${id}` }]} />
      ) : (
        <CardActions
          error={st.s === "error" ? "Could not reach the terminal" : null}
          secondary={[
            { label: "Copy", onPress: () => { copy(command); answer(id, "copy"); setSt({ s: "done", line: "Copied. You run it" }); }, testID: `terminal-card-copy-${id}` },
            { label: "Deny", onPress: () => { answer(id, "decline"); setSt({ s: "done", line: "Denied" }); }, testID: `terminal-card-decline-${id}` },
          ]}
          primary={{ label: "Run in my terminal", onPress: run, testID: `terminal-card-run-${id}` }}
        />
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  cmd: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  code: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18, color: "var(--ink)" as string, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  wait: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
