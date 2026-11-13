// The sentence a person types in Automations ("when a form is submitted on my wordpress website, create a lead in Lawmatics") split into its trigger and its action clauses, in order, with each app named
// in full beside what was typed. A pure function the Assistant's skill and the screens share: it gives the skeleton, the model fills what each app can do. Invented people and firms only.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSentence, type Exists } from "../app-sentence.ts";

const none: Exists = () => false;
const spaceHas =
  (...pairs: Array<[string, string]>): Exists =>
  (kind, name) =>
    pairs.some(([k, n]) => k === kind && n.toLowerCase() === name.toLowerCase());

// the owner's first sentence, word for word
const S1 = "When a form is submitted on my wordpress website, it should create a new lead in Lawmatics";
// the owner's second sentence, word for word
const S2 =
  "when a wp form is submitted, send me a slack message and post in #vyre channel here for the team and submit that lead in Hubspot";

test("test 1: the first sentence gives the trigger and one action, and both apps are found, lower-case and unknown", () => {
  const r = parseSentence(S1, none);
  assert.equal(r.trigger.text, "a form is submitted on my wordpress website");
  assert.deepEqual(
    r.trigger.apps.map((a) => [a.name, a.typed]),
    [["WordPress", "wordpress"]],
  );
  assert.equal(r.clauses.length, 1);
  const c = r.clauses[0]!;
  assert.equal(c.order, 1);
  assert.equal(c.kind, "action");
  assert.equal(c.act, "create_record");
  assert.equal(c.object, "lead");
  // Lawmatics is in no table: it is accepted as a new app with its own name, never guessed to be another one
  assert.deepEqual(
    c.apps.map((a) => [a.name, a.typed, a.how]),
    [["Lawmatics", "Lawmatics", "new"]],
  );
  assert.deepEqual(c.questions, []);
  assert.equal(r.split, undefined);
  assert.equal(r.understood, 1);
});

test("test 15: the second sentence gives three steps in the order said, and a name inside a clause does not split it", () => {
  const r = parseSentence(S2, spaceHas(["channel", "vyre"]));
  assert.equal(r.trigger.text, "a wp form is submitted");
  assert.deepEqual(
    r.clauses.map((c) => c.text),
    ["send me a slack message", "post in #vyre channel here for the team", "submit that lead in Hubspot"],
  );
  assert.deepEqual(
    r.clauses.map((c) => c.order),
    [1, 2, 3],
  );
  assert.equal(r.understood, 3);

  const [slack, vyre, hub] = r.clauses as [(typeof r.clauses)[0], (typeof r.clauses)[0], (typeof r.clauses)[0]];
  assert.equal(slack.act, "message");
  assert.equal(slack.to, "me");
  assert.deepEqual(
    slack.apps.map((a) => a.name),
    ["Slack"],
  );
  assert.equal(slack.place, undefined);

  assert.equal(vyre.act, "message");
  assert.deepEqual(vyre.apps, []);
  assert.deepEqual(vyre.place, { kind: "vyre", what: "channel", name: "vyre", exists: true });

  assert.equal(hub.act, "create_record");
  assert.equal(hub.object, "lead");
  assert.deepEqual(
    hub.apps.map((a) => [a.name, a.typed, a.how]),
    [["HubSpot", "Hubspot", "name"]],
  );

  const one = parseSentence("when a form is submitted, create a contact with a name and email in HubSpot", none);
  assert.equal(one.clauses.length, 1, "a name and email is one clause");
  assert.equal(one.clauses[0]!.text, "create a contact with a name and email in HubSpot");
  const two = parseSentence("when a form is submitted, save a name and an email in HubSpot", none);
  assert.equal(two.clauses.length, 1);
});

test("the trigger ends at the first comma or at 'then'", () => {
  const a = parseSentence("when a payment fails then email billing", none);
  assert.equal(a.trigger.text, "a payment fails");
  assert.equal(a.clauses.length, 1);
  assert.equal(a.clauses[0]!.act, "email");
  const b = parseSentence("whenever a task is done, send me a text, then close the ticket in Zendesk", none);
  assert.equal(b.trigger.text, "a task is done");
  assert.deepEqual(
    b.clauses.map((c) => c.text),
    ["send me a text", "close the ticket in Zendesk"],
  );
});

test("test 16: a Vyre channel needs no app; a missing channel is one question on that step", () => {
  const present = parseSentence("when a form is submitted, post in #ops here", spaceHas(["channel", "ops"]));
  assert.deepEqual(present.clauses[0]!.place, { kind: "vyre", what: "channel", name: "ops", exists: true });
  assert.deepEqual(present.clauses[0]!.apps, []);
  assert.deepEqual(present.clauses[0]!.questions, []);

  const missing = parseSentence("when a form is submitted, post in #sales here", none);
  const q = missing.clauses[0]!.questions;
  assert.equal(missing.clauses[0]!.place?.exists, false);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.id, "no_such_channel");
  assert.equal(q[0]!.text, "There is no #sales channel.");

  // "here" and "in Vyre" and "the team's channel" are this Space, with no app named
  for (const s of ["tell the team here", "post in Vyre", "message the team channel"]) {
    const r = parseSentence(`when a form is submitted, ${s}`, none);
    assert.equal(r.clauses[0]!.place?.kind, "vyre", s);
    assert.deepEqual(r.clauses[0]!.apps, [], s);
  }
  // a person, a table, a task that exists in the Space
  const person = parseSentence(
    "when a form is submitted, message Dana Whitfield here",
    spaceHas(["person", "Dana Whitfield"]),
  );
  assert.equal(person.clauses[0]!.place?.what, "person");
  const table = parseSentence("when a form is submitted, add a row to the Leads table", spaceHas(["table", "Leads"]));
  assert.equal(table.clauses[0]!.place?.what, "table");
  assert.equal(table.clauses[0]!.act, "add_row");
});

test("a name that exists in Vyre and in an outside app the clause also names is asked once, with both as choices", () => {
  const r = parseSentence("when a form is submitted, post in #vyre in Slack", spaceHas(["channel", "vyre"]));
  const q = r.clauses[0]!.questions;
  assert.equal(q.length, 1);
  assert.equal(q[0]!.id, "vyre_or_outside");
  assert.deepEqual(q[0]!.choices, ["Vyre", "Slack"]);
});

test("test 17: an unclear clause is kept as a step with one question and is counted", () => {
  const r = parseSentence("when a wp form is submitted, send me a slack message and sort it all out", none);
  assert.equal(r.clauses.length, 2);
  const c = r.clauses[1]!;
  assert.equal(c.kind, "unclear");
  assert.equal(c.text, "sort it all out");
  assert.equal(c.order, 2);
  assert.deepEqual(c.questions, [{ id: "say_again", text: "I did not understand this one." }]);
  assert.equal(r.understood, 2, "the unclear clause is in the count");
  assert.equal(r.unclear, 1);
});

test("test 18: an abbreviation is shown in full with what was typed; an unknown short name is asked, not guessed", () => {
  const r = parseSentence("when a wp form is submitted, add a row to gsheets", none);
  assert.deepEqual(
    r.trigger.apps.map((a) => [a.name, a.typed, a.how]),
    [["WordPress", "wp", "alias"]],
  );
  assert.deepEqual(
    r.clauses[0]!.apps.map((a) => [a.name, a.typed, a.how]),
    [["Google Sheets", "gsheets", "alias"]],
  );

  const ask = parseSentence("when a form is submitted, add a contact in ghl", none);
  const a = ask.clauses[0]!.apps[0]!;
  assert.equal(a.typed, "ghl");
  assert.equal(a.how, "ask");
  assert.equal(a.name, "ghl", "no guess is put in its place");
  assert.equal(ask.clauses[0]!.questions[0]!.id, "which_app");
  assert.match(ask.clauses[0]!.questions[0]!.text, /ghl/);
});

test("near-miss spellings are recognised: edit distance 1, or 2 on a long name", () => {
  const r = parseSentence("when a form is submitted, post in slck and add a contact in Hubspott", none);
  assert.deepEqual(
    r.clauses.map((c) => c.apps.map((a) => [a.name, a.typed, a.how])),
    [[["Slack", "slck", "near"]], [["HubSpot", "Hubspott", "near"]]],
  );
  const long = parseSentence("when a form is submitted, add a row to Google Shets", none);
  assert.equal(long.clauses[0]!.apps[0]!.name, "Google Sheets");
  // a plain word that is one letter from an app is not an app unless it sits where an app name does
  const plain = parseSentence("when a form is submitted, strip the spaces from the name", none);
  assert.deepEqual(plain.clauses[0]!.apps, []);
});

test("an address or a channel is never taken for an app", () => {
  const r = parseSentence(
    "when a form is submitted on northwind.example, post in #general here",
    spaceHas(["channel", "general"]),
  );
  assert.deepEqual(r.trigger.apps, []);
  assert.deepEqual(r.clauses[0]!.apps, []);
});

test("test 21: more than six actions, or two triggers, propose two Automations with the clauses divided", () => {
  const many = parseSentence(
    "when a form is submitted, send me a text, post in #a here, post in #b here, post in #c here, post in #d here, post in #e here, post in #f here",
    spaceHas(
      ["channel", "a"],
      ["channel", "b"],
      ["channel", "c"],
      ["channel", "d"],
      ["channel", "e"],
      ["channel", "f"],
    ),
  );
  assert.equal(many.clauses.length, 7);
  assert.equal(many.split?.reason, "too_many");
  assert.equal(many.split?.parts.length, 2);
  assert.deepEqual(
    many.split?.parts.flatMap((p) => p.clauses.map((c) => c.order)),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.ok(many.split!.parts.every((p) => p.clauses.length <= 6));
  assert.ok(many.split!.parts.every((p) => p.trigger === "a form is submitted"));

  const six = parseSentence(
    "when a form is submitted, post in #a here, post in #b here, post in #c here, post in #d here, post in #e here, post in #f here",
    spaceHas(
      ["channel", "a"],
      ["channel", "b"],
      ["channel", "c"],
      ["channel", "d"],
      ["channel", "e"],
      ["channel", "f"],
    ),
  );
  assert.equal(six.split, undefined, "six is the cap, not over it");

  const two = parseSentence(
    "when a form is submitted, send me a slack message, and when a payment fails, email billing",
    none,
  );
  assert.equal(two.split?.reason, "two_triggers");
  assert.deepEqual(
    two.split?.parts.map((p) => [p.trigger, p.clauses.map((c) => c.text)]),
    [
      ["a form is submitted", ["send me a slack message"]],
      ["a payment fails", ["email billing"]],
    ],
  );
});

test("a sentence with no trigger is asked, not guessed; an empty one has nothing", () => {
  const r = parseSentence("send me a slack message", none);
  assert.equal(r.trigger.text, "");
  assert.deepEqual(r.trigger.questions, [{ id: "no_trigger", text: "When should this run?" }]);
  assert.equal(r.clauses.length, 1);
  const e = parseSentence("   ", none);
  assert.deepEqual(e.clauses, []);
  assert.equal(e.understood, 0);
});

test("it is pure: the same sentence and the same answers give the same skeleton", () => {
  assert.deepEqual(parseSentence(S2, spaceHas(["channel", "vyre"])), parseSentence(S2, spaceHas(["channel", "vyre"])));
});
