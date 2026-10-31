// Settings pages that belong to the open Space: Profile (with Copy from another Space), Notifications, Models and usage, Connections, Memory and privacy.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Avatar, assistantId, assistantLook, setAssistantLook, subscribeAssistant } from "../../../../../ui/src/Avatar/index.tsx";
import { useOpenConnect } from "../../shell/connect/context.ts";
import { Bar, RegistrySections, useRead } from "./blocks.tsx";
import { CopyFromSpace } from "./CopyFromSpace.tsx";
import { MemoryKeys } from "./MemoryKeys.tsx";
import { CONNECTIONS, MODELS, NOTIFICATIONS, useIsPersonal, useSettingsData, useScreenQuery } from "./data.tsx";
import { labelOf, moneyLabel, sectionsFor } from "./model.ts";
import type { SettingRow } from "./model.ts";
import { SettingRowFor, useChange } from "./rows.tsx";
import { useSaved } from "./saved.tsx";
import { NOT_CONNECTED, suiteSections, throughFirm } from "./suites.ts";
import type { CalendarLite } from "./suites.ts";
import { Choice, Field, Glyph, Section, SettingsRow, SmallButton, Value, pointer } from "./ui.tsx";

export interface PageProps { rows: readonly SettingRow[]; found: string | null }

const rowOf = (rows: readonly SettingRow[], key: string): SettingRow | undefined => rows.find((r) => r.key === key);
const str = (r: SettingRow | undefined): string => (typeof r?.value === "string" ? r.value : "");

// ---------------------------------------------------------------- Profile

export function ProfilePage({ rows, found }: PageProps): ReactElement {
  const data = useSettingsData();
  const change = useChange();
  const [copy, setCopy] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const name = rowOf(rows, "profile.display_name");
  const handle = rowOf(rows, "profile.handle");
  const title = rowOf(rows, "profile.title");
  const contact = rowOf(rows, "profile.contact");
  const photo = rowOf(rows, "profile.photo");
  const who = str(name) || data.me.name;
  // The time zone starts as the computer's, not the manifest's UTC: written once per person on this device while the setting still holds its default.
  const tz = rowOf(rows, "profile.timezone");
  useEffect(() => {
    if (!tz || tz.value !== tz.default) return;
    const zone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; } })();
    if (!zone || zone === tz.value) return;
    const flag = `vyre.tz.seeded:${data.me.id}`;
    try { if (globalThis.localStorage?.getItem(flag) === "1") return; globalThis.localStorage?.setItem(flag, "1"); } catch { return; }
    void change(tz, zone);
  }, [tz?.value]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = (contact?.value ?? {}) as { email?: string; phone?: string };
  const here = data.spaces.find((sp) => sp.current);
  const role = here?.kind === "personal" ? "" : here?.role ?? "";   // no role labels in a Personal Space
  const line = [str(handle) ? `@${str(handle)}` : "", role, str(title)].filter(Boolean).join(" · ");
  const before: ReactElement[] = [];
  const after: ReactElement[] = [];
  for (const sec of sectionsFor("profile", rows)) {
    const items: ReactElement[] = [];
    sec.rows.forEach((r, i) => items.push(<SettingRowFor key={r.key} row={r} first={i === 0} found={found === r.key} />));
    (sec.title === "Availability" ? before : after).push(<Section key={sec.title} title={sec.title}>{items}</Section>);
  }
  const rowFor = (r: SettingRow | undefined, i: number, node: ReactElement, label: string, sub?: string): ReactElement | null =>
    r ? <SettingsRow key={r.key} id={r.key} label={label} first={i === 0} found={found === r.key} {...(sub ? { sub } : {})} control={node} /> : null;
  return (
    <>
      <View style={s.card} testID="profile-card">
        <View style={s.photo} accessibilityLabel="Your photo"><Avatar name={who} seedId={data.me.id} kind="person" size={72} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={s.who}>{who}</Text>
          <Text numberOfLines={1} style={s.line} testID="profile-line">{line}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Copy from another Space" testID="copy-open" onPress={() => setCopy(true)} style={[s.copyBtn, pointer]}><Glyph name="copy" size={15} color="var(--ink-3)" /></Pressable>
      </View>
      <Section title="About you">
        {[
          photo ? <SettingsRow key="photo" id="profile.photo" label="Photo" first found={found === "profile.photo"} {...(photoNote ? { sub: photoNote } : {})} control={<><SmallButton label="Choose" testID="choose-photo" onPress={() => { setPhotoNote(null); data.nav.choosePhoto().then((id) => { if (id) void change(photo, id); }, (e: unknown) => setPhotoNote(e instanceof Error && e.message ? e.message : "Could not use that picture.")); }} />{photo.value ? <SmallButton label="Remove" onPress={() => void change(photo, null)} /> : null}</>} /> : null,
          rowFor(name, 1, <Field value={str(name) || data.me.name} label="Name" testID="ctl-profile.display_name" onCommit={(v) => { if (v !== (str(name) || data.me.name)) void change(name!, v); }} />, "Name"),
          rowFor(handle, 2, <Field value={str(handle) || data.me.username || ""} label="Handle" placeholder="Pick a handle" prefix="@" mono pattern={"^([a-z0-9_.-]{2,32})?$"} width={160} testID="ctl-profile.handle" onCommit={(v) => { if (v !== (str(handle) || data.me.username || "")) void change(handle!, v); }} />, "Handle", "Letters, numbers, dots and dashes"),
          rowFor(title, 3, <Field value={str(title)} label="Title" placeholder="Add a title" testID="ctl-profile.title" onCommit={(v) => void change(title!, v)} />, "Title"),
        ]}
      </Section>
      {assistantId() ? <AssistantLook /> : null}
      {before}
      {contact ? (
        <Section title="Contact">
          <SettingsRow id="profile.contact" label="Email" first found={found === "profile.contact"} control={<Field value={c.email ?? ""} label="Email" placeholder="Add an email" width={260} testID="ctl-profile.contact.email" onCommit={(v) => void change(contact, { ...c, email: v })} />} />
          <SettingsRow id="profile.contact.phone" label="Phone" control={<Field value={c.phone ?? ""} label="Phone" placeholder="Add a phone number" width={260} testID="ctl-profile.contact.phone" onCommit={(v) => void change(contact, { ...c, phone: v })} />} />
        </Section>
      ) : null}
      {after}
      {copy ? <CopyFromSpace onClose={() => setCopy(false)} /> : null}
    </>
  );
}

// ---------------------------------------------------------------- Your Assistant's look

/** The looks on offer: the Vyre mark (the default), then faces drawn from the agent library. */
export const ASSISTANT_LOOKS: readonly string[] = ["", "look-ember", "look-tide", "look-moss", "look-dusk", "look-sand"];

function AssistantLook(): ReactElement {
  const look = useSyncExternalStore(subscribeAssistant, assistantLook, assistantLook);
  const at = Math.max(0, ASSISTANT_LOOKS.indexOf(look));
  return (
    <Section title="You and your Assistant">
      <SettingsRow id="assistant.look" label="Its look" first sub={look === "" ? "The Vyre mark" : "A face you picked"} control={
        <>
          <View accessibilityLabel="Assistant look" testID="assistant-look"><Avatar name="Assistant" seedId={assistantId()} kind="assistant" size={28} /></View>
          <SmallButton label="Change its look" testID="assistant-look-change" onPress={() => setAssistantLook(ASSISTANT_LOOKS[(at + 1) % ASSISTANT_LOOKS.length] ?? "")} />
          {look !== "" ? <SmallButton label="Use the Vyre mark" testID="assistant-look-reset" onPress={() => setAssistantLook(null)} /> : null}
        </>
      } />
    </Section>
  );
}

// ---------------------------------------------------------------- Notifications

type KindsOut = CapMap["notifications.kinds.list"]["out"];
type MutesOut = CapMap["notifications.mute.list"]["out"];

export function NotificationsPage({ rows, found }: PageProps): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const kinds = useRead<KindsOut>("notifications.kinds.list");
  const mutes = useScreenQuery<MutesOut>(NOTIFICATIONS, "mutes", {});
  const [levels, setLevels] = useState<Record<string, string>>({});
  const setLevel = (key: string, was: string, level: string): void => {
    setLevels((cur) => ({ ...cur, [key]: level }));
    void data.call("notifications.kind.set_level", { kind: key, level }).then(
      () => saved.saved("Saved", async () => { setLevels((cur) => ({ ...cur, [key]: was })); await data.call("notifications.kind.set_level", { kind: key, level: was }); }),
      (e: unknown) => { setLevels((cur) => ({ ...cur, [key]: was })); saved.failed(e instanceof Error ? e.message : "That did not save."); },
    );
  };
  const list: ReactElement[] = [];
  (kinds?.kinds ?? []).forEach((k, i) => {
    const level = levels[k.key] ?? k.level;
    list.push(<SettingsRow key={k.key} id={`kind.${k.key}`} label={k.title} first={i === 0} control={<Choice value={level} options={LEVELS} label={k.title} testID={`kind-${k.key}`} onChange={(v) => setLevel(k.key, level, v)} />} />);
  });
  const muteRows: ReactElement[] = [];
  if (mutes.status === "ready") {
    mutes.data.mutes.forEach((m, i) => muteRows.push(
      <SettingsRow
        key={`${m.target.kind}-${m.target.id}`} id={`mute.${m.target.id}`} label={data.name(m.target.id)} first={i === 0} sub={`${labelOf(m.target.kind)}, quiet for now`}
        control={<SmallButton label="Unmute" onPress={() => void data.call("notifications.mute.clear", { target: m.target }).then(() => saved.saved("Unmuted")).catch((e: unknown) => saved.failed(e instanceof Error ? e.message : "That did not work."))} />}
      />,
    ));
  }
  return (
    <>
      <Section title="Notify me on" testID="notify-me-on">{list}</Section>
      <RegistrySections page="notifications" rows={rows} found={found} />
      {muteRows.length > 0 ? <Section title="Muted">{muteRows}</Section> : null}
    </>
  );
}
/** How each level reaches the person: interrupt rings the desktop and the phone, badge adds a dot only, digest waits for While you were away. A level the Space holds higher (approvals) refuses with its reason. */
const LEVELS: readonly { value: string; label: string }[] = [{ value: "interrupt", label: "Interrupt" }, { value: "badge", label: "Badge only" }, { value: "digest", label: "Digest" }];

// ---------------------------------------------------------------- Models and usage

type AccountsOut = CapMap["engine.accounts.list"]["out"];
type DefaultsOut = CapMap["engine.defaults.get"]["out"];
type ModelsOut = CapMap["engine.models.list"]["out"];
type UsageOut = CapMap["engine.usage.query"]["out"];

export function ModelsPage({ rows, found }: PageProps): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const defaults = useScreenQuery<DefaultsOut>(MODELS, "defaults", {});
  const models = useScreenQuery<ModelsOut>(MODELS, "models", {});
  const accounts = useScreenQuery<AccountsOut>(MODELS, "accounts", {});
  const usage = useScreenQuery<UsageOut>(MODELS, "usage", { by: "model" });
  const options: { value: string; label: string }[] = [];
  if (models.status === "ready") for (const m of models.data.models) if (m.allowed) options.push({ value: `${m.provider}/${m.model}`, label: m.title });
  const d = defaults.status === "ready" ? defaults.data : null;
  const cur = d?.provider && d.model ? `${d.provider}/${d.model}` : "";
  const fb = d?.fallback[0] ? `${d.fallback[0].provider}/${d.fallback[0].model}` : "";
  const setDefault = (v: string, slot: "model" | "fallback"): void => {
    const [provider, model] = v.split("/");
    if (!provider || !model || !d) return;
    const input = slot === "model" ? { provider, model } : { fallback: [{ provider, model }] };
    void data.call("engine.defaults.set", input).then(() => saved.saved("Saved")).catch((e: unknown) => saved.failed(e instanceof Error ? e.message : "That did not save."));
  };
  const use: ReactElement[] = [];
  if (usage.status === "ready") {
    let top = 1;
    for (const r of usage.data.rows) top = Math.max(top, r.totals.costMicros);
    usage.data.rows.forEach((r, i) => use.push(
      <View key={r.key} style={[s.useRow, i > 0 && s.useLine]} testID={`usage-${r.key}`}>
        <View style={s.useHead}><Text style={s.useTitle}>{r.title}</Text><Text style={s.useCost}>{moneyLabel(r.totals.costMicros)}</Text></View>
        <Bar ratio={r.totals.costMicros / top} />
        <Text style={s.useSub}>{`${r.totals.turns} turns, ${Math.round((r.totals.tokensIn + r.totals.tokensOut) / 1000)}k tokens`}</Text>
      </View>,
    ));
  }
  const acc: ReactElement[] = [];
  if (accounts.status === "ready") {
    accounts.data.accounts.forEach((a, i) => acc.push(
      <SettingsRow
        key={a.ref} id={`account.${a.ref}`} label={a.title} first={i === 0} sub={`${a.kind === "subscription" ? "Sign-in" : "API key"}, ${a.mine ? "yours" : "shared in the Space"}`}
        control={<Value text={a.status === "ok" ? "Working" : a.status === "expired" ? "Sign in again" : a.status === "failed" ? "Failed" : "Not tested"} accent={a.status !== "ok"} />}
      />,
    ));
  }
  return (
    <>
      <Section>
        <SettingsRow id="model.default" label="Default model" first control={<Choice value={cur} options={options} label="Default model" testID="ctl-model-default" onChange={(v) => setDefault(v, "model")} />} />
        <SettingsRow id="model.fallback" label="Fallback model" control={<Choice value={fb} options={options} label="Fallback model" testID="ctl-model-fallback" onChange={(v) => setDefault(v, "fallback")} />} />
      </Section>
      {use.length > 0 ? <Section title="You and your agents this month" testID="usage">{use}</Section> : null}
      <RegistrySections page="models" rows={rows} found={found} />
      <Section title="Providers">
        {acc}
        <SettingsRow id="open-vault" label="Open Vault" lead={<Glyph name="key" size={15} />} first={acc.length === 0} onPress={() => data.nav.openVault()} control={<Glyph name="chevR" size={13} />} />
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- Connections

type MailboxesOut = CapMap["mail.mailbox.list"]["out"];
const PROVIDER: Record<string, string> = { google: "Google", microsoft: "Microsoft", imap: "IMAP", inbound_only: "Receive only" };
const STATE: Record<string, string> = { pending: "Connecting", syncing: "Syncing", paused: "Paused", error: "Needs attention", disconnected: "Disconnected" };

export function ConnectionsPage({ rows, found }: PageProps): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const boxes = useScreenQuery<MailboxesOut>(CONNECTIONS, "mailboxes", {});
  const list: ReactElement[] = [];
  if (boxes.status === "ready") {
    boxes.data.mailboxes.forEach((m, i) => list.push(
      <SettingsRow
        key={m.id} id={`mailbox.${m.id}`} label={m.address} first={i === 0} sub={`${PROVIDER[m.provider] ?? m.provider}, ${m.privacy === "private" ? "private to you" : m.privacy === "space" ? "visible to the Space" : "shared with chosen people"}`}
        lead={<Glyph name="mail" size={15} />}
        control={
          <>
            <Value text={STATE[m.state] ?? m.state} accent={m.state === "error"} />
            {m.state === "paused"
              ? <SmallButton label="Resume" onPress={() => void data.call("mail.mailbox.resume", { mailboxId: m.id }).then(() => saved.saved("Resumed")).catch(() => saved.failed("That did not resume."))} />
              : <SmallButton label="Pause" onPress={() => void data.call("mail.mailbox.pause", { mailboxId: m.id }).then(() => saved.saved("Paused", async () => { await data.call("mail.mailbox.resume", { mailboxId: m.id }); })).catch(() => saved.failed("That did not pause."))} />}
          </>
        }
      />,
    ));
  }
  const [calendars, setCalendars] = useState<CalendarLite[] | null>(null);
  useEffect(() => {
    let live = true;
    void data.call("calendar.list_calendars", {}).then(
      (out) => { if (live) setCalendars(((out as { calendars?: CalendarLite[] }).calendars ?? []).map((c) => ({ id: c.id, title: c.title, provider: c.provider, state: c.state }))); },
      () => { if (live) setCalendars([]); },
    );
    return () => { live = false; };
  }, [data]);
  const mine = boxes.status === "ready" ? boxes.data.mailboxes.map((m) => ({ id: m.id, address: m.address, provider: m.provider, state: m.state })) : [];
  const suites = suiteSections(mine, calendars ?? []);
  const personal = useIsPersonal();
  const openConnect = useOpenConnect();
  const firm: ReactElement[] = [];
  suites.forEach((suite, si) => firm.push(
    <SettingsRow key={suite.key} id={`suite.${suite.key}`} label={suite.title} sub={throughFirm(suite)} first={si === 0} lead={<Glyph name="link" size={15} />} control={<Value text={suite.rows.map((r) => r.service).filter((v, i, a) => a.indexOf(v) === i).join(" and ")} />} />,
  ));
  return (
    <>
      {personal ? null : (
        <Section title="Through your Space" note={suites.length === 0 && boxes.status === "ready" && calendars !== null ? NOT_CONNECTED : undefined}>
          {firm}
        </Section>
      )}
      <Section title="Mail and calendar">
        {list}
        <SettingsRow id="connect-mailbox" label="Connect a mailbox" first={list.length === 0} lead={<Glyph name="plus" size={15} />} onPress={() => (openConnect ? void openConnect({ kind: "mailbox" }) : data.nav.connect("mailbox"))} control={<Glyph name="chevR" size={13} />} />
        <SettingsRow id="connect-calendar" label="Connect a calendar" lead={<Glyph name="plus" size={15} />} onPress={() => data.nav.connect("calendar")} control={<Glyph name="chevR" size={13} />} />
        <SettingsRow id="connect-twilio" label="Connect Twilio" lead={<Glyph name="plus" size={15} />} onPress={() => (openConnect ? void openConnect({ kind: "number" }) : data.nav.connect("twilio"))} control={<Glyph name="chevR" size={13} />} />
      </Section>
      <RegistrySections page="connections" rows={rows} found={found} />
    </>
  );
}

// ---------------------------------------------------------------- Memory and privacy

export function PrivacyPage({ rows, found }: PageProps): ReactElement {
  return (
    <>
      <RegistrySections page="privacy" rows={rows} found={found} />
      <MemoryKeys />
    </>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string },
  photo: { width: 72, height: 72, borderRadius: 36, overflow: "hidden" },
  who: { fontSize: 17, fontWeight: "600", color: "var(--ink)" as string },
  line: { fontSize: 12.5, color: "var(--ink-3)" as string, marginTop: 2 },
  copyBtn: { width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 7, alignSelf: "flex-start" },
  useRow: { paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  useLine: { borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  useHead: { flexDirection: "row", justifyContent: "space-between" },
  useTitle: { fontSize: 13.5, color: "var(--ink)" as string },
  useCost: { fontSize: 13, color: "var(--ink-2)" as string },
  useSub: { fontSize: 12, color: "var(--ink-3)" as string },
});
