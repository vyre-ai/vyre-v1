// forms links: signed and one-use record links, revoking, partial answers (spec 2.11 Forms API; ARCH 7.6).
// @reads /modules/forms/migrations/0001_forms.sql

import test from "node:test";
import assert from "node:assert/strict";
import { linkView } from "../impl.ts";
import { HOUR, NOW, harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";
import { code, openForm, run } from "../fixtures/seed.ts";
import type { OpenForm } from "../fixtures/seed.ts";

const RECORD = "rec_c1";

function seedRecord(w: World, fields: Record<string, unknown> = { email: "dana@x.example" }): void {
  w.addRecord({ id: RECORD, type: "contact", fields });
}

async function makeLink(w: World, f: OpenForm, o: { singleUse?: boolean; expiresInHours?: number; recordId?: string } = {}): Promise<{ url: string; token: string; expiresAt?: number }> {
  const out = await run<{ url: string; expiresAt?: number }>(w.ctx, "forms.link_create", { formId: f.formId, recordId: o.recordId ?? RECORD, singleUse: o.singleUse ?? true, ...(o.expiresInHours ? { expiresInHours: o.expiresInHours } : {}) });
  const token = new URL(out.url).searchParams.get("t");
  assert.ok(token);
  return { ...out, token };
}

const send = (f: OpenForm, input: Record<string, unknown>) => run<{ recordId: string }>(f.public, "forms.submit", { slug: f.slug, ...input });

test("link_create asks only for the fields the record is missing and puts no email in the URL", async () => {
  const w = harness();
  seedRecord(w);
  const f = await openForm(w);
  const link = await makeLink(w, f);
  assert.ok(link.url.startsWith("https://harbor.example/f/intake?t="));
  assert.equal(link.url.includes("dana"), false);
  assert.equal(link.url.includes("@"), false);
  assert.deepEqual(JSON.parse(String(w.db.rows("forms_link")[0]?.missing)), ["name", "phone"]);
  assert.equal(link.expiresAt, NOW + 72 * HOUR);
  const ev = w.events.find((e) => e.name === "form.link_created");
  assert.deepEqual(ev?.payload, { formId: f.formId, recordId: RECORD, expiresAt: NOW + 72 * HOUR });
  assert.equal(ev?.subject, `form/${f.formId}`);
});

test("the token is never stored: only its hash is", async () => {
  const w = harness();
  seedRecord(w);
  const f = await openForm(w);
  const link = await makeLink(w, f);
  const row = w.db.rows("forms_link")[0] ?? {};
  for (const v of Object.values(row)) assert.notEqual(v, link.token);
  assert.match(String(row.token_hash), /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(w.events).includes(link.token), false);
});

test("default lifetimes: three days single-use, a week for a signed link; custom hours are honoured", async () => {
  const w = harness();
  seedRecord(w);
  const f = await openForm(w);
  assert.equal((await makeLink(w, f, { singleUse: false })).expiresAt, NOW + 7 * 24 * HOUR);
  assert.equal((await makeLink(w, f, { expiresInHours: 2 })).expiresAt, NOW + 2 * HOUR);
  assert.equal(await code(run(w.ctx, "forms.link_create", { formId: f.formId, recordId: RECORD, singleUse: true, expiresInHours: 0 })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "forms.link_create", { formId: f.formId, recordId: RECORD })), "validation.bad_input");
});

test("a record with nothing missing gets no link; an unknown record is not found", async () => {
  const w = harness();
  seedRecord(w, { email: "d@x.example", name: "Dana", phone: "555" });
  const f = await openForm(w);
  assert.equal(await code(run(w.ctx, "forms.link_create", { formId: f.formId, recordId: RECORD, singleUse: true })), "validation.precondition_failed");
  assert.equal(await code(run(w.ctx, "forms.link_create", { formId: f.formId, recordId: "rec_nope", singleUse: true })), "validation.not_found");
  assert.equal(w.db.rows("forms_link").length, 0);
});

test("a single-use link writes to its own record, asks only the missing fields, and works once", async () => {
  const w = harness();
  seedRecord(w);
  const f = await openForm(w);
  const link = await makeLink(w, f);
  assert.equal(await code(send(f, { token: link.token, answers: { email: "other@x.example" } })), "validation.bad_input");
  const out = await send(f, { token: link.token, answers: { name: "Dana", phone: "555" } });
  assert.equal(out.recordId, RECORD);
  assert.deepEqual(w.records.get(RECORD)?.fields, { email: "dana@x.example", name: "Dana", phone: "555" });
  assert.equal(w.calls.some((c) => c.cap === "records.create"), false);
  assert.equal(w.calls.some((c) => c.cap === "records.query"), false);
  assert.equal((w.events.find((e) => e.name === "form.submitted")?.payload as { matched: boolean }).matched, true);
  assert.equal(await code(send(f, { token: link.token, answers: { name: "Again" } })), "auth.invalid_code");
  assert.equal(w.records.get(RECORD)?.fields.name, "Dana");
});

test("the short code input works like the token", async () => {
  const w = harness();
  seedRecord(w);
  const f = await openForm(w);
  const link = await makeLink(w, f);
  assert.equal((await send(f, { code: link.token, answers: { name: "Dana" } })).recordId, RECORD);
});

test("a failed write gives the link back", async () => {
  const w = harness();
  seedRecord(w);
  const f = await openForm(w);
  const link = await makeLink(w, f);
  w.state.failRecords = true;
  assert.equal(await code(send(f, { token: link.token, answers: { name: "Dana" } })), "internal.unexpected");
  assert.equal(w.db.rows("forms_link")[0]?.consumed_at, null);
  assert.equal(w.db.rows("forms_submission").length, 0);
  w.state.failRecords = false;
  assert.equal((await send(f, { token: link.token, answers: { name: "Dana" } })).recordId, RECORD);
});

test("two submits on one single-use link at once: exactly one wins", async () => {
  const w = harness();
  seedRecord(w);
  const f = await openForm(w);
  const link = await makeLink(w, f);
  const results = await Promise.allSettled([send(f, { token: link.token, answers: { name: "A" } }), send(f, { token: link.token, answers: { name: "B" } })]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const lost = results.find((r) => r.status === "rejected");
  assert.equal((lost as PromiseRejectedResult).reason.error.code, "auth.invalid_code");
  assert.equal(w.db.rows("forms_submission").length, 1);
});

test("a signed (multi-use) link keeps working until it expires", async () => {
  const w = harness();
  seedRecord(w);
  const f = await openForm(w);
  const link = await makeLink(w, f, { singleUse: false });
  await send(f, { token: link.token, answers: { name: "Dana" } });
  w.advance(120_000);
  await send(f, { token: link.token, answers: { phone: "555" } });
  assert.equal(w.records.get(RECORD)?.fields.phone, "555");
  assert.equal(w.db.rows("forms_link")[0]?.consumed_at, null);
  w.advance(7 * 24 * HOUR);
  assert.equal(await code(send(f, { token: link.token, answers: { phone: "999" } })), "auth.invalid_code");
});

test("expired, revoked, tampered, truncated and foreign tokens are all the same refusal", async () => {
  const w = harness();
  seedRecord(w);
  const f = await openForm(w);
  const other = await openForm(w, { name: "Other" });
  const bad = (token: string, form: OpenForm = f) => code(send(form, { token, answers: { name: "Dana" } }));

  const expiring = await makeLink(w, f, { expiresInHours: 1 });
  const revoked = await makeLink(w, f);
  const good = await makeLink(w, f);
  assert.deepEqual(await run(w.ctx, "forms.link_revoke", { formId: f.formId, token: revoked.token }), { revoked: true });
  assert.deepEqual(await run(w.ctx, "forms.link_revoke", { formId: f.formId, token: revoked.token }), { revoked: true });
  assert.equal(await bad(revoked.token), "auth.invalid_code");

  const flipped = good.token.slice(0, -1) + (good.token.endsWith("A") ? "B" : "A");
  assert.equal(await bad(flipped), "auth.invalid_code");
  assert.equal(await bad(good.token.slice(0, 20)), "auth.invalid_code");
  assert.equal(await bad("nonsense"), "auth.invalid_code");
  assert.equal(await bad(`${good.token.split(".")[0]}.`), "auth.invalid_code");
  assert.equal(await bad("x".repeat(400)), "auth.invalid_code");
  assert.equal(await bad(good.token, other), "auth.invalid_code");

  w.advance(2 * HOUR);
  assert.equal(await bad(expiring.token), "auth.invalid_code");
  assert.equal((await send(f, { token: good.token, answers: { name: "Dana" } })).recordId, RECORD);
  assert.equal(w.records.size, 1);
});

test("a one-use form opens only from a link", async () => {
  const w = harness();
  seedRecord(w);
  const f = await openForm(w, { kind: "one_use", name: "Follow up" });
  assert.equal(await code(send(f, { answers: { email: "x@x.example" } })), "auth.invalid_code");
  const link = await makeLink(w, f);
  assert.equal((await send(f, { token: link.token, answers: { name: "Dana" } })).recordId, RECORD);
});

test("revoking a link that does not belong to the form is not found", async () => {
  const w = harness();
  seedRecord(w);
  const f = await openForm(w);
  const other = await openForm(w, { name: "Other" });
  const link = await makeLink(w, f);
  assert.equal(await code(run(w.ctx, "forms.link_revoke", { formId: other.formId, token: link.token })), "validation.not_found");
  assert.equal(await code(run(w.ctx, "forms.link_revoke", { formId: f.formId, token: "lnk_unknown.abc" })), "validation.not_found");
});

test("a closed form refuses its links", async () => {
  const w = harness();
  seedRecord(w);
  const f = await openForm(w);
  const link = await makeLink(w, f);
  await run(w.ctx, "forms.unpublish", { formId: f.formId });
  assert.equal(await code(send(f, { token: link.token, answers: { name: "Dana" } })), "validation.not_found");
});

// ---- partial answers -----------------------------------------------------------------------------------------

test("partial answers wait on the link and never reach the record until submit", async () => {
  const w = harness();
  seedRecord(w);
  const f = await openForm(w);
  const link = await makeLink(w, f);
  const saved = await run<{ saved: boolean; expiresAt?: number }>(f.public, "forms.save_partial", { slug: f.slug, token: link.token, answers: { name: "Da" }, step: 1 });
  assert.deepEqual(saved, { saved: true, expiresAt: NOW + 72 * HOUR });
  assert.deepEqual(w.records.get(RECORD)?.fields, { email: "dana@x.example" });
  assert.equal(w.calls.some((c) => c.cap === "records.update"), false);
  w.advance(HOUR);
  const view = await linkView(f.public, f.slug, link.token);
  assert.equal(view.recordId, RECORD);
  assert.equal(view.singleUse, true);
  assert.deepEqual(view.fields.map((x) => x.field), ["name", "phone"]);
  assert.deepEqual(view.partial, { answers: { name: "Da" }, step: 1, expiresAt: NOW + 72 * HOUR });
  await send(f, { token: link.token, answers: { name: "Dana", phone: "555" } });
  assert.equal(w.db.rows("forms_link")[0]?.partial, null);
});

test("a later save replaces the earlier one; a submit on a multi-use link clears it", async () => {
  const w = harness();
  seedRecord(w);
  const f = await openForm(w);
  const link = await makeLink(w, f, { singleUse: false });
  await run(f.public, "forms.save_partial", { slug: f.slug, token: link.token, answers: { name: "D" } });
  await run(f.public, "forms.save_partial", { slug: f.slug, token: link.token, answers: { name: "Dana", phone: "5" } });
  assert.deepEqual((await linkView(f.public, f.slug, link.token)).partial?.answers, { name: "Dana", phone: "5" });
  await send(f, { token: link.token, answers: { name: "Dana" } });
  assert.equal((await linkView(f.public, f.slug, link.token)).partial, undefined);
});

test("save_partial refuses bad tokens, questions off the link, big payloads and floods", async () => {
  const w = harness();
  seedRecord(w);
  const f = await openForm(w);
  const link = await makeLink(w, f);
  const save = (input: Record<string, unknown>) => run(f.public, "forms.save_partial", { slug: f.slug, token: link.token, ...input });
  assert.equal(await code(run(f.public, "forms.save_partial", { slug: f.slug, token: "lnk_x.y", answers: {} })), "auth.invalid_code");
  assert.equal(await code(save({ answers: { email: "other@x.example" } })), "validation.bad_input");
  assert.equal(await code(save({ answers: "x" })), "validation.bad_input");
  assert.equal(await code(save({ answers: { name: "x".repeat(70_000) } })), "validation.too_large");
  assert.equal(await code(save({ answers: {}, step: -1 })), "validation.bad_input");
  for (let i = 0; i < 58; i++) await save({ answers: { name: `n${i}` } });
  assert.equal(await code(save({ answers: { name: "late" } })), "rate_limit.exceeded");
});

test("a revoked link drops its saved answers and refuses more", async () => {
  const w = harness();
  seedRecord(w);
  const f = await openForm(w);
  const link = await makeLink(w, f);
  await run(f.public, "forms.save_partial", { slug: f.slug, token: link.token, answers: { name: "Da" } });
  await run(w.ctx, "forms.link_revoke", { formId: f.formId, token: link.token });
  assert.equal(w.db.rows("forms_link")[0]?.partial, null);
  assert.equal(await code(run(f.public, "forms.save_partial", { slug: f.slug, token: link.token, answers: { name: "x" } })), "auth.invalid_code");
});

test("a booking page has no record links", async () => {
  const w = harness();
  seedRecord(w);
  const made = await run<{ form: { formId: string } }>(w.ctx, "bookings.page_create", { name: "Call", hostIds: ["usr_host1"], lengthMinutes: 30, recordType: "contact" });
  assert.equal(await code(run(w.ctx, "forms.link_create", { formId: made.form.formId, recordId: RECORD, singleUse: true })), "validation.precondition_failed");
});
