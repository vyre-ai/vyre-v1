// The seed fixtures hold the prototype's data for Northwind, Harbor Studio and Personal, and every id in them resolves to a name.
import test from "node:test";
import assert from "node:assert/strict";
import { SPACE_KEYS, fixtureFor, meName, nameOf, namesFor, peopleFor } from "./index.ts";

test("Northwind has the prototype's people, agents, channels, Needs you items and chats", () => {
  const f = fixtureFor("northwind");
  assert.deepEqual(f.people.map((p) => p.name), ["Irfad Imtiaz", "Maya Chen", "Omar Haddad", "Lena Ortiz", "Sam Patel"]);
  assert.deepEqual(f.agents.map((a) => a.name), ["Intake", "Billing", "Research", "Docs", "Scout", "Assistant"]);
  assert.deepEqual(f.channels.map((c) => c.name), ["intake", "billing", "pruitt-matter", "atp-q4", "rivera-matter"]);
  assert.equal(f.needs.length, 8);
  assert.equal(f.chats.length, 9);
  assert.equal(f.space.address, "northwind.vyre.run");
  assert.equal(meName("northwind"), "Irfad Imtiaz");
});

test("Harbor Studio has Scheduler, Proofer, the studio and galleries channels and the Moreno chats", () => {
  const f = fixtureFor("harbor");
  assert.deepEqual(f.agents.map((a) => a.name), ["Scheduler", "Proofer", "Assistant"]);
  assert.deepEqual(f.people.map((p) => p.name).sort(), ["Ines Costa", "June Okafor", "Theo Lindqvist"]);
  assert.deepEqual(f.channels.map((c) => c.name), ["studio", "galleries"]);
  assert.deepEqual(f.chats.map((c) => c.title), ["Moreno shoot Saturday", "Moreno gallery", "Theo Lindqvist", "Studio gear list"]);
  assert.deepEqual(f.needs.map((n) => n.title), ["Send the Moreno gallery", "Saturday call sheet"]);
  assert.equal(meName("harbor"), "June Okafor");
});

test("Personal has one person, the assistant and three chats, with no channels or Needs you", () => {
  const f = fixtureFor("personal");
  assert.equal(f.people.length, 1);
  assert.deepEqual(f.agents.map((a) => a.name), ["Assistant"]);
  assert.equal(f.chats.length, 3);
  assert.equal(f.channels.length, 0);
  assert.equal(f.needs.length, 0);
});

test("every id a fixture mentions resolves to a name, and no name is itself an id", () => {
  for (const key of SPACE_KEYS) {
    const f = fixtureFor(key);
    const names = namesFor(key);
    const ids = [f.me, ...f.channels.flatMap((c) => [...c.members, ...c.agents, ...(c.lead ? [c.lead] : [])]), ...f.needs.map((n) => n.agent), ...f.chats.map((c) => c.with)];
    for (const id of ids) assert.ok(names[id] !== undefined, `${key}: ${id} has a name`);
    for (const [id, n] of Object.entries(names)) assert.doesNotMatch(n, /^(usr|agt|aut|ch|key|svc)_/, `${key}: ${id} shows ${n}`);
  }
});

test("a chat with an agent or a person is titled by what it is about or by that person's name", () => {
  const f = fixtureFor("northwind");
  const dm = f.chats.find((c) => c.id === "d1");
  assert.equal(dm?.title, nameOf("northwind", "usr_maya"));
  assert.equal(f.chats.filter((c) => c.with.startsWith("usr_")).length, 2);
});

test("an id the Space does not know shows a plain word, never the id", () => {
  assert.equal(nameOf("harbor", "usr_maya"), "Someone");
  assert.equal(nameOf("harbor", "agt_intake"), "An agent");
  assert.equal(nameOf("harbor", "zzz_1"), "Unknown");
});

test("the extras a place adds win and join the Space's own names", () => {
  const names = namesFor("northwind", { aut_lead: "New lead follow-up", usr_irfad: "You" });
  assert.equal(names.aut_lead, "New lead follow-up");
  assert.equal(names.usr_irfad, "You");
  assert.equal(names.usr_maya, "Maya Chen");
});

test("peopleFor picks named ids and refuses one the Space does not have", () => {
  assert.deepEqual(peopleFor("harbor", ["usr_ines", "usr_theo"]), { usr_ines: "Ines Costa", usr_theo: "Theo Lindqvist" });
  assert.throws(() => peopleFor("harbor", ["usr_maya"]), /not in the harbor Space/);
});
