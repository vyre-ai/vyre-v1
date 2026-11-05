// The crash guard every real-browser walk uses: an error page on screen or a React/script error in the console fails the walk (a crash must be a red test, not a screenshot).
import test from "node:test";
import assert from "node:assert/strict";
import { guardCrashes } from "./crash-guard.ts";

function fakePage(body: string) {
  const handlers: { pageerror: Array<(e: Error) => void>; console: Array<(m: { type(): string; text(): string }) => void> } = { pageerror: [], console: [] };
  return {
    handlers,
    page: {
      on(event: string, f: never) { (handlers as Record<string, unknown[]>)[event]!.push(f); },
      locator: () => ({ innerText: async () => body }),
      url: () => "http://x/chat",
    } as never,
  };
}

test("an error page on screen fails the check, naming the step", async () => {
  for (const text of ["Couldn't draw this page", "Couldn't open Vyre"]) {
    const { page } = fakePage(`Rivera ${text} Retry`);
    await assert.rejects(() => guardCrashes(page).check("after Plan"), /after Plan: an error page is on screen/);
  }
});

test("a React error or a script error in the console fails the next check; a refused read or a resize notice does not", async () => {
  const { page, handlers } = fakePage("fine");
  const g = guardCrashes(page);
  await g.check("start");
  handlers.console[0]!({ type: () => "error", text: () => "Failed to load resource: the server responded with a status of 403" });
  handlers.pageerror[0]!(new Error("ResizeObserver loop completed"));
  await g.check("noise is not a crash");
  handlers.console[0]!({ type: () => "error", text: () => "Error: Minified React error #310; visit https://react.dev/errors/310" });
  await assert.rejects(() => g.check("after the chat loaded"), /after the chat loaded: a crash was logged/);
  await g.check("each crash is reported once");
  handlers.pageerror[0]!(new Error("OpenLink is not defined"));
  await assert.rejects(() => g.check("next"), /a crash was logged/);
  assert.equal(g.crashes().length, 2);
});
