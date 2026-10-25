// Phones: expo-sqlite built with SQLCipher (config plugin useSQLCipher; a dev build, not Expo Go).
// sync cannot import expo-sqlite (boundary B6): the app passes `open`.
import { createExpoDriver } from "../replica/expo.ts";
import type { ExpoDatabase } from "../replica/expo.ts";
import { ReplicaError } from "../replica/types.ts";
import type { SqlDriver } from "../replica/types.ts";
import { REPLICA_KEY_BYTES } from "./keys.ts";
import { toHex } from "./crypto.ts";

export interface SqlCipherOpen {
  /** expo-sqlite's openDatabaseSync(file). */
  open(file: string): ExpoDatabase;
  file: string;
  /** 32 bytes. Passed to SQLCipher as a raw key, so no passphrase KDF runs on the open path. */
  key: Uint8Array;
}

const rawKey = (key: Uint8Array): string => `"x'${toHex(key)}'"`;

function first(db: ExpoDatabase, sql: string): Record<string, unknown> | null {
  const s = db.prepareSync(sql);
  try {
    return s.executeSync().getFirstSync();
  } finally {
    s.finalizeSync();
  }
}

/** Key a freshly opened database and prove the key is right. Closes the database and throws when it is not. */
export function unlockSqlCipher(db: ExpoDatabase, key: Uint8Array): void {
  if (key.length !== REPLICA_KEY_BYTES) {
    db.closeSync();
    throw new ReplicaError("bad_key", "replica key must be 32 bytes");
  }
  try {
    db.execSync(`PRAGMA key = ${rawKey(key)}`);
    // A build without SQLCipher ignores PRAGMA key and would write plaintext. Refuse that.
    const v = first(db, "PRAGMA cipher_version");
    const version = v ? Object.values(v)[0] : null;
    if (typeof version !== "string" || version.length === 0) {
      throw new ReplicaError("no_cipher", "this build of SQLite has no SQLCipher; refusing to store a replica in plaintext");
    }
    // The first page read is what fails on a wrong key.
    first(db, "SELECT count(*) AS n FROM sqlite_master");
  } catch (e) {
    try { db.closeSync(); } catch { /* already closed */ }
    if (e instanceof ReplicaError) throw e;
    throw new ReplicaError("wrong_key", "the replica key does not open this database");
  }
}

export function openSqlCipher(o: SqlCipherOpen): SqlDriver {
  const db = o.open(o.file);
  unlockSqlCipher(db, o.key);
  return createExpoDriver(db);
}

/** Re-encrypt the open database under a new key (PRAGMA rekey), then prove the new key reads. */
export function rekeySqlCipher(db: ExpoDatabase, next: Uint8Array): void {
  if (next.length !== REPLICA_KEY_BYTES) throw new ReplicaError("bad_key", "replica key must be 32 bytes");
  db.execSync(`PRAGMA rekey = ${rawKey(next)}`);
  first(db, "SELECT count(*) AS n FROM sqlite_master");
}
