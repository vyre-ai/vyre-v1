// The person key kept on this device for the length of the signed-in session (owner ruling 6 Nov: signed in means unlocked; no lock screen, no unlock prompt). The server never holds the key at rest and
// this adds no key to any server: after the password sign-in opens the key, the client seals it with a fresh AES-GCM key made non-extractable by WebCrypto and kept in IndexedDB beside the session, and a
// relaunch, a new tab or a restarted daemon opens it again with no password. Sign-out, a revoked session and every 401 remove it. The sealed copy is useless without the non-extractable key, and
// script on the page that could read both could equally read the session token, so this is as strong as the session itself. The Mac app has no OS keychain (ad-hoc signed), which is why the device store is the webview's own.
export interface SealRecord { wrap: CryptoKey; iv: Uint8Array; sealed: Uint8Array }
export interface SealStore { get(): Promise<SealRecord | null>; put(r: SealRecord): Promise<void>; remove(): Promise<void> }

const DB = "vyre-key-seal";
const STORE = "seal";
const ROW = "person-key";

/** The browser's IndexedDB store; null where there is none (the key then lives in memory for the page's life, as before). */
export function indexedDbStore(idb: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB): SealStore | null {
  if (!idb) return null;
  const open = (): Promise<IDBDatabase> => new Promise((res, rej) => {
    const req = idb.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error ?? new Error("The device store did not open."));
  });
  const run = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((res, rej) => { const r = f(db.transaction(STORE, mode).objectStore(STORE)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error ?? new Error("The device store failed.")); });
    } finally { db.close(); }
  };
  return {
    get: async () => ((await run("readonly", (s) => s.get(ROW) as IDBRequest<SealRecord | undefined>)) ?? null),
    put: async (r) => { await run("readwrite", (s) => s.put(r, ROW)); },
    remove: async () => { await run("readwrite", (s) => s.delete(ROW)); },
  };
}

const subtle = (): SubtleCrypto | null => (globalThis as { crypto?: Crypto }).crypto?.subtle ?? null;

/** Seals the 32-byte key into the store. False when this device cannot (no WebCrypto or no store): nothing is written and the caller keeps the key in memory only. */
export async function sealKey(store: SealStore | null, key: Uint8Array): Promise<boolean> {
  const sub = subtle();
  if (!sub || !store || key.length !== 32) return false;
  try {
    const wrap = await sub.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await sub.encrypt({ name: "AES-GCM", iv }, wrap, key));
    await store.put({ wrap, iv, sealed });
    return true;
  } catch { return false; }
}

/** The sealed key, or null when there is none or it cannot be opened (a wiped store). The caller wipes the copy it is given. */
export async function unsealKey(store: SealStore | null): Promise<Uint8Array | null> {
  const sub = subtle();
  if (!sub || !store) return null;
  try {
    const r = await store.get();
    if (!r) return null;
    const key = new Uint8Array(await sub.decrypt({ name: "AES-GCM", iv: r.iv }, r.wrap, r.sealed));
    return key.length === 32 ? key : null;
  } catch { return null; }
}

export async function unsealGone(store: SealStore | null): Promise<void> { try { await store?.remove(); } catch { /* nothing kept */ } }
