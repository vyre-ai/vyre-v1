// Settings, AI, Voice: what covers this person and how Talk hears them. One line says what covers them; the key itself is set by a press, in the first-press sheet. A Personal Space has no Console, so its key is managed here too.
import { useCallback, useContext, useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { CapMap } from "../../../../../generated/types.ts";
import { TalkContext } from "../../../../../ui/src/Composer/index.tsx";
import { useIsPersonal, useSettingsData } from "./data.tsx";
import { useSaved } from "./saved.tsx";
import { Choice, Section, SettingsRow, SmallButton, Switch } from "./ui.tsx";

type Out = CapMap["talk.status"]["out"];

export function coverLine(status: Pick<Out, "source">, personal: boolean): { label: string; sub: string } {
  if (status.source === "own") return { label: "Your own key", sub: "Kept in your Vault" };
  if (status.source === "space") return { label: "Covered by your Space", sub: "Nothing to set up. Press the mic" };
  return { label: "No key yet", sub: personal ? "Add a key here to use the mic" : "Ask an admin to add one for everyone, or add your own here" };
}

export function VoiceRows({ found }: { found?: string | undefined }): ReactElement | null {
  const data = useSettingsData();
  const saved = useSaved();
  const personal = useIsPersonal();
  const talk = useContext(TalkContext);
  const [status, setStatus] = useState<Out | null>(null);
  const load = useCallback((): void => { void data.call("talk.status", {}).then((o) => setStatus(o as Out), () => setStatus(null)); }, [data]);
  useEffect(load, [load]);
  if (!status) return null;
  const provider = status.providers.find((p) => p.key === status.provider) ?? status.providers[0];
  const change = (input: Record<string, unknown>): void => {
    void data.call("talk.configure", input).then((o) => { setStatus(o as Out); saved.saved("Saved"); void talk?.refresh?.(); }, (e: unknown) => saved.failed(e instanceof Error ? e.message : "That did not save."));
  };
  const addKey = (): void => { void talk?.setup?.("mine").then((done) => { if (done) load(); }, () => undefined); };
  const removeKey = (): void => { void data.call("talk.disconnect", {}).then((o) => { setStatus(o as Out); saved.saved("Key removed"); }, (e: unknown) => saved.failed(e instanceof Error ? e.message : "That did not save.")); };
  const cover = coverLine(status, personal);
  return (
    <Section title="Talk" testID="settings-voice">
      <SettingsRow id="talk.on" label="Talk" sub="The mic in every chat" first found={found === "talk.on"} control={<Switch on={status.on} label="Talk" testID="ctl-voice-on" onChange={(on) => change({ on })} />} />
      <SettingsRow id="talk.cover" label={cover.label} sub={cover.sub} found={found === "talk.cover"} control={status.source === "own"
        ? <SmallButton label="Remove" onPress={removeKey} testID="ctl-voice-remove" />
        : <SmallButton label={status.source === "space" ? "Use my own key" : "Add a key"} onPress={addKey} testID="ctl-voice-own" />} />
      {provider ? <SettingsRow id="talk.language" label="Language" found={found === "talk.language"} control={<Choice value={status.language} options={provider.languages.map((l) => ({ value: l.id, label: l.label }))} label="Language" testID="ctl-voice-language" onChange={(language) => change({ language })} />} /> : null}
      {provider ? <SettingsRow id="talk.model" label="Model" found={found === "talk.model"} control={<Choice value={status.model} options={provider.models.map((m) => ({ value: m.id, label: m.label }))} label="Model" testID="ctl-voice-model" onChange={(model) => change({ model })} />} /> : null}
    </Section>
  );
}
