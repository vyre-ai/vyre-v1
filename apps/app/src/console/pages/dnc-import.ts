// Puts a do-not-contact file in Files and hands it to contacts.suppression.import. The server reads a file by id, so the small file made from the rows (see dnc-import-model.ts) is stored first,
// in "Do-not-contact imports" in the person's Personal folder, where it stays as the record of what was added.
import type { CapMap } from "../../../../../generated/types.ts";
import { groupCsv } from "./dnc-import-model.ts";
import type { DncGroup } from "./dnc-import-model.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;
const FOLDER = "Do-not-contact imports";

async function importFolder(call: Call): Promise<string> {
  const tree = (await call("files.tree", {})) as CapMap["files.tree"]["out"];
  const root = tree.roots.find((r) => r.key === "personal" && r.folderId);
  if (!root?.folderId) throw new Error("There is no place to keep the file yet.");
  const list = (await call("files.list", { section: "personal", folder: root.folderId })) as CapMap["files.list"]["out"];
  const have = list.folders.find((f) => f.name === FOLDER);
  if (have) return have.folderId;
  const made = (await call("files.folder.create", { parentId: root.folderId, name: FOLDER, idempotencyKey: `dnc-imports:${root.folderId}` })) as CapMap["files.folder.create"]["out"];
  return made.folder.folderId;
}

/** Store the group's file and return its id. `key` makes a retry store the same file once. */
export async function storeGroup(call: Call, g: DncGroup, name: string, key: string): Promise<string> {
  const folderId = await importFolder(call);
  const made = (await call("files.create", { folderId, name, content: { text: groupCsv(g) }, mime: "text/csv", idempotencyKey: key })) as CapMap["files.create"]["out"];
  return made.file.fileId;
}
