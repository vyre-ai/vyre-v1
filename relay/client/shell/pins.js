// @ts-check
// The box key this phone trusts for a name, kept in this origin's IndexedDB. It comes only from the link the person opened (the fragment, which never reaches a server), never from the relay.

const DB = "vyre-phone", STORE = "pins";
export const BOX_RE = /^[A-Za-z0-9_-]{43}$/;

/** @returns {Promise<IDBDatabase>} */
function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** @template T @param {IDBTransactionMode} mode @param {(s: IDBObjectStore) => IDBRequest<T>} fn @returns {Promise<T>} */
async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => { const r = fn(db.transaction(STORE, mode).objectStore(STORE)); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  } finally { db.close(); }
}

export const pins = {
  /** @param {string} name @returns {Promise<string | null>} the box key, base64url */
  async get(name) { const v = await run("readonly", s => s.get(name)); return typeof v === "string" && BOX_RE.test(v) ? v : null; },
  /** @param {string} name @param {string} box */
  async set(name, box) { if (!BOX_RE.test(box)) throw new Error("not a box key"); await run("readwrite", s => s.put(box, name)); },
};
