// ui/RichEditor: one component for the Yjs document (spec 2.16, ARCH 5.6, risk R6). Web and the desktop shell mount TipTap on the document's
// fragment, with the Collaboration extensions, so two people typing converge and each sees the other's cursor. The phone mounts a WebView that
// runs the same editor and talks to the app through a small bridge (bridge.ts, page.ts). The document is the source of truth; `markdown` is the
// snapshot: it seeds an empty document and it is handed back (onMarkdown) after edits, for search and the file on disk.
// The static view draws the same document as read-only blocks with the remote cursors, for read access and for the first paint.
// Colours are skin tokens (CSS variables on web), so a skin switch repaints with no re-render.

import { createElement, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { MenuIcon } from "../Menu/index.tsx";
import { bridgeHtml, connectBridge } from "./bridge.ts";
import type { BridgeEnd } from "./bridge.ts";
import { blocksToText, plainText } from "./markdown.ts";
import type { Block, Run } from "./markdown.ts";
import { frozenRichEditorProps } from "./props.ts";
import type { Density, RichEditorMode, RichEditorProps } from "./props.ts";
import { Awareness, Y, exportMarkdown, fragmentToBlocks, importMarkdown, remoteCursors } from "./yjs.ts";
import type { CursorUser, RemoteCursor } from "./yjs.ts";

export type { Density, RichEditorMode, RichEditorProps } from "./props.ts";
export { frozenRichEditorProps } from "./props.ts";
export { blocksToText, mergeRuns, parseInline, parseMarkdown, plainText, renderInline, renderMarkdown } from "./markdown.ts";
export type { Block, Mark, Run } from "./markdown.ts";
export { Awareness, FRAGMENT, Y, blocksToFragment, connectDocs, dropAwareness, exportMarkdown, fragmentToBlocks, importMarkdown, remoteCursors, sendAwareness, setLocalCursor } from "./yjs.ts";
export type { CursorUser, RemoteCursor } from "./yjs.ts";
export { bridgeHtml, connectBridge, decodeBridge, encodeBridge, fromBase64, toBase64 } from "./bridge.ts";
export type { BridgeEnd, BridgeMessage } from "./bridge.ts";

/* ---------- modes ---------- */

export interface ModeFlags {
  editable: boolean;
  /** Edits are proposed, not applied: the tracked-change layer. */
  suggesting: boolean;
  label: string;
}

export function modeFlags(mode: RichEditorMode): ModeFlags {
  if (mode === "read") return { editable: false, suggesting: false, label: "Read only" };
  if (mode === "suggest") return { editable: true, suggesting: true, label: "Suggesting" };
  return { editable: true, suggesting: false, label: "Editing" };
}

/* ---------- the document ---------- */

/** A document seeded from markdown when it is empty. The host swaps in the sync module's doc for `docId`; the view takes either. */
export function useRichDoc(markdown: string, existing?: Y.Doc): Y.Doc {
  return useMemo(() => {
    const d = existing ?? new Y.Doc();
    if (d.getXmlFragment("default").length === 0 && markdown.trim() !== "") importMarkdown(d, markdown);
    return d;
  }, [existing]);
}

/** Where a character offset in the document's plain text falls: the block and the column in it. Blocks are separated by one newline. */
export function locateOffset(blocks: readonly Block[], offset: number): { block: number; col: number } {
  let at = 0;
  for (const [i, b] of blocks.entries()) {
    const len = blockLength(b);
    if (offset <= at + len) return { block: i, col: Math.max(0, offset - at) };
    at += len + 1;
  }
  return { block: Math.max(0, blocks.length - 1), col: 0 };
}

function blockLength(b: Block): number {
  if (b.type === "paragraph" || b.type === "heading" || b.type === "blockquote") return plainText(b.runs).length;
  if (b.type === "codeBlock") return b.text.length;
  if (b.type === "bulletList" || b.type === "orderedList") {
    let n = 0;
    for (const item of b.items) n += plainText(item).length + 1;
    return Math.max(0, n - 1);
  }
  return 0;
}

/** Cuts runs at a column so a caret can sit between the halves. */
export function splitRunsAt(runs: readonly Run[], col: number): { before: Run[]; after: Run[] } {
  const before: Run[] = [];
  const after: Run[] = [];
  let seen = 0;
  for (const r of runs) {
    const end = seen + r.text.length;
    if (end <= col) before.push(r);
    else if (seen >= col) after.push(r);
    else {
      before.push({ ...r, text: r.text.slice(0, col - seen) });
      after.push({ ...r, text: r.text.slice(col - seen) });
    }
    seen = end;
  }
  return { before, after };
}

/* ---------- toolbar ---------- */

interface ChainLike {
  focus(): ChainLike;
  toggleBold(): ChainLike;
  toggleItalic(): ChainLike;
  toggleStrike(): ChainLike;
  toggleCode(): ChainLike;
  toggleHeading(o: { level: number }): ChainLike;
  toggleBulletList(): ChainLike;
  toggleOrderedList(): ChainLike;
  toggleBlockquote(): ChainLike;
  toggleCodeBlock(): ChainLike;
  run(): boolean;
}

interface EditorLike {
  chain(): ChainLike;
  isActive(name: string, attrs?: Record<string, unknown>): boolean;
  setEditable(v: boolean): void;
  destroy(): void;
  on(event: "transaction" | "selectionUpdate", fn: () => void): void;
}

export interface ToolbarCommand {
  id: string;
  label: string;
  /** Text stand-in where no inline svg is drawn (phone). */
  glyph: string;
  run: (e: EditorLike) => void;
  active: (e: EditorLike) => boolean;
}

export const TOOLBAR: readonly ToolbarCommand[] = [
  { id: "bold", label: "Bold", glyph: "B", run: (e) => void e.chain().focus().toggleBold().run(), active: (e) => e.isActive("bold") },
  { id: "italic", label: "Italic", glyph: "I", run: (e) => void e.chain().focus().toggleItalic().run(), active: (e) => e.isActive("italic") },
  { id: "strike", label: "Strikethrough", glyph: "S", run: (e) => void e.chain().focus().toggleStrike().run(), active: (e) => e.isActive("strike") },
  { id: "code", label: "Code", glyph: "<>", run: (e) => void e.chain().focus().toggleCode().run(), active: (e) => e.isActive("code") },
  { id: "h1", label: "Heading 1", glyph: "H1", run: (e) => void e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive("heading", { level: 1 }) },
  { id: "h2", label: "Heading 2", glyph: "H2", run: (e) => void e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive("heading", { level: 2 }) },
  { id: "bullets", label: "Bulleted list", glyph: "•", run: (e) => void e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive("bulletList") },
  { id: "numbers", label: "Numbered list", glyph: "1.", run: (e) => void e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive("orderedList") },
  { id: "quote", label: "Quote", glyph: "“", run: (e) => void e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive("blockquote") },
  { id: "codeblock", label: "Code block", glyph: "{}", run: (e) => void e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive("codeBlock") },
];

type Hover = { hovered?: boolean };

const T = (inner: string): string => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const H_BASE = '<path d="M2.5 3.5v9M2.5 8h6M8.5 3.5v9"/>';
/** Toolbar icons, one drawing per command, in the stroke weight of the Menu icons. */
export const TOOL_ICONS: Readonly<Record<string, string>> = {
  bold: T('<path d="M5 3.500h3.200a2.200 2.200 0 010 4.500H5zM5 8h3.800a2.250 2.250 0 010 4.500H5z"/>'),
  italic: T('<path d="M10.500 3.500H7M9 12.500H5.500M9.200 3.500l-2.400 9"/>'),
  strike: T('<path d="M3 8h10M10.500 5.500c-.4-1-1.400-1.700-2.600-1.700-1.400 0-2.500.8-2.500 1.900 0 2.200 5.200 1.300 5.200 3.600 0 1.100-1.200 2-2.800 2-1.300 0-2.400-.6-2.900-1.700"/>'),
  code: T('<path d="M5.500 4.500L2.500 8l3 3.500M10.500 4.500l3 3.500-3 3.500"/>'),
  h1: T(`${H_BASE}<path d="M11.500 9.500l1.200-.8v4"/>`),
  h2: T(`${H_BASE}<path d="M11.200 9.800c.2-.8 2.200-.9 2.200.3 0 1-2.200 1.400-2.200 2.600h2.300"/>`),
  bullets: T('<circle cx="3.500" cy="4.500" r=".8" fill="currentColor"/><circle cx="3.500" cy="8" r=".8" fill="currentColor"/><circle cx="3.500" cy="11.500" r=".8" fill="currentColor"/><path d="M6.500 4.500h7M6.500 8h7M6.500 11.500h7"/>'),
  numbers: T('<path d="M6.500 4.500h7M6.500 8h7M6.500 11.500h7M2.500 3.800l1-.5v3.200M2.400 9c0-.8 1.600-.8 1.600 0 0 .8-1.600 1.300-1.600 2.100h1.700"/>'),
  quote: T('<path d="M3.500 5.500h3V9h-3zM9.500 5.500h3V9h-3zM6.500 9c0 1.500-.7 2.500-2 3M12.500 9c0 1.500-.7 2.500-2 3"/>'),
  codeblock: T('<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M6.500 6.500L5 8l1.500 1.500M9.500 6.500L11 8 9.500 9.500"/>'),
  find: T('<circle cx="7" cy="7" r="4"/><path d="M10 10l3.500 3.500"/>'),
  info: T('<circle cx="8" cy="8" r="5.500"/><path d="M8 7.500v3.500M8 5.200h.01"/>'),
  history: T('<path d="M2.500 8a5.500 5.500 0 105.500-5.500c-1.700 0-3.200.8-4.200 2M2.500 3v2.500H5M8 5v3.200l2 1.300"/>'),
  more: T('<circle cx="3.500" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.500" cy="8" r=".9" fill="currentColor"/>'),
  check: T('<path d="M3.500 8.500l3 3 6-7"/>'),
};

function ToolIcon({ id, color, glyph }: { id: string; color: string; glyph: string }): ReactElement {
  if (Platform.OS !== "web") return <Text style={{ color, fontSize: 13 }}>{glyph}</Text>;
  return <MenuIcon icon={TOOL_ICONS[id] ?? ""} size={16} color={color} />;
}

function Toolbar({ editor, enabled, activeIds, onRun }: { editor: EditorLike | null; enabled: boolean; activeIds: readonly string[]; onRun: () => void }): ReactElement {
  const buttons: ReactElement[] = [];
  for (const c of TOOLBAR) {
    const on = activeIds.includes(c.id);
    buttons.push(
      <Pressable
        key={c.id}
        accessibilityRole="button"
        accessibilityLabel={c.label}
        accessibilityState={{ selected: on, disabled: !enabled }}
        disabled={!enabled}
        onPress={() => { if (editor !== null) { c.run(editor); onRun(); } }}
        testID={`richeditor-tool-${c.id}`}
        style={({ hovered }: Hover) => [styles.tool, hovered === true && enabled && styles.toolHover, on && styles.toolOn]}
      >
        <ToolIcon id={c.id} glyph={c.glyph} color={on ? "var(--accent)" : enabled ? "var(--ink-2)" : "var(--ink-4)"} />
      </Pressable>,
    );
  }
  return <View accessibilityRole="toolbar" accessibilityLabel="Formatting" testID="richeditor-toolbar" style={styles.toolbar}>{buttons}</View>;
}

/* ---------- the static view ---------- */

function runNodes(runs: readonly Run[], keyBase: string, base: object): ReactElement[] {
  const nodes: ReactElement[] = [];
  for (const [i, r] of runs.entries()) {
    const style: Record<string, unknown> = {};
    if (r.marks.includes("bold")) style["fontWeight"] = "700";
    if (r.marks.includes("italic")) style["fontStyle"] = "italic";
    if (r.marks.includes("strike")) style["textDecorationLine"] = "line-through";
    if (r.marks.includes("code")) { style["fontFamily"] = MONO; style["backgroundColor"] = "var(--hover)"; }
    if (r.marks.includes("link")) { style["color"] = "var(--accent)"; style["textDecorationLine"] = "underline"; }
    nodes.push(<Text key={`${keyBase}-${i}`} style={[base, style]}>{r.text}</Text>);
  }
  return nodes;
}

/** A thin caret in the person's colour with a small name flag, both inline so they move with the text. */
function caretNodes(cursor: RemoteCursor, keyBase: string): ReactElement[] {
  return [
    <Text key={`${keyBase}-c`} testID={`richeditor-cursor-${cursor.clientId}`} style={{ borderLeftWidth: 2, borderLeftColor: cursor.color, marginLeft: -1, marginRight: -1, fontSize: 1 }}>{"\u200b"}</Text>,
    <Text key={`${keyBase}-n`} accessibilityLabel={`${cursor.name}'s cursor`} style={[styles.flag, { backgroundColor: cursor.color }]}>{cursor.name}</Text>,
  ];
}

function inlineWithCursors(runs: readonly Run[], cursors: readonly { cursor: RemoteCursor; col: number }[], keyBase: string, base: object): ReactElement[] {
  if (cursors.length === 0) return runNodes(runs, keyBase, base);
  const sorted = [...cursors].sort((a, b) => a.col - b.col);
  const out: ReactElement[] = [];
  let rest: Run[] = [...runs];
  let consumed = 0;
  for (const [i, c] of sorted.entries()) {
    const cut = splitRunsAt(rest, c.col - consumed);
    out.push(...runNodes(cut.before, `${keyBase}-${i}a`, base));
    out.push(...caretNodes(c.cursor, `${keyBase}-${i}`));
    rest = cut.after;
    consumed = c.col;
  }
  out.push(...runNodes(rest, `${keyBase}-z`, base));
  return out;
}

function NoteHeaderBar({ h, mode }: { h: NoteHeader; mode: RichEditorMode }): ReactElement {
  const view = mode === "read" ? "view" : "edit";
  const seg: ReactElement[] = [];
  for (const v of ["view", "edit"] as const) {
    seg.push(
      <Pressable key={v} accessibilityRole="radio" accessibilityLabel={v === "view" ? "View" : "Edit"} accessibilityState={{ checked: view === v }} onPress={() => h.onView?.(v)} testID={`richeditor-${v}`} style={({ hovered }: Hover) => [styles.segBtn, view === v && styles.segOn, hovered === true && view !== v && styles.toolHover]}>
        <Text style={[styles.segText, view === v && styles.segTextOn]}>{v === "view" ? "View" : "Edit"}</Text>
      </Pressable>,
    );
  }
  const icons: ReactElement[] = [];
  for (const [id, label] of [["find", "Find in file"], ["info", "Details"], ["history", "Version history"], ["more", "More"]] as const) {
    icons.push(
      <Pressable key={id} accessibilityRole="button" accessibilityLabel={label} testID={`richeditor-head-${id}`} style={({ hovered }: Hover) => [styles.headIcon, hovered === true && styles.toolHover]}>
        <ToolIcon id={id} glyph={"\u00b7"} color="var(--ink-2)" />
      </Pressable>,
    );
  }
  return (
    <View style={styles.head} testID="richeditor-header">
      <View style={styles.mark}><Text style={styles.markText}>{h.mark ?? "MD"}</Text></View>
      <View style={styles.headText}>
        <Text style={styles.name} numberOfLines={1}>{h.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>{h.meta}</Text>
      </View>
      <View style={styles.grow} />
      {h.version !== undefined && h.version > 1 ? (
        <View style={styles.saved} testID="richeditor-version"><ToolIcon id="check" glyph={"\u2713"} color="var(--ok)" /><Text style={styles.savedText}>{`v${h.version}`}</Text></View>
      ) : null}
      <View accessibilityRole="radiogroup" accessibilityLabel="View or edit" style={styles.seg}>{seg}</View>
      {icons}
    </View>
  );
}

function StaticDoc({ blocks, cursors, placeholder, compact }: { blocks: readonly Block[]; cursors: readonly RemoteCursor[]; placeholder: string; compact: boolean }): ReactElement {
  if (blocks.length === 0) return <Text style={styles.placeholder} testID="richeditor-empty">{placeholder}</Text>;
  const at: Map<number, { cursor: RemoteCursor; col: number }[]> = new Map();
  for (const c of cursors) {
    if (c.head === null) continue;
    const where = locateOffset(blocks, c.head);
    at.set(where.block, [...(at.get(where.block) ?? []), { cursor: c, col: where.col }]);
  }
  const nodes: ReactElement[] = [];
  for (const [i, b] of blocks.entries()) {
    const here = at.get(i) ?? [];
    const key = `b${i}`;
    switch (b.type) {
      case "heading":
        nodes.push(<Text key={key} accessibilityRole="header" style={[styles.heading, HEADINGS[b.level]]}>{inlineWithCursors(b.runs, here, key, {})}</Text>);
        break;
      case "paragraph":
        nodes.push(<Text key={key} style={[styles.p, compact && styles.pCompact]}>{inlineWithCursors(b.runs, here, key, {})}</Text>);
        break;
      case "blockquote":
        nodes.push(<View key={key} style={styles.quote}><Text style={styles.p}>{inlineWithCursors(b.runs, here, key, {})}</Text></View>);
        break;
      case "codeBlock":
        nodes.push(<View key={key} style={styles.code}><Text style={styles.codeText} selectable>{b.text}</Text></View>);
        break;
      case "horizontalRule":
        nodes.push(<View key={key} style={styles.rule} />);
        break;
      case "bulletList": case "orderedList": {
        const rows: ReactElement[] = [];
        for (const [n, item] of b.items.entries()) {
          rows.push(
            <View key={`${key}-${n}`} style={styles.li}>
              <Text style={styles.bullet}>{b.type === "orderedList" ? `${n + 1}.` : "•"}</Text>
              <Text style={[styles.p, styles.grow]}>{runNodes(item, `${key}-${n}`, {})}</Text>
            </View>,
          );
        }
        nodes.push(<View key={key} style={styles.list}>{rows}</View>);
        break;
      }
      default: break;
    }
  }
  return <View>{nodes}</View>;
}

/* ---------- the component ---------- */

/** The note page header the Files viewer shows: file mark, name, path line, version, View and Edit. */
export interface NoteHeader {
  name: string;
  /** The line under the name: path, who edited, when. */
  meta: string;
  /** Short mark in the file tile, for example MD. */
  mark?: string;
  /** Version number; the saved check shows from the second. */
  version?: number;
  onView?: (view: "view" | "edit") => void;
}

export interface RichEditorViewProps extends RichEditorProps {
  header?: NoteHeader;
  /** The document the sync module owns for `docId`. Without it the view makes one and seeds it from `markdown`. */
  doc?: Y.Doc;
  awareness?: Awareness;
  user?: CursorUser;
  /** static draws read-only blocks; tiptap mounts the editor on web; webview mounts it in a WebView. Default: by platform and mode. */
  engine?: "static" | "tiptap" | "webview";
  /** The editor script for the phone's WebView, built from page.ts with TipTap. Without it the phone shows the static view. */
  bundle?: string;
  /** Called a moment after edits with the markdown snapshot. */
  onMarkdown?: (markdown: string) => void;
  testID?: string;
}

export function defaultEngine(mode: RichEditorMode, platformOS: string, hasBundle: boolean): "static" | "tiptap" | "webview" {
  if (mode === "read") return "static";
  if (platformOS === "web") return "tiptap";
  return hasBundle ? "webview" : "static";
}

const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});

export function RichEditor(props: RichEditorViewProps): ReactElement {
  const doc = useRichDoc(props.markdown, props.doc);
  // The view makes its own Awareness only after mount (it keeps a timer), and only when the host gave none.
  const [ownAware, setOwnAware] = useState<Awareness | null>(null);
  useEffect(() => {
    if (props.awareness !== undefined) return undefined;
    const a = new Awareness(doc);
    setOwnAware(a);
    return () => { a.destroy(); setOwnAware(null); };
  }, [doc, props.awareness]);
  const aw: Awareness | null = props.awareness ?? ownAware;
  const flags = modeFlags(props.mode);
  const engine = props.engine ?? defaultEngine(props.mode, Platform.OS, props.bundle !== undefined);
  const compact = props.density === "compact";
  const [, bump] = useState(0);
  const [editor, setEditor] = useState<EditorLike | null>(null);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const host = useRef<unknown>(null);
  const bridge = useRef<BridgeEnd | null>(null);
  const web = useRef<{ postMessage(raw: string): void } | null>(null);

  // Re-draw the static view and hand back the markdown snapshot after edits.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onUpdate = (): void => {
      bump((n) => n + 1);
      if (props.onMarkdown === undefined) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => props.onMarkdown?.(exportMarkdown(doc)), 300);
    };
    const onAware = (): void => bump((n) => n + 1);
    doc.on("update", onUpdate);
    aw?.on("update", onAware);
    return () => { doc.off("update", onUpdate); aw?.off("update", onAware); if (timer !== undefined) clearTimeout(timer); };
  }, [doc, aw, props.onMarkdown]);

  useEffect(() => { if (props.user !== undefined && aw !== null) aw.setLocalStateField("user", { name: props.user.name, color: props.user.color }); }, [aw, props.user]);

  // Web: TipTap on the document's fragment, with the Collaboration extensions.
  useEffect(() => {
    if (engine !== "tiptap" || aw === null) return undefined;
    let made: EditorLike | null = null;
    let gone = false;
    void (async () => {
      const [core, kit, collab, cursor] = await Promise.all([
        import("@tiptap/core"),
        import("@tiptap/starter-kit"),
        import("@tiptap/extension-collaboration"),
        import("@tiptap/extension-collaboration-cursor"),
      ]);
      if (gone || host.current === null) return;
      const user = props.user ?? { name: "You", color: "#4c6ef5" };
      const e = new core.Editor({
        element: host.current as never,
        extensions: [kit.default.configure({ history: false }), collab.default.configure({ document: doc }), cursor.default.configure({ provider: { awareness: aw }, user })],
        editable: flags.editable,
        editorProps: { attributes: { class: "vyre-prose", "aria-label": props.placeholder, "data-placeholder": props.placeholder } },
      }) as unknown as EditorLike;
      const refresh = (): void => { const ids: string[] = []; for (const c of TOOLBAR) if (c.active(e)) ids.push(c.id); setActiveIds(ids); };
      e.on("transaction", refresh);
      e.on("selectionUpdate", refresh);
      made = e;
      setEditor(e);
    })();
    return () => { gone = true; made?.destroy(); setEditor(null); };
    // eslint-disable-next-line
  }, [engine, doc, aw]);

  useEffect(() => { editor?.setEditable(flags.editable); }, [editor, flags.editable]);

  // Phone: the WebView page keeps its own copy; the bridge keeps the two current.
  useEffect(() => {
    if (engine !== "webview" || aw === null) return undefined;
    const end = connectBridge(doc, aw, (raw) => web.current?.postMessage(raw), true);
    bridge.current = end;
    return () => { end.destroy(); bridge.current = null; };
  }, [engine, doc, aw]);

  const blocks = fragmentToBlocks(doc);
  const cursors = aw === null ? [] : remoteCursors(aw);
  const peers = cursors.length;
  const dots: ReactElement[] = [];
  for (const c of cursors) dots.push(<View key={c.clientId} accessibilityLabel={c.name} style={[styles.peerDot, { backgroundColor: c.color }]} />);
  let body: ReactElement;
  if (engine === "tiptap") {
    body = Platform.OS === "web"
      ? createElement("div", { ref: (el: unknown) => { host.current = el; }, "data-testid": "richeditor-host", style: { minHeight: 160, outline: "none" } })
      : <View />;
  } else if (engine === "webview") {
    // react-native-webview is only loaded on the phone.
    const mod = require("react-native-webview") as { WebView: (p: Record<string, unknown>) => ReactElement };
    body = createElement(mod.WebView, {
      ref: (r: unknown) => { web.current = r as { postMessage(raw: string): void } | null; },
      originWhitelist: ["*"],
      source: { html: bridgeHtml(props.bundle ?? "", { win: "#ffffff", ink: "#1a1a1a", accent: "#4c6ef5" }) },
      onMessage: (e: { nativeEvent: { data: string } }) => bridge.current?.receive(e.nativeEvent.data),
      testID: "richeditor-webview",
    });
  } else {
    body = <StaticDoc blocks={blocks} cursors={cursors} placeholder={props.placeholder} compact={compact} />;
  }

  return (
    <View
      accessibilityLabel={`Document ${props.docId}`}
      testID={props.testID ?? `richeditor-${props.docId}`}
      style={styles.root}
      {...webProps({ role: "group", dataSet: { engine, mode: props.mode } })}
    >
      {props.header !== undefined ? <NoteHeaderBar h={props.header} mode={props.mode} /> : null}
      <View style={styles.bar}>
        {flags.editable ? <Toolbar editor={editor} enabled={editor !== null} activeIds={activeIds} onRun={() => bump((n) => n + 1)} /> : <View style={styles.grow} />}
        <View style={styles.grow} />
        {peers > 0 ? (
          <View style={styles.peers} testID="richeditor-peers">
            {dots}
          </View>
        ) : null}
        <Text style={[styles.mode, flags.suggesting && styles.modeSuggest]} testID="richeditor-mode">{flags.label}</Text>
      </View>
      <View style={[styles.page, compact && styles.pageCompact]}>{body}</View>
    </View>
  );
}

/* ---------- styles ---------- */

const MONO = "var(--mono, ui-monospace, Menlo, monospace)";

const HEADINGS: Record<number, object> = {
  1: { fontSize: 26, lineHeight: 32 },
  2: { fontSize: 21, lineHeight: 28 },
  3: { fontSize: 17, lineHeight: 24 },
  4: { fontSize: 15, lineHeight: 22 },
  5: { fontSize: 14, lineHeight: 20 },
  6: { fontSize: 13, lineHeight: 20 },
};

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  grow: { flex: 1 },
  toolbar: { flexDirection: "row", alignItems: "center", gap: 2, flexWrap: "wrap" },
  tool: { minWidth: 28, height: 28, paddingHorizontal: 6, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  toolHover: { backgroundColor: "var(--hover)" as string },
  toolOn: { backgroundColor: "var(--accent-wash)" as string },
  head: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 56, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  mark: { height: 28, minWidth: 28, paddingHorizontal: 6, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string },
  markText: { color: "var(--ink-3)" as string, fontSize: 10.5, fontWeight: "700" },
  headText: { flexShrink: 1, minWidth: 0, gap: 1 },
  name: { color: "var(--ink)" as string, fontSize: 14, fontWeight: "600" },
  meta: { color: "var(--ink-3)" as string, fontSize: 12 },
  saved: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6 },
  savedText: { color: "var(--ink-2)" as string, fontSize: 12 },
  seg: { flexDirection: "row", padding: 2, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  segBtn: { height: 24, paddingHorizontal: 10, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: "var(--raised)" as string },
  segText: { color: "var(--ink-3)" as string, fontSize: 12.5, fontWeight: "500" },
  segTextOn: { color: "var(--ink)" as string },
  headIcon: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  toolText: { color: "var(--ink-2)" as string, fontSize: 13 },
  toolTextOn: { color: "var(--accent)" as string },
  toolTextOff: { color: "var(--ink-4)" as string },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  peers: { flexDirection: "row", alignItems: "center", gap: 4 },
  peerDot: { width: 10, height: 10, borderRadius: 5 },
  mode: { color: "var(--ink-3)" as string, fontSize: 12 },
  modeSuggest: { color: "var(--accent)" as string },
  page: { flex: 1, paddingVertical: 20, paddingHorizontal: 32, maxWidth: 760, width: "100%", alignSelf: "center" },
  pageCompact: { paddingVertical: 12, paddingHorizontal: 16 },
  placeholder: { color: "var(--ink-4)" as string, fontSize: 15 },
  heading: { color: "var(--ink)" as string, fontWeight: "700", marginTop: 14, marginBottom: 6 },
  p: { color: "var(--ink)" as string, fontSize: 15, lineHeight: 24, marginBottom: 8 },
  pCompact: { fontSize: 16 },
  quote: { borderLeftWidth: 3, borderLeftColor: "var(--line-2)" as string, paddingLeft: 12, marginVertical: 6 },
  code: { backgroundColor: "var(--sunk)" as string, borderRadius: 8, padding: 12, marginVertical: 8 },
  codeText: { color: "var(--ink)" as string, fontFamily: MONO, fontSize: 13, lineHeight: 20 },
  rule: { height: 1, backgroundColor: "var(--line)" as string, marginVertical: 14 },
  list: { marginBottom: 8 },
  li: { flexDirection: "row", gap: 8 },
  bullet: { color: "var(--ink-3)" as string, fontSize: 15, lineHeight: 24, width: 20, textAlign: "right" },
  flag: { color: "#fff", fontSize: 9.5, lineHeight: 12, fontWeight: "600", paddingHorizontal: 4, borderRadius: 3, overflow: "hidden" },
});

