// Pure helpers for the Local folders step: a path as a person reads it (home as ~), and the folders this run of the app added, so the preview beside the card can name each one with its
// path (mounts.list carries the name, not where the folder is on this computer). No imports, so it runs under plain node.

/** "/Users/maya/Claude/Orgs/Vyre" reads "~/Claude/Orgs/Vyre"; the same for /home/<name> and C:\Users\<name>. Other paths stay as they are. */
export function tildePath(path: string): string {
  const m = /^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=$|[\\/])/.exec(path);
  return m ? `~${path.slice(m[0].length)}` || "~" : path;
}

/** One line for a folder: "Vyre · ~/Claude/Orgs/Vyre". */
export const folderLine = (name: string, path: string): string => `${name} \u00b7 ${tildePath(path)}`;

const added = new Map<string, string>();
const watchers = new Set<() => void>();
let version = 0;
const tell = (): void => { version++; for (const w of watchers) w(); };

/** The card added a folder (its mount id and its path on this computer), or took one away. */
export function rememberFolder(mountId: string, path: string): void { if (!mountId) return; added.set(mountId, path); tell(); }
export function forgetFolder(mountId: string): void { if (added.delete(mountId)) tell(); }
export const folderPathOf = (mountId: string): string | undefined => added.get(mountId);
export const foldersVersion = (): number => version;
export function watchFolders(fn: () => void): () => void { watchers.add(fn); return () => { watchers.delete(fn); }; }
