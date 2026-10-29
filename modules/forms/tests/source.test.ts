// The author's own HTML and JavaScript on a form: saved with the design, read back as written, refused with the reason when outside the grammar, and left alone by Build (which edits only the fields).
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/world.ts";
import { run } from "../fixtures/seed.ts";

const refused = async (p: Promise<unknown>): Promise<string> => { try { await p; } catch (e) { return (e as { error?: { message?: string } }).error?.message ?? String(e); } throw new Error("expected a refusal"); };

async function form() {
  const h = harness();
  const made = await run(h.ctx, "forms.create", { name: "Source fixture", recordType: "contact", kind: "public" });
  const formId = made.form.formId as string;
  await run(h.ctx, "forms.fields_set", { formId, fields: [{ field: "email", mode: "ask" }, { field: "name", mode: "ask" }, { field: "phone", mode: "hide", prefillKey: "p" }] });
  return { h, formId };
}
const HTML = '<h1>Hello</h1>\n<vyre-field name="email"></vyre-field>\n<p>We reply within a day.</p>\n<vyre-field name="name"></vyre-field>\n';

test("html, css and js are saved together, read back exactly as written, and cleared by an empty value", async () => {
  const { h, formId } = await form();
  await run(h.ctx, "forms.design_set", { formId, html: HTML, css: ".x{color:red}", js: "document.title = 'Hi';" });
  const got = await run(h.ctx, "forms.get", { formId });
  assert.deepEqual([got.html, got.css, got.js], [HTML, ".x{color:red}", "document.title = 'Hi';"]);
  await run(h.ctx, "forms.design_set", { formId, html: "", js: "" });
  const cleared = await run(h.ctx, "forms.get", { formId });
  assert.deepEqual([cleared.html, cleared.js, cleared.css], [undefined, undefined, ".x{color:red}"], "clearing one source leaves the others");
});

test("a source outside the grammar is refused with the line and the reason, and nothing is saved", async () => {
  const { h, formId } = await form();
  await run(h.ctx, "forms.design_set", { formId, html: HTML });
  for (const [html, why] of [['<script>x()</script>', /<script> is not allowed/], ['<p onclick="x()">a</p>', /onclick/], ['<a href="javascript:x()">a</a>', /href must be/], ['<input name="x">', /<input> is not allowed/], ['<p>open', /never closed/]] as [string, RegExp][]) {
    assert.match(await refused(run(h.ctx, "forms.design_set", { formId, html })), why);
  }
  assert.match(await refused(run(h.ctx, "forms.design_set", { formId, html: "<p>x</p>\n<script>" })), /line 2/);
  assert.match(await refused(run(h.ctx, "forms.design_set", { formId, js: "a</script><script>b" })), /may not contain <\/script/);
  assert.equal((await run(h.ctx, "forms.get", { formId })).html, HTML, "a refused save changes nothing");
});

test("a placed field must be a question of this form: an unknown or hidden field is refused", async () => {
  const { h, formId } = await form();
  assert.match(await refused(run(h.ctx, "forms.design_set", { formId, html: '<vyre-field name="company"></vyre-field>' })), /company is not a question on this form/);
  assert.match(await refused(run(h.ctx, "forms.design_set", { formId, html: '<vyre-field name="phone"></vyre-field>' })), /phone is not a question/);
});

test("custom HTML puts every question on one page, so a multi-step form is refused until it is one step", async () => {
  const { h, formId } = await form();
  await run(h.ctx, "forms.fields_set", { formId, fields: [{ field: "email", mode: "ask", step: 0 }, { field: "name", mode: "ask", step: 1 }] });
  assert.match(await refused(run(h.ctx, "forms.design_set", { formId, html: HTML })), /one page/);
  await run(h.ctx, "forms.fields_set", { formId, fields: [{ field: "email", mode: "ask", step: 0 }, { field: "name", mode: "ask", step: 0 }] });
  await run(h.ctx, "forms.design_set", { formId, html: HTML });
});

test("Build keeps working after the source is edited: fields change, the author's markup and script are untouched", async () => {
  const { h, formId } = await form();
  await run(h.ctx, "forms.design_set", { formId, html: HTML, js: "var kept = 1;" });
  await run(h.ctx, "forms.fields_set", { formId, fields: [{ field: "email", mode: "ask" }, { field: "name", mode: "ask" }, { field: "company", mode: "ask" }] });
  const got = await run(h.ctx, "forms.get", { formId });
  assert.deepEqual([got.html, got.js], [HTML, "var kept = 1;"]);
  assert.deepEqual(got.fields.map((f: { field: string }) => f.field).sort(), ["company", "email", "name"]);
});
