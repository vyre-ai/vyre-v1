// The per-call services the loader does not build (loader.ts gives ctx.db and ctx.http): ctx.seal, ctx.schedule and, when the Vault is wired, ctx.vault.
// `hostServices` wraps the loader's services function, so InvokeDeps.services = hostServices({ base: loaded.services, ... }) is the whole story.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { CtxSeed, Invoke, InvokeDeps } from "../invoke.ts";
import type { BlobStore } from "./blobs.ts";
import type { ScheduledCall, ScheduleQueue } from "./schedule.ts";

export interface HostServicesOptions {
  base?: InvokeDeps["services"];
  seal: Ctx["seal"];
  queue: ScheduleQueue;
  /** The blob store behind ctx.blobs; each call gets the handle for the module that owns the capability. Omitted: ctx.blobs is absent. */
  blobs?: BlobStore;
  /** The Vault's filler for one call (spec 2.20). Omitted: ctx.vault keeps refusing, which is right until the Vault module is live. */
  vault?: (seed: CtxSeed, cap: Parameters<NonNullable<InvokeDeps["services"]>>[1]) => Ctx["vault"];
}

export function hostServices(o: HostServicesOptions): NonNullable<InvokeDeps["services"]> {
  return (seed, cap) => ({
    ...(o.base?.(seed, cap) ?? {}),
    seal: o.seal,
    schedule: o.queue.forCtx(seed),
    ...(o.blobs ? { blobs: o.blobs.forModule((cap as { module?: string }).module ?? cap.name.split(".")[0]!, seed.trace?.traceId) } : {}),
    ...(o.vault ? { vault: o.vault(seed, cap) } : {}),
  });
}

/** ScheduleOptions.run for the real pipeline: the job runs as the principal that scheduled it, on the trace that scheduled it when there was one, with origin "schedule". */
export function invokeRunner(invoke: Invoke): (call: ScheduledCall) => Promise<void> {
  return async (call) => {
    // A call the Gate holds is parked as an approval task, which is its outcome; retrying would park a second one.
    await invoke(call.cap, call.input, {
      space: call.space, principal: call.principal, actingFor: call.actingFor,
      ...(call.traceId ? { trace: { traceId: call.traceId, spanId: "0".repeat(16) } } : {}), origin: "schedule",
    });
  };
}
