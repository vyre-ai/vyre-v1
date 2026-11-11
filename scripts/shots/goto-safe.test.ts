// A screenshot or probe navigation is retried when Chromium aborts it with ERR_NETWORK_CHANGED (the CI host changed network interfaces mid-load), at most twice, and only for that error.
import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain .mjs
import { gotoSafe } from "./lib.mjs";

const pageFailing = (errors: string[]) => {
  const calls: unknown[][] = [];
  return { calls, goto: async (...a: unknown[]) => { calls.push(a); const e = errors.shift(); if (e !== undefined) throw new Error(e); return "response"; } };
};

test("ERR_NETWORK_CHANGED is retried, twice at most, and the answer of the navigation that worked comes back", async () => {
  const p = pageFailing(["page.goto: net::ERR_NETWORK_CHANGED at http://x/", "page.goto: net::ERR_NETWORK_CHANGED at http://x/"]);
  assert.equal(await gotoSafe(p, "http://x/", { waitUntil: "load" }), "response");
  assert.equal(p.calls.length, 3);
  assert.deepEqual(p.calls[2], ["http://x/", { waitUntil: "load" }], "each try uses the same address and options");
  const three = pageFailing(Array(3).fill("net::ERR_NETWORK_CHANGED"));
  await assert.rejects(() => gotoSafe(three, "http://x/", {}), /ERR_NETWORK_CHANGED/);
  assert.equal(three.calls.length, 3, "the third failure is thrown");
});

test("any other error is thrown at once", async () => {
  const p = pageFailing(["net::ERR_CONNECTION_REFUSED"]);
  await assert.rejects(() => gotoSafe(p, "http://x/", {}), /ERR_CONNECTION_REFUSED/);
  assert.equal(p.calls.length, 1);
});
