// Agents never name internal tools or ids to people (owner, 4 Nov 2026): the rule is in every agent's context, the helper and crew guidance says to answer once in the agent's own words, and a helper's reply that
// names a tool or an id is caught.
import test from "node:test";
import assert from "node:assert/strict";
import { internalNames } from "../../../lib/plain-words.ts";
import { createContextBuilder } from "../context.ts";

test("replies that name a tool or an id are caught, plain replies are not", () => {
  assert.deepEqual(internalNames("task_submit wasn't in my direct tool list, so I called it through use_tool."), ["task_submit", "use_tool"]);
  assert.deepEqual(internalNames("Done. The task is submitted."), ["The task is submitted"]);
  assert.deepEqual(internalNames("Mars has two moons, Phobos and Deimos."), []);
  assert.deepEqual(internalNames("I asked usr_2191954f8e634c40c6 and thr_01a1a3a5 about it"), ["usr_2191954f8e634c40c6", "thr_01a1a3a5"]);
  assert.deepEqual(internalNames("The pricing page lists three plans. I handed in the result and asked Aliza about the last one."), []);
  assert.deepEqual(internalNames("Use the user_name field and the next_step column."), [], "ordinary words with underscores are fine");
});

const answers = {
  "agents.get": { agent: { agentId: "agt_a", name: "Assistant", role: "You help.", folderId: "fld_1", toolsAllowed: [], toolsDenied: [], vaultKeys: [], hasComputer: false, limits: {} } },
  "files.list": { files: [] }, "files.read": { text: "" },
  "threads.get": { thread: { kind: "chat", title: "Crew test", members: [{ kind: "person", id: "usr_m" }], agents: [{ agentId: "agt_a", mode: "lead" }] } },
  "access.principals.list": { principals: [{ id: "usr_m", kind: "person", name: "Maya" }] },
  "spaces.get": { space: { name: "Northwind", kind: "team" } }, "agents.routines.list": { routines: [] }, "settings.get": { row: { value: "UTC" } }, "computers.list": { computers: [] },
} as Record<string, unknown>;
const skills = { async index() { return []; }, async load() { return null; } };

test("every agent's context carries the rule, and the helper guidance says one short answer in the agent's own words, never a pasted reply", async () => {
  const call = async (cap: string): Promise<unknown> => { if (!(cap in answers)) throw new Error(`no such capability ${cap}`); return answers[cap]; };
  const ctx = await createContextBuilder({ call, skills: skills as never, now: () => Date.UTC(2026, 10, 4) }).build({ threadId: "thr_1", turnId: "trn_1", agent: { id: "agt_a", mode: "lead" }, trigger: { id: "m1", threadId: "thr_1", threadSeq: 1, author: { kind: "person", id: "usr_m" }, mentions: [], depth: 0, body: "hi" } as never, history: [], listeners: [], asker: "usr_m" });
  const text = (id: string): string => ctx.sections.find((s) => s.id === id)?.text ?? "";
  assert.match(text("rules"), /Never name a tool, a capability or an id to the person/);
  assert.match(text("where"), /one short answer in your own words that brings what they found together/);
  assert.match(text("where"), /Never paste a helper's reply/);
});

import { stepWords, oneLine } from "../../../lib/plain-words.ts";
test("the step a helper is on is said in plain words, never a tool name", () => {
  assert.equal(stepWords("Read", "pricing.md"), "Reading pricing.md");
  assert.equal(stepWords("WebSearch"), "Searching the web");
  assert.equal(stepWords("Bash"), "Running a command");
  assert.equal(stepWords("task_submit"), "Working");
  for (const t of ["Read", "Edit", "Bash", "WebFetch", "Agent", "task_submit", "mcp__vyre__files_tree"]) assert.deepEqual(internalNames(stepWords(t, "a.md")), [], t);
  assert.equal(oneLine("One fact. Two facts."), "One fact.");
});

test("a step line never carries the machinery: no browser, shell or tool id reaches a person", async () => {
  const { plainStep } = await import("../../../lib/plain-words.ts");
  assert.deepEqual(plainStep({ title: "Opened harlowprice.example/pricing", sub: "headless Chrome" }), { title: "Opened harlowprice.example/pricing", sub: "" });
  assert.deepEqual(plainStep({ title: "Searching parcel 104-22-009", sub: "Playwright via CDP" }), { title: "Searching parcel 104-22-009", sub: "" });
  assert.deepEqual(plainStep({ title: "Read the calendar", sub: "Next week" }), { title: "Read the calendar", sub: "Next week" });
  for (const raw of [{ title: "task_submit", sub: "" }, { title: "Bash", sub: "stdout" }, { title: "mcp__vyre__files_tree", sub: "tool_search" }, { title: "Opened a page", sub: "terminal_run" }]) {
    const out = plainStep(raw);
    assert.deepEqual(internalNames(`${out.title} ${out.sub}`), [], JSON.stringify(raw));
    assert.doesNotMatch(`${out.title} ${out.sub}`, /chrome|bash|stdout|mcp|playwright/i, JSON.stringify(raw));
  }
});
