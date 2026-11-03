// The shell's directory (owner ruling 3 Nov): someone else's private agent is credited to its person, "Irfad Imtiaz (Agent)", with their face, and is never offered; its own name is kept for logs only.
import test from "node:test";
import assert from "node:assert/strict";
import { asAgentOf, directoryOf, offered, standInsOf } from "./private-agents.ts";
import { connectedNote, lastActive } from "../../console/pages/connected-model.ts";
import { agentDetails } from "../../console/pages/audit/model.ts";

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
const usable = new Set(["agt_mine", "agt_docs"]);

test("to everyone else, a private agent is its person, marked as their agent; its own name stays for logs", () => {
  const dir = new Map(directoryOf(raw, own, ME, usable).map((p) => [p.id, p] as const));
  assert.equal(dir.get("agt_simba")?.name, "Irfad Imtiaz (Agent)");
  assert.equal(dir.get("agt_irfadasst")?.name, "Irfad Imtiaz (Agent)", "the same for his assistant");
  assert.equal(dir.get("agt_simba")?.agentName, "Simba (Claude Code)");
  assert.equal(dir.get("agt_docs")?.name, "Docs", "a Space agent keeps its name");
  assert.equal(dir.get("agt_mine")?.name, "Rubab’s Assistant", "my own assistant is mine, by name");
  assert.equal(asAgentOf("Irfad Imtiaz"), "Irfad Imtiaz (Agent)");
});

test("its person sees it by name", () => {
  const dir = new Map(directoryOf(raw, { id: "agt_irfadasst", name: "Irfad’s Assistant" }, IRFAD, new Set(["agt_simba", "agt_irfadasst", "agt_docs"])).map((p) => [p.id, p] as const));
  assert.equal(dir.get("agt_simba")?.name, "Simba (Claude Code)");
  assert.equal(dir.get("agt_simba")?.private, undefined);
});

test("nothing is marked while agents.list loads", () => {
  assert.equal(directoryOf(raw, own, ME, null).some((p) => p.private === true), false);
});

test("what is offered (mention picker, composer lists, Cmd-K, pickers) never holds a private agent", () => {
  const list = directoryOf(raw, own, ME, usable);
  assert.deepEqual(list.filter((p) => p.id !== ME && offered(p)).map((p) => p.id), [IRFAD, "agt_mine", "agt_docs"]);
});

test("a private agent wears its person's face", () => {
  assert.deepEqual([...standInsOf(directoryOf(raw, own, ME, usable))], [["agt_simba", IRFAD], ["agt_irfadasst", IRFAD]]);
});

test("the audit details line: which agent, its id, the setup grant, the trace", () => {
  const row = { actor: { kind: "agent" as const, id: "agt_simba" }, after: { reason: "setup_grant" }, traceId: "0123456789abcdef0123456789abcdef" };
  assert.equal(agentDetails(row, "Simba (Claude Code)"), "Simba (Claude Code) · agt_simba · under the setup grant · trace 0123456789abcdef0123456789abcdef");
  assert.equal(agentDetails({ ...row, after: undefined }, undefined), "An agent · agt_simba · trace 0123456789abcdef0123456789abcdef");
  assert.equal(agentDetails({ ...row, actor: { kind: "person" as const, id: IRFAD } }, undefined), null);
});

test("Console: who connected it, its setup grant and its last activity", () => {
  const now = 1_760_000_000_000;
  assert.equal(lastActive(undefined, now), "Not used yet");
  assert.equal(lastActive(now - 5 * 60_000, now), "Active 5 min ago");
  const row = { agentId: "agt_simba", clientName: "Claude Code", connectedAt: now - 86_400_000, lastSeenAt: now - 2 * 3_600_000, calls: 9, setup: true, person: IRFAD };
  assert.equal(connectedNote(row, "Irfad Imtiaz", now), "Connected by Irfad Imtiaz · Acts for them, including setup · Active 2 h ago");
});
