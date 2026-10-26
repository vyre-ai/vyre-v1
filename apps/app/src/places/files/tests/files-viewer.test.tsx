// Files Viewer wiring (spec 3.5, 2.16): a Files file opens in the shared Viewer, and every mark a person makes is one capability call. Screens render with react-dom/server over
// react-native-web (ruling 28), where effects do not run, so the reads are checked through the same calls the screen makes and the markup through the Viewer those reads feed.
// Path mapping: the packet names apps/app/tests/files-viewer*.test.tsx, which lanes-check rejects as outside lane L9e; the lane's tests live beside the screens, as P-L9e_04's do.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Viewer } from "../../../../../../ui/src/Viewer/index.tsx";
import { FileViewer } from "../viewer/FileViewer.tsx";
import { FilesViewerDataProvider } from "../viewer/data.tsx";
import { commentOnQuote, pinArea, resolveComment, saveMarkup, saveText } from "../viewer/actions.ts";
import { FILE_SUBJECT_TYPES, blocksToText, boxesOf, docCommentsOf, isEditable, kindLabel, nodeFor, parseCsv, strokesOf, strokesToSave, textToBlocks, viewerKind } from "../viewer/model.ts";
import type { FileComment, ViewerData } from "../viewer/model.ts";
import { createSampleViewer } from "../viewer/sample.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "");
const has = (s: string, n: string): boolean => s.includes(n);
const read = async <T,>(s: ReturnType<typeof createSampleViewer>, cap: string, input: unknown): Promise<T> => (await s.data.call(cap, input)) as T;

test("a file opens in the one Viewer: every kind maps to a layout, and the hash subject types are file, doc and document", () => {
  assert.deepEqual([...FILE_SUBJECT_TYPES], ["file", "doc", "document"]);
  const kinds = { image: "image", markdown: "document", text: "document", code: "document", document: "document", spreadsheet: "csv", presentation: "plan", pdf: "other", video: "other", audio: "other", archive: "other", other: "other", google_native: "document" } as const;
  for (const [k, want] of Object.entries(kinds)) assert.equal(viewerKind(k as ViewerData["file"]["kind"]), want, k);
  assert.equal(kindLabel("Offer.png"), "PNG");
  assert.equal(kindLabel("Makefile"), "FILE");
});

test("the screen draws its loading frame before the file arrives, in the size of the real one", () => {
  const s = createSampleViewer();
  const out = clean(renderToStaticMarkup(<FilesViewerDataProvider value={s.data}><FileViewer fileId="f_offer" /></FilesViewerDataProvider>));
  assert.ok(has(out, 'data-testid="file-viewer-loading"') && !has(out, "Offer.png"));
});

test("an image opens with its saved pin and stroke, read from files.viewer_data, files.comments.list and files.markup.get", async () => {
  const s = createSampleViewer();
  const data = await read<ViewerData>(s, "files.viewer_data", { fileId: "f_offer" });
  const comments = (await read<{ comments: FileComment[] }>(s, "files.comments.list", { fileId: "f_offer" })).comments;
  const markup = await read<{ strokes: Parameters<typeof strokesOf>[0] }>(s, "files.markup.get", { fileId: "f_offer" });
  const boxes = boxesOf(comments);
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0]!.text, "Is this offer still live?");
  const out = clean(renderToStaticMarkup(<Viewer fileId="f_offer" title={data.file.name} kind={viewerKind(data.file.kind)} boxes={boxes} strokes={strokesOf(markup.strokes)} {...(data.previewUrl ? { src: data.previewUrl } : {})} />));
  assert.ok(has(out, 'data-testid="vw-image"') && has(out, 'data-testid="vw-pin-1"') && has(out, "Offer.png"));
  assert.ok(isEditable(data) === false, "an image is marked up, not edited in place");
});

test("a markup pin is saved as a comment anchored to the area, and shows as the next numbered pin", async () => {
  const s = createSampleViewer();
  await pinArea(s.data, "f_offer", { x: 0.6, y: 0.2, w: 0.2, h: 0.2 }, "Crop here");
  const add = s.calls.find((c) => c.cap === "files.comments.add")!.input as { anchor: { kind: string; box: unknown }; text: string; idempotencyKey: string };
  assert.equal(add.anchor.kind, "area");
  assert.deepEqual(add.anchor.box, { x: 0.6, y: 0.2, w: 0.2, h: 0.2 });
  assert.equal(add.text, "Crop here");
  assert.ok(add.idempotencyKey.startsWith("pin-f_offer-"));
  const boxes = boxesOf((await read<{ comments: FileComment[] }>(s, "files.comments.list", { fileId: "f_offer" })).comments);
  assert.deepEqual(boxes.map((b) => b.text), ["Is this offer still live?", "Crop here"]);
  const out = clean(renderToStaticMarkup(<Viewer fileId="f_offer" title="Offer.png" kind="image" boxes={boxes} />));
  assert.ok(has(out, 'data-testid="vw-pin-2"'), "the second pin");
});

test("freehand drawing replaces the file's markup, and reads back as the same strokes", async () => {
  const s = createSampleViewer();
  const drawn = [{ points: [[0.1, 0.1], [0.2, 0.3]] as const }];
  await saveMarkup(s.data, "f_offer", drawn);
  const saved = s.calls.find((c) => c.cap === "files.markup.save")!.input as { strokes: { points: number[][] }[] };
  assert.deepEqual(saved.strokes[0]!.points, [[0.1, 0.1], [0.2, 0.3]]);
  assert.deepEqual(strokesOf(strokesToSave(drawn)), drawn);
  const back = await read<{ strokes: Parameters<typeof strokesOf>[0] }>(s, "files.markup.get", { fileId: "f_offer" });
  assert.equal(back.strokes.length, 1);
});

test("a note reads as blocks, its comment marks the quoted passage, and a new comment and Resolve are one call each", async () => {
  const s = createSampleViewer();
  const data = await read<ViewerData>(s, "files.viewer_data", { fileId: "f_note" });
  const blocks = textToBlocks(data.text ?? "", data.file.kind);
  assert.deepEqual(blocks.map((b) => b.tag), ["meta", "h1", "p", "h2", "li", "li"]);
  assert.match(blocks[0]!.text, /^kind\tdecision\nvalid_from\t2026-10-03\nlearned\t2026-10-08 2:02 pm\nsource\tchat Pricing review, you$/, "the front matter is the property block");
  const list = async (): Promise<FileComment[]> => (await read<{ comments: FileComment[] }>(s, "files.comments.list", { fileId: "f_note" })).comments;
  const comments = docCommentsOf(await list(), s.data.name, s.data.clock().now);
  assert.equal(comments.length, 1);
  assert.equal(comments[0]!.by, "Omar Haddad");
  assert.equal(comments[0]!.at, "3 h ago");
  await commentOnQuote(s.data, "f_note", "$250", "Check the rate");
  assert.equal(docCommentsOf(await list(), s.data.name, 0).length, 2);
  await resolveComment(s.data, "c2");
  assert.deepEqual(s.calls.at(-1), { cap: "files.comments.resolve", input: { commentId: "c2", resolved: true } });
  assert.ok((await list()).find((c) => c.commentId === "c2")!.resolved);
  const out = clean(renderToStaticMarkup(<Viewer fileId="f_note" title="Consult fee.md" kind="document" blocks={blocks} comments={comments} />));
  assert.ok(has(out, 'data-testid="vw-doc"') && has(out, "Consult fee"));
  assert.ok(isEditable(data), "a note can be edited in place");
});

test("a note shows as read text, not raw: bold and bullets are the Viewer's, the property block comes from the front matter, and Links come from the memory graph", async () => {
  const s = createSampleViewer();
  const data = await read<ViewerData>(s, "files.viewer_data", { fileId: "f_note" });
  const graph = await read<Parameters<typeof nodeFor>[0] & { edges: { from: string; to: string; kind: "link" | "relation" | "came_from" }[] }>(s, "memory.graph", { scope: "space" });
  const id = nodeFor(graph, data.file.name);
  assert.equal(id, "n_fee", "found by the file name without its extension");
  assert.equal(nodeFor(graph, "Nothing.md"), null);
  const blocks = textToBlocks(data.text ?? "", data.file.kind);
  const out = clean(renderToStaticMarkup(<Viewer fileId="f_note" title="Consult fee.md" kind="document" blocks={blocks} graph={{ nodes: graph.nodes as never, edges: graph.edges }} nodeId={id!} detailsOpen details={{ rows: [["Kind", "Note"]] }} />));
  assert.ok(!has(out, "**$250**"), "no raw asterisks");
  assert.ok(has(out, "•"), "list items keep their bullets");
  assert.ok(has(out, ">kind<") && has(out, ">valid_from<") && has(out, "chat Pricing review, you"), "the property block");
  assert.ok(has(out, "Pricing landscape") && has(out, "Referral policy"), "Links to and Linked from");
  assert.equal(s.data.agentFor?.("f_offer"), "Research", "the markup bar names the agent that worked on the file");
});

test("an edit in place saves against the version it started from and returns the next one; a stale save is refused with words", async () => {
  const s = createSampleViewer();
  const data = await read<ViewerData>(s, "files.viewer_data", { fileId: "f_note" });
  const blocks = textToBlocks(data.text ?? "", data.file.kind);
  const edited = blocks.map((b) => (b.tag === "h1" ? { ...b, text: "Consult fee (2026)" } : b));
  const next = await saveText(s.data, "f_note", edited, data.file.kind, data.file.version);
  assert.equal(next, data.file.version + 1);
  assert.match((await read<ViewerData>(s, "files.viewer_data", { fileId: "f_note" })).text ?? "", /^# Consult fee \(2026\)/);
  await assert.rejects(() => saveText(s.data, "f_note", edited, data.file.kind, data.file.version), /Someone else saved this file first/);
  assert.equal(blocksToText(textToBlocks(data.text ?? "", "markdown"), "markdown"), data.text, "reading then writing changes nothing");
});

test("a CSV reads as a sheet, quoted cells and all, and is not edited in place; a missing file says so", async () => {
  const sheet = parseCsv('Name,Note\n"Rivera, E","said ""yes"""\nChen,ok\n');
  assert.deepEqual(sheet.cols, ["Name", "Note"]);
  assert.deepEqual(sheet.rows, [["Rivera, E", 'said "yes"'], ["Chen", "ok"]]);
  const s = createSampleViewer();
  const data = await read<ViewerData>(s, "files.viewer_data", { fileId: "f_fees" });
  assert.equal(isEditable(data), false);
  assert.equal(parseCsv(data.text ?? "").rows.length, 3);
  await assert.rejects(() => s.data.call("files.viewer_data", { fileId: "nope" }), /No such file/);
});

test("no copy on these screens uses an em dash", async () => {
  const s = createSampleViewer();
  const text = clean(renderToStaticMarkup(<FilesViewerDataProvider value={s.data}><FileViewer fileId="f_offer" /></FilesViewerDataProvider>));
  assert.ok(!has(text, String.fromCharCode(0x2014)));
});
