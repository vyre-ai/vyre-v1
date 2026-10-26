// sourceOf trusts X-Forwarded-For only from a loopback socket, and takes the last entry (added by the local proxy), never the visitor-controlled first one.
import test from "node:test";
import assert from "node:assert/strict";
import { sourceOf } from "../src/daemon/preauth.ts";

test("a loopback socket resolves to the last forwarded entry", () => {
  assert.equal(sourceOf({ "x-vyre-remote": "127.0.0.1", "x-forwarded-for": "1.2.3.4, 9.9.9.9" }), "9.9.9.9");
  assert.equal(sourceOf({ "x-vyre-remote": "::1", "x-forwarded-for": "9.9.9.9" }), "9.9.9.9");
});

test("a non-loopback socket ignores the header", () => {
  assert.equal(sourceOf({ "x-vyre-remote": "5.6.7.8", "x-forwarded-for": "1.2.3.4, 9.9.9.9" }), "5.6.7.8");
});
