// state module entry (lane b-state, P2 step 0). Per-person state on a thing: read, done, star, follow, mute. Nothing in the product calls it yet; the Inbox moves onto it in step 1.
// A module with things that carry state exports `stateKinds` (see host/src/seams/state.ts): the host registers them at boot, before the first `verify`.
import type { Handler } from "../../host/src/invoke.ts";
import * as h from "./handlers/index.ts";
import { storeOf, storeWithPeople } from "./projections.ts";
import type { StateCtx } from "./projections.ts";
import { turns } from "../../lib/yield-loop.ts";

export const handlers: Record<string, Handler> = {
  "state.get": (ctx, i) => h.get(ctx as never, i as never),
  "state.list": (ctx, i) => h.list(ctx as never, i as never),
  "state.counts": (ctx, i) => h.counts(ctx as never, i as never),
  "state.read": (ctx, i) => h.readCall(ctx as never, i as never),
  "state.read_scope": (ctx, i) => h.readScope(ctx as never, i as never),
  "state.set": (ctx, i) => h.setCall(ctx as never, i as never),
  "state.layout.get": (ctx, i) => h.layoutGet(ctx as never, i as never),
  "state.layout.set": (ctx, i) => h.layoutSet(ctx as never, i as never),
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
  /**
   * Every minute: a mute whose time has passed is cleared (at most 500 a minute, the oldest first), so the thing counts in the person's badge again, and the person's devices are told. The event is the
   * host's own change made on the person's behalf, so only that person reads it.
   */
  "state.unmute": {
    everyMs: 60_000,
    run: async (ctx: StateCtx): Promise<void> => {
      for (const c of storeOf(ctx).sweep())
        ctx.emit(
          "state.changed",
          c.thing.id,
          {
            person: c.person,
            thing: c.thing,
            changed: c.result.changed,
            now: ctx.now(),
            by: ctx.principal.id,
            state: c.result.state,
            count: c.result.count,
          },
          { vis: "private", onBehalf: c.person },
        );
    },
  },
  /**
   * Every six hours (and at start): compare every head and badge with the entries and repair what differs, and recount every row against its entries (finds an arrival lost before a later one). The pass
   * is incremental: each run covers at most VERIFY_THINGS things after a cursor kept in state_verify_cursor, in slices of 200 things with a turn for other work between, and the next run goes on where
   * it stopped; when the pass reaches the end, the count check runs and the next run starts over from the beginning. On every run, whole, each kind is asked who can still see its things, in slices of 200 rows. A thing is never older than one
   * pass, whatever its age, and no run holds the event loop for more than one slice.
   */
  "state.verify": {
    everyMs: 6 * 60 * 60_000,
    immediate: true,
    run: async (ctx: StateCtx): Promise<void> => {
      const store = await storeWithPeople(ctx);
      const at = (ctx.db.all("SELECT cursor FROM state_verify_cursor WHERE id = 1") as Array<{ cursor: string }>)[0]
        ?.cursor;
      const steps = store.verifySteps({
        repair: true,
        deep: true,
        limit: verifyTuning.things,
        ...(at ? { from: at } : {}),
      });
      const turn = turns();
      let r: IteratorResult<void, import("../../host/src/seams/state.ts").VerifyReport>;
      for (;;) {
        r = steps.next();
        if (r.done) break;
        await turn();
      }
      const report = r.value;
      if (report.next) verifyPasses.partial++;
      else verifyPasses.complete++;
      ctx.db.run(
        "INSERT INTO state_verify_cursor (id, cursor) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET cursor = excluded.cursor",
        report.next ?? "",
      );
      // who can still see their things is asked on every run, whole and in slices (a person who lost access must not wait for a pass to end to lose the badge)
      const rsteps = store.reconcileSteps();
      let rr: IteratorResult<void, { left: number; entered: number }>;
      for (;;) {
        rr = rsteps.next();
        if (rr.done) break;
        await turn();
      }
      const access = rr.value;
      if (report.problems.length > 0 || access.left > 0 || access.entered > 0)
        ctx.log.warn("state.verify repaired what a crash or a bug left", {
          problems: report.problems.length,
          repaired: report.repaired,
          first: report.problems[0],
          left: access.left,
          entered: access.entered,
        });
    },
  },
};
/** The most things one run recounts (a Space of 46,000 things is done in three runs). */
export const VERIFY_THINGS = 20_000;
/** For the tests: the cap a run works to. */
export const verifyTuning = { things: VERIFY_THINGS };
/** How many runs ended a pass and how many stopped at their cap (the tests read it). */
export const verifyPasses = { complete: 0, partial: 0 };
