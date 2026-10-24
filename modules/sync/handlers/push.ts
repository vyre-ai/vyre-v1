// sync.push (ARCH 5.4). The merge and the ordering are in sync/src/server/push; this binds them to the capability. The gateway has authenticated the device session, so person and device arrive on the context.
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { parsePushReq } from "../../../sync/src/protocol.ts";
import type { PushReq, PushRes } from "../../../sync/src/protocol.ts";
import { pushOps } from "../../../sync/src/server/push/index.ts";
import type { PushDeps } from "../../../sync/src/server/push/index.ts";
import type { PullCtx } from "./pull.ts";

export interface PushHandlers {
  "sync.push"(ctx: PullCtx, input: PushReq): Promise<PushRes>;
}

export function createPushHandlers(deps: PushDeps): PushHandlers {
  return {
    async "sync.push"(ctx, input) {
      const parsed = parsePushReq(input);
      const bad = (message: string, code: "validation.bad_input" | "validation.too_large" = "validation.bad_input"): VyreErr => new VyreErr({
        code, message, retryable: false, traceId: ctx.trace.traceId, next: [{ kind: "edit_input", label: "Check the change and send it again" }],
      });
      if (!parsed.ok) throw bad(parsed.error, /at most/.test(parsed.error) ? "validation.too_large" : "validation.bad_input");
      if (parsed.value.deviceId !== ctx.deviceId) throw bad("This push names a different device than the one signed in.");
      return pushOps(deps, { person: ctx.principal, device: ctx.deviceId }, parsed.value, ctx.trace.traceId);
    },
  };
}
