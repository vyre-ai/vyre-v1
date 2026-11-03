// The shell's directory: someone else's private agent keeps its name, with its person's, where it worked, and is never offered to mention, find or open.
import test from "node:test";
import assert from "node:assert/strict";
import { attributed, offered, principalOf } from "./private-agents.ts";
import { connectedNote, lastActive } from "../../console/pages/connected-model.ts";

const ME = "usr_rubab", IRFAD = "usr_irfad";
const own = { id: "agt_mine", name: "Rubab’s Assistant" };
const raw = [
  { id: IRFAD, name: "Irfad Imtiaz", kind: "person" },
  { id: ME, name: "Rubab Khan", kind: "person" },
  { id: "agt_simba", name: "Simba (Claude Code)", kind: "agent", owner: IRFAD },
  { id: "agt_irfadasst", name: "Irfad’s Assistant", kind: "agent", owner: IRFAD },
  { id: "agt_mine", name: "Assistant", kind: "agent", owner: ME },
  { id: "agt_docs", name: "Docs", kind: "agent", owner: IRFAD },
];

test("an agent agents.list did not answer is someone else's private one; mine and the Space's are not", () => {
  const usable = new Set(["agt_mine", "agt_docs"]);
  const list = raw.map((x) => principalOf(x, own, ME, usable));
  const priv = list.filter((p) => p.private === true).map((p) => p.id);
  assert.deepEqual(priv, ["agt_simba", "agt_irfadasst"]);
  assert.equal(list.find((p) => p.id === "agt_mine")?.name, "Rubab’s Assistant");
  // while agents.list loads nothing is marked
  assert.equal(raw.map((x) => principalOf(x, own, ME, null)).some((p) => p.private === true), false);
});

test("what is offered (mention picker, composer lists, Cmd-K, pickers) never holds a private agent", () => {
  const list = raw.map((x) => principalOf(x, own, ME, new Set(["agt_mine", "agt_docs"])));
  assert.deepEqual(list.filter((p) => p.id !== ME && offered(p)).map((p) => p.id), [IRFAD, "agt_mine", "agt_docs"]);
  assert.deepEqual(list.filter(offered).filter((p) => p.kind === "agent").map((p) => p.id), ["agt_mine", "agt_docs"]);
});

test("where it worked, a private agent is named with its person: Simba · Irfad’s agent", () => {
  const list = raw.map((x) => principalOf(x, own, ME, new Set(["agt_mine", "agt_docs"])));
  const byId = new Map(list.map((p) => [p.id, p] as const));
  const nameOf = (id: string): string | undefined => byId.get(id)?.name;
  assert.equal(attributed(byId.get("agt_simba"), nameOf), "Simba (Claude Code) · Irfad’s agent");
  assert.equal(attributed(byId.get("agt_docs"), nameOf), "Docs", "a Space agent is named as it is");
  assert.equal(attributed(byId.get("agt_mine"), nameOf), "Rubab’s Assistant");
  assert.equal(attributed(undefined, nameOf), undefined);
});

test("Console: who connected it, its setup grant and its last activity", () => {
  const now = 1_760_000_000_000;
  assert.equal(lastActive(undefined, now), "Not used yet");
  assert.equal(lastActive(now - 5 * 60_000, now), "Active 5 min ago");
  const row = { agentId: "agt_simba", clientName: "Claude Code", connectedAt: now - 86_400_000, lastSeenAt: now - 2 * 3_600_000, calls: 9, setup: true, person: IRFAD };
  assert.equal(connectedNote(row, "Irfad Imtiaz", now), "Connected by Irfad Imtiaz · Acts for them, including setup · Active 2 h ago");
});
