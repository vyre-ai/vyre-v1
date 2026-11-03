// @reads /modules/files/handlers/tree.ts
// @reads /modules/files/handlers/viewer.ts
// Google-native files in Files (the rc.14 report: a Google Doc from a connected Drive opened as "This file is empty"). The file keeps Google's own type and holds an export: the viewer
// opens it at the provider first (mounts.open) and shows a Doc's Markdown, a Sheet's CSV, the words and a page of a Slides deck; files.read gives an agent the same words. A Form has no
// export: the viewer has nothing to draw but the Open in button, and a read says where it opens. Opening never creates a file. A mounted folder's source mark reaches every file under it.
import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { open } from "../fixtures/lists-world.ts";

type Obj = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
type H = (ctx: Ctx, input: unknown) => Promise<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const call = (ctx: Ctx, cap: string, input: unknown = {}) => (handlers as unknown as Record<string, H>)[cap]!(ctx, input);
const NATIVE = "application/vnd.google-apps.";

const DOC_MD = [
  "# SEO audit and keyword report",
  "",
  "Prepared for Salvo Law, October 2026\\.",
  "",
  "| Keyword | Volume |",
  "| :---- | :---- |",
  "| personal injury lawyer | 480 |",
  "",
  "![][image1]",
  "",
  "[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==>",
].join("\n");
const SHEET_CSV = "Keyword,Volume\npersonal injury lawyer,480\ncar accident attorney,320\n";
const SLIDES_TEXT = "Q4 plan\nSlide 2: budget";

interface Drive { mime: string; export?: { mime: string; text: string } }

/**
 * A Space with the files module and a stand-in for the mounts module: mounts.open "exports" the Google file into Vyre (files.write with a blob of the export's own type), as the Drive
 * mount does. Exports are staged as blobs before any test step, so a files.create seen later can only come from opening.
 */
async function world(drive: Record<string, Drive>) {
  let ctx!: Ctx;
  const opened: string[] = [];
  const seen: { cap: string; input: Obj }[] = [];
  const blobs = new Map<string, string>();
  const byFile = new Map<string, Drive>();
  const w = open((cap, input) => {
    const i = (input ?? {}) as Obj;
    seen.push({ cap, input: i });
    if (cap === "mounts.open") {
      opened.push(String(i["fileId"]));
      const d = byFile.get(String(i["fileId"]));
      if (!d?.export) return { mounted: d !== undefined, fetched: false };
      return call(ctx, "files.write", { fileId: i["fileId"], content: { blobId: blobs.get(d.export.mime + d.export.text) }, reason: "Fetched from Google Drive" }).then(() => ({ mounted: true, fetched: true }));
    }
    if (cap === "previews.text") return { text: SLIDES_TEXT, pages: 2, truncated: false, source: "pdf" };
    if (cap === "previews.get") return { ready: true, url: "/previews/slide-1.png", pages: 2 };
    const h = (handlers as unknown as Record<string, H>)[cap];
    if (!h) throw new Error(`unscripted call ${cap}`);
    return h(ctx, input);
  });
  ctx = w.ctx;
  const root = (await call(ctx, "files.tree")).roots.find((r: Obj) => r.key === "personal").folderId as string;
  const stage = (await call(ctx, "files.folder.create", { parentId: root, name: "staging", idempotencyKey: "stage" })).folder.folderId as string;
  const drv = (await call(ctx, "files.folder.create", { parentId: root, name: "My Drive", idempotencyKey: "drv" })).folder.folderId as string;
  await call(ctx, "files.folder.settings", { folderId: drv, source: { mountId: "mnt_drive", provider: "Google Drive" } });
  const ids: Record<string, string> = {};
  let n = 0;
  for (const [name, d] of Object.entries(drive)) {
    if (d.export && !blobs.has(d.export.mime + d.export.text)) {
      const f = (await call(ctx, "files.create", { folderId: stage, name: `export-${(n += 1)}`, mime: d.export.mime, content: { text: d.export.text }, idempotencyKey: `x${n}` })).file;
      blobs.set(d.export.mime + d.export.text, String((ctx.db.all("SELECT * FROM files_file WHERE id = ?", f.fileId) as Obj[])[0]!.blob));
    }
    // what the live mount makes: an empty placeholder of Google's own type
    const made = (await call(ctx, "files.create", { folderId: drv, name, kind: "google_native", mime: d.mime, idempotencyKey: `m-${name}` })).file;
    ids[name] = made.fileId;
    byFile.set(made.fileId, d);
  }
  seen.length = 0;
  return { ctx, ids, opened, seen, drv, root, events: w.events };
}

const creates = (seen: { cap: string }[]): number => seen.filter((s) => s.cap === "files.create" || s.cap === "files.folder.create").length;

test("a Google Doc opens as its words: the viewer opens it at Drive, reads the Markdown without the pictures' data, and offers no in-place edit", async () => {
  const w = await world({ "Salvo Law SEO Audit and Keyword Report (October 2026)": { mime: `${NATIVE}document`, export: { mime: "text/markdown", text: DOC_MD } } });
  const id = w.ids["Salvo Law SEO Audit and Keyword Report (October 2026)"]!;
  const v = await call(w.ctx, "files.viewer_data", { fileId: id });
  assert.deepEqual(w.opened, [id], "the viewer opened it at the provider");
  assert.equal(v.file.kind, "google_native");
  assert.equal(v.file.mime, `${NATIVE}document`, "the file is a Google Doc");
  assert.deepEqual(v.file.source, { mountId: "mnt_drive", provider: "Google Drive" }, "it carries Drive's mark");
  assert.match(v.text, /^# SEO audit and keyword report/);
  assert.match(v.text, /personal injury lawyer \| 480/);
  assert.ok(!v.text.includes("data:image"), "the picture's data is not words");
  assert.match(v.text, /\[image\]/, "the picture is named where it stood");
  assert.equal(v.canEdit, false, "a Doc is edited in Google Docs, not by saving its export over it");
  assert.equal(v.snapshot.editVia, "provider_api");
  assert.equal(creates(w.seen), 0, "opening never creates a file");
});

test("an agent reading a Doc gets the same words, and is told they are Markdown", async () => {
  const w = await world({ Plan: { mime: `${NATIVE}document`, export: { mime: "text/markdown", text: DOC_MD } } });
  const r = await call(w.ctx, "files.read", { fileId: w.ids["Plan"], as: "text" });
  assert.equal(r.mime, "text/markdown");
  assert.match(r.text, /^# SEO audit/);
  assert.ok(!r.text.includes("base64"));
  const plain = await call(w.ctx, "files.read", { fileId: w.ids["Plan"] });
  assert.ok(typeof plain.text === "string", "with no `as`, an export that is text reads as text");
  assert.equal(creates(w.seen), 0);
});

test("a Google Sheet opens as its CSV, for the viewer's table and for an agent", async () => {
  const w = await world({ Budget: { mime: `${NATIVE}spreadsheet`, export: { mime: "text/csv", text: SHEET_CSV } } });
  const v = await call(w.ctx, "files.viewer_data", { fileId: w.ids["Budget"] });
  assert.equal(v.text, SHEET_CSV);
  assert.equal((await call(w.ctx, "files.read", { fileId: w.ids["Budget"], as: "text" })).text, SHEET_CSV);
});

test("Slides open as a PDF: its words and a drawn page for the viewer, the words for an agent", async () => {
  const w = await world({ Pitch: { mime: `${NATIVE}presentation`, export: { mime: "application/pdf", text: "%PDF-1.7 not really" } } });
  const v = await call(w.ctx, "files.viewer_data", { fileId: w.ids["Pitch"] });
  assert.equal(v.text, SLIDES_TEXT);
  assert.equal(v.previewUrl, "/previews/slide-1.png");
  assert.equal(v.pages, 2);
  const r = await call(w.ctx, "files.read", { fileId: w.ids["Pitch"], as: "text" });
  assert.deepEqual([r.text, r.mime], [SLIDES_TEXT, "application/pdf"]);
});

test("a Form has no export: the viewer has nothing to draw, and a read says it opens in Google Forms rather than reading as empty", async () => {
  const w = await world({ Intake: { mime: `${NATIVE}form` } });
  const v = await call(w.ctx, "files.viewer_data", { fileId: w.ids["Intake"] });
  assert.equal(v.text, undefined);
  assert.equal(v.previewUrl, undefined);
  try { await call(w.ctx, "files.read", { fileId: w.ids["Intake"], as: "text" }); assert.fail("expected a refusal"); } catch (e) {
    assert.ok(e instanceof VyreErr);
    assert.equal(e.error.code, "validation.unsupported");
    assert.match(e.error.message, /Google Forms/);
  }
});

test("a Google file made before it kept Google's type takes it from its first export", async () => {
  const w = await world({ Old: { mime: "text/plain", export: { mime: "text/csv", text: SHEET_CSV } } });
  await call(w.ctx, "files.viewer_data", { fileId: w.ids["Old"] });
  assert.equal((await call(w.ctx, "files.get", { fileId: w.ids["Old"] })).file.mime, `${NATIVE}spreadsheet`);
});

test("a mounted folder's mark reaches every file and folder under it; taking it off, or moving out, drops it; an unchanged mark says nothing", async () => {
  const w = await world({ Plan: { mime: `${NATIVE}document` } });
  const sub = (await call(w.ctx, "files.folder.create", { parentId: w.drv, name: "Clients", idempotencyKey: "sub" })).folder;
  assert.deepEqual(sub.source, { mountId: "mnt_drive", provider: "Google Drive" });
  const inside = (await call(w.ctx, "files.create", { folderId: sub.folderId, name: "notes.md", content: { text: "hi" }, idempotencyKey: "n" })).file;
  assert.equal(inside.source?.provider, "Google Drive");
  const listed = (await call(w.ctx, "files.list", { folder: sub.folderId })).files[0];
  assert.equal(listed.source?.provider, "Google Drive", "the list rows carry it");
  const moved = (await call(w.ctx, "files.move", { fileId: inside.fileId, toFolderId: w.root })).file;
  assert.equal(moved.source, undefined, "a file moved out of the mount is Vyre's own");
  const before = w.events.filter((e) => e.name === "folder.settings_changed").length;
  await call(w.ctx, "files.folder.settings", { folderId: w.drv, source: { mountId: "mnt_drive", provider: "Google Drive" } });
  assert.equal(w.events.filter((e) => e.name === "folder.settings_changed").length, before, "the same mark again changes nothing");
  await call(w.ctx, "files.folder.settings", { folderId: w.drv, source: null });
  assert.equal((await call(w.ctx, "files.get", { fileId: w.ids["Plan"] })).file.source, undefined);
  await assert.rejects(call(w.ctx, "files.folder.settings", { folderId: w.drv, source: { mountId: "mnt_x" } }), (e: unknown) => e instanceof VyreErr && e.error.code === "validation.bad_input");
});
