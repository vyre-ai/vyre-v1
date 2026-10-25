// Who is calling (P-SEC_03). A bearer token maps to one device session row of the devices module; the person and the device come from that row and from nothing the caller wrote.
// The `x-vyre-device` header and the `?device=` query are never read for identity. A session that is revoked (devices_session.revoked_at), a device that is revoked (devices_device.revokedAt)
// or deleted, and a token nobody issued all resolve to null, which the gateway answers with 401 and the live hub with 401 on the upgrade.
//
// The ONE other way in is the owner bootstrap path: the single local admin token that `ensureAdminToken` (config.ts) reads from VYRE_ADMIN_TOKEN or <data dir>/admin.token. The CLI and the Console
// on the same machine use it before any device has signed in. It acts as the Space owner on the fixed device `local-admin`; the header and query cannot change that device either.
import { sha256Hex } from "../../../kernel/src/log/hash.ts";
import type { HostDb } from "./sqlite.ts";

/** The device name the owner bootstrap token acts as. It is not a row in devices_device and is never a sync replica. */
export const ADMIN_DEVICE = "local-admin";

/** A live device session: whom the token speaks for, on which device, in which Space. */
export interface DeviceSession { sessionId: string; person: string; device: string; space: string }

export interface SessionResolver {
  /** The live session this bearer token belongs to; null when it is unknown, or its session or device is revoked. */
  resolve(token: string): DeviceSession | null;
}

const TABLE = `CREATE TABLE IF NOT EXISTS host_session_token (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS host_session_token_session ON host_session_token (session_id);`;

const sha256 = (s: string): string => sha256Hex(s);

/** Mint a token for a device session. Only its hash is stored, so the token is shown to the device once and cannot be read back. */
export function issueSessionToken(db: HostDb, sessionId: string, now: () => number = Date.now): string {
  db.exec(TABLE);
  const token = `vst_${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  db.run("INSERT INTO host_session_token (token_hash, session_id, created_at) VALUES (?, ?, ?)", sha256(token), sessionId, now());
  return token;
}

/** Is this device session still signed in: its row is not revoked and its device is not revoked or deleted. */
export function sessionLive(db: HostDb, sessionId: string): boolean {
  try {
    return db.all(
      `SELECT 1 AS ok FROM devices_session s JOIN devices_device d ON d.id = s.device_id WHERE s.id = ? AND s.kind = 'device' AND s.revoked_at IS NULL AND d.revokedAt IS NULL AND d.deleted_at IS NULL`,
      sessionId,
    ).length > 0;
  } catch { return false; }
}

interface Row { session_id: string; person: string; device_id: string }

export function createSessionResolver(o: { db: HostDb; space: string }): SessionResolver {
  o.db.exec(TABLE);
  return {
    resolve(token) {
      if (!token) return null;
      let row: Row | undefined;
      try {
        row = o.db.all(
          `SELECT t.session_id AS session_id, s.person AS person, s.device_id AS device_id
             FROM host_session_token t
             JOIN devices_session s ON s.id = t.session_id
             JOIN devices_device d ON d.id = s.device_id
            WHERE t.token_hash = ? AND s.kind = 'device' AND s.revoked_at IS NULL
              AND d.revokedAt IS NULL AND d.deleted_at IS NULL AND d.person = s.person`,
          sha256(token),
        )[0] as Row | undefined;
      } catch { return null; }   // the devices tables are not there yet: nobody can hold a device session
      return row ? { sessionId: row.session_id, person: row.person, device: row.device_id, space: o.space } : null;
    },
  };
}
