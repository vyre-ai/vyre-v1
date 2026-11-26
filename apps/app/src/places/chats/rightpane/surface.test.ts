// The one reconnecting model behind the browser view and the terminal screen (surface.ts): open once, and when the connection is lost open again by itself with a back-off, say so while it does ("Reconnecting"),
// and after a while give an honest "could not reach it" with a Try again that works. Written first (27 Nov, rc.44, owner: "I can't open browser or terminal in a stable way"); the clock is a fake one.
import test from "node:test";
import assert from "node:assert/strict";
import { RECONNECT_GIVE_UP_MS, backoffMs, createSurface } from "./surface.ts";
import type { SurfaceState } from "./surface.ts";

function clock() {
  let now = 0;
  const timers: Array<{ at: number; f: () => void; id: number }> = [];
  let ids = 0;
  return {
    now: () => now,
    set(f: () => void, ms: number) {
      const id = ++ids;
      timers.push({ at: now + ms, f, id });
      return () => {
        const i = timers.findIndex((x) => x.id === id);
        if (i >= 0) timers.splice(i, 1);
      };
    },
    /** move time forward, running every timer that falls due, in order, letting promises settle between them */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        await Promise.resolve();
        await Promise.resolve();
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        now = next.at;
        next.f();
      }
      now = end;
      await Promise.resolve();
      await Promise.resolve();
    },
    pending: () => timers.length,
  };
}

const kinds = (log: SurfaceState[]): string[] => log.map((s) => s.kind);

function world(opens: Array<"ok" | Error>) {
  const c = clock();
  const log: SurfaceState[] = [];
  const got: number[] = [];
  let calls = 0;
  let healed = false;
  const s = createSurface<number>({
    open: async () => {
      const r = healed ? "ok" : opens[Math.min(calls, opens.length - 1)]!;
      calls++;
      if (r instanceof Error) throw r;
      return calls;
    },
    onOpened: (n) => got.push(n),
    onState: (x) => log.push(x),
    clock: { now: c.now, set: c.set },
  });
  return { c, log, got, s, calls: () => calls, heal: () => void (healed = true) };
}

test("a good open goes opening, then ready, and opens once", async () => {
  const w = world(["ok"]);
  w.s.start();
  await w.c.advance(0);
  assert.deepEqual(kinds(w.log), ["opening", "ready"]);
  assert.deepEqual(w.got, [1]);
  assert.equal(w.calls(), 1);
});

test("a lost connection opens again by itself, says Reconnecting meanwhile, and is ready again with no click", async () => {
  const w = world(["ok"]);
  w.s.start();
  await w.c.advance(0);
  w.s.lost("the stream ended");
  assert.equal(w.s.state().kind, "reconnecting");
  await w.c.advance(backoffMs(0));
  assert.equal(w.s.state().kind, "ready");
  assert.deepEqual(w.got, [1, 2], "a new address was asked for, not the old one reused");
});

test("a failing open is tried again with a growing wait and then gives up with a reason and a Try again", async () => {
  const w = world(["ok", new Error("browserd is not up yet")]);
  w.s.start();
  await w.c.advance(0);
  w.s.lost();
  await w.c.advance(RECONNECT_GIVE_UP_MS + 20_000);
  const last = w.s.state();
  assert.equal(last.kind, "failed");
  assert.match(last.kind === "failed" ? last.reason : "", /reach/i);
  const tried = w.calls();
  assert.ok(tried >= 4, `it tried again by itself (${tried} opens)`);
  assert.equal(w.c.pending(), 0, "after giving up nothing keeps running");
  // Try again starts over and a good open ends it
  w.s.retry();
  assert.equal(w.s.state().kind, "opening");
});

test("a refusal that will not change (no permission, not found) fails at once and is not retried", async () => {
  const e = Object.assign(new Error("You may not watch this."), { code: "permission.no_grant" });
  const w = world([e]);
  w.s.start();
  await w.c.advance(0);
  assert.equal(w.s.state().kind, "failed");
  await w.c.advance(60_000);
  assert.equal(w.calls(), 1);
});

test("back-off grows, is capped, and a Try again after a failure works", async () => {
  assert.ok(backoffMs(0) < backoffMs(2));
  assert.equal(backoffMs(50), backoffMs(20));
  assert.ok(backoffMs(50) <= 8000);
  const w = world([new Error("x")]);
  w.s.start();
  await w.c.advance(RECONNECT_GIVE_UP_MS + 5000);
  assert.equal(w.s.state().kind, "failed");
  w.heal();
  w.s.retry();
  await w.c.advance(0);
  assert.equal(w.s.state().kind, "ready", "Try again opens it");
});

test("a ticket that was never used is replaced before it expires", async () => {
  const c = clock();
  let n = 0;
  const log: SurfaceState[] = [];
  const s = createSurface<{ expiresAt: number }>({
    open: async () => ({ expiresAt: c.now() + 60_000 + n++ }),
    onOpened: () => undefined,
    onState: (x) => log.push(x),
    clock: { now: c.now, set: c.set },
    expiresAt: (o) => o.expiresAt,
  });
  s.start();
  await c.advance(0);
  await c.advance(52_000);
  assert.ok(n >= 2, "a second address was asked for before the first one's 60 s ran out");
  // once the connection is made nobody needs the ticket again
  s.connected();
  const seen = n;
  await c.advance(120_000);
  assert.equal(n, seen);
});

test("lost after dispose does nothing, and the window coming back online or visible reconnects a failed surface", async () => {
  const w = world(["ok"]);
  w.s.start();
  await w.c.advance(0);
  w.s.dispose();
  w.s.lost();
  await w.c.advance(10_000);
  assert.equal(w.calls(), 1);
  const f = world([new Error("down")]);
  f.s.start();
  await f.c.advance(RECONNECT_GIVE_UP_MS + 5000);
  assert.equal(f.s.state().kind, "failed");
  f.heal();
  f.s.resume();
  await f.c.advance(0);
  assert.equal(f.s.state().kind, "ready");
});
