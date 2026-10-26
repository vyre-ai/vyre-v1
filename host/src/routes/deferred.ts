// A capability whose packet is deferred (ruling 60): it has a registered handler that refuses, so its module can go live with every other capability real. docs/deferred.md lists each one;
// the deferred packet replaces the entry with a real handler.
import type { Handler } from "../invoke.ts";
import { fail } from "./errors.ts";

export const NOT_YET = "Not in this version yet";

/** One handler for every deferred capability: internal.unavailable, "Not in this version yet". */
export const deferred: Handler = (ctx) => {
  throw fail("internal.unavailable", ctx.trace.traceId, { message: NOT_YET, next: [{ kind: "report", label: "Tell us you need this" }] });
};

/** Every capability registered through deferredHandlers: the one runtime source of what is deferred. The host publishes it to signed-in clients; docs/deferred.md must match it (scripts/check-deferred-doc.ts). */
export const DEFERRED_CAPS: Set<string> = new Set();

/** The deferred capability names, sorted. */
export const deferredCaps = (): string[] => [...DEFERRED_CAPS].sort();

/** The modules whose every capability is deferred, from the registry's capability rows. */
export const deferredModules = (rows: readonly { name: string; module: string }[]): string[] => {
  const all = new Map<string, boolean>();
  for (const r of rows) all.set(r.module, (all.get(r.module) ?? true) && DEFERRED_CAPS.has(r.name));
  return [...all].filter(([, whole]) => whole).map(([m]) => m).sort();
};

/** `{ "<cap>": deferred, ... }` for a list of capability names; each name is recorded in DEFERRED_CAPS. */
export const deferredHandlers = (caps: readonly string[]): Record<string, Handler> => {
  for (const c of caps) DEFERRED_CAPS.add(c);
  return Object.fromEntries(caps.map((c) => [c, deferred]));
};
