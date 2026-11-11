// Sign out is found by typing too (rc.22 client walk, journey 8: typing "sign out" listed files). The Space menu keeps its Sign Out, which is where the prototype puts it.
import test from "node:test";
import assert from "node:assert/strict";
import { gateActions } from "./gate.ts";

test("Sign out is an action only where the shell can sign out, and typing it finds it", () => {
  assert.ok(!gateActions({ away: false, offline: false }, true).some((a) => a.key === "session.sign-out"), "no handler, no action");
  const acts = gateActions({ away: false, offline: false }, true, true);
  const hit = acts.filter((a) => a.title.toLowerCase().includes("sign out"));
  assert.deepEqual(hit.map((a) => [a.key, a.title]), [["session.sign-out", "Sign out"]]);
});
