// Mounted files at their provider (live folders L3): where a mounted file opens, and how an agent edits it in place.
//   mounts.file_link      the address that opens a mounted file in Google Docs, Sheets or Slides, Word, Excel, PowerPoint or Dropbox, and what an agent can do to it in place
//   mounts.doc_replace_text, mounts.doc_insert_text    edit a Google Doc by the words in it
//   mounts.sheet_read, mounts.sheet_write, mounts.sheet_append    read and write the cells of a Google Sheet or an Excel workbook in OneDrive or SharePoint
// The provider's folder stays the source of truth. A Google Doc or Sheet is kept in Vyre only as a snapshot and is never uploaded back, and an Excel workbook is a binary a person edits in Excel, so an
// agent that must change one does it through the provider's own structured API (Docs batchUpdate, Sheets values, Graph workbook ranges): the change lands in the real file, shows in its version history
// under the agent's name, and the snapshot follows on the next sync. These go through the provider capabilities as the asker, so the provider's own permissions decide what an agent may do; Vyre adds the
// Files grant (Edit on the file for a write) and the Gate act of the underlying write.
import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, VyreError } from "../../../packages/contracts/src/types.ts";

type Row = Record<string, unknown>;

const obj = (v: unknown): Row => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const opt = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

function refuse(ctx: Ctx, code: ErrorCode, message: string): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = { code: def.code, message, retryable: def.retryable, traceId: ctx.trace.traceId, next: def.next.map((kind) => ({ kind, label: kind })) };
  throw new VyreErr(error);
}

const codeOf = (e: unknown): string => (e instanceof VyreErr ? e.error.code : "");

export type LinkType = "google_doc" | "google_sheet" | "google_slides" | "google_file" | "word" | "excel" | "powerpoint" | "sharepoint_file" | "onedrive_file" | "dropbox_file";
export type NativeEdit = "replace_text" | "insert_text" | "read_cells" | "write_cells" | "append_rows";

const OPEN_IN: Record<LinkType, string> = {
  google_doc: "Google Docs", google_sheet: "Google Sheets", google_slides: "Google Slides", google_file: "Google Drive", word: "Word", excel: "Excel", powerpoint: "PowerPoint",
  sharepoint_file: "SharePoint", onedrive_file: "OneDrive", dropbox_file: "Dropbox",
};
const EDITS: Partial<Record<LinkType, NativeEdit[]>> = {
  google_doc: ["replace_text", "insert_text"], google_sheet: ["read_cells", "write_cells", "append_rows"], excel: ["read_cells", "write_cells", "append_rows"],
};

const GOOGLE_TYPE: Record<string, LinkType> = {
  "application/vnd.google-apps.document": "google_doc", "application/vnd.google-apps.spreadsheet": "google_sheet", "application/vnd.google-apps.presentation": "google_slides",
};

function officeType(name: string, fallback: LinkType): LinkType {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "docx" || ext === "doc") return "word";
  if (ext === "xlsx" || ext === "xlsm" || ext === "xls") return "excel";
  if (ext === "pptx" || ext === "ppt") return "powerpoint";
  return fallback;
}

/** The webUrl Google gives for a Doc, Sheet or Slides file is the Drive link; the editor's own address opens straight into the editor. */
function googleEditor(type: LinkType, id: string, fallback: string | undefined): string | undefined {
  if (type === "google_doc") return `https://docs.google.com/document/d/${encodeURIComponent(id)}/edit`;
  if (type === "google_sheet") return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;
  if (type === "google_slides") return `https://docs.google.com/presentation/d/${encodeURIComponent(id)}/edit`;
  return fallback;
}

interface Located { mountId: string; kind: string; connectionId?: string; remoteId: string; driveId?: string; name: string; pullOnly: boolean; fileId: string }

/** The mounted item behind a Vyre file, when it comes from a cloud provider. */
function locate(ctx: Ctx, fileId: string): Located | undefined {
  const item = (ctx.db.all("SELECT * FROM mounts_item WHERE file_id = ?", fileId) as Row[]).find((r) => r["deleted"] !== 1 && opt(r["remote_id"]) !== undefined);
  if (!item) return undefined;
  const mount = (ctx.db.all("SELECT * FROM mounts_mount WHERE id = ?", str(item["mount_id"])) as Row[])[0];
  if (!mount || mount["deleted_at"] !== null) return undefined;
  const kind = str(mount["kind"]);
  if (kind !== "google_drive" && kind !== "sharepoint" && kind !== "onedrive" && kind !== "dropbox") return undefined;
  const connectionId = opt(mount["connection_id"]);
  const driveId = opt(mount["ref"]);
  return {
    mountId: str(mount["id"]), kind, remoteId: str(item["remote_id"]), name: str(item["name"]), pullOnly: mount["pull_only"] === 1, fileId,
    ...(connectionId !== undefined ? { connectionId } : {}), ...((kind === "sharepoint" || kind === "onedrive") && driveId !== undefined ? { driveId } : {}),
  };
}

const conn = (l: Located): Row => (l.connectionId !== undefined ? { connectionId: l.connectionId } : {});

interface Described { located: Located; type: LinkType; webUrl?: string }

/** Ask the provider what the item is and where it opens. Called as the asker: the provider decides whether they may see it. */
async function describe(ctx: Ctx, l: Located): Promise<Described> {
  if (l.kind === "google_drive") {
    const f = obj(obj(await ctx.call("google.drive.get_file", { ...conn(l), fileId: l.remoteId }))["file"]);
    const type = GOOGLE_TYPE[str(f["mimeType"])] ?? "google_file";
    const url = googleEditor(type, l.remoteId, opt(f["webViewLink"]));
    return { located: l, type, ...(url !== undefined ? { webUrl: url } : {}) };
  }
  if (l.kind === "dropbox") {
    const e = obj(obj(await ctx.call("dropbox.files.get_metadata", { ...conn(l), path: l.remoteId }))["entry"]);
    const url = opt(e["webUrl"]);
    return { located: l, type: "dropbox_file", ...(url !== undefined ? { webUrl: url } : {}) };
  }
  const item = obj(obj(await ctx.call("ms.drive.get_item", { ...conn(l), ...(l.driveId !== undefined ? { driveId: l.driveId } : {}), itemId: l.remoteId }))["item"]);
  const type = officeType(str(item["name"]) || l.name, l.kind === "onedrive" ? "onedrive_file" : "sharepoint_file");
  const url = opt(item["webUrl"]);
  return { located: l, type, ...(url !== undefined ? { webUrl: url } : {}) };
}

/** Errors that mean "not for you" or "not now", not "broken": the link is simply left out, and the file still opens in Vyre. */
const SOFT = new Set(["validation.not_found", "validation.precondition_failed", "permission.no_grant", "provider.auth_failed", "provider.unavailable", "provider.network", "provider.rate_limited", "internal.unavailable"]);

export async function fileLink(ctx: Ctx, input: unknown): Promise<Row> {
  const fileId = str(obj(input)["fileId"]);
  if (fileId === "") refuse(ctx, "validation.bad_input", "fileId is needed.");
  const located = locate(ctx, fileId);
  if (!located) return { reason: "This file does not come from a connected folder." };
  let d: Described;
  try { d = await describe(ctx, located); } catch (e) {
    if (e instanceof VyreErr && SOFT.has(codeOf(e))) return { reason: e.error.message };
    throw e;
  }
  if (d.webUrl === undefined) return { reason: "The provider gave no address for this file." };
  return { link: { mountId: located.mountId, kind: located.kind, type: d.type, openIn: OPEN_IN[d.type], webUrl: d.webUrl, edit: EDITS[d.type] ?? [] } };
}

// ---- native edits -------------------------------------------------------------------------------------------

async function need(ctx: Ctx, fileId: string, types: LinkType[], what: string, write: boolean): Promise<Described> {
  if (fileId === "") refuse(ctx, "validation.bad_input", "fileId is needed.");
  const located = locate(ctx, fileId);
  if (!located) refuse(ctx, "validation.precondition_failed", "This file does not come from a connected folder, so there is no provider file to edit in place.");
  if (write && located.pullOnly) refuse(ctx, "validation.precondition_failed", "This folder is read only.");
  const d = await describe(ctx, located);
  if (!types.includes(d.type)) refuse(ctx, "validation.unsupported", `${what} works on ${types.map((t) => OPEN_IN[t]).join(" or ")}, and this file is ${OPEN_IN[d.type] === "Google Drive" ? "another kind of file" : `a ${OPEN_IN[d.type]} file`}. A person edits it in ${OPEN_IN[d.type]}.`);
  return d;
}

const keyOf = (i: Row): Row => (opt(i["idempotencyKey"]) !== undefined ? { idempotencyKey: i["idempotencyKey"] } : {});

export async function docReplaceText(ctx: Ctx, input: unknown): Promise<Row> {
  const i = obj(input);
  const d = await need(ctx, str(i["fileId"]), ["google_doc"], "Replacing text", true);
  const out = obj(await ctx.call("google.docs.replace_text", {
    ...conn(d.located), documentId: d.located.remoteId, find: i["find"], replace: i["replace"], ...(typeof i["matchCase"] === "boolean" ? { matchCase: i["matchCase"] } : {}), ...keyOf(i),
  }));
  return { replaced: out["replaced"] ?? 0 };
}

export async function docInsertText(ctx: Ctx, input: unknown): Promise<Row> {
  const i = obj(input);
  const d = await need(ctx, str(i["fileId"]), ["google_doc"], "Inserting text", true);
  const out = obj(await ctx.call("google.docs.insert_text", {
    ...conn(d.located), documentId: d.located.remoteId, text: i["text"],
    ...(opt(i["where"]) !== undefined ? { where: i["where"] } : {}), ...(opt(i["anchor"]) !== undefined ? { anchor: i["anchor"] } : {}), ...(typeof i["matchCase"] === "boolean" ? { matchCase: i["matchCase"] } : {}), ...keyOf(i),
  }));
  return { inserted: out["inserted"] === true };
}

/** A sheet name in A1 notation: quoted when it has anything but letters, digits and underscores. */
const a1 = (sheet: string | undefined, range: string): string => (sheet === undefined ? range : `${/^[A-Za-z0-9_]+$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`}!${range}`);

function cells(ctx: Ctx, v: unknown): unknown[][] {
  const rows = list(v).map((r) => list(r));
  if (rows.length === 0 || rows.some((r) => r.length === 0)) refuse(ctx, "validation.bad_input", "values must hold at least one cell in every row.");
  return rows;
}

const SHEETS: LinkType[] = ["google_sheet", "excel"];

function needSheetName(ctx: Ctx, type: LinkType, sheet: string | undefined): void {
  if (type === "excel" && sheet === undefined) refuse(ctx, "validation.bad_input", "An Excel workbook needs the worksheet name in sheet, such as Sheet1.");
}

export async function sheetRead(ctx: Ctx, input: unknown): Promise<Row> {
  const i = obj(input);
  const d = await need(ctx, str(i["fileId"]), SHEETS, "Reading cells", false);
  const sheet = opt(i["sheet"]), range = str(i["range"]);
  if (range === "") refuse(ctx, "validation.bad_input", "range is needed, such as A1:D20.");
  needSheetName(ctx, d.type, sheet);
  if (d.type === "google_sheet") {
    const out = obj(await ctx.call("google.sheets.get_values", { ...conn(d.located), spreadsheetId: d.located.remoteId, range: a1(sheet, range) }));
    return { values: list(out["values"]) };
  }
  const out = obj(await ctx.call("ms.workbook.get_range", { ...conn(d.located), ...(d.located.driveId !== undefined ? { driveId: d.located.driveId } : {}), itemId: d.located.remoteId, sheet, range }));
  return { values: list(out["values"]) };
}

export async function sheetWrite(ctx: Ctx, input: unknown): Promise<Row> {
  const i = obj(input);
  const d = await need(ctx, str(i["fileId"]), SHEETS, "Writing cells", true);
  const sheet = opt(i["sheet"]), range = str(i["range"]);
  if (range === "") refuse(ctx, "validation.bad_input", "range is needed, such as B2 or B2:D9.");
  needSheetName(ctx, d.type, sheet);
  const values = cells(ctx, i["values"]);
  if (d.type === "google_sheet") {
    const out = obj(await ctx.call("google.sheets.update_values", {
      ...conn(d.located), spreadsheetId: d.located.remoteId, range: a1(sheet, range), values: values.map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c)))), valueInputOption: "USER_ENTERED", ...keyOf(i),
    }));
    return { updatedCells: out["updatedCells"] ?? 0 };
  }
  const out = obj(await ctx.call("ms.workbook.update_range", { ...conn(d.located), ...(d.located.driveId !== undefined ? { driveId: d.located.driveId } : {}), itemId: d.located.remoteId, sheet, range, values, ...keyOf(i) }));
  return { updatedCells: out["updatedCells"] ?? 0 };
}

export async function sheetAppend(ctx: Ctx, input: unknown): Promise<Row> {
  const i = obj(input);
  const d = await need(ctx, str(i["fileId"]), SHEETS, "Adding rows", true);
  const sheet = opt(i["sheet"]);
  needSheetName(ctx, d.type, sheet);
  const values = cells(ctx, i["values"]);
  if (d.type === "google_sheet") {
    const out = obj(await ctx.call("google.sheets.append_values", {
      ...conn(d.located), spreadsheetId: d.located.remoteId, range: a1(sheet, "A1"), values: values.map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c)))), ...keyOf(i),
    }));
    return { updatedRows: out["updatedRows"] ?? 0 };
  }
  const out = obj(await ctx.call("ms.workbook.append_rows", { ...conn(d.located), ...(d.located.driveId !== undefined ? { driveId: d.located.driveId } : {}), itemId: d.located.remoteId, sheet, values, ...keyOf(i) }));
  return { updatedRows: out["updatedRows"] ?? 0 };
}

export const nativeHandlers = {
  "mounts.file_link": (ctx: Ctx, input: unknown) => fileLink(ctx, input),
  "mounts.doc_replace_text": (ctx: Ctx, input: unknown) => docReplaceText(ctx, input),
  "mounts.doc_insert_text": (ctx: Ctx, input: unknown) => docInsertText(ctx, input),
  "mounts.sheet_read": (ctx: Ctx, input: unknown) => sheetRead(ctx, input),
  "mounts.sheet_write": (ctx: Ctx, input: unknown) => sheetWrite(ctx, input),
  "mounts.sheet_append": (ctx: Ctx, input: unknown) => sheetAppend(ctx, input),
};
