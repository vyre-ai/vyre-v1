// @reads ../../../../../../scripts/shots/mounts/P-L9e_01b.tsx
// Files place finish (P-L9e_01c): the staged-writes banner (Review, Approve), back and forward, Upload and the filled New button, the more menu, the side-pane toggle, kind badges and
// Made by faces. Screens render through react-dom/server over react-native-web from the sample Space's replica; the handlers are the ones the buttons call.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { FilesList, StagedBanner, approveStaged, newMenuEntries, stagedText } from "../list/index.ts";
import { KindBadge, RowCells } from "../FileList.tsx";
import { faceUri } from "../FaceImage.tsx";
import { createSampleFiles } from "../list/sample.ts";
import type { SampleFiles } from "../list/sample.ts";
import { FilesDataProvider, FilesStateProvider, INITIAL_STATE, reduce } from "../tree/index.ts";
import type { FilesState, Where } from "../tree/index.ts";
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
  assert.ok(has(out, 'data-face="image"') && !has(out, "feGaussianBlur"), "faces in rows are cached images, not a blurred inline svg per row (the scroll budget)");
  assert.equal(faceUri("Docs", true), faceUri("Docs", true));
  assert.notEqual(faceUri("Docs", true), faceUri("Docs", false), "an agent and a person of one name differ");
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
