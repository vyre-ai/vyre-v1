// Encrypted device replica stored in the OPFS directory.
// AES-256-GCM, key = HKDF-SHA256(personKey, "replica|space|device"), matching the sync spike codec.
// Values are ciphertext in a sqlite file inside the origin. The sqlite engine is node:sqlite.
// The browser page seals one record with the same iv || tag || ct layout into OPFS replica.bin.

import crypto from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { OpfsDirectory } from "./opfs.ts";

export function replicaKey(personKey: Buffer, space: string, device: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", personKey, Buffer.alloc(0), `replica|${space}|${device}`, 32));
}

/** iv (12) || tag (16) || ciphertext. */
export function seal(key: Buffer, plain: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function unseal(key: Buffer, blob: Buffer): Buffer {
  if (blob.length < 28) throw new Error("replica blob short");
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

function asBlob(row: unknown): Buffer | undefined {
  if (!row || typeof row !== "object" || !("blob" in row)) return undefined;
  const blob = (row as { blob: unknown }).blob;
  if (blob instanceof Uint8Array) return Buffer.from(blob);
  return undefined;
}

export class Replica {
  private constructor(
    private readonly opfs: OpfsDirectory,
    private readonly key: Buffer,
    private readonly db: DatabaseSync,
  ) {}

  static open(dir: string, key: Buffer): Replica {
    if (key.length !== 32) throw new Error("replica key must be 32 bytes");
    const opfs = new OpfsDirectory(dir);
    const db = new DatabaseSync(opfs.path("replica.sqlite"));
    db.exec(
      "PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS rows (id TEXT PRIMARY KEY, blob BLOB NOT NULL)",
    );
    return new Replica(opfs, key, db);
  }

  put(id: string, plain: string): void {
    const blob = seal(this.key, Buffer.from(plain, "utf8"));
    this.db
      .prepare("INSERT INTO rows (id, blob) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET blob = excluded.blob")
      .run(id, blob);
  }

  get(id: string): string | undefined {
    const blob = asBlob(this.db.prepare("SELECT blob FROM rows WHERE id = ?").get(id));
    if (!blob) return undefined;
    return unseal(this.key, blob).toString("utf8");
  }

  /** Ciphertext bytes of the origin, after the connection is closed would be a second call. */
  atRest(): Buffer {
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return this.opfs.bytes();
  }

  close(): void {
    this.db.close();
  }
}

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`missing ${name}\n`);
    process.exit(2);
  }
  return value;
}

// Second process: reopen the same origin and read one row. A wrong key writes REJECTED.
if (process.argv.includes("--reopen")) {
  const dir = mustEnv("S12_DIR");
  const key = Buffer.from(mustEnv("S12_KEY"), "hex");
  const id = mustEnv("S12_ID");
  const out = mustEnv("S12_OUT");
  const replica = Replica.open(dir, key);
  try {
    const value = replica.get(id);
    fs.writeFileSync(out, `OK ${value ?? ""}`);
  } catch {
    fs.writeFileSync(out, "REJECTED");
  }
  replica.close();
  process.exit(0);
}
