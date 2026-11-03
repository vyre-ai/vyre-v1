// The @ menu's data (owner rule, 3 Nov 2026): the viewer's own Assistant as "Assistant"; every other agent of the Space and the chat's teammates, each as itself; never another person's Assistant or anyone's
// outside agent ("<person> (Agent)"); people as usual; nothing that is not a mention. Picking Assistant names the viewer's own. A guest sees only the agents the chat allows.
import test from "node:test";
import assert from "node:assert/strict";
import { candidates, composerLists } from "./chats-data.ts";
import { mentionable } from "../../places/chats/conversation/model.ts";
import { popupFor } from "../../../../../ui/src/Composer/index.tsx";
import type { Principal } from "../../places/home/sections-a/data.tsx";

const ME = "usr_irfad", ASSISTANT = { id: "agt_irfad_assistant", name: "Assistant" };
const principals: Principal[] = [
  { id: ME, name: "Irfad Imtiaz", kind: "person" }, { id: "usr_maya", name: "Maya Lin", kind: "person" }, { id: "usr_gus", name: "Gus Guest", kind: "person", guest: true },
  // his own Assistant, as the shell directory has it: private, named for him
  { id: ASSISTANT.id, name: "Assistant", kind: "agent", owner: ME, private: true },
  // Space agents and the chat's teammates
  { id: "agt_scout", name: "Scout", kind: "agent" }, { id: "agt_proofer", name: "Proofer", kind: "agent" },
  // someone else's Assistant, and an outside agent (Claude Code) credited to its person: neither is offered
  { id: "agt_maya_assistant", name: "Maya Lin (Agent)", kind: "agent", owner: "usr_maya", private: true },
  { id: "agt_irfad_cc", name: "Irfad Imtiaz (Agent)", kind: "agent", owner: ME },
  // an agent kept from this person
  { id: "agt_secret", name: "Hidden one", kind: "agent", hidden: true },
];
const names = (l: readonly (string | { t: string })[] | undefined): string[] => (l ?? []).map((x) => (typeof x === "string" ? x : x.t));

test("owner or member: Assistant first, then the Space's agents by their own names, then people; nobody's outside agent, no other Assistant, no hidden agent", () => {
  const lists = composerLists(principals, ME, ASSISTANT);
  assert.deepEqual(names(lists.agents), ["Assistant", "Scout", "Proofer"]);
  assert.deepEqual(names(lists.people), ["Maya Lin", "Gus Guest"]);
  // each agent carries its id, so the menu draws its own face and not a letter for its name
  assert.deepEqual((lists.agents ?? []).map((x) => (typeof x === "string" ? "" : x.ref)), [ASSISTANT.id, "agt_scout", "agt_proofer"]);
  assert.equal(JSON.stringify(lists).includes("(Agent)"), false);
});

test("the menu shows only mentions: a Report a problem row is dropped, and the groups are Agents then People", () => {
  const lists = composerLists(principals, ME, ASSISTANT);
  const withStray = { ...lists, agents: [...(lists.agents ?? []), "Report a problem"] };
  const entries = popupFor({ ch: "@", query: "", start: 0, end: 1 } as never, withStray);
  const heads = entries.filter((e) => "head" in e).map((e) => (e as { head: string }).head);
  assert.deepEqual(heads, ["Agents", "People"]);
  assert.equal(JSON.stringify(entries).includes("Report a problem"), false);
});

test("picking Assistant names the viewer's own Assistant: the name resolves to that id, and only that one", () => {
  const dir = candidates(principals, ME, ASSISTANT);
  assert.deepEqual(dir.filter((c) => c.name === "Assistant").map((c) => c.id), [ASSISTANT.id]);
  assert.deepEqual(dir.filter((c) => c.kind === "agent").map((c) => c.name), ["Assistant", "Scout", "Proofer"]);
  // someone else seeing the same Space gets their own Assistant under the same word
  const maya = candidates(principals, "usr_maya", { id: "agt_maya_assistant", name: "Assistant" });
  assert.deepEqual(maya.filter((c) => c.name === "Assistant").map((c) => c.id), ["agt_maya_assistant"]);
});

test("a guest is offered only the agents the chat allows", () => {
  const inThread = new Map([["agt_scout", "lead"]]);
  const all = composerLists(principals, "usr_gus", { id: "agt_gus_assistant", name: "Assistant" }).agents ?? [];
  assert.deepEqual(all.filter((x) => mentionable(x as { t: string; ref?: string }, true, inThread)).map((x) => (typeof x === "string" ? x : x.t)), ["Scout"]);
  assert.deepEqual(all.filter((x) => mentionable(x as { t: string; ref?: string }, false, inThread)).length, all.length, "an owner or member is offered them all");
});

test("the menu lists the viewer's own Assistant first, as Yours, even when it is not in the chat", async () => {
  const { popupFor } = await import("../../../../../ui/src/Composer/index.tsx");
  const lists = composerLists(principals, ME, ASSISTANT);
  const noted = { ...lists, agents: (lists.agents ?? []).map((x) => (typeof x === "string" || x.ref !== ASSISTANT.id ? x : { ...x, group: "Agents in this chat", s: "Yours" })) };
  const first = popupFor({ ch: "@", query: "", start: 0, end: 1 } as never, noted).filter((e) => "group" in e)[0] as { label: string; note?: string; group: string };
  assert.deepEqual([first.label, first.note, first.group], ["Assistant", "Yours", "Agents in this chat"]);
});
