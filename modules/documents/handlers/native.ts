// documents: the Vyre document as a template (lane r42-docs). A Markdown file marked as a template fills by the same rules as a Word one (vdoc.ts) and comes out as a PDF set in
// process (typeset.ts), so a Space with nothing installed goes from a template to a signature. The same handlers answer for both kinds: the template's name says which engine reads it.
// A PDF made here remembers where its signers sign ({sign:role} in the text): documents.signing answers it, and built-in signing asks for it when a send names no places.
// @reads ../migrations/0003_documents_signing.sql

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import {
  FillError,
  addTemplateReader,
  askDigest,
  askKey,
  baseName,
  documentsFill,
  fail,
  fieldsOf,
  kindOf,
  mayView,
  optStr,
  previewFill,
  rec,
  refuse,
  reqStr,
  saveNamed,
  sha256Of,
  templateBytes,
  unusedFor,
  valuesOf,
} from "./fill.ts";
import type { Excerpt } from "./fill.ts";
import { TypesetError, typeset } from "./typeset.ts";
import type { Place } from "./typeset.ts";
import { mdExcerpt, mdPlaceholders, mdRender, parse, textOf } from "./vdoc.ts";
import type { Asked } from "./vdoc.ts";

type Row = Record<string, unknown>;
interface FieldRow {
  name: string;
  kind: string;
  required: boolean;
  loop?: string;
}
interface Fields {
  fields: FieldRow[];
  loops: string[];
  problems: { message: string; tag?: string }[];
  /** the signer roles a Vyre document names with {sign:role}, in signing order */
  signers?: string[];
}
interface Saved {
  fileId: string;
  name: string;
  versionId: string;
}
interface Filled {
  file: Saved;
  missing: string[];
  unused: string[];
  signers?: string[];
  layout?: "word" | "simple";
  converter?: "pulling" | "failed" | "none";
}

/** A Vyre document is a Markdown file. */
export const isVyreDoc = (name: string): boolean => /\.(md|markdown)$/i.test(name);

addTemplateReader({ test: isVyreDoc, asked: (bytes) => mdPlaceholders(textOf(bytes)) });

/** The version of a file now, so a template edited since the last ask is a different ask. */
async function fileVersion(ctx: Ctx, fileId: string): Promise<unknown> {
  const got = (await ctx.call("files.get", { fileId })) as { file?: { version?: unknown } };
  return got.file?.version;
}

async function fileName(ctx: Ctx, fileId: string): Promise<string> {
  const got = (await ctx.call("files.get", { fileId })) as { file?: { name?: unknown } };
  return typeof got.file?.name === "string" ? got.file.name : "";
}

/** The text of a Vyre document and what it asks for; a template that cannot be read is refused in the engine's own words. */
async function read(ctx: Ctx, fileId: string): Promise<{ text: string; asked: Asked }> {
  const bytes = await templateBytes(ctx, fileId);
  try {
    const text = textOf(bytes);
    return { text, asked: mdPlaceholders(text) };
  } catch (e) {
    return refuse(ctx, e);
  }
}

async function fields(ctx: Ctx, input: unknown): Promise<Fields> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "templateFileId");
  if (!isVyreDoc(await fileName(ctx, fileId))) return fieldsOf(ctx, input);
  const bytes = await templateBytes(ctx, fileId);
  let asked: Asked;
  try {
    asked = mdPlaceholders(textOf(bytes));
  } catch (e) {
    if (e instanceof FillError && e.code === "bad_template")
      return { fields: [], loops: [], problems: [{ message: `${e.message}.` }] };
    return refuse(ctx, e);
  }
  const out: FieldRow[] = [];
  for (const name of asked.names) out.push({ name, kind: kindOf(name), required: true });
  for (const loop of asked.loops) {
    out.push({ name: loop, kind: "loop", required: true });
    for (const leaf of asked.loopLeaves[loop] ?? []) out.push({ name: leaf, kind: kindOf(leaf), required: true, loop });
  }
  for (const c of asked.conditions) out.push({ name: c, kind: "condition", required: false });
  return { fields: out, loops: asked.loops, problems: [], ...(asked.roles.length > 0 ? { signers: asked.roles } : {}) };
}

async function preview(
  ctx: Ctx,
  input: unknown,
): Promise<{ excerpt: Excerpt[]; missing: string[]; unused: string[]; digest: string }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "templateFileId");
  if (!isVyreDoc(await fileName(ctx, fileId))) return previewFill(ctx, input);
  const { text, asked } = await read(ctx, fileId);
  const { values, given } = await valuesOf(ctx, o, asked);
  try {
    const got = mdExcerpt(text, values);
    return { ...got, unused: unusedFor(asked, given), ...(await askDigest(new TextEncoder().encode(text), values)) };
  } catch (e) {
    return refuse(ctx, e);
  }
}

/** Blocks to a PDF; a letter the fonts cannot draw is refused in plain words. */
async function setPages(ctx: Ctx, blocks: ReturnType<typeof parse>, title: string) {
  try {
    return await typeset(blocks, { title });
  } catch (e) {
    if (e instanceof TypesetError)
      return fail(ctx, "validation.unsupported", `${e.message.replace(/^the document/, "The document")}.`, {
        letters: e.letters,
      });
    throw e;
  }
}

function remember(
  ctx: Ctx,
  saved: Saved,
  roles: string[],
  places: Place[],
  from: { templateFileId?: string | undefined; recordId?: string | undefined },
): void {
  if (roles.length === 0) return;
  ctx.db.run(
    "INSERT OR REPLACE INTO documents_signing (file_id, roles, places, version_id, template_file_id, record_id, made_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    saved.fileId,
    JSON.stringify(roles),
    JSON.stringify(places),
    saved.versionId,
    from.templateFileId ?? null,
    from.recordId ?? null,
    ctx.now(),
  );
}

async function fill(ctx: Ctx, input: unknown): Promise<Filled> {
  const o = rec(ctx, input);
  const templateFileId = reqStr(ctx, o, "templateFileId");
  const asked0 = optStr(ctx, o, "format");
  if (asked0 !== undefined && !["docx", "pdf", "md"].includes(asked0))
    fail(ctx, "validation.bad_input", "The format is docx, pdf or md.", { field: "format" });
  const templateName = await fileName(ctx, templateFileId);
  if (!isVyreDoc(templateName)) return documentsFill(ctx, input);
  const intoFolderId = reqStr(ctx, o, "intoFolderId");
  const format = asked0 ?? "pdf";
  if (format !== "pdf" && format !== "md")
    fail(
      ctx,
      "validation.unsupported",
      "A Vyre document fills to a PDF, or to a document you can go on editing (md). Word is for Word templates.",
      { field: "format" },
    );
  const { text, asked } = await read(ctx, templateFileId);
  const { values, given } = await valuesOf(ctx, o, asked);
  let made: ReturnType<typeof mdRender>;
  try {
    made = mdRender(text, values);
    if (made.missing.length > 0)
      throw new FillError(
        "missing_values",
        `the document was not made: ${made.missing.length === 1 ? "this value is" : "these values are"} missing: ${made.missing.join(", ")}`,
        made.missing,
      );
  } catch (e) {
    return refuse(ctx, e);
  }
  const wanted = optStr(ctx, o, "name");
  const stem =
    wanted !== undefined ? wanted.replace(new RegExp(`\\.${format}$`, "i"), "") : `${baseName(templateName)} (filled)`;
  const recordId = optStr(ctx, o, "recordId");
  const key = `docfill:${optStr(ctx, o, "idempotencyKey") ?? `${templateFileId}:${await askKey([values, o.signingDate, o.name, format, await fileVersion(ctx, templateFileId), intoFolderId, ctx.actingFor ?? ctx.principal.id, o.recordId])}`}`;
  let saved: Saved;
  let signers: string[] = [];
  if (format === "pdf") {
    const set = await setPages(ctx, made.blocks, stem);
    saved = await saveNamed(ctx, {
      folderId: intoFolderId,
      stem,
      ext: "pdf",
      bytes: set.pdf,
      mime: "application/pdf",
      kind: "pdf",
      key,
    });
    remember(ctx, saved, set.roles, set.places, { templateFileId, recordId });
    signers = set.roles;
  } else {
    saved = await saveNamed(ctx, {
      folderId: intoFolderId,
      stem,
      ext: "md",
      bytes: new TextEncoder().encode(made.markdown),
      mime: "text/markdown",
      kind: "markdown",
      key,
    });
    signers = made.roles;
  }
  ctx.emit("document.filled", `file/${saved.fileId}`, {
    fileId: saved.fileId,
    templateFileId,
    fields: made.used.length,
    missing: 0,
    ...(recordId !== undefined ? { recordId } : {}),
  });
  ctx.log.info("documents.fill", { fileId: saved.fileId, templateFileId, fields: made.used.length, format });
  return {
    file: saved,
    missing: [],
    unused: unusedFor(asked, given),
    ...(signers.length > 0 ? { signers } : {}),
  };
}

/** A Vyre document as a PDF beside it (or in the folder named). A blank still in the text stops it: a PDF is what goes out, and nothing goes out half filled. */
async function makePdf(ctx: Ctx, input: unknown): Promise<{ file: Saved; pages: number; signers?: string[] }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const intoFolderId = reqStr(ctx, o, "intoFolderId");
  const name = await fileName(ctx, fileId);
  if (!isVyreDoc(name))
    fail(ctx, "validation.unsupported", "Only a Vyre document (.md) can be made into a PDF here.", { fileId });
  const { text, asked } = await read(ctx, fileId);
  const open = [...asked.names, ...asked.loops];
  if (open.length > 0)
    fail(
      ctx,
      "validation.precondition_failed",
      `The PDF was not made: this document still has ${open.length === 1 ? "a blank" : "blanks"} to fill: ${open.join(", ")}.`,
      { missing: open },
    );
  const wanted = optStr(ctx, o, "name");
  const stem = wanted !== undefined ? wanted.replace(/\.pdf$/i, "") : baseName(name);
  const set = await setPages(ctx, parse(text), stem);
  const saved = await saveNamed(ctx, {
    folderId: intoFolderId,
    stem,
    ext: "pdf",
    bytes: set.pdf,
    mime: "application/pdf",
    kind: "pdf",
    key: `docpdf:${optStr(ctx, o, "idempotencyKey") ?? `${fileId}:${await askKey([o.name, text, intoFolderId, ctx.actingFor ?? ctx.principal.id])}`}`,
  });
  remember(ctx, saved, set.roles, set.places, {});
  ctx.log.info("documents.make_pdf", { fileId: saved.fileId, from: fileId, pages: set.pages });
  return { file: saved, pages: set.pages, ...(set.roles.length > 0 ? { signers: set.roles } : {}) };
}

/** Where the signers of a PDF made here sign. A file made anywhere else has no places: signing then adds its own signature page. */
/** The most a file may weigh for the plain check to read it (esign takes 25 MB PDFs at most). */
const MAX_CHECK_BYTES = 25 * 1024 * 1024;
async function signing(
  ctx: Ctx,
  input: unknown,
): Promise<{
  signers: string[];
  places: unknown[];
  stale?: true;
  plain?: true;
  unchecked?: true;
  templateFileId?: string;
  recordId?: string;
}> {
  const fileId = reqStr(ctx, rec(ctx, input), "fileId");
  mayView(ctx, fileId);
  // a preview set in the plain page look is known by its bytes: a copy, a move or a re-upload of them is held too. A file that cannot be checked (too big to read whole, unreadable just now) is
  // answered `unchecked`, never "not plain": the sender then chooses (make the exact copy again, or send it anyway).
  let plain = false;
  let unchecked = false;
  if ((ctx.db.all("SELECT 1 AS x FROM documents_plain LIMIT 1") as Row[]).length > 0) {
    try {
      const got = (await ctx.call("files.get", { fileId })) as { file?: { size?: unknown; version?: unknown } };
      const size = typeof got.file?.size === "number" ? got.file.size : 0;
      const ver = String(got.file?.version);
      const seen =
        (ctx.db.all("SELECT 1 AS x FROM documents_plain_seen WHERE file_id = ? AND version = ?", fileId, ver) as Row[])
          .length > 0;
      if (seen) plain = true;
      else if (size > MAX_CHECK_BYTES) unchecked = true;
      else {
        const sha = await sha256Of(await templateBytes(ctx, fileId));
        plain = (ctx.db.all("SELECT 1 AS x FROM documents_plain WHERE sha256 = ?", sha) as Row[]).length > 0;
        // only a "yes" is kept: a "no" can turn into a "yes" when a plain copy of these bytes is made later
        if (plain)
          ctx.db.run("INSERT OR IGNORE INTO documents_plain_seen (file_id, version) VALUES (?, ?)", fileId, ver);
      }
    } catch {
      unchecked = true;
    }
  }
  const row = (ctx.db.all("SELECT * FROM documents_signing WHERE file_id = ?", fileId) as Row[])[0];
  if (!row)
    return {
      signers: [],
      places: [],
      ...(plain ? { plain: true as const } : {}),
      ...(unchecked ? { unchecked: true as const } : {}),
    };
  // a newer version of the file is a different page: the places belong to the version they were set on
  if (typeof row.version_id === "string") {
    const got = (await ctx.call("files.versions", { fileId })) as { versions?: { versionId?: unknown; n?: unknown }[] };
    const newest = [...(got.versions ?? [])].sort((a, b) => Number(b.n) - Number(a.n))[0];
    if (newest !== undefined && newest.versionId !== row.version_id) return { signers: [], places: [], stale: true };
  }
  const list = (v: unknown): unknown[] => {
    try {
      const got: unknown = JSON.parse(String(v));
      return Array.isArray(got) ? got : [];
    } catch {
      return [];
    }
  };
  return {
    ...(plain ? { plain: true as const } : {}),
    ...(unchecked ? { unchecked: true as const } : {}),
    signers: list(row.roles).filter((r): r is string => typeof r === "string"),
    places: list(row.places),
    ...(typeof row.template_file_id === "string" ? { templateFileId: row.template_file_id } : {}),
    ...(typeof row.record_id === "string" ? { recordId: row.record_id } : {}),
  };
}

/** A template by its name (any case, with or without its extension) or by its file id; the answer for a name that is not there or means two says what there is. */
async function templateNamed(ctx: Ctx, wanted: string): Promise<string> {
  const text = wanted.trim();
  if (/^fil_[A-Za-z0-9]+$/.test(text)) return text;
  const list = async (name?: string) =>
    (
      (await ctx.call("documents.templates.list", name === undefined ? {} : { name })) as {
        templates?: { fileId: string; name: string }[];
      }
    ).templates ?? [];
  const exact = await list(text);
  if (exact.length === 1) return exact[0]!.fileId;
  const all = exact.length > 1 ? exact : await list();
  const near = exact.length > 1 ? all : all.filter((t) => t.name.toLowerCase().includes(text.toLowerCase()));
  if (near.length === 1) return near[0]!.fileId;
  const names = (near.length > 0 ? near : all).slice(0, 6).map((t) => `"${baseName(t.name)}"`);
  return fail(
    ctx,
    near.length > 1 || exact.length > 1 ? "validation.bad_input" : "validation.not_found",
    near.length > 1 || exact.length > 1
      ? `More than one template is called like that: ${names.join(", ")}. Say which.`
      : all.length === 0
        ? "There are no templates in this Space yet. Mark a Word file or a Vyre document as a template first."
        : `No template is called "${text}". The templates are: ${names.join(", ")}.`,
    { template: text },
  );
}

/** Make a document for a record from a template by name: no ids to look up, no folder to choose. The record's own files are where it lands. */
async function make(ctx: Ctx, input: unknown): Promise<Filled> {
  const o = rec(ctx, input);
  const recordId = reqStr(ctx, o, "recordId");
  const templateFileId = await templateNamed(ctx, reqStr(ctx, o, "template"));
  const folder = (await ctx.call("projects.files_folder", { recordId })) as { folderId?: string | null };
  if (typeof folder.folderId !== "string")
    fail(ctx, "validation.precondition_failed", "That record has no files folder to put the document in.", {
      recordId,
    });
  const pass: Record<string, unknown> = { templateFileId, intoFolderId: folder.folderId, recordId };
  for (const k of ["values", "signingDate", "name", "format"]) if (o[k] !== undefined) pass[k] = o[k];
  // a retry of the same ask makes the same file: the key is the ask itself
  // the key of the ask: the caller's own when it gave one (a retry with it is the same document), else made from what is asked, as fill does: template and its version, the values, the date, the name,
  // the format, the record, the folder and the person. A retry of the same ask is the same document; another person, folder, template version or value is another.
  const given = typeof o.idempotencyKey === "string" ? o.idempotencyKey : "";
  let ask = "";
  if (given === "") {
    // what the document will say as the record stands now: the page filled from the record and the typed values. A corrected record is another ask, another record another.
    const shown = (await ctx.call("documents.preview_fill", {
      templateFileId,
      recordId,
      ...(o.values !== undefined ? { values: o.values } : {}),
      ...(o.signingDate !== undefined ? { signingDate: o.signingDate } : {}),
    })) as { digest?: unknown };
    // the digest covers every resolved value and the template bytes they were read with (one read, so an edit between the two cannot split them)
    ask = await askKey([shown.digest, o.name, o.format, recordId, folder.folderId, ctx.actingFor ?? ctx.principal.id]);
  }
  pass.idempotencyKey = `make:${recordId}:${templateFileId}:${given !== "" ? given : ask}`;
  return (await ctx.call("documents.fill", pass)) as Filled;
}

export const nativeHandlers = {
  "documents.make": make,
  "documents.fields": fields,
  "documents.preview_fill": preview,
  "documents.fill": fill,
  "documents.make_pdf": makePdf,
  "documents.signing": signing,
};
