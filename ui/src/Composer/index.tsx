// ui/Composer: the one composer for Chats, threads, Ask panes, inbox email and text, record comments and task threads (spec 4.6, 3.2, 3.3).
// Symbols (spec 3.0): @ people and agents; # things, grouped Folders, Channels, Records, Files (a folder becomes a chip that sets the thread's folder);
// / commands, skills, templates and snippets; [[ links a record. The line under the field says who will answer, computed by lib/route.ts so it can
// never disagree with the engine. Sending is optimistic: the field clears and onSend runs in the same call, before any server answer.
// Colours are skin tokens (CSS variables on web), so a skin switch repaints with no re-render.
// The suggestion matcher is ported from vyre 0.6.9 core/suggest/match.js@07cb32abd with real types.

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import { route } from "../../../lib/route.ts";
import type { RouteMessage, RouteThread } from "../../../lib/route.ts";
import { MenuIcon, menuTrigger, useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { Row } from "../Row/index.tsx";
import { composerSymbols, symbolMark } from "./props.ts";
import type { ComposerAttachment, ComposerChip, ComposerShellProps, ComposerSymbol } from "./props.ts";

export type { ComposerAttachment, ComposerChip, ComposerShellProps, ComposerSymbol } from "./props.ts";
export { COMPOSER_SYMBOLS, composerSymbols, symbolMark } from "./props.ts";

/* ---------- matcher (from core/suggest/match.js) ---------- */

export const EXACT = 5;
export const PREFIX = 4;
export const WORD = 3;
export const INSIDE = 1;
export const SPREAD = 0.5;

export interface Prepared {
  lower: string;
  words: string[];
}

/** Lowercased words of letters and digits. */
export function wordsOf(s: string): string[] {
  return s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export function prepare(label: string): Prepared {
  return { lower: label.toLowerCase(), words: wordsOf(label) };
}

function spread(q: string, t: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (/\s/.test(t.charAt(ti))) {
      qi = 0;
      continue;
    }
    if (t.charAt(ti) === q.charAt(qi)) qi++;
  }
  return qi === q.length;
}

/** How well a typed query matches a prepared label: 0 for not at all. An empty query matches everything a little, so "@" alone lists every name. */
export function quality(query: string, p: Prepared): number {
  const q = query.toLowerCase();
  if (!q) return INSIDE;
  if (p.lower === q) return EXACT;
  if (p.lower.startsWith(q)) return PREFIX;
  for (const w of p.words) if (w.startsWith(q)) return WORD;
  const qw = wordsOf(q);
  if (/[^\p{L}\p{N}]/u.test(q) && qw.length > 1 && qw.every((w) => p.words.some((lw) => lw.startsWith(w)))) return WORD;
  if (p.lower.includes(q)) return INSIDE;
  if (q.length >= 2 && spread(q, p.lower)) return SPREAD;
  return 0;
}

/* ---------- lists and triggers ---------- */

/** A list entry is a name, or a name with a quiet second line and a kind. */
export type ListItem = string | { t: string; s?: string; kind?: string; sealed?: number; body?: string };

export interface ComposerLists {
  people?: readonly ListItem[];
  agents?: readonly ListItem[];
  folders?: readonly ListItem[];
  channels?: readonly ListItem[];
  records?: readonly ListItem[];
  files?: readonly ListItem[];
  /** Commands and skills: "later", "memory", "fork". */
  commands?: readonly ListItem[];
  /** Templates and snippets insert their body at the cursor. */
  templates?: readonly ListItem[];
  snippets?: readonly ListItem[];
}

export type TriggerChar = "@" | "#" | "/" | "[[";

export interface Trigger {
  ch: TriggerChar;
  /** Index of the first character of the trigger token. */
  start: number;
  /** Cursor position. */
  end: number;
  query: string;
}

const SYMBOL_CHAR: Record<ComposerSymbol, "@" | "#" | "/"> = { at: "@", hash: "#", slash: "/" };

/** The open trigger before the cursor: @, # or / at the start or after a space, or an unclosed [[ . */
export function detectTrigger(text: string, cursor: number, allowed: readonly ComposerSymbol[] = ["at", "hash", "slash"]): Trigger | null {
  const end = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, end);
  const link = /\[\[([^\]\n]*)$/.exec(before);
  if (link) return { ch: "[[", start: end - link[0].length, end, query: link[1] ?? "" };
  const m = /(^|\s)([@#/])([^\s@#/]*)$/.exec(before);
  if (!m) return null;
  const ch = m[2] as "@" | "#" | "/";
  const symbol = (Object.keys(SYMBOL_CHAR) as ComposerSymbol[]).find((k) => SYMBOL_CHAR[k] === ch);
  if (symbol === undefined || !allowed.includes(symbol)) return null;
  const query = m[3] ?? "";
  return { ch, start: end - query.length - 1, end, query };
}

export interface PopupItem {
  head?: undefined;
  /** Group the item belongs to: Agents, People, Folders, Channels, Records, Files, Commands, Templates, Snippets. */
  group: string;
  /** Text shown. */
  label: string;
  /** Quiet second line. */
  note?: string;
  kind: string;
  sealed?: number;
  /** Template and snippet text, or a command key. */
  body?: string;
}
export interface PopupHead {
  head: string;
}
export type PopupEntry = PopupItem | PopupHead;

export function isPopupItem(entry: PopupEntry): entry is PopupItem {
  return !("head" in entry && entry.head !== undefined);
}

const nameOf = (x: ListItem): string => (typeof x === "string" ? x : x.t);
const noteOf = (x: ListItem): string | undefined => (typeof x === "string" ? undefined : x.s);
const kindOf = (x: ListItem, fallback: string): string => (typeof x === "string" ? fallback : x.kind ?? fallback);
const firstWord = (s: string): string => s.trim().split(/\s+/)[0] ?? s;

export const MENTION_LIMIT = 8;
export const GROUP_LIMIT = 4;

function ranked(items: readonly ListItem[] | undefined, query: string, group: string, kind: string, limit: number): PopupItem[] {
  const scored: { at: number; q: number; item: PopupItem }[] = [];
  (items ?? []).forEach((x, at) => {
    const label = nameOf(x).replace(/^[#/]/, "");
    const q = quality(query, prepare(label));
    if (q === 0) return;
    const note = noteOf(x);
    const sealed = typeof x === "string" ? undefined : x.sealed;
    const body = typeof x === "string" ? undefined : x.body;
    scored.push({ at, q, item: { group, label, kind: kindOf(x, kind), ...(note === undefined ? {} : { note }), ...(sealed === undefined ? {} : { sealed }), ...(body === undefined ? {} : { body }) } });
  });
  scored.sort((a, b) => b.q - a.q || a.at - b.at);
  return scored.slice(0, limit).map((s) => s.item);
}

/** The suggestion popup for an open trigger. # groups come folders first when an agent leads, channels first with people. */
export function popupFor(trigger: Trigger, lists: ComposerLists, agentChat: boolean): PopupEntry[] {
  const q = trigger.query;
  if (trigger.ch === "@") {
    const agents = ranked(lists.agents, q, "Agents", "Agent", MENTION_LIMIT);
    const people = ranked(lists.people, q, "People", "Person", MENTION_LIMIT);
    const out: PopupEntry[] = [];
    let left = MENTION_LIMIT;
    for (const [name, items] of [["Agents", agents], ["People", people]] as const) {
      const take = items.slice(0, left);
      if (take.length === 0) continue;
      out.push({ head: name }, ...take);
      left -= take.length;
    }
    return out;
  }
  if (trigger.ch === "/") {
    const out: PopupEntry[] = [];
    for (const [name, items, kind] of [["Commands", lists.commands, "Command"], ["Templates", lists.templates, "Template"], ["Snippets", lists.snippets, "Snippet"]] as const) {
      const found = ranked(items, q, name, kind, MENTION_LIMIT);
      if (found.length) out.push({ head: name }, ...found);
    }
    return out;
  }
  if (trigger.ch === "[[") {
    const found = ranked(lists.records, q, "Records", "Record", MENTION_LIMIT);
    return found.length ? [{ head: "Link a record" }, ...found] : [];
  }
  const groups: Record<string, PopupItem[]> = {
    Folders: ranked(lists.folders, q, "Folders", "Folder", GROUP_LIMIT),
    Channels: ranked(lists.channels, q, "Channels", "Channel", GROUP_LIMIT),
    Records: ranked(lists.records, q, "Records", "Record", GROUP_LIMIT),
    Files: ranked(lists.files, q, "Files", "File", GROUP_LIMIT),
  };
  const order = agentChat ? ["Folders", "Channels", "Records", "Files"] : ["Channels", "Folders", "Records", "Files"];
  const out: PopupEntry[] = [];
  for (const name of order) {
    const found = groups[name] ?? [];
    if (found.length) out.push({ head: name }, ...found);
  }
  return out;
}

/** Indices of entries a person can land on. */
export function popupSelectable(entries: readonly PopupEntry[]): number[] {
  const out: number[] = [];
  entries.forEach((e, i) => {
    if (isPopupItem(e)) out.push(i);
  });
  return out;
}

/** Next active index for an arrow key, wrapping. */
export function popupMove(entries: readonly PopupEntry[], from: number, dir: 1 | -1): number {
  const list = popupSelectable(entries);
  if (list.length === 0) return -1;
  const at = list.indexOf(from);
  if (at < 0) return list[dir === 1 ? 0 : list.length - 1] ?? -1;
  return list[(at + dir + list.length) % list.length] ?? -1;
}

/* ---------- who will answer (lib/route.ts) ---------- */

export interface WhoContext {
  /** The thread's lead agent, if any. */
  lead?: string;
  /** Agents that listen: they answer only when @mentioned. */
  listening?: readonly string[];
  agents?: readonly ListItem[];
  people?: readonly ListItem[];
}

function mentionsIn(text: string, items: readonly ListItem[] | undefined): string[] {
  const found: { at: number; name: string }[] = [];
  for (const x of items ?? []) {
    const name = nameOf(x);
    const first = firstWord(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`(^|[^\\w])@${first}(?![\\p{L}\\p{N}_])`, "iu").exec(text);
    if (m) found.push({ at: m.index + m[0].length, name });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.name);
}

export interface WhoAnswer {
  line: string;
  responders: string[];
  /** Quiet: nobody will reply. */
  dim: boolean;
  reason: string;
}

/** The composer's who-will-answer line for the text typed so far, from lib/route.ts. */
export function whoAnswers(text: string, ctx: WhoContext): WhoAnswer {
  const agentNames = mentionsIn(text, ctx.agents);
  const personNames = mentionsIn(text, ctx.people);
  const thread: RouteThread = {
    agents: [
      ...(ctx.lead === undefined ? [] : [{ id: ctx.lead, mode: "lead" as const }]),
      ...(ctx.listening ?? []).filter((n) => n !== ctx.lead).map((id) => ({ id, mode: "listen" as const })),
    ],
  };
  const message: RouteMessage = {
    author: { kind: "person", id: "me" },
    mentions: [...agentNames.map((id) => ({ kind: "agent" as const, id })), ...personNames.map((id) => ({ kind: "person" as const, id }))],
  };
  const result = route(thread, message);
  if (result.responders.length > 0) return { line: `${result.responders.join(" and ")} will reply`, responders: result.responders, dim: false, reason: result.reason };
  if (result.reason === "person_addressed") {
    const who = firstWord(personNames[0] ?? "They");
    return { line: `${who} will see this · no agent will reply`, responders: [], dim: true, reason: result.reason };
  }
  return { line: "No agent will reply · type @ to ask one", responders: [], dim: true, reason: result.reason };
}

/** The line to show: computed when the text addresses someone or the caller gave a thread; otherwise the caller's own line. */
export function answerLine(text: string, fallback: string, ctx: WhoContext | undefined): WhoAnswer {
  if (ctx === undefined) return { line: fallback, responders: [], dim: /^no agent|no agent will/i.test(fallback), reason: "given" };
  const computed = whoAnswers(text, ctx);
  const addressed = computed.reason === "mention" || computed.reason === "person_addressed";
  if (!addressed && fallback.length > 0) return { ...computed, line: fallback, dim: /no agent will reply/i.test(fallback) };
  return computed;
}

/* ---------- state ---------- */

export type SendMode = "queue" | "interrupt";

export interface ComposerState {
  text: string;
  cursor: number;
  chips: ComposerChip[];
  files: ComposerAttachment[];
  folder: string | null;
  /** Index in the popup entries. */
  active: number;
  /** Escape closed the popup for this trigger. */
  dismissedAt: number;
}

export function initialState(value = "", folder: string | null = null): ComposerState {
  return { text: value, cursor: value.length, chips: [], files: [], folder, active: -1, dismissedAt: -1 };
}

export interface ComposerSend {
  text: string;
  chips: ComposerChip[];
  files: ComposerAttachment[];
  /** Folder chip: the thread's folder_id is set to this folder. */
  folder: string | null;
  /** Records linked with [[ ]] in the text. */
  links: string[];
  mode: SendMode;
  answers: string;
}

export function canSend(state: ComposerState): boolean {
  return state.text.trim().length > 0 || state.chips.length > 0 || state.files.length > 0;
}

export function linksIn(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((m) => (m[1] ?? "").trim()).filter(Boolean);
}

/** The payload and the cleared state in one step: the field empties in the same call, before any server answer. */
export function sendNow(state: ComposerState, answers: string, mode: SendMode = "queue"): { payload: ComposerSend; next: ComposerState } | null {
  if (!canSend(state)) return null;
  const payload: ComposerSend = { text: state.text.trim(), chips: state.chips.slice(), files: state.files.slice(), folder: state.folder, links: linksIn(state.text), mode, answers };
  return { payload, next: { ...initialState("", state.folder), cursor: 0 } };
}

export type PickEffect = { kind: "command"; name: string } | { kind: "folder"; folder: string } | { kind: "none" };

/** Applies a picked popup item to the state. */
export function applyPick(state: ComposerState, trigger: Trigger, item: PopupItem): { next: ComposerState; effect: PickEffect } {
  const before = state.text.slice(0, trigger.start);
  const after = state.text.slice(trigger.end);
  const place = (text: string, insertAt: number): ComposerState => ({ ...state, text, cursor: insertAt, active: -1, dismissedAt: -1 });
  if (trigger.ch === "@") {
    const insert = `@${firstWord(item.label)} `;
    return { next: place(before + insert + after, before.length + insert.length), effect: { kind: "none" } };
  }
  if (trigger.ch === "[[") {
    const insert = `[[${item.label}]] `;
    return { next: place(before + insert + after, before.length + insert.length), effect: { kind: "none" } };
  }
  if (trigger.ch === "/") {
    if (item.kind === "Template" || item.kind === "Snippet") {
      const insert = item.body ?? item.label;
      return { next: place(before + insert + after, before.length + insert.length), effect: { kind: "none" } };
    }
    return { next: place(before + after, before.length), effect: { kind: "command", name: item.body ?? item.label } };
  }
  const cleared = place(before + after, before.length);
  if (item.kind === "Folder") return { next: { ...cleared, folder: item.label }, effect: { kind: "folder", folder: item.label } };
  const chip: ComposerChip = { kind: item.kind, name: item.label };
  if (cleared.chips.some((c) => c.kind === chip.kind && c.name === chip.name)) return { next: cleared, effect: { kind: "none" } };
  return { next: { ...cleared, chips: [...cleared.chips, chip] }, effect: { kind: "none" } };
}

/** Text pasted as plain text: line breaks kept, tabs and control characters dropped. */
export function plainText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\t/g, " ");
}

/** What Enter does. Enter sends (Shift+Enter writes a line); in email mode Cmd/Ctrl+Enter sends. While an agent works a plain send queues and Cmd/Ctrl+Enter interrupts. */
export function enterAction(key: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; isComposing?: boolean }, enterSends: boolean, working: boolean): "send" | "interrupt" | "newline" {
  if (key.isComposing === true) return "newline";
  const mod = key.metaKey === true || key.ctrlKey === true;
  const sends = enterSends ? key.shiftKey !== true : mod;
  if (!sends) return "newline";
  return working && mod ? "interrupt" : "send";
}

/** The right-click menu of the field. ui/Menu appends Report a problem. */
export function composerMenu(actions: { attach: () => void; paste: () => void; clear: () => void }): MenuEntry[] {
  return [
    { label: "Attach Files\u2026", icon: ICON_CLIP, onSelect: actions.attach },
    { label: "Paste as Plain Text", icon: "copy", onSelect: actions.paste },
    { separator: true },
    { label: "Clear Draft", icon: "trash", danger: true, onSelect: actions.clear },
  ];
}

/* ---------- icons ---------- */

const svg = (d: string, extra = ""): string => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"${extra}>${d}</svg>`;
export const ICON_UP = svg('<path d="M8 13V3M3.5 7.5L8 3l4.5 4.5"/>');
export const ICON_STOP = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="2"/></svg>';
export const ICON_PLUS = svg('<path d="M8 3.500v9M3.500 8h9"/>');
export const ICON_CLIP = svg('<path d="M13 7.5L7.800 12.700a3 3 0 01-4.200-4.200l5.500-5.500a2 2 0 012.800 2.800L6.400 11.300a1 1 0 01-1.400-1.400l4.800-4.800"/>');
export const ICON_FOLDER = svg('<path d="M2.500 4.500a1 1 0 011-1h3l1.500 1.500h4.500a1 1 0 011 1v6a1 1 0 01-1 1h-9a1 1 0 01-1-1z"/>');
export const ICON_FILE = svg('<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>');
export const ICON_RECORD = svg('<rect x="2.500" y="2.500" width="11" height="11" rx="1.500"/><path d="M2.500 6h11M6.500 6v7.500"/>');

const SYMBOL_LABEL: Record<ComposerSymbol, string> = { at: "Mention a person or agent (@)", hash: "Tag a folder, channel, record or file (#)", slash: "Commands, templates and snippets (/)" };

/* ---------- the component ---------- */

export interface ComposerProps extends ComposerShellProps {
  lists?: ComposerLists;
  /** Agents that listen in this thread (answer only when @mentioned). The lead comes from `lead`. */
  listening?: readonly string[];
  /** Folders come first in # when an agent leads. Defaults to whether `lead` is set. */
  agentChat?: boolean;
  /** The thread's folder chip. Picking a folder with # sets it; removing the chip clears it. */
  folder?: string | null;
  onFolder?: (folder: string | null) => void;
  /** Called with everything sent: text, chips, files, folder, linked records, mode. */
  onSubmit?: (payload: ComposerSend) => void;
  /** Send now while the agent works. A plain send queues for its next step. */
  onInterrupt?: (payload: ComposerSend) => void;
  onCommand?: (name: string) => void;
  onChange?: (text: string) => void;
  onFiles?: (files: ComposerAttachment[]) => void;
  /** Replaces the browser file picker (the app opens Vyre Files or the system sheet). */
  onAttach?: () => void;
  /** Recipients for a composer that sends outside. Mounted above the field. */
  recipients?: ReactNode;
  banner?: ReactNode;
  /** Right end of the who-will-answer row: the place puts its model chip here ("Opus"). */
  whoExtra?: ReactNode;
  /** Buttons after the symbol buttons: the place adds its model and where-it-runs controls here. */
  barExtra?: ReactNode;
  /** Enter writes a new line and Cmd/Ctrl+Enter sends (email). Default true: Enter sends. */
  enterSends?: boolean;
  density?: "regular" | "compact";
  testID?: string;
}

interface KeyLike {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  isComposing?: boolean;
  preventDefault?: () => void;
}

interface ChangeLike {
  nativeEvent: { text?: string; target?: { selectionStart?: number | null } };
}

const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});
const MIN_FIELD = 22;
const MAX_FIELD = 160;
const FIELD_STYLE = { outlineStyle: "none", outlineWidth: 0, backgroundColor: "transparent" } as unknown as TextStyle;
const BOX_SHADOW = { boxShadow: "var(--sh-2)" } as unknown as ViewStyle;
const RING_SHADOW = { boxShadow: "0 0 0 1px var(--line-2), var(--sh-2)" } as unknown as ViewStyle;
const POP_SHADOW = { boxShadow: "var(--sh-pop)" } as unknown as ViewStyle;

/** An icon: inline svg on web, a plain character on native until the native icon set lands. */
export function Glyph({ icon, native, size = 16, color }: { icon: string; native: string; size?: number; color?: string }): ReactElement {
  if (Platform.OS === "web") return <MenuIcon icon={icon} size={size} {...(color === undefined ? {} : { color })} />;
  return <Text style={{ color: color ?? "var(--ink-3)", fontSize: size, lineHeight: size + 2 }}>{native}</Text>;
}

function IconButton({ icon, label, onPress, testID }: { icon: ReactNode; label: string; onPress: () => void; testID: string }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      {...webProps({ title: label })}
      style={({ hovered }: { hovered?: boolean }) => [styles.tool, hovered === true && HOVER]}
    >
      {icon}
    </Pressable>
  );
}

const HOVER = { backgroundColor: "var(--hover)" };

interface TrayChip {
  key: string;
  icon: string;
  name: string;
  sub?: string;
  onRemove: () => void;
}

function Chip({ chip, onRemove }: { chip: TrayChip; onRemove: () => void }): ReactElement {
  return (
    <View style={styles.chip} testID={`composer-chip-${chip.key}`}>
      <MenuIcon icon={chip.icon} size={13} color="var(--ink-3)" />
      <Text numberOfLines={1} style={styles.chipText}>{chip.name}</Text>
      {chip.sub ? <Text style={styles.chipSub}>{chip.sub}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${chip.name}`} onPress={onRemove} style={({ hovered }: { hovered?: boolean }) => [styles.chipX, hovered === true && HOVER]}>
        <Text style={styles.chipXText}>{"×"}</Text>
      </Pressable>
    </View>
  );
}

const CHIP_ICON: Record<string, string> = { Folder: ICON_FOLDER, Record: ICON_RECORD, File: ICON_FILE, Channel: "link" };

export function Composer(props: ComposerProps): ReactElement {
  const symbols = composerSymbols(props);
  const lists = props.lists ?? {};
  const enterSends = props.enterSends !== false;
  const [state, setState] = useState<ComposerState>(() => initialState(props.value ?? "", props.folder ?? null));
  const [focused, setFocused] = useState(false);
  const [height, setHeight] = useState(MIN_FIELD);
  const stateRef = useRef(state);
  stateRef.current = state;
  const input = useRef<TextInput | null>(null);
  const picker = useRef<unknown>(null);
  const blur = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menu = useMenu();

  useEffect(() => {
    if (props.value !== undefined && props.value !== stateRef.current.text) setState((s) => ({ ...s, text: props.value ?? "", cursor: (props.value ?? "").length }));
  }, [props.value]);
  useEffect(() => {
    if (props.folder !== undefined) setState((s) => (s.folder === (props.folder ?? null) ? s : { ...s, folder: props.folder ?? null }));
  }, [props.folder]);
  useEffect(() => () => {
    if (blur.current !== null) clearTimeout(blur.current);
  }, []);

  const hasLead = props.lead !== undefined && props.lead.length > 0;
  const whoCtx: WhoContext | undefined = hasLead || lists.agents !== undefined || lists.people !== undefined
    ? { ...(hasLead ? { lead: props.lead as string } : {}), ...(props.listening === undefined ? {} : { listening: props.listening }), ...(lists.agents === undefined ? {} : { agents: lists.agents }), ...(lists.people === undefined ? {} : { people: lists.people }) }
    : undefined;
  const who = answerLine(state.text, props.whoWillAnswer, whoCtx);

  const trigger = useMemo(() => detectTrigger(state.text, state.cursor, symbols), [state.text, state.cursor, symbols.join(",")]);
  const entries = useMemo(() => (trigger === null ? [] : popupFor(trigger, lists, props.agentChat ?? hasLead)), [trigger, props.lists, props.agentChat, hasLead]);
  const open = trigger !== null && focused && trigger.start !== state.dismissedAt && entries.length > 0;
  const active = open ? (popupSelectable(entries).includes(state.active) ? state.active : popupSelectable(entries)[0] ?? -1) : -1;

  const working = props.working === true;
  const mayStop = working && state.text.trim().length === 0 && state.chips.length === 0 && state.files.length === 0;

  const patch = useCallback((next: Partial<ComposerState>) => setState((s) => ({ ...s, ...next })), []);

  const submit = useCallback((mode: SendMode) => {
    const cur = stateRef.current;
    const answers = answerLine(cur.text, props.whoWillAnswer, whoCtx).line;
    const sent = sendNow(cur, answers, mode);
    if (sent === null) return;
    stateRef.current = sent.next;
    setState(sent.next);
    setHeight(MIN_FIELD);
    props.onSend?.(sent.payload.text);
    if (mode === "interrupt") props.onInterrupt?.(sent.payload);
    props.onSubmit?.(sent.payload);
  }, [props.onSend, props.onSubmit, props.onInterrupt, props.whoWillAnswer, props.lead, props.listening, props.lists]);

  const pick = useCallback((entry: PopupEntry | undefined) => {
    const cur = stateRef.current;
    if (entry === undefined || !isPopupItem(entry)) return;
    const t = detectTrigger(cur.text, cur.cursor, symbols);
    if (t === null) return;
    const done = applyPick(cur, t, entry);
    stateRef.current = done.next;
    setState(done.next);
    if (done.effect.kind === "folder") props.onFolder?.(done.effect.folder);
    if (done.effect.kind === "command") props.onCommand?.(done.effect.name);
    props.onChange?.(done.next.text);
    input.current?.focus();
  }, [props.onFolder, props.onCommand, props.onChange, symbols.join(",")]);

  const addFiles = useCallback((files: ComposerAttachment[]) => {
    if (files.length === 0) return;
    setState((s) => ({ ...s, files: [...s.files, ...files] }));
    props.onFiles?.(files);
  }, [props.onFiles]);

  const attach = useCallback(() => {
    if (props.onAttach) {
      props.onAttach();
      return;
    }
    const node = picker.current as { click?: () => void } | null;
    node?.click?.();
  }, [props.onAttach]);

  const openSymbol = (symbol: ComposerSymbol): void => {
    const cur = stateRef.current;
    const mark = symbolMark(symbol);
    const text = cur.text + (cur.text.length > 0 && !/\s$/.test(cur.text) ? " " : "") + mark;
    const next = { ...cur, text, cursor: text.length, active: -1, dismissedAt: -1 };
    stateRef.current = next;
    setState(next);
    setFocused(true);
    input.current?.focus();
  };

  const onKeyPress = (event: { nativeEvent: KeyLike; preventDefault?: () => void }): void => {
    const k = event.nativeEvent;
    const stop = (): void => {
      event.preventDefault?.();
      k.preventDefault?.();
    };
    if (open) {
      if (k.key === "ArrowDown" || k.key === "ArrowUp") {
        stop();
        patch({ active: popupMove(entries, active, k.key === "ArrowDown" ? 1 : -1) });
        return;
      }
      if (k.key === "Enter" || k.key === "Tab") {
        stop();
        pick(entries[active]);
        return;
      }
      if (k.key === "Escape") {
        stop();
        patch({ dismissedAt: trigger?.start ?? -1 });
        return;
      }
    }
    if (k.key === "Escape" && working && mayStop) {
      stop();
      props.onStop?.();
      return;
    }
    if (k.key === "Backspace" && stateRef.current.text.length === 0 && stateRef.current.chips.length > 0) {
      stop();
      setState((s) => ({ ...s, chips: s.chips.slice(0, -1) }));
      return;
    }
    if (k.key === "Enter") {
      const action = enterAction(k, enterSends, working);
      if (action === "newline") return;
      stop();
      submit(action === "interrupt" ? "interrupt" : "queue");
    }
  };

  const onChange = (event: ChangeLike): void => {
    const text = event.nativeEvent.text ?? stateRef.current.text;
    const at = event.nativeEvent.target?.selectionStart;
    const cursor = typeof at === "number" ? at : text.length;
    setState((s) => ({ ...s, text, cursor, active: -1, dismissedAt: -1 }));
    props.onChange?.(text);
  };

  const onFocus = (): void => {
    if (blur.current !== null) clearTimeout(blur.current);
    setFocused(true);
  };
  const onBlur = (): void => {
    blur.current = setTimeout(() => setFocused(false), 120);
  };

  const paste = async (): Promise<void> => {
    const clip = (globalThis as { navigator?: { clipboard?: { readText?: () => Promise<string> } } }).navigator?.clipboard;
    if (!clip?.readText) return;
    const text = plainText(await clip.readText());
    setState((s) => {
      const at = Math.min(s.cursor, s.text.length);
      return { ...s, text: s.text.slice(0, at) + text + s.text.slice(at), cursor: at + text.length };
    });
  };

  const menuItems = (): MenuEntry[] => composerMenu({
    attach,
    paste: () => void paste(),
    clear: () => {
      setState((s) => ({ ...initialState("", s.folder), cursor: 0 }));
      setHeight(MIN_FIELD);
    },
  });
  const contextProps = menuTrigger((x, y) => menu.show(menuItems(), x, y, "context", { label: "Composer" }));

  const chips: TrayChip[] = [];
  if (state.folder !== null) chips.push({ key: "folder", icon: ICON_FOLDER, name: state.folder, onRemove: () => { patch({ folder: null }); props.onFolder?.(null); } });
  for (let i = 0; i < state.chips.length; i++) {
    const c = state.chips[i];
    if (c !== undefined) chips.push({ key: `c${i}`, icon: CHIP_ICON[c.kind] ?? "link", name: c.name, onRemove: () => setState((s) => ({ ...s, chips: s.chips.filter((_, j) => j !== i) })) });
  }
  for (const [i, c] of (props.chips ?? []).entries()) chips.push({ key: `p${i}`, icon: CHIP_ICON[c.kind] ?? "link", name: c.name, onRemove: () => undefined });
  for (let i = 0; i < state.files.length; i++) {
    const f = state.files[i];
    if (f !== undefined) chips.push({ key: `f${i}`, icon: ICON_FILE, name: f.name, onRemove: () => setState((s) => ({ ...s, files: s.files.filter((_, j) => j !== i) })) });
  }
  for (const [i, f] of (props.attachments ?? []).entries()) chips.push({ key: `a${i}`, icon: ICON_FILE, name: f.name, onRemove: () => undefined });
  const trayNodes: ReactElement[] = [];
  for (const c of chips) trayNodes.push(<Chip key={c.key} chip={c} onRemove={c.onRemove} />);
  const symbolNodes: ReactElement[] = [];
  for (const sym of symbols) symbolNodes.push(<IconButton key={sym} icon={<Text style={styles.toolText}>{symbolMark(sym)}</Text>} label={SYMBOL_LABEL[sym]} onPress={() => openSymbol(sym)} testID={`composer-symbol-${sym}`} />);
  const popNodes: ReactElement[] = [];
  if (open) {
    for (const [i, entry] of entries.entries()) {
      if (isPopupItem(entry)) popNodes.push(<Row key={`${entry.group}:${entry.label}`} id={`pop-${i}`} title={entry.label} {...(entry.note === undefined ? {} : { note: entry.note })} selected={i === active} onPress={() => pick(entry)} />);
      else popNodes.push(<Text key={`h${entry.head}`} style={styles.popHead}>{entry.head}</Text>);
    }
  }

  const sendLabel = mayStop ? "Stop" : working ? "Queue" : "Send";
  const sendOk = mayStop || canSend(state);
  const onSendPress = (): void => (mayStop ? props.onStop?.() : submit("queue"));
  const compact = props.density === "compact";

  return (
    <View
      style={[styles.box, compact && styles.boxCompact, focused ? RING_SHADOW : BOX_SHADOW]}
      testID={props.testID ?? "composer"}
      accessibilityLabel={props.label ?? "Message"}
      {...contextProps}
      {...webProps({
        onDragOver: (e: { preventDefault: () => void }) => e.preventDefault(),
        onDrop: (e: { preventDefault: () => void; dataTransfer?: { files?: ArrayLike<{ name: string }> } }) => {
          e.preventDefault();
          addFiles(Array.from(e.dataTransfer?.files ?? [], (f) => ({ name: f.name })));
        },
        dataSet: { composer: "true" },
      })}
    >
      {props.sendsOutside ? <View style={styles.recipients} testID="composer-recipients">{props.recipients}</View> : null}
      {props.banner ? <View style={styles.banner}>{props.banner}</View> : null}
      {chips.length > 0 ? (
        <View style={styles.tray} testID="composer-tray">
          {trayNodes}
        </View>
      ) : null}
      {props.engineLine ? <Text style={styles.engine} testID="composer-engine-line">{props.engineLine}</Text> : null}
      <TextInput
        ref={input}
        multiline
        value={state.text}
        placeholder={props.placeholder ?? "Message"}
        placeholderTextColor="var(--ink-4)"
        accessibilityLabel={props.label ?? "Message"}
        onChange={onChange as never}
        onSelectionChange={(e) => patch({ cursor: e.nativeEvent.selection.start })}
        onKeyPress={onKeyPress as never}
        onContentSizeChange={(e) => setHeight(Math.max(MIN_FIELD, Math.min(MAX_FIELD, Math.ceil(e.nativeEvent.contentSize.height))))}
        onFocus={onFocus}
        onBlur={onBlur}
        testID="composer-field"
        style={[styles.field, FIELD_STYLE, { height }]}
        {...webProps({
          onPaste: (e: { clipboardData?: { files?: ArrayLike<{ name: string }> }; preventDefault: () => void }) => {
            const files = Array.from(e.clipboardData?.files ?? [], (f) => ({ name: f.name || "Pasted image.png" }));
            if (files.length > 0) {
              e.preventDefault();
              addFiles(files);
            }
          },
        })}
      />
      <View style={styles.whoRow}>
        <Text numberOfLines={1} style={[styles.who, who.dim && styles.whoDim]} testID="composer-who" accessibilityRole="text" accessibilityLiveRegion="polite">{who.line}</Text>
        {props.whoExtra}
      </View>
      <View style={styles.bar}>
        <IconButton icon={<Glyph icon={ICON_PLUS} native="+" color="var(--ink-3)" />} label="Attach a file" onPress={attach} testID="composer-attach" />
        {symbolNodes}
        {props.barExtra}
        <View style={styles.spacer} />
        {state.text.length > 0 ? <Text style={styles.hint}>{enterSends ? "⇧⏎ new line" : "⌘⏎ send"}</Text> : null}
        {working && !mayStop ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Interrupt and send now"
            onPress={() => submit("interrupt")}
            testID="composer-interrupt"
            style={({ hovered }: { hovered?: boolean }) => [styles.textButton, hovered === true && HOVER]}
          >
            <Text style={styles.textButtonText}>Interrupt</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sendLabel}
          accessibilityState={{ disabled: !sendOk }}
          disabled={!sendOk}
          onPress={onSendPress}
          testID="composer-send"
          {...webProps({ title: sendLabel })}
          style={[styles.send, mayStop && styles.sendStop, !sendOk && styles.sendOff]}
        >
          <Glyph icon={mayStop ? ICON_STOP : ICON_UP} native={mayStop ? "\u25a0" : "\u2191"} size={mayStop ? 12 : 16} color={mayStop ? "var(--win)" : "var(--accent-ink)"} />
        </Pressable>
      </View>
      {open ? (
        <View style={[styles.pop, POP_SHADOW]} testID="composer-popup" accessibilityRole="menu" {...webProps({ role: "listbox", onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() })}>
          {popNodes}
        </View>
      ) : null}
      {Platform.OS === "web" ? createElement("input", {
        type: "file",
        multiple: true,
        hidden: true,
        "aria-hidden": true,
        tabIndex: -1,
        ref: (node: unknown) => { picker.current = node; },
        onChange: (e: { target: { files?: ArrayLike<{ name: string }>; value?: string } }) => {
          addFiles(Array.from(e.target.files ?? [], (f) => ({ name: f.name })));
          e.target.value = "";
        },
      }) : null}
      {menu.element}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: "relative", width: "100%", borderRadius: 16, backgroundColor: "var(--raised)" as string, paddingTop: 10, paddingHorizontal: 12, paddingBottom: 8 },
  boxCompact: { borderRadius: 14, paddingHorizontal: 10 },
  recipients: { paddingBottom: 6, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  banner: { paddingBottom: 6 },
  tray: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingBottom: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingLeft: 7, paddingRight: 2, borderRadius: 6, backgroundColor: "var(--sunk)" as string, maxWidth: "100%" },
  chipText: { color: "var(--ink)" as string, fontSize: 12, lineHeight: 16, flexShrink: 1 },
  chipSub: { color: "var(--ink-3)" as string, fontSize: 11.5 },
  chipX: { width: 20, height: 20, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  chipXText: { color: "var(--ink-3)" as string, fontSize: 14, lineHeight: 16 },
  engine: { color: "var(--ink-3)" as string, fontSize: 11.5, lineHeight: 16, paddingBottom: 4 },
  field: { width: "100%", color: "var(--ink)" as string, fontSize: 13, lineHeight: 19, padding: 0, margin: 0, borderWidth: 0 },
  whoRow: { flexDirection: "row", alignItems: "center", paddingTop: 2, paddingBottom: 4, gap: 8 },
  who: { flex: 1, color: "var(--ink-2)" as string, fontSize: 11.5, lineHeight: 16 },
  whoDim: { color: "var(--ink-4)" as string },
  bar: { flexDirection: "row", alignItems: "center", gap: 2 },
  tool: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  toolText: { color: "var(--ink-3)" as string, fontSize: 13, fontWeight: "500" },
  spacer: { flex: 1 },
  hint: { color: "var(--ink-4)" as string, fontSize: 11.5, paddingRight: 6 },
  textButton: { height: 26, paddingHorizontal: 8, borderRadius: 6, alignItems: "center", justifyContent: "center", marginRight: 2 },
  textButtonText: { color: "var(--ink-2)" as string, fontSize: 12.5, fontWeight: "500" },
  send: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent)" as string, marginLeft: 4 },
  sendStop: { backgroundColor: "var(--ink)" as string },
  sendOff: { opacity: 0.35 },
  pop: { position: "absolute", left: 8, right: 8, bottom: "100%", marginBottom: 6, maxHeight: 260, borderRadius: 10, backgroundColor: "var(--raised)" as string, padding: 4, zIndex: 50, overflow: "hidden" },
  popHead: { color: "var(--ink-4)" as string, fontSize: 11, fontWeight: "600", paddingTop: 6, paddingBottom: 2, paddingHorizontal: 8 },
});
