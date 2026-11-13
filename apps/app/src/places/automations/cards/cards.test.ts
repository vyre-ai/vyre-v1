import test from "node:test";
import assert from "node:assert/strict";
import {
  allowCard,
  askAdminCard,
  credentialView,
  credentialStep,
  formChoiceCard,
  mappingCard,
  nextNeed,
  testLeadCard,
  trailView,
  understoodCard,
  waitingCard,
  type Credential,
} from "./model.ts";

const wp = { id: "wordpress", name: "WordPress" };
const hub = { id: "hubspot", name: "HubSpot" };
const slack = { id: "slack", name: "Slack" };

test("the trail groups ticked lines by app, in the order the apps first appear, with Vyre's own lines first", () => {
  const t = trailView([
    { app: slack, text: "Read Slack's documentation", state: "done" },
    { app: hub, text: "Finding how HubSpot connects", state: "doing" },
    { app: slack, text: "Slack needs a token", state: "done" },
    { app: null, text: "Your WordPress site is northwind.example", state: "done" },
  ]);
  assert.deepEqual(
    t.map((g) => [g.app?.name ?? null, g.lines.map((l) => [l.text, l.state])]),
    [
      [null, [["Your WordPress site is northwind.example", "done"]]],
      [
        "Slack",
        [
          ["Read Slack's documentation", "done"],
          ["Slack needs a token", "done"],
        ],
      ],
      ["HubSpot", [["Finding how HubSpot connects", "doing"]]],
    ],
  );
});

test("I understood N things: one line for the trigger, one per action in the order said, short names shown in full, an unclear one kept and counted", () => {
  const c = understoodCard({
    trigger: { app: wp, text: "A form is submitted", typed: "wp", how: "alias" },
    clauses: [
      { order: 1, kind: "action", text: "Send you a Slack message", app: slack },
      { order: 2, kind: "action", text: "Post in #vyre", app: null },
      { order: 3, kind: "unclear", text: "sort it all out", app: null },
    ],
  });
  assert.equal(c.title, "I understood 3 things. Is that right?");
  assert.deepEqual(c.trigger, { app: wp, text: "When a form is submitted on WordPress (you wrote wp)" });
  assert.deepEqual(
    c.items.map((i) => [i.n, i.text, i.notSure]),
    [
      [1, "Send you a Slack message", false],
      [2, "Post in #vyre", false],
      [3, "Not sure: sort it all out", true],
    ],
  );
  assert.deepEqual(c.actions, ["Yes, that is it", "Change something"]);
  assert.equal(
    understoodCard({
      trigger: { app: wp, text: "A form is submitted" },
      clauses: [{ order: 1, kind: "action", text: "Add a row", app: null }],
    }).title,
    "I understood 1 thing. Is that right?",
  );
});

test("a sentence with more than six actions, or two triggers, offers two Automations and never one long chain", () => {
  const many = Array.from({ length: 7 }, (_, i) => ({
    order: i + 1,
    kind: "action" as const,
    text: `Do ${i + 1}`,
    app: null,
  }));
  const c = understoodCard({ trigger: { app: wp, text: "A form is submitted" }, clauses: many });
  assert.equal(c.split?.title, "This is two promises. Split it?");
  assert.deepEqual([c.split?.first.length, c.split?.second.length], [4, 3]);
  assert.deepEqual(c.actions, ["Yes, that is it", "Change something"]);
});

test("Is this the one?: forms found on the site, or the plugin question with I do not know as an honest choice", () => {
  const found = formChoiceCard({
    site: "northwind.example",
    forms: [
      { id: "f1", name: "Contact", where: "/contact", madeWith: "WPForms" },
      { id: "f2", name: "Newsletter", where: "in the footer", madeWith: "WPForms" },
    ],
    plugins: [],
  });
  assert.equal(found.title, "I found 2 forms on northwind.example. Is this the one?");
  assert.deepEqual(
    found.choices.map((c) => [c.id, c.line]),
    [
      ["f1", "/contact, made with WPForms"],
      ["f2", "in the footer, made with WPForms"],
    ],
  );
  assert.deepEqual(found.actions, ["Neither"]);
  assert.equal(
    formChoiceCard({
      site: "northwind.example",
      forms: [{ id: "f1", name: "Contact", where: "/contact", madeWith: "WPForms" }],
      plugins: [],
    }).title,
    "I found 1 form on northwind.example. Is this the one?",
  );
  const none = formChoiceCard({ site: "northwind.example", forms: [], plugins: ["WPForms", "Gravity Forms"] });
  assert.equal(none.title, "Which plugin sends your form?");
  assert.deepEqual(
    none.choices.map((c) => c.id),
    ["WPForms", "Gravity Forms", ""],
  );
  assert.equal(none.choices.at(-1)!.label, "I do not know");
});

const cred = (o: Partial<Credential> = {}): Credential => ({
  app: hub,
  mode: "key",
  field: "Private app token",
  guide: {
    steps: ["Open Settings.", "Open Private apps.", "Copy the token."],
    source: "HubSpot's documentation, read 13 Nov 2026",
  },
  frame: "chat",
  ...o,
});

test("the credential card names where the value goes and who can use it, and says it is never typed into the chat", () => {
  const v = credentialView(cred(), { value: "", how: false, stuck: 0, saved: false, refused: false, closing: false });
  assert.equal(v.title, "Paste your HubSpot Private app token");
  assert.equal(
    v.savedLine,
    "Saved to your Vault as “HubSpot”, never typed into the chat. Only you and this Automation can use it.",
  );
  assert.equal(
    credentialView(cred({ frame: "sheet" }), {
      value: "",
      how: false,
      stuck: 0,
      saved: false,
      refused: false,
      closing: false,
    }).savedLine,
    "Saved to your Vault as “HubSpot”. Only you can use it.",
  );
  assert.deepEqual(v.actions, ["Save", "Show me how", "I am stuck"]);
  assert.equal(v.saveEnabled, false);
});

test("Show me how shows steps only when they were read from the app's documentation, with their source; until then it says it is finding them", () => {
  const read = credentialView(cred(), { value: "", how: true, stuck: 0, saved: false, refused: false, closing: false });
  assert.deepEqual(read.how, {
    steps: ["Open Settings.", "Open Private apps.", "Copy the token."],
    source: "Written from HubSpot's documentation, read 13 Nov 2026. Kept for your Space with its date and source.",
  });
  const unread = credentialView(cred({ guide: null }), {
    value: "",
    how: true,
    stuck: 0,
    saved: false,
    refused: false,
    closing: false,
  });
  assert.deepEqual(unread.how, { finding: "Finding how to connect HubSpot" });
  assert.equal(JSON.stringify(unread).includes("Settings"), false);
});

test("typing enables Save; the value lives in the card until it is saved; closing with something typed asks Keep what you typed", () => {
  let s = credentialStep(
    cred(),
    { value: "", how: false, stuck: 0, saved: false, refused: false, closing: false },
    { type: "input", value: "abc" },
  );
  assert.equal(credentialView(cred(), s.state).saveEnabled, true);
  s = credentialStep(cred(), s.state, { type: "close" });
  assert.equal(s.state.closing, true);
  assert.equal(credentialView(cred(), s.state).confirmClose, "Keep what you typed?");
  const keep = credentialStep(cred(), s.state, { type: "keep" });
  assert.deepEqual([keep.state.value, keep.state.closing, keep.effect], ["abc", false, null]);
  const discard = credentialStep(cred(), s.state, { type: "discard" });
  assert.deepEqual([discard.state.value, discard.effect], ["", { kind: "close" }]);
  const empty = credentialStep(
    cred(),
    { value: "", how: false, stuck: 0, saved: false, refused: false, closing: false },
    { type: "close" },
  );
  assert.deepEqual([empty.state.closing, empty.effect], [false, { kind: "close" }]);
});

test("Save sends the value to the Vault port only; a refused key reopens the card empty with one plain line and nothing stored", () => {
  const s0 = { value: "tok", how: false, stuck: 0 as const, saved: false, refused: false, closing: false };
  const save = credentialStep(cred(), s0, { type: "save" });
  assert.deepEqual(save.effect, { kind: "save", value: "tok" });
  const refused = credentialStep(cred(), save.state, { type: "refused" });
  assert.deepEqual([refused.state.value, refused.state.refused], ["", true]);
  assert.equal(credentialView(cred(), refused.state).refusedLine, "HubSpot did not accept that token.");
  const ok = credentialStep(cred(), save.state, { type: "saved" });
  assert.equal(
    credentialView(cred(), ok.state).doneLine,
    "Saved to your Vault as “HubSpot”, never typed into the chat. Only you and this Automation can use it.",
  );
  assert.equal(credentialView(cred(), ok.state).title, null);
});

test("I am stuck offers to look or to use the assistant's own browser, then waits while he signs in himself, then says what to do", () => {
  const base = { value: "", how: false, stuck: 0 as const, saved: false, refused: false, closing: false };
  let s = credentialStep(cred(), base, { type: "stuck" }).state;
  assert.deepEqual(credentialView(cred(), s).stuck, {
    title: "I can look at the page with you, or do it in my own browser.",
    note: "You sign in yourself. I never see the password.",
    action: "Use my browser",
  });
  s = credentialStep(cred(), s, { type: "browser" }).state;
  assert.deepEqual(credentialView(cred(), s).stuck, {
    title: "HubSpot asks you to sign in, in my browser.",
    note: "Type your password there. I never see it. I wait.",
    action: "I am signed in",
  });
  s = credentialStep(cred(), s, { type: "signed_in" }).state;
  assert.deepEqual(credentialView(cred(), s).stuck, {
    done: "I opened the page for the key. Create it, copy it and paste it above.",
  });
});

test("an app that signs in has no field: Sign in with the app", () => {
  const v = credentialView(cred({ mode: "signin", field: "" }), {
    value: "",
    how: false,
    stuck: 0,
    saved: false,
    refused: false,
    closing: false,
  });
  assert.equal(v.title, "Sign in to HubSpot");
  assert.deepEqual(v.actions, ["Sign in with HubSpot"]);
  assert.equal(v.field, null);
});

test("mapping: what matched, and for what did not, one orange line with its choices", () => {
  const m = mappingCard({
    app: hub,
    noun: "lead",
    pairs: [
      ["Name", "Name"],
      ["Email", "Email"],
    ],
    unmatched: {
      field: "Preferred time",
      choices: [
        { id: "notes", label: "Put it in Notes" },
        { id: "skip", label: "Leave it out" },
      ],
    },
  });
  assert.equal(m.title, "How the form fills the lead in HubSpot");
  assert.equal(m.line, "Nothing in HubSpot takes “Preferred time”.");
  assert.deepEqual(m.actions, ["Put it in Notes", "Leave it out"]);
  assert.equal(mappingCard({ app: hub, noun: "lead", pairs: [["Name", "Name"]], unmatched: null }).line, null);
});

test("waiting: the address to paste, one reminder after 24 hours, Check now", () => {
  const w = waitingCard({ app: wp, url: "https://x.example/hook/abc", remindAfterHours: 24 });
  assert.deepEqual(
    [w.title, w.note, w.actions],
    ["Waiting for the first real submission", "I remind you once after 24 hours.", ["Check now"]],
  );
  assert.equal(w.url, "https://x.example/hook/abc");
});

test("a test lead is its own card, marked as a write, naming what it creates and that it is removed; it never happens without his tap", () => {
  const c = testLeadCard({ app: hub, noun: "lead", testName: "Vyre test", where: "HubSpot" });
  assert.equal(c.title, "Try it with a test lead?");
  assert.equal(
    c.line,
    "This writes one lead called “Vyre test” in HubSpot, then removes it. The other steps send nothing.",
  );
  assert.deepEqual(c.actions, ["Create, then remove", "Skip"]);
  assert.equal(c.write, true);
});

test("the Allow card is one tap; the Ask-admin card names the person and why", () => {
  assert.deepEqual(allowCard({ app: "Google Workspace", item: "Google Workspace", ctx: "build" }), {
    title: "Let Assistant use Google Workspace for this Automation?",
    line: "The draft uses your Google Workspace item from Vault. It works only inside this Automation.",
    actions: ["Allow", "Not now"],
  });
  assert.equal(
    allowCard({ app: "Notely", item: "Notely API key", ctx: "setup" }).title,
    "Let Assistant use Notely API key to set this up?",
  );
  const a = askAdminCard({ app: "Microsoft 365", admin: "Dana Whitfield" });
  assert.deepEqual([a.title, a.actions], ["Ask Dana Whitfield to allow Microsoft 365?", ["Ask Dana Whitfield"]]);
});

test("one Needs you at a time, in the order it will ask; he leaves midway and the same line is waiting where he stopped", () => {
  const needs = [
    { id: "n1", stage: 3, text: "Needs your Slack token", app: slack },
    { id: "n2", stage: 5, text: "Needs your HubSpot key", app: hub },
    { id: "n0", stage: 1, text: "Which form is it?", app: wp },
  ];
  assert.equal(nextNeed(needs)?.id, "n0");
  assert.equal(nextNeed(needs.filter((n) => n.id !== "n0"))?.id, "n1");
  assert.equal(nextNeed([]), null);
});
