// Google files and provider marks in Files (the rc.14 report: a Google Doc from a connected Drive opened as "This file is empty", with no Drive mark anywhere). A Doc shows its words,
// a Sheet its table, a Form the Open in Google Forms line; the header carries the Google app's tile; a row from a connected folder carries the provider's mark.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { FileViewer } from "../viewer/FileViewer.tsx";
import { FilesViewerDataProvider } from "../viewer/data.tsx";
import { createSampleViewer } from "../viewer/sample.ts";
import type { ViewerData } from "../viewer/model.ts";
import { docsMarkdown, textToBlocks, viewerKindOf } from "../viewer/model.ts";
import { SourcedLead, googleAppOf, providerMarkOf } from "../marks.tsx";
import { openInLabel } from "../open-in.ts";
import { fileLine } from "../tree/index.ts";
import type { FileRow } from "../tree/index.ts";

installDom();

const NATIVE = "application/vnd.google-apps.";
const DOC = "# SEO audit and keyword report\n\nPrepared for Salvo Law, October 2026\\.\n\n| Keyword | Volume |\n| :---- | :---- |\n| personal injury lawyer | 480 |\n\n[image]\n";
const CSV = "Keyword,Volume\npersonal injury lawyer,480\n";

test("which Google app a file is: by Google's own type, by an older export's type, and nothing for a file that is not Google's", () => {
  const g = (mime: string): unknown => googleAppOf({ kind: "google_native", mime });
  assert.deepEqual([g(`${NATIVE}document`), g(`${NATIVE}spreadsheet`), g(`${NATIVE}presentation`), g(`${NATIVE}drawing`), g(`${NATIVE}form`), g(`${NATIVE}site`)], ["gdocs", "gsheets", "gslides", "gdrawings", "gforms", null]);
  assert.deepEqual([g("text/csv"), g("application/pdf"), g("text/plain")], ["gsheets", "gslides", "gdocs"], "rows made before Google's type was kept");
  assert.equal(googleAppOf({ kind: "pdf", mime: "application/pdf" }), null);
  assert.deepEqual(["Google Drive", "OneDrive", "SharePoint", "Dropbox", "GitHub", "Local folder", null].map(providerMarkOf), ["google_drive", "onedrive", "sharepoint", "dropbox", "github", null, null]);
  const row = (mime: string): FileRow => ({ fileId: "f", folderId: "d", name: "Plan", kind: "google_native", mime, size: 1, version: 1, label: 0, ownerId: "u", createdAt: 1, updatedAt: 1, updatedBy: "u", thumb: false, holds: 0, source: { mountId: "m", provider: "Google Drive" } }) as FileRow;
  assert.deepEqual([`${NATIVE}document`, `${NATIVE}spreadsheet`, `${NATIVE}presentation`, `${NATIVE}form`].map((m) => openInLabel(fileLine(row(m)))), ["Google Docs", "Google Sheets", "Google Slides", "Google Forms"]);
});

test("a Doc's Markdown reads as a note: escapes go, a table row reads as its cells; a Google file with nothing to show is never an empty document", () => {
  const blocks = textToBlocks(docsMarkdown(DOC), "markdown");
  assert.deepEqual(blocks.map((b) => [b.tag, b.text]), [["h1", "SEO audit and keyword report"], ["p", "Prepared for Salvo Law, October 2026."], ["p", "Keyword · Volume"], ["p", "personal injury lawyer · 480"], ["p", "[image]"]]);
  const file = (mime: string): { kind: "google_native"; mime: string } => ({ kind: "google_native", mime });
  assert.equal(viewerKindOf({ file: file(`${NATIVE}document`), text: DOC }), "document");
  assert.equal(viewerKindOf({ file: file(`${NATIVE}spreadsheet`), text: CSV }), "csv");
  assert.equal(viewerKindOf({ file: file(`${NATIVE}presentation`), text: "Q4 plan" , previewUrl: "/p.png" }), "document", "a deck's words read better than one page");
  assert.equal(viewerKindOf({ file: file(`${NATIVE}presentation`), previewUrl: "/p.png" }), "image");
  assert.equal(viewerKindOf({ file: file(`${NATIVE}drawing`), previewUrl: "/d.png" }), "image");
  assert.equal(viewerKindOf({ file: file(`${NATIVE}form`) }), "other");
  assert.equal(viewerKindOf({ file: file(`${NATIVE}document`), text: "  " }), "other", "Google could not be reached: no preview, not an empty file");
  assert.equal(viewerKindOf({ file: { kind: "markdown", mime: "text/markdown" }, text: "" }), "document", "a file Vyre holds keeps its own layout");
  assert.equal(viewerKindOf({ file: { kind: "markdown", mime: "text/markdown", size: 0, source: { mountId: "m", provider: "Dropbox" } } }), "other", "a placeholder its provider did not fill is not an empty file");
});

/** The sample viewer with one Google file from a connected Drive, answered by Drive for Open in. */
async function openGoogle(mime: string, o: Partial<ViewerData>, openIn: string) {
  const s = createSampleViewer();
  const row = s.rows.get("f_note")!;
  row.comments = [];
  row.data = { ...row.data, file: { ...row.data.file, name: "Salvo Law SEO Audit and Keyword Report (October 2026)", kind: "google_native", mime, source: { mountId: "mnt_1", provider: "Google Drive" } }, text: undefined, canEdit: false, snapshot: { exportedAt: 1, editVia: "provider_api" }, ...o } as ViewerData;
  const inner = s.data.call;
  const data = { ...s.data, openUrl: () => undefined, call: async (cap: string, input: unknown): Promise<unknown> => (cap === "mounts.file_link" ? { link: { openIn, webUrl: "https://docs.google.com/x", type: "google_doc", edit: [] } } : inner(cap, input)) };
  const root = await mount(createRoot, <FilesViewerDataProvider value={data}><FileViewer fileId="f_note" /></FilesViewerDataProvider>);
  await flush();
  return root;
}

test("a Google Doc opens as its words, under the Google Docs tile, with Open in Google Docs and no Edit switch", async () => {
  const root = await openGoogle(`${NATIVE}document`, { text: DOC }, "Google Docs");
  const all = textOf(root);
  assert.ok(!all.includes("This file is empty"), all);
  assert.ok(all.includes("SEO audit and keyword report") && all.includes("personal injury lawyer"), "the Doc's words are on screen");
  assert.ok(find(root, "google-tile-gdocs"), "the header carries the Google Docs tile, not FILE");
  assert.equal(find(root, "vw-tile"), null);
  assert.equal(textOf(find(root, "vw-open-in")).trim(), "Open in Google Docs");
  assert.equal(find(root, "vw-mode"), null, "a Doc is edited in Google Docs");
});

test("a Google Sheet opens as a table, and a Form says where it opens", async () => {
  const sheet = await openGoogle(`${NATIVE}spreadsheet`, { text: CSV }, "Google Sheets");
  assert.ok(find(sheet, "vw-sheet"), "a table");
  assert.ok(find(sheet, "google-tile-gsheets"));
  assert.ok(textOf(sheet).includes("personal injury lawyer"));
  const form = await openGoogle(`${NATIVE}form`, {}, "Google Forms");
  assert.ok(find(form, "vw-other"));
  assert.match(textOf(form), /Open in Google Forms to see it/);
  assert.ok(!textOf(form).includes("This file is empty"));
});

test("rows carry the marks: a Google file its app's tile, any other file or folder from a provider the provider's mark, a file Vyre holds its own icon", () => {
  const base = <span data-testid="base-icon" />;
  const line = (o: { type: "file" | "folder"; kind: string; mime?: string; source: string | null }) => renderToStaticMarkup(<SourcedLead line={o} base={base} />);
  assert.match(line({ type: "file", kind: "google_native", mime: `${NATIVE}spreadsheet`, source: "Google Drive" }), /google-tile-gsheets/);
  const pdf = line({ type: "file", kind: "pdf", mime: "application/pdf", source: "Google Drive" });
  assert.ok(pdf.includes("provider-marked-google_drive") && pdf.includes("base-icon") && pdf.includes("mark-google_drive"));
  assert.match(line({ type: "folder", kind: "folder", source: "OneDrive" }), /provider-marked-onedrive/);
  assert.match(line({ type: "folder", kind: "folder", source: "Dropbox" }), /provider-marked-dropbox/);
  assert.match(line({ type: "file", kind: "code", source: "GitHub" }), /provider-marked-github/);
  const mine = line({ type: "file", kind: "pdf", source: null });
  assert.ok(mine.includes("base-icon") && !mine.includes("provider-marked"));
});
