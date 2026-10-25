// Handlers of the sync module, one file per packet. Later sync packets (hello, docs, epochs) add theirs beside pull and push.
export { createPullHandlers, decodePage } from "./pull.ts";
export type { PullCtx, PullHandlers } from "./pull.ts";
export { createPushHandlers } from "./push.ts";
export type { PushHandlers } from "./push.ts";

import type { PullCtx } from "./pull.ts";
import type { DeviceClass } from "../../../sync/src/protocol.ts";

/** The host Ctx seen as the device session the sync handlers want: the person, the device, and its class (push does not read the class). A call without a device is refused by the caller's check. */
export function toPullCtx(ctx: { trace: { traceId: string }; principal: { id: string }; device?: string }, deviceClass: DeviceClass = "desktop"): PullCtx {
  return { trace: ctx.trace, principal: ctx.principal.id, deviceId: ctx.device ?? "", deviceClass };
}
