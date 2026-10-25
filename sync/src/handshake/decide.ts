// Answering a hello with the version rule added (ARCH 3.6, 5.2). `decideMode` (frozen, protocol.ts) answers by epoch, registry hash, cursor and schema versions. This adds what only the app version knows:
// an app more than 2 minor versions behind the server is update_required whatever its hash, because the hash only says what it can speak, not that it is supported. Revocation still beats everything.
import { decideMode } from "../protocol.ts";
import type { Hello, HelloOk, Mode, ServerState } from "../protocol.ts";
import { hashLists } from "./releases.ts";
import type { ReleaseTable } from "./releases.ts";
import { supportOf } from "./version.ts";
import type { Support } from "./version.ts";

export type HandshakeReason =
  | "ok"
  | "revoked"
  | "app_too_old"
  | "registry_older"
  | "registry_changed"
  | "cursor_ahead"
  | "schema_changed";

export interface HandshakeResult {
  ok: HelloOk;
  support: Support;
  reason: HandshakeReason;
}

function reasonOf(h: Hello, s: ServerState, mode: Mode, support: Support): HandshakeReason {
  if (mode === "live") return "ok";
  if (mode === "purge") return "revoked";
  if (mode === "update_required") return support === "too_old" ? "app_too_old" : "registry_older";
  // resync: say which drift it was
  const hashOk = h.registryHash === s.registryHash || s.compatibleRegistryHashes.includes(h.registryHash);
  if (!hashOk) return "registry_changed";
  if (h.cursor > s.head) return "cursor_ahead";
  return "schema_changed";
}

export function decideHello(hello: Hello, state: ServerState, releases: ReleaseTable = []): HandshakeResult {
  const lists = hashLists(releases, state.serverVersion, state.registryHash);
  const merged: ServerState = {
    ...state,
    compatibleRegistryHashes: [...new Set([...state.compatibleRegistryHashes, ...lists.compatible])],
    olderRegistryHashes: [...new Set([...state.olderRegistryHashes, ...lists.older])],
  };
  const support = supportOf(hello.appVersion, state.serverVersion);
  let ok = decideMode(hello, merged);
  // The app is too old to be served even if its registry still matches: read-only, never a resync (its replica is fine, it just may not write).
  if (support === "too_old" && ok.mode !== "purge") ok = { ...ok, mode: "update_required" };
  return { ok, support, reason: reasonOf(hello, merged, ok.mode, support) };
}
