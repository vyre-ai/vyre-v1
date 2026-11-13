// The six public capabilities of state and the host's own internal calls. Every public call is about `actingFor ?? principal`; a thing the caller cannot see is not_found.
import type { ThingState } from "../../../host/src/seams/state.ts";
import type { Change } from "../../../lib/state.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { guarded, hostOnly, mayWrite, storeOf, storeWithPeople, subjectOf } from "../projections.ts";
import type { StateCtx } from "../projections.ts";

type Thing = { type: string; id: string };
const DEFAULT_PAGE = 50;

/** state.changed, once per thing whose state moved: who it is about, what moved, and who did it. */
function announce(ctx: StateCtx, person: string, thing: Thing, changed: readonly string[]): void {
  if (changed.length === 0) return;
  ctx.emit(
    "state.changed",
    thing.id,
    { person, thing, changed, now: ctx.now(), by: ctx.principal.id },
    { vis: "owner" },
  );
}

const bad = (ctx: StateCtx, message: string): never => {
  throw fail("validation.bad_input", ctx.trace.traceId, { message });
};

export async function get(ctx: StateCtx, input: { things: Thing[] }): Promise<{ states: ThingState[] }> {
  return guarded(ctx, () => {
    const store = storeOf(ctx);
    const me = subjectOf(ctx);
    // a thing the caller cannot see is left out: the answer never says it exists
    const seen = input.things.filter((t) => store.canSee(me, t));
    return { states: store.stateOf(me, seen) };
  });
}

export async function list(
  ctx: StateCtx,
  input: {
    flag: "starred" | "following" | "done" | "unread" | "muted";
    type?: string;
    scope?: string;
    cursor?: string;
    limit?: number;
  },
) {
  return guarded(ctx, () => {
    const page = storeOf(ctx).list(subjectOf(ctx), {
      flag: input.flag,
      limit: input.limit ?? DEFAULT_PAGE,
      ...(input.type ? { type: input.type } : {}),
      ...(input.scope ? { scope: input.scope } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    });
    // one batch for the titles, never one lookup per row
    const titles = ctx.resources?.describeMany?.(page.rows.map((r) => r.thing)) ?? [];
    return {
      rows: page.rows.map((r, i) => ({
        thing: r.thing,
        title: titles[i]?.title ?? r.thing.id,
        at: r.at,
        unread: r.unread,
      })),
      ...(page.next ? { next: page.next } : {}),
    };
  });
}

export async function counts(ctx: StateCtx, input: { scopes?: string[] }) {
  return guarded(ctx, () => ({ counts: storeOf(ctx).counts(subjectOf(ctx), input.scopes) }));
}

export async function readCall(
  ctx: StateCtx,
  input: { thing: Thing; upto?: number; unread?: true; fromPos?: number },
): Promise<{ unread: number }> {
  const given = [input.upto !== undefined, input.unread === true, input.fromPos !== undefined].filter(Boolean).length;
  if (given !== 1) return bad(ctx, "Give exactly one of upto, unread or fromPos.");
  await mayWrite(ctx);
  return guarded(ctx, () => {
    const me = subjectOf(ctx);
    const req =
      input.upto !== undefined
        ? { upto: input.upto }
        : input.fromPos !== undefined
          ? { fromPos: input.fromPos }
          : { unread: true as const };
    const r = storeOf(ctx).read(me, input.thing, req);
    announce(ctx, me, input.thing, r.changed);
    return { unread: r.state.unread };
  });
}

export async function readScope(ctx: StateCtx, input: { scope: string; before?: number }): Promise<{ marked: number }> {
  await mayWrite(ctx);
  return guarded(ctx, () => {
    const me = subjectOf(ctx);
    const r = storeOf(ctx).readScope(me, input.scope, input.before);
    for (const t of r.things) announce(ctx, me, t, ["read"]);
    return { marked: r.marked };
  });
}

export async function setCall(
  ctx: StateCtx,
  input: {
    thing: Thing;
    done?: boolean;
    star?: boolean;
    follow?: "following" | "left" | null;
    alert?: boolean;
    mute?: { until: number } | null;
  },
): Promise<{ state: ThingState }> {
  const change: Change = {
    ...(input.done !== undefined ? { done: input.done } : {}),
    ...(input.star !== undefined ? { star: input.star } : {}),
    ...(input.follow !== undefined ? { follow: input.follow } : {}),
    ...(input.alert !== undefined ? { alert: input.alert } : {}),
    ...(input.mute !== undefined ? { mute: input.mute } : {}),
  };
  if (Object.keys(change).length === 0) return bad(ctx, "Give at least one of done, star, follow, alert or mute.");
  await mayWrite(ctx);
  return guarded(ctx, () => {
    const me = subjectOf(ctx);
    const r = storeOf(ctx).set(me, input.thing, change);
    announce(ctx, me, input.thing, r.changed);
    return { state: r.state };
  });
}

// ---- the host's own calls

export async function arrive(
  ctx: StateCtx,
  input: { thing: Thing; pos: number; by: string | null; at: number; mentions?: string[] },
) {
  hostOnly(ctx);
  const store = await storeWithPeople(ctx);
  return guarded(ctx, () =>
    store.arrive(input.thing, {
      pos: input.pos,
      by: input.by,
      at: input.at,
      ...(input.mentions ? { mentions: input.mentions } : {}),
    }),
  );
}
export async function retract(ctx: StateCtx, input: { thing: Thing }) {
  hostOnly(ctx);
  return guarded(ctx, () => (storeOf(ctx).retract(input.thing), { ok: true }));
}
export async function merge(ctx: StateCtx, input: { from: Thing; to: Thing }) {
  hostOnly(ctx);
  return guarded(ctx, () => (storeOf(ctx).merge(input.from, input.to), { ok: true }));
}
export async function gain(ctx: StateCtx, input: { person: string; scope: string }) {
  hostOnly(ctx);
  return guarded(ctx, () => ({ rows: storeOf(ctx).gain(input.person, input.scope) }));
}
export async function lose(ctx: StateCtx, input: { person: string; scope: string }) {
  hostOnly(ctx);
  return guarded(ctx, () => ({ rows: storeOf(ctx).lose(input.person, input.scope) }));
}
export async function forget(ctx: StateCtx, input: { thing: Thing }) {
  hostOnly(ctx);
  return guarded(ctx, () => (storeOf(ctx).forget(input.thing), { ok: true }));
}
export async function verify(
  ctx: StateCtx,
  input: { person?: string; scope?: string; repair?: boolean; deep?: boolean },
) {
  hostOnly(ctx);
  const store = await storeWithPeople(ctx);
  return guarded(ctx, () =>
    store.verify({
      ...(input.person ? { person: input.person } : {}),
      ...(input.scope ? { scope: input.scope } : {}),
      ...(input.repair ? { repair: true } : {}),
      ...(input.deep ? { deep: true } : {}),
    }),
  );
}
