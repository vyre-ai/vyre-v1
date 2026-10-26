// The sync module's host seam (rulings 31 and 32): the module exports `hostSeams = { configureSync }` and the daemon hands it what only the host has: the Space store, the access snapshot,
// the clock, the registry hash and a way to run a pushed op as the person through the invoke pipeline. The host never imports the module, so the shapes below are the structural subset of
// the module's SyncHostSeam. A push op runs exactly like the same call over HTTP: permissions, Gate, validation and audit are the normal ones.
import type { InlineProjection } from "../../../kernel/src/store/projection.ts";
import type { InvokeResult } from "../invoke.ts";

/** One capability call made for a pushed op (the structural subset of sync's InvokeCall). */
export interface SyncInvokeCall {
  cap: string; v: number; input: unknown; principal: string; deviceId: string; idempotencyKey: string;
  /** the op's own trace id: the change and its events carry it, so one flow is one trace */
  traceId?: string;
}

export interface SyncSeamDeps {
  store: { declare(extra: readonly InlineProjection[]): void; open(): unknown };
  access(): unknown;
  space: string;
  now(): number;
  registryHash: string;
  /** invoke as a person from a device */
  invoke(cap: string, input: unknown, seed: { space: string; principal: { kind: "person"; id: string }; device: string; v: number; origin: string; trace?: { traceId: string; spanId: string } }): Promise<InvokeResult>;
  /** true when the capability's input takes an idempotencyKey, so the op id can be its key */
  keyed(cap: string, v: number): boolean;
  /** run the conflicts module's host calls */
  conflicts?: { open(c: unknown): Promise<string>; history(e: unknown): Promise<void> };
  endpoints?(): { kind: "direct" | "relay" | "tunnel"; url: string }[];
}

const spanId = (): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

export function createSyncSeam(d: SyncSeamDeps) {
  return {
    store: d.store, access: d.access, now: d.now, registryHash: d.registryHash,
    ...(d.endpoints ? { endpoints: d.endpoints } : {}),
    ...(d.conflicts ? { conflicts: d.conflicts } : {}),
    async invoke(call: SyncInvokeCall): Promise<{ kind: "applied" } | { kind: "held"; taskId: string }> {
      const body = call.input !== null && typeof call.input === "object" && !Array.isArray(call.input) ? (call.input as Record<string, unknown>) : {};
      const input = d.keyed(call.cap, call.v) && body["idempotencyKey"] === undefined ? { ...body, idempotencyKey: call.idempotencyKey } : call.input;
      const r = await d.invoke(call.cap, input, { space: d.space, principal: { kind: "person", id: call.principal }, device: call.deviceId, v: call.v, origin: "sync", ...(call.traceId ? { trace: { traceId: call.traceId, spanId: spanId() } } : {}) });
      return r.status === "held" ? { kind: "held", taskId: r.taskId } : { kind: "applied" };
    },
  };
}
