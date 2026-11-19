// Getting in, as one explicit state machine. The gate runs on it: every decision goes through decideEntry, decideLanded and troubleKind, and the gate's own screen state is the reducer
// overlayStep at the bottom of this file (SessionGate holds no other flag for it). `step` is the whole-flow model the random test walks; getting-in-walk.test.tsx walks the real gate itself. Pure: no storage, no network, no React. The gate (SessionGate.tsx) asks `decideEntry` and `decideLanded` for the two decisions every way in shares
// (what an address turned out to be, and where a way in goes when it did not open), and `step` is the whole machine the tests walk in random order to prove two things for every state and every
// failure: there is no dead end (every state has a move out and a path to a Space), and a saved sign-in is only ever removed by the person (signing out) or by the Space saying so (an expired or
// revoked session); never by being offline, slow, asleep, moved, opened in two tabs, or by clearing old data.
import type { Found } from "./caps.ts";

/** What the address box does with what is at the address. */
export type EntryOutcome =
  | { to: "box-line"; why: "no-space" | "not-answering" | "not-a-space" }
  /** A web page on another address than the Space: the browser goes there itself, and that page does the rest. */
  | { to: "browser-goes" }
  | { to: "landed" }
  | { to: "enter" };

export interface EntryInput {
  found: Found;
  /** A web page (not the desktop app) on another address than this one. */
  away: boolean;
}

/** One answer for the address box and every link: no Space and no answer are said under the box; a Space on another address is handed to the browser; the rest go the way that fits. */
export function decideEntry({ found, away }: EntryInput): EntryOutcome {
  if (found.kind === "none") return { to: "box-line", why: "no-space" };
  if (found.kind === "offline") return { to: "box-line", why: "not-answering" };
  if (away) return { to: "browser-goes" };
  if (found.kind === "there") return { to: "box-line", why: "not-a-space" };
  if (found.kind === "relay") return { to: "landed" };
  return { to: "enter" };
}

export type LandedOutcome = "open-in-browser" | "browser-goes" | "trouble";

/** A way in that did not open as a Space this window can use: the browser for a relay Space that is awake (the app opens it, a web page on another address goes there), else the screen that says what happened. */
export function decideLanded(o: { found: Found; bridge: boolean; away: boolean }): LandedOutcome {
  const { found } = o;
  if (found.kind === "relay" && !(found.sure && !found.online)) {
    if (o.bridge) return "open-in-browser";
    if (o.away) return "browser-goes";
  }
  return "trouble";
}

/** What the screen for a way in that did not open says and offers. Every kind carries at least one press that moves on. */
export type TroubleKind = "asleep" | "moved-to-relay" | "not-answering" | "no-space" | "not-a-space";
export function troubleKind(found: Found, savedHere: boolean): TroubleKind {
  if (found.kind === "relay") return found.sure && !found.online ? "asleep" : savedHere ? "moved-to-relay" : "asleep";
  if (found.kind === "none") return "no-space";
  if (found.kind === "there") return "not-a-space";
  return "not-answering";
}

// ---- the whole machine ----

export type Place = "app" | "web";
export interface Ctx {
  place: Place;
  /** Addresses with a saved sign-in. */
  saved: readonly string[];
  /** Addresses listed in Your Spaces (a superset in practice; a Space stays listed after signing out). */
  known: readonly string[];
}

export type State =
  | { s: "list" }
  | { s: "box"; line?: "no-space" | "not-answering" | "not-a-space" | "invalid" }
  | { s: "finding"; address: string; from: "box" | "row" | "shell"; attempt: number }
  | { s: "trouble"; address: string; kind: TroubleKind }
  | { s: "browser"; address: string }
  | { s: "signin"; address: string }
  | { s: "shell"; address: string };

export type Event =
  | { e: "open" }
  | { e: "pick"; address: string }
  | { e: "submit"; address: string | null }
  | { e: "found"; found: Found }
  | { e: "quiet-retry" }
  | { e: "try-again" }
  | { e: "wake" }
  | { e: "open-in-browser" }
  | { e: "clear-old-data" }
  | { e: "back" }
  | { e: "add" }
  | { e: "signed-in" }
  | { e: "shell-opened" }
  | { e: "shell-unreachable" }
  | { e: "session-expired" }
  | { e: "device-revoked" }
  | { e: "sign-out" }
  | { e: "storage-cleared" }
  | { e: "other-tab-signed-out" }
  | { e: "forget"; address: string };

export const QUIET_TRIES = 3;

const has = (list: readonly string[], a: string): boolean => list.includes(a);
const without = (list: readonly string[], a: string): string[] => list.filter((x) => x !== a);
const add = (list: readonly string[], a: string): string[] => (has(list, a) ? [...list] : [...list, a]);

// The screens Getting in puts over the sign-in and the shell (Your Spaces, a Space that did not open, a relay Space handed to the browser) are decided by overlayStep, the reducer SessionGate
// runs: `step` below asks it for every move into or out of them, so the model and the gate cannot disagree about those screens.
type Tr = { address: string; kind: TroubleKind };
type Br = { address: string };
const toOverlay = (st: State): Overlay<Tr, Br> => ({
  ...(OVERLAY_START as Overlay<Tr, Br>),
  home: st.s === "list" || (st.s === "finding" && st.from === "row"),
  trouble: st.s === "trouble" ? { address: st.address, kind: st.kind } : null,
  browser: st.s === "browser" ? { address: st.address } : null,
  reaching: st.s === "finding" && st.from === "row" ? st.address : null,
});
const viewOf = (o: Overlay<Tr, Br>, other: State): State =>
  o.browser
    ? { s: "browser", address: o.browser.address }
    : o.trouble
      ? { s: "trouble", address: o.trouble.address, kind: o.trouble.kind }
      : o.home
        ? { s: "list" }
        : other;
const via = (st: State, ev: OverlayEvent<Tr, Br>, other: State): State => viewOf(overlayStep(toOverlay(st), ev), other);
const backTo = (st: State, ctx: Ctx): State => via(st, { e: "back", spaces: ctx.known.length > 0 }, { s: "box" });

export interface Stepped {
  state: State;
  ctx: Ctx;
}

/** The opening state: the Space used last when its sign-in is live, else Your Spaces, else the box. Nothing is asked of the network to decide it. */
export function opening(ctx: Ctx, last: string | null): State {
  if (last && has(ctx.saved, last)) return { s: "shell", address: last };
  return ctx.known.length ? { s: "list" } : { s: "box" };
}

/** Every state has at least one of these; the tests prove it for all of them. A state with no move out is a dead end and a bug. */
export function step(st: State, ev: Event, ctx: Ctx): Stepped {
  const stay = { state: st, ctx };
  // things that happen to a Space whatever the screen is
  if (ev.e === "storage-cleared") {
    // the browser or the person cleared what this page keeps: nothing is signed in, the list is empty; the box is the way in. Nothing is lost that was still there.
    return { state: { s: "box" }, ctx: { ...ctx, saved: [], known: [] } };
  }
  if (ev.e === "forget") {
    // taking a Space off the list never touches its saved sign-in (known-spaces.ts forgetKnown); a Space with a live sign-in stays listed
    if (has(ctx.saved, ev.address)) return stay;
    const known = without(ctx.known, ev.address);
    return { state: st.s === "list" && !known.length ? { s: "box" } : st, ctx: { ...ctx, known } };
  }
  if (ev.e === "other-tab-signed-out") {
    // another tab or window signed out of that Space: this one learns it at its next call and goes to that Space's sign-in; the Space stays listed
    return st.s === "shell"
      ? { state: { s: "signin", address: st.address }, ctx: { ...ctx, saved: without(ctx.saved, st.address) } }
      : stay;
  }
  switch (st.s) {
    case "list":
      if (ev.e === "pick") {
        if (!has(ctx.known, ev.address) && !has(ctx.saved, ev.address)) return stay;
        if (has(ctx.saved, ev.address)) return { state: { s: "shell", address: ev.address }, ctx };
        return { state: { s: "finding", address: ev.address, from: "row", attempt: 0 }, ctx };
      }
      if (ev.e === "add") return { state: { s: "box" }, ctx };
      return stay;
    case "box":
      if (ev.e === "submit") {
        if (ev.address === null) return { state: { s: "box", line: "invalid" }, ctx };
        if (has(ctx.saved, ev.address)) return { state: { s: "shell", address: ev.address }, ctx };
        return { state: { s: "finding", address: ev.address, from: "box", attempt: 0 }, ctx };
      }
      if (ev.e === "back") return ctx.known.length ? { state: via(st, { e: "list" }, st), ctx } : stay;
      return stay;
    case "finding": {
      if (ev.e === "quiet-retry")
        return st.attempt < QUIET_TRIES - 1 ? { state: { ...st, attempt: st.attempt + 1 }, ctx } : stay;
      if (ev.e === "back") return { state: st.from === "box" ? { s: "box" } : backTo(st, ctx), ctx };
      if (ev.e !== "found") return stay;
      const f = ev.found;
      if (st.from === "box") {
        const o = decideEntry({ found: f, away: false });
        if (o.to === "box-line") return { state: { s: "box", line: o.why }, ctx };
      }
      if (f.kind === "direct" && st.from === "shell") return { state: { s: "shell", address: st.address }, ctx };
      if (f.kind === "direct")
        return { state: { s: "signin", address: st.address }, ctx: { ...ctx, known: add(ctx.known, st.address) } };
      if (f.kind === "relay" && ctx.place === "app" && !(f.sure && !f.online))
        return {
          state: via(st, { e: "browser", browser: { address: st.address } }, st),
          ctx: { ...ctx, known: add(ctx.known, st.address) },
        };
      return {
        state: via(
          st,
          { e: "trouble", trouble: { address: st.address, kind: troubleKind(f, has(ctx.saved, st.address)) } },
          st,
        ),
        ctx,
      };
    }
    case "trouble":
      if (ev.e === "try-again" || ev.e === "wake")
        return {
          state: { s: "finding", address: st.address, from: has(ctx.saved, st.address) ? "shell" : "row", attempt: 0 },
          ctx,
        };
      if (ev.e === "open-in-browser")
        return ctx.place === "app"
          ? { state: via(st, { e: "browser", browser: { address: st.address } }, st), ctx }
          : stay;
      if (ev.e === "clear-old-data")
        return ctx.place === "web"
          ? { state: { s: "finding", address: st.address, from: "row", attempt: 0 }, ctx }
          : stay;
      if (ev.e === "back") return { state: backTo(st, ctx), ctx };
      return stay;
    case "browser":
      if (ev.e === "open-in-browser" || ev.e === "pick") return stay;
      if (ev.e === "back") return { state: backTo(st, ctx), ctx };
      // the Space moved to an address of its own: the same row signs in inside the app
      if (ev.e === "found" && ev.found.kind === "direct") return { state: { s: "signin", address: st.address }, ctx };
      return stay;
    case "signin":
      if (ev.e === "signed-in")
        return {
          state: { s: "shell", address: st.address },
          ctx: { ...ctx, saved: add(ctx.saved, st.address), known: add(ctx.known, st.address) },
        };
      if (ev.e === "back") return { state: backTo(st, ctx), ctx };
      return stay;
    case "shell":
      if (ev.e === "shell-unreachable")
        return { state: { s: "finding", address: st.address, from: "shell", attempt: 0 }, ctx };
      if (ev.e === "session-expired" || ev.e === "device-revoked" || ev.e === "sign-out")
        return { state: { s: "signin", address: st.address }, ctx: { ...ctx, saved: without(ctx.saved, st.address) } };
      if (ev.e === "back") return { state: backTo(st, ctx), ctx };
      return stay;
  }
}

/** The events that move a state on, for the tests: a state with none is a dead end. */
export function exits(st: State, ctx: Ctx): Event[] {
  const probes: Event[] = [
    { e: "back" },
    { e: "add" },
    { e: "try-again" },
    { e: "open-in-browser" },
    { e: "clear-old-data" },
    { e: "signed-in" },
    { e: "shell-unreachable" },
    { e: "session-expired" },
    { e: "submit", address: "https://a.example" },
    { e: "found", found: { kind: "direct" } },
    ...ctx.known.map((address): Event => ({ e: "pick", address })),
  ];
  return probes.filter((ev) => JSON.stringify(step(st, ev, ctx).state) !== JSON.stringify(st));
}

// ---- the gate's own screen state, run by the gate ----

/** What the gate shows over its sign-in and shell phases: Your Spaces, a Space being asked again (`reaching`), the screen for a way in that did not open, or a relay Space handed to the browser.
 * SessionGate holds exactly this (useReducer(overlayStep)); there is no other flag for any of it. */
export interface Overlay<T = unknown, B = unknown> {
  home: boolean;
  reaching: string | null;
  trouble: T | null;
  busy: boolean;
  browser: B | null;
}
export const OVERLAY_START: Overlay = { home: false, reaching: null, trouble: null, busy: false, browser: null };

export type OverlayEvent<T = unknown, B = unknown> =
  /** Going into a Space or its sign-in: nothing of Getting in stays on screen. */
  | { e: "enter" }
  /** Leaving Your Spaces for the address box. */
  | { e: "leave-list" }
  | { e: "list" }
  | { e: "reach"; address: string | null }
  | { e: "trouble"; trouble: T }
  | { e: "busy"; on: boolean }
  | { e: "trouble-clear" }
  | { e: "browser"; browser: B }
  /** Back from a screen about one Space. */
  | { e: "back"; spaces: boolean };

export function overlayStep<T, B>(o: Overlay<T, B>, ev: OverlayEvent<T, B>): Overlay<T, B> {
  switch (ev.e) {
    case "enter":
      return { ...o, home: false, reaching: null, busy: false, trouble: null, browser: null };
    case "leave-list":
      return { ...o, home: false };
    case "list":
      return { ...o, home: true };
    case "reach":
      return { ...o, reaching: ev.address };
    case "trouble":
      return { ...o, reaching: null, browser: null, trouble: ev.trouble };
    case "busy":
      return { ...o, busy: ev.on };
    case "trouble-clear":
      return { ...o, trouble: null };
    case "browser":
      return { ...o, trouble: null, reaching: null, home: false, browser: ev.browser };
    case "back":
      return { ...o, trouble: null, browser: null, home: ev.spaces ? true : o.home };
  }
}

// ---- the gate's phase: what is open under the Getting in screens ----

export type GatePhase<S> =
  | { kind: "opening-personal" }
  | { kind: "start-failed"; stored: S }
  | { kind: "signin" }
  | { kind: "shell"; stored: S };

/** A saved Space is open (`in`; with none it is the sign-in, which is how a gate never carries a prior Space across an address change), nothing is open (`out`), this computer's own Space is
 * starting (`opening`), or it did not start (`start-failed`: the saved sign-in is kept, Try again or Sign in). The one place the phase changes. */
export type PhaseEvent<S> =
  | { e: "in"; stored: S | null }
  | { e: "out" }
  | { e: "opening" }
  | { e: "start-failed"; stored: S };

export function phaseStep<S>(p: GatePhase<S>, ev: PhaseEvent<S>): GatePhase<S> {
  switch (ev.e) {
    case "in":
      if (!ev.stored) return p.kind === "signin" ? p : { kind: "signin" };
      return p.kind === "shell" && p.stored === ev.stored ? p : { kind: "shell", stored: ev.stored };
    case "out":
      return p.kind === "signin" ? p : { kind: "signin" };
    case "opening":
      return p.kind === "opening-personal" ? p : { kind: "opening-personal" };
    case "start-failed":
      return { kind: "start-failed", stored: ev.stored };
  }
}
