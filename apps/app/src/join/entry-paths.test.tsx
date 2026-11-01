// The dead ends that a walk through every way in found, each held down: a Space that does not answer is not "no password", a wrong password stays on the lock, too many tries says so, a taken username goes
// back to where it can be fixed, a failure is never raw text, and the first frame is the same quiet sheet for every path.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../onboarding/test-dom.ts";
import { CapError } from "../shell/session/caps.ts";
import { JoinRefused, acceptDesktopJoin } from "../shell/session/desktop.ts";
import { LockScreen, passwordKeyState, unlockWithPassword } from "../shell/session/KeyGate.tsx";
import { SessionGate } from "../shell/session/SessionGate.tsx";
import { MANY_TRIES, OFFLINE_SPACE, TOO_MANY, WRONG_SIGN_IN, isMiss, signInLine } from "./failure.ts";
import { JoinFrame, Opening } from "./kit.tsx";
import { initialState, reduce } from "./logic.ts";
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
