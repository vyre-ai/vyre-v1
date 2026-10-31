// Where a record's files live: its files folder, made by the Space (projects.files_folder): a project's own folder, else Files > Projects > Record files > the record, with the record's access on it.
// One folder for every path that puts a file on a record; the page's Attach is one of them, so a file attached here and one a form or a signature filed there sit side by side.
import type { CapMap } from "../../../../../../generated/types.ts";
import { storeFiles } from "../../chats/conversation/actions.ts";
import type { AttachFile } from "../recordpage/data.tsx";

type Call = (cap: string, input: unknown) => Promise<unknown>;
type Out = CapMap["projects.files_folder"]["out"];

/** The record's folder if it has one, else null. Nothing is made. */
export async function findRecordFolder(call: Call, type: string, recordId: string): Promise<string | null> {
  return ((await call("projects.files_folder", { type, recordId, create: false })) as Out).folderId;
}

/** Store the files in the record's folder, which the Space makes first when there is none. Resolves with the folder's id. */
export async function attachToRecord(call: Call, putBlob: ((url: string, bytes: Uint8Array) => Promise<void>) | undefined, files: readonly AttachFile[], target: { type: string; recordId: string }, key: string): Promise<string> {
  const folderId = ((await call("projects.files_folder", { type: target.type, recordId: target.recordId })) as Out).folderId;
  if (!folderId) throw new Error("No folder for this record's files");
  await storeFiles({ call: call as never, ...(putBlob ? { putBlob } : {}) }, folderId, files.map((f) => ({ name: f.name, mime: f.mime, file: f.file })), key);
  return folderId;
}
