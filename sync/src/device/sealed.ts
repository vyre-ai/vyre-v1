// App-layer AES-GCM payload codec: the recorded fallback (ARCH 5.10, spikes/REPORT.md) for wa-sqlite 1.0.0 (no cipher, no FTS5) and the vyred sidecar.
// Each row payload is sealed with the replica key; the row id is the AAD, so a payload moved to another row does not open.
import { defaultCrypto } from "./crypto.ts";
import type { CryptoLike } from "./crypto.ts";
import { ReplicaError } from "../replica/types.ts";
import { REPLICA_KEY_BYTES } from "./keys.ts";

export interface SealCodec {
  seal(plain: Uint8Array, rowId: string): Promise<Uint8Array>;
  open(sealed: Uint8Array, rowId: string): Promise<Uint8Array>;
}

const IV = 12;
const TAG = 16;
const te = new TextEncoder();

export async function createSealCodec(key: Uint8Array, c: CryptoLike = defaultCrypto()): Promise<SealCodec> {
  if (key.length !== REPLICA_KEY_BYTES) throw new ReplicaError("bad_key", "replica key must be 32 bytes");
  const k = await c.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]);
  return {
    async seal(plain, rowId) {
      const iv = c.getRandomValues(new Uint8Array(IV));
      const ct = new Uint8Array(await c.subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(rowId) }, k, plain));
      const out = new Uint8Array(IV + ct.length);
      out.set(iv, 0);
      out.set(ct, IV);
      return out;
    },
    async open(sealed, rowId) {
      if (sealed.length < IV + TAG) throw new ReplicaError("wrong_key", "sealed payload is too short");
      try {
        return new Uint8Array(await c.subtle.decrypt({ name: "AES-GCM", iv: sealed.subarray(0, IV), additionalData: te.encode(rowId) }, k, sealed.subarray(IV)));
      } catch {
        throw new ReplicaError("wrong_key", "the replica key does not open this payload");
      }
    },
  };
}
