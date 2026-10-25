// Document frames on the live socket (ARCH 5.6, 5.9): ydoc.sync1, ydoc.sync2, ydoc.update, ydoc.awareness. The live hub hands every frame it does not own to `onFrame`; the gateway also tells this layer
// when a socket opens (attach) so it has a way to answer. Access is checked at subscribe and on every update, and a subscriber whose view is gone is dropped while the socket stays open.
//   client -> server   sync1 {sv}                      "this is what I have": the server answers sync2 with what the client lacks and sync1 with its own state vector
//                      sync2 {update}                  the client's answer to the server's sync1 (what the server lacks)
//                      update {update, enc?, suggest?} one live edit; the server stores it and relays it to the other subscribers
//                      awareness {update}              cursors and presence, relayed and never stored
//   server -> client   the same four, plus sync2 {ack: seq} to the writer of an update. A frame with data.error is a refusal; with data.dropped the client must close the document and remove its local copy.
import type { Frame } from "../../../sync/src/protocol.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { fromB64 } from "./b64.ts";
import type { DocServer } from "./server.ts";

type YFrame = Extract<Frame, { doc: string }>;
export type DocFrameType = YFrame["t"];

/** Whoever sits behind a socket. The hub's LiveWho fits. */
export interface DocPeer { person: string; device: string }

export interface DocLive {
  /** A socket opened. Returns the detach to call when it closes. */
  attach(who: DocPeer, send: (f: Frame) => void): () => void;
  /** A ydoc.* frame from that socket. Anything else is ignored. */
  onFrame(who: DocPeer, f: Frame): void;
  /** Drop every subscriber who can no longer view (of one document, or all). Returns how many were dropped. */
  revalidate(doc?: string): number;
  subscribers(doc: string): number;
}

interface Conn { who: DocPeer; send(f: Frame): void; docs: Set<string> }

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function errorOf(e: unknown): { code: string; message: string } {
  if (e instanceof VyreErr) return { code: e.error.code, message: e.error.message };
  return { code: "internal.unexpected", message: "The document could not be updated." };
}

export function createDocLive(server: DocServer, o: { traceId?: () => string } = {}): DocLive {
  const conns = new Map<DocPeer, Conn>();
  const subs = new Map<string, Set<Conn>>();
  const trace = o.traceId ?? ((): string => globalThis.crypto.randomUUID().replace(/-/g, ""));

  const frame = (t: DocFrameType, doc: string, data: unknown): Frame => ({ t, doc, data } as Frame);

  function join(c: Conn, doc: string): void {
    c.docs.add(doc);
    let set = subs.get(doc);
    if (!set) subs.set(doc, (set = new Set()));
    set.add(c);
  }
  function leave(c: Conn, doc: string): void {
    c.docs.delete(doc);
    const set = subs.get(doc);
    if (set) { set.delete(c); if (set.size === 0) subs.delete(doc); }
  }
  function drop(c: Conn, doc: string, err: { code: string; message: string }): void {
    leave(c, doc);
    c.send(frame("ydoc.sync2", doc, { dropped: true, error: err }));
  }

  function onSync1(c: Conn, doc: string, data: Record<string, unknown>): void {
    const tr = trace();
    try {
      const sv = str(data["sv"]);
      const out = server.open(c.who.person, sv ? { doc, sv } : { doc }, tr);
      join(c, doc);
      if (out.enc === 2) {
        c.send(frame("ydoc.sync2", doc, { enc: 2, ...(out.snapshot ? { snapshot: out.snapshot } : {}), updates: out.updates, upto: out.upto }));
      } else {
        c.send(frame("ydoc.sync2", doc, { enc: 0, update: out.snapshot ?? out.updates[0] ?? "", upto: out.upto }));
        // The client now answers with the part the server lacks (a sync2).
        c.send(frame("ydoc.sync1", doc, { sv: out.sv }));
      }
    } catch (e) {
      const err = errorOf(e);
      if (err.code.startsWith("permission.") || err.code === "validation.not_found") drop(c, doc, err);
      else c.send(frame("ydoc.sync2", doc, { error: err }));
    }
  }

  function onUpdate(c: Conn, doc: string, data: Record<string, unknown>): void {
    const tr = str(data["tr"]) ?? trace();
    const update = str(data["update"]);
    if (update === undefined) { c.send(frame("ydoc.sync2", doc, { error: { code: "validation.bad_input", message: "The frame has no update." } })); return; }
    const enc = typeof data["enc"] === "number" ? data["enc"] : undefined;
    const suggest = data["suggest"] === true;
    try {
      const r = server.update(c.who.person, { doc, update, ...(enc !== undefined ? { enc } : {}), suggest }, tr);
      join(c, doc);
      // The writer learns the seq its update took: with it, a device knows which state it holds for sure.
      c.send(frame("ydoc.sync2", doc, { ack: r.seq }));
      const relay = frame("ydoc.update", doc, { update, enc: enc ?? 0, suggest, seq: r.seq, actor: c.who.person });
      for (const other of [...(subs.get(doc) ?? [])]) {
        if (other === c) continue;
        if (!server.allowed(other.who.person, doc, "view")) { drop(other, doc, { code: "permission.revoked", message: "You no longer have access to this document." }); continue; }
        other.send(relay);
      }
    } catch (e) {
      const err = errorOf(e);
      // A refused edit tells the client why; a lost view also removes the document from the device.
      if (err.code.startsWith("permission.") && !server.allowed(c.who.person, doc, "view")) drop(c, doc, err);
      else c.send(frame("ydoc.sync2", doc, { error: err }));
    }
  }

  function onAwareness(c: Conn, doc: string, data: Record<string, unknown>): void {
    if (!c.docs.has(doc)) return;
    if (!server.allowed(c.who.person, doc, "view")) { drop(c, doc, { code: "permission.revoked", message: "You no longer have access to this document." }); return; }
    const update = str(data["update"]);
    if (update === undefined) return;
    try { fromB64(update); } catch { return; }
    const relay = frame("ydoc.awareness", doc, { update });
    for (const other of subs.get(doc) ?? []) if (other !== c) other.send(relay);
  }

  return {
    attach(who, send) {
      const c: Conn = { who, send, docs: new Set() };
      conns.set(who, c);
      return () => {
        for (const doc of [...c.docs]) leave(c, doc);
        if (conns.get(who) === c) conns.delete(who);
      };
    },
    onFrame(who, f) {
      const c = conns.get(who);
      if (!c) return;
      if (f.t !== "ydoc.sync1" && f.t !== "ydoc.sync2" && f.t !== "ydoc.update" && f.t !== "ydoc.awareness") return;
      const data = rec(f.data);
      if (f.t === "ydoc.sync1") onSync1(c, f.doc, data);
      else if (f.t === "ydoc.sync2" || f.t === "ydoc.update") onUpdate(c, f.doc, data);
      else onAwareness(c, f.doc, data);
    },
    revalidate(doc) {
      let n = 0;
      for (const [name, set] of [...subs]) {
        if (doc !== undefined && name !== doc) continue;
        for (const c of [...set]) {
          if (!server.allowed(c.who.person, name, "view")) { drop(c, name, { code: "permission.revoked", message: "You no longer have access to this document." }); n++; }
        }
      }
      return n;
    },
    subscribers: (doc) => subs.get(doc)?.size ?? 0,
  };
}
