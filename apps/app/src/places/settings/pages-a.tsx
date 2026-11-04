// The pages of You that hold your own work: Profile (with Copy from another Space), Notifications, AI (models, how agents work with you, usage, memory) and Connected (Email and calendar is MailPage.tsx).
import { useConnectionsSummary } from "../vault/connections/summary.ts";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Avatar, assistantId, assistantLook, setAssistantLook, subscribeAssistant } from "../../../../../ui/src/Avatar/index.tsx";
import { Bar, RegistrySections, useRead } from "./blocks.tsx";
import { ContactVerify } from "./ContactVerify.tsx";
import { CopyFromSpace } from "./CopyFromSpace.tsx";
import { SignInApps } from "./SignInApps.tsx";
import { OutsideAgents } from "./OutsideAgents.tsx";
import { MODELS, NOTIFICATIONS, useIsPersonal, useSettingsData, useScreenQuery } from "./data.tsx";
import { ROW_HELP, clock, labelOf, moneyLabel, rowHelp, sectionsFor } from "./model.ts";
import type { SettingRow } from "./model.ts";
import { SettingRowFor, useChange } from "./rows.tsx";
import { useSaved } from "./saved.tsx";
import { VoiceRows } from "./VoiceRows.tsx";
import { Choice, Field, Glyph, Section, SettingsRow, SmallButton, Switch, Value, pointer } from "./ui.tsx";
import { useZones } from "../../../../../ui/src/Time/index.tsx";
import { zoneName, zoneCity } from "../../../../../lib/zones.ts";
import { useOpenConnect } from "../../shell/connect/context.ts";
import { statusNote, useSpaceAi } from "../../ai-signin/SpaceAiStatus.tsx";

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
  const zones = useZones();
  const role = here?.kind === "personal" ? "" : here?.role ?? "";   // no role labels in a Personal Space
  const line = [str(handle) ? `@${str(handle)}` : "", role, str(title)].filter(Boolean).join(" · ");
  const before: ReactElement[] = [];
  for (const sec of sectionsFor("profile", rows)) {
    const items: ReactElement[] = [];
    sec.rows.forEach((r, i) => items.push(<SettingRowFor key={r.key} row={r} first={i === 0} found={found === r.key} />));
    before.push(<Section key={sec.title} title={sec.title}>{items}</Section>);
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
        {data.spaces.length > 1 ? <Pressable accessibilityRole="button" accessibilityLabel="Copy from another Space" testID="copy-open" onPress={() => setCopy(true)} style={[s.copyBtn, pointer]}><Glyph name="copy" size={15} color="var(--ink-3)" /></Pressable> : null}
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
      {here?.kind === "personal" ? null : (
        <Section title="Shared time">
          <SettingsRow id="space.timezone" label="Space time zone" first sub="Set by an admin in Console. Shared places read in it and show your own time beside it." control={<Value text={`${zoneName(zones.space)}, ${zoneCity(zones.space)}`} testID="space-timezone-readonly" />} />
        </Section>
      )}
      {contact ? (
        <Section title="Contact">
          <SettingsRow id="profile.contact" label="Email" first found={found === "profile.contact"} control={<View style={{ alignItems: "flex-end", gap: 6 }}><Field value={c.email ?? ""} label="Email" placeholder="Add an email" width={260} testID="ctl-profile.contact.email" onCommit={(v) => void change(contact, { ...c, email: v })} /><ContactVerify channel="email" value={(c.email ?? "").trim()} /></View>} />
          <SettingsRow id="profile.contact.phone" label="Phone" control={<View style={{ alignItems: "flex-end", gap: 6 }}><Field value={c.phone ?? ""} label="Phone" placeholder="Add a phone number" width={260} testID="ctl-profile.contact.phone" onCommit={(v) => void change(contact, { ...c, phone: v })} /><ContactVerify channel="phone" value={(c.phone ?? "").trim()} /></View>} />
        </Section>
      ) : null}
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
const WORD: Readonly<Record<string, string>> = { from: "Someone", agent: "An agent", name: "Something", where: "a chat", device: "a device", service: "A service", space: "the Space", level: "more", title: "something", state: "down", reason: "a reason", decision: "decided", message: "an error" };
/** A notification kind's title is the template of the notice; here it names the kind, so the blanks read as words, never as {{from}}. */
/** What each kind is called on the page, in plain words. A template title ("{{from}} replied in {{where}}") is never shown as a label. */
export const KIND_LABELS: Readonly<Record<string, string>> = {
  "approval.requested": "Needs you", "unblock.requested": "Someone is blocked on you", "answer.requested": "Needs your answer", "approval.backstop": "Still waiting on you", dm: "Direct messages", mention: "Mentions", "mention.thread": "Mentions in a reply",
  "call.incoming": "Incoming calls", "agent.blocked": "An agent is blocked", "agent.task_finished": "Agent finished a task", "incident.owned": "Incidents you own", "task.assigned": "Tasks given to you", "task.turn": "Your turn on a task", "task.returned": "A task sent back to you",
  "task.finished": "Tasks finished", "task.due": "Tasks due", "reply.followed": "Replies to you", "reply.thread": "Replies in a chat", "digest.away": "While you were away", "run.failed": "Routines that failed", "conflict.needs_you": "Edits that conflict",
  "access.requested": "Requests for access", "access.decided": "Answers to your access requests", "item.shared": "Things shared with you", "sync.attention": "A device needs attention", "health.degraded": "Something is down", "problem.report": "Problem reports",
  "member.joined": "People who joined", "member.join_requested": "People asking to join", "limit.hit": "A limit was reached", "vault.rotation_due": "Keys to rotate", "machine.alert": "Machine alerts", "ci.paused": "Builds paused", "space.deletion_scheduled": "Space deletion scheduled", "space.deletion_cancelled": "Space deletion cancelled",
};
export const kindLabel = (title: string): string => title.replace(/^Replies in your threads$/, "Replies to you").replace(/:\s*\{\{\w+\}\}$/, "").replace(/\{\{(\w+)\}\}/g, (_, w: string) => WORD[w] ?? "something");
type MutesOut = CapMap["notifications.mute.list"]["out"];

export type Channel = "desktop" | "phone" | "email";
export const CHANNELS: readonly { key: Channel; label: string }[] = [{ key: "desktop", label: "Desktop" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }];
/** "Desktop and email", "Desktop", "Badge only": where a kind reaches the person, in words. */
export function channelWords(cs: readonly Channel[]): string {
  const n = CHANNELS.filter((c) => cs.includes(c.key)).map((c, i) => (i === 0 ? c.label : c.label.toLowerCase()));
  return n.length === 0 ? "Badge only" : n.length === 1 ? n[0]! : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]!}`;
}
/** The channels a plain level stands for, until the person has picked their own. */
export const levelChannels = (level: string): Channel[] => (level === "interrupt" ? ["desktop", "phone"] : []);
export const toggleChannel = (cs: readonly Channel[], c: Channel): Channel[] => (cs.includes(c) ? cs.filter((x) => x !== c) : CHANNELS.map((x) => x.key).filter((k) => k === c || cs.includes(k)));

function Chip({ label, on, onPress, testID }: { label: string; on: boolean; onPress(): void; testID: string }): ReactElement {
  return (
    <Pressable accessibilityRole="button" aria-pressed={on} accessibilityLabel={label} testID={testID} onPress={onPress} style={[{ height: 28, paddingHorizontal: 10, borderRadius: 14, justifyContent: "center", borderWidth: 1, borderColor: (on ? "var(--accent)" : "var(--line)") as string, backgroundColor: (on ? "var(--accent-wash)" : "transparent") as string }, pointer]}>
      <Text style={{ fontSize: 12.5, color: (on ? "var(--ink)" : "var(--ink-3)") as string }}>{label}</Text>
    </Pressable>
  );
}

export function NotificationsPage({ rows, found }: PageProps): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const kinds = useRead<KindsOut>("notifications.kinds.list");
  const mutes = useScreenQuery<MutesOut>(NOTIFICATIONS, "mutes", {});
  const [levels, setLevels] = useState<Record<string, string>>({});
  const [chans, setChans] = useState<Record<string, Channel[]>>({});
  /** One press on a channel: the channels now carrying the kind, saved; Undo puts the old ones back. */
  const toggle = (key: string, was: Channel[], c: Channel): void => {
    const next = toggleChannel(was, c);
    setChans((cur) => ({ ...cur, [key]: next }));
    const send = (cs: Channel[]): Promise<unknown> => Promise.resolve(data.call("notifications.kind.set_level", { kind: key, channels: cs }));
    void send(next).then(
      () => saved.saved("Saved", async () => { setChans((cur) => ({ ...cur, [key]: was })); await send(was); }),
      (e: unknown) => { setChans((cur) => ({ ...cur, [key]: was })); saved.failed(e instanceof Error ? e.message : "That did not save."); },
    );
  };
  const list: ReactElement[] = [];
  (kinds?.kinds ?? []).forEach((k, i) => {
    const now = chans[k.key] ?? (k.mine?.channels as Channel[] | undefined) ?? levelChannels(k.level);
    list.push(
      <SettingsRow key={k.key} id={`kind.${k.key}`} label={KIND_LABELS[k.key] ?? kindLabel(k.title)} first={i === 0} sub={channelWords(now)} help="Pick where it reaches you. With none picked it adds a dot only."
        /* ui-rows-lint: not a list (the channel chips of one row's control) */
        control={<View style={{ flexDirection: "row", gap: 6 }} testID={`kind-${k.key}`}>{CHANNELS.map((c) => <Chip key={c.key} label={c.label} on={now.includes(c.key)} testID={`kind-${k.key}-${c.key}`} onPress={() => toggle(k.key, now, c.key)} />)}</View>} />,
    );
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
      <QuietHours rows={rows} found={found} />
      <AwayHand rows={rows} found={found} />
      {muteRows.length > 0 ? <Section title="Muted">{muteRows}</Section> : null}
    </>
  );
}
interface Quiet { on: boolean; from: string; to: string; needs: boolean }
const HALF_HOURS: readonly { value: string; label: string }[] = Array.from({ length: 48 }, (_, i) => { const v = `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "00" : "30"}`; return { value: v, label: clock(v) }; });

/** Quiet hours: one switch, then the two times and Needs you only while it is on. */
function QuietHours({ rows, found }: PageProps): ReactElement | null {
  const change = useChange();
  const row = rowOf(rows, "notifications.quiet_hours");
  if (!row) return null;
  const q = row.value as Quiet;
  const times = (at: "from" | "to", label: string): ReactElement => <Choice value={q[at]} options={HALF_HOURS} label={label} testID={`ctl-quiet-${at}`} onChange={(v) => void change(row, { ...q, [at]: v })} />;
  return (
    <Section title="Quiet hours">
      <SettingsRow id={row.key} label="Quiet hours" help={ROW_HELP[row.key]!} first found={found === row.key} inline control={<Switch on={q.on} label="Quiet hours" testID="ctl-quiet-on" onChange={(on) => void change(row, { ...q, on })} />} />
      {q.on ? <SettingsRow id="quiet.from" label="From" control={times("from", "Quiet from")} /> : null}
      {q.on ? <SettingsRow id="quiet.to" label="To" control={times("to", "Quiet until")} /> : null}
      {q.on ? <SettingsRow id="quiet.needs" label="Let Needs you through" help="Needs you still reaches you during quiet hours." inline control={<Switch on={q.needs} label="Let Needs you through" testID="ctl-quiet-needs" onChange={(needs) => void change(row, { ...q, needs })} />} /> : null}
    </Section>
  );
}

type PeopleOut = CapMap["access.principals.list"]["out"];

/** While you are away: who your Needs you goes to. A Personal Space has nobody to hand it to. */
function AwayHand({ rows, found }: PageProps): ReactElement | null {
  const data = useSettingsData();
  const change = useChange();
  const personal = useIsPersonal();
  const people = useRead<PeopleOut>("access.principals.list", { kind: "person", status: "active", limit: 100 });
  const row = rowOf(rows, "notifications.hand_needs_you_to");
  if (!row || personal) return null;
  const options: { value: string; label: string }[] = [{ value: "", label: "Nobody" }];
  for (const p of people?.principals ?? []) if (p.id !== data.me.id) options.push({ value: p.id, label: p.name });
  return (
    <Section title="Away">
      <SettingsRow id={row.key} label="While you're away, send Needs you to" help={rowHelp(row)!} first found={found === row.key} control={<Choice value={typeof row.value === "string" ? row.value : ""} options={options} label="While you're away, send Needs you to" testID="ctl-hand-to" onChange={(v) => void change(row, v === "" ? null : v)} />} />
    </Section>
  );
}

/** How each level reaches the person: interrupt rings the desktop and the phone, badge adds a dot only, digest waits for While you were away. A level the Space holds higher (approvals) refuses with its reason. */
const LEVELS: readonly { value: string; label: string }[] = [{ value: "interrupt", label: "Desktop and phone" }, { value: "badge", label: "Badge only" }, { value: "digest", label: "In my summary" }];

// ---------------------------------------------------------------- AI

type AccountsOut = CapMap["engine.accounts.list"]["out"];
type DefaultsOut = CapMap["engine.defaults.get"]["out"];
type ModelsOut = CapMap["engine.models.list"]["out"];
type UsageOut = CapMap["engine.usage.query"]["out"];

/** The one line about the Space AI key: what covers this person when they have no working account of their own, or where the key sits behind theirs. */
export function spaceKeyLine(accounts: readonly Pick<AccountsOut["accounts"][number], "title" | "mine" | "status" | "spaceKey">[]): { label: string; sub: string; own: boolean } | null {
  const key = accounts.find((a) => a.spaceKey === true);
  if (!key) return null;
  const own = accounts.some((a) => a.mine && (a.status === "ok" || a.status === "untested"));
  return own
    ? { label: `The Space's ${key.title} key`, sub: "Your own account answers first", own }
    : { label: `Using the Space's ${key.title} key`, sub: "Nothing to set up. Add your own to use it first", own };
}

/** "and 3 older sign-ins": the quiet line under an account that has older sign-ins of the same provider whose account Vyre cannot read. Null when there are none. */
export function olderLine(n: number): string | null {
  return n <= 0 ? null : `and ${n} older sign-in${n === 1 ? "" : "s"}`;
}

/** The start of this month in the person's own clock, as the milliseconds the usage read takes. */
export function monthStart(now: number, offsetMin: number): number {
  const local = new Date(now + offsetMin * 60_000);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - offsetMin * 60_000;
}

/** The value the Default model row shows: the last pick (its provider found from the models on offer when the pick did not keep one), else the Space default, else nothing. */
export function defaultModelValue(last: { provider?: string; model?: string } | null, defaults: { provider?: string; model?: string } | null, options: readonly { value: string }[]): string {
  if (last?.model) {
    if (last.provider) return `${last.provider}/${last.model}`;
    const hit = options.find((o) => o.value.endsWith(`/${last.model}`));
    if (hit) return hit.value;
  }
  return defaults?.provider && defaults.model ? `${defaults.provider}/${defaults.model}` : "";
}

export function AiPage({ rows, found }: PageProps): ReactElement {
  const data = useSettingsData();
  const openConnect = useOpenConnect();
  const saved = useSaved();
  const defaults = useScreenQuery<DefaultsOut>(MODELS, "defaults", {});
  const models = useScreenQuery<ModelsOut>(MODELS, "models", {});
  const accounts = useScreenQuery<AccountsOut>(MODELS, "accounts", {});
  // a Team Space with no Space AI key says so, with who can add one, so AI accounts is never an empty list with nowhere to go
  const personal = useIsPersonal();
  const noSpaceKey = !personal && accounts.status === "ready" && !accounts.data.accounts.some((a) => a.spaceKey === true);
  const spaceAi = useSpaceAi(data.call, { me: data.me.id, off: !noSpaceKey });
  // "You and your agents this month": this person's own turns since the first of the month. Someone who manages AI spend would otherwise be handed the whole Space for all time; that view is Console > AI > Spend and limits.
  const usage = useScreenQuery<UsageOut>(MODELS, "usage", { by: "model", personId: data.me.id, from: monthStart(data.clock().now, data.clock().offsetMin) });
  // older sign-ins: shown on request, removed one by one by the person (never by Vyre on its own)
  const [openOlder, setOpenOlder] = useState<string | null>(null);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const removeOlder = (providerId: string): void => {
    void data.call("providers.remove", { providerId }).then(() => { setRemoved((r) => new Set([...r, providerId])); saved.saved("Removed"); }).catch((e: unknown) => saved.failed(e instanceof Error ? e.message : "That did not remove."));
  };
  const options: { value: string; label: string }[] = [];
  if (models.status === "ready") for (const m of models.data.models) if (m.allowed) options.push({ value: `${m.provider}/${m.model}`, label: m.title });
  const d = defaults.status === "ready" ? defaults.data : null;
  // the Default model is what a new chat starts on: the model the person last picked, else the Space default
  const last = useRead<CapMap["engine.last_pick.get"]["out"]>("engine.last_pick.get");
  const cur = defaultModelValue(last, d, options);
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
  if (noSpaceKey) {
    const note = statusNote(spaceAi);
    acc.push(<SettingsRow key="space-ai" id="account.space-ai" label={spaceAi.title} {...(note ? { sub: note } : {})} first />);
  }
  if (accounts.status === "ready") {
    const line = spaceKeyLine(accounts.data.accounts);
    if (line) acc.push(
      <SettingsRow
        key="space-key" id="account.space-key" label={line.label} sub={line.sub} first
        control={line.own ? <Value text="Working" /> : <SmallButton label="Add my own" testID="ctl-space-key-own" onPress={() => (openConnect ? void openConnect({ kind: "ai" }) : data.nav.openVault())} />}
      />,
    );
    accounts.data.accounts.filter((a) => a.spaceKey !== true).forEach((a, i) => {
      acc.push(
        <SettingsRow
          key={a.ref} id={`account.${a.ref}`} label={a.name ?? a.title} first={i === 0 && !line && !noSpaceKey} sub={`${a.kind === "subscription" ? "Sign-in" : "API key"}, ${a.mine ? "yours" : "shared in the Space"}`}
          control={<Value text={a.status === "ok" ? "Working" : a.status === "expired" ? "Sign in again" : a.status === "failed" ? "Failed" : "Not tested"} accent={a.status !== "ok"} />}
        />,
      );
      const older = (a.older ?? []).filter((o) => !removed.has(o.providerId));
      const quiet = olderLine(older.length);
      if (!quiet) return;
      const open = openOlder === a.ref;
      acc.push(
        <SettingsRow
          key={`${a.ref}-older`} id={`account.${a.ref}.older`} label={quiet} indent sub="Saved before Vyre could tell your accounts apart. They still work for chats that use them."
          onPress={() => setOpenOlder(open ? null : a.ref)} control={<Glyph name={open ? "chevD" : "chevR"} size={13} />}
        />,
      );
      if (open) for (const o of older) acc.push(
        <SettingsRow
          key={o.ref} id={`account.${o.ref}`} label={o.name} indent sub={o.ref}
          control={<SmallButton label="Remove" danger testID={`ctl-remove-older-${o.providerId}`} onPress={() => removeOlder(o.providerId)} />}
        />,
      );
    });
  }
  return (
    <>
      <Section>
        {options.length === 0 && models.status === "ready" ? (
          <SettingsRow id="model.none" first label="Add an AI account to choose a default model" sub="Models show up here once an AI account is connected." lead={<Glyph name="key" size={15} />}
            control={<SmallButton label="Add AI account" primary testID="ctl-add-ai" onPress={() => (openConnect ? void openConnect({ kind: "ai" }) : data.nav.openVault())} />} />
        ) : (
          <>
        <SettingsRow id="model.default" label="Default model" sub={last?.model ? "Your last pick. A new chat starts on it" : "A new chat starts on the model you pick"} help={ROW_HELP["model.default"]!} first found={found === "model.default"} control={<Choice value={cur} options={options} label="Default model" testID="ctl-model-default" onChange={(v) => setDefault(v, "model")} />} />
        <SettingsRow id="model.fallback" label="Backup model" sub="Used when the default is busy" help={ROW_HELP["model.fallback"]!} found={found === "model.fallback"} control={<Choice value={fb} options={options} label="Backup model" testID="ctl-model-fallback" onChange={(v) => setDefault(v, "fallback")} />} />
          </>
        )}
      </Section>
      <RegistrySections page="ai" rows={rows} found={found} />
      {use.length > 0 ? <Section title="You and your agents this month" testID="usage">{use}</Section> : null}
      <Section title="Your sign-ins" note="Each one is Working, or says why it is not. The model picker in a chat shows this same list.">
        {acc}
        <SettingsRow id="open-vault" label="Keys and sign-ins" sub="Add, replace or remove them. Manage in Vault" lead={<Glyph name="key" size={15} />} first={acc.length === 0} onPress={() => data.nav.openVault()} control={<Glyph name="chevR" size={13} />} />
      </Section>
      <VoiceRows found={found} />
    </>
  );
}

// ---------------------------------------------------------------- Connections

/** The apps and agents you let in. Every connection lives in Vault > Connections (owner ruling D28): this page shows how many and links there. Mail, calendars and numbers have their own page
 * (Email and calendar, MailPage.tsx), which is where Inbox comes from. */
/** Settings, Notes: what Vyre may do with your notes. For now one switch: whether an agent may offer to save something from a chat as a note. */
export function NotesSettingsPage({ rows, found }: PageProps): ReactElement {
  return <RegistrySections page="notes" rows={rows} found={found} />;
}

export function ConnectedPage({ rows, found }: PageProps): ReactElement {
  return (
    <>
      <ConnectionsLink />
      <OutsideAgents />
      <SignInApps />
      <RegistrySections page="connected" rows={rows} found={found} />
    </>
  );
}

/** The summary of Vault > Connections, with the one way there. */
function ConnectionsLink(): ReactElement {
  const data = useSettingsData();
  const sum = useConnectionsSummary(data.call, data.me.id);
  const open = (): void => (data.nav.openConnections ? data.nav.openConnections() : data.nav.openVault());
  return (
    <Section title="Connections" testID="settings-connections">
      <SettingsRow id="open-connections" label="Apps and tool servers" sub={sum.loaded ? `${sum.line}. Add, test, share and remove them in the Vault.` : "Add, test, share and remove them in the Vault."} lead={<Glyph name="link" size={15} />} first onPress={open} control={<SmallButton label="Open in Vault" onPress={open} testID="settings-open-connections" />} />
    </Section>
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
