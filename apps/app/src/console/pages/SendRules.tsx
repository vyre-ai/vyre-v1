// Console > Messaging > Rules > Sending rules: how sending works (every sender goes through the same API and the do-not-contact list is read before each message), the rules that are always on,
// and the sending limits: a daily cap, a sending window and a throttle. The limits are the Space settings send.cap, send.window and send.throttle (settings.get, settings.set_space), registered by the mail
// module and read by the send path (mail.send, telephony.send_sms): over the daily limit a send is refused, outside the window or over the speed it is queued until it may leave.
import { useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Lead, Section } from "../shell/ui.tsx";
import { Glyph } from "../shell/glyphs.tsx";
import { Note, ReadState, Segmented, useAction, useRead } from "./shared.tsx";

type Setting = CapMap["settings.get"]["out"];

export interface LimitDef { key: string; title: string; note: string; options: readonly { key: string; title: string }[] }
export const LIMITS: readonly LimitDef[] = [
  { key: "send.cap", title: "Daily limit", note: "Most messages the Space sends in a day", options: [{ key: "100", title: "100 a day" }, { key: "500", title: "500 a day" }, { key: "2000", title: "2,000 a day" }, { key: "10000", title: "10,000 a day" }] },
  { key: "send.window", title: "Sending window", note: "When messages may leave, in the recipient's time zone", options: [{ key: "8-20", title: "8:00 to 20:00" }, { key: "9-17", title: "9:00 to 17:00" }, { key: "any", title: "Any time" }] },
  { key: "send.throttle", title: "Speed", note: "How fast messages leave", options: [{ key: "5", title: "5 a minute" }, { key: "20", title: "20 a minute" }, { key: "60", title: "60 a minute" }] },
];
export const ALWAYS_ON: readonly { id: string; title: string; note?: string; icon: string }[] = [
  { id: "check", title: "Check the do-not-contact list before every send", icon: "ok" },
  { id: "stop", title: "Read STOP and UNSUBSCRIBE in replies", note: "Texts and emails that say so are added to the list", icon: "mail" },
  { id: "bounce", title: "Add bounces and complaints to the list", icon: "warn" },
];

/** The option a stored value stands for; numbers are stored as numbers, windows as text. */
export const optionKey = (value: unknown): string => typeof value === "number" || typeof value === "string" ? String(value) : "";

function Limit({ def }: { def: LimitDef }): ReactElement {
  const setting = useRead<Setting>("settings.get", { key: def.key }, { direct: true });
  const [saved, setSaved] = useState<string | null>(null);
  const action = useAction(setting.refresh);
  const stored = optionKey(setting.data?.row.value ?? setting.data?.row.default);
  const current = saved ?? stored;
  const label = def.options.find((o) => o.key === current)?.title;
  const choose = (key: string): void => {
    const value: unknown = def.key === "send.window" ? key : Number(key);
    void action.run("settings.set_space", { key: def.key, value }, "Saved.").then((out) => { if (out) setSaved(key); });
  };
  return (
    <View>
      <Row id={`send-limit-${def.key}`} title={def.title} note={def.note} {...(label ? { titleSuffix: label } : {})} />
      {setting.data !== undefined ? <Segmented options={def.options.map((o) => ({ key: `${def.key}:${o.key}`, title: o.title }))} value={`${def.key}:${current}`} onChange={(k) => choose(k.slice(def.key.length + 1))} /> : setting.error !== undefined ? <ReadState error={setting.error} retry={setting.refresh} /> : null}
      {action.note ? <Note>{action.note}</Note> : null}
    </View>
  );
}

export function SendRulesPage(): ReactElement {
  return (
    <View testID="console-send-rules">
      <Section title="How sending works" right={<Note>Automations and agents</Note>}>
        <Note>Every sender goes through the same API: an automation or an agent. It reads the do-not-contact list before each message. An email leaves when the flow says.</Note>
      </Section>
      <Section title="Always on">
        <Group testID="send-always-on">
          {ALWAYS_ON.map((r) => <Row key={r.id} id={`send-rule-${r.id}`} title={r.title} {...(r.note ? { note: r.note } : {})} leading={<Lead><Glyph name={r.icon} size={16} color="var(--ok)" /></Lead>} trailing={<Glyph name="check" size={14} color="var(--ok)" />} />)}
        </Group>
      </Section>
      <Section title="Sending limits">
        <Group testID="send-limits">
          {LIMITS.map((def) => <Limit key={def.key} def={def} />)}
        </Group>
      </Section>
    </View>
  );
}
