import test from "node:test";
import assert from "node:assert/strict";
import {
  OVERLAY_START,
  QUIET_TRIES,
  decideEntry,
  decideLanded,
  exits,
  opening,
  overlayStep,
  step,
  troubleKind,
} from "./getting-in-machine.ts";
import type { Ctx, Event, State } from "./getting-in-machine.ts";
import type { Found } from "./caps.ts";

const A = "https://northwind.example";
const B = "https://harbor.example";
const R = "https://lakeside.vyre.run";
const relay = (online: boolean, sure = true): Found => ({ kind: "relay", sure, label: "Lakeside", online, seenAt: 1 });
const FOUNDS: Found[] = [
  { kind: "direct" },
  relay(true),
  relay(false),
  relay(true, false),
  { kind: "there" },
  { kind: "none" },
  { kind: "offline" },
];

test("the address box: no Space and no answer are said under the box, a Space on another address goes to the browser, the rest land or go in", () => {
  assert.deepEqual(decideEntry({ found: { kind: "none" }, away: false }), { to: "box-line", why: "no-space" });
  assert.deepEqual(decideEntry({ found: { kind: "offline" }, away: true }), { to: "box-line", why: "not-answering" });
  assert.deepEqual(decideEntry({ found: { kind: "direct" }, away: true }), { to: "browser-goes" });
  assert.deepEqual(decideEntry({ found: { kind: "there" }, away: true }), { to: "browser-goes" });
  assert.deepEqual(decideEntry({ found: { kind: "there" }, away: false }), { to: "box-line", why: "not-a-space" });
  assert.deepEqual(decideEntry({ found: relay(true), away: false }), { to: "landed" });
  assert.deepEqual(decideEntry({ found: { kind: "direct" }, away: false }), { to: "enter" });
});

test("where a way in lands: an awake relay Space opens in the browser, a sleeping one says so, nothing answering says so", () => {
  assert.equal(decideLanded({ found: relay(true), bridge: true, away: false }), "open-in-browser");
  assert.equal(decideLanded({ found: relay(true), bridge: false, away: true }), "browser-goes");
  assert.equal(decideLanded({ found: relay(true, false), bridge: true, away: false }), "open-in-browser");
  assert.equal(decideLanded({ found: relay(false), bridge: true, away: false }), "trouble");
  assert.equal(decideLanded({ found: relay(true), bridge: false, away: false }), "trouble");
  assert.equal(decideLanded({ found: { kind: "offline" }, bridge: true, away: true }), "trouble");
  assert.equal(troubleKind(relay(false), false), "asleep");
  assert.equal(troubleKind({ kind: "offline" }, true), "not-answering");
  assert.equal(troubleKind({ kind: "none" }, true), "no-space");
});

test("opening goes straight into the last Space only while its sign-in is live; else Your Spaces; else the box", () => {
  const ctx: Ctx = { place: "app", saved: [A], known: [A, B] };
  assert.deepEqual(opening(ctx, A), { s: "shell", address: A });
  assert.deepEqual(opening(ctx, B), { s: "list" });
  assert.deepEqual(opening({ ...ctx, saved: [] }, A), { s: "list" });
  assert.deepEqual(opening({ place: "web", saved: [], known: [] }, null), { s: "box" });
});

const run = (st: State, evs: Event[], ctx: Ctx): { state: State; ctx: Ctx } =>
  evs.reduce((acc, ev) => step(acc.state, ev, acc.ctx), { state: st, ctx });

test("every failure on the way in, one by one: a screen with a press that moves on, and the saved sign-in kept", () => {
  const web: Ctx = { place: "web", saved: [A], known: [A, B, R] };
  const app: Ctx = { ...web, place: "app" };
  // offline, DNS or TLS failure and a slow Space all arrive as no answer after the quiet tries
  let r = run(
    { s: "list" },
    [{ e: "pick", address: B }, { e: "quiet-retry" }, { e: "quiet-retry" }, { e: "found", found: { kind: "offline" } }],
    web,
  );
  assert.deepEqual(r.state, { s: "trouble", address: B, kind: "not-answering" });
  assert.deepEqual(r.ctx.saved, [A]);
  r = run(r.state, [{ e: "try-again" }, { e: "found", found: { kind: "direct" } }], r.ctx);
  assert.deepEqual(r.state, { s: "signin", address: B });
  // the server goes down in the middle of a sign-in: the shell cannot open, the same screen; the sign-in stays and opens it once the server is back
  r = run({ s: "shell", address: A }, [{ e: "shell-unreachable" }, { e: "found", found: { kind: "offline" } }], web);
  assert.deepEqual(r.state, { s: "trouble", address: A, kind: "not-answering" });
  assert.deepEqual(r.ctx.saved, [A]);
  r = run(r.state, [{ e: "try-again" }, { e: "found", found: { kind: "direct" } }], r.ctx);
  assert.deepEqual(
    r.state,
    { s: "shell", address: A },
    "the server is back: the saved sign-in opens the Space again, still signed in",
  );
  // a relay Space asleep, then awake by itself
  r = run(
    { s: "list" },
    [
      { e: "pick", address: R },
      { e: "found", found: relay(false) },
    ],
    web,
  );
  assert.deepEqual(r.state, { s: "trouble", address: R, kind: "asleep" });
  r = run(r.state, [{ e: "wake" }, { e: "found", found: relay(true) }], r.ctx);
  assert.equal(
    r.state.s,
    "trouble",
    "the page here is the Space's own page: a relay Space that answers is asked again until it opens",
  );
  // a relay Space from the desktop app opens in the browser, and later at an address of its own
  r = run(
    { s: "box" },
    [
      { e: "submit", address: R },
      { e: "found", found: relay(true) },
    ],
    app,
  );
  assert.deepEqual(r.state, { s: "browser", address: R });
  assert.ok(r.ctx.known.includes(R), "it stays in Your Spaces");
  r = run(r.state, [{ e: "found", found: { kind: "direct" } }], r.ctx);
  assert.deepEqual(r.state, { s: "signin", address: R });
  // a name with no Space and an address that is not a Space say it under the box and stay there
  r = run(
    { s: "box" },
    [
      { e: "submit", address: "https://nowhere.vyre.run" },
      { e: "found", found: { kind: "none" } },
    ],
    web,
  );
  assert.deepEqual(r.state, { s: "box", line: "no-space" });
  r = run({ s: "box" }, [{ e: "submit", address: null }], web);
  assert.deepEqual(r.state, { s: "box", line: "invalid" });
});

test("expired session, revoked device and signing out lead to that Space's sign-in; the Space stays listed; another tab signing out does the same here", () => {
  const ctx: Ctx = { place: "web", saved: [A, B], known: [A, B] };
  for (const ev of ["session-expired", "device-revoked", "sign-out", "other-tab-signed-out"] as const) {
    const r = step({ s: "shell", address: A }, { e: ev }, ctx);
    assert.deepEqual(r.state, { s: "signin", address: A }, ev);
    assert.deepEqual(r.ctx.saved, [B], `${ev} removes only that Space's sign-in`);
    assert.deepEqual(r.ctx.known, [A, B], `${ev} keeps the list`);
  }
  // a tab that is not in that Space has nothing to do
  assert.deepEqual(step({ s: "list" }, { e: "other-tab-signed-out" }, ctx).ctx, ctx);
});

test("cleared storage ends on the box with nothing half-held; a Space that moved relay to domain and back opens in the right place", () => {
  const ctx: Ctx = { place: "web", saved: [A], known: [A] };
  for (const st of [
    { s: "list" },
    { s: "shell", address: A },
    { s: "trouble", address: A, kind: "asleep" },
  ] as State[]) {
    const r = step(st, { e: "storage-cleared" }, ctx);
    assert.deepEqual(r.state, { s: "box" });
    assert.deepEqual([r.ctx.saved, r.ctx.known], [[], []]);
    assert.ok(exits(r.state, r.ctx).length > 0);
  }
  // a saved Space whose address moved to the relay: asked where it is now, it is the browser for the app
  const app: Ctx = { place: "app", saved: [], known: [A] };
  const r = run(
    { s: "list" },
    [
      { e: "pick", address: A },
      { e: "found", found: relay(true) },
    ],
    app,
  );
  assert.deepEqual(r.state, { s: "browser", address: A });
  const back = run(r.state, [{ e: "found", found: { kind: "direct" } }], r.ctx);
  assert.deepEqual(back.state, { s: "signin", address: A });
});

// ---- random order: no dead end, nothing lost ----

function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
}
const ADDRS = [A, B, R];
function randomEvent(r: () => number, ctx: Ctx): Event {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const kinds = [
    () => ({ e: "pick", address: pick(ADDRS) }) as Event,
    () => ({ e: "submit", address: r() < 0.15 ? null : pick(ADDRS) }) as Event,
    () => ({ e: "found", found: pick(FOUNDS) }) as Event,
    () => ({ e: "quiet-retry" }) as Event,
    () => ({ e: "try-again" }) as Event,
    () => ({ e: "wake" }) as Event,
    () => ({ e: "open-in-browser" }) as Event,
    () => ({ e: "clear-old-data" }) as Event,
    () => ({ e: "back" }) as Event,
    () => ({ e: "add" }) as Event,
    () => ({ e: "signed-in" }) as Event,
    () => ({ e: "shell-opened" }) as Event,
    () => ({ e: "shell-unreachable" }) as Event,
    () => ({ e: "session-expired" }) as Event,
    () => ({ e: "device-revoked" }) as Event,
    () => ({ e: "sign-out" }) as Event,
    () => ({ e: "other-tab-signed-out" }) as Event,
    () => ({ e: "storage-cleared" }) as Event,
    () => ({ e: "forget", address: pick(ctx.known.length ? ctx.known : ADDRS) }) as Event,
  ];
  return pick(kinds)();
}
const removers = new Set<Event["e"]>([
  "sign-out",
  "session-expired",
  "device-revoked",
  "other-tab-signed-out",
  "storage-cleared",
]);

test("random order, 400 walks of 300 events: never a dead end, a saved sign-in is removed only by signing out, the Space saying so, or the storage itself being cleared", () => {
  for (let seed = 1; seed <= 400; seed++) {
    const r = rng(seed);
    let ctx: Ctx = {
      place: seed % 2 ? "app" : "web",
      saved: seed % 3 ? [A] : [],
      known: seed % 5 ? [A, B] : seed % 3 ? [A] : [],
    };
    let state: State = opening(ctx, A);
    for (let i = 0; i < 300; i++) {
      const ev = randomEvent(r, ctx);
      const was = ctx;
      const next = step(state, ev, ctx);
      state = next.state;
      ctx = next.ctx;
      // nothing lost: a sign-in that disappeared was taken by one of the events that may take it, and only the one of that Space
      const gone = was.saved.filter((a) => !ctx.saved.includes(a));
      if (gone.length) assert.ok(removers.has(ev.e), `seed ${seed} step ${i}: ${ev.e} dropped a sign-in`);
      // the list only shrinks when the person forgets a Space or the storage is cleared
      const lost = was.known.filter((a) => !ctx.known.includes(a));
      if (lost.length)
        assert.ok(
          ev.e === "forget" || ev.e === "storage-cleared",
          `seed ${seed} step ${i}: ${ev.e} dropped a Space from the list`,
        );
      // a Space with a saved sign-in is always listed
      for (const a of ctx.saved)
        assert.ok(ctx.known.includes(a) || ev.e === "forget", `seed ${seed}: ${a} signed in but not listed`);
      // no dead end: some press leaves this state
      assert.ok(exits(state, ctx).length > 0, `seed ${seed} step ${i}: dead end at ${JSON.stringify(state)} (${ev.e})`);
    }
  }
});

test("from any state a path to a Space or to the box exists using only the person's presses and the Space answering", () => {
  const ctx: Ctx = { place: "app", saved: [A], known: [A, B, R] };
  const states: State[] = [
    { s: "list" },
    { s: "box" },
    { s: "box", line: "no-space" },
    { s: "finding", address: B, from: "row", attempt: QUIET_TRIES - 1 },
    { s: "trouble", address: B, kind: "not-answering" },
    { s: "trouble", address: R, kind: "asleep" },
    { s: "browser", address: R },
    { s: "signin", address: B },
    { s: "shell", address: A },
  ];
  const goal = (s: State): boolean => s.s === "shell" || s.s === "signin";
  for (const web of [false, true]) {
    const c: Ctx = { ...ctx, place: web ? "web" : "app" };
    for (const from of states) {
      const seen = new Set<string>();
      let frontier: State[] = [from];
      let reached = goal(from);
      for (let depth = 0; depth < 6 && !reached; depth++) {
        const nextFrontier: State[] = [];
        for (const st of frontier) {
          const moves: Event[] = [
            ...exits(st, c),
            { e: "found", found: { kind: "direct" } },
            { e: "submit", address: A },
            { e: "pick", address: B },
          ];
          for (const ev of moves) {
            const n = step(st, ev, c).state;
            if (goal(n)) reached = true;
            const key = JSON.stringify(n);
            if (!seen.has(key)) {
              seen.add(key);
              nextFrontier.push(n);
            }
          }
        }
        frontier = nextFrontier;
      }
      assert.ok(reached, `${JSON.stringify(from)} on ${web ? "web" : "app"} cannot reach a Space`);
    }
  }
});

test("the model's moves into and out of Your Spaces, a trouble screen and the browser screen are the gate's own reducer", () => {
  const ctx: Ctx = { place: "app", saved: [], known: [A] };
  const trouble: State = { s: "trouble", address: A, kind: "not-answering" };
  // the same events the gate sends give the same screen
  assert.deepEqual(overlayStep(OVERLAY_START, { e: "list" }).home, true);
  assert.deepEqual(step(trouble, { e: "back" }, ctx).state, { s: "list" });
  assert.deepEqual(step(trouble, { e: "back" }, { ...ctx, known: [] }).state, { s: "box" });
  const o = overlayStep({ ...OVERLAY_START, home: true, reaching: A }, { e: "trouble", trouble: 1 });
  assert.deepEqual(
    [o.home, o.reaching, o.trouble, o.browser],
    [true, null, 1, null],
    "a trouble screen shows over the list and ends the reaching",
  );
  const b = overlayStep(o, { e: "browser", browser: 2 });
  assert.deepEqual([b.home, b.trouble, b.browser], [false, null, 2], "the browser screen replaces both");
});
