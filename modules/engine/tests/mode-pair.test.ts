// The person's security mode for a local tool (rc.8): this Space's entry, else the base; the owner's floor; nothing readable means Ask.
import test from "node:test";
import assert from "node:assert/strict";
import { modePair } from "../api-tools.ts";

test("the Space's own entry wins over the base, a missing floor lets anyone pick Auto, and a floor holds", () => {
  assert.deepEqual(modePair({ value: { base: "ask", spaces: { spc_1: "auto" } } }, "spc_1"), { person: "auto", floor: "auto" });
  assert.deepEqual(modePair({ value: { base: "allow", spaces: { spc_2: "auto" } } }, "spc_1"), { person: "allow", floor: "auto" });
  assert.deepEqual(modePair({ value: { base: "auto", spaces: {} }, floor: { base: "ask", spaces: {} } }, "spc_1"), { person: "auto", floor: "ask" });
  assert.deepEqual(modePair({ value: "allow", floor: "allow" }, "spc_1"), { person: "allow", floor: "allow" });
});

test("nothing readable means the strictest: Ask, held to Ask", () => {
  assert.deepEqual(modePair(undefined, "spc_1"), { person: "ask", floor: "ask" });
  assert.deepEqual(modePair({ value: { base: "nonsense" } }, "spc_1"), { person: "ask", floor: "auto" });
  assert.deepEqual(modePair({ value: { base: "auto" }, floor: "nonsense" }, "spc_1"), { person: "auto", floor: "ask" });
});
