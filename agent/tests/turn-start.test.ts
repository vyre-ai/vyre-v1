// The start of each agent's current turn, noted by the engine and read by the tool layer (agent/src/tools/turn-start.ts). Two agents in one chat each have their own.
import test from "node:test";
import assert from "node:assert/strict";
import { noteTurnStart, turnStartOf } from "../src/tools/turn-start.ts";

test("two agents in ONE chat keep their own turn starts; a newer turn of one replaces only its own", () => {
  noteTurnStart("thr_ts1", "agt_a", 1);
  noteTurnStart("thr_ts1", "agt_b", 2);
  assert.equal(turnStartOf("thr_ts1", "agt_a"), 1);
  assert.equal(turnStartOf("thr_ts1", "agt_b"), 2);
  noteTurnStart("thr_ts1", "agt_a", 7);
  assert.equal(turnStartOf("thr_ts1", "agt_a"), 7);
  assert.equal(turnStartOf("thr_ts1", "agt_b"), 2);
});

test("the same agent in two chats, and a turn that was never noted", () => {
  noteTurnStart("thr_ts2", "agt_a", 10);
  noteTurnStart("thr_ts3", "agt_a", 20);
  assert.equal(turnStartOf("thr_ts2", "agt_a"), 10);
  assert.equal(turnStartOf("thr_ts3", "agt_a"), 20);
  assert.equal(turnStartOf("thr_ts4", "agt_a"), undefined);
});
