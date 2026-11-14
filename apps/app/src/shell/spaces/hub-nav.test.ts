import test from "node:test";
import assert from "node:assert/strict";
import { createShellHub } from "./hub.ts";
import { SEED_DEFS } from "./model.ts";

const hub = () =>
  createShellHub({
    spaces: SEED_DEFS,
    openId: SEED_DEFS[0]!.spaceId,
    personId: "irfad",
    deviceId: "web",
    storage: null,
    skeletonMs: 0,
  });
const AGENT = "screen=chats.agent-page&agentId=agt_1";

test("the hub's Back and Forward move the page, say where they go, and report when there is nowhere", () => {
  const h = hub();
  assert.equal(h.back(), false);
  h.go("chats", "subject=thread:thr_1");
  h.move("chats", AGENT);
  assert.equal(h.state().hash, AGENT);
  assert.equal(h.state().nav?.back !== null, true);
  assert.equal(h.back(), true);
  assert.equal(h.state().hash, "subject=thread:thr_1");
  assert.equal(h.state().nav?.forward !== null, true);
  assert.equal(h.forward(), true);
  assert.equal(h.state().hash, AGENT);
  assert.equal(h.forward(), false);
});

test("a cold link's Back goes up to the place", () => {
  const h = hub();
  h.go("chats", AGENT, false, true);
  assert.equal(h.state().nav?.back !== null, true);
  assert.equal(h.back(), true);
  assert.equal(h.state().hash, "");
  assert.equal(h.back(), false, "the landing is the top");
});

test("a press inside the place on screen is a step in this tab, not a new tab; a link and a press with Cmd are tabs", () => {
  const h = hub();
  h.go("chats", "subject=thread:thr_1", false, true);
  const tabs = () => h.session().tabs.state().tabs.length;
  const n = tabs();
  h.go("chats", AGENT);
  assert.equal(tabs(), n, "the agent's page opened in the same tab");
  assert.equal(h.state().hash, AGENT);
  assert.equal(h.back(), true);
  assert.equal(h.state().hash, "subject=thread:thr_1");
  h.go("chats", AGENT, true);
  assert.equal(tabs(), n + 1, "Cmd-press opens a tab behind");
});
