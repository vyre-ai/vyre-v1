// The channel menu's Connect an Outside Agent: the server asks for channels.agents, so a person without it is not given the door.
import test from "node:test";
import assert from "node:assert/strict";
import { createMountSample } from "./sample.ts";
import { createGo, wireConversation } from "./data.ts";

const doorFor = (permissions: ReadonlySet<string> | undefined) => {
  const s = createMountSample();
  const rt = { ...s.rt, ...(permissions ? { permissions } : {}) };
  const go = createGo(
    rt,
    () => undefined,
    (id) => id,
    () => undefined,
  );
  return wireConversation(rt, go, { threadId: "thr_c", list: [], nameOf: (id) => id, leadId: "agt_a" }).nav
    .openConnectOutsideAgent;
};

test("a person who holds channels.agents gets the door; one who does not, none", () => {
  assert.equal(typeof doorFor(new Set(["channels.agents"])), "function");
  assert.equal(doorFor(new Set(["chats.create"])), undefined, "absent, not disabled");
});

test("no permission list: the door stays", () => {
  assert.equal(typeof doorFor(undefined), "function");
});
