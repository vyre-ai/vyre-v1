// state module entry (lane b-state, P2 step 0). Per-person state on a thing: read, done, star, follow, mute. Nothing in the product calls it yet; the Inbox moves onto it in step 1.
// A module with things that carry state exports `stateKinds` (see host/src/seams/state.ts): the host registers them at boot, before the first `verify`.
import type { Handler } from "../../host/src/invoke.ts";
import * as h from "./handlers/index.ts";
import { storeOf, storeWithPeople } from "./projections.ts";
import type { StateCtx } from "./projections.ts";

export const handlers: Record<string, Handler> = {
  "state.get": (ctx, i) => h.get(ctx as never, i as never),
  "state.list": (ctx, i) => h.list(ctx as never, i as never),
  "state.counts": (ctx, i) => h.counts(ctx as never, i as never),
  "state.read": (ctx, i) => h.readCall(ctx as never, i as never),
  "state.read_scope": (ctx, i) => h.readScope(ctx as never, i as never),
  "state.set": (ctx, i) => h.setCall(ctx as never, i as never),
  "state.arrive": (ctx, i) => h.arrive(ctx as never, i as never),
  "state.retract": (ctx, i) => h.retract(ctx as never, i as never),
  "state.merge": (ctx, i) => h.merge(ctx as never, i as never),
  "state.gain": (ctx, i) => h.gain(ctx as never, i as never),
  "state.lose": (ctx, i) => h.lose(ctx as never, i as never),
  "state.forget": (ctx, i) => h.forget(ctx as never, i as never),
  "state.verify": (ctx, i) => h.verify(ctx as never, i as never),
};

export const projections = { inline: {}, consumers: {} };

/** Every six hours, and once when the server starts: compare every head and badge with the entries, and repair what differs. A crash between a module's insert and its `arrive` is mended here. */
export const periodic = {
  /** Every minute: a mute whose time has passed is cleared, so the thing counts in the person's badge again, and the person's devices are told. */
  "state.unmute": {
    everyMs: 60_000,
    run: async (ctx: StateCtx): Promise<void> => {
      for (const c of storeOf(ctx).sweep())
        ctx.emit(
          "state.changed",
          c.thing.id,
          { person: c.person, thing: c.thing, changed: ["mute"], now: ctx.now(), by: ctx.principal.id },
          { vis: "owner" },
        );
    },
  },
  "state.verify": {
    everyMs: 6 * 60 * 60_000,
    immediate: true,
    run: async (ctx: StateCtx): Promise<void> => {
      const r = (await storeWithPeople(ctx)).verify({ repair: true });
      if (r.problems.length > 0)
        ctx.log.warn("state.verify repaired what a crash or a bug left", {
          problems: r.problems.length,
          repaired: r.repaired,
          first: r.problems[0],
        });
    },
  },
};
