// The agent page's Computer tab reads the same data as the Chats right pane: it must know who is looking and how to name a person, or it calls your own terminals "Someone terminals".
import test from "node:test";
import assert from "node:assert/strict";
import { paneDataOf } from "./data.tsx";
import type { AgentPageData } from "./data.tsx";

test("the pane data of the agent page carries who is looking and the way to name a person", () => {
  const d = {
    screens: {},
    call: async () => null,
    connection: {},
    agent: { agentId: "agt_nova" },
    space: { name: "Co", personal: false },
    nav: {},
    clock: () => 0,
    me: { id: "usr_ada", name: "Ada" },
    nameOf: (id: string) => (id === "usr_bea" ? "Bea" : id),
  } as unknown as AgentPageData;
  const p = paneDataOf(d);
  assert.equal(p.me?.id, "usr_ada");
  assert.equal(p.nameOf?.("usr_bea"), "Bea");
});
