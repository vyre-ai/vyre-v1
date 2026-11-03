// Owner ruling (3 Nov): someone else's private agent (their assistant, an outside agent they connected) is answered as its person, "Olivia Reyes (Agent)", with their face (owner),
// never by its own name; owners and admins get its own name as agentName (the audit details line); its person and the server's own reads see it as it is.
import test from "node:test";
import assert from "node:assert/strict";
import { applyEvent } from "../consumers.ts";
import { AccessStore, isPrivateAgent, principalView } from "../projections.ts";

function space(): AccessStore {
  const store = new AccessStore();
  applyEvent(store, { seq: 1, type: "principal.created", payload: { id: "usr_olivia", kind: "person", name: "Olivia Reyes", status: "active" } }, 1);
  applyEvent(store, { seq: 2, type: "principal.created", payload: { id: "usr_noah", kind: "person", name: "Noah Park", status: "active" } }, 1);
  applyEvent(store, { seq: 3, type: "principal.created", payload: { id: "agt_simba", kind: "agent", name: "Simba (Claude Code)", owner: "usr_olivia", status: "active" } }, 1);
  applyEvent(store, { seq: 4, type: "principal.created", payload: { id: "agt_docs", kind: "agent", name: "Docs", owner: "usr_olivia", status: "active" } }, 1);
  applyEvent(store, { seq: 5, type: "agent.privacy_set", payload: { agentId: "agt_simba", ownerId: "usr_olivia", private: true } }, 1);
  return store;
}

test("agent.privacy_set marks the agent private, survives as a durable row, and can be taken back", () => {
  const store = space();
  assert.equal(isPrivateAgent(store, "agt_simba"), true);
  assert.equal(isPrivateAgent(store, "agt_docs"), false);
  assert.equal(applyEvent(store, { seq: 6, type: "agent.privacy_set", payload: { agentId: "agt_simba", ownerId: "usr_olivia", private: true } }, 1), false, "a repeat changes nothing");
  // the snapshot never takes it for a field label
  assert.doesNotThrow(() => store.snapshot());
  applyEvent(store, { seq: 7, type: "agent.privacy_set", payload: { agentId: "agt_simba", ownerId: "usr_olivia", private: false } }, 1);
  assert.equal(isPrivateAgent(store, "agt_simba"), false);
});

test("a member sees it as its person, marked as their agent, with no own name", () => {
  const store = space();
  const v = principalView(store, store.principals.get("agt_simba")!, { id: "usr_noah", admin: false });
  assert.deepEqual([v.name, v.private, v.owner, v.agentName], ["Olivia Reyes (Agent)", true, "usr_olivia", undefined]);
  assert.equal(principalView(store, store.principals.get("agt_docs")!, { id: "usr_noah", admin: false }).name, "Docs", "a Space agent keeps its name");
});

test("an admin gets the same headline and the own name for the audit details", () => {
  const store = space();
  const v = principalView(store, store.principals.get("agt_simba")!, { id: "usr_noah", admin: true });
  assert.deepEqual([v.name, v.agentName], ["Olivia Reyes (Agent)", "Simba (Claude Code)"]);
});

test("its person, and the server's own reads, see it as it is", () => {
  const store = space();
  assert.equal(principalView(store, store.principals.get("agt_simba")!, { id: "usr_olivia", admin: true }).name, "Simba (Claude Code)");
  assert.equal(principalView(store, store.principals.get("agt_simba")!).name, "Simba (Claude Code)");
});
