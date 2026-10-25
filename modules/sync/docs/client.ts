// Client binding of long text documents (ARCH 5.6, 5.10). One Y.Doc per open document, kept in `doc_local` so an edit made offline survives a restart and merges when the socket returns.
//   open          loads the local state at once (no network wait) and, when a link is attached, starts the handshake: sync1 with this device's state vector.
//   local edit    saved to doc_local in the same tick, sent as ydoc.update when a link is up, otherwise left dirty. Re-attaching always runs the handshake, so a frame lost in a drop is repaired.
//   private (enc 2) every update is sealed on the device with the person's key before it leaves; the server relays ciphertext it cannot read. Remote ciphertext is opened here.
//   revoked       the server sends data.dropped: the document is closed and removed from this device (the purge path does the same for the whole Space).
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness.js";
import type { Frame } from "../../../sync/src/protocol.ts";
import type { SqlDriver } from "../../../sync/src/replica/types.ts";
import { fromB64, isEmptyUpdate, toB64 } from "./b64.ts";
import { BODY, CONTENT, newDoc, toMarkdown } from "./markdown.ts";
import type { DocEnc } from "./store.ts";

export interface DocLocalRow { state: Uint8Array | null; sv: Uint8Array | null; dirty: boolean }

/** Where a device keeps its copy of each document (the `doc_local` table). */
export interface DocLocalStore {
  get(doc: string): DocLocalRow | undefined;
  put(doc: string, row: DocLocalRow): void;
  remove(doc: string): void;
  removeAll(): void;
}

export function memoryDocStore(): DocLocalStore & { has(doc: string): boolean; size(): number } {
  const m = new Map<string, DocLocalRow>();
  return {
    get: (doc) => m.get(doc),
    put: (doc, row) => { m.set(doc, row); },
    remove: (doc) => { m.delete(doc); },
    removeAll: () => { m.clear(); },
    has: (doc) => m.has(doc),
    size: () => m.size,
  };
}

/** `doc_local` over a replica driver. A driver that queues its work (wa-sqlite) answers a read with nothing until it has flushed, so a document opened that early starts empty and the handshake fills it. */
export function sqlDocStore(driver: SqlDriver): DocLocalStore {
  const bytes = (v: unknown): Uint8Array | null => (v instanceof Uint8Array ? v : null);
  return {
    get(doc) {
      let r;
      try { r = driver.prepare("SELECT state, sv, dirty FROM doc_local WHERE doc = ?").get([doc]); } catch { return undefined; }
      return r ? { state: bytes(r["state"]), sv: bytes(r["sv"]), dirty: r["dirty"] === 1 } : undefined;
    },
    put(doc, row) {
      driver.prepare("INSERT INTO doc_local (doc, state, sv, dirty) VALUES (?, ?, ?, ?) ON CONFLICT(doc) DO UPDATE SET state = excluded.state, sv = excluded.sv, dirty = excluded.dirty").run([doc, row.state, row.sv, row.dirty ? 1 : 0]);
    },
    remove(doc) { driver.prepare("DELETE FROM doc_local WHERE doc = ?").run([doc]); },
    removeAll() { driver.prepare("DELETE FROM doc_local").run([]); },
  };
}

/** Seals one update on the device. The server stores what `seal` returns and nothing else. */
export interface DocCrypto {
  seal(plain: Uint8Array): Promise<Uint8Array>;
  open(sealed: Uint8Array): Promise<Uint8Array>;
}

/** AES-256-GCM with a fresh 12 byte nonce in front of each sealed update. `key` is the person's 32 byte document key (it never leaves the device in the clear). */
export function aesDocCrypto(key: Uint8Array): DocCrypto {
  const imported = crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
  return {
    async seal(plain) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await imported, plain as BufferSource));
      const out = new Uint8Array(12 + ct.length);
      out.set(iv, 0);
      out.set(ct, 12);
      return out;
    },
    async open(sealed) {
      if (sealed.length < 13) throw new Error("sealed update is too short");
      return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.slice(0, 12) as BufferSource }, await imported, sealed.slice(12) as BufferSource));
    },
  };
}

export interface DocLink { send(f: Frame): void }

export interface DocClientOpts {
  store: DocLocalStore;
  /** Needed to open a private (enc 2) document. */
  crypto?: DocCrypto;
  /** The server refused or removed a document. `dropped` means the copy on this device was removed too. */
  onProblem?(doc: string, problem: { code: string; message: string; dropped: boolean }): void;
}

export interface OpenOpts { enc?: DocEnc }

export interface DocBinding {
  readonly id: string;
  readonly enc: DocEnc;
  readonly ydoc: Y.Doc;
  text(): Y.Text;
  fragment(): Y.XmlFragment;
  markdown(): string;
  /** Local changes that have not gone out over a live link yet. */
  dirty(): boolean;
  /** Presence for this document. Not available on a private document. */
  awareness(): Awareness | null;
  /** Everything queued (sealing, sending, saving) has finished. */
  idle(): Promise<void>;
  /** Stop observing; the local copy stays. */
  close(): void;
}

/** The id convention for a row's documents: `<entity>:<id>` for the main one, `<entity>:<id>:<field>` for one text field. The purge client's OpenDocs port (sync/src/purge) is this shape. */
export const docPrefix = (entity: string, id: string): string => `${entity}:${id}`;

export interface DocClient {
  /** Close and forget the documents of one row. */
  closeFor(entity: string, id: string): void;
  /** Close and forget every open document. */
  closeAll(): void;
  open(id: string, o?: OpenOpts): DocBinding;
  /** A socket came up (or went away with null). Every open document starts its handshake on attach. */
  attach(link: DocLink | null): void;
  /** A ydoc.* frame from the server. Resolves when the frame has been applied. */
  onFrame(f: Frame): Promise<void>;
  /** Close a document and remove its local copy. */
  forget(id: string): void;
  openIds(): string[];
  /** For a private document: the sealed snapshot and the seq it covers, ready for sync.doc.compact. Null until the first handshake. */
  compactionOf(id: string): Promise<{ doc: string; upto: number; snapshot: string } | null>;
}

const REMOTE = { remote: true };
const LOADED = { loaded: true };

export function createDocClient(o: DocClientOpts): DocClient {
  const bindings = new Map<string, Impl>();
  let link: DocLink | null = null;

  interface Impl extends DocBinding { frame(f: Frame): Promise<void>; enqueue(f: Frame): Promise<void>; handshake(): void; upto(): number; destroy(forgetLocal: boolean): void }

  function open(id: string, oo: OpenOpts = {}): Impl {
    const have = bindings.get(id);
    if (have) return have;
    const enc: DocEnc = oo.enc === 2 ? 2 : 0;
    if (enc === 2 && !o.crypto) throw new Error("a private document needs the person's document key");
    const ydoc = newDoc();
    const saved = o.store.get(id);
    if (saved?.state) Y.applyUpdate(ydoc, saved.state, LOADED);
    let dirty = saved?.dirty ?? false;
    let confirmed = 0;
    let awareness: Awareness | null = null;
    let tail: Promise<void> = Promise.resolve();
    let frames: Promise<void> = Promise.resolve();
    let saveQueued = false;
    let closed = false;

    const queue = (fn: () => Promise<void> | void): void => { tail = tail.then(fn).catch(() => undefined); };

    function save(): void {
      o.store.put(id, { state: Y.encodeStateAsUpdate(ydoc), sv: Y.encodeStateVector(ydoc), dirty });
    }
    function saveSoon(): void {
      if (saveQueued) return;
      saveQueued = true;
      queueMicrotask(() => { saveQueued = false; if (!closed) save(); });
    }

    function send(t: "ydoc.sync1" | "ydoc.sync2" | "ydoc.update" | "ydoc.awareness", data: unknown): void {
      link?.send({ t, doc: id, data } as Frame);
    }

    /** Send bytes out, sealed for a private document. Order is kept by the queue. */
    function ship(t: "ydoc.sync2" | "ydoc.update", u: Uint8Array): void {
      if (enc === 2) {
        queue(async () => { if (link) send(t, { update: toB64(await o.crypto!.seal(u)), enc: 2 }); });
      } else {
        send(t, { update: toB64(u), enc: 0 });
      }
    }

    ydoc.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin === REMOTE || origin === LOADED || closed) return;
      if (link) { ship("ydoc.update", u); dirty = false; } else dirty = true;
      saveSoon();
    });

    const impl: Impl = {
      id, enc, ydoc,
      text: () => ydoc.getText(BODY),
      fragment: () => ydoc.getXmlFragment(CONTENT),
      markdown: () => toMarkdown(ydoc),
      dirty: () => dirty,
      awareness() {
        if (enc === 2) return null;
        if (!awareness) {
          const a = new Awareness(ydoc);
          a.on("update", (ch: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
            if (origin === REMOTE || !link || closed) return;
            send("ydoc.awareness", { update: toB64(encodeAwarenessUpdate(a, [...ch.added, ...ch.updated, ...ch.removed])) });
          });
          awareness = a;
        }
        return awareness;
      },
      idle: async () => { await frames; await tail; },
      close() { impl.destroy(false); },
      upto: () => confirmed,
      // Frames of one document are applied one at a time, in arrival order, even when opening a sealed update takes a turn.
      enqueue(f) {
        const run = frames.then(() => impl.frame(f));
        frames = run.catch(() => undefined);
        return run;
      },
      handshake() {
        // A private document has no state vector the server could use: it sends everything and this device answers with what the server lacks.
        send("ydoc.sync1", enc === 2 ? {} : { sv: toB64(Y.encodeStateVector(ydoc)) });
      },
      destroy(forgetLocal) {
        if (closed) return;
        if (!forgetLocal) save();
        closed = true;
        awareness?.destroy();
        bindings.delete(id);
        if (forgetLocal) o.store.remove(id);
      },
      async frame(f) {
        const data = (f.t.startsWith("ydoc.") ? (f as { data: unknown }).data : null) as Record<string, unknown> | null;
        if (!data || typeof data !== "object") return;
        const err = data["error"] as { code?: unknown; message?: unknown } | undefined;
        if (err && typeof err.code === "string") {
          const gone = data["dropped"] === true;
          o.onProblem?.(id, { code: err.code, message: typeof err.message === "string" ? err.message : "", dropped: gone });
          if (gone) impl.destroy(true);
          return;
        }
        if (f.t === "ydoc.awareness") {
          if (awareness && typeof data["update"] === "string") applyAwarenessUpdate(awareness, fromB64(data["update"]), REMOTE);
          return;
        }
        // Frames reach this device in the order the server sent them, so a seq seen here means every lower seq was seen too (the handshake carried the rest).
        if (typeof data["upto"] === "number") confirmed = Math.max(confirmed, data["upto"]);
        if (typeof data["ack"] === "number") { confirmed = Math.max(confirmed, data["ack"]); return; }
        if (f.t === "ydoc.update" && typeof data["seq"] === "number") confirmed = Math.max(confirmed, data["seq"]);
        if (f.t === "ydoc.sync1") {
          // The server's state vector: send what it lacks.
          if (enc === 0 && typeof data["sv"] === "string") {
            const diff = Y.encodeStateAsUpdate(ydoc, fromB64(data["sv"]));
            if (!isEmptyUpdate(diff)) ship("ydoc.sync2", diff);
            dirty = false;
            saveSoon();
          }
          return;
        }
        // sync2 or a relayed update
        if (enc === 0) {
          if (typeof data["update"] === "string" && data["update"].length > 0) Y.applyUpdate(ydoc, fromB64(data["update"]), REMOTE);
          saveSoon();
          return;
        }
        const blobs: string[] = [];
        if (typeof data["snapshot"] === "string") blobs.push(data["snapshot"]);
        if (Array.isArray(data["updates"])) for (const u of data["updates"]) if (typeof u === "string") blobs.push(u);
        if (typeof data["update"] === "string" && data["update"].length > 0) blobs.push(data["update"]);
        const known = new Y.Doc();
        for (const b of blobs) {
          const plain = await o.crypto!.open(fromB64(b));
          Y.applyUpdate(known, plain);
          Y.applyUpdate(ydoc, plain, REMOTE);
        }
        if (f.t === "ydoc.sync2" && !data["update"]) {
          // The handshake answer: what the server lacks is whatever this device has beyond what it just sent.
          const diff = Y.encodeStateAsUpdate(ydoc, Y.encodeStateVector(known));
          if (!isEmptyUpdate(diff)) ship("ydoc.sync2", diff);
          dirty = false;
        }
        saveSoon();
      },
    };
    bindings.set(id, impl);
    if (link) impl.handshake();
    return impl;
  }

  const prefixed = (id: string, entity: string, row: string): boolean => id === docPrefix(entity, row) || id.startsWith(`${docPrefix(entity, row)}:`);

  return {
    open,
    attach(l) {
      link = l;
      if (l) for (const b of bindings.values()) b.handshake();
    },
    async onFrame(f) {
      if (f.t !== "ydoc.sync1" && f.t !== "ydoc.sync2" && f.t !== "ydoc.update" && f.t !== "ydoc.awareness") return;
      const b = bindings.get(f.doc);
      if (b) await b.enqueue(f);
    },
    forget(id) { const b = bindings.get(id); if (b) b.destroy(true); else o.store.remove(id); },
    openIds: () => [...bindings.keys()],
    async compactionOf(id) {
      const b = bindings.get(id);
      if (!b || b.enc !== 2 || b.upto() < 1) return null;
      await b.idle();
      return { doc: id, upto: b.upto(), snapshot: toB64(await o.crypto!.seal(Y.encodeStateAsUpdate(b.ydoc))) };
    },
    closeFor(entity, row) { for (const [id, b] of [...bindings]) if (prefixed(id, entity, row)) b.destroy(true); },
    closeAll() { for (const b of [...bindings.values()]) b.destroy(true); },
  };
}

/** Attribution layer: text written by an agent or a person carries its author, and a suggestion carries `suggest` until someone agrees. The Markdown projection ignores both. */
export function attributedInsert(text: Y.Text, index: number, content: string, author: string, suggest = false): void {
  text.insert(index, content, suggest ? { author, suggest: true } : { author });
}

export interface Span { index: number; length: number; author: string; suggest: boolean }

export function spansOf(text: Y.Text): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const d of text.toDelta() as { insert?: unknown; attributes?: Record<string, unknown> }[]) {
    if (typeof d.insert !== "string") continue;
    const author = d.attributes?.["author"];
    if (typeof author === "string") out.push({ index: at, length: d.insert.length, author, suggest: d.attributes?.["suggest"] === true });
    at += d.insert.length;
  }
  return out;
}

/** Agree to a suggested span: the text stays, the mark goes. */
export function agreeSpan(text: Y.Text, index: number, length: number): void {
  text.format(index, length, { suggest: null });
}
