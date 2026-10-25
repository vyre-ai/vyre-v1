// sync.doc.open, sync.doc.update, sync.doc.close and sync.doc.compact (ARCH 5.6). The logic is in sync/src/yjs; these bind it to the capability inputs and outputs and give the host the two things it must supply:
// the access check for a document (checked on every call, so a revoked editor is cut off) and the owning row's text projection.
// WIRING (ruling 35 style, outside this packet's files): re-export this file from handlers/index.ts, add the four capability names to the `handlers` map in impl.ts over
// `createDocHandlers(docServerOf(live(), { access: snapshotDocAccess({ ... }), now }))`, add them to the key list in tests/wiring.test.ts, and in the gateway call
// `const detach = docLive.attach(who, (f) => transport.send(f))` when a socket opens and pass `onFrame: (who, f) => docLive.onFrame(who, f)` to the live hub. A scheduler calls `server.sweep(traceId)` every minute,
// and the access module calls `docLive.revalidate()` after a grant, revoke or role change.
import { authorize } from "../../../kernel/src/authorize/index.ts";
import type { AccessSnapshot } from "../../../kernel/src/authorize/index.ts";
import { createDocLive, createDocServer } from "../../../sync/src/yjs/index.ts";
import type { CompactInput, DocAccess, DocDecision, DocDeps, DocEnc, DocLive, DocOwner, DocServer, DocVerb, OpenInput, OpenOut, UpdateInput } from "../../../sync/src/yjs/index.ts";
import type { SyncHandle } from "../impl.ts";

/** The caller of a document capability: the trace and the principal (a person, or an agent writing as itself). */
export interface DocCtx {
  trace: { traceId: string };
  principal: string;
}

export interface DocHandlers {
  "sync.doc.open"(ctx: DocCtx, input: OpenInput): Promise<OpenOut>;
  "sync.doc.update"(ctx: DocCtx, input: UpdateInput): Promise<{ seq: number }>;
  "sync.doc.close"(ctx: DocCtx, input: { doc: string; name?: string | undefined }): Promise<{ versioned: boolean; upto: number }>;
  "sync.doc.compact"(ctx: DocCtx, input: CompactInput): Promise<{ upto: number; bytes: number }>;
}

/** The host Ctx seen as the caller these handlers want. */
export function toDocCtx(ctx: { trace: { traceId: string }; principal: { id: string } }): DocCtx {
  return { trace: ctx.trace, principal: ctx.principal.id };
}

export function createDocHandlers(server: DocServer): DocHandlers {
  return {
    async "sync.doc.open"(ctx, input) { return server.open(ctx.principal, input, ctx.trace.traceId); },
    async "sync.doc.update"(ctx, input) { const r = server.update(ctx.principal, input, ctx.trace.traceId); return { seq: r.seq }; },
    async "sync.doc.close"(ctx, input) { return server.close(ctx.principal, input, ctx.trace.traceId); },
    async "sync.doc.compact"(ctx, input) { return server.compact(ctx.principal, input, ctx.trace.traceId); },
  };
}

/** The document server over the sync module's own store and log. */
export function docServerOf(s: SyncHandle, o: { access: DocAccess; now?: () => number; project?: DocDeps["project"]; compactEvery?: number; compactMs?: number }): DocServer {
  return createDocServer({
    db: s.host.tx,
    access: o.access,
    append: (ev) => s.host.append(ev),
    now: o.now ?? Date.now,
    ...(o.project ? { project: o.project } : {}),
    ...(o.compactEvery !== undefined ? { compactEvery: o.compactEvery } : {}),
    ...(o.compactMs !== undefined ? { compactMs: o.compactMs } : {}),
  });
}

/** The live layer for the ydoc.* frames over the same server. */
export function docLiveOf(server: DocServer): DocLive {
  return createDocLive(server);
}

/** What the host knows about a document's owning row. */
export interface DocRowRef {
  /** Resource type and id in the access snapshot. */
  type: string;
  resource: string;
  /** The row whose text field this document is (for the Markdown projection). */
  owner?: DocOwner | undefined;
  /** 2 for a private memory note (end to end). */
  enc?: DocEnc | undefined;
  /** Who owns a private row: nobody else may open it even with a grant. */
  ownerId?: string | undefined;
}

/** Document access from the kernel's authorize: view or edit on the owning row, for the person (or the person an agent acts for). A hold counts as a refusal. */
export function snapshotDocAccess(o: { snapshot: () => AccessSnapshot; rowOf: (doc: string) => DocRowRef | undefined; now: () => number; actingFor?: (principal: string) => string | undefined }): DocAccess {
  return {
    decide(who: string, doc: string, verb: DocVerb): DocDecision {
      const row = o.rowOf(doc);
      if (!row) return { ok: false, reason: "missing" };
      const enc: DocEnc = row.enc === 2 ? 2 : 0;
      if (enc === 2 && row.ownerId !== who) return { ok: false, reason: "denied" };
      const acting = o.actingFor?.(who);
      const dec = authorize(o.snapshot(), {
        principal: who,
        ...(acting !== undefined ? { actingFor: acting } : {}),
        action: { perm: null, level: verb },
        resource: { type: row.type, id: row.resource },
        now: o.now(),
      });
      if (dec.effect !== "allow") return { ok: false, reason: dec.reason === "not_found" ? "missing" : "denied" };
      return { ok: true, enc, ...(row.owner ? { owner: row.owner } : {}) };
    },
  };
}
