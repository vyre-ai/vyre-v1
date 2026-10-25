// ui/EmailBuilder: the one email editor (spec 2.19, 3.6; ARCH 7.6) for campaigns, Inbox templates and Automation email steps.
// Three modes (Visual blocks, HTML, Plain text), Focus mode (Cmd-Shift-F, Esc), preview frames (desktop, mobile, dark), an Ask pane where each suggested
// change is accepted on its own, checks, and autosaved versions (undo and redo walk them). The look follows the prototype's vy-em editor.
// The compile step is `email_builder.render`; this file holds the same rules as pure functions so the preview, the checks and the tests share them.
// Lists use the shared Row where they are lists; tabs use the shared TabStrip; Ask is the shared AskButton. Colours are skin tokens (CSS variables on web).

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { AskButton } from "../AskButton/index.tsx";
import { Composer } from "../Composer/index.tsx";
import type { AskButtonProps } from "../AskButton/index.tsx";
import { MenuIcon, useMenu } from "../Menu/index.tsx";
import { Row } from "../Row/index.tsx";
import { TabStrip } from "../TabStrip/index.tsx";
import { EMAIL_BLOCK_KINDS, EMAIL_MODES, EMAIL_PREVIEWS, emailLabel } from "./props.ts";
import type { EmailBlock, EmailBlockKind, EmailBuilderProps, EmailDiff, EmailMode, EmailPreview } from "./props.ts";

export type { EmailBlock, EmailBlockKind, EmailBuilderProps, EmailDiff, EmailMode, EmailPreview } from "./props.ts";
export { EMAIL_BLOCK_KINDS, EMAIL_MODES, EMAIL_PREVIEWS, emailLabel } from "./props.ts";

/* ---------- pure logic ---------- */

export const SUBJECT_LIMIT = 60;
export const PREVIEW_TEXT_LIMIT = 110;
/** Below this window width the rail becomes a row and the pane sits under the editor. */
export const NARROW_WIDTH = 760;
export const PANE_TABS = ["style", "ask", "preview", "checks"] as const;
export type PaneTab = (typeof PANE_TABS)[number];
export const PREVIEW_WIDTH: Readonly<Record<EmailPreview, number>> = { desktop: 600, mobile: 375, dark: 600 };

const esc = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** A merge token `{{first_name|there}}` for a field. The part after the bar is the fallback. */
export function mergeToken(field: string, fallback = ""): string {
  return fallback === "" ? `{{${field}}}` : `{{${field}|${fallback}}}`;
}

/** Fills tokens from a record's fields: the field value, else the fallback, else nothing. */
export function fillMerge(text: string, values: Readonly<Record<string, string>> | undefined): string {
  return text.replace(/\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g, (_m, field: string, fallback?: string) => values?.[field] ?? fallback ?? "");
}

/** One tag per line, so the HTML mode reads as source. Text between tags is untouched. */
export function formatHtml(markup: string): string {
  return markup.replace(/>\s*(?=<(?:\/?(?:html|head|body|table|tbody|tr|td|div|ul|ol|style)|p|h[1-6]|li|hr|meta|title|img)\b)/g, ">\n");
}

export function newBlock(kind: EmailBlockKind, id: string): EmailBlock {
  switch (kind) {
    case "text": return { id, kind, text: "Write something." };
    case "image": return { id, kind, text: "Image" };
    case "button": return { id, kind, text: "Open" };
    case "columns": return { id, kind, children: [{ id: `${id}-a`, kind: "text", text: "Left" }, { id: `${id}-b`, kind: "text", text: "Right" }] };
    case "divider": return { id, kind };
    case "merge": return { id, kind, field: "first_name", text: "there" };
    case "html": return { id, kind, text: "<p></p>" };
  }
}

export const EMAIL_WIDTHS = [480, 560, 600, 640, 700] as const;
export const EMAIL_FONTS = ["Inter", "Arial", "Helvetica", "Georgia", "Verdana"] as const;
export interface EmailColors { page: string; email: string; text: string; muted: string; links: string; button: string; buttonText: string }
export interface EmailStyle { width: number; font: string; size: number; padding: number; radius: number; colors: EmailColors }
export const DEFAULT_EMAIL_STYLE: EmailStyle = {
  width: 600, font: "Inter", size: 16, padding: 32, radius: 12,
  colors: { page: "#F4F4F5", email: "#FFFFFF", text: "#18181A", muted: "#6B6B73", links: "#5B5BD6", button: "#5B5BD6", buttonText: "#FFFFFF" },
};
export const COLOR_LABEL: Readonly<Record<keyof EmailColors, string>> = { page: "Page", email: "Email", text: "Text", muted: "Muted text", links: "Links", button: "Button", buttonText: "Button text" };
export const isHex = (v: string): boolean => /^#[0-9a-fA-F]{6}$/.test(v);

/** Applies the Dark frame: it swaps the page, email, text and muted colours, never the brand colours. */
function resolveStyle(style: EmailStyle | undefined, dark: boolean): EmailStyle {
  const s = style ?? DEFAULT_EMAIL_STYLE;
  return dark ? { ...s, colors: { ...s.colors, page: "#121214", email: "#1B1B1E", text: "#EDEDEF", muted: "#8A8A8F" } } : s;
}

function blockHtml(b: EmailBlock, values: Readonly<Record<string, string>> | undefined, st: EmailStyle, dark: boolean): string {
  const c = st.colors;
  const face = `${st.font},Arial,sans-serif`;
  const line = Math.round(st.size * 1.45);
  switch (b.kind) {
    case "text": return `<p style="margin:0 0 14px;font:${st.size}px/${line}px ${face};color:${c.text}">${values === undefined ? esc(b.text ?? "") : fillMerge(esc(b.text ?? ""), values)}</p>`;
    case "image": return `<div style="margin:0 0 14px;background:${dark ? "#2A2A2E" : "#E9E9EC"};height:140px;text-align:center;font:13px/140px ${face};color:${c.muted}">${esc(b.text ?? "Image")}</div>`;
    case "button": return `<p style="margin:0 0 14px"><a href="#" style="display:inline-block;padding:10px 18px;border-radius:${Math.min(st.radius, 12)}px;background:${c.button};color:${c.buttonText};font:600 14px ${face};text-decoration:none">${esc(b.text ?? "Open")}</a></p>`;
    case "columns": return `<table role="presentation" width="100%" style="margin:0 0 14px"><tr>${each(b.children ?? [], (k) => `<td valign="top" width="50%">${blockHtml(k, values, st, dark)}</td>`).join("")}</tr></table>`;
    case "divider": return `<hr style="border:0;border-top:1px solid ${dark ? "#3A3A40" : "#E4E4E7"};margin:18px 0">`;
    case "merge": return `<span style="font:${st.size}px/${line}px ${face};color:${c.text}">${values === undefined ? esc(mergeToken(b.field ?? "", b.text ?? "")) : esc(values[b.field ?? ""] ?? b.text ?? "")}</span>`;
    case "html": return b.text ?? "";
  }
}

/** The email as HTML: `send` keeps merge tokens for the sender, `preview` fills them from the record. */
export function compileEmail(blocks: readonly EmailBlock[], opts: { mode?: "send" | "preview"; dark?: boolean; values?: Readonly<Record<string, string>>; style?: EmailStyle } = {}): string {
  const dark = opts.dark === true;
  const st = resolveStyle(opts.style, dark);
  const values = opts.mode === "preview" ? opts.values : undefined;
  const body = blocks.map((b) => blockHtml(b, values, st, dark)).join("");
  return `<!doctype html><html><body style="margin:0;background:${st.colors.page}"><div style="max-width:${st.width}px;margin:0 auto;padding:28px ${st.padding}px;background:${st.colors.email};border-radius:${st.radius}px">${body}<p style="font:12px ${st.font},Arial,sans-serif;color:${st.colors.muted}"><a href="#unsubscribe" style="color:${st.colors.links}">Unsubscribe</a></p></div></body></html>`;
}

/** The plain-text part a visual email falls back to. */
export function blocksToPlain(blocks: readonly EmailBlock[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.kind === "text" || b.kind === "button" || b.kind === "merge") lines.push(b.kind === "merge" ? mergeToken(b.field ?? "", b.text ?? "") : (b.text ?? ""));
    else if (b.kind === "columns") lines.push(blocksToPlain(b.children ?? []));
    else if (b.kind === "divider") lines.push("---");
  }
  return lines.filter((l) => l !== "").join("\n\n");
}

export type CheckLevel = "ok" | "warn" | "bad";
export interface EmailCheck { id: string; name: string; level: CheckLevel; note: string }

/** What the Checks tab lists, from the subject, preview text, plain part and the compiled HTML. */
export function runChecks(d: { subject: string; previewText: string; html: string; plain: string }): EmailCheck[] {
  const out: EmailCheck[] = [];
  out.push(d.subject.trim() === "" ? { id: "subject", name: "Subject", level: "bad", note: "The email has no subject." }
    : d.subject.length > SUBJECT_LIMIT ? { id: "subject", name: "Subject", level: "warn", note: `${d.subject.length} characters; inboxes cut it near ${SUBJECT_LIMIT}.` }
    : { id: "subject", name: "Subject", level: "ok", note: `${d.subject.length} of ${SUBJECT_LIMIT} characters.` });
  out.push(d.previewText.trim() === "" ? { id: "preview", name: "Preview text", level: "warn", note: "Empty. Inboxes show the first line of the body instead." }
    : d.previewText.length > PREVIEW_TEXT_LIMIT ? { id: "preview", name: "Preview text", level: "warn", note: `${d.previewText.length} characters; the first ${PREVIEW_TEXT_LIMIT} show.` }
    : { id: "preview", name: "Preview text", level: "ok", note: `${d.previewText.length} of ${PREVIEW_TEXT_LIMIT} characters.` });
  out.push(d.plain.trim() === "" ? { id: "plain", name: "Plain-text part", level: "bad", note: "Missing. Some inboxes show only this part." }
    : !/unsubscribe/i.test(d.plain) && !/unsubscribe/i.test(d.html) ? { id: "plain", name: "Plain-text part", level: "warn", note: "No unsubscribe line." }
    : { id: "plain", name: "Plain-text part", level: "ok", note: "Present." });
  out.push(/href="#unsubscribe"|\{\{\s*unsubscribe/i.test(d.html) ? { id: "unsub", name: "Unsubscribe link", level: "ok", note: "Present in the footer." } : { id: "unsub", name: "Unsubscribe link", level: "bad", note: "Marketing email needs one." });
  return out;
}

/** The tokens in a text, for the merge-fields list. */
export function mergeFieldsOf(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([\w.]+)/g)) if (m[1] !== undefined) seen.add(m[1]);
  return [...seen];
}

export function moveBlock(blocks: readonly EmailBlock[], id: string, step: -1 | 1): EmailBlock[] {
  const i = blocks.findIndex((b) => b.id === id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= blocks.length) return [...blocks];
  const out = [...blocks];
  const a = out[i], b = out[j];
  if (a === undefined || b === undefined) return out;
  out[i] = b; out[j] = a;
  return out;
}

export function editBlock(blocks: readonly EmailBlock[], id: string, patch: Partial<EmailBlock>): EmailBlock[] {
  return blocks.map((b) => (b.id === id ? { ...b, ...patch } : b.children ? { ...b, children: editBlock(b.children, id, patch) } : b));
}

/** What undo and redo walk: one entry per edit, coalesced by the caller. */
export interface EmailSnapshot { subject: string; previewText: string; blocks: readonly EmailBlock[]; html: string; plain: string; style?: EmailStyle }
export interface EmailHistory { entries: readonly EmailSnapshot[]; at: number }

export function pushHistory(h: EmailHistory, s: EmailSnapshot): EmailHistory {
  const entries = [...h.entries.slice(0, h.at + 1), s].slice(-60);
  return { entries, at: entries.length - 1 };
}
export const canUndo = (h: EmailHistory): boolean => h.at > 0;
export const canRedo = (h: EmailHistory): boolean => h.at < h.entries.length - 1;
export const stepHistory = (h: EmailHistory, d: -1 | 1): EmailHistory => ({ entries: h.entries, at: Math.max(0, Math.min(h.entries.length - 1, h.at + d)) });

/** Keys: Cmd-Shift-F toggles Focus, Escape leaves it. Returns the new focus value, or null when the key is not ours. */
export function focusKey(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }, focus: boolean): boolean | null {
  if ((e.metaKey === true || e.ctrlKey === true) && e.shiftKey === true && e.key.toLowerCase() === "f") return !focus;
  if (e.key === "Escape" && focus) return false;
  return null;
}

const BLOCK_LABEL: Readonly<Record<EmailBlockKind, string>> = { text: "Text", image: "Image", button: "Button", columns: "Columns", divider: "Divider", merge: "Merge field", html: "HTML" };
export const blockLabel = (k: EmailBlockKind): string => BLOCK_LABEL[k];
const MODE_LABEL: Readonly<Record<EmailMode, string>> = { visual: "Visual", html: "HTML", plain: "Plain text" };
export const modeLabel = (m: EmailMode): string => MODE_LABEL[m];
const TAB_TITLE: Readonly<Record<PaneTab, string>> = { style: "Style", ask: "Ask", preview: "Preview", checks: "Checks" };

/* ---------- icons ---------- */

const SVG = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">';
const ICON = {
  undo: `${SVG}<path d="M5.500 3L2.500 6l3 3M2.500 6H10a3.500 3.500 0 010 7H6.500"/></svg>`,
  redo: `${SVG}<path d="M10.500 3l3 3-3 3M13.500 6H6a3.500 3.500 0 000 7h3.500"/></svg>`,
  focus: `${SVG}<path d="M2.500 6V2.500H6M10 2.500h3.500V6M13.500 10v3.500H10M6 13.500H2.500V10"/></svg>`,
  send: `${SVG}<path d="M2 8l11-5-4 11-2.500-4.500z"/></svg>`,
  up: `${SVG}<path d="M4 9.500L8 5.500l4 4"/></svg>`,
  down: `${SVG}<path d="M4 6.500l4 4 4-4"/></svg>`,
  copy: `${SVG}<rect x="5.500" y="5.500" width="8" height="8" rx="1.500"/><path d="M10.500 5.500v-2a1 1 0 00-1-1h-6a1 1 0 00-1 1v6a1 1 0 001 1h2"/></svg>`,
  trash: `${SVG}<path d="M3 4.500h10M6.500 4.500V3h3v1.500M4.500 4.500l.5 8h6l.5-8"/></svg>`,
  text: `${SVG}<path d="M3 4.500h10M8 4.500v8M6 12.500h4"/></svg>`,
  image: `${SVG}<rect x="2.500" y="3" width="11" height="10" rx="1.500"/><path d="M2.500 11l3-3 3 3 2-2 3 3"/></svg>`,
  button: `${SVG}<rect x="2" y="5" width="12" height="6" rx="3"/></svg>`,
  columns: `${SVG}<rect x="2.500" y="3" width="11" height="10" rx="1.500"/><path d="M8 3v10"/></svg>`,
  divider: `${SVG}<path d="M2.500 8h11"/></svg>`,
  merge: `${SVG}<path d="M5.500 3C4 3 4 4 4 5.500S4 7 3 8c1 1 1 1.500 1 2.500S4 13 5.500 13M10.500 3C12 3 12 4 12 5.500S12 7 13 8c-1 1-1 1.500-1 2.500S12 13 10.500 13"/></svg>`,
  html: `${SVG}<path d="M6 4.500L2.500 8 6 11.500M10 4.500L13.500 8 10 11.500"/></svg>`,
  check: `${SVG}<path d="M3.500 8.500l3 3 6-7"/></svg>`,
} as const;
const BLOCK_ICON: Readonly<Record<EmailBlockKind, string>> = { text: ICON.text, image: ICON.image, button: ICON.button, columns: ICON.columns, divider: ICON.divider, merge: ICON.merge, html: ICON.html };

/* ---------- the view ---------- */

export interface AskMessage { from: "you" | "assistant"; text: string }
export interface EmailBrand { name: string; color: string; font: string }

/** Splits text into plain runs and merge tokens, so tokens draw as chips. */
export function splitTokens(text: string): readonly { token?: string; field?: string; text: string }[] {
  const out: { token?: string; field?: string; text: string }[] = [];
  let at = 0;
  for (const m of text.matchAll(/\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: text.slice(at, i) });
    out.push({ token: m[0], field: m[1] ?? "", text: (m[1] ?? "").replaceAll("_", " ") });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

export interface EmailBuilderViewProps extends EmailBuilderProps {
  /** The shared Ask control's props; the header shows it when given. */
  ask?: AskButtonProps;
  /** Field values of the record behind `previewRecordId`, for the preview. */
  mergeValues?: Readonly<Record<string, string>>;
  /** Called after every edit with the saved snapshot (the autosave: `email_builder.save`). */
  onChange?: (snapshot: EmailSnapshot, why: string) => void;
  onFocus?: (focus: boolean) => void;
  onPreview?: (preview: EmailPreview) => void;
  /** Which pane tab opens first. Defaults to Style, or Ask when `askOpen`. */
  paneTab?: PaneTab;
  /** Source of ids for new blocks. */
  makeId?: () => string;
  /** The Ask pane's conversation so far, oldest first. */
  askThread?: readonly AskMessage[];
  /** Called when the person sends a message from the Ask pane composer. */
  onAsk?: (text: string) => void;
  /** Sender shown in the inbox row of the Preview pane. */
  fromName?: string;
  /** Who a test send goes to. */
  testTo?: string;
  /** Name of the record the merge fields are filled from ("Elena Rivera"). */
  previewAs?: string;
  /** Starting email style (width, font, sizes, colours). */
  emailStyle?: EmailStyle;
  /** The firm's brand, shown in the Style pane. */
  brand?: EmailBrand;
  onUseBrand?: () => void;
}

/** Web-only attributes. react-native-web drops unknown props, so `data-x` becomes `dataSet.x` and `data-testid` becomes `testID`. */
function webProps(props: Record<string, unknown>): Record<string, unknown> {
  if (Platform.OS !== "web") return {};
  const out: Record<string, unknown> = {};
  const dataSet: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (k === "data-testid") out["testID"] = v;
    else if (k.startsWith("data-")) dataSet[k.slice(5)] = v;
    else out[k] = v;
  }
  if (Object.keys(dataSet).length > 0) out["dataSet"] = dataSet;
  return out;
}

/** A plain loop that builds children from data. Lists of things a person selects are the shared ui/Row (the ui-rows lint holds the line); this is for controls and blocks. */
function each<T, R>(items: readonly T[], make: (item: T, index: number) => R): R[] {
  const out: R[] = [];
  for (let i = 0; i < items.length; i++) out.push(make(items[i] as T, i));
  return out;
}

function Btn(p: { label: string; icon?: string; on?: boolean; disabled?: boolean; onPress?: () => void; testID?: string; strong?: boolean }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={p.label} accessibilityState={{ disabled: p.disabled === true, selected: p.on === true }} disabled={p.disabled === true}
      onPress={p.onPress} testID={p.testID}
      style={({ hovered }: { hovered?: boolean }) => [s.btn, p.on === true && s.btnOn, p.strong === true && s.btnStrong, hovered === true && s.btnOver, p.disabled === true && s.btnOff]}>
      {p.icon !== undefined ? <MenuIcon icon={p.icon} /> : null}
      {p.icon === undefined || p.strong === true ? <Text style={[s.btnText, p.strong === true && s.btnTextStrong]}>{p.label}</Text> : null}
    </Pressable>
  );
}

function Segmented(p: { value: EmailMode; onPick: (m: EmailMode) => void }): ReactElement {
  return (
    <View accessibilityRole="tablist" style={s.seg}>
      {each(EMAIL_MODES, (m) => (
        <Pressable key={m} accessibilityRole="tab" aria-selected={p.value === m} accessibilityState={{ selected: p.value === m }} testID={`em-mode-${m}`} onPress={() => p.onPick(m)} style={[s.segBtn, p.value === m && s.segOn]}>
          <Text style={[s.segText, p.value === m && s.segTextOn]}>{modeLabel(m)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Frame(p: { html: string; width: number }): ReactElement {
  if (Platform.OS !== "web") return <Text style={s.note}>{p.html.length} characters of HTML</Text>;
  return createElement("iframe", { title: "Email preview", srcDoc: p.html, style: { border: 0, background: "#fff", borderRadius: 10, width: p.width, maxWidth: "100%", height: 520 }, "data-testid": "em-frame" }) as ReactElement;
}

export function EmailBuilder(props: EmailBuilderViewProps): ReactElement {
  const { onChange, onFocus, onPreview, onMode, onTestSend, onAcceptDiff } = props;
  const seq = useRef(0);
  const makeId = props.makeId ?? ((): string => `b${++seq.current}-${Date.now().toString(36)}`);
  const [mode, setMode] = useState<EmailMode>(props.mode);
  const [focus, setFocus] = useState(props.focus === true);
  const [preview, setPreview] = useState<EmailPreview>(props.preview ?? "desktop");
  const [tab, setTab] = useState<PaneTab>(props.paneTab ?? (props.askOpen === true ? "ask" : "style"));
  const [subject, setSubject] = useState(props.subject);
  const [previewText, setPreviewText] = useState(props.previewText ?? "");
  const [blocks, setBlocks] = useState<readonly EmailBlock[]>(props.blocks ?? []);
  const [html, setHtml] = useState(props.html ?? "");
  const [plain, setPlain] = useState(props.plain ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(() => new Set((props.diffs ?? []).filter((d) => d.accepted === true).map((d) => d.id)));
  const [version, setVersion] = useState(props.version ?? 1);
  const initial: EmailSnapshot = { subject: props.subject, previewText: props.previewText ?? "", blocks: props.blocks ?? [], html: props.html ?? "", plain: props.plain ?? "" };
  const [hist, setHist] = useState<EmailHistory>({ entries: [initial], at: 0 });
  const [sent, setSent] = useState(false);
  const [style, setStyle] = useState<EmailStyle>(props.emailStyle ?? DEFAULT_EMAIL_STYLE);
  const menu = useMenu();
  const fontBtn = useRef<{ measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [thread, setThread] = useState<readonly AskMessage[]>(props.askThread ?? []);

  useEffect(() => setMode(props.mode), [props.mode]);
  useEffect(() => setFocus(props.focus === true), [props.focus]);
  useEffect(() => { if (props.preview !== undefined) setPreview(props.preview); }, [props.preview]);

  const snap = useMemo<EmailSnapshot>(() => ({ subject, previewText, blocks, html, plain, style }), [subject, previewText, blocks, html, plain, style]);
  const compiled = useMemo(() => (mode === "html" && html !== "" ? html : formatHtml(compileEmail(blocks, { mode: "send", style }))), [mode, html, blocks]);
  const plainText = plain !== "" ? plain : blocksToPlain(blocks);
  const checks = useMemo(() => runChecks({ subject, previewText, html: compiled, plain: plainText }), [subject, previewText, compiled, plainText]);
  const preHtml = useMemo(() => {
    const raw = mode === "html" && html !== "" ? html : compileEmail(blocks, { mode: "preview", dark: preview === "dark", values: props.mergeValues, style });
    return mode === "html" ? fillMerge(raw, props.mergeValues) : raw;
  }, [mode, html, blocks, preview, props.mergeValues, style]);

  const commit = useCallback((next: EmailSnapshot, why: string) => {
    setHist((h) => pushHistory(h, next));
    setVersion((v) => v + 1);
    onChange?.(next, why);
  }, [onChange]);

  const setFocusMode = useCallback((v: boolean) => { setFocus(v); onFocus?.(v); }, [onFocus]);
  const pickMode = useCallback((m: EmailMode) => { setMode(m); onMode?.(m); }, [onMode]);
  const pickPreview = useCallback((p: EmailPreview) => { setPreview(p); onPreview?.(p); }, [onPreview]);

  const restore = (d: -1 | 1): void => {
    const h = stepHistory(hist, d);
    const e = h.entries[h.at];
    if (e === undefined || h.at === hist.at) return;
    setHist(h); setSubject(e.subject); setPreviewText(e.previewText); setBlocks(e.blocks); setHtml(e.html); setPlain(e.plain); setStyle(e.style ?? DEFAULT_EMAIL_STYLE);
    onChange?.(e, d < 0 ? "Undo" : "Redo");
  };

  const changeStyle = (patch: Partial<EmailStyle>, why: string): void => { const next = { ...style, ...patch }; setStyle(next); commit({ ...snap, style: next }, why); };
  const changeColor = (k: keyof EmailColors, v: string): void => { if (isHex(v)) changeStyle({ colors: { ...style.colors, [k]: v.toUpperCase() } }, `Changed ${COLOR_LABEL[k].toLowerCase()} colour`); };
  const tidy = (): void => { const next = formatHtml(html !== "" ? html : compiled); setHtml(next); commit({ ...snap, html: next }, "Tidied the HTML"); };
  const pickFont = (): void => {
    const open = (x: number, y: number): void => menu.show(EMAIL_FONTS.map((f) => ({ label: f, checked: style.font === f, onSelect: () => changeStyle({ font: f }, `Changed the font to ${f}`) })), x, y, "other");
    if (fontBtn.current?.measureInWindow !== undefined) fontBtn.current.measureInWindow((x, y, _w, h) => open(x, y + h + 4)); else open(0, 0);
  };
  const changeBlocks = (next: readonly EmailBlock[], why: string): void => { setBlocks(next); commit({ ...snap, blocks: next }, why); };
  const add = (kind: EmailBlockKind): void => {
    const b = newBlock(kind, makeId());
    const at = selected === null ? -1 : blocks.findIndex((x) => x.id === selected);
    const next = at < 0 ? [...blocks, b] : [...blocks.slice(0, at + 1), b, ...blocks.slice(at + 1)];
    changeBlocks(next, `Added ${blockLabel(kind).toLowerCase()}`);
    setSelected(b.id);
  };
  const accept = (d: EmailDiff): void => { setAccepted((a) => new Set([...a, d.id])); onAcceptDiff?.(d.id); commit(snap, `Accepted: ${d.summary}`); };

  // Cmd-Shift-F and Escape (web only; native has no keyboard shortcut for it).
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return undefined;
    const on = (e: KeyboardEvent): void => {
      const next = focusKey(e, focus);
      if (next === null) return;
      e.preventDefault();
      setFocusMode(next);
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [focus, setFocusMode]);

  const { width: winW } = useWindowDimensions();
  const narrow = winW > 0 && winW < NARROW_WIDTH;
  const compact = props.density === "compact" || narrow;
  const diffs = props.diffs ?? [];
  const unsub = checks.find((c) => c.id === "unsub") ?? { level: "bad" as CheckLevel };
  const sizeKb = (compiled.length / 1024).toFixed(1);
  const sel = blocks.find((b) => b.id === selected) ?? null;

  const head = (
    <View style={s.head} testID="em-head">
      <Btn label="Undo" icon={ICON.undo} disabled={!canUndo(hist)} onPress={() => restore(-1)} testID="em-undo" />
      <Btn label="Redo" icon={ICON.redo} disabled={!canRedo(hist)} onPress={() => restore(1)} testID="em-redo" />
      {narrow ? null : <View style={s.sep} />}
      <Segmented value={mode} onPick={pickMode} />
      <View style={s.grow} />
      {narrow ? null : <Text style={s.stat} testID="em-version">{`Saved v${version}`}</Text>}
      <Btn label="Focus" icon={ICON.focus} onPress={() => setFocusMode(true)} testID="em-focus" />
      <Btn label="Test send" icon={ICON.send} onPress={() => { setSent(true); onTestSend?.(); }} testID="em-test-send" />
      {props.ask !== undefined ? <AskButton {...props.ask} compact={compact} /> : null}
    </View>
  );

  const envelope = (
    <View style={s.env} testID="em-env">
      <View style={s.envRow}>
        <Text style={s.envLabel}>Subject</Text>
        <TextInput accessibilityLabel="Subject" testID="em-subject" value={subject} placeholder="Subject" placeholderTextColor="var(--ink-4)" style={s.envInput}
          onChangeText={(t) => { setSubject(t); commit({ ...snap, subject: t }, "Changed the subject"); }} />
        <Text style={[s.cnt, subject.length > SUBJECT_LIMIT && s.cntWarn]}>{`${subject.length}/${SUBJECT_LIMIT}`}</Text>
      </View>
      <View style={s.envRow}>
        <Text style={s.envLabel}>Preview text</Text>
        <TextInput accessibilityLabel="Preview text" testID="em-preview-text" value={previewText} placeholder="What inboxes show beside the subject" placeholderTextColor="var(--ink-4)" style={s.envInput}
          onChangeText={(t) => { setPreviewText(t); commit({ ...snap, previewText: t }, "Changed the preview text"); }} />
        <Text style={[s.cnt, previewText.length > PREVIEW_TEXT_LIMIT && s.cntWarn]}>{`${previewText.length}/${PREVIEW_TEXT_LIMIT}`}</Text>
      </View>
    </View>
  );

  const rail = (
    <View style={[s.rail, narrow && s.railNarrow]} testID="em-rail" accessibilityLabel="Blocks">
      {each(EMAIL_BLOCK_KINDS, (k) => (
        <Pressable key={k} accessibilityRole="button" accessibilityLabel={`Add ${blockLabel(k)}`} testID={`em-add-${k}`} onPress={() => add(k)}
          style={({ hovered }: { hovered?: boolean }) => [s.railBtn, hovered === true && s.btnOver]}>
          <MenuIcon icon={BLOCK_ICON[k]} />
          <Text style={s.railText}>{blockLabel(k)}</Text>
        </Pressable>
      ))}
    </View>
  );

  const blockView = (b: EmailBlock, depth: number): ReactElement => {
    const on = b.id === selected;
    return (
      <Pressable key={b.id} testID={`em-block-${b.id}`} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${blockLabel(b.kind)} block`} onPress={() => setSelected(b.id)}
        style={({ hovered }: { hovered?: boolean }) => [s.blk, (on || hovered === true) && s.blkOver, on && s.blkOn]}>
        {b.kind === "text" && editing !== b.id ? (
          <Text style={s.textBlock} testID={`em-text-${b.id}`} onPress={() => { setSelected(b.id); setEditing(b.id); }}>
            {each(splitTokens(b.text ?? ""), (r, i) => r.token === undefined ? r.text
              : <Text key={i} style={s.mergeTok} {...webProps({ "data-token": r.token })}>{r.text}</Text>)}
          </Text>
        ) : null}
        {(b.kind === "text" && editing === b.id) || b.kind === "button" ? (
          <TextInput multiline={b.kind === "text"} autoFocus={b.kind === "text"} accessibilityLabel={`${blockLabel(b.kind)} text`} value={b.text ?? ""} placeholder="Type here" placeholderTextColor="#a1a1a6"
            style={[b.kind === "button" ? s.btnBlock : s.textBlock]} onFocus={() => setSelected(b.id)} onBlur={() => setEditing((e) => (e === b.id ? null : e))}
            onChangeText={(t) => changeBlocks(editBlock(blocks, b.id, { text: t }), "Edited text")} />
        ) : null}
        {b.kind === "image" ? <View style={s.imgBlock}><Text style={s.imgText}>{b.text ?? "Image"}</Text></View> : null}
        {b.kind === "divider" ? <View style={s.divBlock} /> : null}
        {b.kind === "merge" ? <Text style={s.mergeTok}>{mergeToken(b.field ?? "", b.text ?? "")}</Text> : null}
        {b.kind === "html" ? <Text style={s.htmlBlock}>{b.text ?? ""}</Text> : null}
        {b.kind === "columns" ? <View style={s.cols}>{each(b.children ?? [], (c) => <View key={c.id} style={s.col}>{blockView(c, depth + 1)}</View>)}</View> : null}
      </Pressable>
    );
  };

  const stage = (
    <View style={s.stage} testID="em-stage">
      {mode === "visual" ? (
        <ScrollView style={s.scroll} contentContainerStyle={s.page}>
          <View style={[s.card, focus && s.cardFocus]} testID="em-card">
            {blocks.length === 0 ? <Text style={s.empty}>Add a block from the left, or press Ask.</Text> : each(blocks, (b) => blockView(b, 0))}
          </View>
        </ScrollView>
      ) : null}
      {mode === "html" ? (
        <View style={s.split} testID="em-htmlsplit">
          <View style={s.srcCol}>
            <View style={s.srcHead}><Text style={s.srcName}>email.html</Text><View style={s.srcActs}><Text style={s.stat}>{`${compiled.split("\n").length} lines`}</Text><Btn label="Tidy" onPress={tidy} testID="em-tidy" strong /></View></View>
            <ScrollView style={s.scroll}>
              <View style={s.srcRow}>
                <Text style={s.gutter} selectable={false} testID="em-gutter">{each(compiled.split("\n"), (_, i) => i + 1).join("\n")}</Text>
                <TextInput multiline scrollEnabled={false} accessibilityLabel="HTML" testID="em-html" value={html !== "" ? html : compiled} spellCheck={false} autoCapitalize="none" style={s.code}
                  onChangeText={(t) => { setHtml(t); commit({ ...snap, html: t }, "Edited the HTML"); }} />
              </View>
            </ScrollView>
            <View style={s.status} testID="em-status">
              <View style={[s.dot, unsub.level === "ok" ? s.dotOk : s.dotBad]} />
              <Text style={s.stat}>{unsub.level === "ok" ? "Unsubscribe link present" : "No unsubscribe link"}</Text>
              <Text style={s.stat}>{`${sizeKb} KB, ${compiled.length < 102 * 1024 ? "under" : "over"} the 102 KB Gmail clip limit`}</Text>
            </View>
          </View>
          {narrow ? null : <View style={s.livePane}><Text style={s.srcName}>Live preview</Text><View style={s.frame}><Frame html={preHtml} width={300} /></View></View>}
        </View>
      ) : null}
      {mode === "plain" ? (
        <ScrollView style={s.scroll} contentContainerStyle={s.codeWrap}>
          <TextInput multiline accessibilityLabel="Plain text" testID="em-plain" value={plainText} style={s.plain}
            onChangeText={(t) => { setPlain(t); commit({ ...snap, plain: t }, "Edited the plain-text part"); }} />
        </ScrollView>
      ) : null}
    </View>
  );

  const blockBar = sel !== null && mode === "visual" && !focus ? (
    <View style={s.bar} testID="em-blockbar">
      <Btn label="Move up" icon={ICON.up} onPress={() => changeBlocks(moveBlock(blocks, sel.id, -1), "Moved a block up")} />
      <Btn label="Move down" icon={ICON.down} onPress={() => changeBlocks(moveBlock(blocks, sel.id, 1), "Moved a block down")} />
      <Btn label="Duplicate" icon={ICON.copy} onPress={() => { const i = blocks.findIndex((b) => b.id === sel.id); const c = { ...sel, id: makeId() }; changeBlocks([...blocks.slice(0, i + 1), c, ...blocks.slice(i + 1)], "Duplicated a block"); setSelected(c.id); }} />
      <Btn label="Delete" icon={ICON.trash} onPress={() => { changeBlocks(blocks.filter((b) => b.id !== sel.id), "Deleted a block"); setSelected(null); }} />
    </View>
  ) : null;

  const pane = (
    <View style={[s.pane, narrow && s.paneNarrow]} testID="em-pane">
      <TabStrip tabs={each(PANE_TABS, (k) => ({ key: k, title: TAB_TITLE[k] }))} active={tab} onSelect={(k) => setTab(k as PaneTab)} />
      <ScrollView style={s.paneBody} contentContainerStyle={s.paneContent}>
        {tab === "style" ? (
          <View testID="em-style">
            {props.brand !== undefined ? (
              <View testID="em-brand">
                <Text style={s.sec}>Brand</Text>
                <Row id="brand" title={props.brand.name} note={`${props.brand.color} · ${props.brand.font}`}
                  leading={<View style={[s.brandDot, { backgroundColor: props.brand.color }]}><Text style={s.brandLetter}>{props.brand.name.slice(0, 1)}</Text></View>}
                  trailing={<Btn label="Use brand" strong onPress={() => props.onUseBrand?.()} testID="em-use-brand" />} />
              </View>
            ) : null}
            <Text style={s.sec}>Email</Text>
            <View style={s.ctl} testID="em-width">
              <Text style={s.ctlLabel}>Width</Text>
              <View style={s.seg}>{each(EMAIL_WIDTHS, (w) => (
                <Pressable key={w} accessibilityRole="tab" aria-selected={style.width === w} accessibilityState={{ selected: style.width === w }} testID={`em-width-${w}`} onPress={() => changeStyle({ width: w }, `Set the width to ${w}`)} style={[s.segBtn, style.width === w && s.segOn]}>
                  <Text style={[s.segText, style.width === w && s.segTextOn]}>{String(w)}</Text>
                </Pressable>))}</View>
            </View>
            <View style={s.ctl}>
              <Text style={s.ctlLabel}>Font</Text>
              <Pressable ref={(r) => { fontBtn.current = r as unknown as typeof fontBtn.current; }} accessibilityRole="button" accessibilityLabel="Font" testID="em-font" onPress={pickFont} style={({ hovered }: { hovered?: boolean }) => [s.btn, hovered === true && s.btnOver]}>
                <Text style={s.btnText}>{style.font}</Text><MenuIcon icon={ICON.down} />
              </Pressable>
            </View>
            {each([["size", "Text size", 12, 22], ["padding", "Side padding", 8, 56], ["radius", "Corner radius", 0, 24]] as const, ([k, label, lo, hi]) => (
              <View key={k} style={s.ctl} testID={`em-${k}`}>
                <Text style={s.ctlLabel}>{label}</Text>
                <View style={s.stepper}>
                  <Btn label={`Less ${label.toLowerCase()}`} icon={ICON.down} disabled={style[k] <= lo} onPress={() => changeStyle({ [k]: Math.max(lo, style[k] - (k === "padding" ? 4 : 1)) }, `Changed ${label.toLowerCase()}`)} testID={`em-${k}-less`} />
                  <Text style={s.ctlValue} testID={`em-${k}-value`}>{String(style[k])}</Text>
                  <Btn label={`More ${label.toLowerCase()}`} icon={ICON.up} disabled={style[k] >= hi} onPress={() => changeStyle({ [k]: Math.min(hi, style[k] + (k === "padding" ? 4 : 1)) }, `Changed ${label.toLowerCase()}`)} testID={`em-${k}-more`} />
                </View>
              </View>
            ))}
            <Text style={s.sec}>Colours</Text>
            <View testID="em-colours">
              {each(Object.keys(COLOR_LABEL) as (keyof EmailColors)[], (k) => (
                <View key={k} style={s.ctl} testID={`em-colour-${k}`}>
                  <Text style={s.ctlLabel}>{COLOR_LABEL[k]}</Text>
                  <View style={s.hexRow}>
                    <TextInput accessibilityLabel={`${COLOR_LABEL[k]} colour`} testID={`em-hex-${k}`} defaultValue={style.colors[k]} autoCapitalize="characters" maxLength={7} spellCheck={false} style={s.hex}
                      onChangeText={(v) => changeColor(k, v)} />
                    <View style={[s.swatch, { backgroundColor: style.colors[k] }]} />
                  </View>
                </View>
              ))}
            </View>
            <Text style={s.sec}>Merge fields</Text>
            {mergeFieldsOf(`${subject} ${compiled}`).length === 0 ? <Text style={s.note}>No merge fields yet. The Merge field block adds one.</Text>
              : each(mergeFieldsOf(`${subject} ${compiled}`), (f) => <View key={f} testID={`em-field-${f}`}><Row id={f} title={f} /></View>)}
            <Text style={s.sec}>Selected block</Text>
            <Text style={s.note}>{sel !== null ? `${blockLabel(sel.kind)}. Edit it in place; the bar above the card moves, copies or deletes it.` : "Select a block to change it."}</Text>
          </View>
        ) : null}
        {tab === "ask" ? (
          <View testID="em-ask">
            <View style={s.askHead}>{props.ask !== undefined ? <AskButton {...props.ask} compact /> : null}<Text style={s.stat} numberOfLines={1}>{props.title}</Text></View>
            {each(thread, (m, i) => (
              <View key={i} style={m.from === "you" ? s.msgYou : s.msgBot} testID={`em-msg-${i}`}>
                <Text style={s.msgText}>{m.text}</Text>
              </View>
            ))}
            <Text style={s.sec}>Suggested changes</Text>
            {diffs.length === 0 ? <Text style={s.note}>Nothing suggested yet. Ask an agent to rewrite the subject or tighten the body; each change comes back here to accept one at a time.</Text> : null}
            {each(diffs, (d) => (
              <View key={d.id} testID={`em-diff-${d.id}`} {...webProps({ "data-accepted": accepted.has(d.id) ? "true" : "false" })}>
                <Row id={d.id} title={d.summary}
                  trailing={accepted.has(d.id) ? <Text style={s.done}>Accepted</Text> : <Btn label="Accept" strong onPress={() => accept(d)} testID={`em-accept-${d.id}`} />} />
              </View>
            ))}
            <View style={s.composer} testID="em-composer">
              <Composer whoWillAnswer={props.ask?.agents.find((a) => a.assistant === true)?.name ?? "Assistant"} placeholder="What should change?" symbols={["at", "hash", "slash"]}
                onSend={(text) => { setThread((th) => [...th, { from: "you", text }]); props.onAsk?.(text); }} />
            </View>
          </View>
        ) : null}
        {tab === "preview" ? (
          <View testID="em-previewpane">
            <View style={s.seg}>
              {each(EMAIL_PREVIEWS, (p) => (
                <Pressable key={p} accessibilityRole="tab" aria-selected={preview === p} accessibilityState={{ selected: preview === p }} testID={`em-pv-${p}`} onPress={() => pickPreview(p)} style={[s.segBtn, preview === p && s.segOn]}>
                  <Text style={[s.segText, preview === p && s.segTextOn]}>{p === "desktop" ? "Desktop" : p === "mobile" ? "Mobile" : "Dark"}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={s.sec}>In the inbox</Text>
            <View style={s.inbox} testID="em-inbox">
              <View style={s.brandDot}><Text style={s.brandLetter}>{(props.fromName ?? "N").slice(0, 1)}</Text></View>
              <View style={s.grow}>
                <Text style={s.inboxFrom} numberOfLines={1}>{props.fromName ?? "Sender"}</Text>
                <Text style={s.inboxSub} numberOfLines={1}>{fillMerge(subject, props.mergeValues)}</Text>
                <Text style={s.note} numberOfLines={1}>{previewText === "" ? "No preview text" : previewText}</Text>
              </View>
            </View>
            <Text style={s.note}>{`${props.previewAs !== undefined ? `For ${props.previewAs}. ` : ""}Phones cut the subject at about 40 characters.`}</Text>
            <View style={s.frame}><Frame html={preHtml} width={Math.min(PREVIEW_WIDTH[preview], 340)} /></View>
            <Text style={s.sec}>Send a test</Text>
            <Row id="to" title={props.testTo ?? "You"} note="To" />
            <View style={s.testRow}>
              <Btn label="Send test" strong onPress={() => { setSent(true); onTestSend?.(); }} testID="em-preview-send" />
              <Text style={s.note}>Merge fields are filled in for the record.</Text>
            </View>
          </View>
        ) : null}
        {tab === "checks" ? (
          <View testID="em-checks">
            {each(checks, (c) => (
              <View key={c.id} testID={`em-check-${c.id}`} {...webProps({ "data-level": c.level })}>
                <Row id={c.id} title={c.name} note={c.note}
                  leading={<View style={[s.dot, c.level === "ok" ? s.dotOk : c.level === "warn" ? s.dotWarn : s.dotBad]} />} />
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );

  return (
    <View
      {...webProps({ "data-testid": "email-builder", "data-mode": mode, "data-focus": focus ? "true" : "false", "data-version": String(version), "data-preview": preview, "data-density": props.density ?? "regular" })}
      accessibilityLabel={emailLabel(props)} style={[s.root, focus && s.rootFocus]}>
      {focus ? null : head}
      {focus ? null : envelope}
      <View style={[s.main, narrow && s.mainNarrow]}>
        {focus || mode !== "visual" ? null : rail}
        <View style={s.stageCol}>
          {blockBar}
          {stage}
        </View>
        {focus ? null : pane}
      </View>
      {focus ? <Text style={s.hint} testID="em-focus-hint">Focus mode. Esc or Shift-Cmd-F to leave.</Text> : null}
      {menu.element}
      {sent ? <Text style={s.toast} testID="em-sent">Test email sent to you.</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: "var(--win)" as string },
  rootFocus: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 900 },
  head: { height: 42, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  grow: { flex: 1 },
  sep: { width: 1, height: 18, backgroundColor: "var(--line)" as string, marginHorizontal: 4 },
  stat: { color: "var(--ink-3)" as string, fontSize: 12 },
  btn: { height: 28, minWidth: 28, paddingHorizontal: 7, borderRadius: 7, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  btnOn: { backgroundColor: "var(--accent-wash)" as string },
  btnStrong: { borderWidth: 1, borderColor: "var(--line-2)" as string, paddingHorizontal: 11 },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnOff: { opacity: 0.35 },
  btnText: { color: "var(--ink-3)" as string, fontSize: 12.5, fontWeight: "500" },
  btnTextStrong: { color: "var(--ink)" as string },
  seg: { flexDirection: "row", padding: 2, borderRadius: 8, backgroundColor: "var(--sunk)" as string, alignSelf: "flex-start" },
  segBtn: { height: 24, paddingHorizontal: 12, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: "var(--win)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  segText: { color: "var(--ink-3)" as string, fontSize: 12.5, fontWeight: "500" },
  segTextOn: { color: "var(--ink)" as string },
  env: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  envRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 30 },
  envLabel: { width: 78, color: "var(--ink-3)" as string, fontSize: 12.5 },
  envInput: { flex: 1, minWidth: 0, height: 30, color: "var(--ink)" as string, fontSize: 14, paddingHorizontal: 4, borderRadius: 6 },
  cnt: { color: "var(--ink-4)" as string, fontSize: 11.5, minWidth: 38, textAlign: "right" },
  cntWarn: { color: "var(--warn)" as string },
  main: { flex: 1, minHeight: 0, flexDirection: "row" },
  rail: { width: 62, borderRightWidth: 1, borderRightColor: "var(--line)" as string, paddingVertical: 8, paddingHorizontal: 6, gap: 2 },
  railNarrow: { width: "100%", flexDirection: "row", borderRightWidth: 0, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, paddingVertical: 4, flexWrap: "wrap" },
  mainNarrow: { flexDirection: "column" },
  paneNarrow: { width: "100%", height: 300, borderLeftWidth: 0, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  railBtn: { height: 46, borderRadius: 8, alignItems: "center", justifyContent: "center", gap: 3 },
  railText: { color: "var(--ink-3)" as string, fontSize: 10.5, fontWeight: "500" },
  stageCol: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: "var(--sunk)" as string },
  stage: { flex: 1, minHeight: 0 },
  bar: { flexDirection: "row", gap: 2, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
  scroll: { flex: 1 },
  page: { paddingTop: 28, paddingHorizontal: 24, paddingBottom: 120 },
  card: { alignSelf: "center", width: "100%", maxWidth: 600, backgroundColor: "#FFFFFF", paddingVertical: 8 },
  cardFocus: { marginTop: 40 },
  blk: { borderWidth: 1.5, borderColor: "transparent", paddingHorizontal: 20, paddingVertical: 6 },
  blkOver: { borderColor: "var(--accent-line)" as string },
  blkOn: { borderColor: "var(--accent)" as string },
  textBlock: { color: "#18181A", fontSize: 15, lineHeight: 22, minHeight: 22, padding: 0 },
  btnBlock: { alignSelf: "flex-start", color: "#FFFFFF", backgroundColor: "#4F46E5", fontSize: 14, fontWeight: "600", paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8 },
  imgBlock: { height: 140, backgroundColor: "#E9E9EC", alignItems: "center", justifyContent: "center" },
  imgText: { color: "#8A8A8F", fontSize: 13 },
  divBlock: { height: 1, backgroundColor: "#E4E4E7", marginVertical: 10 },
  mergeTok: { alignSelf: "flex-start", color: "#4A4AB8", backgroundColor: "#ECEBFA", fontSize: 14, paddingHorizontal: 5, borderRadius: 5 },
  htmlBlock: { color: "#18181A", fontFamily: "var(--mono)" as string, fontSize: 12.5 },
  cols: { flexDirection: "row", gap: 12 },
  col: { flex: 1 },
  empty: { color: "#8A8A8F", textAlign: "center", paddingVertical: 56, fontSize: 13 },
  codeWrap: { padding: 24, alignItems: "center" },
  split: { flex: 1, flexDirection: "row", minHeight: 0 },
  srcCol: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  srcHead: { height: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  srcActs: { flexDirection: "row", alignItems: "center", gap: 10 },
  status: { flexDirection: "row", alignItems: "center", gap: 10, height: 30, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  ctl: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 34 },
  ctlLabel: { color: "var(--ink-2)" as string, fontSize: 12.5 },
  ctlValue: { color: "var(--ink)" as string, fontSize: 12.5, minWidth: 28, textAlign: "center" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4 },
  hexRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  hex: { width: 84, height: 28, color: "var(--ink)" as string, fontFamily: "var(--mono)" as string, fontSize: 12, paddingHorizontal: 8, borderRadius: 6, backgroundColor: "var(--sunk)" as string },
  swatch: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: "var(--line-2)" as string },
  srcName: { color: "var(--ink-3)" as string, fontSize: 12, fontWeight: "500" },
  srcRow: { flexDirection: "row", paddingVertical: 12 },
  gutter: { width: 42, textAlign: "right", paddingRight: 10, color: "var(--ink-4)" as string, fontFamily: "var(--mono)" as string, fontSize: 12.5, lineHeight: 19 },
  livePane: { width: 340, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, padding: 12, alignItems: "center" },
  code: { flex: 1, minWidth: 0, minHeight: 480, padding: 0, backgroundColor: "transparent", color: "var(--ink)" as string, fontFamily: "var(--mono)" as string, fontSize: 12.5, lineHeight: 19 },
  plain: { width: "100%", maxWidth: 640, minHeight: 480, padding: 24, borderRadius: 10, backgroundColor: "#FFFFFF", color: "#18181A", fontFamily: "var(--mono)" as string, fontSize: 13.5, lineHeight: 21 },
  pane: { width: 380, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, backgroundColor: "var(--win)" as string, minHeight: 0 },
  paneBody: { flex: 1 },
  paneContent: { padding: 14, paddingBottom: 24 },
  sec: { color: "var(--ink-3)" as string, fontSize: 11.5, fontWeight: "600", marginTop: 16, marginBottom: 8 },
  note: { color: "var(--ink-3)" as string, fontSize: 12.5, lineHeight: 18 },
  done: { color: "var(--ok)" as string, fontSize: 12, fontWeight: "500" },
  frame: { marginTop: 14, alignItems: "center" },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  dotOk: { backgroundColor: "var(--ok)" as string },
  dotWarn: { backgroundColor: "var(--warn)" as string },
  dotBad: { backgroundColor: "var(--danger)" as string },
  brandDot: { width: 28, height: 28, borderRadius: 7, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center", marginRight: 10 },
  brandLetter: { color: "#FFFFFF", fontSize: 12.5, fontWeight: "700" },
  askHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  msgYou: { alignSelf: "flex-end", maxWidth: "88%", backgroundColor: "var(--sunk)" as string, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8 },
  msgBot: { alignSelf: "flex-start", maxWidth: "94%", paddingVertical: 4, marginBottom: 8 },
  msgText: { color: "var(--ink)" as string, fontSize: 13, lineHeight: 19 },
  composer: { marginTop: 14 },
  inbox: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 10, padding: 10, marginBottom: 8 },
  inboxFrom: { color: "var(--ink)" as string, fontSize: 13, fontWeight: "600" },
  inboxSub: { color: "var(--ink)" as string, fontSize: 13 },
  testRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  hint: { position: "absolute", top: 12, right: 16, color: "var(--ink-3)" as string, fontSize: 12, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 8, backgroundColor: "var(--raised)" as string },
  toast: { position: "absolute", bottom: 16, alignSelf: "center", color: "var(--ink)" as string, fontSize: 12.5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: "var(--raised)" as string },
});
