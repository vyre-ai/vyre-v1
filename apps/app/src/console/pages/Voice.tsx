// Console > AI > Voice: one Deepgram key covers the whole Space, so people only press the mic. UI only for now: the capabilities voice.status, voice.set, voice.check and voice.remove are
// not in generated/types.ts yet, so they go through the thin typed wrapper below (data.call takes a plain name). When they are generated, only `VoiceApi` needs to change.
import { useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Glyph } from "../shell/glyphs.tsx";
import { Group, Lead } from "../shell/ui.tsx";
import { Actions, Button, Field, Note, ReadState, useAction, useRead } from "./shared.tsx";

export interface VoiceStatus { set: boolean; on: boolean; own: number; who?: string; checkedAt?: number }
/** The four capabilities Voice needs, by name, with the shape each takes. */
export const VoiceApi = {
  status: { cap: "voice.status", input: {} as Record<string, never> },
  set: (input: { key?: string; on?: boolean }) => ({ cap: "voice.set", input }),
  check: { cap: "voice.check", input: {} as Record<string, never> },
  remove: { cap: "voice.remove", input: {} as Record<string, never> },
} as const;

/** "4 minutes ago" from a timestamp in milliseconds. */
export function agoWords(at: number | undefined, now: number): string {
  if (at === undefined) return "not yet";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

export const voiceLine = (v: VoiceStatus): string => !v.set ? "Not set up" : v.on ? "On for everyone" : "Off for everyone";

export function VoicePage(): ReactElement {
  const status = useRead<VoiceStatus>(VoiceApi.status.cap, VoiceApi.status.input, { direct: true });
  if (!status.data) return <ReadState error={status.error} retry={status.refresh} />;
  return <Voice status={status.data} refresh={status.refresh} />;
}

function Voice({ status, refresh }: { status: VoiceStatus; refresh(): void }): ReactElement {
  const action = useAction(refresh);
  const [form, setForm] = useState(false);
  const [key, setKey] = useState("");
  const showForm = !status.set || form;
  const save = async (): Promise<void> => {
    const call = VoiceApi.set({ key: key.trim(), ...(status.set ? {} : { on: true }) });
    const out = await action.run(call.cap, call.input, status.set ? "Key replaced" : "Voice is on for everyone");
    if (out) { setKey(""); setForm(false); }
  };
  const toggle = (): void => { const call = VoiceApi.set({ on: !status.on }); void action.run(call.cap, call.input, status.on ? "Voice is off for everyone" : "Voice is on for everyone"); };
  const check = (): void => { void action.run(VoiceApi.check.cap, VoiceApi.check.input, "Checked"); };
  const remove = (): void => { void action.run(VoiceApi.remove.cap, VoiceApi.remove.input, "Key removed"); };
  return <View testID="console-voice">
    <Text style={{ fontSize: 12.5, color: "var(--ink-3)" as string, marginBottom: 12, marginLeft: 2 }}>Press the mic and your words land in the message. One key here covers everyone, and nobody can read it.</Text>
    <Group>
      <Row id="voice-status" title={voiceLine(status)} note={status.set ? `Deepgram · ${status.who ?? "Someone"} added it · checked ${agoWords(status.checkedAt, Date.now())}` : "One Deepgram key can cover everyone. People just press the mic."} leading={<Lead><Glyph name="assistant" size={16} color="var(--ink-3)" /></Lead>} trailing={status.set ? <Text style={{ fontSize: 12.5, color: "var(--ink-3)" as string }}>{status.on ? "Working" : "Paused"}</Text> : null} />
      {status.set ? <Row id="voice-own" title="People with their own key" note={`${status.own}. Their own key wins for them`} /> : null}
    </Group>
    {showForm ? <View style={{ padding: 14, gap: 8 }}>
      <Field label="Deepgram key" testID="voice-key" secure value={key} onChange={setKey} />
      <Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>Goes straight to this Space's Vault and is checked at once. It needs the Member role.</Text>
      <Actions>
        {status.set ? <Button label="Cancel" testID="voice-cancel" onPress={() => { setForm(false); setKey(""); }} /> : null}
        <Button label={status.set ? "Replace key" : "Turn on for everyone"} testID="voice-save" disabled={action.busy || key.trim() === ""} why="Paste your key first" onPress={() => void save()} />
      </Actions>
    </View> : <Actions>
      <Button label="Replace key" testID="voice-replace" onPress={() => setForm(true)} />
      <Button label={status.on ? "Turn off" : "Turn on"} testID="voice-toggle" disabled={action.busy} onPress={toggle} />
      <Button label="Check now" testID="voice-check" disabled={action.busy} onPress={check} />
      <Button label="Remove key" testID="voice-remove" danger disabled={action.busy} onPress={remove} />
    </Actions>}
    {action.note ? <Note>{action.note}</Note> : null}
  </View>;
}
