import test from "node:test";
import assert from "node:assert/strict";
import { draftState, sentence, story, testView, type StepIn } from "./model.ts";

const step = (o: Partial<StepIn> & { id: string }): StepIn => ({
  app: { id: "vyre", name: "Vyre" },
  action: "Create a task",
  template: "Make a task for {who}",
  values: { who: { text: "Lena" } },
  ...o,
});
const chip = (label: string, from: string, sample: string) => ({ chip: { label, from, sample } });

test("a step reads as a sentence with real names and value chips that say where they come from", () => {
  const s = sentence(
    step({
      id: "2",
      template: "Send {file} to {who} for signature",
      values: {
        file: { text: "“Engagement letter.docx”" },
        who: chip("Email", "A form is submitted", "sam@brightpath.io"),
      },
    }),
  );
  assert.deepEqual(
    s.parts.map((p) => (p.t === "chip" ? `[${p.label}]` : p.v)).join(""),
    "Send “Engagement letter.docx” to [Email] for signature",
  );
  const c = s.parts.find((p) => p.t === "chip")!;
  assert.equal(c.t === "chip" && c.tip, "From: A form is submitted\nEmail: sam@brightpath.io");
  assert.equal(s.text, "Send “Engagement letter.docx” to Email for signature");
});

test("a value not set yet is a blank in the sentence, never a field key", () => {
  const s = sentence(step({ id: "1", template: "Send {file} for signature", values: {} }));
  assert.equal(s.text, "Send … for signature");
  assert.ok(s.parts.some((p) => p.t === "blank"));
});

const base = {
  name: "Intake to signature",
  on: false,
  trigger: {
    id: "t",
    app: { id: "wordpress", name: "WordPress" },
    template: "A form is submitted: {form}",
    values: { form: { text: "Contact" } },
    hand: false,
  },
  proposed: false,
  dirty: false,
  test: null,
};

test("the trigger is When and steps count from 1 across branches, in the order they run", () => {
  const m = story({
    ...base,
    steps: [
      step({ id: "a" }),
      step({ id: "b", yes: [step({ id: "b1" }), step({ id: "b2" })], otherwise: [step({ id: "b3" })] }),
      step({ id: "c" }),
    ],
  });
  assert.deepEqual(
    m.rows.map((r) =>
      r.kind === "trigger" ? "When" : r.kind === "step" ? `${r.number}${"-".repeat(r.depth)}` : r.label,
    ),
    ["When", "1", "2", "If yes", "3-", "4-", "Otherwise", "5-", "6"],
  );
});

test("a step's one missing thing is one orange line and one button, in this order of importance, and only the one being asked", () => {
  const m = story({
    ...base,
    steps: [
      step({
        id: "a",
        needs: [
          { kind: "value", line: "Choose the file to send", button: "Choose the file" },
          { kind: "allow", line: "Waiting for your OK to let Assistant use Google Workspace here.", button: "Allow" },
        ],
      }),
      step({ id: "b", needs: [{ kind: "connect", line: "Needs your HubSpot key", button: "Connect", queued: true }] }),
      step({ id: "c" }),
    ],
  });
  const rows = m.rows.filter((r) => r.kind === "step");
  assert.deepEqual(rows[0]!.need, {
    kind: "allow",
    line: "Waiting for your OK to let Assistant use Google Workspace here.",
    button: "Allow",
  });
  assert.equal(rows[1]!.need, null);
  assert.equal(rows[2]!.need, null);
  assert.equal(m.needsYou, 1);
});

test("the head says the state in words and offers one primary", () => {
  const h = (o: object) => story({ ...base, steps: [step({ id: "a" })], ...o }).head;
  assert.deepEqual([h({}).state, h({}).primary?.label], ["Off, saved as a draft", "Turn on"]);
  assert.equal(h({ on: true }).state, "On");
  assert.deepEqual(
    [h({ on: true, dirty: true }).state, h({ on: true, dirty: true }).primary],
    ["On, your changes are a draft", null],
  );
  assert.equal(h({ on: true, trigger: { ...base.trigger, hand: true } }).primary?.label, "Run now");
  assert.equal(h({ on: true, trigger: { ...base.trigger, hand: false } }).primary, null);
  assert.equal(story({ ...base, trigger: null, steps: [] }).head.state, "Off");
  assert.equal(story({ ...base, trigger: null, steps: [] }).head.test, false);
  assert.equal(h({}).test, true);
});

test("Turn on waits while a step needs something, and says which", () => {
  const m = story({
    ...base,
    steps: [
      step({ id: "a", needs: [{ kind: "value", line: "x", button: "y" }] }),
      step({ id: "b", needs: [{ kind: "value", line: "x", button: "y" }] }),
    ],
  });
  assert.equal(m.head.primary?.label, "Turn on");
  assert.equal(m.head.primary?.disabled, true);
  assert.equal(m.head.primary?.why, "2 steps need you");
});

test("bars: the Assistant's draft, changes on a live Automation, a test", () => {
  const steps = [step({ id: "a" }), step({ id: "b" }), step({ id: "c" })];
  assert.deepEqual(story({ ...base, steps, proposed: true }).bars, [
    { kind: "draft", text: "Assistant’s draft, 3 steps. Nothing is on yet.", actions: ["Discard", "Change", "Accept"] },
  ]);
  assert.equal(
    story({ ...base, steps: [step({ id: "a" })], proposed: true }).bars[0]!.text,
    "Assistant’s draft, 1 step. Nothing is on yet.",
  );
  assert.deepEqual(story({ ...base, steps, on: true, dirty: true }).bars, [
    {
      kind: "live",
      text: "Your changes are saved as a draft, not live. Runs already started finish as they were.",
      actions: ["Discard", "Make live"],
    },
  ]);
  assert.deepEqual(story({ ...base, steps, test: { caseName: "Tuesday’s intake from Sam Reyes", results: {} } }).bars, [
    {
      kind: "test",
      text: "Test with Tuesday’s intake from Sam Reyes. The test sent nothing.",
      actions: ["Run again", "Done"],
    },
  ]);
});

test("draft against live: editing saves a draft; an Off Automation has only a draft; a live one is dirty when the draft differs", () => {
  const live = { n: 1 };
  assert.equal(draftState({ on: false, live: null, draft: { n: 2 } }), "off");
  assert.equal(draftState({ on: true, live, draft: { n: 1 } }), "clean");
  assert.equal(draftState({ on: true, live, draft: { n: 2 } }), "dirty");
  assert.equal(draftState({ on: true, live: { a: 1, b: 2 }, draft: { b: 2, a: 1 } }), "clean");
});

test("Test runs the draft step by step, stops at the first step that needs something, and labels what would have been sent", () => {
  const steps = [
    step({ id: "a", writes: false }),
    step({ id: "b", writes: true }),
    step({ id: "c", needs: [{ kind: "value", line: "Choose the file to send", button: "Choose the file" }] }),
    step({ id: "d", writes: true }),
  ];
  const t = testView(steps, {
    a: { status: "ok", line: "Task for Lena", values: [["Title", "Follow up"]] },
    b: { status: "ok", line: "Text to me", values: [] },
  });
  assert.deepEqual(
    t.map((r) => [r.id, r.mark, r.tag, r.line]),
    [
      ["a", "done", null, "Task for Lena"],
      ["b", "done", "Not sent", "Text to me"],
      ["c", "stopped", null, "Stopped here"],
      ["d", "skipped", null, null],
    ],
  );
  assert.deepEqual(t[2]!.need, { kind: "value", line: "Choose the file to send", button: "Choose the file" });
});

test("a step whose app he may not use is shown whole with one plain line, never dropped or broken", () => {
  const m = story({
    ...base,
    steps: [
      step({
        id: "a",
        app: { id: "microsoft", name: "Microsoft 365" },
        action: "Send an Outlook message",
        template: "Send {what} to {who}",
        values: { what: { text: "the invoice" }, who: { text: "Sam" } },
        needs: [
          { kind: "value", line: "Choose the file", button: "Choose" },
          {
            kind: "no_access",
            line: "You cannot use Microsoft 365. Dana Whitfield can.",
            button: "Ask Dana Whitfield",
          },
        ],
      }),
    ],
  });
  const r = m.rows.find((x) => x.kind === "step")!;
  assert.equal(r.kind === "step" && r.sentence.text, "Send the invoice to Sam");
  assert.deepEqual(r.kind === "step" && r.need, {
    kind: "no_access",
    line: "You cannot use Microsoft 365. Dana Whitfield can.",
    button: "Ask Dana Whitfield",
  });
  assert.equal(m.rows.length, 2);
});

test("a loop and parallel lanes read as one indented group under a one-line head, with plain numbers in run order", () => {
  const m = story({
    ...base,
    steps: [
      step({ id: "a" }),
      step({ id: "l", group: { head: "For each row in Leads:", steps: [step({ id: "l1" }), step({ id: "l2" })] } }),
      step({ id: "p", group: { head: "At the same time:", steps: [step({ id: "p1" }), step({ id: "p2" })] } }),
      step({ id: "z" }),
    ],
  });
  assert.deepEqual(
    m.rows.map((r) =>
      r.kind === "trigger"
        ? "When"
        : r.kind === "step"
          ? `${r.number}${"-".repeat(r.depth)}`
          : r.kind === "head"
            ? `${r.text}${"-".repeat(r.depth)}`
            : r.label,
    ),
    ["When", "1", "2", "For each row in Leads:-", "3-", "4-", "5", "At the same time:-", "6-", "7-", "8"],
  );
});

test("while the Assistant's draft is proposed the head still offers Test and Turn on, as drawn", () => {
  const m = story({ ...base, proposed: true, trigger: base.trigger, steps: [step({ id: "a" })] });
  assert.deepEqual([m.head.test, m.head.primary?.label], [true, "Turn on"]);
});

test("a step can be added between two steps: a slot after every row but the last, branches included", () => {
  const m = story({
    ...base,
    steps: [
      step({ id: "a" }),
      step({ id: "b", yes: [step({ id: "b1" })], otherwise: [step({ id: "b2" })] }),
      step({ id: "c" }),
    ],
  });
  assert.deepEqual(m.slots, ["t", "a", "b", "b1", "b2"]);
  assert.deepEqual(story({ ...base, trigger: null, steps: [] }).slots, []);
});

test("a sentence never ends on a preposition: an empty value, or text that stops after one, shows the blank", () => {
  const ends = (template: string, values: Record<string, { text: string } | undefined>) =>
    sentence({ template, values }).text;
  const cases: [string, Record<string, { text: string } | undefined>][] = [
    ["Post in {channel}: New request from {who}", { channel: { text: "#ops" } }],
    ["Post in #ops: New request from ", {}],
    ["Send {file} to {who}", { file: { text: "brief.pdf" } }],
    ["Email {who} about {topic}", { who: { text: "Sam" } }],
    ["Make a task for", {}],
    ["Save {file} to Drive / {folder}", { file: { text: "x" } }],
  ];
  for (const [t, v] of cases) {
    const text = ends(t, v);
    assert.ok(!/\b(from|to|in|for|with|on|at|by|of|about|into)\s*$/i.test(text), `"${text}" ends on a preposition`);
  }
  assert.equal(ends("Post in #ops: New request from ", {}), "Post in #ops: New request from \u2026");
});

test("edits not yet saved say so plainly, and saving is the one action: until the server keeps a draft the bar never claims one", () => {
  const steps = [step({ id: "a" })];
  assert.deepEqual(story({ ...base, steps, dirty: true, saveMode: "local" }).bars, [
    { kind: "live", text: "You have changes that are not saved yet.", actions: ["Discard", "Save"] },
  ]);
  const onLive = story({ ...base, steps, on: true, dirty: true, saveMode: "local" });
  assert.equal(onLive.bars[0]!.text, "You have changes that are not saved yet. Saving makes them live.");
  assert.equal(onLive.head.state, "On, you have unsaved changes");
  assert.equal(story({ ...base, steps, dirty: true, saveMode: "local" }).head.primary, null);
});

test("an Automation with several triggers shows each as its own row: When, then Or, so every one can be opened", () => {
  const m = story({
    ...base,
    moreTriggers: [{ ...base.trigger, id: "trigger:1", template: "Any form is submitted", values: {} }],
    steps: [step({ id: "a" })],
  });
  const rows = m.rows.filter((r) => r.kind === "trigger");
  assert.deepEqual(
    rows.map((r) => [r.kind === "trigger" && r.label, r.id]),
    [
      ["When", "t"],
      ["Or", "trigger:1"],
    ],
  );
  assert.deepEqual(m.slots, ["trigger:1"], "a step is added after the last trigger, never between two triggers");
});
