// A call another module only forwarded for someone (CallOpts.asCaller) is never "a call another capability made" in the sense of module code: whatever its depth, it is the caller's own call.
import test from "node:test";
import assert from "node:assert/strict";
import { isSystemCall } from "./trust.ts";
import * as trust from "./trust.ts";

const person = { kind: "person", id: "usr_sana" };
const host = { kind: "service", id: "svc_host" };

test("isSystemCall: a call one level down is system, unless it was only forwarded for its caller", () => {
  assert.equal(isSystemCall({ depth: 1, principal: person }), true, "module code one level down");
  assert.equal(isSystemCall({ depth: 1, principal: person, forwarded: false }), true);
  assert.equal(isSystemCall({ depth: 0, principal: person }), false, "the gateway");
  assert.equal(isSystemCall({ depth: 1, principal: person, forwarded: true }), false, "a stored schedule fired for a member");
  assert.equal(isSystemCall({ depth: 2, principal: person, forwarded: true }), false, "however deep it sits");
  assert.equal(isSystemCall({ depth: 7, principal: { kind: "agent", id: "agt_scout" }, forwarded: true }), false);
  assert.equal(isSystemCall({ principal: person, forwarded: true }), false, "no depth at all");
});

test("isSystemCall: the host's own identity stays trusted, forwarded or not (no member can be it)", () => {
  assert.equal(isSystemCall({ depth: 0, principal: host }), true);
  assert.equal(isSystemCall({ depth: 1, principal: host, forwarded: true }), true);
});

test("isForwarded: only the flag set to true counts", () => {
  assert.equal(trust.isForwarded({ forwarded: true }), true);
  assert.equal(trust.isForwarded({ forwarded: false }), false);
  assert.equal(trust.isForwarded({}), false);
});
