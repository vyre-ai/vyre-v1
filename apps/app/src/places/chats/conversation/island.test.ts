// The Island's reading: ring per agent from real turn and activity state, the state word, the hover, the phone cap and when the pill shows.
import test from "node:test";
import assert from "node:assert/strict";
import { agentOf, capFaces, hoverOf, islandOpen, wordOf } from "./island.ts";
import type { ActivitySnapshot } from "../../../shell/session/turn-streams.ts";

const turn = (state: "writing" | "ended" = "writing") => ({ agentId: "agt_mira", state, startedAt: 1_000 });
const act = (steps: ActivitySnapshot["steps"], done = false): ActivitySnapshot => ({ startedAt: 1_000, thinking: "", steps, version: 1, done });

test("a turn with nothing yet is Thinking; with words and no step it is Writing, highlighted", () => {
  const thinking = agentOf(turn(), act([]), false, "Mira", 41_000);
  assert.deepEqual([thinking.ring, thinking.word, thinking.writing, thinking.seconds], ["working", "Thinking", false, 40]);
  const writing = agentOf(turn(), act([]), true, "Mira", 41_000);
  assert.deepEqual([writing.word, writing.writing], ["Writing", true]);
});

test("a live step names the word; a question or a sleeping computer is an amber ring; an ended turn is a green dot", () => {
  const reading = agentOf(turn(), act([{ id: "1", name: "Read", state: "live", detail: "model.ts" }]), true, "Mira", 5_000);
  assert.deepEqual([reading.word, reading.line, reading.writing, reading.ring], ["Reading", "Reading model.ts", false, "working"]);
  assert.equal(agentOf(turn(), act([{ id: "1", name: "WebSearch", state: "live" }]), false, "Mira", 5_000).word, "Searching the web");
  assert.equal(agentOf(turn(), act([{ id: "1", name: "AskUserQuestion", state: "live" }]), false, "Mira", 5_000).ring, "waiting");
  assert.equal(agentOf(turn(), act([{ id: "1", name: "device_wait", state: "live" }]), false, "Mira", 5_000).ring, "waiting");
  assert.equal(agentOf(turn("ended"), act([], true), true, "Mira", 5_000).ring, "done");
});

test("the computer shows only while a computer or browser step is live", () => {
  assert.equal(agentOf(turn(), act([{ id: "1", name: "mcp__vyre-chrome__chrome_click", state: "live" }]), false, "Ember", 5_000).computer, true);
  assert.equal(agentOf(turn(), act([{ id: "1", name: "mcp__vyre-chrome__chrome_click", state: "done" }]), false, "Ember", 5_000).computer, false);
  assert.equal(agentOf(turn(), act([{ id: "1", name: "Read", state: "live" }]), false, "Ember", 5_000).computer, false);
});

test("the word beside the mark, the hover, the phone cap and when the island shows", () => {
  const a = agentOf(turn(), act([]), true, "Mira", 41_000);
  const b = agentOf({ ...turn(), agentId: "agt_ember" }, act([{ id: "1", name: "Read", state: "live" }]), false, "Ember", 11_000);
  assert.equal(wordOf([b, a]), "Writing", "the one writing leads the word");
  assert.equal(wordOf([b]), "Reading");
  assert.equal(hoverOf(a), "Mira · Writing · 40s");
  assert.deepEqual(capFaces([1, 2, 3, 4, 5], 3), { shown: [1, 2, 3], more: 2 });
  assert.equal(islandOpen([], 0), false);
  assert.equal(islandOpen([a], 0), true);
  assert.equal(islandOpen([agentOf(turn("ended"), act([], true), true, "Mira", 5_000)], 0), false, "a finished face alone does not keep it open");
  assert.equal(islandOpen([], 1), true, "a background job keeps it open");
});
