// The dead ends that a walk through every way in found, each held down: a Space that does not answer is not "no password", a wrong password stays on the lock, too many tries says so, a taken username goes
// back to where it can be fixed, a failure is never raw text, and the first frame is the same quiet sheet for every path.
import test from "node:test";
import assert from "node:assert/strict";
import { act, useState } from "react";
import type React from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../onboarding/test-dom.ts";
import { CapError } from "../shell/session/caps.ts";
import { JoinRefused, acceptDesktopJoin } from "../shell/session/desktop.ts";
import { LockScreen, passwordKeyState, unlockWithPassword } from "../shell/session/KeyGate.tsx";
import { SessionGate } from "../shell/session/SessionGate.tsx";
import { MANY_TRIES, OFFLINE_SPACE, TOO_MANY, WRONG_SIGN_IN, isMiss, signInLine } from "./failure.ts";
import { readFileSync } from "node:fs";
import { Button, FirstFrame, JoinFrame, Opening } from "./kit.tsx";
import { withinStart } from "../shell/session/SessionGate.tsx";
import { whenUsable } from "../startup/marks.ts";
import { openVerifiedSession } from "../shell/session/stored.ts";
import { initialState, reduce, valid } from "./logic.ts";
import { JoinFlow } from "./JoinFlow.tsx";
import type { JoinInvite } from "./logic.ts";

const cap = (status: number, code: string, message = "server words"): CapError => new CapError({ status, code, message, traceId: "t" });
const INVITE: JoinInvite = { space: "Northwind", host: "northwind.example", by: "Maya Chen", role: "Member", sso: [], github: false, adminKey: false };
const type = async (n: { props: Record<string, unknown> } | null, value: string): Promise<void> => { await act(async () => { (n!.props["onChange"] as (e: unknown) => void)({ target: { value }, nativeEvent: { text: value } }); }); };

test("sign-in failures read one plain line each and never the server's words for a wrong password", () => {
  assert.equal(signInLine(cap(401, "auth.bad_credentials")), WRONG_SIGN_IN);
  assert.equal(signInLine(cap(429, "rate_limit.exceeded")), TOO_MANY);
  assert.equal(signInLine(new TypeError("Failed to fetch")), OFFLINE_SPACE);
  assert.doesNotMatch(signInLine(cap(500, "internal.unexpected", "stack at line 3")), /stack/);
  assert.equal(isMiss(cap(401, "auth.bad_credentials")), true);
  assert.equal(isMiss(new TypeError("x")), false, "being offline is not a wrong password");
});

test("too many wrong passwords in a row says so, though the server answers a locked account the same as a wrong one", async () => {
  installDom();
  const onSignIn = async (): Promise<"ok"> => { throw cap(401, "auth.bad_credentials"); };
  const root = await mount(createRoot, <JoinFlow invite={INVITE} initial={{ stage: "signin", siUser: "dana", siPw: "x" }} onSignIn={onSignIn} />);
  for (let i = 0; i < MANY_TRIES; i++) {
    await type(find(root as never, "si-password"), "wrong");
    await press(find(root as never, "next"));
    await flush();
    if (i < MANY_TRIES - 1) assert.equal(textOf(find(root as never, "join-error")), WRONG_SIGN_IN);
  }
  assert.equal(textOf(find(root as never, "join-error")), TOO_MANY);
  assert.equal((find(root as never, "si-password")!.props as { value?: string }).value ?? "", "", "the wrong password does not stay in the field");
});

test("a Space that did not answer is not an account with no password", async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    assert.equal(await passwordKeyState("http://127.0.0.1:1", "t"), "unknown");
    await assert.rejects(unlockWithPassword("http://127.0.0.1:1", "t", "pw"), /cannot reach the Space on this computer/, "plain words, not the fetch error");
  } finally { globalThis.fetch = real; }
});

test("the lock screen keeps a person on it after a wrong password and clears the field; offline starts with the line and can still be tried", async () => {
  installDom();
  let tries = 0;
  const root = await mount(createRoot, <LockScreen name="Dana" onForgot={() => undefined} onSignOut={() => undefined} onUnlock={async () => { tries++; throw new Error("That password is not right."); }} />);
  assert.equal(find(root as never, "lock-unlock")!.props["aria-disabled"], true, "Unlock waits for a password");
  await type(find(root as never, "lock-password"), "nope");
  await press(find(root as never, "lock-unlock"));
  await flush();
  assert.equal(tries, 1);
  assert.match(textOf(find(root as never, "lock-error")), /not right/);
  assert.ok(find(root as never, "lock-forgot") && find(root as never, "lock-signout"), "the ways out stay");
  const off = renderToStaticMarkup(<LockScreen name="Dana" notice="Vyre cannot reach the Space on this computer. Try again." onUnlock={async () => undefined} />);
  assert.match(off, /cannot reach the Space/);
  assert.match(off, /data-testid="lock-password"/);
});

test("a taken username goes back to the account step with the line, keeping what was typed", () => {
  const rules = { isTaken: () => false };
  const s = reduce({ ...initialState(INVITE), stage: "run", step: 3, user: "maya", pw: "harbor lamp" }, { t: "failed", message: "That username is taken.", step: 1 }, rules);
  assert.deepEqual([s.stage, s.step, s.error, s.pw], ["steps", 1, "That username is taken.", "harbor lamp"]);
  const next = reduce({ ...s, user: "sam", pw2: "harbor lamp" }, { t: "next" }, rules);
  assert.equal(next.error, "", "moving on clears the line");
  assert.match(renderToStaticMarkup(<JoinFlow invite={INVITE} initial={{ stage: "steps", step: 1, user: "maya", pw: "harbor lamp", pw2: "harbor lamp", error: "That username is taken." }} hold />), /That username is taken\./);
});

test("the Space refusing a duplicate username becomes JoinRefused at step 1; any other refusal stays plain", async () => {
  const join = { route: { kind: "join" as const, address: "https://northwind.example", code: "ABCD-EFGH", fingerprint: "abcdef12" }, preview: { spaceId: "spc_x", spaceName: "Northwind", invitedBy: "Maya", role: "Member", expiresAt: 0, fingerprint: "abcdef12" } };
  const values = { username: "maya", displayName: "Maya", password: "harbor lamp", deviceName: "d", trustDevice: true, ai: { choice: "none" as const } };
  const deps = (e: unknown) => ({ anonymous: async () => { throw e; }, open: async () => { throw new Error("not reached"); }, getSpace: async () => ({ id: "spc_x", marker: "m" }) });
  await assert.rejects(acceptDesktopJoin(join, values, deps(cap(409, "validation.duplicate"))), (e: unknown) => e instanceof JoinRefused && e.step === 1);
  await assert.rejects(acceptDesktopJoin(join, values, deps(new TypeError("offline"))), /Could not finish joining this Space/);
});

test("the first frame of every path is the mark on the sheet: no doors, no form, the same in the browser and the desktop app", () => {
  const first = renderToString(<SessionGate baseUrl={null} />);
  assert.match(first, /data-testid="entry-opening"/);
  assert.match(first, /data-icon="vyre-mark"/);
  for (const id of ["door-me", "door-invited", "si-user", "lock-password"]) assert.doesNotMatch(first, new RegExp(`data-testid="${id}"`));
  assert.match(renderToStaticMarkup(<Opening title="Opening your Vault" />), /Opening your Vault/);
  assert.match(renderToStaticMarkup(<JoinFrame><span /></JoinFrame>), /background-color:var\(--rail\)/, "the ground is the rail token");
});

test("a wait is the breathing mark after 300 ms, never a turning ring, and the word does not move", () => {
  const busy = renderToStaticMarkup(<JoinFrame><Button label="Sign in" busy /></JoinFrame>);
  assert.match(busy, /data-entry-wait/);
  assert.match(busy, /data-entry-after/);
  assert.match(busy, /aria-busy="true"/);
  assert.doesNotMatch(busy, /entry-spin/);
  assert.doesNotMatch(busy, /var\(--beacon\)/, "on a filled button the whole mark takes the button's ink, so the spark never sinks into the fill");
  assert.doesNotMatch(renderToStaticMarkup(<JoinFrame><Button label="Sign in" /></JoinFrame>), /data-entry-wait/);
  const kit = readFileSync(new URL("./kit.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(kit, /vyre-entry-spin|rotate\(360deg\)/);
  assert.match(kit, /vyre-entry-fade 140ms ease 300ms both/);
});

test("steps fade in 140 ms on every entry screen, and the onboarding cards use tokens, not colours of their own", () => {
  const read = (f: string): string => readFileSync(new URL(f, import.meta.url), "utf8");
  assert.match(read("./kit.tsx"), /\[data-entry-step\]\{animation:vyre-entry-fade 140ms/);
  assert.match(read("../onboarding/OnboardingScreen.tsx"), /\[data-vyre-ob\]\{animation:vyre-ob-in 140ms/);
  for (const f of ["./Checklist.tsx", "../onboarding/SessionsCard.tsx", "../onboarding/ChromeCard.tsx", "../onboarding/StepGlyph.tsx"]) assert.doesNotMatch(read(f), /#[0-9a-fA-F]{3,8}\b|gradient\(/, f);
});

test("a username the Space refused reads as taken, with no tick, and the line goes as soon as another is chosen", () => {
  const rules = { isTaken: () => false };
  const typed = { stage: "steps" as const, step: 1 as const, user: "maya", pw: "harbor lamp", pw2: "harbor lamp" };
  const s = reduce({ ...initialState(INVITE), stage: "run", step: 3, user: "maya", pw: typed.pw, pw2: typed.pw2 }, { t: "failed", message: "That username is taken.", step: 1 }, rules);
  assert.equal(s.refused, "maya");
  assert.equal(valid(s, rules), false, "the same name cannot go round again");
  const held = renderToStaticMarkup(<JoinFlow invite={INVITE} initial={{ ...typed, error: s.error, refused: "maya" }} hold />);
  assert.doesNotMatch(held, /data-testid="username-ok"/);
  assert.match(held, /data-testid="username-error"/);
  assert.match(held, /@maya is taken/);
  const other = renderToStaticMarkup(<JoinFlow invite={INVITE} initial={{ ...typed, user: "sam", error: s.error, refused: "maya" }} hold />);
  assert.match(other, /data-testid="username-ok"/);
  assert.doesNotMatch(other, /taken/);
  assert.equal(valid({ ...s, user: "sam" }, rules), true);
});

test("setup reads in the same typeface as the sheets: a web Text's own font class does not win", () => {
  assert.match(readFileSync(new URL("../onboarding/OnboardingScreen.tsx", import.meta.url), "utf8"), /\[data-testid="onboarding"\] \[dir="auto"\]:not\(\[data-mono\]\).*font-family:\$\{FONT\}/);
});

test("a control that is not ready yet is the quiet neutral everywhere, never a faded accent", () => {
  const read = (f: string): string => readFileSync(new URL(f, import.meta.url), "utf8");
  assert.match(read("../onboarding/card-style.ts"), /off: \{ backgroundColor: "var\(--field\)"/);
  for (const f of ["OnboardingScreen", "ChromeCard", "ConnectAiCard", "FoldersCard", "InterviewCard", "PairPhoneCard", "SameAccountOffer", "SessionsCard"]) assert.match(read(`../onboarding/${f}.tsx`), /off: CARD\.off,\n\s+offText: CARD\.offText/, f);
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("the first frame stays while something is opening and leaves as soon as nothing is, with no minimum: it can never add a wait", async () => {
  installDom();
  const show = { opening: true };
  let set: (v: boolean) => void = () => undefined;
  const Gate = (): React.ReactElement => { const [on, setOn] = useState(show.opening); set = setOn; return on ? <Opening /> : <span />; };
  const root = await mount(createRoot, <><Gate /><FirstFrame /></>);
  await act(async () => { await sleep(5); });
  assert.ok(find(root as never, "first-frame"), "up while opening");
  const left = Date.now();
  await act(async () => { set(false); });
  await act(async () => { await sleep(5); });
  assert.ok(find(root as never, "first-frame"), "still there for the crossfade");
  await act(async () => { await sleep(260); });
  assert.equal(find(root as never, "first-frame"), null, "gone once the crossfade is done");
  assert.ok(Date.now() - left < 700, "nothing waited for a timer of its own");
});

test("a page with nothing opening has no first frame to wait for", async () => {
  installDom();
  const root = await mount(createRoot, <><span /><FirstFrame /></>);
  await act(async () => { await sleep(280); });
  assert.equal(find(root as never, "first-frame"), null);
});

test("one screen handing over to the next inside the launch does not end the first frame", async () => {
  installDom();
  let set: (v: number) => void = () => undefined;
  const Gate = (): React.ReactElement => { const [n, setN] = useState(0); set = setN; return <Opening key={n} testID={`opening-${n}`} />; };
  const root = await mount(createRoot, <><Gate /><FirstFrame /></>);
  await act(async () => { set(1); });
  await act(async () => { await sleep(280); });
  assert.ok(find(root as never, "first-frame"), "two Openings in a row are one wait");
});

test("the launch is the ground and one clean mark: no sheet, no tile, no halftone, no bar and no heading; only the Spark moves", () => {
  const first = renderToStaticMarkup(<Opening />);
  for (const gone of [/data-testid="join-panel"/, /data-testid="entry-run"/, /role="heading"/, /<rect/, /clipPath/]) assert.doesNotMatch(first, gone);
  assert.equal(first.match(/<circle/g)?.length, 2, "the Spark and its halo, not a field of dots");
  assert.equal(first.match(/<path/g)?.length, 1, "one V");
  assert.match(first, /<circle[^>]*data-entry-halo/, "only the halo carries the animation; the V and the Spark are still");
  assert.equal(first.match(/data-entry-halo/g)?.length, 1);
  assert.ok(first.indexOf("data-entry-halo") < first.indexOf("<path"), "the halo is behind the V");
  assert.match(first, /width="64"/);
  const kit = readFileSync(new URL("./kit.tsx", import.meta.url), "utf8");
  assert.match(kit, /\[data-entry-halo\]\{[^}]*animation:vyre-entry-bloom 2800ms ease-in-out 2\}/, "it blooms twice and rests");
  assert.match(kit, /FIRST_LEAVE_MS = 220/);
  assert.match(kit, /prefers-reduced-motion[^"]*\[data-entry-halo\][^"]*\[data-entry-glide\]\{transition:none/, "less motion means no bloom and no glide");
});

test("the lock sheet hugs what is on it, with no gap kept for a line that is not there", () => {
  const empty = renderToStaticMarkup(<LockScreen name="Dana Wills" onUnlock={async () => undefined} onForgot={() => undefined} onSignOut={() => undefined} />);
  assert.match(empty, /Welcome back, Dana Wills/);
  assert.doesNotMatch(empty, /min-height:416px/);
  assert.doesNotMatch(empty, /data-testid="lock-error"/);
  assert.match(renderToStaticMarkup(<LockScreen name="" notice="Nope." onUnlock={async () => undefined} />), /data-testid="lock-error"/);
});

test("a session keeps the name as the person wrote it, for the lock screen", async () => {
  const kept: unknown[] = [];
  const open = async () => ({ def: { spaceId: "s" }, me: { id: "p", name: "Dana Wills" }, close: () => undefined });
  const stored = await openVerifiedSession({ baseUrl: "http://x", token: "t", username: "dana", open, getSpace: async () => ({ id: "s", marker: "m" }), persist: (s) => kept.push(s) });
  assert.equal(stored.displayName, "Dana Wills");
  assert.equal(stored.username, "dana");
});

test("a Personal Space that never answers fails, so the launch lands on Try again; one that answers is not cut off", async () => {
  await assert.rejects(withinStart(new Promise(() => undefined), 10), /did not start/);
  assert.equal(await withinStart(Promise.resolve("up"), 10), "up");
  await assert.rejects(withinStart(Promise.reject(new Error("no port")), 10), /no port/);
});

test("the first frame waits for the app to be usable, but only so long", async () => {
  const g = globalThis as unknown as { addEventListener?: unknown };
  const had = g.addEventListener;
  const on = new Map<string, () => void>();
  g.addEventListener = (t: string, f: () => void) => on.set(t, f);
  try {
    let done = false;
    void whenUsable(10_000).then(() => { done = true; });
    await sleep(1);
    assert.equal(done, false);
    on.get("vyre:usable")!();
    await sleep(1);
    assert.equal(done, true);
    await whenUsable(5);
  } finally { g.addEventListener = had; }
});

test("a slow start says so once: the hidden surface under the first frame stays quiet", async () => {
  installDom();
  const real = globalThis.setTimeout;
  (globalThis as { setTimeout: unknown }).setTimeout = (f: () => void, ms: number) => real(f, ms === 4000 ? 5 : ms);
  try {
    const root = await mount(createRoot, <><Opening /><FirstFrame /></>);
    await act(async () => { await sleep(20); });
    assert.equal(JSON.stringify((root as unknown as { toJSON(): unknown }).toJSON()).match(/Still opening/g)?.length, 1);
  } finally { (globalThis as { setTimeout: unknown }).setTimeout = real; }
});
