import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { KeyGate, LockScreen, NoPasswordKey } from "./KeyGate.tsx";
import { forgetKey, keepKey, keyIsKept, rehandKey } from "../../../../../client/src/gateway/key-keeper.ts";

const text = (h: string): string => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

test("the lock screen names the person, asks for the password and offers Unlock", () => {
  const t = text(renderToStaticMarkup(<LockScreen name="Irfad" onUnlock={async () => undefined} />));
  assert.match(t, /Welcome back, Irfad/);
  assert.match(t, /Password/);
  assert.match(t, /Unlock/);
});

test("a Space that is not on this computer never shows the lock: it keeps its existing flows", () => {
  const html = renderToStaticMarkup(<KeyGate baseUrl="https://team.example.com" token="t" name="Irfad"><p>the shell</p></KeyGate>);
  assert.match(html, /the shell/);
});

test("on this computer a calm loading state shows until the daemon answers: no blank page, no shell flash behind the lock", () => {
  const t = text(renderToStaticMarkup(<KeyGate baseUrl="http://127.0.0.1:1" token="t" name="Irfad"><p>the shell</p></KeyGate>));
  assert.match(t, /Opening your Vault/);
  assert.doesNotMatch(t, /the shell/);
});

test("the lock screen has a quiet way out: Forgot password and Sign out; an account with no password key is told so and can go on", () => {
  const t = text(renderToStaticMarkup(<LockScreen name="Irfad" onUnlock={async () => undefined} onForgot={() => undefined} onSignOut={() => undefined} />));
  assert.match(t, /Forgot password/);
  assert.match(t, /Sign out/);
  const n = text(renderToStaticMarkup(<NoPasswordKey onContinue={() => undefined} onSignOut={() => undefined} />));
  assert.match(n, /no password here/);
  assert.match(n, /Continue/);
});

test("the key is kept in memory only for the session and dropped on sign-out; a foreign address is never handed it", async () => {
  keepKey(new Uint8Array(32).fill(5));
  assert.equal(keyIsKept(), true);
  assert.equal(await rehandKey("https://team.example.com", "t"), false);
  forgetKey();
  assert.equal(keyIsKept(), false);
});
