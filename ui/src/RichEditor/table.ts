// A Markdown table the person edits cell by cell: Tab moves across, Enter goes down, a cell's menu adds and removes rows and columns, a block of cells pastes in.
// The nodes are plain (a table of rows of cells holding inline text). Each row and cell keeps the text it was read from, so a file that is not edited in a cell is written back byte for byte (see mdtree.ts).
import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import {
  TableMap,
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  goToNextCell,
  isInTable,
  selectionCell,
  tableEditing,
} from "@tiptap/pm/tables";

type Cmd = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

const ROLES: Record<string, string> = { mdTable: "table", mdRow: "row", mdCell: "cell", mdHeader: "header_cell" };

/** Tells the table plugin which node plays which part. */
const TableRoles = Extension.create({
  name: "mdTableRoles",
  extendNodeSchema(extension: { name: string }) {
    const role = ROLES[extension.name];
    return role === undefined ? {} : { tableRole: role };
  },
});

const quiet = (v: unknown) => ({ default: v, rendered: false });

export const MdTable = Node.create({
  name: "mdTable",
  group: "block",
  content: "mdRow+",
  isolating: true,
  addAttributes() {
    return { sep: quiet(null), cols: quiet(0), align: quiet([]) };
  },
  parseHTML() {
    return [{ tag: "table" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["table", mergeAttributes(HTMLAttributes, { class: "vyre-tbl", "data-testid": "md-table" }), ["tbody", 0]];
  },
});

export const MdRow = Node.create({
  name: "mdRow",
  content: "(mdCell | mdHeader)*",
  addAttributes() {
    return { src: quiet(null), cols: quiet(0) };
  },
  parseHTML() {
    return [{ tag: "tr" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["tr", mergeAttributes(HTMLAttributes), 0];
  },
});

const cellAttrs = () => ({ src: quiet(null), colspan: quiet(1), rowspan: quiet(1), colwidth: quiet(null) });

export const MdCell = Node.create({
  name: "mdCell",
  content: "inline*",
  isolating: true,
  addAttributes: cellAttrs,
  parseHTML() {
    return [{ tag: "td" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["td", mergeAttributes(HTMLAttributes), 0];
  },
});

export const MdHeader = Node.create({
  name: "mdHeader",
  content: "inline*",
  isolating: true,
  addAttributes: cellAttrs,
  parseHTML() {
    return [{ tag: "th" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["th", mergeAttributes(HTMLAttributes), 0];
  },
});

/**
 * Brings the editor's cursor to where the browser's cursor is. The browser tells the editor about a moved cursor in a later turn; a key (or a paste) that reaches the page
 * before that turn, as it does on a slow computer, would otherwise act on the cell the cursor was in before the click. Found 16 Nov 2026: Tab after a click went nowhere.
 */
export function syncCursor(view: EditorView): void {
  const sel = view.dom.ownerDocument.getSelection();
  if (sel === null || sel.anchorNode === null || sel.focusNode === null) return;
  if (!view.dom.contains(sel.anchorNode) || !view.dom.contains(sel.focusNode)) return;
  try {
    const anchor = view.posAtDOM(sel.anchorNode, sel.anchorOffset);
    const head = view.posAtDOM(sel.focusNode, sel.focusOffset);
    const now = view.state.selection;
    if (now.anchor === anchor && now.head === head) return;
    const { doc } = view.state;
    view.dispatch(view.state.tr.setSelection(TextSelection.between(doc.resolve(anchor), doc.resolve(head))));
  } catch {
    // a cursor the editor cannot place (between pieces it draws itself): leave the editor's own
  }
}

/** Enter goes to the cell below; in the last row it adds a row first. */
const goDown: Cmd = (state, dispatch) => {
  if (!isInTable(state) || dispatch === undefined) return isInTable(state);
  const $cell = selectionCell(state);
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const rect = map.findCell($cell.pos - $cell.start(-1));
  let s = state;
  if (rect.bottom >= map.height) {
    let next: EditorState | null = null;
    addRowAfter(state, (tr) => {
      next = state.apply(tr);
      dispatch(tr);
    });
    if (next === null) return true;
    s = next;
  }
  const $c = selectionCell(s);
  const t = $c.node(-1);
  const m = TableMap.get(t);
  const r = m.findCell($c.pos - $c.start(-1));
  const target = m.map[r.bottom * m.width + r.left];
  if (target === undefined) return true;
  const pos = $c.start(-1) + target;
  dispatch(s.tr.setSelection(TextSelection.create(s.doc, pos + 1)).scrollIntoView());
  return true;
};

/** Tab goes to the next cell; in the last cell it adds a row. */
const goAcross: Cmd = (state, dispatch) => {
  if (!isInTable(state)) return false;
  if (goToNextCell(1)(state, dispatch)) return true;
  if (dispatch === undefined) return true;
  let next: EditorState | null = null;
  addRowAfter(state, (tr) => {
    next = state.apply(tr);
    dispatch(tr);
  });
  if (next !== null) goToNextCell(1)(next, dispatch);
  return true;
};

export interface CellAction {
  id: string;
  label: string;
  run: Cmd;
}
/** What the cell's menu offers, in order. */
export const CELL_ACTIONS: readonly CellAction[] = [
  { id: "row-above", label: "Add row above", run: addRowBefore },
  { id: "row-below", label: "Add row below", run: addRowAfter },
  { id: "row-delete", label: "Delete row", run: deleteRow },
  { id: "col-left", label: "Add column left", run: addColumnBefore },
  { id: "col-right", label: "Add column right", run: addColumnAfter },
  { id: "col-delete", label: "Delete column", run: deleteColumn },
  { id: "table-delete", label: "Delete table", run: deleteTable },
];

const menuKey = new PluginKey("mdTableMenu");

/** The "..." in the cell the cursor is in, and the menu it opens. Plain DOM: it is drawn inside the editor's own page. */
function menuPlugin(): Plugin {
  let open: HTMLElement | null = null;
  const close = (): void => {
    open?.remove();
    open = null;
  };
  const show = (view: EditorView, at: HTMLElement): void => {
    close();
    const doc = at.ownerDocument;
    const box = doc.createElement("div");
    box.setAttribute("data-testid", "md-table-menu");
    box.setAttribute("role", "menu");
    const r = at.getBoundingClientRect();
    box.style.cssText = `position:fixed;z-index:60;left:${Math.max(8, r.right - 180)}px;top:${r.bottom + 4}px;width:180px;background:var(--raised,var(--win));border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18);padding:4px;font:13px var(--ui,inherit);color:var(--ink)`;
    for (const a of CELL_ACTIONS) {
      const item = doc.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.setAttribute("data-testid", `md-table-act-${a.id}`);
      item.textContent = a.label;
      item.style.cssText = `display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:7px 10px;border-radius:6px;font:inherit;cursor:pointer${a.id === "table-delete" ? ";color:var(--danger,#c0392b)" : ""}`;
      item.addEventListener("mouseenter", () => (item.style.background = "var(--sunk)"));
      item.addEventListener("mouseleave", () => (item.style.background = "transparent"));
      item.addEventListener("mousedown", (e) => e.preventDefault());
      item.addEventListener("click", () => {
        a.run(view.state, view.dispatch);
        close();
        view.focus();
      });
      box.appendChild(item);
    }
    doc.body.appendChild(box);
    open = box;
    const away = (e: Event): void => {
      if (open !== null && !open.contains(e.target as globalThis.Node)) {
        close();
        doc.removeEventListener("mousedown", away, true);
      }
    };
    doc.addEventListener("mousedown", away, true);
  };
  return new Plugin({
    key: menuKey,
    props: {
      decorations(state) {
        if (!isInTable(state)) return null;
        let cellPos: number;
        try {
          cellPos = selectionCell(state).pos;
        } catch {
          return null;
        }
        const deco = Decoration.widget(
          cellPos + 1,
          (view) => {
            const b = view.dom.ownerDocument.createElement("span");
            b.className = "vyre-tbl-menu";
            b.contentEditable = "false";
            b.setAttribute("data-testid", "md-table-menu-btn");
            b.setAttribute("role", "button");
            b.setAttribute("aria-label", "Table cell menu");
            b.textContent = "⋯";
            b.addEventListener("mousedown", (e) => {
              e.preventDefault();
              e.stopPropagation();
              show(view, b);
            });
            return b;
          },
          { side: -1, key: `tblmenu${cellPos}`, ignoreSelection: true },
        );
        return DecorationSet.create(state.doc, [deco]);
      },
    },
    view: () => ({ destroy: close }),
  });
}

/** A block of cells copied from a sheet (tab and line separated text) lands in the table from the cell the cursor is in, adding rows and columns as it needs them. */
function pastePlugin(): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        syncCursor(view);
        const cd = (event as ClipboardEvent).clipboardData;
        const text = cd?.getData("text/plain") ?? "";
        const html = cd?.getData("text/html") ?? "";
        if (!isInTable(view.state) || /<table/i.test(html) || !/[\t\n]/.test(text.replace(/\n$/, ""))) return false;
        const grid = text
          .replace(/\r\n?/g, "\n")
          .replace(/\n$/, "")
          .split("\n")
          .map((l) => l.split("\t"));
        const $c = selectionCell(view.state);
        const first = TableMap.get($c.node(-1)).findCell($c.pos - $c.start(-1));
        const needRows = first.top + grid.length;
        const needCols = first.left + Math.max(...grid.map((g) => g.length));
        for (;;) {
          const st = view.state;
          const $x = selectionCell(st);
          const m = TableMap.get($x.node(-1));
          if (m.height >= needRows) break;
          const last = m.map[(m.height - 1) * m.width] ?? 0;
          view.dispatch(st.tr.setSelection(TextSelection.create(st.doc, $x.start(-1) + last + 1)));
          addRowAfter(view.state, view.dispatch);
        }
        for (;;) {
          const st = view.state;
          const $x = selectionCell(st);
          const m = TableMap.get($x.node(-1));
          if (m.width >= needCols) break;
          const last = m.map[m.width - 1] ?? 0;
          view.dispatch(st.tr.setSelection(TextSelection.create(st.doc, $x.start(-1) + last + 1)));
          addColumnAfter(view.state, view.dispatch);
        }
        const st = view.state;
        const $t = selectionCell(st);
        const tableStart = $t.start(-1);
        const map = TableMap.get($t.node(-1));
        let tr = st.tr;
        // fill from the last cell backwards so earlier positions stay valid
        for (let r = grid.length - 1; r >= 0; r--) {
          const row = grid[r] ?? [];
          for (let c = row.length - 1; c >= 0; c--) {
            const off = map.map[(first.top + r) * map.width + first.left + c];
            if (off === undefined) continue;
            const at = tableStart + off;
            const cell = tr.doc.nodeAt(tr.mapping.map(at));
            if (!cell) continue;
            const from = tr.mapping.map(at) + 1;
            const t = (row[c] ?? "").trim();
            tr =
              t === ""
                ? tr.delete(from, from + cell.content.size)
                : tr.replaceWith(from, from + cell.content.size, st.schema.text(t));
          }
        }
        view.dispatch(tr);
        return true;
      },
    },
  });
}

export const MdTableEditing = Extension.create({
  name: "mdTableEditing",
  addProseMirrorPlugins() {
    return [tableEditing(), menuPlugin(), pastePlugin()];
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        syncCursor(this.editor.view);
        return goAcross(this.editor.state, this.editor.view.dispatch);
      },
      "Shift-Tab": () => {
        syncCursor(this.editor.view);
        return isInTable(this.editor.state) && goToNextCell(-1)(this.editor.state, this.editor.view.dispatch);
      },
      Enter: () => {
        syncCursor(this.editor.view);
        return isInTable(this.editor.state) && goDown(this.editor.state, this.editor.view.dispatch);
      },
    };
  },
});

export const tableExtensions = [TableRoles, MdTable, MdRow, MdCell, MdHeader, MdTableEditing];
