// Console, AI, Voice: one key that covers everyone in the Space. Status at a glance first, then what can be done. The key itself is never read back here: it sits Restricted in the Vault.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Glyph } from "../shell/glyphs.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { IconTile } from "./CiRunners.tsx";
import { Actions, Button, Field, Note, ReadState, Select, useAction, useRead, QuietButton } from "./shared.tsx";

type SpaceOut = CapMap["talk.space.status"]["out"];
type VoiceOut = CapMap["talk.status"]["out"];
const CHECK_AFTER_MS = 3_600_000;
const attempt = (): string => (globalThis.crypto?.randomUUID?.() ?? `voice-${Date.now()}`);

/** "4 minutes ago", plainly. */
export function agoLine(at: number | undefined, now: number): string {
  if (at === undefined) return "not checked yet";
  const m = Math.round((now - at) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** The one line that says how the Space stands. */
export function voiceHeadline(s: SpaceOut): string {
  if (!s.set) return "Not set up";
  if (!s.on) return "Off for everyone";
  return s.state === "failing" ? "The key stopped working" : "On for everyone";
}

export function VoiceSettings(): ReactElement {
  const data = useConsoleData();
  const space = useRead<SpaceOut>("talk.space.status");
  const me = useRead<VoiceOut>("talk.status");
  const refresh = (): void => { space.refresh(); me.refresh(); };
  const action = useAction(refresh);
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState("");
  const [gone, setGone] = useState(false);
  /** a provider the Space has no key for yet: its key form is open */
  const [adding, setAdding] = useState<string | null>(null);
  /** first time only: the provider chosen before any key exists */
  const [pick, setPick] = useState("deepgram");
  const checked = useRef(false);
  const winW = useWindowDimensions().width;
  const narrow = winW > 0 && winW < 720;   // an unmeasured screen (a static render) keeps the desktop layout
  const s = space.data;
  // a row that says when it was last checked should not be far behind: an old answer is asked again once as the page opens
  useEffect(() => {
    if (!s?.set || checked.current || data.clock().now - (s.checkedAt ?? 0) < CHECK_AFTER_MS) return;
    checked.current = true;
    void action.run("talk.space.check", {}, "");
  }, [s?.set]);
  if (!s || !me.data) return <ReadState error={space.error ?? me.error} retry={refresh} />;
  const provider = me.data.providers.find((p) => p.key === (adding ?? s.provider ?? (s.set ? me.data?.provider : pick))) ?? me.data.providers[0];
  const keyed = s.keyed ?? [];
  const name = provider?.name ?? "Deepgram";
  const save = async (): Promise<void> => {
    if (key.trim() === "" || !provider) return;
    const out = await action.run<SpaceOut>("talk.space.connect", { provider: provider.key, fields: [{ key: "api_key", value: key, secret: true }], idempotencyKey: attempt() }, "Talk is on for everyone");
    if (out) { setKey(""); setReplacing(false); setAdding(null); }
  };
  const who = s.setBy ? `${data.name(s.setBy)} added it` : "";
  const note = s.set ? [name, who, `checked ${agoLine(s.checkedAt, data.clock().now)}`].filter(Boolean).join(" · ") : "One key covers everyone. People just press the mic, and nobody can read the key.";
  const owned = s.peopleOwnKey ?? 0;
  const form = !s.set || replacing || adding !== null;
  const failing = s.set && s.state === "failing";
  const stateWord = failing ? "Not working" : s.on ? "Working" : "Paused";
  return (
    <View testID="console-voice">
      <Text testID="voice-intro" style={{ fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string, marginHorizontal: 2, marginBottom: 12 }}>Press the mic and your words land in the message. One key here covers everyone, and nobody can read it.</Text>
      {failing ? <Section title="Needs you" count={1}>
        <Group><Row id="voice-need" title={`${name} stopped accepting the key`} note="Replace the key, or check again if it was a passing problem." leading={<IconTile icon="warn" tone="warn" />} trailing={<Button small label="Replace key" testID="voice-need-replace" onPress={() => setReplacing(true)} />} /></Group>
      </Section> : null}
      <View>
        <Group>
          <Row id="voice-status" title={voiceHeadline(s)} note={note} leading={<IconTile icon="mic" {...(failing ? { tone: "warn" as const } : {})} />} trailing={s.set ? <Text testID="voice-state" style={{ fontSize: 12.5, color: (failing ? "var(--warn)" : "var(--ink-3)") as string }}>{stateWord}</Text> : undefined} />
          {s.set && me.data.providers.length > 1 ? (() => {
            const buttons = (
              <Actions>
                {/* ui-rows-lint: not a list (the buttons of one row, one per other provider) */}
                {me.data.providers.filter((p) => p.key !== s.provider).map((p) => (
                  <Button key={p.key} small label={keyed.includes(p.key) ? `Use ${p.name}` : `Add ${p.name} key`} disabled={action.busy} testID={`voice-use-${p.key}`}
                    onPress={() => (keyed.includes(p.key) ? void action.run("talk.space.configure", { provider: p.key }, `${p.name} covers everyone now`) : (setAdding(p.key), setKey("")))} />
                ))}
              </Actions>
            );
            return (
              <View style={{ borderTopWidth: 1, borderTopColor: "var(--line)" as string }}>
                <Row id="voice-provider" title="Provider for everyone" note={[...me.data.providers].sort((x, y) => Number(y.key === s.provider) - Number(x.key === s.provider)).map((p) => `${p.name}${p.key === s.provider ? " (in use)" : keyed.includes(p.key) ? "" : " (no key yet)"}`).join(" · ")} leading={<IconTile icon="bolt" />} {...(narrow ? {} : { trailing: buttons })} />
                {narrow ? <View testID="voice-provider-buttons" style={{ paddingLeft: 48, paddingRight: 8, marginTop: -8, marginBottom: -4 }}>{buttons}</View> : null}
              </View>
            );
          })() : null}
          {s.set ? <View style={{ borderTopWidth: 1, borderTopColor: "var(--line)" as string }}><Row id="voice-own" title="People with their own key" note={owned === 0 ? "Nobody. The Space key covers everyone" : `${owned} ${owned === 1 ? "person" : "people"} · their own key wins for them`} /></View> : null}
        </Group>
        {form ? (
          <View style={{ marginTop: 10 }}><Group><View testID="voice-form" style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
            {!s.set && adding === null ? <View style={{ marginBottom: 10 }}><Select label="Provider" testID="voice-provider-pick" value={provider?.key ?? pick} hint="Turns what people say into text in the message." options={[...me.data.providers].sort((x, y) => Number(y.key === "deepgram") - Number(x.key === "deepgram")).map((p) => ({ key: p.key, title: p.name }))} onChange={(v) => { setPick(v); setKey(""); }} /></View> : null}
            <Field label={`${name} key`} value={key} onChange={setKey} secure testID="voice-key" />
            <Text accessibilityRole="status" style={{ fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string, marginVertical: 6 }}>{`Goes straight to this Space's Vault and is checked at once. ${provider?.key === "elevenlabs" ? "Make the key in ElevenLabs with Speech to Text access." : "Make the key in Deepgram with the Member role or higher."}`}</Text>
            <Actions>
              <Button label={action.busy ? "Checking" : s.set ? "Replace key" : "Turn on for everyone"} disabled={key.trim() === "" || action.busy} why="Paste the key first" onPress={() => void save()} testID="voice-save" />
              {replacing || adding !== null ? <Button label="Cancel" onPress={() => { setReplacing(false); setAdding(null); setKey(""); }} testID="voice-cancel" /> : null}
              {provider ? <Button label={`Get a key from ${name}`} onPress={() => { (globalThis as { open?: (url: string, target: string) => void }).open?.(provider.keyUrl, "_blank"); }} testID="voice-get-key" /> : null}
            </Actions>
          </View></Group></View>
        ) : (
          <Actions>
            <QuietButton label="Replace key" onPress={() => setReplacing(true)} testID="voice-replace" />
            <QuietButton label={s.on ? "Turn off" : "Turn on"} onPress={() => void action.run("talk.space.configure", { on: !s.on }, s.on ? "Talk is off for everyone without their own key" : "Talk is on for everyone")} disabled={action.busy} testID="voice-toggle" />
            <QuietButton label="Check now" onPress={() => void action.run("talk.space.check", {}, "Checked")} disabled={action.busy} testID="voice-check" />
            {gone
              ? <Button danger label="Remove from the Vault" onPress={() => void action.run("talk.space.disconnect", {}, "Key removed").then(() => setGone(false))} testID="voice-remove-yes" />
              : <QuietButton danger label="Remove key" onPress={() => setGone(true)} testID="voice-remove" />}
          </Actions>
        )}
        {action.note !== "" ? <View style={{ marginTop: 8 }}><Note testID="voice-note">{action.note}</Note></View> : null}
      </View>
    </View>
  );
}
