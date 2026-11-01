// What an automation tells the Gate after a press (chat design, hole 1): its outward steps, what each names, and what this save wrote. Saves by anyone go through, so the Gate can clear what an agent's edit voided.
import test from "node:test";
import assert from "node:assert/strict";
import { definitionHash } from "../../../lib/grants.ts";
import { outwardSteps } from "../grants.ts";
import type { Definition } from "../projections.ts";

const mail = { id: "letter", key: "send_email", input: { to: ["Lee <lee@acme.test>"], subject: "Hi" } };
const computed = { id: "reply", key: "send_email", input: { to: ["{{ trigger.email }}"], subject: "Hi" } };
const http = (method: string) => ({ id: "h", key: "http_request", input: { method, url: "https://api.acme.test/v1?x=1" } });
const code = (hosts: string[]) => ({ id: "c", key: "code", input: { source: "x", hosts } });
const def = (...nodes: unknown[]): Definition => ({ triggers: [{ key: "manual" }], nodes } as unknown as Definition);

test("the outward steps, each with its act and what it names", () => {
  assert.deepEqual(outwardSteps(def(mail)), [{ stepId: "letter", act: "send", targets: ["lee@acme.test"], computed: false, changed: true }]);
  assert.deepEqual(outwardSteps(def(computed))[0], { stepId: "reply", act: "send", targets: [], computed: true, changed: true });
  assert.deepEqual(outwardSteps(def(http("POST")))[0]!.targets, ["api.acme.test"]);
  assert.deepEqual(outwardSteps(def({ id: "n", key: "if", input: {} })), [], "a step that stays here is not one");
});

test("a read and a draft are not outward; a code step that names hosts is", () => {
  assert.deepEqual(outwardSteps(def(http("GET"))), []);
  assert.deepEqual(outwardSteps(def({ ...mail, input: { ...mail.input, draftOnly: true } })), []);
  assert.deepEqual(outwardSteps(def(code([]))), []);
  assert.deepEqual(outwardSteps(def(code(["api.acme.test"])))[0], { stepId: "c", act: "send", targets: ["api.acme.test"], computed: false, changed: true });
});

test("a save says which steps it wrote: moving a step is not writing it", () => {
  const before = def(mail, computed);
  const after = def({ ...mail, next: ["reply"] }, { ...computed, input: { ...computed.input, subject: "Changed" } });
  assert.deepEqual(outwardSteps(after, before).map((s) => [s.stepId, s.changed]), [["letter", false], ["reply", true]]);
});

test("the hash changes with any edit and not with key order", async () => {
  assert.equal(await definitionHash({ a: 1, b: 2 }), await definitionHash({ b: 2, a: 1 }));
  assert.notEqual(await definitionHash(def(mail)), await definitionHash(def({ ...mail, input: { ...mail.input, subject: "Hi." } })));
});
