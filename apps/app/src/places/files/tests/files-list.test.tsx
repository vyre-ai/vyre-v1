// Files tree and list: the screen. The tree (Recent, Shared with me, Trash, the folders in their sections, Knowledge), the list of a folder, Recent, Shared with me, Trash and Knowledge as
// one list of ui/Row lines, the Finder rules for selection, drag to move, spring-load and Quick Look. The writes change what the next render shows.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { FilesList, ListLoading, lineMenuEntries, sortMenuEntries } from "../list/index.ts";
import { ColumnHeader, RowCells, chunk, gridLayout } from "../FileList.tsx";
import { createSampleFiles, harbor, northwind } from "../list/sample.ts";
import type { SampleFiles, SampleSpace } from "../list/sample.ts";
import {
  FilesDataProvider, FilesStateProvider, FilesTree, INITIAL_STATE, TreeLoading, arrowSelect, clickSelect, contextSelect, createSpring, crumbs, dragPayload, dropMoves, fileLine, kindLabel, parsePayload,
  reduce, selectAll, sizeText, sortLines, sourceOf, updatedText,
} from "../tree/index.ts";
import type { FileRow, FilesState, Line } from "../tree/index.ts";
import { isItem } from "../../../../../../ui/src/Menu/props.ts";
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/props.ts";

const wrap = (s: SampleFiles, initial: Partial<FilesState>, child: ReactElement): string =>
  renderToStaticMarkup(<FilesDataProvider value={s.data}><FilesStateProvider initial={initial}>{child}</FilesStateProvider></FilesDataProvider>).replaceAll("<!-- -->", "");
const list = (initial: Partial<FilesState> = {}, space: SampleSpace = northwind, o: { online?: boolean } = {}): string => wrap(createSampleFiles(space, o), initial, <FilesList />);
const tree = (initial: Partial<FilesState> = {}): string => wrap(createSampleFiles(), initial, <FilesTree />);
const has = (s: string, needle: string): boolean => s.includes(needle);
const at = (s: string, needle: string): number => {
  const i = s.indexOf(needle);
  assert.ok(i >= 0, `expected ${needle}`);
  return i;
};
const lines = (out: string): string[] => [...out.matchAll(/data-testid="row-line:((?:file|folder):[^"]+)"/g)].map((m) => m[1]!).filter((k) => !k.endsWith("-leading") && !k.endsWith("-trailing"));
const items = (entries: readonly MenuEntry[]): MenuItem[] => entries.filter(isItem);
const folder = (id: string): Partial<FilesState> => ({ where: { kind: "folder", id } });
const row = (id: string, folderId = "fld_x"): FileRow => ({ fileId: id, folderId, name: id, kind: "pdf", mime: "", size: 1, version: 1, label: 1, ownerId: "u", createdAt: 0, updatedAt: 0, updatedBy: "u", thumb: false, holds: 0 });

test("screen: the tree lists Recent, Shared with me and Trash, then the folders in their sections, then Knowledge", () => {
  const out = tree();
  const order = ["Recent", "Shared with me", "Trash", "Personal", "Space", "Knowledge", "Memory", "Graph"].map((t) => at(out, `>${t}<`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "the virtual rows, the folder sections, then Knowledge");
  for (const label of ["Daily", "Money", "Maya's reports", "Sales", "Billing", "Intake"]) assert.ok(has(out, `>${label.replace("'", "&#x27;")}<`), label);
  assert.ok(!has(out, ">Proposals<"), "a closed folder keeps its children out of the list");
  assert.ok(has(out, 'data-testid="row-nav:recent"') && has(out, 'data-testid="row-nav:recent-trailing"') && has(out, 'data-testid="row-folder-fld_sales"'), "every row is a ui/Row with slots");
  assert.ok(has(out, 'data-testid="count-recent"') && has(out, ">14<"), "Recent counts the live files");
  assert.ok(has(out, 'data-testid="count-shared"'), "Shared with me counts what was granted");
  assert.ok(!has(out, 'data-testid="count-trash"'), "an empty Trash shows no count");
  assert.ok(has(out, 'data-testid="folder-count-fld_sales"'));
});

test("the tree selects what the list shows", () => {
  assert.ok(has(tree({ where: { kind: "recent" } }), "background-color:var(--sel)"));
  assert.ok(has(tree(folder("fld_sales")), "background-color:var(--sel)"));
  assert.equal(tree().split("background-color:var(--sel)").length - 1, 0, "nothing selected at the root");
  assert.deepEqual(reduce(INITIAL_STATE, { type: "go", where: { kind: "shared" } }).where, { kind: "shared" });
  assert.deepEqual(crumbs([{ id: "a", name: "A", parentId: null }, { id: "b", name: "B", parentId: "a" }], "b").map((c) => c.name), ["A", "B"]);
});

test("screen: a folder lists its folders first, then its files by name, each a ui/Row with an icon and a date", () => {
  const out = list(folder("fld_sales"));
  assert.deepEqual(lines(out), ["folder:fld_proposals", "file:fil_logo", "file:fil_deck", "file:fil_pricing"]);
  assert.ok(has(out, ">Sales<") && has(out, "4 items"));
  const cell = (key: string, id: string): string => new RegExp(`data-testid="row-line:${key}-trailing"[\\s\\S]*?data-testid="cell-${id}"[^>]*>([^<]*)<`).exec(out)?.[1] ?? "";
  assert.equal(cell("file:fil_deck", "kind"), "Presentation");
  assert.equal(cell("file:fil_deck", "size"), "8.9 MB");
  assert.equal(cell("file:fil_pricing", "size"), "62 KB");
  assert.equal(cell("file:fil_logo", "kind"), "Image");
  assert.equal(cell("file:fil_logo", "size"), "210 KB");
  assert.equal(cell("folder:fld_proposals", "size"), "2 items");
  assert.equal(cell("folder:fld_proposals", "kind"), "Folder");
  assert.ok(has(out, "8:00 AM") && has(out, "Yesterday") && has(out, "Oct 15"), "today as a clock time, then Yesterday, then the date");
  assert.ok(has(out, 'data-testid="row-line:file:fil_deck-leading"') && has(out, 'data-testid="row-line:file:fil_deck-trailing"'));
  assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash in any copy");
});

test("screen: the root lists the top folders and a nested folder names its path", () => {
  assert.deepEqual(lines(list()), ["folder:fld_billing", "folder:fld_daily", "folder:fld_intake", "folder:fld_knowledge", "folder:fld_maya", "folder:fld_money", "folder:fld_sales"]);
  const nested = list(folder("fld_proposals"));
  assert.ok(has(nested, ">Proposals<") && has(nested, 'data-testid="files-path"') && has(nested, 'data-testid="files-crumb-fld_sales"') && has(nested, 'data-testid="files-crumb-root"'));
  assert.deepEqual(lines(nested), ["file:fil_harlow", "file:fil_rivera"]);
  assert.ok(has(nested, ">Spreadsheet · Google Drive<") && has(nested, ">77 KB<"), "a mounted file names where it came from");
});

test("Shared with me lists what was granted", () => {
  const out = list({ where: { kind: "shared" } });
  assert.deepEqual(lines(out), ["folder:fld_maya", "file:fil_q3"]);
  assert.ok(has(out, ">Shared with me<") && has(out, "Q3 report.pdf") && has(out, "PDF · 1.2 MB"));
});

test("Recent lists the newest files first and Knowledge lists the notes", () => {
  const recent = list({ where: { kind: "recent" }, sort: "updated", dir: "desc" });
  assert.deepEqual(lines(recent).slice(0, 4), ["file:fil_notes", "file:fil_deck", "file:fil_rivera", "file:fil_budget"]);
  const knowledge = list({ where: { kind: "knowledge" } });
  assert.deepEqual(lines(knowledge), ["folder:fld_knowledge", "file:fil_voice", "file:fil_vyre"]);
});

test("sort: by name, date modified, size or kind, folders always first, with the current choice checked", () => {
  const byDate = list({ ...folder("fld_sales"), sort: "updated", dir: "desc" });
  assert.deepEqual(lines(byDate), ["folder:fld_proposals", "file:fil_deck", "file:fil_pricing", "file:fil_logo"]);
  const bySize = list({ ...folder("fld_sales"), sort: "size", dir: "desc" });
  assert.deepEqual(lines(bySize), ["folder:fld_proposals", "file:fil_deck", "file:fil_logo", "file:fil_pricing"]);
  const picked: string[] = [];
  const e = items(sortMenuEntries("size", "desc", (k) => void picked.push(k), (d) => void picked.push(d)));
  assert.deepEqual(e.map((x) => [x.label, x.checked]), [["Name", false], ["Date modified", false], ["Made by", false], ["Size", true], ["Kind", false], ["Ascending", false], ["Descending", true]]);
  for (const it of e) it.onSelect?.();
  assert.deepEqual(picked, ["name", "updated", "by", "size", "kind", "asc", "desc"]);
  const num = sortLines([{ ...fileLine(row("a")), name: "file 10" }, { ...fileLine(row("b")), name: "file 2" }], "name", "asc").map((l) => l.name);
  assert.deepEqual(num, ["file 2", "file 10"], "numbers sort as numbers");
  assert.equal(reduce(INITIAL_STATE, { type: "sort", key: "name" }).dir, "desc", "choosing the same sort again flips it");
  assert.equal(reduce(INITIAL_STATE, { type: "sort", key: "updated" }).dir, "desc", "date starts newest first");
});

test("selection follows the Finder: click, Cmd-click, Shift-click, arrows, Cmd-A", () => {
  const order = ["a", "b", "c", "d", "e"];
  let s: FilesState = INITIAL_STATE;
  s = clickSelect(s, order, "b", { meta: false, shift: false });
  assert.deepEqual([s.selection, s.anchor], [["b"], "b"]);
  s = clickSelect(s, order, "d", { meta: true, shift: false });
  assert.deepEqual(s.selection, ["b", "d"]);
  s = clickSelect(s, order, "b", { meta: true, shift: false });
  assert.deepEqual(s.selection, ["d"], "Cmd-click on a selected line unselects it");
  s = clickSelect(clickSelect(INITIAL_STATE, order, "b", { meta: false, shift: false }), order, "e", { meta: false, shift: true });
  assert.deepEqual(s.selection, ["b", "c", "d", "e"], "Shift-click ranges from the anchor");
  s = clickSelect(s, order, "a", { meta: false, shift: true });
  assert.deepEqual(s.selection, ["a", "b"], "and back up the other way");
  assert.deepEqual(arrowSelect(INITIAL_STATE, order, 1, false).selection, ["a"]);
  assert.deepEqual(arrowSelect(INITIAL_STATE, order, -1, false).selection, ["e"]);
  assert.deepEqual(arrowSelect({ ...INITIAL_STATE, selection: ["c"], anchor: "c" }, order, 1, false).selection, ["d"]);
  assert.deepEqual(arrowSelect({ ...INITIAL_STATE, selection: ["e"], anchor: "e" }, order, 1, false).selection, ["e"], "stops at the end");
  assert.deepEqual(arrowSelect({ ...INITIAL_STATE, selection: ["c"], anchor: "c" }, order, 1, true).selection, ["c", "d"], "Shift grows the range");
  assert.deepEqual(selectAll(INITIAL_STATE, order).selection, order);
  assert.deepEqual(contextSelect({ ...INITIAL_STATE, selection: ["a", "b"] }, "b").selection, ["a", "b"], "right-click inside the selection keeps it");
  assert.deepEqual(contextSelect({ ...INITIAL_STATE, selection: ["a", "b"] }, "d").selection, ["d"], "right-click outside selects that line");
  assert.deepEqual(reduce({ ...INITIAL_STATE, selection: ["a"], quickLook: "a" }, { type: "clear" }).selection, []);
  assert.equal(reduce({ ...INITIAL_STATE, selection: ["a"] }, { type: "go", where: { kind: "recent" } }).selection.length, 0, "going elsewhere clears the selection");
});

test("the selected lines are highlighted and counted", () => {
  const out = list({ ...folder("fld_sales"), selection: ["file:fil_deck", "file:fil_logo"] });
  assert.equal(out.split("background-color:var(--sel)").length - 1, 2, "the quiet selection token on exactly the selected rows");
  assert.ok(has(out, "4 items, 2 selected"));
});

test("drag: the selection travels together, a drop moves each file into the folder, a folder never into itself", () => {
  const sel: FilesState = { ...INITIAL_STATE, selection: ["file:fil_deck", "folder:fld_proposals"] };
  assert.equal(dragPayload(sel, "file:fil_deck"), "file:fil_deck,folder:fld_proposals");
  assert.equal(dragPayload(sel, "file:fil_logo"), "file:fil_logo", "dragging a line outside the selection drags that line alone");
  assert.deepEqual(parsePayload("file:fil_deck,folder:fld_proposals,junk"), [{ type: "file", id: "fil_deck" }, { type: "folder", id: "fld_proposals" }]);
  const here = (): string | null => "fld_sales";
  assert.deepEqual(dropMoves(parsePayload("file:fil_deck,folder:fld_proposals"), "fld_billing", here), [
    { cap: "files.move", input: { fileId: "fil_deck", toFolderId: "fld_billing" } }, { cap: "folders.move", input: { folderId: "fld_proposals", parentId: "fld_billing" } },
  ]);
  assert.deepEqual(dropMoves(parsePayload("folder:fld_proposals"), "fld_proposals", here), [], "a folder cannot go into itself");
  assert.deepEqual(dropMoves(parsePayload("file:fil_deck"), "fld_sales", here), [], "a file already there stays");
});

test("drag into a folder moves the file: the next render lists it there and not here", async () => {
  const s = createSampleFiles();
  const html = (id: string): string => wrap(s, folder(id), <FilesList />);
  assert.ok(lines(html("fld_sales")).includes("file:fil_deck") && !lines(html("fld_billing")).includes("file:fil_deck"));
  for (const m of dropMoves(parsePayload("file:fil_deck"), "fld_billing", () => "fld_sales")) await s.data.call(m.cap, m.input);
  assert.ok(!lines(html("fld_sales")).includes("file:fil_deck"));
  assert.ok(lines(html("fld_billing")).includes("file:fil_deck"));
  for (const m of dropMoves(parsePayload("folder:fld_proposals"), "fld_billing", () => "fld_sales")) await s.data.call(m.cap, m.input);
  assert.ok(lines(html("fld_billing")).includes("folder:fld_proposals") && !lines(html("fld_sales")).includes("folder:fld_proposals"));
  assert.deepEqual(s.calls.map((c) => c.cap), ["files.move", "folders.move"]);
});

test("spring-load: a dragged item resting on a folder opens it after the wait; leaving or moving on cancels", () => {
  const queue: { fn: () => void; ms: number; live: boolean }[] = [];
  const opened: string[] = [];
  const spring = createSpring((id) => void opened.push(id), 700, (fn, ms) => { const h = { fn, ms, live: true }; queue.push(h); return h; }, (h) => { (h as { live: boolean }).live = false; });
  const fire = (): void => { for (const h of queue.splice(0)) if (h.live) h.fn(); };
  spring.enter("a");
  assert.equal(queue[0]!.ms, 700);
  spring.leave("a");
  fire();
  assert.deepEqual(opened, [], "leaving cancels the wait");
  spring.enter("a");
  spring.enter("b");
  fire();
  assert.deepEqual(opened, ["b"], "moving to another folder restarts the wait");
  spring.enter("c");
  spring.enter("c");
  assert.equal(queue.length, 1, "staying on the same folder does not schedule again");
  spring.cancel();
  fire();
  assert.deepEqual(opened, ["b"]);
});

test("Quick Look shows a line large with its facts, and the menu offers it", () => {
  const out = list({ ...folder("fld_sales"), selection: ["file:fil_deck"], quickLook: "file:fil_deck" });
  assert.ok(has(out, 'data-testid="quicklook"') && has(out, 'data-testid="quicklook-name"') && has(out, "Pitch deck v4.pptx"));
  assert.ok(has(out, ">Presentation<") && has(out, ">8.9 MB<") && has(out, ">Omar Haddad<") && has(out, 'data-testid="quicklook-open"'));
  assert.ok(!has(list(folder("fld_sales")), 'data-testid="quicklook"'));
  const folderQl = list({ quickLook: "folder:fld_sales" });
  assert.ok(has(folderQl, ">Contains<") && has(folderQl, "Open folder"));
});

test("the line's menu: open, Quick Look, share and rename where they apply, the Trash, and Restore in the Trash", () => {
  const did: string[] = [];
  const h = {
    open: (l: Line) => void did.push(`open:${l.id}`), quickLook: (l: Line) => void did.push(`ql:${l.id}`), share: (l: Line) => void did.push(`share:${l.id}`), rename: (l: Line) => void did.push(`rename:${l.id}`),
    trash: (ls: readonly Line[]) => void did.push(`trash:${ls.map((l) => l.id).join("+")}`), restore: (ls: readonly Line[]) => void did.push(`restore:${ls.length}`),
  };
  const f = fileLine(row("fil_1"));
  const dir: Line = { ...f, key: "folder:fld_1", type: "folder", id: "fld_1", kind: "folder" };
  assert.deepEqual(items(lineMenuEntries([f], false, h)).map((x) => x.label), ["Open", "Quick Look", "Rename…", "Move to Trash"]);
  assert.deepEqual(items(lineMenuEntries([dir], false, h)).map((x) => x.label), ["Open", "Quick Look", "Share…", "Rename…", "Move to Trash"]);
  assert.deepEqual(items(lineMenuEntries([f, dir], false, h)).map((x) => x.label), ["Move 2 Items to Trash"]);
  assert.deepEqual(items(lineMenuEntries([f], true, h)).map((x) => x.label), ["Restore"]);
  for (const it of items(lineMenuEntries([f], false, h))) it.onSelect?.();
  items(lineMenuEntries([f], true, h))[0]!.onSelect?.();
  assert.deepEqual(did, ["open:fil_1", "ql:fil_1", "rename:fil_1", "trash:fil_1", "restore:1"]);
  assert.equal(items(lineMenuEntries([f], false, h)).find((x) => x.label === "Move to Trash")?.danger, true);
});

test("moving to the Trash and restoring change what the Trash and the folder list", async () => {
  const s = createSampleFiles();
  const html = (initial: Partial<FilesState>): string => wrap(s, initial, <FilesList />);
  assert.ok(has(html({ where: { kind: "trash" } }), "The Trash is empty."));
  await s.data.call("files.delete", { fileId: "fil_deck" });
  assert.deepEqual(lines(html({ where: { kind: "trash" } })), ["file:fil_deck"]);
  assert.ok(!lines(html(folder("fld_sales"))).includes("file:fil_deck"));
  assert.ok(has(wrap(s, {}, <FilesTree />), 'data-testid="count-trash"'));
  await s.data.call("files.restore", { fileId: "fil_deck" });
  assert.ok(lines(html(folder("fld_sales"))).includes("file:fil_deck") && has(html({ where: { kind: "trash" } }), "The Trash is empty."));
});

test("an empty place says so with the shared empty state", () => {
  assert.ok(has(list(folder("fld_nothing")), "This folder is empty."));
  assert.ok(has(list({ where: { kind: "trash" } }), "The Trash is empty."));
  assert.ok(has(list({ where: { kind: "shared" } }, harbor), "Nothing has been shared with you yet."));
});

test("the list opens offline from the kept copy and says so", () => {
  const out = list(folder("fld_sales"), northwind, { online: false });
  assert.ok(has(out, "Offline, showing your saved copy") && has(out, "Pitch deck v4.pptx"));
  assert.ok(!has(list(folder("fld_sales")), "Offline, showing"));
});

test("before data arrives the tree and the list draw a frame of the right size, never a blank page", () => {
  assert.ok(has(renderToStaticMarkup(<FilesList />), "files-list-loading"));
  assert.ok(has(renderToStaticMarkup(<FilesTree />), "files-tree-loading"));
  assert.ok(has(renderToStaticMarkup(<ListLoading />), "Files") && has(renderToStaticMarkup(<TreeLoading />), "Loading"));
});

test("sizes, kinds, dates and sources read plainly", () => {
  assert.deepEqual([512, 2_400, 48_000, 1_240_000, 8_900_000, 12_500_000, 2_000_000_000].map(sizeText), ["512 B", "2 KB", "48 KB", "1.2 MB", "8.9 MB", "13 MB", "2 GB"]);
  assert.equal(kindLabel("spreadsheet"), "Spreadsheet");
  const now = Date.UTC(2025, 9, 24, 10, 0);
  assert.equal(updatedText(now - 3_600_000, now, 0), "9:00 AM");
  assert.equal(updatedText(now - 30 * 3_600_000, now, 0), "Yesterday");
  assert.equal(updatedText(now - 400 * 86_400_000, now, 0), "Sep 19, 2024");
  assert.deepEqual([sourceOf({ kind: "recent" }).cap, sourceOf({ kind: "folder", id: null }).input, sourceOf({ kind: "folder", id: "x" }).input], ["files.recent", {}, { folder: "x" }]);
});

test("harbor studio draws its own folders and files", () => {
  const out = list({}, harbor);
  assert.deepEqual(lines(out), ["folder:fld_h_assets", "folder:fld_h_clients"]);
  const clients = list(folder("fld_h_clients"), harbor);
  assert.ok(has(clients, "Moreno logo round two.png") && has(clients, "Abel homepage copy.docx") && !has(clients, "Pitch deck"));
});

// ---------------------------------------------------------------- P-L9e_01b: columns, breadcrumb, list/grid

const colOrder = (initial: Partial<FilesState>): string[] => lines(list({ ...folder("fld_sales"), ...initial }));
const names = (id: string): string => (northwind.people[id] ?? id);

const tag = (out: string, testId: string): string => new RegExp(`<[^<>]*data-testid="${testId}"[^<>]*>`).exec(out)?.[0] ?? "";

test("columns: the header names Name, Modified, Made by, Size and Kind, each a sort button, the sorted one marked", () => {
  const out = list({ ...folder("fld_sales"), sort: "size", dir: "desc" });
  const label: Record<string, string> = { name: "Name", updated: "Modified", by: "Made by", size: "Size", kind: "Kind" };
  let prev = -1;
  for (const k of ["name", "updated", "by", "size", "kind"]) {
    const t = tag(out, `files-col-${k}`);
    assert.ok(has(t, `aria-label="Sort by ${label[k]}"`), `column ${k} is a button named Sort by ${label[k]}`);
    const here = at(out, `data-testid="files-col-${k}"`);
    assert.ok(here > prev, "in the prototype's order");
    prev = here;
    assert.equal(has(t, 'aria-selected="true"'), k === "size", `only the sorted column is marked (${k})`);
  }
  assert.ok(/data-testid="files-sort-label"[^>]*>Size</.test(out), "the sort button names the sort");
});

test("columns: each line carries its Modified, Made by, Size and Kind in the Row's trailing slot", () => {
  const out = list(folder("fld_sales"));
  const trailing = /data-testid="row-line:file:fil_deck-trailing"([\s\S]*?)data-testid="row-line:file:fil_pricing/.exec(out)?.[1] ?? "";
  assert.ok(has(trailing, ">8:00 AM<") && has(trailing, `>${names("usr_omar")}<`) && has(trailing, ">8.9 MB<") && has(trailing, ">Presentation<"));
  assert.ok(has(out, ">Yesterday<") && has(out, ">Oct 15<"), "today as a clock time, then Yesterday, then the date");
});

test("columns: sort by each column orders the lines, folders first, and choosing the same column again flips it", () => {
  assert.deepEqual(colOrder({ sort: "name", dir: "asc" }), ["folder:fld_proposals", "file:fil_logo", "file:fil_deck", "file:fil_pricing"]);
  assert.deepEqual(colOrder({ sort: "updated", dir: "desc" }), ["folder:fld_proposals", "file:fil_deck", "file:fil_pricing", "file:fil_logo"]);
  assert.deepEqual(colOrder({ sort: "updated", dir: "asc" }), ["folder:fld_proposals", "file:fil_logo", "file:fil_pricing", "file:fil_deck"]);
  assert.deepEqual(colOrder({ sort: "size", dir: "asc" }), ["folder:fld_proposals", "file:fil_pricing", "file:fil_logo", "file:fil_deck"]);
  assert.deepEqual(colOrder({ sort: "kind", dir: "asc" }), ["folder:fld_proposals", "file:fil_logo", "file:fil_deck", "file:fil_pricing"], "image, presentation, spreadsheet");
  // Made by sorts by the person's name: Maya Chen (logo) before Omar Haddad (deck, pricing); the name breaks the tie.
  assert.deepEqual(colOrder({ sort: "by", dir: "asc" }), ["folder:fld_proposals", "file:fil_logo", "file:fil_deck", "file:fil_pricing"]);
  assert.deepEqual(colOrder({ sort: "by", dir: "desc" }), ["folder:fld_proposals", "file:fil_deck", "file:fil_pricing", "file:fil_logo"], "Omar Haddad first, the name breaks the tie");
  const nameOf = (id: string): string => ({ u1: "Zed", u2: "Abe" })[id] ?? id;
  const a = { ...fileLine(row("a")), name: "a", updatedBy: "u1" }, b = { ...fileLine(row("b")), name: "b", updatedBy: "u2" };
  assert.deepEqual(sortLines([a, b], "by", "asc", nameOf).map((l) => l.name), ["b", "a"], "by the name, not the id");
  assert.deepEqual(sortLines([a, b], "by", "asc").map((l) => l.name), ["a", "b"], "without a name lookup it falls back to the id");
  for (const k of ["name", "updated", "by", "size", "kind"] as const) {
    const once = reduce(INITIAL_STATE, { type: "sort", key: k });
    assert.equal(once.sort, k);
    const again = reduce(once, { type: "sort", key: k });
    assert.equal(again.dir, once.dir === "asc" ? "desc" : "asc", `${k} flips`);
  }
});

test("breadcrumb: Files, then each folder down to this one; every crumb but the last opens its folder", () => {
  const out = list(folder("fld_proposals"));
  assert.ok(at(out, 'data-testid="files-crumb-root"') < at(out, 'data-testid="files-crumb-fld_sales"') && at(out, 'data-testid="files-crumb-fld_sales"') < at(out, 'data-testid="files-title"'));
  assert.ok(/data-testid="files-title"[^>]*>Proposals</.test(out), "the last crumb is the title");
  assert.ok(!has(out, 'data-testid="files-crumb-fld_proposals"'), "you are on the last crumb, it is not a button");
  const root = list();
  assert.ok(has(root, 'data-testid="files-title"') && !has(root, 'data-testid="files-crumb-root"'));
  assert.ok(has(list({ where: { kind: "trash" } }), ">Trash<") && !has(list({ where: { kind: "trash" } }), 'data-testid="files-crumb-'));
  // Opening a crumb is a go action to its folder: the reducer clears the selection and the Quick Look.
  const there = reduce({ ...INITIAL_STATE, ...folder("fld_proposals"), selection: ["file:fil_rivera"], quickLook: "file:fil_rivera" }, { type: "go", where: { kind: "folder", id: "fld_sales" } });
  assert.deepEqual([there.where, there.selection, there.quickLook], [{ kind: "folder", id: "fld_sales" }, [], null]);
});

test("toggle: list is the default; grid draws the same lines as tiles in rows; the toggle says which is on and the choice sticks", () => {
  const asList = list(folder("fld_sales"));
  assert.ok(has(asList, 'data-testid="files-columns"') && !has(asList, 'data-testid="tile-'));
  assert.ok(has(tag(asList, "files-view-list"), 'aria-checked="true"') && has(tag(asList, "files-view-grid"), 'aria-checked="false"'));
  const asGrid = list({ ...folder("fld_sales"), view: "grid" });
  assert.ok(!has(asGrid, 'data-testid="files-columns"') && has(asGrid, 'data-testid="files-view-grid"'));
  assert.ok(has(tag(asGrid, "files-view-grid"), 'aria-checked="true"') && has(tag(asGrid, "files-view-list"), 'aria-checked="false"'));
  const tiles = [...asGrid.matchAll(/data-testid="tile-((?:file|folder):[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tiles, ["folder:fld_proposals", "file:fil_logo", "file:fil_deck", "file:fil_pricing"], "the same lines in the same order");
  assert.ok(has(asGrid, "Pitch deck v4.pptx") && has(asGrid, "8.9 MB") && has(asGrid, "2 items"));
  assert.equal(reduce(INITIAL_STATE, { type: "view", view: "grid" }).view, "grid");
  const kept = reduce(reduce(INITIAL_STATE, { type: "view", view: "grid" }), { type: "go", where: { kind: "folder", id: "fld_sales" } });
  assert.equal(kept.view, "grid", "going to another folder keeps the view");
  assert.equal(INITIAL_STATE.view, "list");
});

test("grid: the selection, the sort and the drop target read the same as in the list", () => {
  const out = list({ ...folder("fld_sales"), view: "grid", selection: ["file:fil_deck", "file:fil_logo"], sort: "size", dir: "desc" });
  assert.ok(has(out, "2 selected"));
  assert.deepEqual([...out.matchAll(/data-testid="tile-((?:file|folder):[^"]+)"/g)].map((m) => m[1]), ["folder:fld_proposals", "file:fil_deck", "file:fil_logo", "file:fil_pricing"]);
  assert.equal(out.split("background-color:var(--accent-wash)").length - 1, 2, "the quiet selection token on exactly the selected tiles");
});

test("grid layout: tiles fill the row from 172 px up, rows chunk the lines, and a phone gets one column", () => {
  assert.equal(gridLayout(380).per, 1);
  assert.equal(gridLayout(900).per, 4);
  assert.equal(gridLayout(1400).per, 7);
  for (const w of [380, 700, 900, 1400]) {
    const g = gridLayout(w);
    assert.ok(g.tile >= 172 && g.tile * g.per + 12 * (g.per - 1) <= Math.max(172, w - 40), `${w}: tiles fit`);
  }
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
  assert.deepEqual(chunk([1, 2], 0), [[1], [2]], "never an endless loop");
});

test("columns hide Made by, Size and Kind on a phone and keep Name and Modified", () => {
  const out = list(folder("fld_sales"));
  assert.ok(has(out, 'data-testid="cell-by"'), "wide by default (the page is not measured yet)");
  const narrow = renderToStaticMarkup(<RowCells wide={false} cells={{ when: "9:00 AM", by: "Maya", size: "1 KB", kind: "PDF" }} />);
  assert.ok(has(narrow, 'data-testid="cell-modified"') && !has(narrow, 'data-testid="cell-by"') && !has(narrow, 'data-testid="cell-size"') && !has(narrow, 'data-testid="cell-kind"'));
  const head = renderToStaticMarkup(<ColumnHeader sort="name" dir="asc" wide={false} onSort={() => undefined} />);
  assert.ok(has(head, "files-col-name") && has(head, "files-col-updated") && !has(head, "files-col-by") && !has(head, "files-col-size") && !has(head, "files-col-kind"));
});

test("the column header sorts: pressing a column asks for that sort", () => {
  const asked: string[] = [];
  const el = ColumnHeader({ sort: "name", dir: "asc", wide: true, onSort: (k) => void asked.push(k) });
  const found: { testID?: string; onPress?: () => void }[] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const k of n) walk(k); return; }
    const e = n as { props?: { testID?: string; onPress?: () => void; children?: unknown } };
    if (e.props?.testID?.startsWith("files-col-")) found.push(e.props);
    walk(e.props?.children);
  };
  walk(el);
  assert.deepEqual(found.map((f) => f.testID), ["files-col-name", "files-col-updated", "files-col-by", "files-col-size", "files-col-kind"]);
  for (const f of found) f.onPress?.();
  assert.deepEqual(asked, ["name", "updated", "by", "size", "kind"]);
});
