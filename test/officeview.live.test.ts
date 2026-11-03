// @reads /modules/files/handlers/viewer.ts
// @reads /modules/files/handlers/tree.ts
// @reads /modules/previews/handlers/render.ts
// @reads /modules/previews/handlers/ooxml.ts
// @reads /modules/mounts/handlers/engine.ts
// Office files from a SharePoint library (rc.17, Office files in the viewer). The files, previews and mounts modules are live, each over its own tables; only Microsoft Graph is a stand-in that
// serves a library with a Word file, a deck, a password-protected Word file and an old .doc. Opening a file in the viewer fetches the current copy from SharePoint (mounts.open) and shows its words
// with their shape; an agent's files.read gets the same Markdown; what cannot be read is refused in words with Open in Word, never handed back as bytes or as nothing. No converter is on the server.
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../packages/contracts/src/ctx.ts";
import { VyreErr } from "../packages/contracts/src/errors.ts";
import { handlers as filesHandlers, putUploadedBytes } from "../modules/files/impl.ts";
import { open } from "../modules/files/fixtures/lists-world.ts";
import { handlers as previewsHandlers } from "../modules/previews/impl.ts";
import { configurePreviews } from "../modules/previews/handlers/index.ts";
import { MemoryDb as PreviewsDb } from "../modules/previews/fixtures/db.ts";
import { zip } from "../modules/previews/fixtures/make.ts";
import { handlers as mountsHandlers } from "../modules/mounts/impl.ts";
import { MemoryDb as MountsDb } from "../modules/mounts/fixtures/db.ts";

type Obj = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
type H = (ctx: Ctx, input: unknown) => Promise<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

// ---- the library's files, built here -----------------------------------------------------------------------

const W = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="x" xmlns:a="x" xmlns:pic="x"`;
const p = (inner: string, ppr = ""): string => `<w:p>${ppr === "" ? "" : `<w:pPr>${ppr}</w:pPr>`}${inner}</w:p>`;
const r = (text: string, rpr = ""): string => `<w:r>${rpr === "" ? "" : `<w:rPr>${rpr}</w:rPr>`}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const tc = (text: string): string => `<w:tc>${p(r(text))}</w:tc>`;
const LETTER = zip({
  "[Content_Types].xml": "<Types/>",
  "word/styles.xml": `<w:styles ${W}><w:style w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
  "word/numbering.xml": `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
  "word/document.xml": `<w:document ${W}><w:body>${[
    p(r("Engagement letter"), `<w:pStyle w:val="Title"/>`),
    p(`${r("Dear Ms Lin, we act for you in the sale of ")}${r("12 Elm Street", "<w:b/>")}${r(".")}`),
    p(r("Fees"), `<w:pStyle w:val="Heading1"/>`),
    p(r("Title search"), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`),
    p(r("Closing"), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`),
    `<w:tbl><w:tr>${tc("Item")}${tc("Cost")}</w:tr><w:tr>${tc("Search")}${tc("$120")}</w:tr></w:tbl>`,
    p(`<w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1" descr="Signature"/><a:graphic><a:graphicData><pic:pic><a:blip r:embed="rId9"/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`),
  ].join("")}</w:body></w:document>`,
});
const LETTER_MD = [
  "# Engagement letter",
  "Dear Ms Lin, we act for you in the sale of **12 Elm Street**.",
  "# Fees",
  "- Title search\n- Closing",
  "| Item | Cost |\n| --- | --- |\n| Search | $120 |",
  "[Image: Signature]",
].join("\n\n");
const sp = (ph: string, paras: string[]): string => `<p:sp><p:nvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:txBody>${paras.map((x) => `<a:p><a:r><a:t>${x}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>`;
const sld = (...shapes: string[]): string => `<p:sld><p:cSld><p:spTree>${shapes.join("")}</p:spTree></p:cSld></p:sld>`;
const DECK = zip({
  "[Content_Types].xml": "<Types/>",
  "ppt/slides/slide1.xml": sld(sp(`<p:ph type="ctrTitle"/>`, ["Q4 review"]), sp(`<p:ph type="subTitle" idx="1"/>`, ["Salvo Law"])),
  "ppt/slides/slide2.xml": sld(sp(`<p:ph type="title"/>`, ["Leads"]), sp(`<p:ph idx="1"/>`, ["Search: 48", "Referrals: 21"]), sp(`<p:ph type="sldNum" idx="12"/>`, ["2"])),
  "ppt/slides/_rels/slide2.xml.rels": `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide2.xml"/></Relationships>`,
  "ppt/notesSlides/notesSlide2.xml": `<p:notes><p:cSld><p:spTree>${sp(`<p:ph type="body" idx="1"/>`, ["Lead with search."])}</p:spTree></p:cSld></p:notes>`,
});
function encrypted(): Uint8Array {
  const b = new Uint8Array(4096);
  b.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  b.set(Buffer.from("EncryptedPackage", "utf16le"), 1024);
  return b;
}
const LEGACY = (() => { const b = new Uint8Array(2048); b.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); b.set(Buffer.from("WordDocument", "utf16le"), 1024); return b; })();

const T = "2026-10-30T09:00:00Z";
const LIBRARY: { id: string; name: string; bytes: Uint8Array }[] = [
  { id: "sp1", name: "Engagement letter.docx", bytes: LETTER },
  { id: "sp2", name: "Q4 review.pptx", bytes: DECK },
  { id: "sp3", name: "Locked.docx", bytes: encrypted() },
  { id: "sp4", name: "Old memo.doc", bytes: LEGACY },
];

// ---- the Space: files, previews and mounts live; Graph is a stand-in ------------------------------------------

const handlerOf = (cap: string): H | undefined => ((cap.startsWith("previews.") ? previewsHandlers : cap.startsWith("mounts.") ? mountsHandlers : filesHandlers) as unknown as Record<string, H>)[cap];

async function space() {
  const filesDb = open().db;
  const previewsDb = new PreviewsDb();
  const mountsDb = new MountsDb();
  const route = (sql: string): Ctx["db"] => {
    const table = /\b(?:FROM|INTO|UPDATE)\s+"?(\w+)/i.exec(sql)?.[1] ?? "";
    return table.startsWith("previews_") ? (previewsDb as unknown as Ctx["db"]) : table.startsWith("mounts_") ? (mountsDb as unknown as Ctx["db"]) : filesDb;
  };
  const db: Ctx["db"] = { all: (sql, ...a) => route(sql).all(sql, ...a), run: (sql, ...a) => route(sql).run(sql, ...a) };
  const graph: { cap: string; input: Obj }[] = [];
  let ctx!: Ctx;
  const blobFor = async (bytes: Uint8Array): Promise<string> => {
    const slot = await (filesHandlers as unknown as Record<string, H>)["files.upload_url"]!(ctx, { size: bytes.length, mime: "application/octet-stream" });
    const token = new URL(String(slot.url), "http://vyred").searchParams.get("token") ?? "";
    await putUploadedBytes(ctx as never, String(slot.blobId), token, Buffer.from(bytes));
    return String(slot.blobId);
  };
  const ms = async (cap: string, i: Obj): Promise<unknown> => {
    graph.push({ cap, input: i });
    const item = (f: (typeof LIBRARY)[number]) => ({ id: f.id, name: f.name, size: f.bytes.length, parentId: "root", eTag: `"${f.id}-1"`, lastModifiedDateTime: T, webUrl: `https://firm.sharepoint.com/sites/matters/Shared%20Documents/${encodeURIComponent(f.name)}` });
    if (cap === "ms.consent.my_account") return { email: "maya@firm.test" };
    if (cap === "ms.drive.delta") return i["deltaLink"] === "dl1" ? { changed: [], removed: [], deltaLink: "dl1" } : { changed: [{ id: "root", name: "root", folder: true }, ...LIBRARY.map(item)], removed: [], deltaLink: "dl1" };
    if (cap === "ms.drive.get_item") { const f = LIBRARY.find((x) => x.id === i["itemId"]); if (!f) throw new Error(`no item ${String(i["itemId"])}`); return { item: item(f) }; }
    if (cap === "ms.drive.download_item") { const f = LIBRARY.find((x) => x.id === i["itemId"])!; return { blobId: await blobFor(f.bytes), size: f.bytes.length }; }
    if (cap === "ms.drive.subscribe") return { subscriptionId: "sub1", expiresAt: Date.now() + 86_400_000 };
    throw new Error(`unscripted Graph call ${cap}`);
  };
  const w = open(async (cap, input) => {
    const i = (input ?? {}) as Obj;
    if (cap.startsWith("ms.")) return ms(cap, i);
    if (cap === "settings.get") return { row: { key: i["key"], value: i["key"] === "files.review_changes" ? { git: true, cloud_mount: false, plain: false } : undefined } };
    const h = handlerOf(cap);
    if (!h) throw new Error(`unscripted call ${cap}`);
    return h(ctx, input);
  });
  ctx = { ...w.ctx, db };
  // no converter on the server: a page image is never made, and the words come from the file itself
  configurePreviews({ exec: async () => ({ code: 127, stdout: "", stderr: "not found" }) });
  const call = (cap: string, input: Obj = {}, as: Ctx = ctx): Promise<Obj> => {
    const h = handlerOf(cap);
    if (!h) throw new Error(`no handler for ${cap}`);
    return h(as, input) as Promise<Obj>;
  };
  const root = (await call("files.tree")).roots.find((x: Obj) => x.key === "personal").folderId as string;
  const into = (await call("files.folder.create", { parentId: root, name: "Client matters", idempotencyKey: "into" })).folder.folderId as string;
  const added = await call("mounts.add", { into, source: { kind: "sharepoint", connectionId: "con_m", ref: "drv1" }, name: "Client matters" });
  const fileOf = (name: string): string => {
    const row = (filesDb.rows("files_file") as Obj[]).find((x) => x["name"] === name && (x["deleted_at"] === null || x["deleted_at"] === undefined));
    assert.ok(row, `${name} is in Files`);
    return String(row["id"]);
  };
  const agent: Ctx = { ...ctx, principal: { kind: "agent", id: "agt_research" } };
  return { ctx, agent, call, graph, fileOf, mountId: String(added["mountId"]), downloads: () => graph.filter((g) => g.cap === "ms.drive.download_item").map((g) => String(g.input["itemId"])) };
}

async function refused(run: () => Promise<unknown>, code: string, words: RegExp): Promise<void> {
  try { await run(); } catch (e) {
    assert.ok(e instanceof VyreErr, String(e));
    assert.equal(e.error.code, code, e.error.message);
    assert.match(e.error.message, words);
    return;
  }
  assert.fail("expected a refusal");
}

test("a Word file in a SharePoint library opens in the viewer with its words and their shape, fetched from SharePoint first", async () => {
  const s = await space();
  const id = s.fileOf("Engagement letter.docx");
  assert.deepEqual(s.downloads(), [], "a live library leaves placeholders: nothing is downloaded until a file is opened");
  const v = await s.call("files.viewer_data", { fileId: id });
  assert.deepEqual(s.downloads(), ["sp1"], "opening fetched the current copy");
  assert.equal(v.file.kind, "document");
  assert.equal(v.file.source?.provider, "SharePoint");
  assert.equal(v.text, LETTER_MD);
  const link = await s.call("mounts.file_link", { fileId: id });
  assert.equal(link.link.openIn, "Word");
  assert.match(link.link.webUrl, /^https:\/\/firm\.sharepoint\.com\//);
});

test("an agent's files.read of the SharePoint Word file gets the same Markdown, and of the deck one block per slide with its notes", async () => {
  const s = await space();
  const letter = await s.call("files.read", { fileId: s.fileOf("Engagement letter.docx"), as: "text" }, s.agent);
  assert.equal(letter.text, LETTER_MD);
  assert.equal(letter.truncated, false);
  const deck = await s.call("files.read", { fileId: s.fileOf("Q4 review.pptx"), as: "text" }, s.agent);
  assert.equal(deck.text, "# Slide 1: Q4 review\n\nSalvo Law\n\n# Slide 2: Leads\n\n- Search: 48\n- Referrals: 21\n\nNotes: Lead with search.");
  const page = await s.call("previews.text", { fileId: s.fileOf("Q4 review.pptx"), page: 2 }, s.agent);
  assert.equal(page.text, "# Slide 2: Leads\n\n- Search: 48\n- Referrals: 21\n\nNotes: Lead with search.", "one slide is one page");
  assert.deepEqual(s.downloads().sort(), ["sp1", "sp2"], "reading a placeholder opens it first");
  const v = await s.call("files.viewer_data", { fileId: s.fileOf("Q4 review.pptx") });
  assert.equal(v.file.kind, "presentation");
  assert.equal(v.pages, 2);
  assert.match(v.text, /^# Slide 1: Q4 review/);
});

test("a password-protected Word file and an old .doc with no converter open as no preview, and a read is refused in words with Open in Word", async () => {
  const s = await space();
  const locked = s.fileOf("Locked.docx");
  const lv = await s.call("files.viewer_data", { fileId: locked });
  assert.equal(lv.text ?? "", "", "no words: the viewer shows its quiet no-preview line, never the bytes");
  await refused(() => s.call("files.read", { fileId: locked, as: "text" }, s.agent), "validation.unsupported", /^This file is password-protected, so its text cannot be read\. Open it in Word\.$/);
  const memo = s.fileOf("Old memo.doc");
  const mv = await s.call("files.viewer_data", { fileId: memo });
  assert.deepEqual([mv.file.kind, mv.file.mime], ["document", "application/msword"], "a mounted .doc is a Word file, not text");
  assert.equal(mv.text ?? "", "");
  await refused(() => s.call("files.read", { fileId: memo, as: "text" }, s.agent), "validation.unsupported", /cannot be read here right now\. Open it in Word\.$/);
  const bytes = await s.call("files.read", { fileId: locked }, s.agent);
  assert.ok(typeof bytes.base64 === "string" && bytes.text === undefined, "the bytes are still there for whoever asks for them");
});
