// Files tree and list: the screen. The tree (Recent, Shared with me, Trash, the folders in their sections, Knowledge), the list of a folder, Recent, Shared with me, Trash and Knowledge as
// one list of ui/Row lines, the Finder rules for selection, drag to move, spring-load and Quick Look. The writes change what the next render shows.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { FilesList, ListLoading, lineMenuEntries, sortMenuEntries } from "../list/index.ts";
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
  for (const label of ["Daily", "Money", "Maya's reports", "Sales", "Billing", "Intake"]) assert.ok(has(out, `>${label}<`), label);
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
  assert.ok(has(out, "Presentation · 8.9 MB") && has(out, "Spreadsheet · 62 KB") && has(out, "Image · 210 KB") && has(out, "2 items"));
  assert.ok(has(out, "8:00 AM") && has(out, "Yesterday") && has(out, "Oct 15"), "today as a clock time, then Yesterday, then the date");
  assert.ok(has(out, 'data-testid="row-line:file:fil_deck-leading"') && has(out, 'data-testid="row-line:file:fil_deck-trailing"'));
  assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash in any copy");
});

test("screen: the root lists the top folders and a nested folder names its path", () => {
  assert.deepEqual(lines(list()), ["folder:fld_billing", "folder:fld_daily", "folder:fld_intake", "folder:fld_knowledge", "folder:fld_maya", "folder:fld_money", "folder:fld_sales"]);
  const nested = list(folder("fld_proposals"));
  assert.ok(has(nested, ">Proposals<") && has(nested, 'data-testid="files-path"') && has(nested, "Sales /"));
  assert.deepEqual(lines(nested), ["file:fil_harlow", "file:fil_rivera"]);
  assert.ok(has(nested, "Spreadsheet · 77 KB · Google Drive"), "a mounted file names where it came from");
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
  assert.deepEqual(e.map((x) => [x.label, x.checked]), [["Name", false], ["Date modified", false], ["Size", true], ["Kind", false], ["Ascending", false], ["Descending", true]]);
  for (const it of e) it.onSelect?.();
  assert.deepEqual(picked, ["name", "updated", "size", "kind", "asc", "desc"]);
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
