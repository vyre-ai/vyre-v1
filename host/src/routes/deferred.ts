// A capability whose packet is deferred (ruling 60): it has a registered handler that refuses, so its module can go live with every other capability real. docs/deferred.md lists each one;
// the deferred packet replaces the entry with a real handler.
import type { Handler } from "../invoke.ts";
import { fail } from "./errors.ts";

export const NOT_YET = "Not in this version yet";

/** One handler for every deferred capability: internal.unavailable, "Not in this version yet". */
export const deferred: Handler = (ctx) => {
  throw fail("internal.unavailable", ctx.trace.traceId, { message: NOT_YET, next: [{ kind: "report", label: "Tell us you need this" }] });
};

/** `{ "<cap>": deferred, ... }` for a list of capability names. */
export const deferredHandlers = (caps: readonly string[]): Record<string, Handler> => Object.fromEntries(caps.map((c) => [c, deferred]));
