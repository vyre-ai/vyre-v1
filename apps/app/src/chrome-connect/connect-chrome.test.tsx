// The Connect Chrome page: what it says, that it hands a bound code to this window only, and every way the press can end.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectChromeScreen, NOT_ANSWERED, challengeFrom } from "./ConnectChromeScreen.tsx";

const H = "a".repeat(64);

test("only a well-formed 64 character hash is taken from the address", () => {
  assert.equal(challengeFrom(`#challenge=${H}`), H);
  assert.equal(challengeFrom(`#challenge=${H.toUpperCase()}`), H);
  for (const bad of [
    "",
    "#challenge=",
    `#challenge=${H}x`,
    `#challenge=${H.slice(1)}`,
    `#x=${H}`,
    `?challenge=${H}`,
    `#challenge=${H}&a=1`,
  ])
    assert.equal(challengeFrom(bad), null, bad);
});

test("the first frame offers Connect and Not now and names the Space and the person", () => {
  const html = renderToStaticMarkup(
    <ConnectChromeScreen call={async () => ({})} hash={`#challenge=${H}`} spaceName="Northwind" me="Imran Ibarra" />,
  );
  assert.match(html, /Connect Chrome to Northwind/);
  assert.match(html, /Imran Ibarra/);
  assert.ok(html.includes('data-testid="chrome-connect"') && html.includes('data-testid="chrome-decline"'));
});

test("an address with no valid value says the link ended and offers no Connect", () => {
  const html = renderToStaticMarkup(
    <ConnectChromeScreen call={async () => ({})} hash="#challenge=zz" spaceName="N" me="x" />,
  );
  assert.match(html, /This link ended/);
  assert.ok(!html.includes('data-testid="chrome-connect"'));
  assert.ok(NOT_ANSWERED.length > 0);
});

// ---- the press

import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press } from "../onboarding/test-dom.ts";

function fakeWindow() {
  const handlers: ((e: any) => void)[] = [];
  const w: any = {
    location: { origin: "https://northwind.vyre.run" },
    posted: [] as any[],
    addEventListener: (_t: string, f: (e: any) => void) => void handlers.push(f),
    removeEventListener: (_t: string, f: (e: any) => void) => void handlers.splice(handlers.indexOf(f), 1),
    postMessage: (m: unknown, origin: string) => void w.posted.push([m, origin]),
    handlers,
    reply: (data: any, over: any = {}) =>
      handlers.slice().forEach((f) => f({ data, origin: w.location.origin, source: w, ...over })),
  };
  return w;
}
const text = (n: { children?: unknown[] } | null): string =>
  (n?.children ?? []).map((c) => (typeof c === "string" ? c : text(c as never))).join("");

async function open(o: { fail?: boolean } = {}) {
  installDom();
  const win = fakeWindow();
  const calls: any[] = [];
  const timers: (() => void)[] = [];
  const done: string[] = [];
  const call = async (cap: string, input: any) => {
    calls.push([cap, input]);
    if (o.fail) throw new Error("no");
    return { code: "K7P2-9QXA", expiresAt: 1 };
  };
  const r = createRoot();
  await act(async () => {
    r.render(
      <ConnectChromeScreen
        call={call}
        hash={`#challenge=${H}`}
        spaceName="Northwind"
        me="Imran"
        win={win}
        onDone={() => done.push("done")}
        setTimer={(f) => timers.push(f)}
        clearTimer={() => {}}
      />,
    );
  });
  await flush();
  return { root: r.container as never, win, calls, timers, done };
}

test("Connect makes a code bound to the value's hash and hands it to this window only; the extension's answer finishes it", async () => {
  const t = await open();
  assert.deepEqual(t.calls, [], "nothing is made until the person presses");
  await press(find(t.root, "chrome-connect"));
  await flush();
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0][0], "identity.pair_create");
  assert.deepEqual([t.calls[0][1].purpose, t.calls[0][1].challenge], ["extension", H]);
  assert.deepEqual(t.win.posted, [[{ type: "vyre.chrome.code", code: "K7P2-9QXA" }, "https://northwind.vyre.run"]]);
  // a reply from anywhere but this window, or of another shape, is not the extension
  await act(async () => t.win.reply({ type: "vyre.chrome.linked", ok: true }, { origin: "https://evil.example" }));
  await act(async () => t.win.reply({ type: "vyre.chrome.linked", ok: true }, { source: {} }));
  await act(async () => t.win.reply({ type: "other" }));
  assert.equal(find(t.root, "chrome-done"), null);
  await act(async () => t.win.reply({ type: "vyre.chrome.linked", ok: true }));
  assert.ok(find(t.root, "chrome-done"));
  assert.equal(t.win.handlers.length, 0, "the listener is gone");
  await press(find(t.root, "chrome-done"));
  assert.deepEqual(t.done, ["done"]);
});

test("no answer from the extension says so, and Connect works again with a new code", async () => {
  const t = await open();
  await press(find(t.root, "chrome-connect"));
  await flush();
  await act(async () => t.timers[0]());
  assert.match(text(find(t.root, "chrome-unanswered")), /did not answer/);
  assert.equal(t.win.handlers.length, 0);
  await press(find(t.root, "chrome-connect"));
  await flush();
  assert.equal(t.calls.length, 2, "a second code, the first one is spent or lapses");
  assert.notEqual(t.calls[0][1].idempotencyKey, t.calls[1][1].idempotencyKey);
});

test("the Space refusing the code ends the page in words, and Not now connects nothing", async () => {
  const failed = await open({ fail: true });
  await press(find(failed.root, "chrome-connect"));
  await flush();
  assert.ok(find(failed.root, "chrome-close"));
  assert.deepEqual(failed.win.posted, []);
  const no = await open();
  await press(find(no.root, "chrome-decline"));
  await flush();
  assert.deepEqual(no.calls, []);
  assert.deepEqual(no.win.posted, []);
  assert.ok(find(no.root, "chrome-close"));
});
