import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/world.ts";
import { run } from "../fixtures/seed.ts";
import { configureForms, many, mustForm } from "../projections.ts";
import { formPrincipal } from "../handlers/submit.ts";
import type { ChoiceInfo } from "../projections.ts";
import { checkUploads, publicFormViewTyped, typedAnswers, writeAnswers } from "../handlers/submit.ts";

const schema = [
  { key: "company", title: "Company", type: "relation", required: true, options: { target: "company" } },
  { key: "owner", title: "Owner", type: "person" },
  { key: "note", title: "Note", type: "text" },
];
/** A stand-in host: acme and globex are offerable; secret is over the ceiling; gone is deleted. */
function source(over: Record<string, ChoiceInfo> = {}) {
  const known: Record<string, ChoiceInfo> = {
    rec_northwind: { ok: true, label: "Northwind" }, rec_contoso: { ok: true, label: "Contoso" },
    rec_secret: { ok: false, reason: "That record is Confidential or Restricted, so it cannot be offered on a public form." },
    rec_gone: { ok: false, reason: "You cannot see that record, or it no longer exists." },
    usr_maya: { ok: true, label: "Maya" }, ...over,
  };
  const asked: string[] = [];
  return { asked, known, src: {
    async describe(who: string, _f: unknown, refId: string): Promise<ChoiceInfo> { asked.push(`${who}:${refId}`); return known[refId] ?? { ok: false, reason: "unknown" }; },
    async candidates() { return [{ refId: "rec_northwind", label: "Northwind" }]; },
  } };
}
async function setup(over: Record<string, ChoiceInfo> = {}) {
  const h = harness(); const s = source(over);
  configureForms({ schemaFields: async () => schema, choiceSource: s.src });
  const made = await run(h.ctx, "forms.create", { name: "Intake", recordType: "contact", kind: "public" });
  const formId = made.form.formId as string;
  await run(h.ctx, "forms.fields_set", { formId, fields: [{ field: "company", mode: "ask" }, { field: "owner", mode: "ask" }] });
  return { h, s, formId, slug: made.form.slug as string };
}

test("publishing a required relation question is refused until choices exist, then clears", async () => {
  const { h, formId } = await setup();
  await assert.rejects(run(h.ctx, "forms.publish", { formId }), (e: unknown) => { assert.match(String(e), /Company.*publisher-approved/); return true; });
  await run(h.ctx, "forms.choices_set", { formId, field: "company", choices: [{ refId: "rec_northwind" }] });
  await run(h.ctx, "forms.publish", { formId });
});

test("choices_set refuses an over-sensitive, missing or unseen entry naming it, and keeps the old list", async () => {
  const { h, formId } = await setup();
  await run(h.ctx, "forms.choices_set", { formId, field: "company", choices: [{ refId: "rec_northwind" }] });
  for (const bad of ["rec_secret", "rec_gone", "rec_nope"]) {
    await assert.rejects(run(h.ctx, "forms.choices_set", { formId, field: "company", choices: [{ refId: "rec_contoso" }, { refId: bad }] }), (e: unknown) => { assert.match(String(e), /./); return true; });
  }
  const got = await run(h.ctx, "forms.get", { formId });
  assert.deepEqual((got.choices.company as { label: string }[]).map((c) => c.label), ["Northwind"]);
});

test("choices_set refuses 201 entries, a non-relation field, and a field not asked", async () => {
  const { h, formId } = await setup();
  await assert.rejects(run(h.ctx, "forms.choices_set", { formId, field: "company", choices: Array.from({ length: 201 }, (_, i) => ({ refId: `rec_${i}` })) }), (e: unknown) => { assert.match(String(e), /at most 200/); return true; });
  await assert.rejects(run(h.ctx, "forms.choices_set", { formId, field: "note", choices: [] }));
  await run(h.ctx, "forms.fields_set", { formId, fields: [{ field: "owner", mode: "ask" }] });
  await assert.rejects(run(h.ctx, "forms.choices_set", { formId, field: "company", choices: [{ refId: "rec_northwind" }] }), (e: unknown) => { assert.match(String(e), /Ask Company in Build first/); return true; });
});

test("the public page carries labels and opaque keys only, never record ids", async () => {
  const { h, formId, slug } = await setup();
  await run(h.ctx, "forms.choices_set", { formId, field: "company", choices: [{ refId: "rec_northwind" }, { refId: "rec_contoso" }] });
  await run(h.ctx, "forms.choices_set", { formId, field: "owner", choices: [{ refId: "usr_maya" }] });
  await run(h.ctx, "forms.publish", { formId });
  const view = await publicFormViewTyped(h.ctx, slug, "form");
  const text = JSON.stringify(view);
  assert.ok(!text.includes("rec_northwind") && !text.includes("rec_contoso") && !text.includes("usr_maya"));
  const company = view.fields.find((f) => f.field === "company")!;
  assert.deepEqual(company.choices!.map((c) => c.title), ["Northwind", "Contoso"]);
  assert.ok(company.choices!.every((c) => /^chc_/.test(c.key)));
});

test("a submit must name a published key of this form and field; anything else is refused", async () => {
  const a = await setup();
  const b = await run(a.h.ctx, "forms.create", { name: "Other", recordType: "contact", kind: "public" });
  await run(a.h.ctx, "forms.fields_set", { formId: b.form.formId, fields: [{ field: "company", mode: "ask" }] });
  await run(a.h.ctx, "forms.choices_set", { formId: a.formId, field: "company", choices: [{ refId: "rec_northwind" }] });
  await run(a.h.ctx, "forms.choices_set", { formId: b.form.formId, field: "company", choices: [{ refId: "rec_contoso" }] });
  const keyA = (await run(a.h.ctx, "forms.get", { formId: a.formId })).choices.company[0].key as string;
  const keyB = (await run(a.h.ctx, "forms.get", { formId: b.form.formId })).choices.company[0].key as string;
  const form = mustForm(a.h.ctx, a.formId);
  const ok = await typedAnswers(a.h.ctx, form, { company: keyA });
  assert.deepEqual(ok.company, { __relate: ["rec_northwind"] });
  for (const guess of ["rec_northwind", "rec_secret", keyB, "chc_doesnotexist1", "", ["rec_northwind"], { urn: "rec_northwind" }])
    await assert.rejects(typedAnswers(a.h.ctx, form, { company: guess as never }), { name: "VyreErr" });
});

test("a choice whose record the publisher lost access to, or that went over the ceiling, stops working at submit", async () => {
  const { h, s, formId } = await setup();
  await run(h.ctx, "forms.choices_set", { formId, field: "company", choices: [{ refId: "rec_northwind" }] });
  const key = (await run(h.ctx, "forms.get", { formId })).choices.company[0].key as string;
  const form = mustForm(h.ctx, formId);
  await typedAnswers(h.ctx, form, { company: key });
  s.known["rec_northwind"] = { ok: false, reason: "You cannot see that record, or it no longer exists." };
  await assert.rejects(typedAnswers(h.ctx, form, { company: key }), (e: unknown) => { assert.match(String(e), /no longer available/); return true; });
  assert.ok(s.asked.every((x) => x.startsWith("usr_owner:")));
});

test("a re-publish keeps the key of a retained choice and gives a new one to an added choice", async () => {
  const { h, formId } = await setup();
  await run(h.ctx, "forms.choices_set", { formId, field: "company", choices: [{ refId: "rec_northwind" }] });
  const k1 = (await run(h.ctx, "forms.get", { formId })).choices.company[0].key;
  await run(h.ctx, "forms.choices_set", { formId, field: "company", choices: [{ refId: "rec_contoso" }, { refId: "rec_northwind" }] });
  const list = (await run(h.ctx, "forms.get", { formId })).choices.company as { key: string; refId: string }[];
  assert.equal(list.find((c) => c.refId === "rec_northwind")!.key, k1);
  assert.equal(new Set(list.map((c) => c.key)).size, 2);
});

test("the submitted record carries the real relation, and a person pick stores the member id", async () => {
  const { h, formId } = await setup();
  await run(h.ctx, "forms.choices_set", { formId, field: "company", choices: [{ refId: "rec_northwind" }] });
  await run(h.ctx, "forms.choices_set", { formId, field: "owner", choices: [{ refId: "usr_maya" }] });
  const got = await run(h.ctx, "forms.get", { formId });
  const form = mustForm(h.ctx, formId);
  const picked = await typedAnswers(h.ctx, form, { company: got.choices.company[0].key, owner: got.choices.owner[0].key });
  const written = await writeAnswers(h.ctx, form, picked, null, "k1");
  const rel = h.calls.find((c) => c.cap === "records.relate")!;
  assert.deepEqual({ recordId: (rel.input as { recordId: string }).recordId, field: (rel.input as { field: string }).field, toId: (rel.input as { toId: string }).toId }, { recordId: written.recordId, field: "company", toId: "rec_northwind" });
  assert.equal(h.records.get(written.recordId)!.fields["owner"], "usr_maya");
});

test("a relation pick passes the upload check untouched, and an upload id is never read from it", async () => {
  const { h, formId } = await setup();
  await run(h.ctx, "forms.choices_set", { formId, field: "company", choices: [{ refId: "rec_northwind" }] });
  const key = (await run(h.ctx, "forms.get", { formId })).choices.company[0].key as string;
  const form = mustForm(h.ctx, formId);
  const picked = await typedAnswers(h.ctx, form, { company: key });
  assert.deepEqual(checkUploads(h.ctx, form, picked, null, "act_anon_0000000000000000").answers, picked);
});

test("a full public submit creates the record with the relation in it, relates both ends, and a survey stores the label, not the id", async () => {
  const h = harness(); const s = source();
  configureForms({ schemaFields: async () => schema.filter((f) => f.key !== "owner"), choiceSource: s.src });
  const made = await run(h.ctx, "forms.create", { name: "Survey", recordType: "contact", kind: "survey" });
  const formId = made.form.formId as string;
  await run(h.ctx, "forms.fields_set", { formId, fields: [{ field: "company", mode: "ask" }] });
  await run(h.ctx, "forms.choices_set", { formId, field: "company", choices: [{ refId: "rec_northwind" }] });
  await run(h.ctx, "forms.publish", { formId });
  const key = (await run(h.ctx, "forms.get", { formId })).choices.company[0].key as string;
  const pub = h.as({ kind: "service", id: formPrincipal(formId) });
  const sent = await run(pub, "forms.submit", { slug: made.form.slug, answers: { company: key } });
  const create = h.calls.find((c) => c.cap === "records.create")!;
  assert.match(JSON.stringify((create.input as { fields: unknown }).fields), /vyre:\/\/[^/]*\/company\/rec_northwind/, "the relation is in the create, so a required relation is satisfied");
  assert.ok(h.calls.some((c) => c.cap === "records.relate" && (c.input as { recordId: string }).recordId === sent.recordId));
  const stored = String(many(h.ctx, "SELECT * FROM forms_submission")[0]!.answers);
  assert.ok(stored.includes("Northwind") && !stored.includes("rec_northwind"), stored);
});

test("a relation takes several published keys, each checked; a person takes exactly one", async () => {
  const { h, formId } = await setup();
  await run(h.ctx, "forms.choices_set", { formId, field: "company", choices: [{ refId: "rec_northwind" }, { refId: "rec_contoso" }] });
  await run(h.ctx, "forms.choices_set", { formId, field: "owner", choices: [{ refId: "usr_maya" }] });
  const got = await run(h.ctx, "forms.get", { formId });
  const keys = got.choices.company.map((c: { key: string }) => c.key) as string[];
  const form = mustForm(h.ctx, formId);
  assert.deepEqual((await typedAnswers(h.ctx, form, { company: keys })).company, { __relate: ["rec_northwind", "rec_contoso"] });
  assert.deepEqual((await typedAnswers(h.ctx, form, { company: [keys[0]!, keys[0]!] })).company, { __relate: ["rec_northwind"] });
  await assert.rejects(typedAnswers(h.ctx, form, { company: [keys[0]!, "rec_contoso"] }), { name: "VyreErr" });
  await assert.rejects(typedAnswers(h.ctx, form, { owner: [got.choices.owner[0].key] }), { name: "VyreErr" });
  const picked = await typedAnswers(h.ctx, form, { company: keys });
  const written = await writeAnswers(h.ctx, form, picked, null, "k2");
  assert.deepEqual(h.calls.filter((c) => c.cap === "records.relate").map((c) => (c.input as { toId: string }).toId), ["rec_northwind", "rec_contoso"]);
  assert.ok(written.recordId);
});
