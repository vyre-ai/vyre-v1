// The agent's last action as the desk's cursor reads it (pointer.ts): counted, with the chosen element's box only when the press is at its centre, nothing carried from one action to the next.
import test from "node:test";
import assert from "node:assert/strict";
import { createPointerNote } from "./pointer.ts";

test("nothing before the first action; each press counts once, with the tool that ran", () => {
  let t = 1000;
  const p = createPointerNote(() => ++t);
  assert.equal(p.get(), null);
  p.during("chrome_click");
  p.at(40, 50);
  assert.deepEqual(p.get(), { seq: 1, tool: "chrome_click", x: 40, y: 50, at: 1001 });
  p.during("chrome_type");
  p.at(41, 51);
  assert.equal(p.get()?.seq, 2);
  assert.equal(p.get()?.tool, "chrome_type");
});

test("a chosen element's box and name ride along when the press is at its centre, and never leak to the next action", () => {
  const p = createPointerNote(() => 5);
  p.during("chrome_act");
  p.chose({ x: 100, y: 200, w: 80, h: 40, label: "Send request" });
  p.at(140, 220);
  assert.deepEqual(p.get(), {
    seq: 1,
    tool: "chrome_act",
    x: 140,
    y: 220,
    at: 5,
    box: { x: 100, y: 200, w: 80, h: 40 },
    label: "Send request",
  });
  p.at(140, 220);
  assert.equal(p.get()?.box, undefined, "the box belonged to the first action only");
  assert.equal(p.get()?.label, undefined);
});

test("a coordinate press away from the chosen element does not borrow its box; a long name is cut to 60 characters", () => {
  const p = createPointerNote(() => 5);
  p.chose({ x: 0, y: 0, w: 10, h: 10, label: "x" });
  p.at(300, 300);
  assert.equal(p.get()?.box, undefined);
  p.chose({ x: 0, y: 0, w: 10, h: 10, label: "n".repeat(200) });
  p.at(5, 5);
  assert.equal(p.get()?.label?.length, 60);
});

import { isSecretField, labelOf } from "./pointer.ts";
import type { LabelInput } from "./pointer.ts";
const el = (o: Partial<LabelInput>): LabelInput => ({
  tag: "input",
  type: "text",
  aria: "",
  text: "",
  value: "",
  title: "",
  name: "",
  placeholder: "",
  id: "",
  autocomplete: "",
  ...o,
});

test("a password field is never named by its value, even when the page shows it as plain text; it is named by its own label", () => {
  assert.equal(labelOf(el({ type: "password", value: "hunter2-secret", aria: "Password" })), "Password");
  assert.equal(
    labelOf(el({ type: "password", value: "hunter2-secret" })),
    "",
    "no own name: no name at all, never the value",
  );
  // 'show password' turned it into a text input: the value is visible text, and still not a name
  assert.equal(
    labelOf(el({ type: "text", name: "password", value: "hunter2-secret", text: "hunter2-secret" })),
    "password",
  );
  assert.equal(
    labelOf(el({ type: "text", id: "login-pass", value: "hunter2-secret", placeholder: "Your password" })),
    "Your password",
  );
  assert.equal(
    labelOf(el({ tag: "div", name: "", text: "hunter2-secret", aria: "", id: "pwd-revealed" })).includes("hunter2"),
    false,
    "a revealed-password element is secret by its name too",
  );
});

test("a one-time code field is never named by the code, by type, autocomplete, or what it is called", () => {
  assert.equal(labelOf(el({ autocomplete: "one-time-code", value: "482913", aria: "Code" })), "Code");
  assert.equal(labelOf(el({ name: "otp", value: "482913" })), "otp");
  assert.equal(labelOf(el({ placeholder: "6-digit verification code", value: "482913" })), "6-digit verification code");
  assert.equal(labelOf(el({ id: "2fa", value: "482913", text: "482913" })).includes("482913"), false);
  for (const v of [{ type: "password" }, { autocomplete: "one-time-code" }, { name: "token" }, { id: "cvv" }])
    assert.equal(isSecretField(el(v)), true);
  assert.equal(isSecretField(el({ name: "email" })), false);
});

test("no field is ever named by what was typed or filled into it; a button's own value or text is its name; whitespace is folded and the name is cut to 120", () => {
  assert.equal(
    labelOf(el({ type: "text", name: "reference", value: "NW-20418", placeholder: "Reference number" })),
    "Reference number",
  );
  assert.equal(labelOf(el({ tag: "textarea", value: "my private note", aria: "" })), "");
  assert.equal(labelOf(el({ type: "submit", value: "Send request" })), "Send request");
  assert.equal(labelOf(el({ tag: "button", type: "submit", text: "  Send \n request " })), "Send request");
  assert.equal(labelOf(el({ tag: "select", value: "private", aria: "Category" })), "Category");
  assert.equal(labelOf(el({ tag: "a", text: "x".repeat(300) })).length, 120);
});
