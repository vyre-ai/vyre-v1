// Where an open file lives, as far as this page has seen it. A file opened cold (a pasted link, a card in a chat) has no history, and its address names no folder; the Files place tells the shell the
// folder as soon as it has read the file, so Back from that file goes up to its folder (NAV-2026-11-14 rule 3) and not only to the Files landing.
const FOLDERS = new Map<string, string>();

/** The file's place has read it: remember the folder it sits in. */
export function rememberFileFolder(fileId: string, folderId: string): void {
  if (fileId !== "" && folderId !== "") FOLDERS.set(fileId, folderId);
}

/** The folder a file was last seen in, or undefined when this page has not read it. */
export function folderOfFile(fileId: string): string | undefined {
  return FOLDERS.get(fileId);
}

/** The person cannot list that folder (a shared file in a private folder, a chat card): Back from the file goes to the Files landing, never to a refusal. */
export function forgetFileFolder(fileId: string): void {
  FOLDERS.delete(fileId);
}
