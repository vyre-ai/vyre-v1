// open-retry.ts: a failed fetch on the first open is tried again by itself, a few times; an answer from the Space never is.
import test from "node:test";
import assert from "node:assert/strict";
import { CapError } from "../../../../../client/src/gateway/index.ts";
import { OPEN_RETRY_MS, openRetryDelay } from "./open-retry.ts";

test("a failed fetch is tried again once after 300 ms, then shown", () => {
  const e = new TypeError("Failed to fetch");
  assert.equal(openRetryDelay(e, 0), 300);
  assert.equal(openRetryDelay(e, OPEN_RETRY_MS.length), null);
});

test("an answer from the Space, and anything that is not a failed fetch, is not tried again here", () => {
  assert.equal(
    openRetryDelay(new CapError({ message: "no", code: "auth.unauthenticated", traceId: "t", status: 401 }), 0),
    null,
  );
  assert.equal(
    openRetryDelay(new CapError({ message: "boom", code: "internal.unexpected", traceId: "t", status: 500 }), 0),
    null,
  );
  assert.equal(openRetryDelay(new Error("This sign-in no longer matches the Space"), 0), null);
  assert.equal(openRetryDelay("nope", 0), null);
});
