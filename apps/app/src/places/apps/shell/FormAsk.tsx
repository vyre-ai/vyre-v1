import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { Button, Field, Select, s } from "./editor-ui.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { FIELD_TITLE, diffText, summaryOf } from "./form-ask.ts";
import type { SourceChange } from "./form-ask.ts";

export interface FormAskProps {
  agents: readonly { id: string; name: string }[];
  agentId: string; onAgent(id: string): void;
  instruction: string; onInstruction(value: string): void;
  onAsk(): void;
  /** the agent being waited for, with Cancel; absent when no Ask is running */
  asking?: { agent: string; onCancel(): void };
  error?: string;
  /** an Ask works on the SAVED source, so unsaved edits must be saved first */
  dirty: boolean;
  proposals: readonly SourceChange[];
  decided: Readonly<Record<string, "accepted" | "rejected">>;
  onAccept(path: string): void; onReject(path: string): void;
}

/** The inline Ask: pick an agent, say what to change, review the proposed source changes one at a time. It never opens a chat and never saves; Accept puts the change in the editor, Save keeps it. */
export function FormAsk(p: FormAskProps): ReactElement {
  const blocked = p.asking !== undefined || p.dirty || p.agents.length === 0 || p.instruction.trim() === "";
  return <View style={{ gap: 10 }} testID="apps-form-ask">
    <Text style={[s.text, { fontWeight: "600" }]}>Ask Vyre</Text>
    <Text style={s.text}>An agent proposes changes to your HTML, CSS or JavaScript. You accept or reject each one; nothing is saved until you save the form.</Text>
    {p.agents.length > 1 ? <Select label="Agent" value={p.agentId} options={p.agents.map((a) => ({ key: a.id, title: a.name }))} onChange={p.onAgent} disabled={p.asking !== undefined} /> : null}
    <Field label="What should change?" value={p.instruction} onChange={p.onInstruction} multiline disabled={p.asking !== undefined} placeholder="Add a heading and a privacy link under the email question" />
    {p.dirty ? <Text testID="apps-ask-save-first" style={s.text}>Save your changes first so the agent works on what you see.</Text> : null}
    {p.agents.length === 0 ? <Text testID="apps-ask-no-agent" style={s.text}>No agent is available. Create an agent, connect a model in Settings, then ask again.</Text> : null}
    {p.asking ? <View testID="apps-ask-waiting" accessibilityLiveRegion="polite" style={{ gap: 6 }}><Text style={s.text}>{`Asking ${p.asking.agent}…`}</Text><Button title="Cancel" testID="apps-ask-cancel" onPress={p.asking.onCancel} /></View>
      : <Button title="Ask" testID="apps-ask-send" primary disabled={blocked} onPress={p.onAsk} />}
    {p.error && !p.asking ? <Text accessibilityRole="alert" testID="apps-ask-error" style={s.text}>{p.error}</Text> : null}
    {p.proposals.map((c) => {
      const state = p.decided[c.path];
      const id = c.path.slice(1);
      return <Row key={c.path} id={`ask-${id}`} title={`${FIELD_TITLE[c.path] ?? c.path} change`} note={`${summaryOf(c).replace(/^[^:]*: /, "")} · ${state === "accepted" ? "accepted, save to keep" : state === "rejected" ? "rejected" : "proposed"}`}
        trailing={state ? <Text testID={`apps-ask-${state}-${id}`} style={s.text}>{state === "accepted" ? "Accepted" : "Rejected"}</Text>
          : <View style={{ flexDirection: "row", gap: 6 }}><Button title="Reject" testID={`apps-ask-reject-${id}`} onPress={() => p.onReject(c.path)} /><Button title="Accept" primary testID={`apps-ask-accept-${id}`} onPress={() => p.onAccept(c.path)} /></View>} />;
    })}
    {p.proposals.length > 0 ? <Text selectable testID="apps-ask-diff" style={[s.text, { fontFamily: "monospace" }]}>{diffText(p.proposals)}</Text> : null}
  </View>;
}
