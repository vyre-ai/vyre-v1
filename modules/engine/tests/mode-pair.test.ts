// The person's security mode for a local tool (rc.8): this Space's entry, else the base; the owner's floor; nothing readable means Ask.
import test from "node:test";
import assert from "node:assert/strict";
import { modePair } from "../api-tools.ts";
import { decideLocal, dialFor } from "../../../agent/src/tools/local.ts";
import type { ModePair, SecurityMode } from "../../../agent/src/tools/local.ts";

const pair = (d: ModePair): [SecurityMode, SecurityMode] => [d.person, d.floor];

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

test("the chat's mode is the one dial for local tools, and the owner's floor caps it", () => {
  const person = { person: "ask", floor: "auto" } as const;
  assert.deepEqual(dialFor("auto", person), { person: "auto", floor: "auto" }, "an Auto chat runs them whatever the person's old setting says");
  assert.deepEqual(dialFor("ask", { person: "auto", floor: "auto" }), { person: "ask", floor: "auto" });
  assert.deepEqual(dialFor("plan", { person: "auto", floor: "auto" }), { person: "ask", floor: "auto" });
  assert.deepEqual(dialFor(undefined, { person: "allow", floor: "auto" }), { person: "allow", floor: "auto" }, "no chat, the person's setting");
  assert.deepEqual(dialFor("auto", undefined), { person: "auto", floor: "ask" }, "a floor that could not be read stays Ask");
  const terminal = { local: "terminal" } as never;
  assert.equal(decideLocal(terminal, ...pair(dialFor("auto", person))).action, "run");
  assert.equal(decideLocal(terminal, ...pair(dialFor("auto", { person: "auto", floor: "ask" }))).action, "prompt", "the floor beats Auto");
});
