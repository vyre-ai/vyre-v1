import test from "node:test";
import assert from "node:assert/strict";
import { connectLine, credentialProblem, splitNumbers, toggled, whoLabel } from "./telephony-model.ts";

const SID = "AC" + "0123456789abcdef".repeat(2);

test("what was typed is checked before anything leaves the page", () => {
  assert.match(credentialProblem("nope", "t"), /Account SID/);
  assert.match(credentialProblem(SID, "  "), /Auth Token/);
  assert.equal(credentialProblem(` ${SID} `, "token"), "");
});

test("the line after Connect is plain: the server's words on a refusal, the count on a pass, and any number Twilio refused", () => {
  assert.equal(connectLine({ connected: false, detail: "Twilio did not accept the credentials.", imported: 0, total: 0, notSetUp: 0 }), "Twilio did not accept the credentials.");
  assert.equal(connectLine({ connected: true, imported: 5, total: 5, notSetUp: 0 }), "5 numbers brought in.");
  assert.equal(connectLine({ connected: true, imported: 1, total: 1, notSetUp: 0 }), "1 number brought in.");
  assert.match(connectLine({ connected: true, imported: 2, total: 2, notSetUp: 1 }), /1 could not be set up/);
});

test("a number with nobody on it needs an owner", () => {
  const a = { id: "1", assignees: [] }, b = { id: "2", assignees: [{ kind: "person" as const, id: "usr_1" }] };
  assert.deepEqual(splitNumbers([a, b]), { open: [a], held: [b] });
});

test("the assign control names who is on the number, and adds or takes off one person", () => {
  const maya = { kind: "person" as const, id: "usr_1" }, omar = { kind: "person" as const, id: "usr_2" };
  const names = (a: { id: string }): string => (a.id === "usr_1" ? "Maya Chen" : "Omar Haddad");
  assert.equal(whoLabel([], names), "Assign");
  assert.equal(whoLabel([maya], names), "Maya Chen");
  assert.equal(whoLabel([maya, omar], names), "Maya, Omar");
  assert.deepEqual(toggled([maya], omar), [maya, omar]);
  assert.deepEqual(toggled([maya, omar], maya), [omar]);
});
