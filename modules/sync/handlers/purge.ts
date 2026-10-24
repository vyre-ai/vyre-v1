// sync.epoch.bump and sync.acl.reindex (ARCH 5.7). The logic is in sync/src/purge/server.ts; these bind it to the capability inputs and outputs.
// Both are admin or system calls (the access and identity modules invoke them after a revoke, a removal or a label change), so the caller is the actor on the events, not a device.
// WIRING (lead): handlers/index.ts and impl.ts are outside this packet's files. To expose these through the loader, re-export this file from handlers/index.ts, add both capability names to the
// `handlers` map in impl.ts over `createPurgeHandlers(purgeDepsOf(live(), hub))`, and add them to the key list in tests/wiring.test.ts.
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { LiveHub } from "../../../sync/src/live/index.ts";
import { bumpEpoch, reindexScope } from "../../../sync/src/purge/index.ts";
import type { BumpInput, BumpResult, PurgeServerDeps, ReindexInput, ReindexResult } from "../../../sync/src/purge/index.ts";
import type { SyncHandle } from "../impl.ts";

/** The caller of an admin capability: the trace and the principal (a person or a service). */
export interface PurgeCtx {
  trace: { traceId: string };
  principal: string;
}

export interface PurgeHandlers {
  "sync.epoch.bump"(ctx: PurgeCtx, input: BumpInput): Promise<BumpResult>;
  "sync.acl.reindex"(ctx: PurgeCtx, input: ReindexInput): Promise<ReindexResult>;
}

/** The host Ctx seen as the caller these handlers want. */
export function toPurgeCtx(ctx: { trace: { traceId: string }; principal: { id: string } }): PurgeCtx {
  return { trace: ctx.trace, principal: ctx.principal.id };
}

/** The server's own sync handle and live hub as the ports purge needs. */
export function purgeDepsOf(s: SyncHandle, hub: Pick<LiveHub, "purge">): PurgeServerDeps {
  return {
    db: s.host.tx,
    catalog: s.catalog,
    append: (ev) => s.host.append(ev),
    purgeLive: (person, epoch) => hub.purge(person, epoch),
  };
}

const REASONS: ReadonlySet<string> = new Set(["device_revoked", "suspended", "removed", "password_reset", "clearance_lowered", "key_rotation"]);

export function createPurgeHandlers(deps: PurgeServerDeps): PurgeHandlers {
  const bad = (ctx: PurgeCtx, message: string): VyreErr => new VyreErr({
    code: "validation.bad_input", message, retryable: false, traceId: ctx.trace.traceId, next: [{ kind: "edit_input", label: "Check the request and send it again" }],
  });
  return {
    async "sync.epoch.bump"(ctx, input) {
      if (!input || typeof input.personId !== "string" || input.personId.length === 0) throw bad(ctx, "Name the person whose devices must sign in again.");
      if (!REASONS.has(input.reason)) throw bad(ctx, "Say why: device revoked, suspended, removed, password reset, clearance lowered or key rotation.");
      if (input.deviceId !== undefined && typeof input.deviceId !== "string") throw bad(ctx, "The device must be named by its id.");
      const { epoch } = bumpEpoch(deps, input, ctx.trace.traceId, ctx.principal);
      return { epoch };
    },
    async "sync.acl.reindex"(ctx, input) {
      if (!input || typeof input.resourceType !== "string" || input.resourceType.length === 0) throw bad(ctx, "Name the kind of thing whose access changed.");
      if (typeof input.resourceId !== "string") throw bad(ctx, "Name the thing whose access changed.");
      return reindexScope(deps, input, ctx.trace.traceId, ctx.principal);
    },
  };
}
