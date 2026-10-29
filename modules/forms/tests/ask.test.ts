// Ask Vyre on a form's source: the agent's proposal is held to the rules of a save and comes back as a per-field diff; nothing is saved by asking.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/world.ts";
import { run } from "../fixtures/seed.ts";
import { configureFormsAsk } from "../handlers/ask.ts";

const refused = async (p: Promise<unknown>): Promise<{ code: string; message: string }> => { try { await p; } catch (e) { const x = (e as { error?: { code?: string; message?: string } }).error; return { code: x?.code ?? "", message: x?.message ?? "" }; } throw new Error("expected a refusal"); };

async function form() {
  const h = harness();
  const made = await run(h.ctx, "forms.create", { name: "Ask fixture", recordType: "contact", kind: "public" });
  const formId = made.form.formId as string;
  await run(h.ctx, "forms.fields_set", { formId, fields: [{ field: "email", mode: "ask" }, { field: "name", mode: "ask" }] });
  await run(h.ctx, "forms.design_set", { formId, html: '<vyre-field name="email"></vyre-field>', css: ".a{color:red}" });
  return { h, formId };
}
const driver = (answer: Record<string, unknown>) => {
  const seen: { doc: Record<string, unknown>; principal: { kind: string; id: string }; actingFor?: string | undefined; agentId: string | null; instruction: string }[] = [];
  return { seen, ask: { async propose(req: { doc: Record<string, unknown>; principal: { kind: string; id: string }; actingFor?: string | undefined; agentId: string | null; instruction: string }) { seen.push(req); return answer; }, cancel: (asker: string, formId: string) => (asker === "usr_owner" && formId.length > 0 ? 1 : 0) } };
};

test("no driver means no Ask, and the refusal says what to do", async () => {
  const { h, formId } = await form();
  configureFormsAsk(null);
  const r = await refused(run(h.ctx, "forms.ask_diff", { formId, instruction: "x" }));
  assert.equal(r.code, "validation.precondition_failed"); assert.match(r.message, /Open Settings/);
});

test("the agent is told the current source and the asked questions; its proposal comes back as a per-field diff and nothing is saved", async () => {
  const { h, formId } = await form();
  const d = driver({ html: '<h1>Hello</h1>\n<vyre-field name="email"></vyre-field>\n<vyre-field name="name"></vyre-field>', css: ".a{color:red}", js: "var x = 1;" });
  configureFormsAsk({ ask: d.ask });
  try {
    const out = await run(h.ctx, "forms.ask_diff", { formId, instruction: "Add a heading and place the name", agentId: "agt_a" });
    assert.deepEqual(out.changes.map((c: { path: string }) => c.path), ["/html", "/js"], "an unchanged css is not a change");
    assert.deepEqual(out.changes[0], { path: "/html", before: '<vyre-field name="email"></vyre-field>', after: '<h1>Hello</h1>\n<vyre-field name="email"></vyre-field>\n<vyre-field name="name"></vyre-field>' });
    assert.deepEqual(out.changes[1], { path: "/js", before: "", after: "var x = 1;" });
    const got = d.seen[0]!;
    assert.equal(got.instruction, "Add a heading and place the name"); assert.equal(got.agentId, "agt_a");
    assert.deepEqual([got.doc["html"], got.doc["css"], got.doc["js"]], ['<vyre-field name="email"></vyre-field>', ".a{color:red}", ""]);
    assert.deepEqual((got.doc["questions"] as { key: string }[]).map((q) => q.key).sort(), ["email", "name"]);
    assert.deepEqual([got.principal.kind, got.principal.id], ["person", "usr_owner"], "the exact principal, never rewritten");
    const saved = await run(h.ctx, "forms.get", { formId });
    assert.deepEqual([saved.html, saved.js], ['<vyre-field name="email"></vyre-field>', undefined], "asking saves nothing");
  } finally { configureFormsAsk(null); }
});

test("a proposal outside the rules of a save is refused as the agent's, with the reason", async () => {
  const { h, formId } = await form();
  for (const [answer, why] of [
    [{ html: "<script>alert(1)</script>" }, /The agent's HTML is not valid: line 1: <script> is not allowed/],
    [{ html: '<vyre-field name="company"></vyre-field>' }, /company is not a question on this form/],
    [{ js: "a</script><script>b" }, /The agent's JavaScript is not valid/],
    [{ css: "@import url(x)" }, /may not load other files/],
    [{ html: 5 }, /was not text/],
    [{ secret: "x" }, /not part of the form's source/],
  ] as [Record<string, unknown>, RegExp][]) {
    configureFormsAsk({ ask: driver(answer).ask });
    const r = await refused(run(h.ctx, "forms.ask_diff", { formId, instruction: "x" }));
    assert.equal(r.code, "validation.bad_input"); assert.match(r.message, why);
  }
  configureFormsAsk(null);
});

test("an agent's driver error keeps its code; anything else is said plainly; cancel reaches only the caller's own Asks", async () => {
  const { h, formId } = await form();
  configureFormsAsk({ ask: { async propose() { throw Object.assign(new Error("The provider rejected the key."), { code: "provider.auth_failed" }); } } });
  assert.deepEqual(await refused(run(h.ctx, "forms.ask_diff", { formId, instruction: "x" })), { code: "provider.auth_failed", message: "The provider rejected the key." });
  configureFormsAsk({ ask: { async propose() { throw new Error("secret stack detail"); } } });
  const plain = await refused(run(h.ctx, "forms.ask_diff", { formId, instruction: "x" }));
  assert.equal(plain.code, "internal.unexpected"); assert.doesNotMatch(plain.message, /secret stack/);
  configureFormsAsk({ ask: driver({}).ask });
  assert.deepEqual(await run(h.ctx, "forms.ask_cancel", { formId }), { cancelled: 1 });
  configureFormsAsk(null);
  assert.deepEqual(await run(h.ctx, "forms.ask_cancel", { formId }), { cancelled: 0 });
});
