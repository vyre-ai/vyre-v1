// ui/AccessSheet parts: the small pieces the sheet is built from. Colours are skin tokens (CSS variables on web), so a skin switch repaints with no re-render.
import { createElement, useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { ViewStyle } from "react-native";
import { Avatar } from "../Avatar/index.tsx";
import { SlotRow } from "../FolderTree/index.tsx";
import { MenuIcon, useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { Overlay } from "../Overlay/index.tsx";
import { Segmented } from "../Segmented/index.tsx";
import { TextField } from "../TextField/index.tsx";
import { Tooltip } from "../Tooltip/index.tsx";
import {
  ASSISTANT_NOTICE,
  accessView,
  generalSub,
  levelHint,
  redundantVia,
  HOW_OPTIONS,
  ITEM_DEFS,
  LINK_SUBJECT_ID,
  STYLE_OPTIONS,
  TOPICS_PLACEHOLDER,
  WHEN_OPTIONS,
  canCreateAgent,
  howOptions,
  levelName,
  canGiveLevel,
  levelsFor,
  pokeNote,
  removable,
  rowSub,
  shareInput,
  unshareInput,
} from "./model.ts";
import type { NewAgentDraft } from "./model.ts";
import type { AccessPick, AgentSettings, Audience, Exporters, LinkInfo, PickKind, RowFlag, ShareItemType, ShareLevel, ShareRow, ShareSheetProps, ShareSubjectKind } from "./props.ts";

const web = Platform.OS === "web";
export const webProps = (props: Record<string, unknown>): Record<string, unknown> => (web ? props : {});
const SHADOW = { boxShadow: "var(--sh-pop)" } as unknown as ViewStyle;
export const t = (name: string): string => `var(--${name})`;

/** Elements built in a loop: the sheet's lists are rows and tiles of its own (ui-rows lints a .map that returns markup). */
export function each<T>(list: readonly T[], make: (item: T, index: number) => ReactElement): ReactElement[] {
  const out: ReactElement[] = [];
  for (const [i, item] of list.entries()) out.push(make(item, i));
  return out;
}

/* ---------- icons ---------- */

const PATHS: Readonly<Record<string, string>> = {
  link: '<path d="M7 9a2.5 2.5 0 003.5 0l2-2a2.5 2.5 0 00-3.5-3.5l-.7.7M9 7a2.5 2.5 0 00-3.5 0l-2 2A2.5 2.5 0 007 12.5l.7-.7"/>',
  bot: '<rect x="3" y="5.5" width="10" height="7.5" rx="2"/><path d="M8 2.2v3.3M6 9v.6M10 9v.6"/><circle cx="8" cy="2" r=".7"/>',
  gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2"/>',
  mail: '<rect x="2" y="3.5" width="12" height="9" rx="2"/><path d="M2.8 5l5.2 4 5.2-4"/>',
  back: '<path d="M10 3.5L5.5 8l4.5 4.5"/>',
  point: '<path d="M9 1.8L4 9h3.5L7 14.2 12 7H8.5z"/>',
  people: '<circle cx="6" cy="6" r="2.3"/><path d="M2 13c.5-2.3 2.1-3.5 4-3.5s3.5 1.2 4 3.5"/><circle cx="11.5" cy="6.5" r="1.8"/><path d="M11.5 9.5c1.4 0 2.4.9 2.8 2.5"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.5a2.5 2.5 0 015 0V7"/>',
  term: '<rect x="2" y="3" width="12" height="10" rx="1.8"/><path d="M5 6.5l2 1.5-2 1.5M8.5 10H11"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  x: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  search: '<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/>',
  chev: '<path d="M4 6l4 4 4-4"/>',
};
const GLYPH: Readonly<Record<string, string>> = { bot: "◍", gear: "⚙", mail: "@", back: "‹", point: "⚡", people: "☖", lock: "•", term: ">_", plus: "+", x: "×", check: "✓", search: "⌕", chev: "▾" };

export function Icon({ name, size = 14, color = t("ink-3") }: { name: string; size?: number; color?: string }): ReactElement {
  if (!web) return <Text style={{ color, fontSize: size, lineHeight: size + 2 }}>{GLYPH[name] ?? ""}</Text>;
  const svg = `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ""}</svg>`;
  return createElement("span", { style: { display: "inline-flex", color }, "aria-hidden": true, dangerouslySetInnerHTML: { __html: svg } });
}

/* ---------- faces ---------- */

function Tile({ size, children, tint }: { size: number; children: ReactNode; tint?: string }): ReactElement {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint ?? t("sunk"), alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: t("line-2") }}>{children}</View>;
}

/** The one face for every kind of pick: a person's marble, an agent's face, the Assistant's V mark, a terminal for an outside agent, a mail tile for a guest, a letter for a new chat agent. */
export function Face({ kind, id, name, assistant, size = 28 }: { kind: PickKind; id: string; name: string; assistant?: boolean | undefined; size?: number }): ReactElement {
  if (kind === "person") return <Avatar name={name} seedId={id} size={size} />;
  if (kind === "agent") return <Avatar name={assistant === true ? "Assistant" : name} seedId={id} kind="agent" size={size} />;
  if (kind === "outside") return <Tile size={size}><Icon name="term" size={Math.round(size * 0.55)} color={t("ink-2")} /></Tile>;
  if (kind === "guest") return <Tile size={size}><Icon name="mail" size={Math.round(size * 0.55)} color={t("ink-2")} /></Tile>;
  if (kind === "new") return <Tile size={size}><Text style={{ color: t("ink-2"), fontSize: Math.round(size * 0.46), fontWeight: "600" }}>{(name.trim()[0] ?? "?").toUpperCase()}</Text></Tile>;
  return <Avatar name={name} seedId={id} kind="group" size={size} />;
}

/** The generic agents mark: for a line about agents as a whole, never one agent's own face. */
export function AgentsMark({ size = 28 }: { size?: number }): ReactElement {
  return <Tile size={size}><Icon name="bot" size={Math.round(size * 0.55)} color={t("ink-2")} /></Tile>;
}

/** A switch with no words beside it: the row says what it does. */
export function Toggle({ on, label, onChange, disabled, testID }: { on: boolean; label: string; onChange?(next: boolean): void; disabled?: boolean; testID?: string }): ReactElement {
  const off = disabled === true || onChange === undefined;
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: on, disabled: off }} aria-checked={on} disabled={off} testID={testID} onPress={() => onChange?.(!on)} style={[st.track, on && st.trackOn, off && st.off, { marginRight: 8 }]}>
      <View style={[st.knob, on && st.knobOn]} />
    </Pressable>
  );
}

/* ---------- controls ---------- */

export function Pill({ label, icon, onPress, testID, primary, disabled, hint }: { label: string; icon?: string; onPress(): void; testID?: string; primary?: boolean; disabled?: boolean; hint?: string }): ReactElement {
  const off = disabled === true;
  const node = (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: off }} disabled={off} testID={testID} onPress={onPress}
      style={({ hovered }: { hovered?: boolean }) => [st.pill, primary === true && st.pillPrimary, hovered === true && !off && (primary === true ? st.pillPrimaryHover : st.hover), off && st.off]}
    >
      {icon === undefined ? null : <Icon name={icon} size={13} color={primary === true ? t("accent-ink") : t("ink-2")} />}
      <Text style={[st.pillText, primary === true && st.pillTextPrimary]}>{label}</Text>
    </Pressable>
  );
  return hint === undefined ? node : <Tooltip text={hint}>{node}</Tooltip>;
}

export function PokeButton({ name, onPress, testID }: { name: string; onPress(): void; testID?: string }): ReactElement {
  return (
    <Tooltip text={`Start a turn for ${name} now`}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Poke ${name}`} testID={testID} onPress={onPress} style={({ hovered }: { hovered?: boolean }) => [st.poke, hovered === true && st.hover]}>
        <Icon name="point" size={12} color={t("ink-2")} />
        <Text style={st.pokeText}>Poke</Text>
      </Pressable>
    </Tooltip>
  );
}

export function IconButton({ icon, label, onPress, testID, size = 14 }: { icon: string; label: string; onPress(x: number, y: number): void; testID?: string; size?: number }): ReactElement {
  return (
    <Tooltip text={label}>
      <Pressable
        accessibilityRole="button" accessibilityLabel={label} testID={testID}
        onPress={(e: { nativeEvent?: { pageX?: number; pageY?: number } }) => onPress(e.nativeEvent?.pageX ?? 0, e.nativeEvent?.pageY ?? 0)}
        style={({ hovered }: { hovered?: boolean }) => [st.iconBtn, hovered === true && st.hover]}
      >
        <Icon name={icon} size={size} />
      </Pressable>
    </Tooltip>
  );
}

/** A value with a chevron that opens a menu. */
export function Picker({ label, value, disabled, onPress, testID }: { label: string; value: string; disabled?: boolean; onPress(x: number, y: number): void; testID?: string }): ReactElement {
  const off = disabled === true;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} accessibilityState={{ disabled: off }} disabled={off} testID={testID}
      onPress={(e: { nativeEvent?: { pageX?: number; pageY?: number } }) => onPress(e.nativeEvent?.pageX ?? 0, e.nativeEvent?.pageY ?? 0)}
      style={({ hovered }: { hovered?: boolean }) => [st.picker, hovered === true && !off && st.hover]}
    >
      <Text style={[st.pickerText, off && { color: t("ink-3") }]} numberOfLines={1}>{value}</Text>
      {off ? null : <Icon name="chev" size={11} />}
    </Pressable>
  );
}

export function Switch({ label, on, onChange, testID }: { label: string; on: boolean; onChange(next: boolean): void; testID?: string }): ReactElement {
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: on }} aria-checked={on} testID={testID} onPress={() => onChange(!on)} style={st.switchRow}>
      <View style={[st.track, on && st.trackOn]}><View style={[st.knob, on && st.knobOn]} /></View>
      <Text style={st.switchText}>{label}</Text>
    </Pressable>
  );
}

export function Notes({ lines }: { lines: readonly { id: string; tone: "plain" | "note" | "lock"; text: string }[] }): ReactElement {
  return (
    <View style={{ gap: 4 }}>
      {each(lines, (l) => (
        <View key={l.id} style={l.tone === "lock" ? st.lockRow : undefined} testID={`as-line-${l.id}`}>
          {l.tone === "lock" ? <Icon name="lock" size={13} color={t("ink-2")} /> : null}
          <Text style={[st.line, l.tone === "note" && { color: t("ink-3") }, l.tone === "lock" && { flex: 1 }]}>{l.text}</Text>
        </View>
      ))}
    </View>
  );
}

/* ---------- the settings popover: how and when an agent answers in a chat ---------- */

/** One question of the settings popover as a stacked list: a radio and a name for each option, and one line of what it does. */
function RadioList<T extends string>({ title, testID, value, options, onChange }: { title: string; testID: string; value: T; options: readonly { id: T; label: string; hint: string }[]; onChange(next: T): void }): ReactElement {
  return (
    <View style={{ gap: 2 }} testID={testID} accessibilityRole="radiogroup" accessibilityLabel={title}>
      <Text style={st.frLabel}>{title}</Text>
      {each(options, (o) => (
        <Pressable key={o.id} accessibilityRole="radio" accessibilityState={{ checked: o.id === value }} accessibilityLabel={o.label} testID={`${testID}-${o.id}`} onPress={() => onChange(o.id)} style={({ hovered }: { hovered?: boolean }) => [st.radioRow, hovered === true && st.hover]}>
          <View style={[st.radio, o.id === value && st.radioOn]}>{o.id === value ? <View style={st.radioDot} /> : null}</View>
          <View style={{ flex: 1, minWidth: 0 }}><Text style={st.name}>{o.label}</Text><Text style={st.sub}>{o.hint}</Text></View>
        </Pressable>
      ))}
    </View>
  );
}

/** The line under the topics box when the popover is closed while it is still empty. */
export const TOPICS_EMPTY = "Add a topic or pick another mode";

export function SettingsPopover({ name, face, value, outside, anchor, onChange, onPoke, onClose: close }: {
  name: string; face: ReactElement; value: AgentSettings; outside: boolean; anchor: { x: number; y: number };
  onChange(next: AgentSettings): void; onPoke?(): void; onClose(): void;
}): ReactElement {
  // "Only on topics" with the box empty is a draft while typing; closing the popover re-checks it. If it is still empty the line says so and the popover stays; a second close leaves anyway, the agent answers as Always until a topic is written.
  const [asked, setAsked] = useState(false);
  const empty = value.when === "topics" && value.topics.trim() === "";
  const onClose = (): void => { if (empty && !asked) { setAsked(true); return; } close(); };
  const win = useWindowDimensions();
  const phone = win.width > 0 && win.width < 640;
  const set = (patch: Partial<AgentSettings>): void => onChange({ ...value, ...patch });
  const left = Math.max(8, Math.min(anchor.x - 372, (win.width || 1024) - 392));
  const top = Math.max(8, Math.min(anchor.y + 6, (win.height || 768) - 440));
  const place = phone ? st.popPhone : ({ position: "fixed", left, top, width: 380 } as unknown as ViewStyle);
  return (
    <Overlay>
      <View style={st.popLayer}>
        <Pressable accessibilityLabel="Close" accessible={false} onPress={onClose} testID="as-pop-scrim" style={StyleSheet.absoluteFill} />
        <View role="dialog" aria-modal={false} accessibilityLabel={`How ${name} responds`} testID="as-pop" style={[st.pop, SHADOW, place]}>
          <View style={st.popHead}>
            {face}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.name} numberOfLines={1}>{name}</Text>
              <Text style={st.sub}>How and when it responds</Text>
            </View>
            <IconButton icon="x" label="Close" onPress={onClose} testID="as-pop-x" />
          </View>
          <ScrollView style={{ maxHeight: Math.max(220, (win.height || 768) - 230) }} contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
            <RadioList title="How" testID="as-how" value={value.how} options={howOptions(outside)} onChange={(how) => set({ how })} />
            <RadioList title="When" testID="as-when" value={value.when} options={WHEN_OPTIONS} onChange={(when) => set({ when })} />
            {value.when === "topics" ? (
              <View style={{ paddingLeft: 26 }}>
                <TextField accessibilityLabel="Topics" testID="as-topics" placeholder={TOPICS_PLACEHOLDER} value={value.topics} onChangeText={(topics) => { setAsked(false); set({ topics }); }} />
                {empty && asked ? <Text style={[st.note, { color: t("danger") }]} accessibilityLiveRegion="polite" testID="as-topics-empty">{TOPICS_EMPTY}</Text> : null}
              </View>
            ) : null}
            {value.when === "hours" ? (
              <View style={{ paddingLeft: 26, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <TextField accessibilityLabel="From" testID="as-from" placeholder="09:00" value={value.hoursFrom} onChangeText={(hoursFrom) => set({ hoursFrom })} style={st.time} />
                <Text style={st.sub}>to</Text>
                <TextField accessibilityLabel="To" testID="as-to" placeholder="17:00" value={value.hoursTo} onChangeText={(hoursTo) => set({ hoursTo })} style={st.time} />
              </View>
            ) : null}
            <RadioList title="Style" testID="as-style" value={value.style} options={STYLE_OPTIONS} onChange={(style) => set({ style })} />
          </ScrollView>
          {onPoke === undefined ? null : <Text style={st.note} testID="as-pop-poke-note">{pokeNote(name)}</Text>}
          <View style={st.popFoot}>
            {onPoke === undefined ? null : <Pill label="Poke" icon="point" testID="as-pop-poke" onPress={onPoke} />}
            <Pill label="Done" primary testID="as-pop-done" onPress={onClose} />
          </View>
        </View>
      </View>
    </Overlay>
  );
}

/* ---------- the New agent view ---------- */

export function NewAgentView({ noun, own, title, draft, models, onDraft, onPickModel, onCreate, onBack, onClose }: {
  noun: string; own: string; title: string; draft: NewAgentDraft; models: readonly string[];
  onDraft(next: NewAgentDraft): void; onPickModel(x: number, y: number): void; onCreate(): void; onBack(): void; onClose(): void;
}): ReactElement {
  const ok = canCreateAgent(draft);
  return (
    <>
      <ViewHead title={`New agent for ${noun}`} sub={`in ${title}`} onBack={onBack} onClose={onClose} />
      <View style={st.form} testID="as-new-view">
        <View style={st.preview}>
          <Face kind="new" id="preview" name={draft.name === "" ? "?" : draft.name} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.name} numberOfLines={1}>{draft.name === "" ? "Name your agent" : draft.name}</Text>
            <Text style={st.sub} numberOfLines={1}>{draft.brief === "" ? "What it is for shows here" : draft.brief}</Text>
          </View>
        </View>
        <View style={{ gap: 4 }}><Text style={st.flabel}>Name</Text><TextField accessibilityLabel="Name" testID="as-name" autoFocus placeholder="Checker" value={draft.name} onChangeText={(name) => onDraft({ ...draft, name })} onSubmitEditing={() => { if (ok) onCreate(); }} /></View>
        <View style={{ gap: 4 }}><Text style={st.flabel}>Use me for</Text><TextField accessibilityLabel="Use me for" testID="as-brief" placeholder="Checks every upload against the spec" value={draft.brief} onChangeText={(brief) => onDraft({ ...draft, brief })} onSubmitEditing={() => { if (ok) onCreate(); }} /><Text style={st.sub}>One line. The agent reads it as its brief.</Text></View>
        <View style={{ gap: 4 }}><Text style={st.flabel}>Model</Text><View style={{ alignItems: "flex-start" }}><Picker label="Model" value={draft.model} testID="as-model" onPress={onPickModel} disabled={models.length < 2} /></View></View>
        <Text style={st.note}>{`It belongs to ${own}. When ${own} goes, it goes too, like a teammate. Nobody else in the Space gets it.`}</Text>
      </View>
      <Foot><Pill label="Back" testID="as-back2" onPress={onBack} /><Pill label="Create and pick" primary disabled={!ok} testID="as-create" onPress={onCreate} /></Foot>
    </>
  );
}

/* ---------- the Link an outside agent view ---------- */

export function LinkView({ link, copied, onCopy, onBack, onClose, ownerName }: { link: LinkInfo | undefined; copied: boolean; onCopy(): void; onBack(): void; onClose(): void; ownerName: string }): ReactElement {
  const connected = link?.connected;
  const step = (n: number, title: string, body: ReactNode): ReactElement => (
    <View style={st.step}>
      <View style={st.num}><Text style={st.numText}>{n}</Text></View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text style={st.name}>{title}</Text>{body}</View>
    </View>
  );
  return (
    <>
      <ViewHead title="Link an outside agent" sub="Claude Code, Codex or any agent that speaks MCP" onBack={onBack} onClose={onClose} />
      <View style={st.form} testID="as-link-view">
        {step(1, "Open the agent you use", <Text style={st.sub}>On this Mac or on a server. It stays yours.</Text>)}
        {step(2, "Run this once in its terminal", (
          <View style={st.code}>
            <Text style={st.codeText} selectable testID="as-command">{link?.command ?? ""}</Text>
            <Pill label={copied ? "Copied" : "Copy"} testID="as-copy" onPress={onCopy} />
          </View>
        ))}
        {step(3, "Allow it in Vyre", (
          <>
            <Text style={st.sub}>A request appears here. Allow it only if you just connected the agent yourself.</Text>
            {connected === undefined
              ? <Text style={st.wait} testID="as-waiting">Waiting for a connection...</Text>
              : <View style={st.okRow} testID="as-connected"><Icon name="check" size={13} color={t("ok")} /><Text style={st.okText}>{`${connected} connected. Pick it from the list.`}</Text></View>}
          </>
        ))}
        <Text style={st.note}>{`Once linked, it reads and posts only in the chats and folders you add it to, as ${ownerName} (Agent). Everything it does is audited. You can remove it at any time.`}</Text>
      </View>
      <Foot><Pill label={connected === undefined ? "Back" : "Back to the list"} primary={connected !== undefined} testID="as-back2" onPress={onBack} /></Foot>
    </>
  );
}

/* ---------- head and foot ---------- */

export function ViewHead({ title, sub, onBack, onClose }: { title: string; sub?: string; onBack?: () => void; onClose(): void }): ReactElement {
  return (
    <View style={st.head}>
      {onBack === undefined ? null : <IconButton icon="back" label="Back" testID="as-back" size={14} onPress={onBack} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text accessibilityRole="header" style={st.title} numberOfLines={1} testID="as-title">{title}</Text>
        {sub === undefined ? null : <Text style={st.sub} numberOfLines={1}>{sub}</Text>}
      </View>
      <IconButton icon="x" label="Close" testID="as-close" onPress={onClose} />
    </View>
  );
}

export function Foot({ children }: { children: ReactNode }): ReactElement {
  return <View style={st.foot}>{children}</View>;
}

/** The notice for a person's own Assistant: it cannot be shared. */
export function AssistantNotice({ onClose, onNewAgent }: { onClose(): void; onNewAgent?: (() => void) | undefined }): ReactElement {
  return (
    <>
      <ViewHead title="Share Assistant" sub="Your own agent" onClose={onClose} />
      <View style={st.form} testID="as-assistant">
        <View style={st.preview}>
          <Face kind="agent" id="assistant" name="Assistant" assistant size={44} />
          <View style={{ flex: 1 }}><Text style={st.name}>Assistant</Text><Text style={st.sub}>Yours, private to you</Text></View>
        </View>
        {each(ASSISTANT_NOTICE, (s) => <Text key={s} style={[st.note, { fontSize: 13.5, lineHeight: 20 }]}>{s}</Text>)}
      </View>
      <Foot><Pill label="Close" testID="as-close2" onPress={onClose} />{onNewAgent === undefined ? null : <Pill label="New agent" primary testID="as-newagent" onPress={onNewAgent} />}</Foot>
    </>
  );
}

/* ---------- Who has access (ported from the old share sheet) ---------- */

export const RECORD_LEVEL_NAMES: Readonly<Partial<Record<ShareLevel, string>>> = { view: "Can view", edit: "Can edit", manage: "Full access" };
export const AUDIENCES: readonly { id: Audience; label: string; short: string; hint: string }[] = [
  { id: "space", label: "Everyone in the Space", short: "Everyone", hint: "Everyone in the Space can see it, as their role allows. People added below get more." },
  { id: "added", label: "Only people added", short: "People added", hint: "Only the people added below, and admins." },
  { id: "me", label: "Only me", short: "Only me", hint: "Nobody else, until you add them." },
];
export const EXPORTERS: readonly { id: Exporters; label: string }[] = [
  { id: "admins", label: "Admins only" },
  { id: "viewers", label: "Anyone who can view" },
  { id: "chosen", label: "Chosen people" },
];

function SubjectFace({ row }: { row: Pick<ShareRow, "subjectKind" | "subjectId" | "name"> }): ReactElement {
  const k = row.subjectKind;
  if (k === "link") return <Tile size={28}><Text style={{ color: t("ink-2"), fontSize: 14, fontWeight: "600" }}>{"↗"}</Text></Tile>;
  return <Face kind={k === "group" || k === "role" ? "group" : k === "agent" ? "agent" : "person"} id={row.subjectId} name={row.name} size={28} />;
}

function FlagPill({ label, hint, on, locked, disabled, onChange, testID }: { label: string; hint: string; on: boolean; locked?: boolean; disabled?: boolean; onChange(next: boolean): void; testID: string }): ReactElement {
  const off = disabled === true || locked === true;
  return (
    <Tooltip text={hint}>
      <Pressable
        accessibilityRole="switch" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ checked: on, disabled: off }} aria-checked={on} disabled={off} testID={testID}
        onPress={() => onChange(!on)}
        style={({ hovered }: { hovered?: boolean }) => [st.flag, on && st.flagOn, off && st.off, hovered === true && !off && st.hover]}
      >
        {on ? <MenuIcon icon="check" size={11} color="var(--accent)" /> : null}
        <Text style={[st.flagText, on && { color: t("accent") }]}>{label}</Text>
      </Pressable>
    </Tooltip>
  );
}

export const ONLY_ADDED = "Only people added";

export function AccessList({ p, offered, cleared, onCleared }: { p: ShareSheetProps; offered: readonly ShareLevel[] | undefined; cleared: readonly string[]; onCleared(key: string): void }): ReactElement {
  const menu = useMenu();
  const rec = p.records;
  // a person gives no more than they have: a level above their own is not in the menu (the row keeps the one it has)
  const levelsOf = (row: Pick<ShareRow, "subjectKind" | "level" | "via">, t: ShareItemType, offered: readonly ShareLevel[] | undefined): ShareLevel[] => levelsFor(row, t, offered).filter((l) => l === row.level || canGiveLevel(t, l, { maxLevel: p.maxLevel, canGive: p.canGive }));
  const type = p.itemType;
  const [apart, setApart] = useState(false);
  const [ask, setAsk] = useState<{ kind: "self" | "owner"; row: ShareRow } | null>(null);
  const shares = p.shares.filter((r) => !cleared.includes(`${r.subjectKind}:${r.subjectId}`));
  const v = accessView({ shares, itemType: type, resourceId: p.resourceId, ownerId: p.ownerId, ownerName: p.ownerName, folderName: p.folderName, agentsOn: p.agentsOn });
  const { link } = v;
  const lname = (l: ShareLevel): string => levelName(type, l);
  const say = (kind: ShareSubjectKind, id: string, level: ShareLevel): void => p.onShare?.(shareInput(p, { kind, id }, level, p.newKey?.()));
  const remove = (row: ShareRow): void => {
    onCleared(`${row.subjectKind}:${row.subjectId}`);
    p.onUnshare?.(unshareInput(p, { kind: row.subjectKind, id: row.subjectId }));
  };
  // removing yourself says what you lose and asks first
  const askRemove = (row: ShareRow): void => { if (row.subjectKind === "person" && p.meId !== undefined && row.subjectId === p.meId) setAsk({ kind: "self", row }); else remove(row); };
  const mayMakeOwner = (row: ShareRow): boolean => p.onMakeOwner !== undefined && p.meId !== undefined && p.meId === p.ownerId && row.subjectKind === "person" && row.subjectId !== p.ownerId && row.via === "grant";
  const tailItems = (row: ShareRow): MenuEntry[] => {
    const out: MenuEntry[] = [];
    if (mayMakeOwner(row)) out.push({ separator: true }, { label: "Make owner", hint: "They become the owner. You become a manager.", onSelect: () => setAsk({ kind: "owner", row }) });
    if (removable(row)) out.push({ separator: true }, { label: "Remove access", danger: true, onSelect: () => askRemove(row) });
    return out;
  };
  const pickLevel = (row: ShareRow, x: number, y: number): void => {
    const items: MenuEntry[] = levelsOf(row, type, offered).map((l) => ({ label: lname(l), hint: levelHint(type, l), checked: l === row.level, onSelect: () => say(row.subjectKind, row.subjectId, l) }));
    items.push(...tailItems(row));
    menu.show(items, x, y, "context", { label: `Access for ${row.name}` });
  };
  const rowMenu = (row: ShareRow, x: number, y: number): void => {
    const items: MenuEntry[] = [];
    if (levelsOf(row, type, offered).length > 1) for (const l of levelsOf(row, type, offered)) items.push({ label: lname(l), hint: levelHint(type, l), checked: l === row.level, onSelect: () => say(row.subjectKind, row.subjectId, l) });
    items.push(...tailItems(row));
    if (items.length === 0) items.push({ label: "Copy Name", onSelect: () => void (globalThis as { navigator?: { clipboard?: { writeText(s: string): Promise<void> } } }).navigator?.clipboard?.writeText(row.name) });
    menu.show(items, x, y, "context", { label: `Access for ${row.name}` });
  };
  const rowNode = (row: ShareRow): ReactElement => {
    const inheritedRow = row.via !== "grant";
    const can = levelsOf(row, type, offered).length > 1;
    const trail = (
      <View style={st.trail}>
        <Picker label={`Level for ${row.name}`} value={lname(row.level)} disabled={!can || (rec !== undefined && !rec.canChange)} testID={`as-acc-level-${row.subjectId}`} onPress={(x, y) => pickLevel(row, x, y)} />
        {removable(row)
          ? <IconButton icon="x" label={`Remove ${row.name}`} testID={`as-acc-remove-${row.subjectId}`} size={12} onPress={() => askRemove(row)} />
          : <View style={st.iconBtn} />}
      </View>
    );
    const slot = (
      <View key={`${row.subjectKind}:${row.subjectId}:${inheritedRow ? "i" : "d"}`} style={st.plain}>
      <SlotRow
        id={`as-acc-${row.subjectId}`} title={row.name} note={rec ? (inheritedRow ? `From ${p.folderName ?? "its type"}` : rowSub({ ...row, via: "grant" })) : row.subjectKind === "person" && row.via === "grant" && redundantVia(type, v.general.level, row.level, p.spaceName ?? "the Space") !== null ? (redundantVia(type, v.general.level, row.level, p.spaceName ?? "the Space") as string) : rowSub(row, p.folderName)}
        leadWidth={36} lead={<SubjectFace row={row} />} trail={trail} onMenu={(x, y) => rowMenu(row, x, y)}
      />
      </View>
    );
    if (!rec || inheritedRow || row.subjectKind === "link") return slot;
    const everyone = rec.exporters === "viewers";
    return (
      <View key={`${row.subjectKind}:${row.subjectId}:flags`}>
        {slot}
        <View style={st.flags}>
          <FlagPill label="Can export" hint={everyone ? "Everyone who can view may export. Change it under More." : "Download these records as a file"} on={row.canExport === true || everyone} locked={everyone} disabled={!rec.canChange} testID={`as-export-${row.subjectId}`} onChange={(on) => rec.onFlag(row, "export", on)} />
          <FlagPill label="Can share with others" hint="Add people, up to their own access" on={row.canShare === true} disabled={!rec.canChange} testID={`as-reshare-${row.subjectId}`} onChange={(on) => rec.onFlag(row, "reshare", on)} />
        </View>
      </View>
    );
  };
  const levels = levelsOf({ subjectKind: "group", level: "view", via: "grant" }, type, offered);
  const generalRow = v.general.row;
  const generalSubject = { kind: "group" as const, id: generalRow?.subjectId ?? p.directory.space?.subject?.id ?? "grp_everyone" };
  const generalLevels = generalRow ? levelsOf(generalRow, type, offered) : levels;
  const pickGeneral = (x: number, y: number): void => {
    const items: MenuEntry[] = [];
    if (generalRow === null || removable(generalRow)) items.push({ label: ONLY_ADDED, hint: "Only the people added below can open it.", checked: v.general.level === null, onSelect: () => { if (generalRow) remove(generalRow); } });
    for (const l of generalLevels) items.push({ label: lname(l), hint: levelHint(type, l), checked: l === v.general.level, onSelect: () => say(generalSubject.kind, generalSubject.id, l) });
    menu.show(items, x, y, "context", { label: "General access" });
  };
  const spaceName = p.spaceName ?? "the Space";
  const generalLocked = (generalRow !== null && generalRow.via !== "grant" && generalLevels.length <= 1) || (rec !== undefined && !rec.canChange);
  return (
    <View testID="as-access">
      {rec ? (
        <View style={{ gap: 8, paddingHorizontal: 6, paddingBottom: 6 }} testID="as-audience">
          <Text style={st.sect}>Who can see this</Text>
          {rec.follows !== undefined && rec.audience === "space" && !apart ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }} testID="as-inherits">
              <Text style={st.sub}>{`Follows ${rec.follows}`}</Text>
              {rec.canChange ? <Pill label="Change for this record only" testID="as-override" onPress={() => setApart(true)} /> : null}
            </View>
          ) : (
            <Segmented
              label="Who can see this" testID="as-audience-pick" value={rec.audience}
              options={AUDIENCES.map((a) => (a.id === "space" && rec.follows !== undefined ? { id: a.id, label: `Follows ${rec.follows}`, hint: `Back to the same people as ${rec.follows}` } : { id: a.id, label: a.label, hint: a.hint }))}
              onChange={(next) => { if (rec.canChange) rec.onAudience(next); }}
            />
          )}
        </View>
      ) : (
        <View testID="as-general">
          <Text style={st.sect}>General access</Text>
          <SlotRow
            id="as-acc-space" title={`Everyone in ${spaceName}`} note={generalRow && generalRow.via !== "grant" ? v.inheritedFrom : generalSub(type, v.general.level, spaceName, p.itemName)} leadWidth={36} lead={<Face kind="group" id="space" name="Everyone" size={28} />}
            trail={<View style={st.trail}><Picker label="General access" value={v.general.level ? lname(v.general.level) : ONLY_ADDED} disabled={generalLocked} testID="as-acc-level-space" onPress={pickGeneral} /></View>}
          />
        </View>
      )}
      {ask ? (
        <View style={st.confirmBar} testID="as-confirm">
          <Text style={st.line}>{ask.kind === "self" ? `Remove yourself from “${p.itemName}”? You will lose access to it.` : `Make ${ask.row.name} the owner of “${p.itemName}”? You'll become a manager.`}</Text>
          <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
            <Pill label="Cancel" testID="as-confirm-no" onPress={() => setAsk(null)} />
            <Pill label={ask.kind === "self" ? "Remove me" : "Make owner"} primary testID="as-confirm-yes" onPress={() => { const a = ask; setAsk(null); if (a.kind === "self") remove(a.row); else p.onMakeOwner?.({ kind: a.row.subjectKind, id: a.row.subjectId }); }} />
          </View>
        </View>
      ) : null}
      <View style={st.listHead}><Text style={st.listHeadText}>People</Text><Text style={st.listHeadText} testID="as-count">{1 + v.people.length}</Text></View>
      <View style={st.plain}><SlotRow id="as-acc-owner" title={p.ownerName} leadWidth={36} lead={<Face kind="person" id={p.ownerId ?? p.ownerName} name={p.ownerName} size={28} />} trail={<Text style={st.ownerText}>Owner</Text>} /></View>
      {rec && rec.audience === "space" && rec.follows === undefined ? <SlotRow id="as-acc-space-rec" title="Everyone in the Space" note="As their role allows" leadWidth={36} lead={<Face kind="group" id="space" name="Everyone" size={28} />} trail={<Text style={st.ownerText}>Their role</Text>} /> : null}
      {rec && rec.audience === "added" ? <SlotRow id="as-acc-admins" title="Admins" note="Always" leadWidth={36} lead={<Face kind="group" id="admins" name="Admins" size={28} />} trail={<Text style={st.ownerText}>{lname("manage")}</Text>} /> : null}
      {v.people.map((r) => rowNode(r))}
      {v.empty && !rec ? <Text style={st.empty} testID="as-nobody">Nobody else yet.</Text> : null}
      {rec || type !== "agent" ? null : (
        <View testID="as-agents">
          <Text style={st.sect}>Agents</Text>
          <SlotRow
            id="as-acc-agents" title={`Let other agents ask ${p.itemName} for help`} note={`They can hand work to ${p.itemName} in their own chats`} leadWidth={36} lead={<AgentsMark />}
            trail={<Toggle on={v.agents.on} label={`Let other agents ask ${p.itemName} for help`} testID="as-agents-toggle" {...(p.onAgents ? { onChange: p.onAgents } : {})} />}
          />
          {v.agents.specific.map((r) => rowNode(r))}
        </View>
      )}
      {p.allowExternal === true && !rec ? (
        <View>
          <Text style={[st.sect, { marginTop: 12 }]}>Link</Text>
          <SlotRow
            id="as-acc-link" title={link ? "Anyone with the link" : "No link"} note={link ? "Can view. Outside the Space." : "Make a view-only link for someone outside the Space"}
            leadWidth={36} lead={<SubjectFace row={{ subjectKind: "link", subjectId: LINK_SUBJECT_ID, name: "Link" }} />}
            trail={(
              <View style={st.trail}>
                {link && p.onCopyLink ? <Pill label="Copy link" testID="as-copy-link" onPress={p.onCopyLink} /> : null}
                <Pill label={link ? "Remove" : "Create link"} testID="as-link-toggle" onPress={() => (link ? remove(link) : say("link", LINK_SUBJECT_ID, "view"))} />
              </View>
            )}
          />
        </View>
      ) : null}
      {(p.sees ?? []).length > 0 ? (
        <View>
          <Text style={[st.sect, { marginTop: 12 }]}>Who sees this</Text>
          <View style={st.sees}>
            {each(p.sees ?? [], (s, i) => <View key={`${s.name}:${i}`} style={st.see}><Text style={st.seeName}>{s.name}</Text><Text style={st.sub}>{s.via}</Text><Text style={st.seeLevel}>{s.level}</Text></View>)}
          </View>
        </View>
      ) : null}
      {menu.element}
    </View>
  );
}

/** Records: who may export, and links outside the Space. Sits in the footer. */
export function ExportMore({ rec }: { rec: NonNullable<ShareSheetProps["records"]> }): ReactElement | null {
  const menu = useMenu();
  if (rec.exporters === undefined || !rec.onExporters) return null;
  return (
    <View>
      <Pill
        label={`Export: ${EXPORTERS.find((x) => x.id === rec.exporters)?.label ?? ""}`} icon="plus" testID="as-more"
        onPress={() => menu.show(
          [{ head: "Who can export" }, ...EXPORTERS.map((x): MenuEntry => ({ label: x.label, checked: x.id === rec.exporters, ...(rec.canChange ? { onSelect: () => rec.onExporters?.(x.id) } : {}) })), ...(rec.onOutside ? [{ separator: true } as MenuEntry, { label: "Allow sharing outside the Space", checked: rec.outside === true, ...(rec.canChange ? { onSelect: () => rec.onOutside?.(rec.outside !== true) } : {}) } as MenuEntry] : [])],
          0, 0, "other", { label: "Who can export" })}
      />
      {menu.element}
    </View>
  );
}

/** Clears a "Copied" label after a moment. */
export function useCopied(): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(id);
  }, [copied]);
  return [copied, () => setCopied(true)];
}

export const itemLabelOf = (type: keyof typeof ITEM_DEFS, label?: string): string => label ?? ITEM_DEFS[type].label;
export const pickHowLabel = (p: AccessPick): string => HOW_OPTIONS.find((h) => h.id === (p.settings?.how ?? "tag"))?.label ?? "";

/* ---------- styles ---------- */

export const st = StyleSheet.create({
  refusal: { color: t("danger"), fontSize: 12.5, lineHeight: 18 },
  message: { height: 34, borderRadius: 9, paddingHorizontal: 10, backgroundColor: t("sunk"), color: t("ink"), fontSize: 13, ...(web ? ({ outlineStyle: "none" } as object) : null) },
  confirmBar: { gap: 8, padding: 10, marginHorizontal: 6, marginVertical: 4, borderRadius: 10, backgroundColor: t("sunk") },
  plain: { paddingVertical: 4 },
  hover: { backgroundColor: t("hover") },
  radioRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 5, paddingHorizontal: 6, borderRadius: 8 },
  radio: { width: 16, height: 16, marginTop: 2, borderRadius: 8, borderWidth: 1.5, borderColor: t("line-2"), alignItems: "center", justifyContent: "center" },
  radioOn: { borderColor: t("accent") },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t("accent") },
  off: { opacity: 0.45 },
  veil: { position: (web ? "fixed" : "absolute") as unknown as "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99998, backgroundColor: "rgba(8,8,10,0.5)", alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  veilPhone: { paddingHorizontal: 0, alignItems: "stretch", justifyContent: "flex-end" },
  card: { width: "100%", maxWidth: 560, maxHeight: "90%", backgroundColor: t("raised"), borderRadius: 18, overflow: "hidden", color: t("ink") } as never,
  cardPhone: { maxWidth: "100%", maxHeight: "92%", borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingTop: 16, paddingLeft: 18, paddingRight: 14, paddingBottom: 6 },
  title: { color: t("ink"), fontSize: 17, lineHeight: 23, fontWeight: "600" },
  sub: { color: t("ink-3"), fontSize: 12.5, lineHeight: 17 },
  name: { color: t("ink"), fontSize: 13.5, lineHeight: 19 },
  iconBtn: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  searchBox: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginHorizontal: 16, marginTop: 6, marginBottom: 4, paddingVertical: 6, paddingHorizontal: 10, minHeight: 40, borderRadius: 12, backgroundColor: t("sunk") },
  searchIn: { flexGrow: 1, flexBasis: 120, minWidth: 120, height: 24, color: t("ink"), fontSize: 14, padding: 0, ...(web ? ({ outlineStyle: "none" } as object) : null) },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 26, paddingLeft: 4, paddingRight: 4, borderRadius: 13, backgroundColor: t("raised"), borderWidth: 1, borderColor: t("line-2") },
  chipText: { color: t("ink"), fontSize: 12.5 },
  makers: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 2 },
  body: { flexGrow: 1, flexShrink: 1, minHeight: 120, paddingHorizontal: 10, paddingBottom: 8 },
  sect: { color: t("ink-4"), fontSize: 11.5, paddingHorizontal: 6, paddingTop: 12, paddingBottom: 4 },
  sectRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 10, paddingTop: 12, paddingBottom: 4 },
  sectText: { color: t("ink-4"), fontSize: 11.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10 },
  rowMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 },
  rowText: { flex: 1, minWidth: 0 },
  plusBox: { width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  empty: { color: t("ink-3"), fontSize: 13, paddingVertical: 8, paddingHorizontal: 10 },
  pick: { paddingVertical: 4, paddingHorizontal: 10 },
  pickTop: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, minHeight: 44 },
  pickCtl: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  pickCtlPhone: { width: "100%", paddingLeft: 38 },
  summary: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 38, paddingBottom: 4 },
  summaryText: { color: t("ink-3"), fontSize: 12 },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, height: 28, paddingHorizontal: 11, borderRadius: 14, borderWidth: 1, borderColor: t("line-2") },
  pillPrimary: { backgroundColor: t("accent"), borderColor: t("accent") },
  pillPrimaryHover: { opacity: 0.9 },
  pillText: { color: t("ink-2"), fontSize: 12.5, fontWeight: "500" },
  pillTextPrimary: { color: t("accent-ink"), fontWeight: "600" },
  poke: { flexDirection: "row", alignItems: "center", gap: 4, height: 26, paddingHorizontal: 9, borderRadius: 13, borderWidth: 1, borderColor: t("line-2") },
  pokeText: { color: t("ink-2"), fontSize: 12 },
  picker: { flexDirection: "row", alignItems: "center", gap: 5, height: 28, paddingLeft: 10, paddingRight: 8, borderRadius: 8, borderWidth: 1, borderColor: t("line-2"), maxWidth: 230 },
  pickerText: { color: t("ink"), fontSize: 13 },
  trail: { flexDirection: "row", alignItems: "center", gap: 2, paddingRight: 6 },
  ownerText: { color: t("ink-3"), fontSize: 12.5, paddingRight: 12 },
  listHead: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 10, paddingTop: 10, paddingBottom: 4 },
  listHeadText: { color: t("ink-4"), fontSize: 11.5 },
  flags: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingLeft: 46, paddingBottom: 6 },
  flag: { flexDirection: "row", alignItems: "center", gap: 4, height: 24, paddingHorizontal: 9, borderRadius: 12, borderWidth: 1, borderColor: t("line") },
  flagOn: { borderColor: t("accent"), backgroundColor: t("accent-wash") },
  flagText: { color: t("ink-2"), fontSize: 12 },
  sees: { borderRadius: 10, paddingVertical: 4, paddingHorizontal: 10, borderWidth: 1, borderColor: t("line") },
  see: { flexDirection: "row", alignItems: "center", minHeight: 30, gap: 9 },
  seeName: { flex: 1, color: t("ink"), fontSize: 13 },
  seeLevel: { width: 52, textAlign: "right", color: t("ink"), fontSize: 12.5, fontWeight: "500" },
  foot: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: t("line") },
  footTop: { gap: 8, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: t("line") },
  footBtns: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingTop: 4, paddingBottom: 12 },
  line: { color: t("ink-2"), fontSize: 12.5, lineHeight: 18 },
  lockRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  note: { color: t("ink-3"), fontSize: 12.5, lineHeight: 18 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start" },
  switchText: { color: t("ink-2"), fontSize: 12.5 },
  track: { width: 30, height: 18, borderRadius: 9, backgroundColor: t("line-2"), justifyContent: "center", paddingHorizontal: 2 },
  trackOn: { backgroundColor: t("accent") },
  knob: { width: 14, height: 14, borderRadius: 7, backgroundColor: t("raised") },
  knobOn: { alignSelf: "flex-end" },
  popLayer: { position: (web ? "fixed" : "absolute") as unknown as "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999 },
  pop: { gap: 10, padding: 14, borderRadius: 14, backgroundColor: t("raised"), borderWidth: 1, borderColor: t("line-2") },
  popPhone: { position: "absolute", left: 0, right: 0, bottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  popHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  popFoot: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  fr: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  frLabel: { width: 44, paddingTop: 6, color: t("ink-3"), fontSize: 12.5 },
  frBody: { flex: 1, minWidth: 0 },
  time: { width: 76, height: 32, textAlign: "center" },
  form: { gap: 12, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12 },
  preview: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: 12, backgroundColor: t("sunk") },
  flabel: { color: t("ink-2"), fontSize: 12.5, fontWeight: "600" },
  step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  num: { width: 22, height: 22, borderRadius: 11, backgroundColor: t("sunk"), alignItems: "center", justifyContent: "center" },
  numText: { color: t("ink-2"), fontSize: 12, fontWeight: "600" },
  code: { flexDirection: "row", alignItems: "center", gap: 8, padding: 8, borderRadius: 10, backgroundColor: t("sunk") },
  codeText: { flex: 1, minWidth: 0, color: t("ink"), fontSize: 12, ...(web ? ({ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", wordBreak: "break-all" } as object) : null) },
  wait: { color: t("ink-3"), fontSize: 12.5 },
  okRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  okText: { color: t("ink"), fontSize: 12.5 },
});
