// @reads ../../../../../../scripts/shots/mounts/P-L9e_01b.tsx
// Files place finish (P-L9e_01c): the staged-writes banner (Review, Approve), back and forward, Upload and the filled New button, the more menu, the side-pane toggle, kind badges and
// Made by faces. Screens render through react-dom/server over react-native-web from the sample Space's replica; the handlers are the ones the buttons call.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { FilesList, StagedBanner, approveStaged, lineMenuEntries, newMenuEntries, stagedText } from "../list/index.ts";
import { KindBadge, LineMarks, RowCells } from "../FileList.tsx";
import { createSampleFiles } from "../list/sample.ts";
import type { SampleFiles } from "../list/sample.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree, INITIAL_STATE, emptyText, fileLine, reduce, sourceOf, subjectGroups, subtreeIds } from "../tree/index.ts";
import type { FileRow, FilesState, TreeRoots, Where } from "../tree/index.ts";
import { isItem } from "../../../../../../ui/src/Menu/props.ts";
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/props.ts";

const wrap = (s: SampleFiles, initial: Partial<FilesState>, child: ReactElement): string =>
  renderToStaticMarkup(<FilesDataProvider value={s.data}><FilesStateProvider initial={initial}>{child}</FilesStateProvider></FilesDataProvider>).replaceAll("<!-- -->", "");
const list = (s: SampleFiles, initial: Partial<FilesState>): string => wrap(s, initial, <FilesList />);
const has = (s: string, needle: string): boolean => s.includes(needle);
const textOf = (s: string, id: string): string | null => new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`).exec(s)?.[1] ?? null;
const folder = (id: string): Partial<FilesState> => ({ where: { kind: "folder", id } });
const items = (entries: readonly MenuEntry[]): MenuItem[] => entries.filter(isItem);

test("a folder with staged writes shows the banner: who, how many, Review and Approve", () => {
  const out = list(createSampleFiles(), folder("fld_proposals"));
  assert.ok(has(out, 'data-testid="staged-banner"'));
  assert.equal(textOf(out, "staged-text"), "Docs staged 3 writes here. Nothing is saved until you approve.");
  assert.ok(has(out, 'data-testid="staged-review"') && has(out, 'data-testid="staged-approve"') && has(out, 'data-avatar="agent"'), "the agent's face, shared Avatar");
  assert.equal(stagedText("Billing", 1), "Billing staged 1 write here. Nothing is saved until you approve.");
});

test("a folder with nothing staged has no banner", () => {
  const out = list(createSampleFiles(), folder("fld_sales"));
  assert.ok(!has(out, 'data-testid="staged-banner"'));
});

test("Approve sends changesets.approve for the open change set, and the banner is gone afterwards", async () => {
  const s = createSampleFiles();
  assert.ok(has(wrap(s, folder("fld_proposals"), <StagedBanner folderId="fld_proposals" />), 'data-testid="staged-banner"'));
  await approveStaged(s.data.call, [{ changesetId: "chg_docs", by: "agt_docs", fileCount: 3 }]);
  assert.deepEqual(s.calls.filter((c) => c.cap === "changesets.approve"), [{ cap: "changesets.approve", input: { changesetId: "chg_docs" } }]);
  assert.ok(!has(wrap(s, folder("fld_proposals"), <StagedBanner folderId="fld_proposals" />), 'data-testid="staged-banner"'), "approved change sets are no longer open");
});

test("New and Upload: the New menu offers a folder and an upload, and each opens the shell's sheet", () => {
  const s = createSampleFiles();
  const entries = newMenuEntries({ newFolder: () => s.data.nav.newFolder("space", "fld_sales"), upload: () => s.data.nav.upload?.("fld_sales") });
  assert.deepEqual(items(entries).map((e) => e.label), ["New Folder", "Upload Files…"]);
  for (const e of items(entries)) e.onSelect?.();
  assert.deepEqual(s.opened, ["new-folder:space:fld_sales", "upload:fld_sales"]);
  assert.deepEqual(items(newMenuEntries({ newFolder: () => undefined })).map((e) => e.label), ["New Folder"], "no upload where the place has none");
});

test("the header has back, forward, Upload, a filled New, the more menu and the pane toggle", () => {
  const out = list(createSampleFiles(), folder("fld_sales"));
  for (const id of ["files-back", "files-forward", "files-upload", "files-new", "files-more", "pane-toggle"]) assert.ok(has(out, `data-testid="${id}"`), id);
  assert.ok(has(out, 'aria-label="Back"') && has(out, 'aria-label="Forward"') && has(out, 'aria-label="Upload files"') && has(out, 'aria-label="Hide the pane"'));
  assert.ok(has(out, 'aria-disabled="true"'), "nothing to go back to yet");
  const trash = list(createSampleFiles(), { where: { kind: "trash" } });
  assert.ok(!has(trash, 'data-testid="files-upload"') && !has(trash, 'data-testid="files-new"'), "no Upload or New in the Trash");
});

test("back and forward walk where the list has been", () => {
  const sales: Where = { kind: "folder", id: "fld_sales" }, recent: Where = { kind: "recent" }, trash: Where = { kind: "trash" };
  let s: FilesState = { ...INITIAL_STATE, where: sales };
  s = reduce(s, { type: "go", where: recent });
  s = reduce(s, { type: "go", where: trash });
  assert.deepEqual(s.back, [sales, recent]);
  s = reduce(s, { type: "back" });
  assert.deepEqual([s.where, s.forward], [recent, [trash]]);
  s = reduce(s, { type: "back" });
  assert.deepEqual([s.where, s.back, s.forward], [sales, [], [trash, recent]]);
  assert.equal(reduce(s, { type: "back" }), s, "nothing before the first place");
  s = reduce(s, { type: "forward" });
  assert.deepEqual([s.where, s.forward], [recent, [trash]]);
  const again = reduce(s, { type: "go", where: recent });
  assert.deepEqual(again.back, s.back, "going to the place you are on adds nothing");
  assert.deepEqual(reduce(s, { type: "go", where: sales }).forward, [], "a new place clears forward");
});

test("with somewhere to go back to, the arrow is live; with somewhere to go forward, so is the other", () => {
  const live = list(createSampleFiles(), { ...folder("fld_sales"), back: [{ kind: "recent" }], forward: [{ kind: "trash" }] });
  assert.ok(!has(live, 'aria-disabled="true"'));
});

test("Show Hidden Files is a state, off to begin with", () => {
  assert.equal(INITIAL_STATE.showHidden, false);
  assert.equal(reduce(INITIAL_STATE, { type: "hidden", on: true }).showHidden, true);
});

test("Made by is a face: a person's, or the agent's own", () => {
  const out = renderToStaticMarkup(<RowCells wide cells={{ when: "9:00 AM", by: "Docs", byAgent: true, size: "31 KB", kind: "Document" }} />);
  assert.ok(has(out, 'data-testid="face-Docs"') && has(out, 'data-avatar="agent"'));
  const person = renderToStaticMarkup(<RowCells wide cells={{ when: "9:00 AM", by: "Maya Chen", size: "1 MB", kind: "PDF" }} />);
  assert.ok(has(person, 'data-testid="face-Maya Chen"') && has(person, 'data-avatar="person"'));
  const sales = list(createSampleFiles(), folder("fld_proposals"));
  assert.ok(has(sales, 'data-testid="face-Docs"') && has(sales, 'data-testid="face-Irfad Imtiaz"'));
});

test("Kind is a badge, with where it came from beside it", () => {
  const plain = renderToStaticMarkup(<KindBadge kind="PDF" />);
  assert.ok(has(plain, ">PDF<") && !has(plain, "Google Drive"));
  const mounted = renderToStaticMarkup(<KindBadge kind={"Spreadsheet · Google Drive"} />);
  assert.ok(has(mounted, ">Spreadsheet<") && has(mounted, ">Google Drive<"));
  const out = list(createSampleFiles(), folder("fld_sales"));
  assert.ok(has(out, 'data-testid="kind-badge"'));
});

// ---------------------------------------------------------------- the sidebar: Starred, Agents, Projects, the Conflict tag

const tree = (s: SampleFiles, initial: Partial<FilesState> = {}): string => wrap(s, initial, <FilesTree />);
const pos = (s: string, needle: string): number => s.indexOf(needle);
const subjects = (): SampleFiles => createSampleFiles(undefined, { subjects: true });

test("the sidebar has Starred between Recent and Shared with me, counted from the stars", () => {
  const out = tree(subjects());
  assert.ok(has(out, 'data-testid="row-nav:starred"') && has(out, 'data-testid="row-nav:starred-trailing"'), "a ui/Row with slots");
  assert.equal(textOf(out, "count-starred"), "2", "Pitch deck and the Rivera letter are starred");
  const order = [">Recent<", ">Starred<", ">Shared with me<"].map((t) => pos(out, t));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(order.every((n) => n >= 0));
});

test("Starred is a place: the list shows the starred files, with the star after the name", () => {
  const s = subjects();
  assert.deepEqual(sourceOf({ kind: "starred" }).cap, "files.recent");
  assert.equal(emptyText({ kind: "starred" }), "Nothing starred yet.");
  assert.ok(has(tree(s, { where: { kind: "starred" } }), "background-color:var(--sel)"), "the Starred row is the selected one");
  const out = list(s, { where: { kind: "starred" } });
  assert.ok(has(out, "Pitch deck v4.pptx") && has(out, "Rivera engagement letter.docx"));
  assert.ok(!has(out, "Pricing sheet.xlsx") && !has(out, "Budget 2026.xlsx"), "only starred files");
  assert.ok(has(out, 'data-testid="star-mark"'));
  assert.ok(has(renderToStaticMarkup(<LineMarks starred conflict={false} />), 'data-testid="star-mark"') && renderToStaticMarkup(<LineMarks starred={false} conflict={false} />) === "", "no marks, nothing drawn");
});

test("starring a file goes through files.star and changes the Starred count", async () => {
  const s = subjects();
  await s.data.call("files.star", { fileId: "fil_pricing", starred: true });
  assert.deepEqual(s.calls.filter((c) => c.cap === "files.star"), [{ cap: "files.star", input: { fileId: "fil_pricing", starred: true } }]);
  assert.equal(textOf(tree(s), "count-starred"), "3");
});

test("the Agents and Projects trees list the folders Files registers for itself, an agent with its face", () => {
  const out = tree(subjects());
  assert.ok(has(out, 'data-testid="files-agents"') && has(out, 'data-testid="files-projects"'));
  for (const id of ["fld_ag_docs", "fld_ag_research", "fld_ag_assistant"]) assert.ok(has(out, `data-testid="row-agents-${id}"`), id);
  assert.ok(has(out, 'data-testid="row-agents-fld_ag_docs-trailing"') && has(out, 'data-testid="agents-count-fld_ag_docs"'), "a folder with files shows its count in the trailing slot");
  for (const id of ["fld_pj_rivera", "fld_pj_launch"]) assert.ok(has(out, `data-testid="row-projects-${id}"`), id);
  assert.ok(has(out, 'data-testid="face-Docs"') && has(out, 'data-avatar="agent"'), "the agent's face, shared Avatar");
  assert.ok(!has(out, 'data-testid="face-Rivera matter"'), "a project has a folder, not a face");
  assert.ok(has(out, 'data-testid="agents-toggle-fld_ag_docs"') === false && has(out, 'data-testid="projects-toggle-fld_pj_rivera"'), "only a folder with subfolders opens");
  assert.ok(!has(out, ">Contracts<"), "a closed project keeps its subfolders out");
  assert.ok(!has(out, 'data-testid="row-folder-fld_ag_docs"') && !has(out, 'data-testid="row-folder-fld_pj_rivera"'), "the main tree does not list them twice");
  assert.ok(has(out, 'data-testid="row-folder-fld_sales"'), "the other Space folders stay in the main tree");
  const order = [">Space<", ">Agents<", ">Projects<", ">Memory<"].map((t) => pos(out, t));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("the selected agent or project folder is the selected row", () => {
  const out = tree(subjects(), folder("fld_ag_docs"));
  assert.ok(has(out, "background-color:var(--sel)"));
  assert.equal(tree(subjects()).split("background-color:var(--sel)").length - 1, 0);
  assert.ok(has(list(subjects(), folder("fld_ag_docs")), "Engagement letter notes.md"), "its files");
});

test("without agents or projects the sidebar has no empty groups, and nothing starred shows no count", () => {
  const out = tree(createSampleFiles());
  assert.ok(!has(out, 'data-testid="files-agents"') && !has(out, 'data-testid="files-projects"') && !has(out, 'data-testid="count-starred"'));
});

test("subjectGroups reads the roots: agents and projects by title, folders only; subtreeIds follows the children", () => {
  const roots: TreeRoots = [
    { key: "recent", title: "Recent", kind: "virtual", count: 3 },
    { key: "b", title: "Zed", kind: "folder", folderId: "b", count: 1, subject: { kind: "agent", id: "agt_z" } },
    { key: "a", title: "Docs", kind: "folder", folderId: "a", count: 2, subject: { kind: "agent", id: "agt_d" } },
    { key: "p", title: "Rivera", kind: "folder", folderId: "p", count: 4, subject: { kind: "project", id: "pj_r" } },
    { key: "s", title: "Sales", kind: "folder", folderId: "s", count: 5 },
  ];
  const g = subjectGroups(roots);
  assert.deepEqual(g.agents.map((r) => r.title), ["Docs", "Zed"]);
  assert.deepEqual(g.projects.map((r) => r.title), ["Rivera"]);
  const nodes = [{ id: "p", parentId: null }, { id: "p1", parentId: "p" }, { id: "p2", parentId: "p1" }, { id: "s", parentId: null }];
  assert.deepEqual([...subtreeIds(nodes, ["p"])].sort(), ["p", "p1", "p2"]);
});

const stub = (o: Partial<FileRow>): FileRow => ({ fileId: "fil_x", folderId: "fld_x", name: "x.png", kind: "image", mime: "", size: 1, version: 1, label: 1, ownerId: "u", createdAt: 0, updatedAt: 0, updatedBy: "u", thumb: false, holds: 0, ...o });

test("a file with two edits carries the Conflict tag, a button that opens the choice", () => {
  const s = subjects();
  const out = list(s, folder("fld_sales"));
  assert.ok(has(out, 'data-testid="conflict-tag"') && has(out, ">Conflict<") && has(out, 'aria-label="Conflict. Two edits. Click to resolve."'));
  assert.equal(out.split('data-testid="conflict-tag"').length - 1, 1, "only the picture with two edits");
  assert.ok(!has(list(s, folder("fld_intake")), 'data-testid="conflict-tag"'));
  assert.ok(has(list(s, { where: { kind: "recent" } }), 'data-testid="conflict-tag"'), "in Recent too");
  assert.equal(fileLine(stub({ conflict: true })).conflict, true);
  assert.equal(fileLine(stub({})).conflict, undefined);
  assert.ok(has(renderToStaticMarkup(<LineMarks starred={false} conflict />), 'data-testid="conflict-tag"'));
});

test("Resolve Conflict… and Star are in the menu of a line, and each does its work", () => {
  const did: string[] = [];
  const h = {
    open: () => undefined, quickLook: () => undefined, share: () => undefined, rename: () => undefined, trash: () => undefined, restore: () => undefined,
    star: (l: { id: string }) => void did.push(`star:${l.id}`), resolve: (l: { id: string }) => void did.push(`resolve:${l.id}`),
  };
  const bad = fileLine(stub({ fileId: "fil_logo", conflict: true }));
  const entries = items(lineMenuEntries([bad], false, h));
  assert.deepEqual(entries.map((e) => e.label), ["Resolve Conflict…", "Open", "Quick Look", "Star", "Rename…", "Move to Trash"]);
  for (const e of entries.filter((x) => x.label === "Resolve Conflict…" || x.label === "Star")) e.onSelect?.();
  assert.deepEqual(did, ["resolve:fil_logo", "star:fil_logo"]);
  const starred = items(lineMenuEntries([fileLine(stub({ starred: true }))], false, h));
  assert.ok(starred.some((e) => e.label === "Remove Star") && !starred.some((e) => e.label === "Resolve Conflict…"));
  assert.ok(!items(lineMenuEntries([bad], false, { open: h.open, quickLook: h.quickLook, share: h.share, rename: h.rename, trash: h.trash, restore: h.restore })).some((e) => e.label === "Star" || e.label === "Resolve Conflict…"), "no handler, no entry");
});

test("the shell's conflict handler is asked for the file", () => {
  const s = createSampleFiles();
  s.data.nav.resolveConflict?.("fil_logo");
  assert.deepEqual(s.opened, ["resolve:fil_logo"]);
});
