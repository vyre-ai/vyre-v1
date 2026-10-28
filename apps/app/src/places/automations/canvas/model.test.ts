// The canvas model (spec 3.7, 2.12): the layout of triggers, steps, Paths, Parallel and Loop; the lane a run took; the local check that mirrors automations.validate; the edits.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CARD_H, CARD_W, GAP_Y, addAfter, addInto, addTrigger, blankStep, check, clampZoom, describeTrigger, duplicateStep, fitScale, joinOf, kindOfKey, layout, moveStep, neighbour, removeStep,
  removeTrigger, runStates, sortedIssues, subtitleOf, successors, updateStep,
} from "./model.ts";
import type { Definition } from "./model.ts";
import { LEAD_FOLLOW_UP } from "../sidebar/sample.ts";

const linear = (): Definition => ({
  triggers: [{ key: "schedule" }], start: ["a"],
  nodes: [{ id: "a", key: "records.find", input: { type: "person" }, next: ["b"] }, { id: "b", key: "send_email", input: { to: "x@y.z", mailboxId: "mbx_main" }, next: ["c"] }, { id: "c", key: "stop", input: {} }],
});

/** Three paths that come back together: a, then paths p with three lanes, then z. */
const threePaths = (): Definition => ({
  triggers: [{ key: "record_change" }], start: ["a"],
  nodes: [
    { id: "a", key: "records.find", input: { type: "lead" }, next: ["p"] },
    { id: "p", key: "paths", input: {}, branches: [{ label: "Hot", to: "h", when: "lead.score > 80" }, { label: "Warm", to: "w", when: "lead.score > 40" }, { label: "Otherwise", to: "z" }] },
    { id: "h", key: "create_task", input: { title: "Call now" }, next: ["z"] },
    { id: "w", key: "send_email", input: { to: "lead" }, next: ["z"] },
    { id: "z", key: "post_message", input: { channelId: "#sales" } },
  ],
});

const byId = <T extends { id: string }>(xs: readonly T[], id: string): T => {
  const x = xs.find((c) => c.id === id);
  assert.ok(x, `card ${id}`);
  return x;
};

test("step keys map to their kinds and the successors follow branches before next", () => {
  assert.deepEqual(["paths", "if", "parallel", "loop", "wait", "wait_stage", "approval", "stop", "ai", "send_email"].map(kindOfKey), ["paths", "paths", "parallel", "loop", "wait", "wait", "approval", "stop", "ai", "plain"]);
  const d = threePaths();
  assert.deepEqual(successors(d.nodes[1]!), ["h", "w", "z"]);
  assert.deepEqual(successors(d.nodes[0]!), ["p"]);
  assert.equal(joinOf(new Map(d.nodes.map((n) => [n.id, n])), d.nodes[1]!), "z", "the lanes come back together at the first step all of them reach");
});

test("a straight Automation stacks its cards under the trigger with a connector between each", () => {
  const l = layout(linear());
  assert.deepEqual(l.cards.map((c) => c.id), ["trigger", "a", "b", "c"]);
  const [t, a, b] = [byId(l.cards, "trigger"), byId(l.cards, "a"), byId(l.cards, "b")];
  assert.equal(a.y, t.y + t.h + GAP_Y);
  assert.equal(b.y, a.y + CARD_H + GAP_Y);
  assert.equal(a.x, b.x, "one column");
  assert.equal(a.w, CARD_W);
  const vertical = l.segs.filter((s) => s.x1 === s.x2);
  assert.equal(vertical.length, 3, "trigger to a, a to b, b to c");
  assert.deepEqual(l.order, ["trigger", "a", "b", "c"]);
});

test("the trigger card grows with each trigger and shows all of them", () => {
  const one = layout(linear());
  const two = layout(addTrigger(linear(), "webhook"));
  assert.equal(byId(two.cards, "trigger").h, byId(one.cards, "trigger").h + 54);
  assert.equal(byId(two.cards, "a").y, byId(one.cards, "a").y + 54, "the first step moves down with it");
});

test("Paths with three lanes lay out side by side, label each lane and rejoin at the step they share", () => {
  const l = layout(threePaths());
  const [h, w, z, p] = [byId(l.cards, "h"), byId(l.cards, "w"), byId(l.cards, "z"), byId(l.cards, "p")];
  assert.ok(h.x < w.x, "lanes run left to right in the order of the branches");
  assert.equal(h.y, w.y, "the first two lanes start on the same row");
  assert.ok(z.y > h.y + CARD_H, "the shared step sits under every lane");
  assert.ok(Math.abs(z.x + z.w / 2 - (p.x + p.w / 2)) < 1, "and under the Paths step");
  assert.deepEqual(l.chips.map((c) => c.text), ["If lead.score > 80", "If lead.score > 40", "Otherwise"]);
  assert.deepEqual(l.chips.map((c) => c.kind), ["if", "if", "otherwise"]);
  assert.ok(l.chips[0]!.mono && !l.chips[2]!.mono, "conditions are code, Otherwise is a word");
});

test("an empty lane that goes straight to the join still draws its label and a connector", () => {
  const l = layout(threePaths());
  const other = l.chips.find((c) => c.text === "Otherwise")!;
  assert.ok(l.segs.some((s) => s.x1 === other.x && s.x2 === other.x && s.y1 >= other.y), "a line drops from the Otherwise label");
});

test("lanes that never meet end on their own and nothing is drawn after them", () => {
  const d = layout(LEAD_FOLLOW_UP);
  const ids = d.cards.map((c) => c.id);
  for (const id of ["find", "draft", "mobile", "text", "wait", "replied", "task", "nudge", "email"]) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length, "every card once");
  const [text, email] = [byId(d.cards, "text"), byId(d.cards, "email")];
  assert.ok(text.x < email.x, "the Text lane is left of Otherwise");
  assert.ok(byId(d.cards, "task").x < byId(d.cards, "nudge").x, "the nested Paths fan out under the Text lane");
});

test("a Loop draws its label and a frame round its body, then carries on after it", () => {
  const d: Definition = {
    triggers: [{ key: "schedule" }], start: ["f"],
    nodes: [{ id: "f", key: "loop", input: { items: "x" }, branches: [{ label: "Each", to: "in" }], next: ["after"] }, { id: "in", key: "send_email", input: { to: "a" } }, { id: "after", key: "stop", input: {} }],
  };
  const l = layout(d);
  assert.equal(l.frames.length, 1);
  const [inside, after, frame] = [byId(l.cards, "in"), byId(l.cards, "after"), l.frames[0]!];
  assert.ok(inside.x >= frame.x && inside.x + inside.w <= frame.x + frame.w, "the body sits inside the frame");
  assert.ok(after.y > inside.y, "the step after the loop is below the body");
  assert.ok(l.chips.some((c) => c.kind === "each"));
});

test("steps nothing leads to stay visible beside the canvas", () => {
  const d = linear();
  d.nodes.push({ id: "lost", key: "send_sms", input: { to: "1" } });
  const l = layout(d);
  const lost = byId(l.cards, "lost");
  assert.ok(lost.x > byId(l.cards, "a").x + CARD_W, "to the right of the main column");
  assert.ok(check(d).some((i) => i.nodeId === "lost" && /not connected/.test(i.message)));
});

test("a run lights the lane it took and leaves the others dim", () => {
  const states = runStates([{ nodeId: "find", status: "done" }, { nodeId: "mobile", status: "done" }, { nodeId: "email", status: "failed" }, { nodeId: "text", status: "skipped" }]);
  const l = layout(LEAD_FOLLOW_UP, { run: states });
  assert.equal(byId(l.cards, "email").state, "failed");
  assert.equal(byId(l.cards, "text").state, "skipped");
  assert.equal(byId(l.cards, "draft").state, undefined, "a step the run never reached has no state");
  assert.ok(l.segs.some((s) => s.lit), "some connector is lit");
});

test("the local check names what is missing, in words, against the step", () => {
  const d = threePaths();
  d.nodes[2]!.input = {};
  d.nodes[1]!.branches![0]!.when = "";
  const out = sortedIssues(check(d));
  assert.ok(out.every((i, n) => n === 0 || out[n - 1]!.severity !== "warning" || i.severity === "warning"), "errors come first");
  assert.ok(out.some((i) => i.nodeId === "h" && /needs a title/.test(i.message)), "Create a task needs a title");
  assert.ok(check({ triggers: [{ key: "manual" }], nodes: [{ id: "m", key: "send_email", input: { to: "a@b.c" } }] }).some((i) => /needs a mailbox/.test(i.message)));
  assert.ok(check({ triggers: [{ key: "manual" }], nodes: [{ id: "s", key: "send_sms", input: { to: "+1" } }] }).some((i) => /needs a number/.test(i.message)));
  assert.ok(out.some((i) => i.nodeId === "p" && /needs its condition/.test(i.message)));
  assert.ok(check({ triggers: [], nodes: [] }).some((i) => /Add a trigger/.test(i.message)));
  assert.ok(check({ triggers: [{ key: "webhook" }], nodes: [] }, "personal").some((i) => /Team Space/.test(i.message)), "a webhook needs a Team Space");
});

test("an AI step asks for a key and a backup, a route needs a step, and a loop in the lanes is an error", () => {
  const d: Definition = { triggers: [{ key: "manual" }], start: ["x"], nodes: [{ id: "x", key: "ai", input: {}, next: ["y"] }, { id: "y", key: "send_email", input: { to: "a" }, next: ["x"], onError: { mode: "route" } }] };
  const out = check(d);
  assert.ok(out.some((i) => i.nodeId === "x" && /pick the key/.test(i.message)));
  assert.ok(out.some((i) => i.nodeId === "y" && /choose the step an error goes to/.test(i.message)));
  assert.ok(out.some((i) => /never end/.test(i.message)));
  d.nodes[0]!.ai = { keyId: "k1" };
  assert.ok(check(d).some((i) => i.nodeId === "x" && /backup key/.test(i.message)));
});

test("a paths step needs at least one path and only the last may be Otherwise", () => {
  const d = threePaths();
  d.nodes[1]!.branches = [{ label: "Otherwise", to: "z" }, { label: "Hot", to: "h", when: "x" }];
  assert.ok(check(d).some((i) => i.nodeId === "p" && /only the last path can be Otherwise/.test(i.message)));
  d.nodes[1]!.branches = [];
  assert.ok(check(d).some((i) => i.nodeId === "p" && /has no paths/.test(i.message)));
});

test("card text: the title falls back to the step's name and the second line says what it does", () => {
  const l = layout(LEAD_FOLLOW_UP, { keyName: (id) => ({ key_claude: "Your Claude sign-in", key_nw_openai: "Northwind OpenAI key" })[id] ?? id });
  assert.equal(byId(l.cards, "draft").sub, "Your Claude sign-in, then Northwind OpenAI key");
  assert.equal(byId(l.cards, "mobile").sub, "1 path and Otherwise, first match wins");
  assert.equal(byId(l.cards, "wait").sub, "They reply by text, up to 1 day");
  assert.equal(subtitleOf({ id: "s", key: "stop", input: {} }), "The run ends here");
  assert.equal(subtitleOf({ id: "s", key: "ai", input: {} }), "Pick a key for this step");
  assert.equal(subtitleOf({ id: "m", key: "send_email", input: { to: ["ada@example.com"], subject: "Hello", message: { version: 2 } } }), "Email ada@example.com: Hello, template v2");
  assert.equal(subtitleOf({ id: "t", key: "send_sms", input: { to: "+1555", body: "Hi" } }), "Text +1555, 1 segment");
  assert.equal(describeTrigger({ key: "record_change", filter: { where: "Source is Meta" } }), "Only when Source is Meta");
  assert.equal(describeTrigger({ key: "form_submit" }), "Every time");
});

test("adding a step after another keeps the chain: what followed now follows the new step", () => {
  const { def, id } = addAfter(linear(), "a", "send_sms");
  assert.deepEqual(def.nodes.map((n) => n.id), ["a", id, "b", "c"]);
  assert.deepEqual(def.nodes.find((n) => n.id === "a")!.next, [id]);
  assert.deepEqual(def.nodes.find((n) => n.id === id)!.next, ["b"]);
  const first = addAfter(linear(), null, "wait");
  assert.deepEqual(first.def.start, [first.id]);
  assert.deepEqual(first.def.nodes[0]!.next, ["a"]);
  assert.equal(linear().nodes.length, 3, "the input is never changed");
});

test("a new Paths step arrives with a path and an Otherwise, and takes what followed into its first lane", () => {
  const { def, id } = addAfter(linear(), "a", "paths");
  const p = def.nodes.find((n) => n.id === id)!;
  assert.deepEqual(p.branches!.map((b) => b.label), ["Path 1", "Otherwise"]);
  assert.equal(p.branches![0]!.to, "b");
  assert.equal(check(def).filter((i) => i.nodeId !== id).length, 0, "nothing else is left unconnected");
  const par = blankStep(linear(), "parallel")[0]!;
  assert.equal(par.branches!.length, 2);
});

test("adding into a lane starts it, and into a lane that has steps puts the new step first", () => {
  const empty = addInto(addAfter(linear(), "a", "parallel").def, "parallel_4", "send_sms", 1);
  const par = empty.def.nodes.find((n) => n.id === "parallel_4")!;
  assert.equal(par.branches![1]!.to, empty.id);
  const filled = addInto(threePaths(), "p", "wait", 0);
  assert.equal(filled.def.nodes.find((n) => n.id === "p")!.branches![0]!.to, filled.id);
  assert.deepEqual(filled.def.nodes.find((n) => n.id === filled.id)!.next, ["h"], "the old first step follows it");
});

test("removing a step reconnects what pointed at it, in a lane and at the start", () => {
  const d = removeStep(threePaths(), "h");
  assert.equal(d.nodes.find((n) => n.id === "p")!.branches![0]!.to, "z", "the lane now goes to what the removed step led to");
  const first = removeStep(linear(), "a");
  assert.deepEqual(first.start, ["b"]);
  assert.throws(() => removeStep(linear(), "nope"), /no such step/);
  assert.equal(check(first).filter((i) => i.severity === "error" && /leads to a step/.test(i.message)).length, 0);
});

test("moving a step swaps it with its neighbour and keeps the chain whole", () => {
  const down = moveStep(linear(), "a", 1);
  assert.deepEqual(down.start, ["b"]);
  assert.deepEqual(down.nodes.find((n) => n.id === "b")!.next, ["a"]);
  assert.deepEqual(down.nodes.find((n) => n.id === "a")!.next, ["c"]);
  const up = moveStep(linear(), "b", -1);
  assert.deepEqual(up.start, ["b"]);
  assert.equal(check(up).filter((i) => /not connected|leads back/.test(i.message)).length, 0);
  assert.deepEqual(moveStep(linear(), "a", -1), linear(), "the first step cannot move up");
});

test("updating a step changes its fields and never its id or kind; a blank name goes back to the default", () => {
  const d = updateStep(linear(), "a", { title: "Find them", input: { type: "lead" } });
  assert.equal(d.nodes[0]!.title, "Find them");
  assert.equal(updateStep(d, "a", { title: " " }).nodes[0]!.title, undefined);
  assert.throws(() => updateStep(linear(), "nope", {}), /no such step/);
});

test("duplicating copies the fields, names the copy and puts it right after the original", () => {
  const src = updateStep(linear(), "a", { title: "Find them" });
  const { def, id } = duplicateStep(src, "a");
  const copy = def.nodes.find((n) => n.id === id)!;
  assert.equal(copy.title, "Find them copy");
  assert.deepEqual(copy.input, { type: "person" });
  assert.deepEqual(def.nodes.find((n) => n.id === "a")!.next, [id]);
});

test("triggers add and remove without touching the steps", () => {
  const d = addTrigger(linear(), "webhook");
  assert.deepEqual(d.triggers.map((t) => t.key), ["schedule", "webhook"]);
  assert.deepEqual(removeTrigger(d, 0).triggers.map((t) => t.key), ["webhook"]);
  assert.equal(d.nodes.length, 3);
});

test("arrow keys walk the cards: down and up along the order, left and right along a row", () => {
  const l = layout(threePaths());
  assert.equal(neighbour(l, "trigger", "down"), "a");
  assert.equal(neighbour(l, "a", "up"), "trigger");
  assert.equal(neighbour(l, "trigger", "up"), null);
  assert.equal(neighbour(l, "h", "right"), "w");
  assert.equal(neighbour(l, "w", "left"), "h");
  assert.equal(neighbour(l, "h", "left"), null);
});

test("zoom stays between 30 and 200 percent and Fit never magnifies", () => {
  assert.equal(clampZoom(0.1), 0.3);
  assert.equal(clampZoom(3), 2);
  assert.equal(clampZoom(1.04), 1.04);
  const l = layout(linear());
  assert.equal(fitScale(l, 4000, 4000), 1);
  assert.ok(fitScale(l, 200, 4000) < 1);
  assert.equal(fitScale(l, 10, 10), 0.3);
});
