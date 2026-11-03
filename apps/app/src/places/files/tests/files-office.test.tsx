// Office files in the Files viewer (rc.17): a Word file reads as a document (headings, bold and italic, bullets nested by level, numbered items, a table with its header, a picture's place), a
// deck as a vertical run of slide cards with each slide's notes, both read only under the list's own DOCX and PPTX tiles. A Word or PowerPoint file with no words (password-protected, damaged, an
// old .doc with no converter) is the quiet "No preview of this file here. Open in Word to see it." line, never a blank page or "This file is empty". The words are the Markdown the previews
// module reads from the file (modules/previews/handlers/ooxml.ts), written out here.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, textOf } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { Viewer, inlineRuns, slideGroups, stripInline } from "../../../../../../ui/src/Viewer/index.tsx";
import { FileViewer } from "../viewer/FileViewer.tsx";
import { FilesViewerDataProvider } from "../viewer/data.tsx";
import { createSampleViewer } from "../viewer/sample.ts";
import type { ViewerData } from "../viewer/model.ts";
import { isEditable, isOffice, officeBlocks, viewerKind, viewerKindOf } from "../viewer/model.ts";
import { noPreviewWords, officeAppOf } from "../open-in.ts";
import { tileLabel } from "../tree/model.ts";

installDom();

const clean = (s: string): string => s.replaceAll("<!-- -->", "");
const LETTER = [
  "# Engagement letter",
  "Dear Ms Lin, we act for you in the sale of **12 Elm Street**. The *closing date* is ***31 October***.",
  "## Fees",
  "- Title search\n  - County records\n- Closing",
  "1. Sign\n  1. Witness\n2. File",
  "| Item | Cost |\n| --- | --- |\n| Search | $120 |\n| Filing \\| court | $80 |",
  "[Image: Signature]",
  "See [the terms](https://example.com/terms).",
].join("\n\n");
const DECK = [
  "# Slide 1: Q4 review", "Salvo Law, October 2026",
  "# Slide 2: Where the leads come from", "- **Search**\n  - Roseville pages\n- Referrals", "| Channel | Leads |\n| --- | --- |\n| Search | 48 |", "[Image: Chart of leads]", "Notes: Lead with the number.\nThen the source.",
  "# Slide 3",
].join("\n\n");

test("a Word file's Markdown becomes blocks: headings, paragraphs, nested bullets, numbered items, a table's header and rows, a picture, a link", () => {
  const blocks = officeBlocks(LETTER);
  assert.deepEqual(blocks.map((b) => [b.tag, b.text, b.level ?? 0]), [
    ["h1", "Engagement letter", 0],
    ["p", "Dear Ms Lin, we act for you in the sale of **12 Elm Street**. The *closing date* is ***31 October***.", 0],
    ["h2", "Fees", 0],
    ["li", "Title search", 0], ["li", "County records", 1], ["li", "Closing", 0],
    ["p", "1. Sign", 0], ["p", "1. Witness", 1], ["p", "2. File", 0],
    ["hrow", "Item\tCost", 0], ["row", "Search\t$120", 0], ["row", "Filing | court\t$80", 0],
    ["fig", "Signature", 0],
    ["p", "See [the terms](https://example.com/terms).", 0],
  ]);
  assert.deepEqual(officeBlocks("[Image]").map((b) => [b.tag, b.text]), [["fig", ""]]);
  assert.deepEqual(officeBlocks("| only | row |").map((b) => b.tag), ["row"], "a row without a rule under it is a row");
  assert.deepEqual(officeBlocks("Plain line\nNotes: not a deck").map((b) => b.tag), ["p", "p"], "Notes: is a slide's notes only in a deck");
  assert.deepEqual(officeBlocks(""), []);
});

test("bold, italic and both are runs; a star between words or around a space is not italic; a link keeps its words without the marks", () => {
  assert.deepEqual(inlineRuns("a **b** *c* ***d*** e"), [{ text: "a " }, { text: "b", bold: true }, { text: " " }, { text: "c", italic: true }, { text: " " }, { text: "d", bold: true, italic: true }, { text: " e" }]);
  for (const plain of ["5 * 3 = 15 and 2 * 4", "a*b*c", "price* and *terms", "** not bold"]) assert.deepEqual(inlineRuns(plain), [{ text: plain }], plain);
  assert.deepEqual(inlineRuns("[**Terms**](https://x.test/t)"), [{ text: "Terms", link: true, ref: "https://x.test/t", kind: "md" }]);
  for (const s of ["a **b** *c* ***d*** e", "x [**T**](https://x.test) *y*", "**$250** and [[Pricing]]"]) assert.equal(inlineRuns(s).map((r) => r.text).join(""), stripInline(s), s);
});

test("a deck's Markdown becomes one group per slide: its number and title, its words, a table and a picture, then its speaker notes", () => {
  const blocks = officeBlocks(DECK);
  const groups = slideGroups(blocks);
  assert.deepEqual(groups.map((g) => [g.head?.n, g.head?.text, g.items.map((x) => x.b.tag).join(" ")]), [
    [1, "Q4 review", "p"],
    [2, "Where the leads come from", "li li li hrow row fig note note"],
    [3, "", ""],
  ]);
  assert.deepEqual(groups[1]!.items.filter((x) => x.b.tag === "note").map((x) => x.b.text), ["Lead with the number.", "Then the source."]);
  assert.deepEqual(groups[1]!.items.map((x) => x.at), [3, 4, 5, 6, 7, 8, 9, 10], "each block keeps its place among all the blocks, for Find");
});

test("Word and PowerPoint files take the document layout; one with no words is the no-preview state; they are never edited in place", () => {
  assert.deepEqual([viewerKind("document"), viewerKind("presentation")], ["document", "document"]);
  assert.deepEqual([isOffice("document"), isOffice("presentation"), isOffice("markdown"), isOffice("spreadsheet")], [true, true, false, false]);
  const f = (name: string, kind: "document" | "presentation", mime: string): { kind: "document" | "presentation"; mime: string; size: number } => ({ kind, mime, size: 18_000 });
  assert.equal(viewerKindOf({ file: f("a.docx", "document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), text: LETTER }), "document");
  assert.equal(viewerKindOf({ file: f("a.pptx", "presentation", "application/vnd.openxmlformats-officedocument.presentationml.presentation"), text: DECK }), "document");
  for (const text of [undefined, "", "  \n"]) assert.equal(viewerKindOf({ file: f("Locked.docx", "document", "application/msword"), text, previewUrl: "/x" }), "other", JSON.stringify(text));
  assert.deepEqual(["Letter.docx", "Old memo.DOC", "Deck.pptx", "Old.ppt", "Budget.xlsx", "notes.odt"].map(officeAppOf), ["Word", "Word", "PowerPoint", "PowerPoint", "Excel", null]);
  assert.equal(noPreviewWords("Old memo.doc"), "No preview of this file here. Open in Word to see it.");
  assert.equal(noPreviewWords("Pitch.ppt"), "No preview of this file here. Open in PowerPoint to see it.");
  assert.deepEqual(["a.docx", "a.doc", "a.pptx", "a.ppt", "a.xlsx", "a.xls"].map((n) => tileLabel(n, "document")), ["DOCX", "DOCX", "PPTX", "PPTX", "XLSX", "XLSX"], "older files wear the same tile as new ones");
  const data = (kind: ViewerData["file"]["kind"]): Pick<ViewerData, "canEdit" | "file"> => ({ canEdit: true, file: { kind } as ViewerData["file"] });
  assert.deepEqual([isEditable(data("document")), isEditable(data("presentation")), isEditable(data("markdown"))], [false, false, true]);
});

test("the Viewer draws a Word file: real headings, bold and italic runs, a table with a header row, a picture's place, no Markdown marks on screen", () => {
  const out = clean(renderToStaticMarkup(<Viewer fileId="f" title="Engagement letter.docx" kind="document" blocks={officeBlocks(LETTER)} readOnly />));
  assert.ok(out.includes('data-tag="h1"') && out.includes('data-tag="h2"'));
  assert.ok(out.includes('data-tag="hrow"') && (out.match(/data-tag="row"/g) ?? []).length === 2, "a header row and two rows");
  assert.ok(out.includes("Filing | court"), "the escaped pipe is a pipe again");
  assert.ok(out.includes('data-tag="fig"') && out.includes("Picture: Signature"));
  assert.ok(out.includes("r-fontStyle-") && out.includes("r-fontWeight-"), "italic and bold runs");
  assert.ok(!/\*\*|\| ---|\[Image/.test(out), "no Markdown marks are shown");
  assert.ok(out.includes("padding-left:26px"), "a nested bullet is indented");
  assert.ok(!out.includes('data-testid="vw-mode"'), "no View and Edit switch: the file is edited in Word");
  assert.ok(!out.includes("This file is empty"));
});

test("the Viewer draws a deck as slide cards, each with its number, title, words and notes; Find counts a slide's title", () => {
  const out = clean(renderToStaticMarkup(<Viewer fileId="f" title="Q4 review.pptx" kind="document" blocks={officeBlocks(DECK)} readOnly />));
  for (const n of [1, 2, 3]) assert.ok(out.includes(`data-testid="vw-slide-${n}"`), `slide ${n}`);
  assert.ok(out.includes("Where the leads come from") && out.includes("Roseville pages") && out.includes("Picture: Chart of leads"));
  assert.equal((out.match(/>Notes {2}</g) ?? []).length, 1, "the notes are labelled once");
  assert.ok(out.includes("Lead with the number.") && out.includes("Then the source."));
  assert.ok(!out.includes("# Slide") && !out.includes("Notes: "), "the markers are not on screen");
  const found = clean(renderToStaticMarkup(<Viewer fileId="f" title="Q4 review.pptx" kind="document" blocks={officeBlocks(DECK)} readOnly find="leads" />));
  assert.ok(found.includes(">2 of 3<") || found.includes(">1 of 3<"), "the title, a bullet and a table cell match");
});

/** The sample viewer with one Office file, from SharePoint when `provider` is given, answered by SharePoint for Open in. */
async function openOffice(name: string, kind: "document" | "presentation", text: string | undefined, provider?: string): Promise<Node> {
  const s = createSampleViewer();
  const row = s.rows.get("f_note")!;
  row.comments = [];
  row.data = { ...row.data, file: { ...row.data.file, name, kind, mime: "application/octet-stream", size: 18_000, ...(provider !== undefined ? { source: { mountId: "mnt_sp", provider } } : {}) }, text, canEdit: true } as ViewerData;
  const inner = s.data.call;
  const app = officeAppOf(name) ?? "Word";
  const data = { ...s.data, openUrl: () => undefined, call: async (cap: string, input: unknown): Promise<unknown> => (cap === "mounts.file_link" ? { link: { openIn: app, webUrl: "https://firm.sharepoint.com/x", type: "word", edit: [] } } : inner(cap, input)) };
  const root = await mount(createRoot, <FilesViewerDataProvider value={data}><FileViewer fileId="f_note" /></FilesViewerDataProvider>);
  await flush();
  return root;
}

test("a Word file from SharePoint opens read only, under the DOCX tile with SharePoint's mark, with Open in Word", async () => {
  const root = await openOffice("Engagement letter.docx", "document", LETTER, "SharePoint");
  const all = textOf(root);
  assert.ok(all.includes("Engagement letter") && all.includes("12 Elm Street") && all.includes("Search"), all);
  assert.ok(!all.includes("**") && !all.includes("This file is empty"));
  assert.ok(find(root, "provider-marked-sharepoint"), "the provider's mark is on the tile");
  assert.equal(textOf(find(root, "type-tile-label")).trim(), "DOCX", "the list's Word tile");
  assert.equal(textOf(find(root, "vw-open-in")).trim(), "Open in Word");
  assert.equal(find(root, "vw-mode"), null, "no Edit: a Word file is edited in Word");
});

test("a deck opens as slide cards under the PPTX tile; a password-protected or old Word file shows Open in Word, never a blank page", async () => {
  const deck = await openOffice("Q4 review.pptx", "presentation", DECK);
  assert.ok(find(deck, "vw-slide-1") && find(deck, "vw-slide-2") && find(deck, "vw-slide-3"));
  assert.equal(textOf(find(deck, "type-tile-label")).trim(), "PPTX");
  assert.ok(!textOf(deck).includes("This file is empty"));
  const locked = await openOffice("Locked.docx", "document", "");
  assert.equal(textOf(find(locked, "vw-other")).trim(), "No preview of this file here. Open in Word to see it.");
  const old = await openOffice("Old memo.doc", "document", undefined, "SharePoint");
  assert.equal(textOf(find(old, "vw-other")).trim(), "No preview of this file here. Open in Word to see it.", "from SharePoint, the same words beside the Open in Word button");
  assert.ok(find(old, "vw-open-in"));
  assert.equal(textOf(find(old, "type-tile-label")).trim(), "DOCX", "an old .doc wears the Word tile");
});
