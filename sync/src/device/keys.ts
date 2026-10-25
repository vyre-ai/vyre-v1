// Replica key derivation, wrapping and rotation (ARCH 5.10).
//   replicaKey = HKDF(personKey, "replica" || spaceId || deviceId)
// The replicaKey is stored only wrapped: AES-GCM under a non-extractable WebCrypto key kept in IndexedDB.
// No OS keychain (password-only model: an ad-hoc signed Mac app cannot save keychain items). Sign out deletes both.
import { defaultCrypto, utf8 } from "./crypto.ts";
import type { CryptoKeyLike, CryptoLike } from "./crypto.ts";
import { ReplicaError } from "../replica/types.ts";

export const REPLICA_KEY_BYTES = 32;
const WRAP_KEY = "wrap-key";
const SLOT_PREFIX = "replica:";

/** Where the wrapping CryptoKey and the wrapped blobs live. IndexedDB structured-clones a CryptoKey, so a non-extractable key stays non-extractable. */
export interface KeyBox {
  get(name: string): Promise<unknown>;
  put(name: string, value: unknown): Promise<void>;
  delete(name: string): Promise<void>;
}

export function memoryKeyBox(): KeyBox {
  const m = new Map<string, unknown>();
  return {
    get: (n) => Promise.resolve(m.get(n)),
    put: (n, v) => { m.set(n, v); return Promise.resolve(); },
    delete: (n) => { m.delete(n); return Promise.resolve(); },
  };
}

/** The structural slice of IDBFactory the box needs. */
export interface IdbFactoryLike {
  open(name: string, version?: number): IdbOpenRequest;
}
interface IdbRequest<T> { result: T; error: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null }
interface IdbOpenRequest extends IdbRequest<IdbDatabase> { onupgradeneeded: (() => void) | null }
interface IdbDatabase {
  createObjectStore(name: string): unknown;
  transaction(store: string, mode: "readonly" | "readwrite"): { objectStore(name: string): IdbStore };
  close(): void;
}
interface IdbStore {
  get(key: string): IdbRequest<unknown>;
  put(value: unknown, key: string): IdbRequest<unknown>;
  delete(key: string): IdbRequest<unknown>;
}

/** The browser and Tauri-webview box. One object store, keys are the box names. */
export function indexedDbKeyBox(dbName = "vyre-device-keys", factory?: IdbFactoryLike): KeyBox {
  const idb = factory ?? (globalThis as unknown as { indexedDB?: IdbFactoryLike }).indexedDB;
  if (!idb) throw new ReplicaError("no_indexeddb", "IndexedDB is not available on this device");
  const STORE = "keys";
  let opened: Promise<IdbDatabase> | null = null;
  const db = (): Promise<IdbDatabase> => {
    opened ??= new Promise<IdbDatabase>((resolve, reject) => {
      const req = idb.open(dbName, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new ReplicaError("idb_open", "could not open the key store"));
    });
    return opened;
  };
  const run = async <T>(mode: "readonly" | "readwrite", f: (s: IdbStore) => IdbRequest<T>): Promise<T> => {
    const d = await db();
    return new Promise<T>((resolve, reject) => {
      const req = f(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new ReplicaError("idb_io", "key store read or write failed"));
    });
  };
  return {
    get: (n) => run("readonly", (s) => s.get(n)),
    put: async (n, v) => { await run("readwrite", (s) => s.put(v, n)); },
    delete: async (n) => { await run("readwrite", (s) => s.delete(n)); },
  };
}

/** HKDF-SHA256 over the personKey. The info string joins the three parts with NUL so ("a","bc") and ("ab","c") differ. */
export async function deriveReplicaKey(personKey: Uint8Array, spaceId: string, deviceId: string, c: CryptoLike = defaultCrypto()): Promise<Uint8Array> {
  if (personKey.length !== REPLICA_KEY_BYTES) throw new ReplicaError("bad_key", "personKey must be 32 bytes");
  if (!spaceId || !deviceId) throw new ReplicaError("bad_key", "spaceId and deviceId are required");
  const base = await c.subtle.importKey("raw", personKey, "HKDF", false, ["deriveBits"]);
  const bits = await c.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(`replica\0${spaceId}\0${deviceId}`) }, base, REPLICA_KEY_BYTES * 8);
  return new Uint8Array(bits);
}

interface WrappedBlob { v: 1; iv: Uint8Array; ct: Uint8Array }

function isBlob(x: unknown): x is WrappedBlob {
  if (typeof x !== "object" || x === null) return false;
  const b = x as Partial<WrappedBlob>;
  return b.v === 1 && b.iv instanceof Uint8Array && b.ct instanceof Uint8Array;
}

function isKey(x: unknown): x is CryptoKeyLike {
  return typeof x === "object" && x !== null && "algorithm" in x && "extractable" in x;
}

export interface ReplicaKeyVault {
  /** Wrap and store the key for a slot (`<spaceId>:<deviceId>`), replacing what was there. */
  store(slot: string, replicaKey: Uint8Array): Promise<void>;
  /** The unwrapped key, or null when this slot has none. @throws ReplicaError("unwrap_failed") when the blob or wrapping key was tampered with or swapped. */
  load(slot: string): Promise<Uint8Array | null>;
  has(slot: string): Promise<boolean>;
  /** Make a new wrapping key and re-wrap every listed slot under it. The old wrapping key is gone afterwards. All or nothing. */
  rewrap(slots: readonly string[]): Promise<void>;
  /** Change the replica key of a slot. `rekey` re-encrypts the database from old to new; the new key is stored only after it succeeds. */
  rotate(slot: string, next: Uint8Array, rekey: (oldKey: Uint8Array, newKey: Uint8Array) => Promise<void>): Promise<void>;
  /** Sign out: delete the slot's wrapped key. The wrapping key goes too when `all` is set, or when `slots` (every slot of this device) is given and none of the others holds a key. */
  wipe(slot: string, opts?: { all?: boolean; slots?: readonly string[] }): Promise<void>;
}

export function createReplicaKeyVault(box: KeyBox, c: CryptoLike = defaultCrypto()): ReplicaKeyVault {
  const slotName = (slot: string): string => `${SLOT_PREFIX}${slot}`;
  const aad = (slot: string): Uint8Array => utf8(`vyre.replica.wrap\0${slot}`);

  async function wrapKey(): Promise<CryptoKeyLike> {
    const have = await box.get(WRAP_KEY);
    if (isKey(have)) return have;
    const k = await c.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await box.put(WRAP_KEY, k);
    return k;
  }

  async function seal(key: CryptoKeyLike, slot: string, replicaKey: Uint8Array): Promise<WrappedBlob> {
    const iv = c.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await c.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(slot) }, key, replicaKey));
    return { v: 1, iv, ct };
  }

  async function unseal(key: CryptoKeyLike, slot: string, blob: WrappedBlob): Promise<Uint8Array> {
    try {
      const raw = new Uint8Array(await c.subtle.decrypt({ name: "AES-GCM", iv: blob.iv, additionalData: aad(slot) }, key, blob.ct));
      if (raw.length !== REPLICA_KEY_BYTES) throw new Error("length");
      return raw;
    } catch {
      throw new ReplicaError("unwrap_failed", "the wrapped replica key does not open with this device's wrapping key");
    }
  }

  async function readBlob(slot: string): Promise<WrappedBlob | null> {
    const b = await box.get(slotName(slot));
    if (b === undefined) return null;
    if (!isBlob(b)) throw new ReplicaError("unwrap_failed", "the wrapped replica key is damaged");
    return b;
  }

  const vault: ReplicaKeyVault = {
    async store(slot, replicaKey) {
      if (replicaKey.length !== REPLICA_KEY_BYTES) throw new ReplicaError("bad_key", "replica key must be 32 bytes");
      await box.put(slotName(slot), await seal(await wrapKey(), slot, replicaKey));
    },
    async load(slot) {
      const blob = await readBlob(slot);
      if (!blob) return null;
      const k = await box.get(WRAP_KEY);
      if (!isKey(k)) throw new ReplicaError("unwrap_failed", "this device lost its wrapping key; sign in again");
      return unseal(k, slot, blob);
    },
    async has(slot) {
      return (await box.get(slotName(slot))) !== undefined;
    },
    async rewrap(slots) {
      const old = await box.get(WRAP_KEY);
      const plain = new Map<string, Uint8Array>();
      for (const s of slots) {
        const blob = await readBlob(s);
        if (!blob) continue;
        if (!isKey(old)) throw new ReplicaError("unwrap_failed", "this device lost its wrapping key; sign in again");
        plain.set(s, await unseal(old, s, blob));
      }
      const fresh = await c.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      // Seal everything under the new key before touching the box, so a failure leaves the old state whole.
      const sealed = new Map<string, WrappedBlob>();
      for (const [s, k] of plain) sealed.set(s, await seal(fresh, s, k));
      await box.put(WRAP_KEY, fresh);
      for (const [s, b] of sealed) await box.put(slotName(s), b);
      for (const k of plain.values()) k.fill(0);
    },
    async rotate(slot, next, rekey) {
      if (next.length !== REPLICA_KEY_BYTES) throw new ReplicaError("bad_key", "replica key must be 32 bytes");
      const oldKey = await vault.load(slot);
      if (!oldKey) throw new ReplicaError("no_key", "no replica key to rotate for this slot");
      await rekey(oldKey, next); // a throw here leaves the stored key as it was
      await vault.store(slot, next);
      oldKey.fill(0);
    },
    async wipe(slot, opts) {
      await box.delete(slotName(slot));
      const others = (opts?.slots ?? []).filter((s) => s !== slot);
      let left = false;
      for (const s of others) if (await vault.has(s)) left = true;
      if (opts?.all || (opts?.slots !== undefined && !left)) await box.delete(WRAP_KEY);
    },
  };
  return vault;
}
