// A person who is not in the chat is a reference, not an address (owner bug, 4 Nov 2026: "Dex" stayed silent on a long message that mentioned @Aliza and @Rubab, who were not in the chat).
import test from "node:test";
import assert from "node:assert/strict";
import { namedIn, route } from "../../lib/route.ts";

const dex = { id: "agt_dex", name: "Dex", mode: "lead" as const };
const person = (id: string) => ({ kind: "person" as const, id });
const me = { kind: "person" as const, id: "usr_irfad" };

test("the owner's shape: a 1:1 chat with one agent, two people mentioned who are not in it: the agent answers", () => {
  const r = route({ agents: [dex], kind: "chat", people: ["usr_irfad"] }, { author: me, mentions: [person("usr_aliza"), person("usr_rubab")], text: "Dex, tell @Aliza and @Rubab the plan" });
  assert.deepEqual([r.responders, r.reason], [["agt_dex"], "lead"]);
  // even a lone listening agent in a person's chat answers
  const solo = route({ agents: [{ ...dex, mode: "listen" }], kind: "chat", people: ["usr_irfad"] }, { author: me, mentions: [person("usr_aliza")], text: "ask @Aliza" });
  assert.deepEqual(solo.responders, ["agt_dex"]);
});

test("a person who is in the chat is spoken to: nobody answers, unless the message also names the lead", () => {
  const thread = { agents: [dex], kind: "channel", people: ["usr_irfad", "usr_aliza"] };
  assert.deepEqual(route(thread, { author: me, mentions: [person("usr_aliza")], text: "@Aliza can you look at this?" }).responders, []);
  assert.equal(route(thread, { author: me, mentions: [person("usr_aliza")], text: "@Aliza can you look at this?" }).reason, "person_addressed");
  assert.deepEqual(route(thread, { author: me, mentions: [person("usr_aliza")], text: "@Aliza and Dex, can you look at this?" }).responders, ["agt_dex"]);
  // a reply to someone else's message is for them
  assert.deepEqual(route(thread, { author: me, mentions: [], replyToPerson: "usr_aliza", text: "yes" }).responders, []);
  // a reply to a person who is not in the chat is not an address
  assert.deepEqual(route({ ...thread, people: ["usr_irfad"] }, { author: me, mentions: [], replyToPerson: "usr_aliza", text: "yes" }).responders, ["agt_dex"]);
});

test("an agent mention always wins, and when the people in the chat are not known every mentioned person is taken to be in it", () => {
  const thread = { agents: [dex, { id: "agt_docs", name: "Docs", mode: "listen" as const }], kind: "chat", people: ["usr_irfad"] };
  assert.deepEqual(route(thread, { author: me, mentions: [{ kind: "agent", id: "agt_docs" }, person("usr_aliza")], text: "@Docs and @Aliza" }).responders, ["agt_docs"]);
  assert.deepEqual(route({ agents: [dex], kind: "chat" }, { author: me, mentions: [person("usr_aliza")], text: "@Aliza" }).responders, []);
});

test("an agent's own reply that mentions a person outside the chat does not set itself off", () => {
  const r = route({ agents: [dex], kind: "chat", people: ["usr_irfad"] }, { author: { kind: "agent", id: "agt_dex" }, mentions: [person("usr_aliza")], depth: 1, text: "I told @Aliza" });
  assert.deepEqual(r.responders, [], "an agent never answers itself");
});

test("an agent is named in words by its whole name, any case", () => {
  assert.equal(namedIn("dex, look", "Dex"), true);
  assert.equal(namedIn("indexes", "Dex"), false);
});

test("in the engine: the owner's exact message runs the lead, and a person who is in the chat is still not answered for", async () => {
  const { createTurnEngine, scriptedProvider } = await import("../src/turn-engine/index.ts");
  const p = scriptedProvider({ script: [{ type: "done" }] });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "T", kind: "chat", starter: "usr_irfad", agents: [{ id: "agt_dex", name: "Dex", mode: "lead" }], people: ["usr_irfad"] });
  const got = engine.receive({ threadId: "T", author: me, mentions: [person("usr_aliza"), person("usr_rubab")], body: "Tell @Aliza and @Rubab the plan" });
  assert.deepEqual([got.responders, got.reason], [["agt_dex"], "lead"]);
  // the host read the chat again for this message and Aliza is in it now: the message is for her
  const to = engine.receive({ threadId: "T", author: me, mentions: [person("usr_aliza")], body: "@Aliza look", people: ["usr_irfad", "usr_aliza"] });
  assert.deepEqual(to.responders, []);
  await engine.idle("T");
});
