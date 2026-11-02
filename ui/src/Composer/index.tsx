// ui/Composer: the one composer for Chats, threads, Ask panes, inbox email and text, record comments and task threads (spec 4.6, 3.2, 3.3; rc.8 composer prototype).
// One line that grows as you type: plus, words, the model pill, then send or stop. The pill shows only when an AI will answer (who answers is lib/route.ts, so it never disagrees with the engine) and opens the
// model menu; it carries a chip only when the mode is not Auto or the chat does not run on this computer, the effort bars and the context ring past 60 percent; the face of who answers shows only when more than
// one agent is here. Shift+Tab cycles the mode. Send turns to Stop while an agent works and splits into Queue and Now when you type while it works. A tray above the line holds what is attached.
// Symbols (spec 3.0): @ people and agents; # one search over Records, Files, Folders, Chats, Automations, Projects and Channels with a preview, inserting an inline token
// (a folder sets the thread's folder chip); / commands, skills, templates and snippets; [[ links a record. Sending is optimistic: the field clears and onSend runs in the
// same call, before any server answer.
// Colours are skin tokens (CSS variables on web), so a skin switch repaints with no re-render.
// The suggestion matcher is ported from vyre 0.6.9 core/suggest/match.js@07cb32abd with real types.

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import { route } from "../../../lib/route.ts";
import type { RouteMessage, RouteThread } from "../../../lib/route.ts";
import { AppIcon } from "../AppIcon/index.tsx";
import { Avatar, avatarOf } from "../Avatar/index.tsx";
import { MenuIcon, menuTrigger, useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { Row } from "../Row/index.tsx";
import { answering, contextRing, deleteToken, effortsFor, modeInfo, nextMode, sendControl, sizeLabel, stripName, tokenRanges } from "./brain.ts";
import type { ChatMode, ComposerAgent, TokenRange } from "./brain.ts";
import { ContextRing, EffortBars, GroupHead, I, IconTile, Kbd, Pop, STOP, ensureComposerCss, useDismiss } from "./parts.tsx";
import { composerSymbols } from "./props.ts";
import { closeEmoji, findEmoji } from "./emoji.ts";
import type { ComposerAttachment, ComposerChip, ComposerRef, ComposerShellProps, ComposerSymbol } from "./props.ts";
import { Glyph, plainText } from "./shared.tsx";

export type { ComposerAttachment, ComposerChip, ComposerRef, ComposerShellProps, ComposerSymbol } from "./props.ts";
export { COMPOSER_SYMBOLS, composerSymbols, symbolMark } from "./props.ts";
export { Glyph, ICON_UP, plainText } from "./shared.tsx";
export { EFFORTS, MODES, answering, contextRing, deleteToken, effortBars, effortForKey, modeInfo, nextMode, sendControl, sizeLabel, stripName, tokenRanges } from "./brain.ts";
export type { ChatMode, ComposerAgent, Effort, SendControl, TokenRange } from "./brain.ts";
export { ModelPanel, contextFor, lowSuggestion, resetLabel } from "./ModelPanel.tsx";
export type { ModelPanelProps, PanelAccount, PanelModel, PanelScope, PanelUsage, UsageMeter } from "./ModelPanel.tsx";
export { OutgoingHeader, CONNECT_LABEL, groupSenders } from "./outgoing.tsx";
export type { ComposerSender, OutChannel, OutgoingProps, SenderGroup } from "./outgoing.tsx";
export { BrandMark, LogoTile, brandOf } from "./parts.tsx";

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
export type ListItem = string | { t: string; s?: string; kind?: string; sealed?: number; body?: string;
  /** Facts the preview pane and the place need (a record's type, a file's size). */
  data?: Record<string, string>;
  /** An id a pick keeps (a record, file, folder or channel), so what is sent names the thing and not only its title. */
  ref?: string;
  /** A command that takes words after its name: the hint for them. Picking it writes "/name " and waits instead of running. */
  arg?: string };

export interface ComposerLists {
  people?: readonly ListItem[];
  agents?: readonly ListItem[];
  folders?: readonly ListItem[];
  channels?: readonly ListItem[];
  records?: readonly ListItem[];
  files?: readonly ListItem[];
  chats?: readonly ListItem[];
  automations?: readonly ListItem[];
  projects?: readonly ListItem[];
  /** Commands and skills: "later", "memory", "fork". A kind of Plugin or Skill lists under Skills. */
  commands?: readonly ListItem[];
  /** Templates and snippets insert their body at the cursor. */
  templates?: readonly ListItem[];
  snippets?: readonly ListItem[];
}

export type TriggerChar = "@" | "#" | "/" | "[[" | ":";

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
  // :name asks for an emoji: after a space or at the start, two letters in, so a time like 10:30 or a url never opens it. Every composer has it.
  const colon = /(^|\s):([a-zA-Z][a-zA-Z0-9_+-]+)$/.exec(before);
  if (colon) return { ch: ":", start: end - (colon[2] ?? "").length - 1, end, query: colon[2] ?? "" };
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
  ref?: string;
  arg?: string;
  data?: Record<string, string>;
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
    const ref = typeof x === "string" ? undefined : x.ref;
    const arg = typeof x === "string" ? undefined : x.arg;
    const data = typeof x === "string" ? undefined : x.data;
    scored.push({ at, q, item: { group, label, kind: kindOf(x, kind), ...(note === undefined ? {} : { note }), ...(sealed === undefined ? {} : { sealed }), ...(body === undefined ? {} : { body }), ...(ref === undefined ? {} : { ref }), ...(arg === undefined ? {} : { arg }), ...(data === undefined ? {} : { data }) } });
  });
  scored.sort((a, b) => b.q - a.q || a.at - b.at);
  return scored.slice(0, limit).map((s) => s.item);
}

/** The groups # searches, in the order they show. */
export const HASH_GROUPS = ["Records", "Files", "Folders", "Chats", "Automations", "Projects", "Channels"] as const;
export type HashGroup = (typeof HASH_GROUPS)[number];
export type HashScope = "All" | HashGroup;
/** How many of each group show when the scope is one group. */
export const SCOPED_LIMIT = 12;

const HASH_LIST: Record<HashGroup, [keyof ComposerLists, string]> = {
  Records: ["records", "Record"], Files: ["files", "File"], Folders: ["folders", "Folder"], Chats: ["chats", "Chat"],
  Automations: ["automations", "Automation"], Projects: ["projects", "Project"], Channels: ["channels", "Channel"],
};

/** The suggestion popup for an open trigger. # is one search over every kind, grouped with section heads; a scope narrows it to one group and shows more of it. */
export function popupFor(trigger: Trigger, lists: ComposerLists, _agentChat = true, scope: HashScope = "All"): PopupEntry[] {
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
    const skill = (x: ListItem): boolean => typeof x !== "string" && (x.kind === "Plugin" || x.kind === "Skill");
    const commands = (lists.commands ?? []).filter((x) => !skill(x));
    const skills = (lists.commands ?? []).filter(skill);
    for (const [name, items, kind] of [["Commands", commands, "Command"], ["Skills", skills, "Skill"], ["Templates", lists.templates, "Template"], ["Snippets", lists.snippets, "Snippet"]] as const) {
      const found = ranked(items, q, name, kind, MENTION_LIMIT);
      if (found.length) out.push({ head: name }, ...found);
    }
    return out;
  }
  if (trigger.ch === ":") {
    return findEmoji(q).map((e): PopupItem => ({ group: "Emoji", label: e.char, note: e.name.replace(/_/g, " "), kind: "Emoji", body: e.char }));
  }
  if (trigger.ch === "[[") {
    const found = ranked(lists.records, q, "Records", "Record", MENTION_LIMIT);
    return found.length ? [{ head: "Link a record" }, ...found] : [];
  }
  const out: PopupEntry[] = [];
  for (const name of HASH_GROUPS) {
    if (scope !== "All" && scope !== name) continue;
    const [key, kind] = HASH_LIST[name];
    const found = ranked(lists[key], q, name, kind, scope === "All" ? GROUP_LIMIT : SCOPED_LIMIT);
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

/** A browser File, as far as the composer reads it. */
interface FileLike { name: string; size?: number; type?: string }

/** The tray entry for a dropped, pasted or picked file: its name, and the file itself so the sender can read the bytes. */
export function attachmentOf(f: FileLike, fallbackName = "File"): ComposerAttachment {
  return { name: f.name || fallbackName, file: f, ...(typeof f.size === "number" ? { size: f.size } : {}), ...(f.type ? { mime: f.type } : {}) };
}

/* ---------- state ---------- */

export type SendMode = "queue" | "interrupt";

export interface ComposerState {
  text: string;
  cursor: number;
  chips: ComposerChip[];
  files: ComposerAttachment[];
  /** Records and other things picked for [[ ]], kept with their ids until the text no longer names them. */
  refs?: ComposerRef[];
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
  /** The links that were picked from a list, with their ids: only those the text still names. */
  refs: ComposerRef[];
  mode: SendMode;
  answers: string;
}

export function canSend(state: ComposerState): boolean {
  return state.text.trim().length > 0 || state.chips.length > 0 || state.files.length > 0;
}

export function linksIn(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((m) => (m[1] ?? "").trim()).filter(Boolean);
}

/** The picked links that the text still holds: as [[Title]], or as the #Title token a # pick wrote. */
export function refsIn(state: Pick<ComposerState, "text" | "refs">): ComposerRef[] {
  const named = new Set(linksIn(state.text));
  const seen = new Set<string>();
  const out: ComposerRef[] = [];
  for (const r of state.refs ?? []) {
    const still = r.token === "#" ? state.text.includes(`#${r.title}`) : named.has(r.title);
    if (!still || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/** The payload and the cleared state in one step: the field empties in the same call, before any server answer. */
export function sendNow(state: ComposerState, answers: string, mode: SendMode = "queue"): { payload: ComposerSend; next: ComposerState } | null {
  if (!canSend(state)) return null;
  const payload: ComposerSend = { text: state.text.trim(), chips: state.chips.slice(), files: state.files.slice(), folder: state.folder, links: linksIn(state.text), refs: refsIn(state), mode, answers };
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
  if (trigger.ch === ":") {
    const insert = `${item.body ?? item.label} `;
    return { next: place(before + insert + after.replace(/^ /, ""), before.length + insert.length), effect: { kind: "none" } };
  }
  if (trigger.ch === "[[") {
    const insert = `[[${item.label}]] `;
    const next = place(before + insert + after, before.length + insert.length);
    return { next: item.ref === undefined ? next : { ...next, refs: [...(state.refs ?? []).filter((r) => r.id !== item.ref), { kind: item.kind, id: item.ref, title: item.label }] }, effect: { kind: "none" } };
  }
  if (trigger.ch === "/") {
    if (item.kind === "Template" || item.kind === "Snippet") {
      const insert = item.body ?? item.label;
      return { next: place(before + insert + after, before.length + insert.length), effect: { kind: "none" } };
    }
    if (item.arg !== undefined) {
      // a command that needs words: write its name and let the person type them; Enter then runs it
      const insert = `/${item.body ?? item.label} `;
      return { next: place(before + insert + after, before.length + insert.length), effect: { kind: "none" } };
    }
    return { next: place(before + after, before.length), effect: { kind: "command", name: item.body ?? item.label } };
  }
  if (item.kind === "Folder") {
    const cleared = place(before + after, before.length);
    return { next: { ...cleared, folder: item.label }, effect: { kind: "folder", folder: item.label } };
  }
  // anything else becomes an inline token in the text, "#Title", kept with its id while the text still holds it
  const insert = `#${item.label} `;
  const next = place(before + insert + after.replace(/^ /, ""), before.length + insert.length);
  if (item.ref === undefined) return { next, effect: { kind: "none" } };
  return { next: { ...next, refs: [...(state.refs ?? []).filter((r) => r.id !== item.ref), { kind: item.kind, id: item.ref, title: item.label, token: "#" }] }, effect: { kind: "none" } };
}

/** From Files: the picked file joins the tray as the file itself (its id), and the # typed to find it goes. */
export function applyAttachPick(state: ComposerState, trigger: Trigger, item: PopupItem): ComposerState {
  const text = state.text.slice(0, trigger.start) + state.text.slice(trigger.end);
  const size = Number(item.data?.["size"]);
  const file: ComposerAttachment = { name: item.label, ...(item.ref === undefined ? {} : { fileId: item.ref }), ...(Number.isFinite(size) && item.data?.["size"] !== undefined ? { size } : {}) };
  if (state.files.some((f) => f.fileId !== undefined && f.fileId === file.fileId)) return { ...state, text, cursor: trigger.start, active: -1, dismissedAt: -1 };
  return { ...state, text, cursor: trigger.start, files: [...state.files, file], active: -1, dismissedAt: -1 };
}

/** What Enter does. Enter sends (Shift+Enter writes a line); in email mode Cmd/Ctrl+Enter sends. While an agent works a plain send queues and Option+Enter (or Cmd/Ctrl+Enter) sends now. */
export function enterAction(key: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; isComposing?: boolean }, enterSends: boolean, working: boolean): "send" | "interrupt" | "newline" {
  if (key.isComposing === true) return "newline";
  const mod = key.metaKey === true || key.ctrlKey === true;
  const alt = key.altKey === true;
  const sends = enterSends ? key.shiftKey !== true : mod;
  if (!sends) return "newline";
  return working && (mod || alt) ? "interrupt" : "send";
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
export const ICON_STOP = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="2"/></svg>';
export const ICON_PLUS = svg('<path d="M8 3.500v9M3.500 8h9"/>');
export const ICON_CLIP = svg('<path d="M13 7.5L7.800 12.700a3 3 0 01-4.200-4.200l5.500-5.500a2 2 0 012.800 2.800L6.400 11.300a1 1 0 01-1.400-1.400l4.800-4.800"/>');
export const ICON_FOLDER = svg('<path d="M2.500 4.500a1 1 0 011-1h3l1.500 1.500h4.500a1 1 0 011 1v6a1 1 0 01-1 1h-9a1 1 0 01-1-1z"/>');
export const ICON_FILE = svg('<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>');
export const ICON_RECORD = svg('<rect x="2.500" y="2.500" width="11" height="11" rx="1.500"/><path d="M2.500 6h11M6.500 6v7.500"/>');

/* ---------- the component ---------- */

/** What the # preview pane shows for the item the person is on: a record's key fields, a file's size and editor. */
export interface ComposerPreview {
  title?: string;
  sub?: string;
  fields: readonly (readonly [string, string])[];
}

export interface ComposerProps extends ComposerShellProps {
  lists?: ComposerLists;
  /** Agents that listen in this thread (answer only when @mentioned). The lead comes from `lead`. */
  listening?: readonly string[];
  /** Kept for callers; # is one grouped search now. */
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
  /** Attach from Vyre Files, where the place opens its own picker. Without it (and with `suggest`) From Files searches Files in the # picker. */
  onAttach?: () => void;
  /** Recipients for a composer that sends outside. Mounted above the field. */
  recipients?: ReactNode;
  banner?: ReactNode;
  /** Leaves out the agent strip (a place whose agent is chosen next to the box, such as Home's Ask). */
  hideWho?: boolean;
  /** In the bar after the agent controls. */
  whoExtra?: ReactNode;
  /** Buttons in the bar after the agent strip and mode: the place adds its own controls here. */
  barExtra?: ReactNode;
  /** Enter writes a new line and Cmd/Ctrl+Enter sends (email). Default true: Enter sends. */
  enterSends?: boolean;
  density?: "regular" | "compact";
  testID?: string;
  /** What the place knows about the agents that may answer: provider, model, account, effort, context. */
  agents?: readonly ComposerAgent[];
  /** The model panel for an answering agent, opened from the strip. Without it the strip only shows. */
  renderPanel?: (agent: ComposerAgent, close: () => void, narrow: boolean) => ReactNode;
  /** The model menu opens under the composer instead of over it (the first screen, where the composer sits high). */
  panelBelow?: boolean;
  /** Where the chat runs, when it is not this computer: "On Northwind" in the pill. */
  runsChip?: string;
  /** The chat's mode; with onMode the chip shows and Shift+Tab cycles it. */
  mode?: ChatMode;
  onMode?: (mode: ChatMode) => void;
  /** Search for # and [[ as the person types (the place's search capabilities). The lists it returns replace the given ones for that menu. */
  suggest?: (ch: "#" | "[[", q: string) => Promise<ComposerLists>;
  /** The preview pane of the # picker. */
  preview?: (item: PopupItem) => Promise<ComposerPreview | null>;
}

interface KeyLike {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  preventDefault?: () => void;
}

interface ChangeLike {
  nativeEvent: { text?: string; target?: { selectionStart?: number | null } };
}

const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});
const MIN_FIELD = 22;
const MAX_FIELD = 220;
const FIELD_STYLE = { outlineStyle: "none", outlineWidth: 0, backgroundColor: "transparent" } as unknown as TextStyle;
const BOX_SHADOW = { boxShadow: "var(--sh-2)" } as unknown as ViewStyle;
const FOCUS_SHADOW = BOX_SHADOW;
const HOVER = { backgroundColor: "var(--hover)" };
const web = Platform.OS === "web";

const KIND_LOOK: Record<string, { icon: string; tint: string }> = {
  Record: { icon: I.record, tint: "#5a7be0" }, File: { icon: I.file, tint: "#d24b45" }, Folder: { icon: I.folder, tint: "#c98a16" }, Chat: { icon: I.chat, tint: "#7e7c77" },
  Automation: { icon: I.bolt, tint: "#e0a33a" }, Project: { icon: I.project, tint: "#3f8f78" }, Channel: { icon: I.channel, tint: "#8b7cf6" },
};
const lookOf = (kind: string): { icon: string; tint: string } => KIND_LOOK[kind] ?? { icon: I.hash, tint: "#7e7c77" };
const MODE_ICON: Record<ChatMode, string> = { ask: I.lock, auto: I.bolt, plan: I.plan };

function anchorOf(e: unknown): { x: number; y: number } {
  const ev = e as { nativeEvent?: { pageX?: number; pageY?: number }; currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } };
  const box = ev.currentTarget?.getBoundingClientRect?.();
  if (box) return { x: box.left, y: box.bottom + 4 };
  return { x: ev.nativeEvent?.pageX ?? 0, y: ev.nativeEvent?.pageY ?? 0 };
}

interface TrayChip { key: string; icon: string; name: string; onRemove?: () => void }

function Chip({ chip }: { chip: TrayChip }): ReactElement {
  return (
    <View style={styles.chip} testID={`composer-chip-${chip.key}`}>
      <MenuIcon icon={chip.icon} size={13} color="var(--ink-3)" />
      <Text numberOfLines={1} style={styles.chipText}>{chip.name}</Text>
      {chip.onRemove ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${chip.name}`} onPress={chip.onRemove} style={({ hovered }: { hovered?: boolean }) => [styles.chipX, hovered === true && HOVER]}>
          <Text style={styles.chipXText}>{"×"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const thumbs = new WeakMap<object, string>();
function thumbOf(f: ComposerAttachment): string | null {
  const file = f.file as { type?: string } | undefined;
  if (!web || !file || typeof file !== "object" || !String(f.mime ?? file.type ?? "").startsWith("image/")) return null;
  const U = (globalThis as { URL?: { createObjectURL?: (b: unknown) => string } }).URL;
  if (!U?.createObjectURL) return null;
  let url = thumbs.get(file);
  if (url === undefined) {
    try { url = U.createObjectURL(file); } catch { return null; }
    thumbs.set(file, url);
  }
  return url;
}

/** One attached file in the tray: a thumbnail or a file mark, the name, the size, and a remove button that shows on hover. */
function FileCard({ f, onRemove, testID }: { f: ComposerAttachment; onRemove?: () => void; testID: string }): ReactElement {
  const thumb = thumbOf(f);
  return (
    <View style={styles.card} testID={testID} {...webProps({ dataSet: { cmpCard: "1" } })}>
      <View style={styles.cardIc}>
        {thumb ? createElement("img", { src: thumb, alt: "", style: { width: "100%", height: "100%", objectFit: "cover" } }) : <Glyph icon={I.file} native="□" size={15} color="var(--ink-2)" />}
      </View>
      <View style={styles.cardText}>
        <Text numberOfLines={1} style={styles.cardName}>{f.name}</Text>
        {f.size !== undefined ? <Text style={styles.cardSize}>{sizeLabel(f.size)}</Text> : f.fileId ? <Text style={styles.cardSize}>From Files</Text> : null}
      </View>
      {onRemove ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${f.name}`} onPress={onRemove} testID={`${testID}-remove`} style={styles.cardRm} {...webProps({ dataSet: { cmpRm: "1" } })}>
          <Text style={styles.cardRmText}>{"×"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The model pill: how this chat runs. Shown only when an AI will answer; a press opens the model menu. The mode and where it runs appear only when they are not the usual. */
function AgentStrip({ list, narrow, onPress, open, face, mode, runsChip, ring }: { list: readonly ComposerAgent[]; narrow: boolean; onPress?: () => void; open: boolean; face: boolean; mode?: ChatMode | undefined; runsChip?: string | undefined; ring: { pct: number; warn: boolean } | null }): ReactElement {
  const a = list[0] as ComposerAgent;
  const name = stripName(list);
  const title = a.modelTitle ?? "Auto";
  const label = `${name} will answer on ${title}${a.effort ? `, ${a.effort} effort` : ""}${onPress ? ". Mode, model, effort and limits" : ""}`;
  const body = (
    <>
      {face ? <Avatar {...avatarOf({ id: a.id, name: a.name, kind: a.kind === "assistant" ? "assistant" : "agent" })} size={20} /> : null}
      {mode !== undefined && mode !== "auto" ? <View style={styles.mchip} testID="composer-mode"><Text style={styles.mchipText}>{modeInfo(mode).label}</Text></View> : null}
      {runsChip !== undefined ? <View style={styles.rchip} testID="composer-runs"><Text numberOfLines={1} style={styles.rchipText}>{`On ${runsChip}`}</Text></View> : null}
      {narrow ? null : <Text numberOfLines={1} style={styles.stripModelText}>{`${title}${a.accountName ? ` · ${a.accountName}` : ""}`}</Text>}
      <EffortBars effort={a.effort} levels={effortsFor(a.provider).length} testID="composer-effort" />
      {ring ? <ContextRing pct={ring.pct} warn={ring.warn} size={18} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.strip} testID="composer-strip" accessibilityLabel={label}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} testID="composer-strip" onPress={onPress} {...webProps({ title: "Mode, provider, model, effort, limits" })}
      style={({ hovered }: { hovered?: boolean }) => [styles.strip, (hovered === true || open) && HOVER]}>
      {body}
    </Pressable>
  );
}

/** The field's tokens, drawn behind the text: a wash under each #link, @mention and [[link]]. The text itself stays the field's own. */
function TokenBackdrop({ text, ranges, scrollY, style }: { text: string; ranges: readonly TokenRange[]; scrollY: number; style: TextStyle }): ReactElement {
  const parts: ReactElement[] = [];
  let at = 0;
  ranges.forEach((r, i) => {
    if (r.start > at) parts.push(<Text key={`t${i}`}>{text.slice(at, r.start)}</Text>);
    parts.push(<Text key={`k${i}`} style={styles.tok} testID={`composer-token-${r.kind}`}>{text.slice(r.start, r.end)}</Text>);
    at = r.end;
  });
  if (at < text.length) parts.push(<Text key="rest">{text.slice(at)}</Text>);
  return (
    <View pointerEvents="none" style={[styles.backdrop, { transform: [{ translateY: -scrollY }] }]} testID="composer-tokens" aria-hidden>
      <Text style={[style, styles.ghost]} {...webProps({ dataSet: { cmpGhost: "1" } })}>{parts}{"​"}</Text>
    </View>
  );
}

export function Composer(props: ComposerProps): ReactElement {
  ensureComposerCss();
  const symbols = composerSymbols(props);
  const enterSends = props.enterSends !== false;
  const [state, setState] = useState<ComposerState>(() => initialState(props.value ?? "", props.folder ?? null));
  const [focused, setFocused] = useState(false);
  const [height, setHeight] = useState(MIN_FIELD);
  const [plusOpen, setPlusOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [scope, setScope] = useState<HashScope>("All");
  const [attachMode, setAttachMode] = useState(false);
  const [found, setFound] = useState<{ key: string; lists: ComposerLists } | null>(null);
  const [previews, setPreviews] = useState<Record<string, ComposerPreview | null | "loading">>({});
  const [drop, setDrop] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const input = useRef<TextInput | null>(null);
  const picker = useRef<unknown>(null);
  const blur = useRef<ReturnType<typeof setTimeout> | null>(null);
  const plusNode = useRef<unknown>(null);
  const plusBtn = useRef<unknown>(null);
  const panelNode = useRef<unknown>(null);
  const stripNode = useRef<unknown>(null);
  const menu = useMenu();
  const width = useWindowDimensions().width;
  const narrow = width > 0 && width < 520;
  // a composer opened with words in it (Ask about this file, New message) is ready to type after them
  useEffect(() => { if ((props.value ?? "") !== "") input.current?.focus?.(); }, []);

  useEffect(() => {
    if (props.value !== undefined && props.value !== stateRef.current.text) setState((s) => ({ ...s, text: props.value ?? "", cursor: (props.value ?? "").length }));
  }, [props.value]);
  useEffect(() => {
    if (props.folder !== undefined) setState((s) => (s.folder === (props.folder ?? null) ? s : { ...s, folder: props.folder ?? null }));
  }, [props.folder]);
  useEffect(() => () => {
    if (blur.current !== null) clearTimeout(blur.current);
  }, []);
  useDismiss(plusOpen, () => setPlusOpen(false), () => [plusNode.current as never, plusBtn.current as never]);
  useDismiss(panelOpen, () => setPanelOpen(false), () => [panelNode.current as never, stripNode.current as never]);

  const lists = props.lists ?? {};
  const hasLead = props.lead !== undefined && props.lead.length > 0;
  const whoCtx: WhoContext | undefined = hasLead || lists.agents !== undefined || lists.people !== undefined
    ? { ...(hasLead ? { lead: props.lead as string } : {}), ...(props.listening === undefined ? {} : { listening: props.listening }), ...(lists.agents === undefined ? {} : { agents: lists.agents }), ...(lists.people === undefined ? {} : { people: lists.people }) }
    : undefined;
  const who = answerLine(state.text, props.whoWillAnswer, whoCtx);
  const answerers = props.sendsOutside === true || props.hideWho === true ? [] : answering(who.responders, props.agents);
  const ai = answerers.length > 0;

  const trigger = useMemo(() => detectTrigger(state.text, state.cursor, symbols), [state.text, state.cursor, symbols.join(",")]);
  const searchKey = trigger !== null && (trigger.ch === "#" || trigger.ch === "[[") ? `${trigger.ch}\u0000${trigger.query}` : null;
  useEffect(() => {
    if (searchKey === null || !props.suggest || trigger === null) return undefined;
    let live = true;
    const ch = trigger.ch as "#" | "[[";
    const q = trigger.query;
    const t = setTimeout(() => {
      void props.suggest?.(ch, q).then((l) => { if (live) setFound({ key: searchKey, lists: l }); }, () => undefined);
    }, 150);
    return () => { live = false; clearTimeout(t); };
  }, [searchKey]);
  useEffect(() => { if (trigger === null) { setAttachMode(false); setScope("All"); } }, [trigger === null]);
  const effective: ComposerLists = found !== null && searchKey !== null && found.key.split("\u0000")[0] === trigger?.ch ? { ...lists, ...found.lists } : lists;
  const pickScope: HashScope = attachMode ? "Files" : scope;
  const entries = useMemo(() => (trigger === null ? [] : popupFor(trigger, effective, true, trigger.ch === "#" ? pickScope : "All")), [trigger, effective, pickScope]);
  const hashLike = trigger !== null && (trigger.ch === "#" || trigger.ch === "[[");
  const open = trigger !== null && focused && trigger.start !== state.dismissedAt && (entries.length > 0 || hashLike);
  const selectable = popupSelectable(entries);
  const active = open ? (selectable.includes(state.active) ? state.active : selectable[0] ?? -1) : -1;
  const activeItem = active >= 0 ? entries[active] : undefined;
  const activeKey = activeItem && isPopupItem(activeItem) ? `${activeItem.kind}:${activeItem.ref ?? activeItem.label}` : null;
  useEffect(() => {
    if (!open || !hashLike || !props.preview || activeKey === null || previews[activeKey] !== undefined || !activeItem || !isPopupItem(activeItem)) return;
    setPreviews((p) => ({ ...p, [activeKey]: "loading" }));
    void props.preview(activeItem).then((pv) => setPreviews((p) => ({ ...p, [activeKey]: pv })), () => setPreviews((p) => ({ ...p, [activeKey]: null })));
  }, [open, activeKey]);

  const working = props.working === true;
  const hasContent = canSend(state);
  const control = sendControl(working, hasContent);
  const ring = ai ? contextRing(answerers[0]?.context) : null;
  const showMode = ai && props.mode !== undefined && props.onMode !== undefined;

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
    else props.onSubmit?.(sent.payload);
  }, [props.onSend, props.onSubmit, props.onInterrupt, props.whoWillAnswer, props.lead, props.listening, props.lists]);

  const pick = useCallback((entry: PopupEntry | undefined) => {
    const cur = stateRef.current;
    if (entry === undefined || !isPopupItem(entry)) return;
    const t = detectTrigger(cur.text, cur.cursor, symbols);
    if (t === null) return;
    if (attachMode && entry.kind === "File") {
      const next = applyAttachPick(cur, t, entry);
      stateRef.current = next;
      setState(next);
      setAttachMode(false);
      props.onChange?.(next.text);
      input.current?.focus?.();
      return;
    }
    const done = applyPick(cur, t, entry);
    stateRef.current = done.next;
    setState(done.next);
    if (done.effect.kind === "folder") props.onFolder?.(done.effect.folder);
    if (done.effect.kind === "command") props.onCommand?.(done.effect.name);
    props.onChange?.(done.next.text);
    input.current?.focus?.();
  }, [props.onFolder, props.onCommand, props.onChange, symbols.join(","), attachMode]);

  const addFiles = useCallback((files: ComposerAttachment[]) => {
    if (files.length === 0) return;
    setState((s) => ({ ...s, files: [...s.files, ...files] }));
    props.onFiles?.(files);
  }, [props.onFiles]);

  /** Upload: the system picker on the web; a place's own sheet elsewhere. */
  const upload = useCallback(() => {
    const node = picker.current as { click?: () => void } | null;
    if (node?.click) { node.click(); return; }
    props.onAttach?.();
  }, [props.onAttach]);

  const typeSymbol = (mark: string): void => {
    const cur = stateRef.current;
    const text = cur.text + (cur.text.length > 0 && !/\s$/.test(cur.text) ? " " : "") + mark;
    const next = { ...cur, text, cursor: text.length, active: -1, dismissedAt: -1 };
    stateRef.current = next;
    setState(next);
    setFocused(true);
    if (blur.current !== null) clearTimeout(blur.current);
    input.current?.focus?.();
  };
  const fromFiles = (): void => {
    setPlusOpen(false);
    if (props.onAttach) { props.onAttach(); return; }
    setAttachMode(true);
    setScope("Files");
    typeSymbol("#");
  };
  const cycleMode = (): void => { if (props.mode && props.onMode) props.onMode(nextMode(props.mode)); };

  const names = useMemo(() => [...(lists.agents ?? []), ...(lists.people ?? [])].map((x) => (typeof x === "string" ? x : x.t)), [lists.agents, lists.people]);
  const ranges = useMemo(() => tokenRanges(state.text, state.refs, names), [state.text, state.refs, names]);

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
      if ((k.key === "Enter" || k.key === "Tab") && active >= 0) {
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
    if (k.key === "Escape" && panelOpen) { stop(); setPanelOpen(false); return; }
    if (k.key === "Escape" && plusOpen) { stop(); setPlusOpen(false); return; }
    if (k.key === "Escape" && working && control === "stop") {
      stop();
      props.onStop?.();
      return;
    }
    if (k.key === "Tab" && k.shiftKey === true && showMode) {
      stop();
      cycleMode();
      return;
    }
    if (k.key === "Backspace") {
      const cur = stateRef.current;
      if (cur.text.length === 0 && cur.chips.length > 0) {
        stop();
        setState((s) => ({ ...s, chips: s.chips.slice(0, -1) }));
        return;
      }
      const gone = deleteToken(cur.text, cur.cursor, ranges);
      if (gone) {
        stop();
        const next = { ...cur, text: gone.text, cursor: gone.cursor };
        stateRef.current = next;
        setState(next);
        props.onChange?.(gone.text);
        return;
      }
    }
    if (k.key === "Enter") {
      const action = enterAction(k, enterSends, working);
      if (action === "newline") return;
      stop();
      submit(action === "interrupt" ? "interrupt" : "queue");
    }
  };

  const onChange = (event: ChangeLike): void => {
    const typed = event.nativeEvent.text ?? stateRef.current.text;
    const at = event.nativeEvent.target?.selectionStart;
    const typedAt = typeof at === "number" ? at : typed.length;
    const closed = closeEmoji(typed, typedAt);
    const text = closed?.text ?? typed;
    const cursor = closed?.cursor ?? typedAt;
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
    attach: upload,
    paste: () => void paste(),
    clear: () => {
      setState((s) => ({ ...initialState("", s.folder), cursor: 0 }));
      setHeight(MIN_FIELD);
    },
  });
  const contextProps = menuTrigger((x, y) => menu.show(menuItems(), x, y, "context", { label: "Composer" }));

  /* ---------- the tray ---------- */
  const chips: TrayChip[] = [];
  if (state.folder !== null) chips.push({ key: "folder", icon: ICON_FOLDER, name: state.folder, onRemove: () => { patch({ folder: null }); props.onFolder?.(null); } });
  state.chips.forEach((c, i) => chips.push({ key: `c${i}`, icon: CHIP_ICON[c.kind] ?? "link", name: c.name, onRemove: () => setState((s) => ({ ...s, chips: s.chips.filter((_, j) => j !== i) })) }));
  (props.chips ?? []).forEach((c, i) => chips.push({ key: `p${i}`, icon: CHIP_ICON[c.kind] ?? "link", name: c.name }));
  const cards: ReactElement[] = [];
  state.files.forEach((f, i) => cards.push(<FileCard key={`f${i}`} f={f} testID={`composer-file-${i}`} onRemove={() => setState((s) => ({ ...s, files: s.files.filter((_, j) => j !== i) }))} />));
  (props.attachments ?? []).forEach((f, i) => cards.push(<FileCard key={`a${i}`} f={f} testID={`composer-attachment-${i}`} />));

  /* ---------- popovers ---------- */
  const compact = props.density === "compact";
  const popLeft = { left: compact ? 6 : 10, bottom: "100%", marginBottom: 8 } as unknown as ViewStyle;

  const plusRows: ReactElement[] = [];
  const plusRow = (id: string, title: string, icon: string, onPress: () => void, trailing?: ReactNode): void => {
    plusRows.push(<Row key={id} id={id} title={title} leading={<View style={styles.lead}><IconTile icon={icon} /></View>} {...(trailing ? { trailing } : {})} onPress={onPress} domProps={{ style: { minHeight: 38, borderRadius: 10 } }} />);
  };
  if (plusOpen) {
    plusRow("plus-upload", "Upload files", I.file, () => { setPlusOpen(false); upload(); }, <Text style={styles.rowNote}>or drop</Text>);
    if (props.onAttach || (props.suggest && symbols.includes("hash"))) plusRow("plus-files", "From Files", I.folder, fromFiles);
    if (symbols.includes("hash")) plusRow("composer-symbol-hash", "Link something", I.hash, () => { setPlusOpen(false); typeSymbol("#"); }, <Kbd k="#" />);
    if (symbols.includes("at")) plusRow("composer-symbol-at", "Mention", I.at, () => { setPlusOpen(false); typeSymbol("@"); }, <Kbd k="@" />);
    if (symbols.includes("slash")) plusRow("composer-symbol-slash", "Commands", I.slash, () => { setPlusOpen(false); typeSymbol("/"); }, <Kbd k="/" />);
    if (showMode && props.mode) {
      plusRows.push(<GroupHead key="g-chat" label="This chat" />);
      plusRow("plus-mode", `Mode: ${modeInfo(props.mode).label}`, MODE_ICON[props.mode], () => { setPlusOpen(false); cycleMode(); }, <Kbd k={"⇧⇥"} />);
    }
  }

  const listNodes: ReactElement[] = [];
  if (open) {
    for (const [i, entry] of entries.entries()) {
      if (!isPopupItem(entry)) { listNodes.push(<GroupHead key={`h${entry.head}`} label={entry.head} />); continue; }
      const hover = { onMouseEnter: () => patch({ active: i }), style: { minHeight: 38, borderRadius: 10 } };
      if (trigger?.ch === "@") {
        const agent = entry.kind === "Agent";
        listNodes.push(<Row key={`${entry.group}:${entry.label}`} id={`pop-${i}`} title={entry.label} {...(entry.note === undefined ? {} : { note: entry.note })} selected={i === active} onPress={() => pick(entry)}
          leading={<View style={styles.lead}><Avatar {...avatarOf({ ...(entry.ref === undefined ? {} : { id: entry.ref }), name: entry.label, kind: agent ? "agent" : "person" })} size={24} /></View>} domProps={hover} />);
      } else if (trigger?.ch === ":") {
        listNodes.push(<Row key={`emoji:${entry.label}`} id={`pop-${i}`} title={`:${entry.note?.replace(/ /g, "_") ?? ""}`} selected={i === active} onPress={() => pick(entry)} {...hover}
          leading={<View style={styles.lead}><Text style={{ fontSize: 20 }}>{entry.label}</Text></View>} />);
      } else if (trigger?.ch === "/") {
        const icon = entry.kind === "Template" || entry.kind === "Snippet" ? I.template : entry.group === "Skills" ? I.skill : I.cmd;
        const title = entry.kind === "Template" || entry.kind === "Snippet" ? entry.label : `/${entry.label}`;
        listNodes.push(<Row key={`${entry.group}:${entry.label}`} id={`pop-${i}`} title={title} {...(entry.note === undefined ? {} : { note: entry.note })} selected={i === active} onPress={() => pick(entry)} leading={<View style={styles.lead}><IconTile icon={icon} /></View>} domProps={hover} />);
      } else {
        const look = lookOf(entry.kind);
        listNodes.push(<Row key={`${entry.group}:${entry.ref ?? entry.label}`} id={`pop-${i}`} title={entry.label} {...(entry.note === undefined ? {} : { note: entry.note })} selected={i === active} onPress={() => pick(entry)} leading={<View style={styles.lead}>{entry.data?.["brand"] ? <AppIcon brand={entry.data["brand"]} size={24} /> : <IconTile icon={look.icon} tint={look.tint} />}</View>} domProps={hover} />);
      }
    }
  }
  const showScopeMenu = (e: unknown): void => {
    const p = anchorOf(e);
    menu.show(["All", ...HASH_GROUPS].map((g): MenuEntry => ({ label: g === "All" ? "Everything" : g, checked: pickScope === g, onSelect: () => { setScope(g as HashScope); setAttachMode(false); } })), p.x, p.y, "other", { label: "Search in" });
  };
  const pv = activeItem && isPopupItem(activeItem) ? activeItem : null;
  const pvData = activeKey !== null ? previews[activeKey] : undefined;
  const preview = pv ? (
    <View style={styles.pv} testID="composer-preview">
      <View style={[styles.pvBig, { backgroundColor: lookOf(pv.kind).tint }]}><Glyph icon={lookOf(pv.kind).icon} native={"□"} size={20} color="#fff" /></View>
      <Text style={styles.pvTitle} numberOfLines={2}>{pvData && pvData !== "loading" && pvData.title ? pvData.title : pv.label}</Text>
      {(pvData && pvData !== "loading" && pvData.sub) || pv.note ? <Text style={styles.pvSub} numberOfLines={2}>{pvData && pvData !== "loading" && pvData.sub ? pvData.sub : pv.note}</Text> : null}
      {pvData === "loading" ? <Text style={styles.pvSub}>Loading</Text> : null}
      {pvData && pvData !== "loading" ? (
        <View style={styles.kv} testID="composer-preview-fields">
          {/* ui-rows-lint: not a list (key and value pairs in the # preview) */}
          {pvData.fields.map(([k, v]) => (
            <View key={k} style={styles.kvRow}><Text style={styles.kvK}>{k}</Text><Text style={styles.kvV} numberOfLines={1}>{v}</Text></View>
          ))}
        </View>
      ) : null}
      <Text style={styles.pvAct}>{attachMode && pv.kind === "File" ? "↵ attaches it" : pv.kind === "Folder" ? "↵ files this chat in it" : "↵ links it · the agent can read it"}</Text>
    </View>
  ) : null;

  const hashPop = open && hashLike ? (
    <Pop testID="composer-popup" label={attachMode ? "Attach from Files" : "Link something"} style={[popLeft, styles.hashPop, narrow ? styles.hashNarrow : null] as ViewStyle[]}>
      <View style={styles.hashLeft}>
        <View style={styles.scopeBar}>
          <Glyph icon={I.hash} native="#" size={14} color="var(--ink-3)" />
          <Text style={styles.scopeLabel}>{attachMode ? "Attach" : trigger?.ch === "[[" ? "Link a record" : "Link"}</Text>
          {trigger?.ch === "#" ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Search in: ${pickScope === "All" ? "Everything" : pickScope}`} testID="composer-scope" onPress={showScopeMenu} style={({ hovered }: { hovered?: boolean }) => [styles.scopeBtn, hovered === true && HOVER]}>
              <Text style={styles.scopeValue}>{pickScope === "All" ? "Everything" : pickScope}</Text>
              <Glyph icon={I.chev} native={"▾"} size={12} color="var(--ink-3)" />
            </Pressable>
          ) : null}
          <Text style={styles.scopeQ} numberOfLines={1}>{trigger?.query ? `“${trigger.query}”` : "type to search"}</Text>
        </View>
        <View style={styles.scr} accessibilityRole="menu" {...webProps({ role: "listbox" })}>
          {listNodes.length > 0 ? listNodes : <Text style={styles.empty} testID="composer-popup-empty">{trigger?.query ? `Nothing called “${trigger.query}”` : "Type to search"}</Text>}
        </View>
      </View>
      {narrow ? null : preview}
    </Pop>
  ) : null;
  const listPop = open && !hashLike ? (
    <Pop testID="composer-popup" label={trigger?.ch === "@" ? "Mention" : trigger?.ch === ":" ? "Emoji" : "Commands"} style={[popLeft, { width: trigger?.ch === "@" ? 300 : 340, maxWidth: "100%" } as ViewStyle]}>
      <View style={styles.scr} accessibilityRole="menu" {...webProps({ role: "listbox" })}>{listNodes}</View>
    </Pop>
  ) : null;

  /* ---------- send ---------- */
  const sendTitle = enterSends ? "Send (↵)" : "Send (⌘↵)";
  let sendNode: ReactElement;
  if (control === "split") {
    sendNode = (
      <View style={styles.split} testID="composer-split">
        <Pressable accessibilityRole="button" accessibilityLabel="Queue" testID="composer-send" onPress={() => submit("queue")} {...webProps({ title: "Send after this step" })} style={({ hovered }: { hovered?: boolean }) => [styles.splitBtn, hovered === true && styles.splitHover]}>
          <Text style={styles.splitText}>Queue</Text><Text style={styles.splitKbd}>{"↵"}</Text>
        </Pressable>
        <View style={styles.splitSep} />
        <Pressable accessibilityRole="button" accessibilityLabel="Interrupt and send now" testID="composer-interrupt" onPress={() => submit("interrupt")} {...webProps({ title: "Interrupt and send now" })} style={({ hovered }: { hovered?: boolean }) => [styles.splitBtn, hovered === true && styles.splitHover]}>
          <Text style={styles.splitText}>Now</Text><Text style={styles.splitKbd}>{"⌥↵"}</Text>
        </Pressable>
      </View>
    );
  } else if (control === "stop") {
    sendNode = (
      <Pressable accessibilityRole="button" accessibilityLabel="Stop" testID="composer-send" onPress={() => props.onStop?.()} {...webProps({ title: "Stop" })} style={[styles.send, styles.sendStop]}>
        <Glyph icon={STOP} native={"■"} size={14} color="var(--ink)" />
      </Pressable>
    );
  } else {
    sendNode = (
      <Pressable accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: !hasContent }} disabled={!hasContent} onPress={() => submit("queue")} testID="composer-send" {...webProps({ title: sendTitle })} style={[styles.send, !hasContent && styles.sendOff]}>
        <Glyph icon={I.up} native={"↑"} size={16} color={hasContent ? "var(--accent-ink)" : "var(--ink-3)"} />
      </Pressable>
    );
  }

  const fieldText = compact ? styles.fieldCompact : styles.fieldRegular;
  // an email keeps its own two rows: its bar holds sender and format buttons; everything else is the one-line pill
  const oneLine = props.sendsOutside !== true;
  const plusNode_ = (
    <View ref={plusBtn as never}>
      <Pressable accessibilityRole="button" accessibilityLabel="Attach a file" accessibilityState={{ expanded: plusOpen }} testID="composer-attach" onPress={() => { setPanelOpen(false); setPlusOpen((x) => !x); }} {...webProps({ title: "Add" })}
        style={({ hovered }: { hovered?: boolean }) => [styles.tool, (hovered === true || plusOpen) && HOVER]}>
        <Glyph icon={I.plus} native="+" size={18} color="var(--ink-3)" />
      </Pressable>
    </View>
  );
  const fieldNode = (
    <View style={[styles.fieldWrap, oneLine && styles.fieldLine, !oneLine && compact && styles.fieldWrapCompact]} {...webProps({ dataSet: { cmpField: "1" } })}>
      {web && ranges.length > 0 ? <TokenBackdrop text={state.text} ranges={ranges} scrollY={scrollY} style={fieldText} /> : null}
      <TextInput
        ref={input}
        multiline
        value={state.text}
        placeholder={props.placeholder ?? "Message"}
        placeholderTextColor="var(--ink-3)"
        accessibilityLabel={props.label ?? "Message"}
        onChange={onChange as never}
        onSelectionChange={(e) => patch({ cursor: e.nativeEvent.selection.start })}
        onKeyPress={onKeyPress as never}
        onContentSizeChange={(e) => setHeight(Math.max(MIN_FIELD, Math.min(MAX_FIELD, Math.ceil(e.nativeEvent.contentSize.height))))}
        onScroll={(e) => setScrollY(e.nativeEvent.contentOffset?.y ?? 0)}
        onFocus={onFocus}
        onBlur={onBlur}
        testID="composer-field"
        style={[styles.field, fieldText, FIELD_STYLE, { height }]}
        {...webProps({
          onPaste: (e: { clipboardData?: { files?: ArrayLike<FileLike>; }; preventDefault: () => void }) => {
            const files = Array.from(e.clipboardData?.files ?? [], (f) => attachmentOf(f, "Pasted image.png"));
            if (files.length > 0) {
              e.preventDefault();
              addFiles(files);
            }
          },
        })}
      />
    </View>
  );
  const stripNode_ = ai ? (
    <View ref={stripNode as never} style={styles.stripWrap}>
      <AgentStrip list={answerers} narrow={narrow} open={panelOpen} face={(props.agents?.length ?? 0) > 1} mode={showMode ? props.mode : undefined} runsChip={props.runsChip} ring={ring} {...(props.renderPanel ? { onPress: () => { setPlusOpen(false); setPanelOpen((x) => !x); } } : {})} />
    </View>
  ) : null;

  return (
    <View
      style={[styles.box, compact && styles.boxCompact, focused ? FOCUS_SHADOW : BOX_SHADOW, drop && styles.drop]}
      testID={props.testID ?? "composer"}
      accessibilityLabel={props.label ?? "Message"}
      {...contextProps}
      {...webProps({
        onDragOver: (e: { preventDefault: () => void }) => { e.preventDefault(); if (!drop) setDrop(true); },
        onDragLeave: () => setDrop(false),
        onDrop: (e: { preventDefault: () => void; dataTransfer?: { files?: ArrayLike<FileLike> } }) => {
          e.preventDefault();
          setDrop(false);
          addFiles(Array.from(e.dataTransfer?.files ?? [], attachmentOf));
        },
        dataSet: { composer: "true", ...(focused ? { cmpFocus: "1" } : {}) },
      })}
    >
      {props.sendsOutside ? <View style={styles.recipients} testID="composer-recipients">{props.recipients}</View> : null}
      {props.banner ? <View style={styles.banner}>{props.banner}</View> : null}
      {chips.length > 0 || cards.length > 0 ? (
        <View style={styles.tray} testID="composer-tray">
          {cards}
          {/* ui-rows-lint: not a list (attachment and link chips in the tray) */}
          {chips.map((c) => <Chip key={c.key} chip={c} />)}
        </View>
      ) : null}
      {props.engineLine ? <Text style={styles.engine} testID="composer-engine-line">{props.engineLine}</Text> : null}
      {props.hideWho === true ? null : <Text style={styles.srOnly} testID="composer-who" accessibilityRole="text" accessibilityLiveRegion="polite">{who.line}</Text>}
      {oneLine ? (
        <View style={styles.line}>
          {plusNode_}
          {fieldNode}
          {stripNode_}
          {props.barExtra}
          {props.whoExtra}
          {sendNode}
        </View>
      ) : (
        <>
          {fieldNode}
          <View style={[styles.bar, compact && styles.barCompact]}>
            {plusNode_}
            {stripNode_}
            {props.barExtra}
            {props.whoExtra}
            <View style={styles.spacer} />
            {sendNode}
          </View>
        </>
      )}
      {plusOpen ? (
        <Pop testID="composer-plus" label="Add" style={[popLeft, styles.plusPop] as ViewStyle[]} nodeRef={(n) => { plusNode.current = n; }}>
          <View style={styles.scr}>{plusRows}</View>
        </Pop>
      ) : null}
      {panelOpen && ai && props.renderPanel ? (
        <Pop testID="composer-panel" label="Model" style={[narrow ? styles.panelNarrow : styles.panelPop, props.panelBelow ? styles.panelBelow : null] as ViewStyle[]} nodeRef={(n) => { panelNode.current = n; }}>
          {props.renderPanel(answerers[0] as ComposerAgent, () => setPanelOpen(false), narrow)}
        </Pop>
      ) : null}
      {hashPop}
      {listPop}
      {Platform.OS === "web" ? createElement("input", {
        type: "file",
        multiple: true,
        hidden: true,
        "aria-hidden": true,
        tabIndex: -1,
        ref: (node: unknown) => { picker.current = node; },
        onChange: (e: { target: { files?: ArrayLike<FileLike>; value?: string } }) => {
          addFiles(Array.from(e.target.files ?? [], attachmentOf));
          e.target.value = "";
        },
      }) : null}
      {menu.element}
    </View>
  );
}

const CHIP_ICON: Record<string, string> = { Folder: ICON_FOLDER, Record: ICON_RECORD, File: ICON_FILE, Channel: "link" };

const styles = StyleSheet.create({
  box: { position: "relative", width: "100%", borderRadius: 22, backgroundColor: "var(--raised)" as string },
  boxCompact: { borderRadius: 18 },
  line: { flexDirection: "row", alignItems: "flex-end", gap: 2, padding: 7 },
  drop: { boxShadow: "0 0 0 2px var(--accent)" } as object,
  recipients: { paddingTop: 10, paddingHorizontal: 14 },
  banner: { paddingTop: 8, paddingHorizontal: 14 },
  tray: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 10, paddingHorizontal: 12 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, height: 26, paddingLeft: 8, paddingRight: 3, borderRadius: 999, backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line)" as string, maxWidth: "100%", alignSelf: "center" },
  chipText: { color: "var(--ink)" as string, fontSize: 12.5, lineHeight: 16, flexShrink: 1 },
  chipX: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  chipXText: { color: "var(--ink-3)" as string, fontSize: 14, lineHeight: 16 },
  card: { position: "relative", flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, paddingLeft: 6, paddingRight: 10, borderRadius: 12, backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line)" as string, maxWidth: 220 },
  cardIc: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--raised)" as string, overflow: "hidden" },
  cardText: { minWidth: 0, flexShrink: 1 },
  cardName: { fontSize: 12.5, color: "var(--ink)" as string },
  cardSize: { fontSize: 11.5, color: "var(--ink-3)" as string },
  cardRm: { position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 9, backgroundColor: "var(--ink)" as string, alignItems: "center", justifyContent: "center" },
  cardRmText: { color: "var(--win)" as string, fontSize: 12, lineHeight: 14 },
  engine: { color: "var(--ink-3)" as string, fontSize: 11.5, lineHeight: 16, paddingTop: 8, paddingHorizontal: 16 },
  fieldWrap: { position: "relative", paddingTop: 12, paddingHorizontal: 16, paddingBottom: 4, overflow: "hidden" },
  fieldWrapCompact: { paddingTop: 10, paddingHorizontal: 12 },
  fieldLine: { flex: 1, minWidth: 0, paddingTop: 6, paddingBottom: 6, paddingHorizontal: 6 },
  field: { width: "100%", color: "var(--ink)" as string, padding: 0, margin: 0, borderWidth: 0 },
  fieldRegular: { fontSize: 15, lineHeight: 22 },
  fieldCompact: { fontSize: 14, lineHeight: 22 },
  backdrop: { position: "absolute", left: 16, right: 16, top: 12 },
  ghost: { color: "transparent", whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "break-word" } as object,
  tok: { backgroundColor: "var(--accent-wash)" as string, borderRadius: 5, boxShadow: "0 0 0 2px var(--accent-wash)" } as object,
  srOnly: { position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 },
  bar: { flexDirection: "row", alignItems: "center", gap: 4, paddingTop: 4, paddingHorizontal: 8, paddingBottom: 8 },
  barCompact: { paddingBottom: 6, paddingHorizontal: 6 },
  tool: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  stripWrap: { flexShrink: 1, minWidth: 0 },
  strip: { flexDirection: "row", alignItems: "center", gap: 7, height: 34, paddingHorizontal: 9, borderRadius: 17, minWidth: 0 },
  stripModelText: { fontSize: 12.5, color: "var(--ink-3)" as string, flexShrink: 1 },
  mchip: { height: 20, paddingHorizontal: 7, borderRadius: 10, justifyContent: "center", backgroundColor: "var(--accent-wash)" as string },
  mchipText: { fontSize: 11.5, lineHeight: 20, color: "var(--accent)" as string },
  rchip: { height: 20, paddingHorizontal: 7, borderRadius: 10, justifyContent: "center", backgroundColor: "var(--sunk)" as string, flexShrink: 1 },
  rchipText: { fontSize: 11.5, lineHeight: 20, color: "var(--ink-3)" as string },
  spacer: { flex: 1 },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent)" as string, marginLeft: 2, flexShrink: 0 },
  sendStop: { backgroundColor: "var(--sel)" as string },
  sendOff: { backgroundColor: "var(--sel)" as string },
  split: { flexDirection: "row", alignItems: "center", height: 34, borderRadius: 17, backgroundColor: "var(--accent)" as string, overflow: "hidden", marginLeft: 2, flexShrink: 0 },
  splitBtn: { height: 34, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 5 },
  splitHover: { opacity: 0.85 },
  splitSep: { width: 1, height: 20, backgroundColor: "var(--accent-ink)" as string, opacity: 0.25 },
  splitText: { fontSize: 12.5, fontWeight: "600", color: "var(--accent-ink)" as string },
  splitKbd: { fontSize: 11, color: "var(--accent-ink)" as string, opacity: 0.6 },
  lead: { marginRight: 10 },
  rowNote: { fontSize: 11.5, color: "var(--ink-4)" as string },
  scr: { padding: 6, maxHeight: 360, overflow: "scroll" } as object,
  plusPop: { width: 280, maxWidth: "100%" } as object,
  panelPop: { right: 0, bottom: "100%", marginBottom: 8, overflow: "visible", borderWidth: 0 } as object,
  panelBelow: { bottom: "auto", top: "100%", marginBottom: 0, marginTop: 8 } as object,
  panelNarrow: { left: 0, right: 0, bottom: "100%", marginBottom: 8, maxHeight: 520, overflow: "scroll" } as object,
  hashPop: { flexDirection: "row", width: 640, maxWidth: "100%", overflow: "hidden" } as object,
  hashNarrow: { width: "100%", right: 6 } as object,
  hashLeft: { flex: 1, minWidth: 0 },
  scopeBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  scopeLabel: { fontSize: 12.5, color: "var(--ink-3)" as string },
  scopeBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 },
  scopeValue: { fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string },
  scopeQ: { marginLeft: "auto", fontSize: 12, color: "var(--ink-4)" as string, flexShrink: 1 },
  empty: { fontSize: 12.5, color: "var(--ink-3)" as string, padding: 10 },
  pv: { width: 240, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, padding: 16, gap: 10, backgroundColor: "var(--win)" as string },
  pvBig: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  pvTitle: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  pvSub: { fontSize: 12, color: "var(--ink-3)" as string },
  kv: { gap: 4 },
  kvRow: { flexDirection: "row", gap: 10 },
  kvK: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-3)" as string, minWidth: 60 },
  kvV: { fontSize: 12.5, color: "var(--ink)" as string, flexShrink: 1 },
  pvAct: { marginTop: "auto", fontSize: 12, color: "var(--ink-3)" as string },
});
