// Where a record's files live when it has no folder of its own: "Record files" in the person's Personal folder, then one folder per record named "<title> · <last 8 of its id>", so the same
// record finds the same folder again. A project already has its own folder (its Folder field); that one wins and never reaches this file.
import type { CapMap } from "../../../../../../generated/types.ts";
import { storeFiles } from "../../chats/conversation/actions.ts";
import type { AttachFile } from "../recordpage/data.tsx";

type Call = (cap: string, input: unknown) => Promise<unknown>;
export const RECORD_FILES = "Record files";
const tail = (recordId: string): string => recordId.slice(-8);
/** A folder name cannot carry a slash. */
export const recordFolderName = (title: string, recordId: string): string => `${title.replace(/[\\/]+/g, " ").trim() || "Record"} · ${tail(recordId)}`;

async function personalRoot(call: Call): Promise<string> {
  const tree = (await call("files.tree", {})) as CapMap["files.tree"]["out"];
  const root = tree.roots.find((r) => r.key === "personal" && r.folderId);
  if (!root?.folderId) throw new Error("No place to keep the files");
  return root.folderId;
}

const listIn = async (call: Call, folder: string): Promise<CapMap["files.list"]["out"]> => (await call("files.list", { section: "personal", folder })) as CapMap["files.list"]["out"];

/** The record's folder if one was made for it, else null. Nothing is created. */
export async function findRecordFolder(call: Call, recordId: string): Promise<string | null> {
  const root = await personalRoot(call);
  const home = (await listIn(call, root)).folders.find((f) => f.name === RECORD_FILES);
  if (!home) return null;
  return (await listIn(call, home.folderId)).folders.find((f) => f.name.endsWith(` · ${tail(recordId)}`))?.folderId ?? null;
}

async function makeFolder(call: Call, parentId: string, name: string): Promise<string> {
  const made = (await call("files.folder.create", { parentId, name, idempotencyKey: `record-files:${parentId}:${name}` })) as CapMap["files.folder.create"]["out"];
  return made.folder.folderId;
}

/** Store the files in the record's folder, making "Record files" and the record's folder first when they are not there. Resolves with the folder's id. */
export async function attachToRecord(call: Call, putBlob: ((url: string, bytes: Uint8Array) => Promise<void>) | undefined, files: readonly AttachFile[], target: { recordId: string; title: string }, key: string): Promise<string> {
  const root = await personalRoot(call);
  const homeId = (await listIn(call, root)).folders.find((f) => f.name === RECORD_FILES)?.folderId ?? await makeFolder(call, root, RECORD_FILES);
  const folderId = (await listIn(call, homeId)).folders.find((f) => f.name.endsWith(` · ${tail(target.recordId)}`))?.folderId ?? await makeFolder(call, homeId, recordFolderName(target.title, target.recordId));
  await storeFiles({ call: call as never, ...(putBlob ? { putBlob } : {}) }, folderId, files.map((f) => ({ name: f.name, mime: f.mime, file: f.file })), key);
  return folderId;
}
