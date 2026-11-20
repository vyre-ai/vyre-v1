// An agent's principal carries the agent's current name: agent.renamed folds into it (the principal is made once, at agent.created), for every reader of access.principals.get.
import test from "node:test";
import assert from "node:assert/strict";
import { applyEvent } from "../consumers.ts";
import { AccessStore, principalView } from "../projections.ts";

const store = (): AccessStore => {
  const s = new AccessStore();
  applyEvent(
    s,
    { seq: 1, type: "principal.created", payload: { id: "usr_olivia", kind: "person", name: "Olivia Reyes" } },
    1,
  );
  applyEvent(
    s,
    {
      seq: 2,
      type: "principal.created",
      payload: { id: "agt_docs", kind: "agent", name: "Docs", owner: "usr_olivia" },
    },
    1,
  );
  return s;
};

test("an agent renamed after creation is named by its new name", () => {
  const s = store();
  assert.equal(
    applyEvent(s, { seq: 3, type: "agent.renamed", payload: { agentId: "agt_docs", name: "Front Desk" } }, 1),
    true,
  );
  assert.equal(principalView(s, s.principals.get("agt_docs")!, { id: "usr_noah", admin: false }).name, "Front Desk");
  assert.equal(
    applyEvent(s, { seq: 4, type: "agent.renamed", payload: { agentId: "agt_docs", name: "Front Desk" } }, 1),
    false,
    "a repeat changes nothing",
  );
});

test("a rename names only an agent that is known, and never renames a person", () => {
  const s = store();
  assert.equal(applyEvent(s, { seq: 3, type: "agent.renamed", payload: { agentId: "agt_gone", name: "X" } }, 1), false);
  assert.equal(
    applyEvent(s, { seq: 4, type: "agent.renamed", payload: { agentId: "usr_olivia", name: "X" } }, 1),
    false,
  );
  assert.equal(s.principals.get("usr_olivia")!.name, "Olivia Reyes");
});
