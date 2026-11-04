// ui/RichEditor MarkdownEditor: the one editor for every Markdown body in the app (Files .md, AGENT.md, SKILL.md, a task's description and notes, a note, a long-text field).
// Styled mode edits the page as it will read: headings, lists, checklists, quotes, code and links render as you type, with a slim formatting bar, a bubble on a selection, shortcuts and
// Markdown shortcuts. Markdown mode is the raw text in a readable font with colour on the syntax. What is handed back (onChange) is plain .md, the same text agents read (mdtree.ts).
// Paste loses the indent it was copied with and Markdown becomes its structure. The editor saves nothing itself: the host keeps the text (autosave.ts) and shows the version.
// Web mounts TipTap; the phone keeps a plain multiline field until a native editor exists (the same rule as the Notes editor).

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import { MenuIcon, useMenu } from "../Menu/index.tsx";
import { Row } from "../Row/index.tsx";
import { MarkdownText } from "../stream/MarkdownText.tsx";
import { blockOfLine, dedentPaste, docToMarkdown, looksLikeMarkdown, markdownToDoc } from "./mdtree.ts";
import type { PMNode } from "./mdtree.ts";

export type MarkdownView = "styled" | "raw";

/** One row of a suggestion menu. */
export interface SuggestItem { id: string; label: string; detail?: string }

/**
 * A menu that opens at the caret when the text before it ends in a trigger: `[[` for a page link, `@` for a person. The editor reports what was typed after the trigger (onQuery, null when the menu closes), the host
 * answers with the rows to show, and a pick writes `insert(item)` in place of the trigger and the query. Arrows move, Enter or Tab pick, Escape closes, a press picks.
 */
export interface SuggestOptions {
  trigger: "[[" | "@";
  items: readonly SuggestItem[];
  onQuery: (query: string | null) => void;
  /** The text a pick writes. Default: [[Label]] for [[, @Label and a space for @. */
  insert?: (item: SuggestItem) => string;
  label: string;
  menuTestID?: string;
  itemTestID?: (item: SuggestItem) => string;
}

export interface MarkdownEditorProps {
  /** The Markdown the editor shows. A value that is not the text the editor last reported replaces what it shows (a restore, an agent's change). */
  value: string;
  /** Each edit, with the whole text as Markdown. Never called for text that came in through `value`. */
  onChange?: (markdown: string) => void;
  /** read draws the same styled page, not editable, with no bar. */
  mode?: "edit" | "read";
  /** Styled or raw Markdown. Left out, the editor keeps it and shows its own switch in the bar. */
  view?: MarkdownView;
  onView?: (view: MarkdownView) => void;
  /** Hide the bar's Styled/Markdown switch (the host's header has one). */
  toggle?: boolean;
  placeholder?: string;
  /** The accessible name of the field. */
  label: string;
  density?: "regular" | "compact";
  autoFocus?: boolean;
  /** Jump to a line of the Markdown (a check chip was pressed). `n` changes with every press so the same line jumps again. */
  jump?: { line: number; n: number } | null;
  /** Save was asked for (Cmd+S). */
  onSave?: () => void;
  /** Escape was pressed in the editor. */
  onEscape?: () => void;
  /** The editor lost focus (not for a press on its own bar or bubble). */
  onBlur?: () => void;
  /** A quiet line about what a paste did ("Removed 4 spaces of indent"). Without it the editor shows its own small pill. */
  onNote?: (note: string) => void;
  minHeight?: number;
  /** No page margins or column: the editor fills the box it is in (a note card, a field). */
  bare?: boolean;
  /** Bumped to put the caret in the editor (a title's Enter, a paste elsewhere). */
  focusKey?: number;
  /** A menu at the caret for a trigger typed in the styled view. */
  suggest?: SuggestOptions;
  /** Cmd or Ctrl with Enter (close the note). */
  onModEnter?: () => void;
  testID?: string;
}

const web = Platform.OS === "web";
const webProps = (props: Record<string, unknown>): Record<string, unknown> => (web ? props : {});

/* ---------- the page's look (skin tokens, so a skin switch repaints with no re-render) ---------- */

let cssDone = false;
const MD_CSS = [
  ".vyre-md{outline:none;font-family:var(--ui,inherit);font-size:15px;line-height:24px;color:var(--ink);caret-color:var(--accent);overflow-wrap:break-word}",
  ".vyre-md[data-empty=true] p:first-child::before{content:attr(data-placeholder);color:var(--ink-4);float:left;height:0;pointer-events:none}",
  ".vyre-md p{margin:0 0 10px}.vyre-md h1{font-size:22px;line-height:28px;margin:0 0 12px}.vyre-md h2{font-size:17px;line-height:24px;margin:22px 0 6px}.vyre-md h3{font-size:15px;line-height:22px;margin:16px 0 4px}",
  ".vyre-md h4,.vyre-md h5,.vyre-md h6{font-size:14px;margin:14px 0 4px}",
  ".vyre-md ul,.vyre-md ol{padding-left:22px;margin:0 0 10px}.vyre-md li{margin:3px 0}.vyre-md li>p{margin:0}",
  ".vyre-md ul[data-type=taskList]{list-style:none;padding-left:2px}.vyre-md li[data-type=taskItem]{display:flex;gap:8px;align-items:flex-start}",
  ".vyre-md li[data-type=taskItem]>label{margin-top:5px;flex:none;user-select:none}.vyre-md li[data-type=taskItem]>div{flex:1;min-width:0}.vyre-md li[data-checked=true]>div{color:var(--ink-3)}",
  ".vyre-md code{font:12.5px var(--mono,ui-monospace,Menlo,monospace);background:var(--sunk);border-radius:4px;padding:1px 5px}",
  ".vyre-md pre{margin:0 0 12px;padding:10px 12px;background:var(--sunk);border-radius:8px;font:12.5px/19px var(--mono,ui-monospace,Menlo,monospace);white-space:pre-wrap}.vyre-md pre code{background:none;padding:0;font:inherit}",
  ".vyre-md pre.vyre-raw{border-left:3px solid var(--line-2);border-radius:0 8px 8px 0}.vyre-md pre.vyre-raw::before{content:attr(data-raw);display:block;font:600 10.5px var(--ui,inherit);letter-spacing:.04em;text-transform:uppercase;color:var(--ink-4);margin-bottom:4px;user-select:none}",
  ".vyre-md blockquote{margin:0 0 10px;padding:0 0 0 12px;border-left:3px solid var(--line-2);color:var(--ink-2)}.vyre-md blockquote p:last-child{margin-bottom:0}",
  ".vyre-md hr{border:0;border-top:1px solid var(--line-2);margin:16px 0}.vyre-md a{color:var(--accent);text-decoration:none}.vyre-md a:hover{text-decoration:underline}.vyre-md s{color:var(--ink-3)}",
  ".vyre-md .vyre-hit{animation:vyre-md-hit 1.6s ease-out;border-radius:4px}@keyframes vyre-md-hit{0%,55%{background:var(--accent-wash);box-shadow:-6px 0 0 var(--accent-wash),6px 0 0 var(--accent-wash)}100%{background:transparent;box-shadow:none}}",
  ".vyre-md .ProseMirror-gapcursor{display:none}",
  // the raw view: the text drawn behind a transparent textarea of the same box, sized to its text so there is no scroll to keep in step
  ".vyre-rawwrap{position:relative}.vyre-rawwrap pre,.vyre-rawwrap textarea{font-family:var(--ui,inherit);font-size:15px;line-height:24px;letter-spacing:normal;white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;margin:0;padding:0;border:0;width:100%;box-sizing:border-box;tab-size:2}",
  ".vyre-rawwrap pre{position:absolute;left:0;top:0;right:0;color:var(--ink);pointer-events:none}.vyre-rawwrap textarea{position:relative;display:block;background:transparent;color:transparent;caret-color:var(--accent);resize:none;overflow:hidden;outline:none}",
  ".vyre-rawwrap textarea::selection{background:var(--accent-wash);color:transparent}.vyre-rawwrap textarea::placeholder{color:var(--ink-4)}",
  ".vyre-rawwrap .rk{color:var(--ink-4)}.vyre-rawwrap .rh{color:var(--accent)}.vyre-rawwrap .rc{color:var(--ok)}.vyre-rawwrap .rl{color:var(--accent)}.vyre-rawwrap .rb{color:var(--ink)}.vyre-rawwrap .ro{background:color-mix(in srgb,var(--warn) 16%,transparent);border-radius:3px}.vyre-rawwrap .rf{color:var(--ink-3)}",
].join("\n");

function ensureMarkdownCss(): void {
  if (cssDone || !web) return;
  const d = (globalThis as { document?: { head?: { appendChild(n: unknown): void }; createElement(t: string): { id: string; textContent: string } } }).document;
  if (!d?.head) return;
  const el = d.createElement("style");
  el.id = "vyre-ui-markdown";
  el.textContent = MD_CSS;
  d.head.appendChild(el);
  cssDone = true;
}

/* ---------- raw Markdown: colour on the syntax ---------- */

export type RawSpan = { text: string; cls: "" | "rk" | "rh" | "rc" | "rl" | "rb" | "ro" | "rf" };

/** One line of Markdown as coloured spans; the spans together are exactly the line, so the coloured text sits where the field's own text does. */
export function highlightLine(line: string, inFence: boolean): { spans: RawSpan[]; fence: boolean } {
  if (/^\s*(```|~~~)/.test(line)) return { spans: [{ text: line, cls: "rf" }], fence: !inFence };
  if (inFence) return { spans: [{ text: line, cls: "rc" }], fence: true };
  if (/^\s*(?:[-*]\s*)?Override:/i.test(line)) return { spans: [{ text: line, cls: "ro" }], fence: false };
  const h = /^(#{1,6} )(.*)$/.exec(line);
  const spans: RawSpan[] = [];
  const inline = (s: string, base: RawSpan["cls"]): void => {
    const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[\[[^\]]+\]\])|(\[[^\]]+\]\([^)]*\))|(~~[^~]+~~)/g;
    let at = 0;
    for (const m of s.matchAll(re)) {
      const i = m.index ?? 0;
      if (i > at) spans.push({ text: s.slice(at, i), cls: base });
      spans.push({ text: m[0], cls: m[1] ? "rc" : m[2] || m[5] ? "rb" : "rl" });
      at = i + m[0].length;
    }
    if (at < s.length) spans.push({ text: s.slice(at), cls: base });
  };
  if (h) { spans.push({ text: h[1] ?? "", cls: "rk" }); inline(h[2] ?? "", "rh"); return { spans, fence: false }; }
  const m = /^(\s*)([-*+] \[[ xX]\] |[-*+] |\d+[.)] |> ?)(.*)$/.exec(line);
  if (m) { if ((m[1] ?? "") !== "") spans.push({ text: m[1] ?? "", cls: "" }); spans.push({ text: m[2] ?? "", cls: "rk" }); inline(m[3] ?? "", ""); return { spans, fence: false }; }
  if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) return { spans: [{ text: line, cls: "rk" }], fence: false };
  inline(line, "");
  return { spans, fence: false };
}

export function highlightMarkdown(text: string): RawSpan[][] {
  let fence = false;
  return text.split("\n").map((l) => { const r = highlightLine(l, fence); fence = r.fence; return r.spans; });
}

interface DomTextArea { value: string; style: { height: string }; scrollHeight: number; selectionStart: number; selectionEnd: number; focus(): void; setSelectionRange(a: number, b: number): void; setRangeText(t: string, a: number, b: number, m: string): void }

function RawMarkdown(p: { value: string; onChange: (v: string) => void; editable: boolean; label: string; placeholder: string; autoFocus: boolean; jump: { line: number; n: number } | null; focusKey?: number; onModEnter?: () => void; onSave?: () => void; onEscape?: () => void; onBlur?: () => void; onNote: (s: string) => void; minHeight: number }): ReactElement {
  const area = useRef<DomTextArea | null>(null);
  const size = useCallback(() => { const a = area.current; if (a?.style) { a.style.height = "auto"; a.style.height = `${Math.max(a.scrollHeight, p.minHeight)}px`; } }, [p.minHeight]);
  useEffect(() => { size(); }, [p.value, size]);
  useEffect(() => { if (p.autoFocus) area.current?.focus(); }, [p.autoFocus]);
  useEffect(() => { if (p.focusKey) area.current?.focus(); }, [p.focusKey]);
  useEffect(() => {
    const a = area.current;
    if (!a || p.jump === null) return;
    const lines = p.value.split("\n");
    let start = 0;
    for (let i = 0; i < p.jump.line - 1 && i < lines.length; i += 1) start += (lines[i] ?? "").length + 1;
    a.focus();
    a.setSelectionRange(start, start + (lines[p.jump.line - 1] ?? "").length);
  }, [p.jump?.n]);
  if (!web) {
    return <TextInput multiline editable={p.editable} value={p.value} onChangeText={p.onChange} placeholder={p.placeholder} placeholderTextColor="var(--ink-4)" accessibilityLabel={p.label} testID="markdown-editor-raw" style={[st.nativeRaw, { minHeight: p.minHeight }]} />;
  }
  const rows = highlightMarkdown(p.value);
  const colored = rows.map((spans, i) => createElement("span", { key: i }, ...spans.map((s, k) => (s.cls === "" ? s.text : createElement("span", { key: k, className: s.cls }, s.text))), i < rows.length - 1 ? "\n" : "\n"));
  return createElement("div", { className: "vyre-rawwrap", "data-testid": "markdown-editor-raw" },
    createElement("pre", { "aria-hidden": "true" }, ...colored),
    createElement("textarea", {
      ref: (el: unknown) => { area.current = el as DomTextArea | null; },
      value: p.value,
      readOnly: !p.editable,
      spellCheck: false,
      placeholder: p.placeholder,
      "aria-label": p.label,
      "data-testid": "markdown-editor-raw-text",
      rows: 1,
      onChange: (e: { target: { value: string } }) => p.onChange(e.target.value),
      onPaste: (e: { clipboardData: { getData(t: string): string }; preventDefault(): void }) => {
        const d = dedentPaste(e.clipboardData.getData("text/plain"));
        if (d.removed === 0) return;
        e.preventDefault();
        area.current?.setRangeText(d.text, area.current.selectionStart, area.current.selectionEnd, "end");
        p.onChange(area.current?.value ?? p.value);
        p.onNote(`Removed ${d.removed} ${d.removed === 1 ? "space" : "spaces"} of indent from the paste`);
      },
      onBlur: () => p.onBlur?.(),
      onKeyDown: (e: { key: string; metaKey: boolean; ctrlKey: boolean; preventDefault(): void; stopPropagation(): void }) => {
        e.stopPropagation();
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); p.onSave?.(); }
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && p.onModEnter) { e.preventDefault(); p.onModEnter(); }
        if (e.key === "Escape") p.onEscape?.();
      },
    }),
  );
}

/** Where the text before the caret ends in a trigger: the query typed after it and how many characters the trigger and query take. "[[Bro" is `Bro`, 5; "hi @Sa" is `Sa`, 3; text with the trigger closed or far behind is null. */
export function findTrigger(before: string, trigger: "[[" | "@"): { query: string; length: number } | null {
  const m = trigger === "[[" ? /\[\[([^\]\n]*)$/.exec(before) : /(?:^|\s)@([\p{L}\p{N}_.-]*)$/u.exec(before);
  if (!m) return null;
  const query = m[1] ?? "";
  return { query, length: trigger.length + query.length };
}

/* ---------- the bar ---------- */

const T = (inner: string): string => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
export const FORMAT_ICONS: Readonly<Record<string, string>> = {
  bold: T('<path d="M5 3.500h3.200a2.200 2.200 0 010 4.500H5zM5 8h3.800a2.250 2.250 0 010 4.500H5z"/>'),
  italic: T('<path d="M10.500 3.500H7M9 12.500H5.500M9.200 3.500l-2.400 9"/>'),
  strike: T('<path d="M3 8h10M10.500 5.500c-.4-1-1.400-1.700-2.600-1.700-1.400 0-2.500.8-2.500 1.900 0 2.200 5.200 1.300 5.200 3.600 0 1.100-1.200 2-2.800 2-1.300 0-2.400-.6-2.900-1.700"/>'),
  code: T('<path d="M5.500 4.500L2.500 8l3 3.500M10.500 4.500l3 3.500-3 3.500"/>'),
  link: T('<path d="M6.800 9.200a2.600 2.600 0 003.700 0l2-2a2.600 2.600 0 00-3.700-3.700l-.6.600M9.200 6.800a2.600 2.600 0 00-3.700 0l-2 2a2.600 2.600 0 003.700 3.700l.6-.6"/>'),
  bullets: T('<circle cx="3.500" cy="4.500" r=".8" fill="currentColor"/><circle cx="3.500" cy="8" r=".8" fill="currentColor"/><circle cx="3.500" cy="11.500" r=".8" fill="currentColor"/><path d="M6.500 4.500h7M6.500 8h7M6.500 11.500h7"/>'),
  numbers: T('<path d="M6.500 4.500h7M6.500 8h7M6.500 11.500h7M2.500 3.800l1-.5v3.200M2.400 9c0-.8 1.600-.8 1.600 0 0 .8-1.600 1.300-1.600 2.100h1.700"/>'),
  tasks: T('<rect x="2" y="2.500" width="4.500" height="4.500" rx="1.200"/><path d="M3.100 4.800l.9.900 1.500-1.700M8.500 4.800h5M8.500 11.200h5"/><rect x="2" y="9" width="4.500" height="4.500" rx="1.200"/>'),
  quote: T('<path d="M3.500 5.500h3V9h-3zM9.500 5.500h3V9h-3zM6.500 9c0 1.500-.7 2.500-2 3M12.500 9c0 1.500-.7 2.500-2 3"/>'),
  codeblock: T('<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M6.500 6.500L5 8l1.500 1.500M9.500 6.500L11 8 9.500 9.500"/>'),
  divider: T('<path d="M2.500 8h11"/>'),
  more: T('<circle cx="3.500" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.500" cy="8" r=".9" fill="currentColor"/>'),
  chevron: T('<path d="M4.500 6.500L8 10l3.500-3.500"/>'),
};

interface Chain { [k: string]: (...a: never[]) => Chain & { run(): boolean } }
interface EditorLike {
  chain(): Chain & { focus(): Chain };
  commands: { setContent(c: unknown, emit?: boolean): boolean; insertContent(c: unknown): boolean; focus(p?: unknown): boolean; setTextSelection(p: unknown): boolean };
  isActive(name: string, attrs?: Record<string, unknown>): boolean;
  isEditable: boolean;
  setEditable(v: boolean): void;
  getJSON(): PMNode;
  destroy(): void;
  on(e: string, f: (a: never) => void): void;
  off(e: string, f: (a: never) => void): void;
  state: { selection: { from: number; to: number; empty: boolean }; doc: { forEach(f: (n: { nodeSize: number }, off: number, i: number) => void): void; content: { size: number } }; tr: { insertText(t: string): unknown } };
  view: { dom: { setAttribute(k: string, v: string): void; classList: { add(c: string): void; remove(c: string): void } }; coordsAtPos(p: number): { left: number; right: number; top: number; bottom: number }; nodeDOM(p: number): { scrollIntoView?(o: unknown): void; classList?: { add(c: string): void; remove(c: string): void } } | null; dispatch(tr: unknown): void };
}

type Cmd = { id: string; label: string; keys: string; icon: string; active: (e: EditorLike) => boolean; run: (e: EditorLike, ui: { link: () => void }) => void };

const call = (e: EditorLike, name: string, ...args: unknown[]): void => { const c = e.chain().focus() as unknown as Record<string, (...a: unknown[]) => { run(): boolean }>; void c[name]?.(...args).run(); };

export const FORMAT_COMMANDS: readonly Cmd[] = [
  { id: "bold", label: "Bold", keys: "Mod-B", icon: "bold", active: (e) => e.isActive("bold"), run: (e) => call(e, "toggleBold") },
  { id: "italic", label: "Italic", keys: "Mod-I", icon: "italic", active: (e) => e.isActive("italic"), run: (e) => call(e, "toggleItalic") },
  { id: "strike", label: "Strikethrough", keys: "Mod-Shift-X", icon: "strike", active: (e) => e.isActive("strike"), run: (e) => call(e, "toggleStrike") },
  { id: "code", label: "Code", keys: "Mod-E", icon: "code", active: (e) => e.isActive("code"), run: (e) => call(e, "toggleCode") },
  { id: "link", label: "Link", keys: "Mod-K", icon: "link", active: (e) => e.isActive("link"), run: (_e, ui) => ui.link() },
  { id: "bullets", label: "Bulleted list", keys: "Mod-Shift-8", icon: "bullets", active: (e) => e.isActive("bulletList"), run: (e) => call(e, "toggleBulletList") },
  { id: "numbers", label: "Numbered list", keys: "Mod-Shift-7", icon: "numbers", active: (e) => e.isActive("orderedList"), run: (e) => call(e, "toggleOrderedList") },
  { id: "tasks", label: "Checklist", keys: "Mod-Shift-9", icon: "tasks", active: (e) => e.isActive("taskList"), run: (e) => call(e, "toggleList", "taskList", "taskItem") },
  { id: "quote", label: "Quote", keys: "Mod-Shift-.", icon: "quote", active: (e) => e.isActive("blockquote"), run: (e) => call(e, "toggleBlockquote") },
  { id: "codeblock", label: "Code block", keys: "Mod-Alt-C", icon: "codeblock", active: (e) => e.isActive("codeBlock"), run: (e) => call(e, "toggleCodeBlock") },
  { id: "divider", label: "Divider", keys: "", icon: "divider", active: () => false, run: (e) => call(e, "setHorizontalRule") },
];

export const TEXT_STYLES: readonly { id: string; label: string; keys: string; level: number }[] = [
  { id: "p", label: "Paragraph", keys: "Mod-Alt-0", level: 0 },
  { id: "h1", label: "Heading 1", keys: "Mod-Alt-1", level: 1 },
  { id: "h2", label: "Heading 2", keys: "Mod-Alt-2", level: 2 },
  { id: "h3", label: "Heading 3", keys: "Mod-Alt-3", level: 3 },
];

const isMac = (): boolean => /Mac|iPhone|iPad/.test((globalThis as { navigator?: { platform?: string } }).navigator?.platform ?? "");
/** "Mod-Shift-X" as the person's keyboard writes it: ⌘⇧X on a Mac, Ctrl+Shift+X elsewhere. */
export function shortcutText(keys: string, mac: boolean = isMac()): string {
  if (keys === "") return "";
  const parts = keys.split("-");
  return mac ? parts.map((k) => (k === "Mod" ? "⌘" : k === "Shift" ? "⇧" : k === "Alt" ? "⌥" : k)).join("") : parts.map((k) => (k === "Mod" ? "Ctrl" : k)).join("+");
}
export const tooltip = (label: string, keys: string): string => (keys === "" ? label : `${label}  ${shortcutText(keys)}`);

const styleOf = (e: EditorLike): string => (e.isActive("heading", { level: 1 }) ? "h1" : e.isActive("heading", { level: 2 }) ? "h2" : e.isActive("heading", { level: 3 }) ? "h3" : "p");
const applyStyle = (e: EditorLike, id: string): void => { const lv = TEXT_STYLES.find((s) => s.id === id)?.level ?? 0; if (lv === 0) call(e, "setParagraph"); else call(e, "setHeading", { level: lv }); };
const TURN: readonly { label: string; run: (e: EditorLike) => void }[] = [
  { label: "Paragraph", run: (e) => applyStyle(e, "p") }, { label: "Heading 1", run: (e) => applyStyle(e, "h1") }, { label: "Heading 2", run: (e) => applyStyle(e, "h2") }, { label: "Heading 3", run: (e) => applyStyle(e, "h3") },
  { label: "Bulleted list", run: (e) => call(e, "toggleBulletList") }, { label: "Numbered list", run: (e) => call(e, "toggleOrderedList") }, { label: "Checklist", run: (e) => call(e, "toggleList", "taskList", "taskItem") },
  { label: "Quote", run: (e) => call(e, "toggleBlockquote") }, { label: "Code block", run: (e) => call(e, "toggleCodeBlock") },
];

type Hover = { hovered?: boolean };

function FmtButton({ id, label, keys, icon, on, onPress }: { id: string; label: string; keys: string; icon: string; on: boolean; onPress: (e: unknown) => void }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={onPress} testID={`md-tool-${id}`} {...webProps({ title: tooltip(label, keys) })}
      style={({ hovered }: Hover) => [st.tool, hovered === true && st.toolHover, on && st.toolOn]}>
      <MenuIcon icon={FORMAT_ICONS[icon] ?? ""} size={16} color={on ? "var(--accent)" : "var(--ink-2)"} />
    </Pressable>
  );
}

const rectOf = (e: unknown): { x: number; y: number } => {
  const t = (e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } } | null)?.currentTarget?.getBoundingClientRect?.();
  return t ? { x: t.left, y: t.bottom + 4 } : { x: 80, y: 120 };
};

/* ---------- the component ---------- */

/** Read-only text is the chat's block renderer, so a note read and a reply read the same; editing is the editor. */
export function MarkdownEditor(props: MarkdownEditorProps): ReactElement {
  if (props.mode === "read") return <View testID={props.testID ?? "markdown-editor"} accessibilityLabel={props.label} style={props.bare === true ? undefined : st.page}><MarkdownText text={props.value} /></View>;
  return <MarkdownEditorEdit {...props} />;
}

function MarkdownEditorEdit(props: MarkdownEditorProps): ReactElement {
  ensureMarkdownCss();
  const mode = props.mode ?? "edit";
  const editable = mode === "edit";
  const compact = props.density === "compact";
  const minHeight = props.minHeight ?? (compact ? 120 : 220);
  const placeholder = props.placeholder ?? "Write";
  const { width: winW } = useWindowDimensions();
  const phone = compact || winW < 700;
  const [own, setOwn] = useState<MarkdownView>(props.view ?? "styled");
  const view = props.view ?? own;
  const setView = (v: MarkdownView): void => { setOwn(v); props.onView?.(v); };
  const [editor, setEditor] = useState<EditorLike | null>(null);
  const [active, setActive] = useState<string[]>([]);
  const [style, setStyle] = useState("p");
  const [bubble, setBubble] = useState<{ left: number; top: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [linkAt, setLinkAt] = useState<string | null>(null);
  const [barW, setBarW] = useState(0);
  const [sg, setSg] = useState<{ start: number; query: string; left: number; top: number } | null>(null);
  const [sgHi, setSgHi] = useState(0);
  const sgRef = useRef({ open: null as { start: number; query: string } | null, hi: 0, shut: -1 });
  const host = useRef<unknown>(null);
  const wrap = useRef<{ getBoundingClientRect?: () => { left: number; top: number } } | null>(null);
  const last = useRef(props.value);
  const cb = useRef(props);
  cb.current = props;
  const { element: menu, show } = useMenu();

  const say = useCallback((s: string) => {
    if (cb.current.onNote) { cb.current.onNote(s); return; }
    setNote(s);
    setTimeout(() => setNote((n) => (n === s ? null : n)), 6000);
  }, []);

  const editorRef = useRef<EditorLike | null>(null);
  // where the caret is in a trigger: "[[" then letters, or "@" then letters
  const readTrigger = useCallback((ed: EditorLike): void => {
    const opt = cb.current.suggest;
    const set = (v: { start: number; query: string; left: number; top: number } | null): void => {
      sgRef.current.open = v === null ? null : { start: v.start, query: v.query };
      setSg((o) => (o === null && v === null ? o : v));
      if (v === null) { if (opt) opt.onQuery(null); } else if (opt) opt.onQuery(v.query);
    };
    if (!opt || !ed.isEditable) { if (sgRef.current.open) set(null); return; }
    const sel = ed.state.selection as unknown as { from: number; empty: boolean; $from: { parent: { textBetween(a: number, b: number, sep: string, leaf: string): string }; parentOffset: number } };
    if (!sel.empty) { if (sgRef.current.open) set(null); return; }
    const before = sel.$from.parent.textBetween(0, sel.$from.parentOffset, "\n", "\ufffc");
    const m = findTrigger(before, opt.trigger);
    if (!m) { if (sgRef.current.open) set(null); return; }
    const start = sel.from - m.length;
    if (sgRef.current.shut === start) { if (sgRef.current.open) set(null); return; }
    const box = wrap.current?.getBoundingClientRect?.();
    const at = ed.view.coordsAtPos(sel.from);
    const next = { start, query: m.query, left: Math.max(4, at.left - (box?.left ?? 0)), top: at.bottom - (box?.top ?? 0) + 4 };
    if (sgRef.current.open?.query !== next.query || sgRef.current.open?.start !== next.start) { sgRef.current.hi = 0; setSgHi(0); }
    set(next);
  }, []);
  const pickSuggest = useCallback((item: SuggestItem): void => {
    const opt = cb.current.suggest;
    const o = sgRef.current.open;
    const ed = editorRef.current;
    if (!opt || !o || !ed) return;
    const to = ed.state.selection.from;
    const text = opt.insert ? opt.insert(item) : opt.trigger === "[[" ? `[[${item.label}]]` : `@${item.label} `;
    (ed.chain().focus() as unknown as { insertContentAt(r: { from: number; to: number }, c: string): { run(): boolean } }).insertContentAt({ from: o.start, to }, text).run();
  }, []);
  const openLink = useCallback(() => {
    const e = editorRef.current;
    if (!e) return;
    const href = (e as unknown as { getAttributes(n: string): { href?: string } }).getAttributes("link").href ?? "";
    setLinkAt(href);
  }, []);

  // Web, styled: TipTap on the page's document.
  useEffect(() => {
    if (!web || view !== "styled") return undefined;
    let made: EditorLike | null = null;
    let gone = false;
    void (async () => {
      const core = await import("@tiptap/core");
      const { markdownExtensions } = await import("./extensions.ts");
      // a real element only: a test renderer hands back a stand-in with no DOM behind it
      if (gone || host.current === null || (host.current as { nodeType?: number }).nodeType !== 1) return;
      const e = new core.Editor({
        element: host.current as never,
        extensions: markdownExtensions({ onLink: openLink }),
        content: markdownToDoc(last.current) as never,
        editable,
        editorProps: {
          attributes: { class: "vyre-md", role: "textbox", "aria-multiline": "true", "aria-label": props.label, "data-placeholder": placeholder, "data-testid": "markdown-editor-page", spellcheck: "true" },
          handlePaste: (_v: unknown, event: unknown) => {
            const text = (event as { clipboardData?: { getData(t: string): string } }).clipboardData?.getData("text/plain") ?? "";
            if (text === "" || !editorRef.current) return false;
            const ed = editorRef.current;
            if (ed.isActive("codeBlock") || ed.isActive("rawBlock")) { ed.view.dispatch(ed.state.tr.insertText(text)); return true; }
            const d = dedentPaste(text);
            if (looksLikeMarkdown(d.text)) {
              const parsed = markdownToDoc(d.text);
              ed.commands.insertContent(parsed.content as never);
              say(d.removed > 0 ? `Removed ${d.removed} ${d.removed === 1 ? "space" : "spaces"} of indent and turned the paste into structure` : "Turned the paste into structure");
            } else {
              ed.commands.insertContent({ type: "text", text: d.text } as never);
              if (d.removed > 0) say(`Removed ${d.removed} ${d.removed === 1 ? "space" : "spaces"} of indent from the paste`);
            }
            return true;
          },
          handleKeyDown: (_v: unknown, event: unknown) => {
            const k = event as { key: string; metaKey: boolean; ctrlKey: boolean; preventDefault(): void };
            const open = sgRef.current.open;
            const rows = cb.current.suggest?.items ?? [];
            if (open && rows.length > 0) {
              if (k.key === "ArrowDown" || k.key === "ArrowUp") { k.preventDefault(); const n = rows.length; sgRef.current.hi = (sgRef.current.hi + (k.key === "ArrowDown" ? 1 : n - 1)) % n; setSgHi(sgRef.current.hi); return true; }
              if (k.key === "Enter" || k.key === "Tab") { k.preventDefault(); pickSuggest(rows[Math.min(sgRef.current.hi, rows.length - 1)] as SuggestItem); return true; }
              if (k.key === "Escape") { k.preventDefault(); sgRef.current.shut = open.start; readTrigger(editorRef.current as EditorLike); return true; }
            }
            if ((k.metaKey || k.ctrlKey) && k.key.toLowerCase() === "s") { k.preventDefault(); cb.current.onSave?.(); return true; }
            if ((k.metaKey || k.ctrlKey) && k.key === "Enter" && cb.current.onModEnter) { k.preventDefault(); cb.current.onModEnter(); return true; }
            if (k.key === "Escape") { cb.current.onEscape?.(); return false; }
            return false;
          },
        },
        onTransaction: ({ transaction }: { transaction: { docChanged: boolean } }) => {
          const ed = editorRef.current;
          if (!ed) return;
          const on: string[] = [];
          for (const c of FORMAT_COMMANDS) if (c.active(ed)) on.push(c.id);
          setActive(on);
          setStyle(styleOf(ed));
          readTrigger(ed);
          ed.view.dom.setAttribute("data-empty", ed.state.doc.content.size <= 2 ? "true" : "false");
          if (!transaction.docChanged) return;
          const md = docToMarkdown(ed.getJSON());
          if (md === last.current) return;
          last.current = md;
          cb.current.onChange?.(md);
        },
        onSelectionUpdate: () => {
          const ed = editorRef.current;
          if (ed) readTrigger(ed);
          if (!ed || !ed.isEditable) { setBubble(null); return; }
          const { from, to, empty } = ed.state.selection;
          const box = wrap.current?.getBoundingClientRect?.();
          if (empty || !box) { setBubble(null); return; }
          const a = ed.view.coordsAtPos(from);
          const b = ed.view.coordsAtPos(to);
          setBubble({ left: Math.max(4, (a.left + b.right) / 2 - box.left - 110), top: Math.min(a.top, b.top) - box.top - 42 });
        },
        onBlur: () => { setBubble(null); cb.current.onBlur?.(); },
      }) as unknown as EditorLike;
      editorRef.current = e;
      e.view.dom.setAttribute("data-empty", last.current.trim() === "" ? "true" : "false");
      made = e;
      setEditor(e);
      if (cb.current.autoFocus) e.commands.focus("end");
    })();
    return () => { gone = true; made?.destroy(); editorRef.current = null; setEditor(null); setBubble(null); };
    // eslint-disable-next-line
  }, [view]);

  useEffect(() => { editor?.setEditable(editable); }, [editor, editable]);

  // text that came in from outside replaces what the page shows
  useEffect(() => {
    if (props.value === last.current) return;
    last.current = props.value;
    editorRef.current?.commands.setContent(markdownToDoc(props.value) as never, false);
  }, [props.value]);

  // a check chip pressed: put the caret on that line's block and flash it
  useEffect(() => {
    const j = props.jump;
    const e = editorRef.current;
    if (!j || !e || view !== "styled") return;
    const doc = markdownToDoc(last.current);
    const index = blockOfLine(doc, j.line);
    let pos = 0;
    e.state.doc.forEach((n, off, i) => { if (i === index) pos = off; });
    const dom = e.view.nodeDOM(pos);
    e.commands.focus();
    e.commands.setTextSelection(pos + 1);
    dom?.scrollIntoView?.({ block: "center" });
    dom?.classList?.remove("vyre-hit");
    void (dom as unknown as { offsetWidth?: number } | null)?.offsetWidth;
    dom?.classList?.add("vyre-hit");
  }, [props.jump?.n, editor]);

  // a caret asked for from outside (the raw view takes it through its own prop)
  useEffect(() => {
    if (!props.focusKey || view !== "styled") return;
    editorRef.current?.commands.focus("end");
  }, [props.focusKey, editor]);

  const onRawChange = (v: string): void => { last.current = v; props.onChange?.(v); };
  // raw edits and styled edits share `last`: switching views shows the same text
  const toggle = props.toggle !== false && editable && web;
  const barOn = editable && view === "styled" && editor !== null;
  const run = (c: Cmd): ((e: unknown) => void) => () => { if (editor) c.run(editor, { link: openLink }); };
  const openStyle = (e: unknown): void => {
    const at = rectOf(e);
    show(TEXT_STYLES.map((s) => ({ label: s.label, checked: style === s.id, onSelect: () => { if (editor) applyStyle(editor, s.id); } })), at.x, at.y, "other");
  };
  const room = Math.max(0, Math.floor((barW - (toggle ? 130 : 40) - 120) / 32));
  const shown = phone ? FORMAT_COMMANDS : FORMAT_COMMANDS.slice(0, Math.max(5, room));
  const hidden = phone ? [] : FORMAT_COMMANDS.slice(shown.length);
  const openMore = (e: unknown): void => {
    const at = rectOf(e);
    show(hidden.map((c) => ({ label: tooltip(c.label, c.keys), checked: editor !== null && c.active(editor), onSelect: () => { if (editor) c.run(editor, { link: openLink }); } })), at.x, at.y, "other");
  };
  const styleLabel = TEXT_STYLES.find((s) => s.id === style)?.label ?? "Paragraph";
  const bar = barOn ? (
    <View style={[st.bar, phone && st.barPhone]} testID="md-bar" accessibilityRole="toolbar" accessibilityLabel="Formatting" {...webProps({ onMouseDown: (e: { target?: { tagName?: string }; preventDefault(): void }) => { if (e.target?.tagName !== "INPUT") e.preventDefault(); } })} onLayout={(e: LayoutChangeEvent) => setBarW(e.nativeEvent.layout.width)}>
      {linkAt !== null ? (
        <View style={st.linkRow} testID="md-link-row">
          <TextInput autoFocus value={linkAt} onChangeText={setLinkAt} placeholder="Paste or type an address" placeholderTextColor="var(--ink-4)" accessibilityLabel="Link address" testID="md-link-input" autoCapitalize="none"
            onSubmitEditing={() => { const href = (linkAt ?? "").trim(); if (editor) { if (href === "") call(editor, "unsetLink"); else call(editor, "setLink", { href }); } setLinkAt(null); }} style={st.linkInput} />
          <Pressable accessibilityRole="button" accessibilityLabel="Apply link" testID="md-link-apply" onPress={() => { const href = (linkAt ?? "").trim(); if (editor) { if (href === "") call(editor, "unsetLink"); else call(editor, "setLink", { href }); } setLinkAt(null); }} style={st.linkBtn}><Text style={st.linkBtnText}>Apply</Text></Pressable>
          {editor?.isActive("link") ? <Pressable accessibilityRole="button" accessibilityLabel="Remove link" testID="md-link-remove" onPress={() => { if (editor) call(editor, "unsetLink"); setLinkAt(null); }} style={st.linkBtn}><Text style={st.linkBtnText}>Remove</Text></Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" testID="md-link-cancel" onPress={() => { setLinkAt(null); editor?.commands.focus(); }} style={st.linkBtn}><Text style={st.linkBtnText}>Cancel</Text></Pressable>
        </View>
      ) : (
        <ScrollView horizontal={phone} scrollEnabled={phone} showsHorizontalScrollIndicator={false} contentContainerStyle={[st.barRow, compact && st.barRowCompact]} style={st.barScroll}>
          <Pressable accessibilityRole="button" accessibilityLabel="Text style" testID="md-tool-style" onPress={openStyle} {...webProps({ title: "Text style" })} style={({ hovered }: Hover) => [st.styleBtn, hovered === true && st.toolHover]}>
            <Text style={st.styleText}>{styleLabel}</Text>
            <MenuIcon icon={FORMAT_ICONS["chevron"] ?? ""} size={14} color="var(--ink-3)" />
          </Pressable>
          <View style={st.sep} />
          {/* ui-rows-lint: not a list (the formatting toolbar's buttons) */}
          {shown.map((c, i) => (
            <View key={c.id} style={st.item}>
              {c.id === "bullets" || (i === 5 && !shown.some((x) => x.id === "bullets")) ? <View style={st.sep} /> : null}
              <FmtButton id={c.id} label={c.label} keys={c.keys} icon={c.icon} on={active.includes(c.id)} onPress={run(c)} />
            </View>
          ))}
          {hidden.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="More formatting" testID="md-tool-more" onPress={openMore} {...webProps({ title: "More" })} style={({ hovered }: Hover) => [st.tool, hovered === true && st.toolHover]}><MenuIcon icon={FORMAT_ICONS["more"] ?? ""} size={16} color="var(--ink-2)" /></Pressable> : null}
          <View style={st.grow} />
          {toggle ? <ViewSwitch view={view} onView={setView} /> : null}
        </ScrollView>
      )}
    </View>
  ) : toggle && editable ? (
    <View style={st.bar}><View style={st.barRow}><View style={st.grow} /><ViewSwitch view={view} onView={setView} /></View></View>
  ) : null;

  const bubbleNode = bubble !== null && editor !== null && barOn ? (
    <View style={[st.bubble, { left: bubble.left, top: bubble.top }]} testID="md-bubble" accessibilityRole="toolbar" accessibilityLabel="Format selection" {...webProps({ onMouseDown: (e: { preventDefault(): void }) => e.preventDefault() })}>
      {/* ui-rows-lint: not a list (the selection bubble's format buttons, a toolbar) */}
      {FORMAT_COMMANDS.filter((c) => ["bold", "italic", "link", "code"].includes(c.id)).map((c) => <FmtButton key={c.id} id={`bubble-${c.id}`} label={c.label} keys={c.keys} icon={c.icon} on={active.includes(c.id)} onPress={run(c)} />)}
      <View style={st.sep} />
      <Pressable accessibilityRole="button" accessibilityLabel="Turn into" testID="md-bubble-turn" onPress={(e: unknown) => { const at = rectOf(e); show(TURN.map((t) => ({ label: t.label, onSelect: () => { if (editor) t.run(editor); } })), at.x, at.y, "other"); }} {...webProps({ title: "Turn into" })} style={({ hovered }: Hover) => [st.turn, hovered === true && st.toolHover]}>
        <Text style={st.styleText}>Turn into</Text>
        <MenuIcon icon={FORMAT_ICONS["chevron"] ?? ""} size={14} color="var(--ink-3)" />
      </Pressable>
    </View>
  ) : null;

  const sgItems = sg !== null && props.suggest ? props.suggest.items : [];
  const suggestNode = sg !== null && props.suggest && sgItems.length > 0 ? (
    <View style={[st.suggest, { left: sg.left, top: sg.top }]} accessibilityRole="menu" accessibilityLabel={props.suggest.label} testID={props.suggest.menuTestID ?? "md-suggest"} {...webProps({ onMouseDown: (e: { preventDefault(): void }) => e.preventDefault() })}>
      {sgItems.map((it, i) => (
        <Row key={it.id} id={it.id} title={it.label} selected={i === sgHi} {...(it.detail ? { trailing: <Text style={st.sgDetail}>{it.detail}</Text> } : {})} onPress={() => pickSuggest(it)}
          domProps={{ "data-testid": props.suggest?.itemTestID ? props.suggest.itemTestID(it) : `md-suggest-${it.id}`, role: "menuitem", "aria-selected": i === sgHi }} />
      ))}
    </View>
  ) : null;

  const pill = note !== null ? <View style={st.pill} testID="md-note" accessibilityLiveRegion="polite"><View style={st.pillDot} /><Text style={st.pillText}>{note}</Text></View> : null;

  let body: ReactElement;
  if (view === "raw" || !web) {
    body = <RawMarkdown value={props.value} onChange={onRawChange} editable={editable} label={props.label} placeholder={placeholder} autoFocus={props.autoFocus === true} jump={props.jump ?? null} onNote={say} minHeight={minHeight}
      {...(props.onSave ? { onSave: props.onSave } : {})} {...(props.onModEnter ? { onModEnter: props.onModEnter } : {})} {...(props.focusKey ? { focusKey: props.focusKey } : {})} {...(props.onEscape ? { onEscape: props.onEscape } : {})} {...(props.onBlur ? { onBlur: props.onBlur } : {})} />;
  } else {
    body = createElement("div", { ref: (el: unknown) => { host.current = el; }, "data-testid": "markdown-editor-host", style: { minHeight } });
  }

  return (
    <View testID={props.testID ?? "markdown-editor"} style={st.root} accessibilityLabel={props.label} {...webProps({ role: "group", dataSet: { view, mode } })}>
      {!phone ? bar : null}
      <View style={[st.page, compact && st.pageCompact, props.bare === true && st.pageBare]} ref={wrap as never}>
        {body}
        {bubbleNode}
        {suggestNode}
      </View>
      {pill}
      {phone ? bar : null}
      {menu}
    </View>
  );
}

/** The two-way switch between the styled page and the raw Markdown. A host with its own header draws this itself. */
export function ViewSwitch({ view, onView }: { view: MarkdownView; onView: (v: MarkdownView) => void }): ReactElement {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Styled or Markdown" style={st.seg} testID="md-view">
      {/* ui-rows-lint: not a list (a two-way segmented switch: Styled or Markdown) */}
      {(["styled", "raw"] as const).map((v) => (
        <Pressable key={v} accessibilityRole="radio" accessibilityLabel={v === "styled" ? "Styled" : "Markdown"} accessibilityState={{ checked: view === v }} onPress={() => onView(v)} testID={`md-view-${v}`}
          style={({ hovered }: Hover) => [st.segBtn, view === v && st.segOn, hovered === true && view !== v && st.toolHover]}>
          <Text style={[st.segText, view === v && st.segTextOn]}>{v === "styled" ? "Styled" : "Markdown"}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  bar: { minHeight: 38, justifyContent: "center", alignItems: "center", paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
  barPhone: { borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  barScroll: { flexGrow: 1, width: "100%", maxWidth: 760 },
  barRowCompact: { paddingHorizontal: 10 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 2, flexGrow: 1, paddingHorizontal: 26 },
  item: { flexDirection: "row", alignItems: "center" },
  grow: { flex: 1 },
  sep: { width: 1, height: 16, backgroundColor: "var(--line)" as string, marginHorizontal: 6 },
  tool: { minWidth: 28, height: 28, paddingHorizontal: 6, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  toolHover: { backgroundColor: "var(--hover)" as string },
  toolOn: { backgroundColor: "var(--accent-wash)" as string },
  styleBtn: { flexDirection: "row", alignItems: "center", gap: 4, height: 28, paddingHorizontal: 8, borderRadius: 6 },
  styleText: { color: "var(--ink)" as string, fontSize: 13 },
  turn: { flexDirection: "row", alignItems: "center", gap: 3, height: 26, paddingHorizontal: 7, borderRadius: 6 },
  seg: { flexDirection: "row", padding: 2, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  segBtn: { height: 24, paddingHorizontal: 10, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: "var(--raised)" as string },
  segText: { color: "var(--ink-3)" as string, fontSize: 12.5, fontWeight: "500" },
  segTextOn: { color: "var(--ink)" as string },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4, width: "100%", maxWidth: 760, paddingHorizontal: 26 },
  linkInput: { flex: 1, height: 28, paddingHorizontal: 8, borderRadius: 6, backgroundColor: "var(--sunk)" as string, color: "var(--ink)" as string, fontSize: 13 },
  linkBtn: { height: 28, paddingHorizontal: 10, borderRadius: 6, justifyContent: "center" },
  linkBtnText: { color: "var(--accent)" as string, fontSize: 12.5 },
  page: { flex: 1, paddingVertical: 20, paddingHorizontal: 32, maxWidth: 760, width: "100%", alignSelf: "center", position: "relative" },
  pageCompact: { paddingVertical: 12, paddingHorizontal: 16 },
  pageBare: { paddingVertical: 0, paddingHorizontal: 0, maxWidth: "100%" as unknown as number, alignSelf: "stretch" },
  bubble: { position: "absolute", zIndex: 20, flexDirection: "row", alignItems: "center", gap: 1, padding: 3, borderRadius: 9, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string },
  suggest: { position: "absolute", zIndex: 30, minWidth: 220, maxWidth: 320, padding: 4, borderRadius: 10, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string },
  sgItem: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, height: 30, borderRadius: 6 },
  sgOn: { backgroundColor: "var(--hover)" as string },
  sgText: { flex: 1, color: "var(--ink)" as string, fontSize: 13 },
  sgDetail: { color: "var(--ink-3)" as string, fontSize: 11.5 },
  pill: { position: "absolute", bottom: 14, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 99, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string },
  pillDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--ok)" as string },
  pillText: { color: "var(--ink-2)" as string, fontSize: 12.5 },
  nativeRaw: { color: "var(--ink)" as string, fontSize: 15, lineHeight: 24, textAlignVertical: "top" },
});
