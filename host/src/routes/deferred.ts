// Ruling 60: a capability whose packet is deferred gets a registered handler that refuses with internal.unavailable and the message "Not in this version yet".
// This is the one shared helper; docs/deferred.md lists every capability that uses it. The deferred packet replaces the stub later, one line in the module's impl.ts.
import type { Handler } from "../invoke.ts";
import { fail } from "./errors.ts";

export const NOT_IN_THIS_VERSION = "Not in this version yet";

/** A handler table for capabilities that are deferred: every call refuses, typed, with the same message. */
export function deferredHandlers(caps: readonly string[]): Record<string, Handler> {
  const refuse = ((ctx: { trace: { traceId: string } }): never => { throw fail("internal.unavailable", ctx.trace.traceId, { message: NOT_IN_THIS_VERSION }); }) as unknown as Handler;
  return Object.fromEntries(caps.map((c) => [c, refuse]));
}
