// ctx.blobs (ARCH 4.1): the host blob store behind a module's binary storage. Bytes live in `<data>/blobs/ctx/<id>.bin` as iv|tag|ciphertext (AES-256-GCM, one key per module
// derived from the host's seal key with HKDF, the blob id in the AAD) beside `<id>.json`, the metadata and the owning module. A module opens only its own blobs: another module's id is
// refused, an id nobody stored is absent. Each blob and each module's total is capped.
import fs from "node:fs";
import path from "node:path";
import { mintUuid } from "../../../lib/ids.ts";
import { aesUnwrap, aesWrap, hkdf32, sha256b64 } from "../../../kernel/src/seal/index.ts";
import type { BlobMeta, Blobs } from "../../../packages/contracts/src/ctx.ts";
import { fail } from "../routes/errors.ts";

const SALT = "vyre/ctx.blobs/v1";
const ID = /^blb_[a-f0-9]{32}$/;
const MODULE = /^[a-z][a-z0-9_-]{0,63}$/i;
const ZERO_TRACE = "0".repeat(32);
const IV = 12, TAG = 16;

export const BLOB_LIMITS = { blobBytes: 256 * 1024 * 1024, moduleBytes: 8 * 1024 * 1024 * 1024 } as const;

export interface BlobStoreOptions {
  /** Directory the store owns (created on first write). */
  dir: string;
  /** The host's seal key, at least 16 bytes. */
  key: Uint8Array | string;
  now?: () => number;
  maxBlobBytes?: number;
  maxModuleBytes?: number;
}

export interface BlobStore {
  /** The blobs handle for one module. traceId names errors raised for the call. */
  forModule(moduleId: string, traceId?: string): Blobs;
  /** Total plain bytes a module has stored. */
  usage(moduleId: string): number;
}

interface Stored extends BlobMeta { module: string }

export function createBlobStore(o: BlobStoreOptions): BlobStore {
  if (!o.key || o.key.length < 16) throw new Error("the blob key needs at least 16 bytes");
  const now = o.now ?? Date.now;
  const maxBlob = o.maxBlobBytes ?? BLOB_LIMITS.blobBytes;
  const maxModule = o.maxModuleBytes ?? BLOB_LIMITS.moduleBytes;
  const used = new Map<string, number>();
  let scanned = false;
  const bin = (id: string): string => path.join(o.dir, `${id}.bin`);
  const metaFile = (id: string): string => path.join(o.dir, `${id}.json`);

  function readMeta(id: string): Stored | null {
    try { return JSON.parse(fs.readFileSync(metaFile(id), "utf8")) as Stored; } catch { return null; }
  }
  function scan(): void {
    if (scanned) return;
    scanned = true;
    let names: string[] = [];
    try { names = fs.readdirSync(o.dir); } catch { return; }
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      const m = readMeta(n.slice(0, -5));
      if (m) used.set(m.module, (used.get(m.module) ?? 0) + m.size);
    }
  }
  const keyFor = (moduleId: string): Uint8Array => hkdf32(o.key, SALT, `module:${moduleId}`);
  const strip = ({ module: _m, ...meta }: Stored): BlobMeta => meta;

  return {
    usage(moduleId) { scan(); return used.get(moduleId) ?? 0; },
    forModule(moduleId, traceId = ZERO_TRACE) {
      if (!MODULE.test(moduleId)) throw new Error("a blob store scope is a module id");
      /** The stored record when this module owns the id; null when absent; a refusal when another module owns it. */
      const own = (id: string): Stored | null => {
        if (typeof id !== "string" || !ID.test(id)) return null;
        const m = readMeta(id);
        if (!m) return null;
        if (m.module !== moduleId) throw fail("permission.no_grant", traceId, { message: "A module may only use its own blobs.", details: { module: moduleId } });
        return m;
      };
      return {
        async put(bytes, contentType) {
          if (!(bytes instanceof Uint8Array)) throw fail("validation.bad_input", traceId, { message: "A blob is bytes." });
          if (typeof contentType !== "string" || !contentType || contentType.length > 255) throw fail("validation.bad_input", traceId, { message: "A blob needs a content type." });
          if (bytes.byteLength > maxBlob) throw fail("validation.too_large", traceId, { message: "That blob is too large.", details: { bytes: bytes.byteLength, cap: maxBlob } });
          scan();
          const total = used.get(moduleId) ?? 0;
          if (total + bytes.byteLength > maxModule) throw fail("validation.too_large", traceId, { message: "This module has used all its blob storage.", details: { used: total, cap: maxModule } });
          const id = `blb_${mintUuid(now()).replaceAll("-", "")}`;
          const box = aesWrap(keyFor(moduleId), bytes, id);
          const sealed = Buffer.concat([Buffer.from(box.iv, "base64url"), Buffer.from(box.tag, "base64url"), Buffer.from(box.ct, "base64url")]);
          const meta: Stored = { id, module: moduleId, contentType, size: bytes.byteLength, sha256: Buffer.from(sha256b64(bytes), "base64url").toString("hex"), createdAt: now() };
          fs.mkdirSync(o.dir, { recursive: true, mode: 0o700 });
          fs.writeFileSync(bin(id), sealed, { mode: 0o600 });
          fs.writeFileSync(metaFile(id), JSON.stringify(meta), { mode: 0o600 });   // the metadata lands last: a blob without it does not exist
          used.set(moduleId, total + bytes.byteLength);
          return strip(meta);
        },
        async get(id) {
          const m = own(id);
          if (!m) return null;
          let file: Buffer;
          try { file = fs.readFileSync(bin(id)); } catch { return null; }
          if (file.length < IV + TAG) throw fail("internal.unexpected", traceId, { message: "Something went wrong on our side.", details: { why: "blob file is truncated" } });
          const box = { iv: file.subarray(0, IV).toString("base64url"), tag: file.subarray(IV, IV + TAG).toString("base64url"), ct: file.subarray(IV + TAG).toString("base64url") };
          let plain: Buffer;
          try { plain = aesUnwrap(keyFor(moduleId), box, id); } catch { throw fail("internal.unexpected", traceId, { message: "Something went wrong on our side.", details: { why: "blob does not open" } }); }
          return { meta: strip(m), bytes: new Uint8Array(plain) };
        },
        async stat(id) {
          const m = own(id);
          return m ? strip(m) : null;
        },
        async delete(id) {
          const m = own(id);
          if (!m) return false;
          scan();
          fs.rmSync(metaFile(id), { force: true });   // metadata first: the blob stops existing before its bytes go
          fs.rmSync(bin(id), { force: true });
          used.set(moduleId, Math.max(0, (used.get(moduleId) ?? 0) - m.size));
          return true;
        },
      };
    },
  };
}
