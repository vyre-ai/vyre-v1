// The second half of a computer joining a Personal Space it found by name (service.ts): at the start, before any database is open, the copy staged in peer-join/ replaces the fresh, unclaimed
// Space this computer made on its first run. The replaced files are kept in peer-replaced-<time>/ (nothing of the person's was in them: the Space had no owner, or the join is refused).
// Per computer, and never copied: admin.token, the relay route key (this computer's own route at the relay), logs, and the network rows that describe this computer (its phone name, its
// endpoints, its address). Shared by every computer of the Space: the databases, blobs, the key files below and the relay box key (so a phone that pinned it reaches any of them).
import fs from "node:fs";
import path from "node:path";
import { openDb } from "../daemon/sqlite.ts";

export const JOIN_DIR = "peer-join";
export const STAGED_DBS: readonly string[] = ["events.db", "modules.db", "space.db"];
/** The Space's key files: the same on every computer of the Space. */
export const SECRET_FILES: readonly string[] = ["seal.key", "person-wrap.key", "vault-filler.key"];
const MOVED_ASIDE = [...STAGED_DBS.flatMap((f) => [f, `${f}-wal`, `${f}-shm`]), ...SECRET_FILES, "blobs", "trees", "peer.token", "logs/claim-link.txt"];

export interface AppliedJoin { space: string; peerId: string; from: string }

/** Move a staged join into place. Returns what was joined, or null when nothing was staged (or the stage is incomplete, which is left for the next try and logged by the caller). */
export function applyPeerJoin(root: string, now: () => number = Date.now): AppliedJoin | null {
  const stage = path.join(root, JOIN_DIR);
  if (!fs.existsSync(path.join(stage, "ready"))) return null;
  let meta: { space?: unknown; peerId?: unknown; token?: unknown; box?: { priv?: unknown; pub?: unknown }; from?: unknown };
  try { meta = JSON.parse(fs.readFileSync(path.join(stage, "join.json"), "utf8")) as typeof meta; } catch { return null; }
  const space = typeof meta.space === "string" ? meta.space : "", peerId = typeof meta.peerId === "string" ? meta.peerId : "", token = typeof meta.token === "string" ? meta.token : "";
  if (!/^spc_[A-Za-z0-9_]{1,190}$/.test(space) || !peerId || !token || !STAGED_DBS.every((f) => fs.existsSync(path.join(stage, f)))) return null;

  const aside = path.join(root, `peer-replaced-${now()}`);
  fs.mkdirSync(path.join(aside, "logs"), { recursive: true, mode: 0o700 });
  for (const rel of MOVED_ASIDE) {
    const cur = path.join(root, rel);
    if (fs.existsSync(cur)) fs.renameSync(cur, path.join(aside, rel));
  }
  for (const f of [...STAGED_DBS, ...SECRET_FILES]) {
    const staged = path.join(stage, f);
    if (fs.existsSync(staged)) fs.renameSync(staged, path.join(root, f));
  }
  if (fs.existsSync(path.join(stage, "blobs"))) fs.renameSync(path.join(stage, "blobs"), path.join(root, "blobs"));
  if (fs.existsSync(path.join(stage, "trees"))) fs.renameSync(path.join(stage, "trees"), path.join(root, "trees"));
  fs.writeFileSync(path.join(root, "peer.token"), `${token}\n`, { mode: 0o600 });

  // the relay key: this computer keeps its own route key and takes the Space's box key
  if (meta.box && typeof meta.box.priv === "string" && typeof meta.box.pub === "string") {
    const file = path.join(root, "relay.key");
    let mine: Record<string, unknown> = {};
    try { mine = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>; } catch { /* made below by loadRelayKeys if the route half is missing */ }
    if (typeof mine["routeSeed"] === "string" && typeof mine["routePub"] === "string") {
      fs.writeFileSync(file, JSON.stringify({ v: 2, routeSeed: mine["routeSeed"], routePub: mine["routePub"], boxPriv: meta.box.priv, boxPub: meta.box.pub }), { mode: 0o600 });
    }
  }

  // what the copy says about the computer it came from is not true here
  const db = openDb(path.join(root, "modules.db"));
  try {
    for (const sql of [
      "DELETE FROM network_phone", "DELETE FROM network_endpoint", "DELETE FROM network_peer_request",
      "UPDATE network_config SET address = NULL, relay_address = NULL",
    ]) { try { db.exec(sql); } catch { /* an older copy without that table */ } }
    db.run("INSERT OR REPLACE INTO network_peer_self (id, peer_id) VALUES (1, ?)", peerId);
    // writes the other computer had not given a clock yet when it made the copy are its own: it sends them itself, so they are not stamped here as this computer's
    try { db.exec("DELETE FROM peer_dirty"); } catch { /* the copy had no capture yet */ }
  } finally { db.close(); }
  const sdb = fs.existsSync(path.join(root, "space.db")) ? openDb(path.join(root, "space.db")) : null;
  try { sdb?.exec("DELETE FROM peer_dirty"); } catch { /* no capture there yet */ } finally { sdb?.close(); }
  fs.rmSync(stage, { recursive: true, force: true });
  return { space, peerId, from: typeof meta.from === "string" ? meta.from : "" };
}
