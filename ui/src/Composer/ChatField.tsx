// The composer's text field on the shared editor (ui/RichEditor's TipTap): the same words as the plain field, each @mention drawn as one chip that Backspace deletes whole, Enter sent through the composer's own
// key logic, Shift+Enter a new line, paste as plain text, IME and undo from the editor. The chips are part of the field's own text, so there is no second layer to drift from it (the overlay of the old field).
// It speaks the old field's language to the composer (a change with the text and the caret, a selection, a key), so the composer's state machine does not change. Off by default (Composer's chatField).
import { createElement, useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { chatDoc, chatText, offsetToPos, pasteNodes, posToOffset, sameDoc } from "./chatdoc.ts";
import type { ChatNode, ChatRange } from "./chatdoc.ts";

export interface ChatKey { key: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; isComposing?: boolean; preventDefault?: () => void }

export interface ChatFieldProps {
  value: string;
  cursor: number;
  ranges: readonly ChatRange[];
  placeholder: string;
  label: string;
  testID: string;
  fontSize: number;
  lineHeight: number;
  maxHeight: number;
  onChange: (e: { nativeEvent: { text: string; target: { selectionStart: number } } }) => void;
  onSelectionChange: (e: { nativeEvent: { selection: { start: number; end: number } } }) => void;
  onKeyPress: (e: { nativeEvent: ChatKey; preventDefault?: () => void }) => void;
  onFocus: () => void;
  onBlur: () => void;
  /** Gives the composer a handle with focus(), as it had on the plain field. */
  controlRef: (c: { focus: () => void } | null) => void;
}

const CSS = [
  ".vyre-chat{outline:none;white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;overflow-y:auto;color:var(--ink);caret-color:var(--accent);min-height:22px}",
  ".vyre-chat p{margin:0}.vyre-chat[data-empty=true] p:first-child::before{content:attr(data-placeholder);color:var(--ink-3);float:left;height:0;pointer-events:none}",
  ".vyre-chat .vyre-chip{background:var(--accent-wash);border-radius:5px;box-shadow:0 0 0 2px var(--accent-wash);cursor:default;user-select:all}",
  ".vyre-chat .vyre-chip.ProseMirror-selectednode{outline:2px solid var(--accent);outline-offset:1px}",
].join("\n");
let cssDone = false;
function ensureCss(): void {
  if (cssDone) return;
  const d = (globalThis as { document?: { head?: { appendChild(n: unknown): void }; createElement(t: string): { id: string; textContent: string } } }).document;
  if (!d?.head) return;
  const el = d.createElement("style");
  el.id = "vyre-ui-chat";
  el.textContent = CSS;
  d.head.appendChild(el);
  cssDone = true;
}

interface PMLike { toJSON(): ChatNode; textBetween(a: number, b: number): string; content: { size: number } }
interface EditorLike {
  getJSON(): ChatNode;
  commands: { setContent(c: unknown, emit?: boolean): boolean; setTextSelection(p: number): boolean; focus(p?: unknown): boolean; insertContent(c: unknown): boolean; setHardBreak(): boolean };
  state: { doc: PMLike; selection: { from: number; to: number } };
  view: { composing: boolean; dom: { setAttribute(k: string, v: string): void } };
  destroy(): void;
}

export function ChatField(p: ChatFieldProps): ReactElement {
  ensureCss();
  const host = useRef<unknown>(null);
  const ed = useRef<EditorLike | null>(null);
  const cb = useRef(p);
  cb.current = p;
  const last = useRef(p.value);

  useEffect(() => {
    let gone = false;
    let made: EditorLike | null = null;
    void (async () => {
      const core = await import("@tiptap/core");
      const { chatExtensions } = await import("./chatnode.ts");
      if (gone || host.current === null || (host.current as { nodeType?: number }).nodeType !== 1) return;
      const at = (): number => { const e = ed.current; return e ? posToOffset(e.state.doc.toJSON(), e.state.selection.from) : 0; };
      const e = new core.Editor({
        element: host.current as never,
        extensions: chatExtensions(),
        content: chatDoc(cb.current.value, cb.current.ranges) as never,
        editorProps: {
          attributes: { class: "vyre-chat", role: "textbox", "aria-multiline": "true", "aria-label": cb.current.label, "data-placeholder": cb.current.placeholder, "data-testid": cb.current.testID, spellcheck: "true" },
          handleKeyDown: (_v: unknown, event: unknown) => {
            const k = event as { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; isComposing: boolean; defaultPrevented: boolean; preventDefault(): void };
            if (k.isComposing) return false;
            cb.current.onKeyPress({ nativeEvent: { key: k.key, shiftKey: k.shiftKey, metaKey: k.metaKey, ctrlKey: k.ctrlKey, altKey: k.altKey, isComposing: false, preventDefault: () => k.preventDefault() }, preventDefault: () => k.preventDefault() });
            if (k.defaultPrevented) return true;
            if (k.key === "Enter") { ed.current?.commands.setHardBreak(); k.preventDefault(); return true; }
            return false;
          },
          handlePaste: (_v: unknown, event: unknown) => {
            const text = (event as { clipboardData?: { getData(t: string): string } }).clipboardData?.getData("text/plain") ?? "";
            if (text === "" || !ed.current) return false;
            ed.current.commands.insertContent(pasteNodes(text));
            return true;
          },
        },
        onTransaction: ({ transaction }: { transaction: { docChanged: boolean; selectionSet: boolean } }) => {
          const cur = ed.current;
          if (!cur) return;
          cur.view.dom.setAttribute("data-empty", cur.state.doc.content.size <= 2 ? "true" : "false");
          if (transaction.docChanged) {
            const text = chatText(cur.state.doc.toJSON());
            last.current = text;
            cb.current.onChange({ nativeEvent: { text, target: { selectionStart: at() } } });
          } else if (transaction.selectionSet) {
            const c = at();
            cb.current.onSelectionChange({ nativeEvent: { selection: { start: c, end: c } } });
          }
        },
        onFocus: () => cb.current.onFocus(),
        onBlur: () => cb.current.onBlur(),
      }) as unknown as EditorLike;
      ed.current = e;
      made = e;
      e.view.dom.setAttribute("data-empty", cb.current.value === "" ? "true" : "false");
      cb.current.controlRef({ focus: () => { e.commands.focus(); } });
    })();
    return () => { gone = true; cb.current.controlRef(null); made?.destroy(); ed.current = null; };
  }, []);

  // what the composer holds now (a pick, a clear, a send) and where its mentions are: the field shows it, unless it is what the field itself just said
  const key = JSON.stringify([p.value, p.ranges.map((r) => [r.start, r.end])]);
  useEffect(() => {
    const e = ed.current;
    if (!e || e.view.composing) return;
    const want = chatDoc(p.value, p.ranges);
    const have = e.state.doc.toJSON();
    if (sameDoc(have, want)) return;
    const caret = Math.min(p.cursor, p.value.length);
    e.commands.setContent(want as never, false);
    e.commands.setTextSelection(offsetToPos(want, caret));
    last.current = p.value;
  }, [key]);

  return createElement("div", { ref: (el: unknown) => { host.current = el; }, "data-testid": `${p.testID}-host`, style: { fontSize: p.fontSize, lineHeight: `${p.lineHeight}px`, maxHeight: p.maxHeight, width: "100%" } });
}
