import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { KeyGate, LockScreen, NOTICE_LINE, NoPasswordKey, SHEET_LINE } from "./KeyGate.tsx";
import { lockName } from "./stored.ts";
import { forgetKey, keepKey, keyIsKept, rehandKey } from "../../../../../client/src/gateway/key-keeper.ts";

const text = (h: string): string => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

test("the lock screen names the person, asks for the password and offers Unlock", () => {
  const t = text(renderToStaticMarkup(<LockScreen name="Irfad" onUnlock={async () => undefined} />));
  assert.match(t, /Welcome back, Irfad/);
  assert.match(t, /Password/);
  assert.match(t, /Unlock/);
});

test("a Space server over https is checked at launch behind the calm loading state; an address with no key door goes straight in", () => {
  const checked = renderToStaticMarkup(<KeyGate baseUrl="https://team.example.com" token="t" name="Irfad"><p>the shell</p></KeyGate>);
  assert.match(checked, /data-testid="lock-checking"/);
  assert.doesNotMatch(text(checked), /the shell/, "no shell flash before it is known whether the key is held");
  const plain = renderToStaticMarkup(<KeyGate baseUrl="http://10.0.0.2:7777" token="t" name="Irfad"><p>the shell</p></KeyGate>);
  assert.match(plain, /the shell/, "plain http to another machine never holds a key");
});

test("on this computer a calm loading state shows until the daemon answers: no blank page, no shell flash behind the lock", () => {
  const html = renderToStaticMarkup(<KeyGate baseUrl="http://127.0.0.1:1" token="t" name="Irfad"><p>the shell</p></KeyGate>);
  assert.match(html, /data-testid="lock-checking"/);
  assert.match(html, /data-icon="vyre-mark"/, "the mark, not a blank page");
  assert.doesNotMatch(text(html), /the shell/);
});

test("the lock screen has a quiet way out: Forgot password and Sign out; an account with no password key is told so and can go on", () => {
  const t = text(renderToStaticMarkup(<LockScreen name="Irfad" onUnlock={async () => undefined} onForgot={() => undefined} onSignOut={() => undefined} />));
  assert.match(t, /Forgot password/);
  assert.match(t, /Sign out/);
  const n = text(renderToStaticMarkup(<NoPasswordKey onContinue={() => undefined} onSignOut={() => undefined} />));
  assert.match(n, /No password here/);
  assert.match(n, /Continue/);
});

test("the key is kept in memory only for the session and dropped on sign-out; plain http to another machine is never handed it", async () => {
  keepKey(new Uint8Array(32).fill(5));
  assert.equal(keyIsKept(), true);
  assert.equal(await rehandKey("http://10.0.0.2:7777", "t"), false);
  forgetKey();
  assert.equal(keyIsKept(), false);
});

test("the lock greets the first name of the display name, and the username only for a session saved before that was kept", () => {
  assert.equal(lockName({ displayName: "Nadia Noor", username: "nadia" }), "Nadia");
  assert.equal(lockName({ username: "nadia" }), "nadia");
  assert.equal(lockName({}), "");
  assert.equal(lockName({ displayName: "  ", username: "nadia" }), "nadia");
});

test("the key is handed again when the link becomes live (first time or back after a drop) on a Space with a key door, and never otherwise", async () => {
  const { handOnLive } = await import("../../../../../client/src/gateway/key-keeper.ts");
  assert.equal(handOnLive("offline", "live", true), true, "first live after the session opened");
  assert.equal(handOnLive("reconnecting", "live", true), true, "back after a drop");
  assert.equal(handOnLive("live", "live", true), false);
  assert.equal(handOnLive("live", "offline", true), false);
  assert.equal(handOnLive("offline", "live", false), false, "no key door: plain http to another machine");
});

test("an open app that holds the key asks the Space again every beat and hands it over; one that holds none asks nothing; the stop ends it", async () => {
  const { watchKey } = await import("../../../../../client/src/gateway/key-keeper.ts");
  const ticks: Array<() => void> = [];
  const calls: string[] = [];
  const set = ((f: () => void) => { ticks.push(f); return 1; }) as unknown as typeof setInterval;
  let cleared = 0;
  const clear = (() => { cleared++; }) as unknown as typeof clearInterval;
  const rehand = (async (url: string, token: string) => { calls.push(`${url}|${token}`); return true; }) as unknown as typeof rehandKey;
  forgetKey();
  const stop = watchKey("https://team.example.com", () => "tok", { set, clear, rehand });
  ticks[0]!();
  assert.deepEqual(calls, [], "a device that was never unlocked here has no key to hand over");
  keepKey(new Uint8Array(32).fill(9));
  ticks[0]!();
  assert.deepEqual(calls, ["https://team.example.com|tok"]);
  stop();
  assert.equal(cleared, 1);
  forgetKey();
  assert.equal(watchKey("http://10.0.0.2:7777", () => "tok", { set, clear, rehand })(), undefined, "no key door, nothing watched");
  assert.equal(ticks.length, 1);
});

test("the launch lock for a Space server: shown only when no one holds the key and the account has a password; Not now is offered there", async () => {
  const { remoteGateState } = await import("./key-unlock.ts");
  const calls: string[] = [];
  const mk = (o: { kept?: boolean; holds?: boolean | null; pw?: "yes" | "no" | "unknown" }) => ({
    kept: () => o.kept === true,
    rehand: async () => { calls.push("rehand"); return true; },
    serverHolds: async () => { calls.push("asked"); return o.holds === undefined ? false : o.holds; },
    passwordKey: async () => o.pw ?? "yes",
  });
  assert.equal(await remoteGateState(mk({ kept: true })), "open", "an app that holds the key hands it over and goes in");
  assert.deepEqual(calls, ["rehand"]);
  calls.length = 0;
  assert.equal(await remoteGateState(mk({ holds: true })), "open", "the server already holds it (another device unlocked)");
  assert.equal(await remoteGateState(mk({ holds: null })), "open", "a server that did not answer is not read as locked");
  assert.equal(await remoteGateState(mk({ holds: false, pw: "no" })), "open", "an account that signed in another way has no password to ask for");
  assert.equal(await remoteGateState(mk({ holds: false, pw: "unknown" })), "open");
  assert.equal(await remoteGateState(mk({ holds: false, pw: "yes" })), "locked", "relaunched, the server lost it, nobody holds it: the lock shows");
  const t = text(renderToStaticMarkup(<LockScreen name="Irfad" onUnlock={async () => undefined} onSkip={() => undefined} />));
  assert.match(t, /Not now/);
  assert.doesNotMatch(text(renderToStaticMarkup(<LockScreen name="Irfad" onUnlock={async () => undefined} />)), /Not now/, "the lock on this computer has no way round");
});

test("mid-session the app stays on screen: the lock is a quiet notice in the top bar with Unlock and no dismiss; the full-screen lock is for launch only", async () => {
  const { noticeAfterBeat } = await import("./key-unlock.ts");
  assert.equal(noticeAfterBeat("locked"), "show", "a restart that lost the key raises the notice, every time it is found");
  assert.equal(noticeAfterBeat("open"), "clear", "another device unlocked: it clears");
  assert.equal(NOTICE_LINE, "Sign-ins locked");
  assert.match(SHEET_LINE, /unlocks your sign-ins on this server/);
});

test("an Unlock sheet asked for on a Space server carries its own words and the way out for a forgotten password", async () => {
  const gate = await import("./vault-gate.ts");
  let seen: unknown;
  gate.registerVaultPrompt(async (_u, words) => { seen = words; return true; });
  const forgot = (): void => undefined;
  assert.equal(await gate.askVaultUnlock(async () => undefined, { title: "Unlock your sign-ins", sub: SHEET_LINE, forgot }), true);
  assert.deepEqual(seen, { title: "Unlock your sign-ins", sub: SHEET_LINE, forgot });
  gate.registerVaultPrompt(null);
});
