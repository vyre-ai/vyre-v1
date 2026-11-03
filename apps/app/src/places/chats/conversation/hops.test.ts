// The Continue card (owner ruling, 3 Nov 2026): 8 agent turns since a person wrote, helpers and teammates counted, then the chat parks until a person replies or presses Continue.
import test from "node:test";
import assert from "node:assert/strict";
import { CONTINUE_TEXT, DEFAULT_AGENT_HOPS, limitOf, parkedAtLimit, parkedLine } from "./hops.ts";

const agent = (depth: number) => ({ author: { kind: "agent" }, depth });

test("the budget is 8 agent turns unless the Space's Policies say otherwise", () => {
  assert.equal(DEFAULT_AGENT_HOPS, 8);
  assert.equal(limitOf(undefined), 8);
  assert.equal(limitOf("x"), 8);
  assert.equal(limitOf(0), 8);
  assert.equal(limitOf(3), 3);
});

test("the chat parks when an agent's message reaches the limit and nothing is working", () => {
  assert.equal(parkedAtLimit(agent(8), 8, false), true);
  assert.equal(parkedAtLimit(agent(9), 8, false), true);
  assert.equal(parkedAtLimit(agent(7), 8, false), false, "under the limit the next agent still answers");
  assert.equal(parkedAtLimit(agent(8), 8, true), false, "a turn still running is not parked");
  assert.equal(parkedAtLimit({ author: { kind: "person" }, depth: 0 }, 8, false), false, "a person wrote last");
  assert.equal(parkedAtLimit(undefined, 8, false), false);
});

test("the card says what happened and how to go on; Continue writes as the person", () => {
  assert.equal(parkedLine(8), "The agents have taken 8 turns since a person wrote. Continue, or @mention one agent.");
  assert.equal(CONTINUE_TEXT, "Continue");
});
