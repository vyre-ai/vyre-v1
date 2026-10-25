// Server half of long text documents (ARCH 5.6). Four capabilities bind to this: open, update, close, compact. Each one asks the access port first, on every call, so a revoked editor is cut off at its next update.
//   plain documents (enc 0)   the server merges: it validates each update, appends it, folds updates into a snapshot with a Markdown projection every 500 updates or 10 minutes, and writes the projection to the owning row.
//   private documents (enc 2) the server stores ciphertext updates blind and in order. It never decodes them, never builds a snapshot, never indexes them. The owner's device folds them and pushes the snapshot (compact).
//   suggestions               an update marked suggest stays a tracked change until a person accepts or rejects it. A fold stops before the oldest pending suggestion.
// Nothing here logs or emits document content: events carry the doc id and a byte size.
import * as Y from "yjs";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { ErrorCode } from "../../../packages/contracts/src/types.ts";
import type { NewEvent } from "../../../kernel/src/log/types.ts";
import type { Tx } from "../../../kernel/src/store/projection.ts";
import { fromB64, isEmptyUpdate, toB64 } from "./b64.ts";
import { BODY, CONTENT, newDoc, toMarkdown } from "./markdown.ts";
import {
  appendUpdate, baseSnapshot, buildDoc, docMeta, dropFolded, ensureDocTables, ensureMeta, firstPendingSuggestion, foldCandidates, headSeq, updateCount, updatesAfter, versions, writeSnapshot,
} from "./store.ts";
import type { DocEnc, DocOwner, StoredUpdate } from "./store.ts";

/** Updates before a fold, and the longest a document with updates goes without one. */
export const COMPACT_EVERY_UPDATES = 500;
export const COMPACT_EVERY_MS = 10 * 60 * 1000;
/** One update may not be larger than this. */
export const MAX_UPDATE_BYTES = 4 * 1024 * 1024;

export type DocVerb = "view" | "edit";
export type DocDecision = { ok: true; enc: DocEnc; owner?: DocOwner | undefined } | { ok: false; reason: "missing" | "denied" };

/** Who may read or edit a document, answered from the owning row's access. The host binds it to authorize(); a test binds it to a table. */
export interface DocAccess {
  decide(who: string, doc: string, verb: DocVerb): DocDecision;
}

export interface DocDeps {
  db: Tx;
  access: DocAccess;
  /** Append one event to the log. */
  append(ev: NewEvent): { seq: number };
  now(): number;
  /** Write the Markdown projection to the owning row's text field, for search, agents and memory. Never called for private documents. */
  project?(owner: DocOwner, md: string, doc: string): void;
  compactEvery?: number;
  compactMs?: number;
}

export interface OpenInput { doc: string; sv?: string | undefined }
export interface OpenOut { snapshot?: string; updates: string[]; sv: string; upto: number; md?: string; enc: DocEnc }
export interface UpdateInput { doc: string; update: string; enc?: number | undefined; suggest?: boolean | undefined }
export interface CompactInput { doc: string; upto?: number | undefined; snapshot?: string | undefined; md?: string | undefined }

export interface Attribution { seq: number; actor: string; at: number; suggest: "pending" | "rejected" | "agreed" }

export interface DocServer {
  open(who: string, input: OpenInput, traceId: string): OpenOut;
  update(who: string, input: UpdateInput, traceId: string): { seq: number; bytes: number };
  close(who: string, input: { doc: string; name?: string | undefined }, traceId: string): { versioned: boolean; upto: number };
  compact(who: string, input: CompactInput, traceId: string): { upto: number; bytes: number };
  /** Fold every document that is due (500 updates or 10 minutes). Returns how many were folded. */
  sweep(traceId: string): number;
  acceptSuggestion(who: string, doc: string, seq: number, traceId: string): void;
  rejectSuggestion(who: string, doc: string, seq: number, traceId: string): { seq: number | null };
  /** Who wrote each update still unfolded, and which ones are suggestions. */
  attribution(who: string, doc: string, traceId: string): Attribution[];
  /** The named history versions (One History), newest first. */
  history(who: string, doc: string, traceId: string): { upto: number; named: string; at: number; md: string | null }[];
  /** Whether a person may still view or edit; the live layer uses it to drop a subscriber mid session. */
  allowed(who: string, doc: string, verb: DocVerb): boolean;
}

function docError(code: ErrorCode, message: string, traceId: string, kind: string, label: string): VyreErr {
  return new VyreErr({ code, message, retryable: false, traceId, next: [{ kind, label }] });
}

const SYSTEM = "sync";
const SUGGEST_PENDING = 1;

export function createDocServer(d: DocDeps): DocServer {
  const every = d.compactEvery ?? COMPACT_EVERY_UPDATES;
  const everyMs = d.compactMs ?? COMPACT_EVERY_MS;
  ensureDocTables(d.db);

  function gate(who: string, doc: string, verb: DocVerb, traceId: string): { enc: DocEnc; owner: DocOwner | null } {
    if (typeof doc !== "string" || doc.length === 0) throw docError("validation.bad_input", "Name the document.", traceId, "edit_input", "Check the request and send it again");
    const r = d.access.decide(who, doc, verb);
    if (r.ok) return { enc: r.enc, owner: r.owner ?? null };
    if (r.reason === "missing") throw docError("validation.not_found", "That document is not here.", traceId, "reload", "Reload the list");
    if (verb === "edit") throw docError("permission.revoked", "You can no longer edit this document. What you wrote is kept on your device.", traceId, "ask_access", "Ask for edit access");
    throw docError("permission.no_grant", "You do not have access to this document.", traceId, "ask_access", "Ask for access");
  }

  const emit = (type: string, doc: string, traceId: string, actor: string, payload: Record<string, unknown>): void => {
    d.append({ type, sv: 1, trace_id: traceId, actor, vis: "participants", entity: "doc", entity_id: doc, payload });
  };

  function project(owner: DocOwner | null, doc: string, y: Y.Doc): void {
    if (owner && d.project) d.project(owner, toMarkdown(y), doc);
  }

  /** Fold plain updates into the base snapshot. Returns the seq folded to, or null when there was nothing to do. */
  function fold(doc: string, traceId: string, actor: string, owner: DocOwner | null, limit?: number, name?: string): { upto: number; bytes: number } | null {
    const head = headSeq(d.db, doc);
    const pending = firstPendingSuggestion(d.db, doc);
    const cap = pending !== null ? pending - 1 : head;
    const upto = Math.min(limit ?? head, cap, head);
    const base = baseSnapshot(d.db, doc);
    if (upto <= (base?.upto ?? 0)) return base ? { upto: base.upto, bytes: base.bytes.length } : null;
    const y = buildDoc(d.db, doc, upto);
    const bytes = Y.encodeStateAsUpdate(y);
    writeSnapshot(d.db, { doc, upto, bytes, md: toMarkdown(y), at: d.now(), named: name ?? null, base: true });
    dropFolded(d.db, doc, upto);
    emit("doc.compacted", doc, traceId, actor, { doc, upto, bytes: bytes.length, ...(name ? { named: name } : {}) });
    project(owner, doc, pending !== null ? buildDoc(d.db, doc) : y);
    return { upto, bytes: bytes.length };
  }

  const server: DocServer = {
    allowed: (who, doc, verb) => d.access.decide(who, doc, verb).ok,

    open(who, input, traceId) {
      const g = gate(who, input.doc, "view", traceId);
      const doc = input.doc;
      const meta = docMeta(d.db, doc);
      const enc: DocEnc = meta?.enc ?? g.enc;
      const head = headSeq(d.db, doc);
      if (enc === 2) {
        // Ciphertext in the order it was accepted. The server has no state vector for it and sends no Markdown.
        const base = baseSnapshot(d.db, doc);
        return { ...(base ? { snapshot: toB64(base.bytes) } : {}), updates: updatesAfter(d.db, doc, base?.upto ?? 0).map((u) => toB64(u.bytes)), sv: "", upto: head, enc };
      }
      const y = buildDoc(d.db, doc);
      const sv = toB64(Y.encodeStateVector(y));
      const md = toMarkdown(y);
      if (input.sv !== undefined && input.sv.length > 0) {
        let theirs: Uint8Array;
        try { theirs = fromB64(input.sv); } catch { throw docError("validation.bad_input", "The state vector is not valid.", traceId, "edit_input", "Open the document again"); }
        return { updates: [toB64(Y.encodeStateAsUpdate(y, theirs))], sv, upto: head, md, enc };
      }
      return { snapshot: toB64(Y.encodeStateAsUpdate(y)), updates: [], sv, upto: head, md, enc };
    },

    update(who, input, traceId) {
      const g = gate(who, input.doc, "edit", traceId);
      const doc = input.doc;
      const meta = ensureMeta(d.db, doc, g.enc, g.owner, d.now());
      const want: DocEnc = input.enc === 2 ? 2 : 0;
      if (input.enc !== undefined && input.enc !== 0 && input.enc !== 2) throw docError("validation.bad_input", "An update is plain (0) or encrypted (2).", traceId, "edit_input", "Check the request and send it again");
      if (want !== meta.enc) {
        throw docError("validation.bad_input", meta.enc === 2 ? "This document is private. Send encrypted updates." : "This document is not private. Send plain updates.", traceId, "edit_input", "Open the document again");
      }
      let bytes: Uint8Array;
      try { bytes = fromB64(input.update); } catch { throw docError("validation.bad_input", "The update is not valid.", traceId, "edit_input", "Open the document again"); }
      if (bytes.length === 0 || bytes.length > MAX_UPDATE_BYTES) throw docError("validation.bad_input", "The update is empty or too large.", traceId, "edit_input", "Split the change into smaller edits");
      if (meta.enc === 0) {
        // A malformed update would poison every later rebuild, so it is read once here and refused.
        try { Y.decodeUpdate(bytes); } catch { throw docError("validation.bad_input", "The update is not a valid document change.", traceId, "edit_input", "Open the document again"); }
        if (isEmptyUpdate(bytes)) return { seq: headSeq(d.db, doc), bytes: bytes.length };
      }
      const seq = appendUpdate(d.db, { doc, actor: who, at: d.now(), bytes, enc: meta.enc, suggest: input.suggest === true && meta.enc === 0 });
      emit("doc.updated", doc, traceId, who, { doc, bytes: bytes.length, actor: who, seq });
      if (meta.enc === 0 && updateCount(d.db, doc) >= every) fold(doc, traceId, SYSTEM, meta.owner);
      return { seq, bytes: bytes.length };
    },

    close(who, input, traceId) {
      const g = gate(who, input.doc, "edit", traceId);
      const doc = input.doc;
      const meta = docMeta(d.db, doc);
      const head = headSeq(d.db, doc);
      if ((meta?.enc ?? g.enc) === 2) return { versioned: false, upto: head };
      const lastNamed = versions(d.db, doc)[0]?.upto ?? 0;
      if (head === 0 || head <= lastNamed) return { versioned: false, upto: head };
      const name = input.name && input.name.length > 0 ? input.name : new Date(d.now()).toISOString();
      const owner = meta?.owner ?? g.owner;
      const before = baseSnapshot(d.db, doc)?.upto ?? 0;
      if (firstPendingSuggestion(d.db, doc) === null) {
        fold(doc, traceId, who, owner, head, name);
        d.db.run("UPDATE doc_snapshots SET named = ? WHERE doc = ? AND upto = ?", name, doc, head);
        // A fold already said so; only a version put on an existing fold needs its own event.
        if (before >= head) emit("doc.compacted", doc, traceId, who, { doc, upto: head, bytes: baseSnapshot(d.db, doc)?.bytes.length ?? 0, named: name });
      } else {
        // A pending suggestion keeps the updates apart, so the version is a copy that never starts a rebuild.
        const y = buildDoc(d.db, doc);
        const bytes = Y.encodeStateAsUpdate(y);
        writeSnapshot(d.db, { doc, upto: head, bytes, md: toMarkdown(y), at: d.now(), named: name, base: false });
        emit("doc.compacted", doc, traceId, who, { doc, upto: head, bytes: bytes.length, named: name });
      }
      return { versioned: true, upto: head };
    },

    compact(who, input, traceId) {
      const g = gate(who, input.doc, "edit", traceId);
      const doc = input.doc;
      const meta = docMeta(d.db, doc);
      const enc = meta?.enc ?? g.enc;
      const head = headSeq(d.db, doc);
      if (enc === 2) {
        if (!input.snapshot || input.upto === undefined) throw docError("validation.bad_input", "A private document is folded on its owner's device. Send the snapshot and the seq it holds.", traceId, "edit_input", "Compact from your device");
        const base = baseSnapshot(d.db, doc);
        if (input.upto > head || input.upto < (base?.upto ?? 0) || input.upto < 1) throw docError("validation.bad_input", "The snapshot names a seq the document does not have.", traceId, "edit_input", "Open the document again");
        let bytes: Uint8Array;
        try { bytes = fromB64(input.snapshot); } catch { throw docError("validation.bad_input", "The snapshot is not valid.", traceId, "edit_input", "Compact from your device"); }
        if (bytes.length === 0 || bytes.length > MAX_UPDATE_BYTES * 4) throw docError("validation.bad_input", "The snapshot is empty or too large.", traceId, "edit_input", "Compact from your device");
        writeSnapshot(d.db, { doc, upto: input.upto, bytes, md: null, at: d.now(), named: null, base: true });
        dropFolded(d.db, doc, input.upto);
        emit("doc.compacted", doc, traceId, who, { doc, upto: input.upto, bytes: bytes.length });
        return { upto: input.upto, bytes: bytes.length };
      }
      const r = fold(doc, traceId, who, meta?.owner ?? g.owner, input.upto);
      return r ?? { upto: 0, bytes: 0 };
    },

    sweep(traceId) {
      let n = 0;
      const now = d.now();
      for (const c of foldCandidates(d.db)) {
        const due = c.updates >= every || now - Math.max(c.lastFold, c.oldest) >= everyMs;
        if (!due) continue;
        const before = baseSnapshot(d.db, c.doc)?.upto ?? 0;
        const r = fold(c.doc, traceId, SYSTEM, docMeta(d.db, c.doc)?.owner ?? null);
        if (r && r.upto > before) n++;
      }
      return n;
    },

    acceptSuggestion(who, doc, seq, traceId) {
      gate(who, doc, "edit", traceId);
      const row = updatesAfter(d.db, doc, seq - 1, seq)[0];
      if (!row || row.suggest !== SUGGEST_PENDING) throw docError("validation.not_found", "That suggestion is not waiting any more.", traceId, "reload", "Reload the document");
      d.db.run("UPDATE doc_updates SET suggest = 0 WHERE doc = ? AND seq = ?", doc, seq);
    },

    rejectSuggestion(who, doc, seq, traceId) {
      gate(who, doc, "edit", traceId);
      const target = updatesAfter(d.db, doc, seq - 1, seq)[0];
      if (!target || target.suggest !== SUGGEST_PENDING) throw docError("validation.not_found", "That suggestion is not waiting any more.", traceId, "reload", "Reload the document");
      // Replay the document with the suggestion's own transaction tracked, then undo exactly that transaction: the inverse is a normal update.
      const mine = { suggestion: seq };
      const y = newDoc();
      const um = new Y.UndoManager([y.getText(BODY), y.getXmlFragment(CONTENT)], { trackedOrigins: new Set([mine]), captureTimeout: 0 });
      const base = baseSnapshot(d.db, doc);
      if (base) Y.applyUpdate(y, base.bytes, "base");
      for (const u of updatesAfter(d.db, doc, base?.upto ?? 0)) if (u.enc === 0) Y.applyUpdate(y, u.bytes, u.seq === seq ? mine : "other");
      const out: { inverse: Uint8Array | null } = { inverse: null };
      const on = (u: Uint8Array): void => { out.inverse = u; };
      y.on("update", on);
      um.undo();
      y.off("update", on);
      um.destroy();
      d.db.run("UPDATE doc_updates SET suggest = 2 WHERE doc = ? AND seq = ?", doc, seq);
      const inv = out.inverse;
      if (!inv || isEmptyUpdate(inv)) return { seq: null };
      const next = appendUpdate(d.db, { doc, actor: who, at: d.now(), bytes: inv, enc: 0, suggest: false });
      emit("doc.updated", doc, traceId, who, { doc, bytes: inv.length, actor: who, seq: next });
      return { seq: next };
    },

    attribution(who, doc, traceId) {
      gate(who, doc, "view", traceId);
      return updatesAfter(d.db, doc, 0).map((u: StoredUpdate) => ({ seq: u.seq, actor: u.actor, at: u.at, suggest: u.suggest === 1 ? "pending" : u.suggest === 2 ? "rejected" : "agreed" }));
    },

    history(who, doc, traceId) {
      gate(who, doc, "view", traceId);
      return versions(d.db, doc).map((v) => ({ upto: v.upto, named: v.named ?? "", at: v.at, md: v.md }));
    },
  };
  return server;
}
