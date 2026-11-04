// One name for a chat (lib/chat-name.ts): a direct message goes by the person; any other chat by its title, else by who is in it; small talk never makes a title.
import test from "node:test";
import assert from "node:assert/strict";
import { chatName, firstRequest, hasRealTitle, isSmallTalk, isThin, joinNames, tidyTitle, titleFromRequest } from "../../../lib/chat-name.ts";

const names: Record<string, string> = { usr_aliza: "Aliza", usr_omar: "Omar Haddad", agt_dex: "Dex", agt_mira: "Mira", usr_x: "Xan", usr_y: "Yves" };
const nameOf = (id: string): string => names[id] ?? id;

test("rule 2: a direct message is named after the person, whatever its stored title says", () => {
  assert.equal(chatName({ kind: "chat", agents: [], people: ["usr_aliza"] }, nameOf), "Aliza");
  assert.equal(chatName({ kind: "chat", title: "Heyy", agents: [], people: ["usr_aliza"] }, nameOf), "Aliza");
});

test("rule 3: any other chat is named by its title; until it has one, by the others in it", () => {
  assert.equal(chatName({ kind: "chat", title: "GHL onboarding goal", agents: ["agt_dex"], people: [] }, nameOf), "GHL onboarding goal");
  for (const placeholder of ["", "New chat", "Chat", undefined]) assert.equal(chatName({ kind: "chat", title: placeholder, agents: ["agt_dex"], people: [] }, nameOf), "Dex");
  assert.equal(chatName({ kind: "chat", agents: ["agt_dex"], people: ["usr_aliza"] }, nameOf), "Dex and Aliza");
  assert.equal(chatName({ kind: "chat", agents: ["agt_dex", "agt_mira"], people: ["usr_aliza"] }, nameOf), "Dex, Mira and Aliza");
  assert.equal(chatName({ kind: "chat", agents: ["agt_dex", "agt_mira"], people: ["usr_aliza", "usr_x", "usr_y"] }, nameOf), "Dex, Mira, Aliza and 2 more");
  assert.equal(chatName({ kind: "chat", agents: [], people: [] }, nameOf), "Chat");
  assert.equal(chatName({ kind: "channel", title: "launch", agents: [], people: ["usr_aliza"] }, nameOf), "launch", "a channel with one other person is not a direct message");
  assert.equal(hasRealTitle("New chat"), false);
  assert.equal(hasRealTitle("Rivera intake"), true);
  assert.equal(joinNames(["A", "B"]), "A and B");
});

test("rule 4: a greeting, a test or an acknowledgement is small talk and makes no title; a request does", () => {
  for (const t of ["Heyy", "hi", "Hello there", "test", "testing 123", "hey Dex", "are you there?", "ok", "thanks!", "@Dex hi", ":)"]) assert.equal(isSmallTalk(t), true, t);
  for (const t of ["Set up the GHL onboarding goal for the Lab 8 registrants", "Draft the October note for Sara", "what changed on the lease?"]) assert.equal(isSmallTalk(t), false, t);
  assert.equal(firstRequest([{ person: true, body: "Heyy" }, { person: false, body: "Hello! How can I help?" }, { person: true, body: "Set up the GHL onboarding goal" }]), "Set up the GHL onboarding goal");
  assert.equal(firstRequest([{ person: true, body: "hi" }]), null);
  assert.equal(isThin("test chat"), true);
  assert.equal(isThin("Set up the GHL onboarding goal"), false);
});

test("a title is 2 to 5 plain words, from the request or from a model's answer", () => {
  assert.equal(titleFromRequest("Can you set up the GHL onboarding goal for the Lab 8 registrants?"), "Set up the GHL onboarding");
  assert.equal(titleFromRequest("Draft the October note for Sara"), "Draft the October note for");
  assert.equal(titleFromRequest("hmm"), null);
  assert.equal(tidyTitle('"GHL onboarding goal."'), "GHL onboarding goal");
  assert.equal(tidyTitle("Title: lab 8 reminder emails for the whole list of people"), "Lab 8 reminder emails for");
  assert.equal(tidyTitle("Hi"), null);
});
