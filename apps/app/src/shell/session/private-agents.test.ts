// The shell's directory (owner ruling 3 Nov): someone else's private agent is credited to its person, "Irfad Imtiaz (Agent)", with their face, and is never offered; its own name is kept for logs only.
import test from "node:test";
import assert from "node:assert/strict";
import { asAgentOf, creditLine, directoryOf, offered, standInsOf } from "./private-agents.ts";
import { connectedNote, lastActive } from "../../console/pages/connected-model.ts";
import { agentDetails } from "../../console/pages/audit/model.ts";

const ME = "usr_rubab", IRFAD = "usr_irfad";
const own = { id: "agt_mine", name: "Rubab’s Assistant" };
// what access.principals.list answers Rubab: Irfad's private agents already named as him, no own name (she is not an admin)
const raw = [
  { id: IRFAD, name: "Irfad Imtiaz", kind: "person" },
  { id: ME, name: "Rubab Khan", kind: "person" },
  { id: "agt_simba", name: "Irfad Imtiaz (Agent)", kind: "agent", owner: IRFAD, private: true },
  { id: "agt_irfadasst", name: "Irfad Imtiaz (Agent)", kind: "agent", owner: IRFAD, private: true },
  { id: "agt_mine", name: "Assistant", kind: "agent", owner: ME },
  { id: "agt_docs", name: "Docs", kind: "agent", owner: IRFAD },
  { id: "agt_kept", name: "Payroll", kind: "agent", owner: IRFAD },
];
const usable = new Set(["agt_mine", "agt_docs"]);

test("to everyone else, a private agent is its person, marked as their agent", () => {
  const dir = new Map(directoryOf(raw, own, ME, usable).map((p) => [p.id, p] as const));
  assert.equal(dir.get("agt_simba")?.name, "Irfad Imtiaz (Agent)");
  assert.equal(dir.get("agt_irfadasst")?.name, "Irfad Imtiaz (Agent)", "the same for his assistant");
  assert.equal(dir.get("agt_simba")?.agentName, undefined, "no own name for a member");
  assert.equal(dir.get("agt_docs")?.name, "Docs", "a Space agent keeps its name");
  assert.equal(dir.get("agt_mine")?.name, "Rubab’s Assistant", "my own assistant is mine, by name");
  assert.equal(asAgentOf("Irfad Imtiaz"), "Irfad Imtiaz (Agent)");
});

test("an older server that sends the private flag with the agent's own name: the shell still names it as its person", () => {
  const old = raw.map((x) => (x.id === "agt_simba" ? { ...x, name: "Simba (Claude Code)" } : x));
  assert.equal(directoryOf(old, own, ME, usable).find((p) => p.id === "agt_simba")?.name, "Irfad Imtiaz (Agent)");
});

test("an owner or admin gets the agent's own name for the audit details line, and the same headline", () => {
  const admin = raw.map((x) => (x.id === "agt_simba" ? { ...x, agentName: "Simba (Claude Code)" } : x));
  const p = directoryOf(admin, own, ME, usable).find((x) => x.id === "agt_simba")!;
  assert.deepEqual([p.name, p.agentName], ["Irfad Imtiaz (Agent)", "Simba (Claude Code)"]);
});

test("its person sees it by name", () => {
  const his = raw.map((x) => (x.owner === IRFAD ? { id: x.id, name: x.id === "agt_simba" ? "Simba (Claude Code)" : x.name, kind: x.kind, owner: x.owner } : x));
  const dir = new Map(directoryOf(his, { id: "agt_irfadasst", name: "Irfad’s Assistant" }, IRFAD, new Set(["agt_simba", "agt_irfadasst", "agt_docs", "agt_kept"])).map((p) => [p.id, p] as const));
  assert.equal(dir.get("agt_simba")?.name, "Simba (Claude Code)");
  assert.equal(dir.get("agt_simba")?.private, undefined);
});

test("what is offered (mention picker, composer lists, Cmd-K, pickers) never holds a private agent, nor a Space agent kept from me", () => {
  const list = directoryOf(raw, own, ME, usable);
  assert.deepEqual(list.filter((p) => p.id !== ME && offered(p)).map((p) => p.id), [IRFAD, "agt_mine", "agt_docs"]);
  assert.equal(list.find((p) => p.id === "agt_kept")?.name, "Payroll", "named as it is");
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

test("someone else's Assistant reads by one name everywhere, \"Irfad’s Assistant\" (lead, 12 Nov): the directory, an older server's answer and every credit line", () => {
  const rows = [{ id: IRFAD, name: "Irfad Imtiaz", kind: "person" }, { id: "agt_ia", name: "Irfad’s Assistant", kind: "agent", owner: IRFAD, private: true, assistant: true }, { id: "agt_cc2", name: "Irfad Imtiaz (Agent)", kind: "agent", owner: IRFAD, private: true }];
  const dir = new Map(directoryOf(rows, { id: "agt_mine", name: "Assistant" }, "usr_noah", null).map((p) => [p.id, p]));
  assert.equal(dir.get("agt_ia")?.name, "Irfad’s Assistant");
  assert.equal(dir.get("agt_ia")?.assistant, true);
  assert.equal(dir.get("agt_cc2")?.name, "Irfad Imtiaz (Agent)", "an outside agent keeps its person's credit");
  const older = directoryOf([{ id: IRFAD, name: "Irfad Imtiaz", kind: "person" }, { id: "agt_ia", name: "Helper", kind: "agent", owner: IRFAD, private: true, assistant: true }], { id: "agt_mine", name: "Assistant" }, "usr_noah", null);
  assert.equal(older.find((p) => p.id === "agt_ia")?.name, "Irfad’s Assistant", "its own name never shows");
  const nameOf = (id: string): string => dir.get(id)?.name ?? "Someone";
  assert.equal(creditLine({ kind: "agent", id: "agt_ia" }, { me: "usr_noah", nameOf, ownerOf: (id) => dir.get(id)?.owner }), "Irfad’s Assistant");
  assert.equal(creditLine({ kind: "agent", id: "agt_gone" }, { me: "usr_noah", nameOf, ownerOf: () => undefined, for: IRFAD }), "Irfad Imtiaz (Agent)", "an agent nobody knows is credited to its person");
});

test("a person who is not active is named but marked, so nobody is offered them (the people picker's rule)", () => {
  const dir = directoryOf([{ id: "usr_s", name: "Sam Hill", kind: "person", status: "suspended" }, { id: "usr_a", name: "Ana Bell", kind: "person", status: "active" }], { id: "agt_mine", name: "Assistant" }, "usr_noah", null);
  assert.deepEqual(dir.map((p) => [p.name, p.inactive === true]), [["Sam Hill", true], ["Ana Bell", false]]);
});
