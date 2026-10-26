// @reads ../../../../../../scripts/shots/mounts/P-L9e_01b.tsx
// Files place finish (P-L9e_01c): the staged-writes banner (Review, Approve), back and forward, Upload and the filled New button, the more menu, the side-pane toggle, kind badges and
// Made by faces. Screens render through react-dom/server over react-native-web from the sample Space's replica; the handlers are the ones the buttons call.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { FilesList, StagedBanner, approveStaged, lineMenuEntries, moreMenuEntries, newMenuEntries, stagedText } from "../list/index.ts";
import { LineMarks, RowCells, ThumbTile, TypeTile } from "../FileList.tsx";
import { createSampleFiles } from "../list/sample.ts";
import type { SampleFiles } from "../list/sample.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree, INITIAL_STATE, emptyText, fileLine, hasAgentFace, isPlan, kindText, openByDefault, orderFolders, reduce, rootRank, sourceOf, spaceRoots, tileLabel } from "../tree/index.ts";
import type { FileRow, FilesState, FolderRow, TreeRoots, Where } from "../tree/index.ts";
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

test("Made by is a face with the name beside it, for a person and for an agent", () => {
  const out = renderToStaticMarkup(<RowCells wide cells={{ when: "9:00 AM", by: "Docs", size: "31 KB", kind: "Document" }} />);
  assert.ok(has(out, 'data-testid="cell-by"') && has(out, ">D<") && has(out, ">Docs<"), "the mark, then the name");
  const person = renderToStaticMarkup(<RowCells wide cells={{ when: "9:00 AM", by: "Maya Chen", size: "1 MB", kind: "PDF" }} />);
  assert.ok(has(person, ">M<") && has(person, ">Maya Chen<"));
  const sales = list(createSampleFiles(), folder("fld_proposals"));
  assert.ok(has(sales, ">Docs<") && has(sales, ">Irfad Imtiaz<"));
});

test("Kind is plain text, with where it came from beside it, never a tinted pill", () => {
  const plain = renderToStaticMarkup(<RowCells wide cells={{ when: "9:00 AM", by: null, size: "1 MB", kind: "PDF" }} />);
  assert.ok(has(plain, 'data-testid="cell-kind"') && has(plain, ">PDF<") && !has(plain, "hsla("));
  const out = list(createSampleFiles(), folder("fld_sales"));
  assert.ok(has(out, ">Folder<") && has(out, ">Presentation<"), "Kind is plain text, as the prototype has it");
  assert.ok(!has(out, 'data-testid="kind-badge"') && !has(out, "hsla("), "no tinted pill");
  assert.ok(has(list(createSampleFiles(), folder("fld_proposals")), ">Spreadsheet · Google Drive<"), "where a mounted file came from");
});

// ---------------------------------------------------------------- the sidebar: Starred, Agents, Projects, the Conflict tag

const tree = (s: SampleFiles, initial: Partial<FilesState> = {}): string => wrap(s, initial, <FilesTree />);
const pos = (s: string, needle: string): number => s.indexOf(needle);
const subjects = (): SampleFiles => createSampleFiles(undefined, { subjects: true });

test("the sidebar has Starred between Recent and Shared with me, counted from the stars", () => {
  const out = tree(subjects());
  assert.ok(has(out, 'data-testid="row-nav:starred"') && has(out, 'data-testid="row-nav:starred-trailing"'), "a ui/Row with slots");
  assert.equal(textOf(out, "count-starred"), "3", "Pitch deck and the two Rivera letters are starred");
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
  assert.equal(textOf(tree(s), "count-starred"), "4");
});

test("the Space's root folders Files registers (Agents, Projects, People, Channels) are rows, an agent's folder with its face", () => {
  const out = tree(subjects());
  for (const id of ["fld_agents", "fld_projects", "fld_people", "fld_channels"]) assert.ok(has(out, `data-testid="row-folder-${id}"`), id);
  assert.ok(has(out, 'data-testid="row-folder-fld_ag_docs-trailing"'), "a folder with files has its count in the trailing slot");
  for (const id of ["fld_ag_docs", "fld_ag_research", "fld_ag_assistant", "fld_ag_intake", "fld_ag_billing"]) assert.ok(has(out, `data-testid="row-folder-${id}"`), `${id}: Agents opens to its agents`);
  for (const id of ["fld_pj_rivera", "fld_pj_launch"]) assert.ok(has(out, `data-testid="row-folder-${id}"`), `${id}: Projects opens to its projects`);
  assert.ok(has(out, 'data-testid="face-Docs"') && has(out, 'data-avatar="agent"'), "the agent's face, shared Avatar");
  assert.ok(!has(out, 'data-testid="face-Rivera matter"') && !has(out, 'data-testid="face-Agents"'), "a project, and the Agents folder itself, have the folder icon, not a face");
  assert.ok(has(out, 'data-testid="folder-count-fld_pj_launch"') && !has(out, 'data-testid="folder-count-fld_ag_docs"'), "a folder shows its count, an agent's folder shows no count");
  assert.ok(has(out, 'data-testid="folder-toggle-fld_agents"') && has(out, 'data-testid="folder-toggle-fld_pj_rivera"') && !has(out, 'data-testid="folder-toggle-fld_ag_docs"'), "only a folder with subfolders opens");
  assert.ok(!has(out, ">Contracts<"), "a closed project keeps its subfolders out");
  assert.ok(!has(out, 'data-testid="row-folder-fld_sales"') && !has(out, 'data-testid="row-folder-fld_daily"') && !has(out, 'data-testid="row-folder-fld_maya"'), "only the registered Space roots are listed: no Personal, shared or old sample folders");
  const order = ["row-folder-all", "row-folder-fld_agents", "row-folder-fld_projects", "row-folder-fld_people", "row-folder-fld_channels"].map((t) => pos(out, `data-testid="${t}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "All files, then the registered roots in the order files.tree lists them");
  assert.ok(order.every((n) => n >= 0));
  const loc = [">Memory<", ">Space<", ">Agents<", ">Projects<"].map((t) => pos(out, t));
  assert.deepEqual([...loc].sort((a, b) => a - b), loc);
});

test("the selected agent or project folder is the selected row", () => {
  const out = tree(subjects(), folder("fld_ag_docs"));
  assert.ok(has(out, "background-color:var(--sel)"));
  assert.equal(tree(subjects()).split("background-color:var(--sel)").length - 1, 1, "at the root only All files is selected");
  assert.ok(has(list(subjects(), folder("fld_ag_docs")), "Engagement letter notes.md"), "its files");
});

test("without agents or projects the sidebar has none of those rows, and nothing starred shows no count", () => {
  const out = tree(createSampleFiles());
  assert.ok(!has(out, 'data-testid="row-folder-fld_agents"') && !has(out, 'data-testid="row-folder-fld_projects"') && !has(out, 'data-testid="count-starred"'));
});

test("the root folders are read in the order files.tree lists them; Knowledge keeps its own section; an agent's own folder has a face", () => {
  const roots: TreeRoots = [
    { key: "recent", title: "Recent", kind: "virtual", count: 3 },
    { key: "agents", title: "Agents", kind: "folder", folderId: "fa", count: 0, subject: { kind: "agent" } },
    { key: "projects", title: "Projects", kind: "folder", folderId: "fp", count: 0, subject: { kind: "project" } },
    { key: "knowledge", title: "Knowledge", kind: "folder", folderId: "fk", count: 0 },
  ];
  const rank = rootRank(roots);
  assert.deepEqual([...rank.entries()], [["fa", 1], ["fp", 2], ["fk", 3]]);
  assert.deepEqual([...spaceRoots(roots)].sort(), ["fa", "fp"], "Knowledge is not a Space root; Personal and unregistered top folders are not either");
  const ord = orderFolders([{ folderId: "zz", name: "Zed" }, { folderId: "fp", name: "Projects" }, { folderId: "aa", name: "Alpha" }, { folderId: "fa", name: "Agents" }], rank);
  assert.deepEqual(ord.map((f) => f.folderId), ["fa", "fp", "aa", "zz"]);
  const fr = (o: Partial<FolderRow>): FolderRow => ({ folderId: "f", name: "n", path: "n", fileCount: 0, folderCount: 0, scope: "space", label: 1, git: false, reviewChanges: false, ...o });
  assert.equal(hasAgentFace(fr({ subject: { kind: "agent", id: "agt_docs" } })), true);
  assert.equal(hasAgentFace(fr({ subject: { kind: "agent" } })), false, "the Agents folder itself");
  assert.equal(hasAgentFace(fr({ subject: { kind: "project", id: "pj" } })), false);
  assert.equal(openByDefault(fr({ subject: { kind: "agent" } })), true);
  assert.equal(openByDefault(fr({ subject: { kind: "agent", id: "agt_docs" }, parentId: "fa" })), false);
  assert.equal(openByDefault(fr({})), false);
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

// ---------------------------------------------------------------- in the shared place sidebar

const tree2 = (s: SampleFiles, query: string): string => wrap(s, {}, <FilesTree query={query} />);

test("the sidebar is the shared slot's content: Knowledge and Space open and close, Space holds All files, Agents and Projects", () => {
  const out = tree(subjects());
  for (const id of ["files-head-know", "files-head-space", "files-new-space", "files-space", "row-folder-all", "row-folder-fld_agents", "row-folder-fld_projects"]) assert.ok(has(out, `data-testid="${id}"`), id);
  assert.ok(has(out, 'aria-label="Space, open"') && has(out, 'aria-label="Knowledge, open"'));
  const order = ["row-folder-all", "row-folder-fld_agents", "row-folder-fld_projects", "row-folder-fld_people"].map((t) => pos(out, `data-testid="${t}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "All files, Agents, Projects, People");
  assert.ok(!has(out, "Search files") && !has(out, 'data-testid="place-sidebar"'), "the title and the search field are the shell's, not drawn here");
});

test("the search field filters the sidebar rows", () => {
  const s = subjects();
  const hit = tree2(s, "riv");
  assert.ok(has(hit, "Rivera matter") && !has(hit, ">Daily<") && !has(hit, ">Recent<"));
  assert.ok(has(hit, 'data-testid="face-Docs"') === false, "Docs does not match riv");
  const agent = tree2(s, "docs");
  assert.ok(has(agent, 'data-testid="face-Docs"') && has(agent, 'data-avatar="agent"'), "an agent folder keeps its face in a search");
  assert.ok(has(tree2(s, "zzzz"), 'data-testid="files-tree-empty"'), "nothing matches says so");
  assert.ok(has(tree2(s, ""), ">Recent<") && has(tree2(s, ""), ">Agents<"), "an empty search keeps every row");
});

test("the more menu carries the Trash, with its count only when it holds something", () => {
  const h = { showHidden: true, toggleHidden: () => undefined, selectAll: () => undefined, openTrash: () => undefined };
  const empty = items(moreMenuEntries({ ...h, trashCount: 0 }));
  assert.deepEqual(empty.map((e) => e.label), ["Show Hidden Files", "Select All", "Trash"]);
  assert.equal(empty[2]?.count, undefined);
  assert.equal(items(moreMenuEntries({ ...h, trashCount: 4 }))[2]?.count, 4);
  assert.equal(empty[0]?.checked, true);
});

test("the Rivera matter folder is as the prototype has it: its files, the staged banner, the star and the Conflict tag", () => {
  const out = list(subjects(), folder("fld_pj_rivera"));
  for (const name of ["client-intake.pdf", "consult-prep.md", "engagement-checklist.csv", "id-scan.png", "Rivera onboarding plan", "rivera-engagement-letter.docx", "site-photo.png"]) assert.ok(has(out, name), name);
  assert.ok(has(out, 'data-testid="staged-banner"') && has(out, 'data-testid="conflict-tag"') && has(out, 'data-testid="star-mark"'));
});

// ---------------------------------------------------------------- type tiles, empty counts, the Space's agents

test("each file leads with a type tile: PDF, MD, CSV, DOCX on a tint, an icon for pictures and folders", () => {
  assert.equal(tileLabel("client-intake.pdf", "pdf"), "PDF");
  assert.equal(tileLabel("consult-prep.md", "markdown"), "MD");
  assert.equal(tileLabel("engagement-checklist.csv", "spreadsheet"), "CSV");
  assert.equal(tileLabel("rivera-engagement-letter.docx", "document"), "DOCX");
  assert.equal(tileLabel("id-scan.png", "image"), null, "a picture has the picture icon");
  assert.equal(tileLabel("Contracts", "folder"), null);
  assert.equal(tileLabel("Rivera onboarding plan", "document"), null, "no extension, no label");
  assert.ok(has(renderToStaticMarkup(<TypeTile label="PDF" icon="doc" folder={false} />), ">PDF<"));
  assert.ok(!has(renderToStaticMarkup(<TypeTile label={null} icon="folder" folder />), 'data-testid="type-tile-label"'));
  const out = list(subjects(), folder("fld_pj_rivera"));
  for (const label of ["PDF", "MD", "CSV", "DOCX"]) assert.ok(has(out, `>${label}<`), label);
  assert.equal(out.split('data-testid="type-tile"').length - 1, 7, "a labelled or thumbnail tile leads every line but the folder");
});

test("an empty folder shows no count, and the Scout, Billing and Intake agents are in the Agents folder", () => {
  const out = tree(subjects());
  assert.ok(!has(out, 'data-testid="folder-count-fld_people"') && !has(out, 'data-testid="folder-count-fld_ag_assistant"'), "no 0");
  assert.ok(has(out, 'data-testid="folder-count-fld_pj_launch"'));
  for (const id of ["fld_ag_scout", "fld_ag_billing", "fld_ag_intake"]) assert.ok(has(out, `data-testid="row-folder-${id}"`), id);
  assert.ok(has(out, 'data-testid="face-Scout"'));
});

test("a picture with a thumbnail leads with its preview, the one the viewer shows; other files keep the type tile", () => {
  const out = list(subjects(), folder("fld_pj_rivera"));
  assert.equal(out.split('data-testid="thumb-image"').length - 1, 2, "id-scan.png and site-photo.png have thumbnails");
  assert.ok(has(out, "data:image/svg+xml"), "the preview address from files.viewer_data");
  assert.ok(has(out, ">PDF<") && has(out, ">DOCX<"), "files without a thumbnail keep their tile");
  const s = subjects();
  const one = wrap(s, {}, <ThumbTile fileId="fil_pj_id" label={null} icon="image" />);
  assert.ok(has(one, 'data-testid="thumb-image"'));
  const none = wrap(s, {}, <ThumbTile fileId="fil_pj_intake" label="PDF" icon="doc" />);
  assert.ok(!has(none, 'data-testid="thumb-image"') && has(none, ">PDF<"), "no previewUrl, the tile");
});

test("Plan files lead with the PLAN page tile and say Plan in the Kind column", () => {
  const plan = "application/vnd.vyre.plan+json";
  assert.ok(isPlan(plan) && !isPlan("application/pdf") && !isPlan(undefined));
  assert.equal(tileLabel("Rivera onboarding plan", "document", plan), "PLAN");
  assert.equal(kindText("document", plan), "Plan");
  assert.equal(kindText("document"), "Document");
  const out = list(subjects(), folder("fld_pj_rivera"));
  assert.ok(has(out, ">PLAN<") && has(out, ">Plan<"), "the tile and the Kind");
  assert.ok(has(out, 'data-testid="type-page"'), "a small page, not a pill");
});

test("an agent's folder shows the attention dot when a change set of its own waits, and never a count", () => {
  const out = tree(subjects());
  assert.ok(has(out, 'data-testid="folder-attention-fld_ag_docs"') && has(out, 'aria-label="Waiting for you"'), "Docs staged writes that wait for review");
  assert.ok(!has(out, 'data-testid="folder-attention-fld_ag_research"') && !has(out, 'data-testid="folder-count-fld_ag_research"'), "Research has nothing waiting, and no count");
});
