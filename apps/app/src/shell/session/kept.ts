// What this device keeps of a Space between launches so the first screen draws at once (r41): the answers the screens read last time, and the few facts a session opens from (who you are, the
// Space's card). On the next open the session starts from them in the same frame and reads everything again; what changed is drawn in place. Nothing here is trusted: every answer is asked for
// again at once, and one the server refuses is dropped.
//   whose        one record per Space and person (and the Space's address when it is not on this computer). Another person, or another Space, never reads it.
//   what         only reads on the list below (lists and pages a person sees). Never the Vault, keys, sign-in or connection secrets, invite or share links, or the Console.
//   how long     an answer not read again for 7 days goes; the record is capped in rows and bytes, oldest first.
//   forgotten    on sign-out, on a session the server ended (401), on a purge, and when the Space at the address is no longer the one the session was made with. Forgetting takes effect at once:
//                a mark in localStorage voids the record before the stored copy is deleted, so a tab closed mid-delete cannot bring it back.
// The stored copy is in IndexedDB (the answers are too large for localStorage, which also holds the sign-in), encrypted with AES-GCM under a key the browser holds and cannot export
// (a copy of the profile's files on disk does not read as answers; a page script of this origin still can, as it can read anything the app reads). A browser without it keeps nothing and the app opens as it did before.
import { stableJson } from "./stable-json.ts";

export interface KeptRead {
  cap: string;
  input: Record<string, unknown>;
  data: unknown;
  /** when the server last gave this answer */
  at: number;
  /** the size of the answer as text, for the cap */
  size: number;
}

/** The answers a session opens from (session.ts): each exactly as the capability gave it. */
export interface KeptBoot {
  who: unknown;
  space: unknown;
  switcher: unknown;
  kit: unknown;
  face: unknown;
  console: boolean;
  at: number;
}

export interface KeptSpace {
  v: 1;
  key: string;
  /** when anything in it was last written */
  at: number;
  boot?: KeptBoot;
  reads: Record<string, KeptRead>;
}

/** Where the record is stored. The browser's is IndexedDB; a test hands in its own. */
export interface KeptStore {
  get(key: string): Promise<KeptSpace | null>;
  /** `alive` is asked right before the copy is written (after it was sealed): false means the record was forgotten meanwhile and nothing is written. */
  put(value: KeptSpace, alive?: () => boolean): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export const KEPT_MAX_READS = 400;
export const KEPT_MAX_BYTES = 4_000_000;
export const KEPT_MAX_READ_BYTES = 400_000;
export const KEPT_MAX_AGE_MS = 7 * 24 * 3_600_000;
const VOID_KEY = "vyre.kept.void.v1";
const HAS_KEY = "vyre.kept.has.v1";
const FLUSH_MS = 1_200;

/**
 * The reads that may be kept: what a person sees in a list or on a page. A capability is kept when its name starts with one of these. Left out on purpose: vault.*, identity.*, providers.*,
 * connections secrets (connections.list names the connections and their state only), devices.*, members.*, console.*, anything that makes or shows a link or a key, and every write.
 */
export const KEPT_CAPS: readonly string[] = [
  "access.groups.list",
  "access.principals.list",
  "agents.erased",
  "agents.list",
  "automations.groups.list",
  "automations.home",
  "automations.list",
  "automations.personal",
  "automations.space",
  "channels.get",
  "channels.home",
  "channels.list",
  "chat.messages.list",
  "chat.people_status",
  "chat.pins.list",
  "chat.recent",
  "chat.thread",
  "chats.private",
  "chats.sidebar",
  "connections.list",
  "engine.accounts.list",
  "engine.last_pick.get",
  "files.folder.get",
  "files.list",
  "files.recent",
  "files.tree",
  "folders.list",
  "follows.list",
  "goals.",
  "notes.list",
  "notifications.kinds.list",
  "notifications.mute.list",
  "projects.",
  "records.counts",
  "records.query",
  "records.view",
  "schema.",
  "settings.kit.get",
  "spaces.onboarding.flow",
  "spaces.switcher",
  "state.layout.get",
  "tasks.count_needs_you",
  "tasks.index",
  "tasks.list",
  "tasks.my_work",
  "tasks.needs_you",
];

export function mayKeep(cap: string): boolean {
  for (const p of KEPT_CAPS) if (p.endsWith(".") ? cap.startsWith(p) : cap === p) return true;
  return false;
}

const isLoopback = (baseUrl: string): boolean => {
  try {
    const h = new URL(baseUrl).hostname.toLowerCase();
    return h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
};

/** One record per Space and person. A Space on this computer answers on a new port after every restart, so its address is not part of the name; any other Space is named with its address. */
export function keptKey(s: { baseUrl: string; personId: string; spaceId: string }): string {
  return [s.spaceId, s.personId, isLoopback(s.baseUrl) ? "local" : s.baseUrl].join("\n");
}

export const readKey = (cap: string, input: Record<string, unknown>): string => `${cap}\u0000${stableJson(input)}`;

type Local = Pick<Storage, "getItem" | "setItem">;
const local = (): Local | undefined => {
  try {
    return (globalThis as { localStorage?: Local }).localStorage;
  } catch {
    return undefined;
  }
};

/** When each record was told to be forgotten ("*" is all of them): a record written before that is never read again. */
function voids(ls: Local | undefined): Record<string, number> {
  try {
    const raw = ls?.getItem(VOID_KEY);
    const j: unknown = raw ? JSON.parse(raw) : null;
    return j !== null && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function voided(rec: KeptSpace, ls: Local | undefined): boolean {
  const v = voids(ls);
  return rec.at <= Math.max(v["*"] ?? 0, v[rec.key] ?? 0);
}

/** Which records hold the facts a session opens from, by key: read in one step at launch, before the store itself answers, so the app knows a first screen is coming from this device (has()). */
function hints(ls: Local | undefined): Record<string, number> {
  try {
    const raw = ls?.getItem(HAS_KEY);
    const j: unknown = raw ? JSON.parse(raw) : null;
    return j !== null && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, number>) : {};
  } catch {
    return {};
  }
}
function hint(ls: Local | undefined, key: string | null, at: number | null): void {
  try {
    const h = key === null ? {} : hints(ls);
    if (key !== null) {
      if (at === null) delete h[key];
      else h[key] = at;
    }
    ls?.setItem(HAS_KEY, JSON.stringify(h));
  } catch {
    /* blocked storage: the app opens as it did before */
  }
}

/** The key that seals the stored copy: made once, kept by the browser as a key it will not hand out. Null where the browser has no WebCrypto (the app then keeps nothing). */
let sealKey: Promise<CryptoKey | null> | null = null;
function theSealKey(): Promise<CryptoKey | null> {
  const g = globalThis as { crypto?: Crypto; indexedDB?: IDBFactory };
  const subtle = g.crypto?.subtle;
  const idb = g.indexedDB;
  if (!subtle || !idb) return Promise.resolve(null);
  return (sealKey ??= new Promise<CryptoKey | null>((resolve) => {
    const req = idb.open("vyre-kept-key", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("k")) req.result.createObjectStore("k");
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
    req.onsuccess = () => {
      const d = req.result;
      const get = d.transaction("k", "readonly").objectStore("k").get("seal");
      get.onerror = () => resolve(null);
      get.onsuccess = () => {
        if (get.result) return resolve(get.result as CryptoKey);
        subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]).then(
          (k) => {
            const tx = d.transaction("k", "readwrite");
            tx.objectStore("k").put(k, "seal");
            tx.oncomplete = () => resolve(k);
            tx.onerror = () => resolve(null);
            tx.onabort = () => resolve(null);
          },
          () => resolve(null),
        );
      };
    };
  }).then((k) => {
    if (k === null) sealKey = null;
    return k;
  }));
}

export interface Sealed {
  key: string;
  v: 2;
  at: number;
  iv: ArrayBuffer;
  ct: ArrayBuffer;
}

async function seal(rec: KeptSpace): Promise<Sealed> {
  const key = await theSealKey();
  if (key === null) throw new Error("no key to seal the kept answers with");
  return sealWith(key, rec);
}

/** Seals one record under a key (exported for the test, which has no browser store). */
export async function sealWith(key: CryptoKey, rec: KeptSpace): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify({ boot: rec.boot, reads: rec.reads })),
  );
  return { key: rec.key, v: 2, at: rec.at, iv: iv.buffer as ArrayBuffer, ct };
}

async function unseal(v: unknown): Promise<KeptSpace | null> {
  const key = await theSealKey();
  return key === null ? null : unsealWith(key, v);
}

/** Opens a sealed record; null when it was not sealed under this key or was changed. */
export async function unsealWith(key: CryptoKey, v: unknown): Promise<KeptSpace | null> {
  try {
    const s = v as Sealed;
    if (!s || s.v !== 2 || typeof s.key !== "string" || typeof s.at !== "number") return null;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: s.iv }, key, s.ct);
    const j = JSON.parse(new TextDecoder().decode(plain)) as { boot?: KeptBoot; reads?: Record<string, KeptRead> };
    return { v: 1, key: s.key, at: s.at, ...(j.boot ? { boot: j.boot } : {}), reads: j.reads ?? {} };
  } catch {
    return null;
  }
}

/** IndexedDB, one object store, one record per key. Null where the browser has none (a private window that blocks it, a test without a page). */
export function browserKeptStore(): KeptStore | null {
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!idb) return null;
  let opening: Promise<IDBDatabase> | null = null;
  const db = (): Promise<IDBDatabase> =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open("vyre-kept", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("spaces")) req.result.createObjectStore("spaces", { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("the browser did not open its store"));
      req.onblocked = () => reject(new Error("the browser's store is busy"));
    }).catch((e: unknown) => {
      opening = null;
      throw e;
    }));
  const run = <T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    db().then(
      (d) =>
        new Promise<T>((resolve, reject) => {
          const tx = d.transaction("spaces", mode);
          const req = work(tx.objectStore("spaces"));
          tx.oncomplete = () => resolve(req.result);
          tx.onerror = () => reject(tx.error ?? new Error("the browser's store refused"));
          tx.onabort = () => reject(tx.error ?? new Error("the browser's store refused"));
        }),
    );
  return {
    get: (key) =>
      run<unknown>("readonly", (s) => s.get(key) as IDBRequest<unknown>).then(async (v) => {
        if (v === undefined) return null;
        const open = await unseal(v);
        // a record that cannot be opened (the key was lost, the copy was changed) is gone, not an error
        if (open === null) void run("readwrite", (s) => s.delete(key)).catch(() => undefined);
        return open;
      }),
    put: async (value, alive) => {
      const sealed = await seal(value);
      if (alive && !alive()) return; // signed out while the copy was being sealed: it never lands
      await run("readwrite", (s) => s.put(sealed));
    },
    delete: (key) => run("readwrite", (s) => s.delete(key)).then(() => undefined),
    clear: () => run("readwrite", (s) => s.clear()).then(() => undefined),
  };
}

export interface KeptOptions {
  store?: KeptStore | null;
  local?: Local | undefined;
  now?: () => number;
  /** Runs a write later (idle); a test runs it at once. */
  later?: (fn: () => void, ms: number) => () => void;
}

/** What a session reads and writes of its own record. */
export interface KeptSession {
  /** The facts the session can open from, when they were kept. */
  boot(): KeptBoot | null;
  saveBoot(b: Omit<KeptBoot, "at">): void;
  /** The kept answer of a read, if there is one. */
  read(cap: string, input: Record<string, unknown>): { data: unknown } | undefined;
  /** The server answered a read: keep it when it is one of the reads that may be kept. `size` is the answer's length as text. */
  wrote(cap: string, input: Record<string, unknown>, data: unknown, size: number): void;
  /** The server refused a read: what was kept of it goes. */
  drop(cap: string, input: Record<string, unknown>): void;
  /** Write what changed to the store now (the page is being hidden or closed). */
  flush(): void;
}

export interface Kept {
  /** Start reading a record from the store. Safe to call again; the answer is kept in memory. */
  warm(who: { baseUrl: string; personId: string; spaceId: string }): Promise<KeptSpace | null>;
  /** Whether this device holds the facts a session for this person and Space can open from. Answered at once (a mark beside the sign-in), before the store has been read. */
  has(who: { baseUrl: string; personId: string; spaceId: string }): boolean;
  /** The record if it has been read from the store already, else null: a session never waits for it. */
  ready(who: { baseUrl: string; personId: string; spaceId: string }): KeptSpace | null;
  session(who: { baseUrl: string; personId: string; spaceId: string }): KeptSession;
  /** Forget one record (a sign-out, a purge, a Space that changed), or all of them when no one is named. */
  forget(who?: { baseUrl: string; personId: string; spaceId: string }): void;
}

export function createKept(o: KeptOptions = {}): Kept {
  const store = o.store === undefined ? browserKeptStore() : o.store;
  const ls = "local" in o ? o.local : local();
  const now = o.now ?? Date.now;
  const later =
    o.later ??
    ((fn: () => void, ms: number): (() => void) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    });
  const mem = new Map<string, KeptSpace>();
  const loading = new Map<string, Promise<KeptSpace | null>>();
  const dirty = new Map<string, () => void>();
  /** Counts the times a record was forgotten: a session opened before that writes nothing more into it (an answer that arrives after sign-out is not kept). */
  const forgotten = new Map<string, number>();
  let forgotAll = 0;
  const era = (key: string): number => forgotAll * 1_000_000 + (forgotten.get(key) ?? 0);
  /** Writes that were started and have not settled: a forget waits for them and wipes again, so a write in flight at sign-out never survives it. */
  const puts = new Set<Promise<void>>();

  const usable = (rec: KeptSpace | null, key: string): KeptSpace | null => {
    if (!rec || rec.v !== 1 || rec.key !== key || typeof rec.reads !== "object" || rec.reads === null) return null;
    if (voided(rec, ls)) return null;
    const floor = now() - KEPT_MAX_AGE_MS;
    if (rec.at < floor) return null;
    for (const [k, r] of Object.entries(rec.reads)) if (r.at < floor || !mayKeep(r.cap)) delete rec.reads[k];
    if (rec.boot && rec.boot.at < floor) delete rec.boot;
    return rec;
  };

  const write = (key: string): void => {
    dirty.delete(key);
    const rec = mem.get(key);
    if (!rec || !store) return;
    // the oldest answers go first when the record is over its caps
    const rows = Object.entries(rec.reads).sort((a, b) => b[1].at - a[1].at);
    let bytes = 0;
    const keep: Record<string, KeptRead> = {};
    let n = 0;
    for (const [k, r] of rows) {
      if (n >= KEPT_MAX_READS || bytes + r.size > KEPT_MAX_BYTES) break;
      keep[k] = r;
      bytes += r.size;
      n += 1;
    }
    rec.reads = keep;
    const had = hints(ls)[key] !== undefined;
    const born = era(key);
    const done: Promise<void> = store
      .put({ ...rec, reads: keep }, () => era(key) === born)
      .then(
        () => {
          // the mark is written once the record is in the store, and only for one a session can open from
          if (era(key) === born && rec.boot !== undefined && !had && mem.get(key) === rec) hint(ls, key, rec.at);
        },
        () => undefined,
      )
      .finally(() => void puts.delete(done));
    puts.add(done);
  };
  const touch = (key: string): void => {
    const rec = mem.get(key);
    if (!rec) return;
    rec.at = now();
    if (dirty.has(key)) return;
    dirty.set(
      key,
      later(() => write(key), FLUSH_MS),
    );
  };
  const record = (key: string): KeptSpace => {
    let rec = mem.get(key);
    if (!rec) {
      rec = { v: 1, key, at: now(), reads: {} };
      mem.set(key, rec);
    }
    return rec;
  };

  /** A write that was already past its check when the forget came lands after the delete: once every write in flight has settled, delete again. */
  const wipeAgain = (wipe: () => Promise<void> | undefined): void => {
    if (puts.size === 0) return;
    void Promise.allSettled([...puts]).then(() => wipe()?.catch(() => undefined));
  };

  return {
    warm(who) {
      const key = keptKey(who);
      const have = mem.get(key);
      if (have) return Promise.resolve(have);
      let p = loading.get(key);
      if (!p) {
        p = (store ? store.get(key) : Promise.resolve(null)).then(
          (rec) => {
            const ok = usable(rec, key);
            // a record that was read after something was already written here this session keeps what was written
            if (ok && !mem.has(key)) mem.set(key, ok);
            if (!ok && rec) void store?.delete(key).catch(() => undefined);
            if (!ok && !mem.has(key)) hint(ls, key, null);
            return mem.get(key) ?? null;
          },
          () => null,
        );
        loading.set(key, p);
      }
      return p;
    },
    has(who) {
      const key = keptKey(who);
      const at = hints(ls)[key];
      if (at === undefined) return false;
      const v = voids(ls);
      return at > Math.max(v["*"] ?? 0, v[key] ?? 0);
    },
    ready(who) {
      const key = keptKey(who);
      return usable(mem.get(key) ?? null, key);
    },
    session(who) {
      const key = keptKey(who);
      const born = era(key);
      const mine = (): boolean => era(key) === born;
      return {
        boot: () => (mine() ? (usable(mem.get(key) ?? null, key)?.boot ?? null) : null),
        saveBoot(b) {
          if (!mine()) return;
          record(key).boot = { ...b, at: now() };
          touch(key);
        },
        read(cap, input) {
          if (!mine()) return undefined;
          const r = mem.get(key)?.reads[readKey(cap, input)];
          return r && mayKeep(cap) ? { data: r.data } : undefined;
        },
        wrote(cap, input, data, size) {
          if (!mine() || !mayKeep(cap) || size > KEPT_MAX_READ_BYTES) return;
          record(key).reads[readKey(cap, input)] = { cap, input, data, at: now(), size };
          touch(key);
        },
        drop(cap, input) {
          if (!mine()) return;
          const rec = mem.get(key);
          const k = readKey(cap, input);
          if (!rec || !(k in rec.reads)) return;
          delete rec.reads[k];
          touch(key);
        },
        flush() {
          const cancel = dirty.get(key);
          if (!cancel) return;
          cancel();
          write(key);
        },
      };
    },
    forget(who) {
      const key = who ? keptKey(who) : "*";
      // the mark first: it is written at once, so the record is void even if the page closes before the delete is done
      try {
        const v = voids(ls);
        v[key] = now();
        // marks for single records are not needed once everything was voided after them
        if (key === "*") for (const k of Object.keys(v)) if (k !== "*") delete v[k];
        ls?.setItem(VOID_KEY, JSON.stringify(v));
      } catch {
        /* blocked storage: the delete below still runs */
      }
      if (who) forgotten.set(key, (forgotten.get(key) ?? 0) + 1);
      else forgotAll += 1;
      hint(ls, who ? key : null, null);
      if (who) {
        dirty.get(key)?.();
        dirty.delete(key);
        mem.delete(key);
        loading.delete(key);
        void store?.delete(key).catch(() => undefined);
        wipeAgain(() => store?.delete(key));
      } else {
        for (const cancel of dirty.values()) cancel();
        dirty.clear();
        mem.clear();
        loading.clear();
        void store?.clear().catch(() => undefined);
        wipeAgain(() => store?.clear());
      }
    },
  };
}

let shared: Kept | null = null;
/** The one keeper of this page. */
export function kept(): Kept {
  return (shared ??= createKept());
}
export function setKeptForTests(k: Kept | null): void {
  shared = k;
}
