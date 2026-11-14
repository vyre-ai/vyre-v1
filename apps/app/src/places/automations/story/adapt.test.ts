import test from "node:test";
import assert from "node:assert/strict";
import { fromDefinition, type AdaptCtx, type DefIn } from "./adapt.ts";
import { story } from "./model.ts";

const ctx = (o: Partial<AdaptCtx> = {}): AdaptCtx => ({
  catalog: {
    "google.drive.create_folder": { title: "Save to Drive", app: { id: "google", name: "Google Workspace" } },
    sign: { title: "Send for signature" },
    post_message: { title: "Post a chat message" },
    send_email: { title: "Send an email" },
    paths: { title: "Paths" },
    "microsoft.mail": { title: "Send an Outlook message", app: { id: "microsoft", name: "Microsoft 365" } },
  },
  triggerTitles: { form_submit: "A form is submitted" },
  nameOfNode: (id) => (id === "trigger" ? "A form is submitted" : id),
  sample: { "trigger.name": "Sam Reyes" },
  canUse: () => true,
  needsOf: () => [],
  ...o,
});

const def: DefIn = {
  triggers: [{ key: "form_submit", config: { form: "Contact" } }],
  nodes: [
    { id: "s1", key: "sign", input: { file: "Engagement letter.docx", to: "{{trigger.email}}" }, next: ["s2"] },
    { id: "s2", key: "post_message", input: { channel: "#ops", text: "New request from {{trigger.name}}" } },
  ],
};

test("a definition becomes a trigger and steps in the order they run, each a sentence with names and chips and never a field key", () => {
  const r = fromDefinition(def, ctx());
  assert.equal(r.trigger?.template.includes("{form}"), true);
  assert.deepEqual(
    r.steps.map((s) => s.id),
    ["s1", "s2"],
  );
  const m = story({
    name: "x",
    on: false,
    proposed: false,
    dirty: false,
    test: null,
    trigger: r.trigger,
    steps: r.steps,
  });
  const rows = m.rows.filter((x) => x.kind === "step");
  assert.equal(
    rows[0]!.kind === "step" && rows[0]!.sentence.text,
    "Send for signature: Engagement letter.docx, to Email",
  );
  assert.equal(rows[1]!.kind === "step" && rows[1]!.sentence.text.includes("fileId"), false);
});

test("a reference becomes a chip that names its source and shows a sample; a text with a reference inside keeps its words", () => {
  const r = fromDefinition(def, ctx());
  const s1 = r.steps[0]!;
  const to = Object.values(s1.values).find((v) => v && "chip" in v);
  assert.deepEqual(to, { chip: { label: "Email", from: "A form is submitted", sample: "" } });
  const s2 = r.steps[1]!;
  const text = Object.values(s2.values)
    .map((v) => (v && "text" in v ? v.text : ""))
    .join("|");
  assert.ok(text.includes("New request from Name"));
  const name = fromDefinition(
    { ...def, nodes: [{ id: "s1", key: "post_message", input: { text: "{{trigger.name}}" } }] },
    ctx(),
  ).steps[0]!;
  assert.deepEqual(Object.values(name.values)[0], {
    chip: { label: "Name", from: "A form is submitted", sample: "Sam Reyes" },
  });
});

test("a Paths step with two lanes shows If yes and Otherwise, and what comes after both lanes follows them", () => {
  const d: DefIn = {
    triggers: [{ key: "form_submit" }],
    nodes: [
      {
        id: "p",
        key: "paths",
        input: {},
        branches: [
          { label: "Big", to: "a", when: "x > 1" },
          { label: "Otherwise", to: "b" },
        ],
      },
      { id: "a", key: "send_email", input: { subject: "Big" }, next: ["end"] },
      { id: "b", key: "send_email", input: { subject: "Small" }, next: ["end"] },
      { id: "end", key: "post_message", input: { text: "done" } },
    ],
  };
  const r = fromDefinition(d, ctx());
  assert.deepEqual(
    r.steps.map((s) => s.id),
    ["p", "end"],
  );
  assert.deepEqual([r.steps[0]!.yes?.map((s) => s.id), r.steps[0]!.otherwise?.map((s) => s.id)], [["a"], ["b"]]);
});

test("a step whose app he may not use stays whole with one plain line, and the sentence is intact", () => {
  const d: DefIn = {
    triggers: [{ key: "form_submit" }],
    nodes: [{ id: "m", key: "microsoft.mail", input: { subject: "Hello" } }],
  };
  const r = fromDefinition(
    d,
    ctx({
      canUse: (app) => app !== "microsoft",
      noAccess: (name) => ({ line: `You cannot use ${name}. Dana Whitfield can.`, button: "Ask Dana Whitfield" }),
    }),
  );
  const s = r.steps[0]!;
  assert.equal(s.app.name, "Microsoft 365");
  assert.deepEqual(s.needs?.[0], {
    kind: "no_access",
    line: "You cannot use Microsoft 365. Dana Whitfield can.",
    button: "Ask Dana Whitfield",
  });
  assert.ok(Object.values(s.values).length > 0);
});

test("a key the catalogue does not know still gets a sentence from its stored title, never the raw key", () => {
  const d: DefIn = {
    triggers: [{ key: "form_submit" }],
    nodes: [{ id: "z", key: "zzz.unknown_thing", title: "Tidy the inbox", input: {} }],
  };
  const r = fromDefinition(d, ctx());
  assert.equal(r.steps[0]!.template, "Tidy the inbox");
  assert.equal(r.steps[0]!.action, "", "nothing to add, so no second line");
});

test("the missing line for a step comes from the server's words, one per step, and writes steps are marked", () => {
  const r = fromDefinition(
    def,
    ctx({
      needsOf: (id) =>
        id === "s1" ? [{ kind: "value", line: "Choose the file to send", button: "Choose the file" }] : [],
      writes: (key) => key === "sign" || key === "post_message",
    }),
  );
  assert.equal(r.steps[0]!.needs?.[0]?.line, "Choose the file to send");
  assert.equal(r.steps[0]!.writes, true);
  assert.equal(r.steps[1]!.needs, undefined);
});

test("a loop is one group under 'For each ... in ...:' and parallel lanes one group under 'At the same time:'", () => {
  const d: DefIn = {
    triggers: [{ key: "form_submit" }],
    nodes: [
      {
        id: "lp",
        key: "loop",
        input: { items: "{{trigger.rows}}" },
        branches: [{ label: "body", to: "b1" }],
        next: ["pp"],
      },
      { id: "b1", key: "post_message", input: { text: "row" } },
      {
        id: "pp",
        key: "parallel",
        input: {},
        branches: [
          { label: "a", to: "x" },
          { label: "b", to: "y" },
        ],
      },
      { id: "x", key: "send_email", input: { subject: "A" } },
      { id: "y", key: "post_message", input: { text: "B" } },
    ],
  };
  const r = fromDefinition(d, ctx());
  assert.deepEqual(
    r.steps.map((s) => [s.id, s.group?.head, s.group?.steps.map((g) => g.id)]),
    [
      ["lp", "For each item in Rows:", ["b1"]],
      ["pp", "At the same time:", ["x", "y"]],
    ],
  );
});

test("a Drive step wears the Drive mark, a chat step the chat glyph, an email step the mail glyph", () => {
  const d: DefIn = {
    triggers: [{ key: "form_submit" }],
    nodes: [
      { id: "a", key: "google.drive.create_folder", input: {}, next: ["b"] },
      { id: "b", key: "post_message", input: { text: "x" }, next: ["c"] },
      { id: "c", key: "send_email", input: { subject: "x" } },
    ],
  };
  const r = fromDefinition(d, ctx());
  assert.deepEqual(
    r.steps.map((s) => s.app.id),
    ["gdrive", "vyre:chat", "vyre:mail"],
  );
});

test("a connector step wears its connector's name and mark, not the generic request", () => {
  const d: DefIn = {
    triggers: [{ key: "form_submit" }],
    nodes: [{ id: "a", key: "connector_request", input: { connector: "acme", action: "list_invoices" } }],
  };
  const r = fromDefinition(d, ctx({ catalog: { connector_request: { title: "Authenticated request" } } }));
  assert.deepEqual([r.steps[0]!.app.id, r.steps[0]!.app.name], ["acme", "Acme"]);
});

test("a step someone titled reads as its own title, never followed by a dump of its fields", () => {
  const d: DefIn = {
    triggers: [{ key: "form_submit" }],
    nodes: [
      {
        id: "a",
        key: "send_email",
        title: "Email the lead a first hello",
        input: { to: "{{trigger.email}}", subject: "Hello", mailboxId: "mbx_1" },
      },
    ],
  };
  const r = fromDefinition(d, ctx());
  assert.equal(r.steps[0]!.template, "Email the lead a first hello");
  assert.deepEqual(r.steps[0]!.values, {});
  assert.equal(r.steps[0]!.action, "to Email, Hello", "the second line says what the settings add, in words");
});

test("no step shows its title twice: the second line is absent or different from the first", () => {
  const d: DefIn = {
    triggers: [{ key: "form_submit" }],
    nodes: [
      { id: "a", key: "send_email", title: "Send an email", input: {}, next: ["b"] },
      { id: "b", key: "send_email", title: "Email the lead", input: { to: "{{trigger.email}}" }, next: ["c"] },
      { id: "c", key: "zzz.unknown", title: "Tidy", input: {} },
    ],
  };
  for (const st of fromDefinition(d, ctx()).steps) {
    const first = story({
      name: "x",
      on: false,
      trigger: null,
      moreTriggers: [],
      steps: [st],
      proposed: false,
      dirty: false,
      saveMode: "local",
      test: null,
    }).rows;
    const row = first.find((r) => r.kind === "step");
    assert.ok(row && row.kind === "step");
    assert.notEqual(row.action, row.sentence.text, `${st.id}: two equal lines`);
  }
});
