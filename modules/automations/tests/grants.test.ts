// What an automation tells the Gate after a press (chat design, hole 1): its outward steps, what each names, and what this save wrote. Saves by anyone go through, so the Gate can clear what an agent's edit voided.
import test from "node:test";
import assert from "node:assert/strict";
import { definitionHash } from "../../../lib/grants.ts";
import { outwardSteps, sendersOf, shareSenders } from "../grants.ts";
import type { Automation, AutoCtx, Definition } from "../projections.ts";

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

// ---- what a send step sends from

const box = (id: string, mailboxId: string) => ({ id, key: "send_email", input: { to: ["a@b.test"], subject: "Hi", mailboxId } });
const text = { id: "t", key: "send_sms", input: { numberId: "num_main", to: "+14155550100", body: "Hi" } };
function press(kind: string) {
  const calls: { cap: string; input: { give: { id: string }[]; keep: { id: string }[] } }[] = [];
  const ctx = { principal: { kind, id: kind === "person" ? "usr_a" : "agt_a" }, call: async (cap: string, input: never) => { calls.push({ cap, input }); return {}; } } as unknown as AutoCtx;
  return { ctx, calls };
}
const auto = (kind: string, d: Definition): Automation => ({ id: "aut_flow", kind, definition: d } as unknown as Automation);

test("a definition names its senders: a draft and a template name none", () => {
  assert.deepEqual(sendersOf(def(box("a", "mbx_one"), text)).map((s) => s.resource), [{ type: "mailbox", id: "mbx_one" }, { type: "number", id: "num_main" }]);
  assert.deepEqual(sendersOf(def({ ...box("a", "mbx_one"), input: { draftOnly: true, mailboxId: "mbx_one" } }, box("b", "{{ trigger.box }}"))), []);
});

test("a person's Turn on gives every sender; their save gives only the step they wrote", async () => {
  const before = def(box("a", "mbx_old"));
  const after = def(box("a", "mbx_old"), box("b", "mbx_new"));
  const on = press("person");
  await shareSenders(on.ctx, auto("space", after), "on");
  assert.deepEqual(on.calls[0]!.input.give.map((r) => r.id), ["mbx_old", "mbx_new"]);
  const save = press("person");
  await shareSenders(save.ctx, auto("space", after), "save", before);
  assert.deepEqual(save.calls[0]!.input.give.map((r) => r.id), ["mbx_new"]);
  assert.deepEqual(save.calls[0]!.input.keep.map((r) => r.id), ["mbx_old", "mbx_new"], "what an earlier press gave stays");
});

test("an agent's press gives nothing, and a Personal Automation has no service to give to", async () => {
  const agent = press("agent");
  await shareSenders(agent.ctx, auto("space", def(box("a", "mbx_one"))), "on");
  assert.equal(agent.calls.length, 0);
  const mine = press("person");
  await shareSenders(mine.ctx, auto("personal", def(box("a", "mbx_one"))), "on");
  assert.equal(mine.calls.length, 0);
});
