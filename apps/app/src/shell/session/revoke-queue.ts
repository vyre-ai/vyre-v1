// The sign-outs whose revoke has not been answered yet (revoke-token.ts). Each holds a live bearer token until the Space has revoked it, so it is never kept as plain text: the list is sealed with AES-GCM under a key the
// browser holds and cannot export (a non-extractable CryptoKey in IndexedDB), and the sealed copy sits in the same store. An entry goes the moment the revoke succeeds or the Space says the token is already invalid, and
// never stays longer than a day. Where the browser has no such store (a private window, blocked storage) nothing is kept: the revoke is still sent once.
export interface Pending {
  baseUrl: string;
  token: string;
  at: number;
}

/** Where the sealed list and its key live. The browser's is IndexedDB; a test hands in its own. */
export interface Backing {
  key(): Promise<CryptoKey>;
  get(): Promise<{ iv: Uint8Array; ct: ArrayBuffer } | null>;
  set(v: { iv: Uint8Array; ct: ArrayBuffer } | null): Promise<void>;
}

export const REVOKE_MAX_AGE_MS = 24 * 3_600_000;
const MAX_KEPT = 8;

export interface RevokeQueue {
  list(): Promise<Pending[]>;
  add(p: Pending): Promise<void>;
  remove(p: { baseUrl: string; token: string }): Promise<void>;
}

const same = (a: { baseUrl: string; token: string }, b: { baseUrl: string; token: string }): boolean =>
  a.baseUrl === b.baseUrl && a.token === b.token;

export function createRevokeQueue(backing: Backing | null, now: () => number = Date.now): RevokeQueue {
  // one operation at a time: a read-change-write of the sealed list never overlaps another
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };
  const read = async (): Promise<Pending[]> => {
    if (!backing) return [];
    try {
      const sealed = await backing.get();
      if (!sealed) return [];
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: sealed.iv as BufferSource },
        await backing.key(),
        sealed.ct,
      );
      const j: unknown = JSON.parse(new TextDecoder().decode(plain));
      return Array.isArray(j)
        ? (j as Pending[]).filter(
            (p) => typeof p?.baseUrl === "string" && typeof p.token === "string" && now() - p.at < REVOKE_MAX_AGE_MS,
          )
        : [];
    } catch {
      return []; // a copy that cannot be opened (the key was lost, the copy was changed) is gone, not an error
    }
  };
  const write = async (list: Pending[]): Promise<void> => {
    if (!backing) return;
    try {
      if (list.length === 0) return await backing.set(null);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        await backing.key(),
        new TextEncoder().encode(JSON.stringify(list.slice(-MAX_KEPT))),
      );
      await backing.set({ iv, ct });
    } catch {
      /* no store: the revoke is still sent, only not remembered */
    }
  };
  return {
    list: () => serial(read),
    add: (p) =>
      serial(async () => {
        await write([...(await read()).filter((q) => !same(q, p)), p]);
      }),
    remove: (p) =>
      serial(async () => {
        await write((await read()).filter((q) => !same(q, p)));
      }),
  };
}

/** The browser's store: one IndexedDB database holding the non-extractable key and the sealed list. Null where there is no IndexedDB or no WebCrypto. */
export function browserBacking(): Backing | null {
  const g = globalThis as { indexedDB?: IDBFactory; crypto?: Crypto };
  if (!g.indexedDB || !g.crypto?.subtle) return null;
  const idb = g.indexedDB;
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const r = idb.open("vyre.revoke.v1", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("s");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error("the browser's store refused"));
    });
  const tx = async <T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const t = db.transaction("s", mode);
        const req = work(t.objectStore("s"));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error ?? new Error("the browser's store refused"));
        t.onabort = () => reject(t.error ?? new Error("the browser's store refused"));
      });
    } finally {
      db.close();
    }
  };
  let key: Promise<CryptoKey> | null = null;
  return {
    key: () =>
      (key ??= (async () => {
        const have = (await tx("readonly", (s) => s.get("key") as IDBRequest<CryptoKey | undefined>)) ?? null;
        if (have) return have;
        const made = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        await tx("readwrite", (s) => s.put(made, "key"));
        return made;
      })()),
    get: async () =>
      (await tx("readonly", (s) => s.get("list") as IDBRequest<{ iv: Uint8Array; ct: ArrayBuffer } | undefined>)) ??
      null,
    set: async (v) => {
      await (v === null ? tx("readwrite", (s) => s.delete("list")) : tx("readwrite", (s) => s.put(v, "list")));
    },
  };
}
