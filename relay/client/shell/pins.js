// @ts-check
// The box key this phone trusts for a name, kept in this origin's IndexedDB. It comes only from the link the person opened (the fragment, which never reaches a server), or from the box itself inside
// a channel such a link opened (an invite's join), never from the relay.

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

/** @param {string} key @returns {Promise<string | null>} */
const read = async key => { const v = await run("readonly", s => s.get(key)); return typeof v === "string" && BOX_RE.test(v) ? v : null; };

export const pins = {
  /** @param {string} name @returns {Promise<string | null>} the box key, base64url */
  async get(name) { return read(name); },
  /** @param {string} name @param {string} box */
  async set(name, box) { if (!BOX_RE.test(box)) throw new Error("not a box key"); await run("readwrite", s => s.put(box, name)); },
  /** The key an invite link carried, kept apart from the box pin: the box answers it only while that invite is open, and only with the join page. @param {string} name @returns {Promise<string | null>} */
  async getInvite(name) { return read(`invite:${name}`); },
  /** @param {string} name @param {string} key */
  async setInvite(name, key) { if (!BOX_RE.test(key)) throw new Error("not an invite key"); await run("readwrite", s => s.put(key, `invite:${name}`)); },
  /** @param {string} name */
  async dropInvite(name) { await run("readwrite", s => s.delete(`invite:${name}`)); },
};
