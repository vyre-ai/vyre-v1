// What the client purge needs from the rest of the device (ARCH 5.7). Each port is a small interface so the same purge runs on web, desktop and phone,
// and a test can watch what it touched. Nothing here imports another lane's code.

/** Yjs documents held in memory by the editor binding (P-L1_06 owns the binding; it hands the purge this view of it). */
export interface OpenDocs {
  /** Close and forget the documents of one row. */
  closeFor(entity: string, id: string): void;
  /** Close and forget every open document. */
  closeAll(): void;
}

/** The device keychain entries of this Space (the replica key wrap, device token, Space key fingerprint). */
export interface KeychainPort {
  removeAll(): void | Promise<void>;
}

/** The local Space folder (files mirrored for the OS file manager). Leaving a Space wipes it. */
export interface FolderPort {
  wipe(): void | Promise<void>;
}

/** What the shell shows while and after a purge: the Offline/Error state (spec 4.11). */
export type PurgeStatus =
  | { state: "purging"; reason: PurgeReason; epoch: number }
  | { state: "purged"; reason: PurgeReason; epoch: number; personActive: boolean; archived: number | null }
  | { state: "failed"; reason: PurgeReason; epoch: number; errors: string[] };

/** `revoked`: the server said purge (hello, pull reset or a live frame). `leave`: the person left the Space or an admin removed them. */
export type PurgeReason = "revoked" | "leave";

/** The id convention for a row's Yjs documents in `doc_local`: `<entity>:<id>` for the row's main document and `<entity>:<id>:<field>` for one text field. */
export function docPrefix(entity: string, id: string): string {
  return `${entity}:${id}`;
}
