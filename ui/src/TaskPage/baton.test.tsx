// The work baton on the task page (lane W2): the stepper and who holds it, whose turn it is, the cards, and the buttons for the person whose turn it is.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { briefOf, deliverableOf, fixesFromText, fixesOf, isBaton, myMove, nowStep, stepsOf, wantedFields } from "./baton.ts";
import { TaskPage } from "./index.tsx";
import type { TaskView } from "./model.ts";

const agent = (id: string) => ({ kind: "agent" as const, id });
const person = (id: string) => ({ kind: "person" as const, id });
const work = (over: Partial<TaskView> = {}): TaskView => ({
  id: "tsk_w1", title: "Draft the letter", kind: "work", state: "todo", blocked: false, assigned: agent("agt_doer"), reviewer: agent("agt_check"), approver: person("usr_boss"), actions: [], followers: [], workingNotes: { brief: "## Goal\nDraft the engagement letter.\n\n## Rules\nBe brief.", done_means: JSON.stringify(["Names the client"]) }, fileIds: [], dependsOn: [], updatedAt: 1, ...over,
});
const people = [{ id: "agt_doer", kind: "agent" as const, name: "Drafter" }, { id: "agt_check", kind: "agent" as const, name: "Checker" }, { id: "usr_boss", kind: "person" as const, name: "Olivia" }, { id: "usr_me", kind: "person" as const, name: "Maya" }];
const page = (task: TaskView, me = "usr_boss") => renderToStaticMarkup(createElement(TaskPage, { task, me, principals: people, history: [], online: true, onCommand: async () => undefined, onBack: () => undefined, onOpen: () => undefined }));

test("the stepper has Do, Review, Approve and Done, lights the holder, and ticks what is past", () => {
  const at = (state: TaskView["state"]) => stepsOf(work({ state })).map((x) => `${x.key}:${x.lit}`);
  assert.deepEqual(at("todo"), ["assigned:now", "review:next", "approve:next", "done:next"]);
  assert.deepEqual(at("in_review"), ["assigned:past", "review:now", "approve:next", "done:next"]);
  assert.deepEqual(at("awaiting_approval"), ["assigned:past", "review:past", "approve:now", "done:next"]);
  assert.deepEqual(at("done"), ["assigned:past", "review:past", "approve:past", "done:past"]);
  assert.deepEqual(stepsOf(work({ reviewer: undefined, approver: undefined })).map((x) => x.key), ["assigned", "done"], "no seat, no step");
  assert.equal(nowStep(work({ state: "canceled" })), null);
});

test("only a work task with someone to pass it to, or a brief, is a baton task", () => {
  assert.equal(isBaton(work()), true);
  assert.equal(isBaton(work({ reviewer: undefined, approver: undefined, workingNotes: {} })), false);
  assert.equal(isBaton(work({ kind: "approve" })), false);
});

test("the move is the seat whose turn it is, when it is the viewer's, and a blocked or finished task has none", () => {
  assert.equal(myMove(work({ assigned: person("usr_me") }), "usr_me"), "work");
  assert.equal(myMove(work({ state: "in_review", reviewer: person("usr_me") }), "usr_me"), "review");
  assert.equal(myMove(work({ state: "awaiting_approval" }), "usr_boss"), "approve");
  assert.equal(myMove(work({ state: "awaiting_approval" }), "usr_me"), null);
  assert.equal(myMove(work({ state: "awaiting_approval", blocked: true }), "usr_boss"), null);
  assert.equal(myMove(work({ state: "done" }), "usr_boss"), null);
  assert.equal(myMove(work({ assigned: { kind: "group", id: "grp_desk" } }), "usr_me"), null, "a group seat is theirs once they take it");
  assert.equal(myMove(work({ assigned: { kind: "group", id: "grp_desk" }, takenBy: "usr_me" }), "usr_me"), "work");
});

test("the deliverable, the fixes, the brief and the wanted fields come out of the notes", () => {
  const t = work({ workingNotes: { brief: "B", done_means: "[\"x\"]", summary: "Drafted it", outputs: JSON.stringify({ letter: "Dear Ms Ortiz", n: 2 }), fixes: JSON.stringify(["Use her full name", " "]), output_schema: JSON.stringify({ required: ["letter"], properties: { letter: { type: "string" }, n: { type: "integer" } } }) } });
  assert.deepEqual(deliverableOf(t), { summary: "Drafted it", fields: [{ name: "letter", value: "Dear Ms Ortiz" }, { name: "n", value: "2" }] });
  assert.deepEqual(fixesOf(t), ["Use her full name"]);
  assert.deepEqual(briefOf(t), { text: "B", doneMeans: ["x"] });
  assert.deepEqual(wantedFields(t), [{ name: "letter", required: true, type: "string" }, { name: "n", required: false, type: "integer" }]);
  assert.equal(deliverableOf(work()), null);
});

test("fixes typed one per line become the list the tool takes", () => {
  assert.deepEqual(fixesFromText("1. Use her full name\n- Cut paragraph two\n\n  3) Check the fee "), ["Use her full name", "Cut paragraph two", "Check the fee"]);
});

test("the page shows the stepper with names, the brief collapsed, and no raw baton notes", () => {
  const html = page(work());
  assert.match(html, /data-testid="baton-stepper"/);
  for (const name of ["Drafter", "Checker", "Olivia"]) assert.match(html, new RegExp(name));
  assert.match(html, /data-testid="baton-brief"/);
  assert.match(html, /Draft the engagement letter\./);
  assert.doesNotMatch(html, /## Goal/, "the brief shows its words, not its markdown");
  assert.doesNotMatch(html, />brief</, "the baton's notes are not listed as raw rows");
  assert.doesNotMatch(html, /data-testid="baton-actions"/, "not the viewer's turn: no buttons");
});

test("the viewer whose turn it is gets the buttons of their seat, and the deliverable to look at", () => {
  const notes = { brief: "B", summary: "Drafted it", outputs: JSON.stringify({ letter: "Dear Ms Ortiz" }) };
  const approve = page(work({ state: "awaiting_approval", workingNotes: notes }));
  assert.match(approve, /data-testid="baton-deliverable"/);
  assert.match(approve, /Dear Ms Ortiz/);
  assert.match(approve, /aria-label="Approve"/); assert.match(approve, /aria-label="Reject"/);
  const review = page(work({ state: "in_review", reviewer: person("usr_me"), workingNotes: notes }), "usr_me");
  assert.match(review, /aria-label="Looks good"/); assert.match(review, /aria-label="Send back"/);
  const mine = page(work({ assigned: person("usr_me"), workingNotes: { brief: "B", output_schema: JSON.stringify({ required: ["letter"], properties: { letter: { type: "string" } } }) } }), "usr_me");
  assert.match(mine, /aria-label="Hand in"/); assert.match(mine, /aria-label="letter"/);
});

test("after a send back the doer sees the fixes as a checklist", () => {
  const html = page(work({ state: "doing", assigned: person("usr_me"), workingNotes: { brief: "B", fixes: JSON.stringify(["Use her full name"]) } }), "usr_me");
  assert.match(html, /data-testid="baton-fixes"/);
  assert.match(html, /1\. Use her full name/);
  assert.match(html, /role="checkbox"/);
});

test("working notes are one quiet Add a note row, not a form, and the seats in the side column show faces", () => {
  const html = page(work({ workingNotes: { brief: "B", reminder: "Call on Monday" } }));
  assert.match(html, /aria-label="Add a note"/);
  assert.doesNotMatch(html, /aria-label="Working note"|aria-label="Note name"|Save working note/, "the form is closed until asked for");
  assert.match(html, /Call on Monday/);
  assert.match(html, /aria-label="Remove reminder"/);
  const at = html.lastIndexOf(">Assigned<");
  assert.match(html.slice(at, at + 200), /Drafter/, "the seat is named");
  assert.match(html.slice(at - 700, at), /<svg/, "and has a face before it");
});
