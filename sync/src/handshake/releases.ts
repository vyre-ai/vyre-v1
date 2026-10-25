// Releases and their registry hashes (ARCH 5.2). Every release records the hash of its capability and entity registry. From that list the server derives which hashes a client may still run live
// (releases within the support window of the server's own version) and which are known to be older (update_required rather than resync).
import { parseVersion, SUPPORTED_MINORS, supportOf } from "./version.ts";

export interface Release { version: string; registryHash: string }
export type ReleaseTable = readonly Release[];

export interface HashLists { compatible: string[]; older: string[] }

/** Hashes by window: a release the server still supports is compatible, an older one is `older`. A newer release (a rolled back server) is neither. The server's own hash is never listed. */
export function hashLists(table: ReleaseTable, serverVersion: string, serverHash: string, window = SUPPORTED_MINORS): HashLists {
  const compatible = new Set<string>();
  const older = new Set<string>();
  for (const r of table) {
    if (r.registryHash === serverHash || !parseVersion(r.version)) continue;
    const s = supportOf(r.version, serverVersion, window);
    if (s === "supported" || s === "current") compatible.add(r.registryHash);
    else if (s === "too_old") older.add(r.registryHash);
  }
  // A hash shared by a supported release and an old one is supported: the app has the newest registry it could be running.
  for (const h of compatible) older.delete(h);
  return { compatible: [...compatible].sort(), older: [...older].sort() };
}
