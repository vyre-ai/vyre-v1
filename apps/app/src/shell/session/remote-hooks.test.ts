// @tsx
// The tick a card follows: each invalidate of the session reaches whoever listens, on the same beat as the live queries.
import test from "node:test";
import assert from "node:assert/strict";
import { createRemoteScreenHooks } from "./remote-hooks.ts";

test("a card that reads by capability hears each invalidate, and stops when it leaves", () => {
  const hooks = createRemoteScreenHooks({ screens: new Map(), read: async () => ({}) });
  let heard = 0;
  const off = hooks.onInvalidate(() => { heard += 1; });
  hooks.invalidate();
  assert.equal(heard, 1);
  off();
  hooks.invalidate();
  assert.equal(heard, 1);
});
