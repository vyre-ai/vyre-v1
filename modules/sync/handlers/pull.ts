// sync.pull, sync.snapshot.begin and sync.snapshot.page (ARCH 5.3, 5.8). The logic is in sync/src/server/pull; these bind it to the capability inputs and outputs.
// The gateway has already authenticated the device session, so the caller's person and device arrive on the context.
import { decodePage, encodePage, pullChanges, snapshotBegin, snapshotPage } from "../../../sync/src/server/pull/index.ts";
import type { PullDeps, SnapshotBeginRes, SnapshotPage } from "../../../sync/src/server/pull/index.ts";
import type { DeviceClass, PullReq, PullRes } from "../../../sync/src/protocol.ts";

export interface PullCtx {
  trace: { traceId: string };
  /** The person the device session belongs to. */
  principal: string;
  deviceId: string;
  deviceClass: DeviceClass;
}

export interface PullHandlers {
  "sync.pull"(ctx: PullCtx, input: PullReq): Promise<PullRes>;
  "sync.snapshot.begin"(ctx: PullCtx, input: { entities?: string[]; deviceClass: DeviceClass }): Promise<SnapshotBeginRes>;
  "sync.snapshot.page"(ctx: PullCtx, input: { entity: string; after?: string; asOf: number }): Promise<SnapshotPage>;
  /** The page as it goes on the wire: NDJSON, gzip (5.8). */
  snapshotPageBytes(ctx: PullCtx, input: { entity: string; after?: string; asOf: number }): Promise<Uint8Array>;
}

export { decodePage };

export function createPullHandlers(deps: PullDeps): PullHandlers {
  const who = (ctx: PullCtx, deviceClass: DeviceClass = ctx.deviceClass) => ({ person: ctx.principal, device: ctx.deviceId, deviceClass });
  return {
    async "sync.pull"(ctx, input) {
      return pullChanges(deps, who(ctx), input);
    },
    async "sync.snapshot.begin"(ctx, input) {
      return snapshotBegin(deps, who(ctx, input.deviceClass), input, ctx.trace.traceId);
    },
    async "sync.snapshot.page"(ctx, input) {
      return snapshotPage(deps, who(ctx), input, ctx.trace.traceId);
    },
    async snapshotPageBytes(ctx, input) {
      return encodePage(snapshotPage(deps, who(ctx), input, ctx.trace.traceId));
    },
  };
}
