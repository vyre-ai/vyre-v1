// forms bookings: booking pages, availability from connected calendars, booking, cancelling (spec 2.11 Booking pages; ARCH 7.6).
// Fixed clock: Thursday 2025-10-09 08:53:20 UTC. A page is open 09:00 to 17:00 UTC Monday to Friday with one hour of notice, so the first slot is 10:00 UTC.
// @reads /modules/forms/migrations/0001_forms.sql

import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { formPrincipal } from "../handlers/submit.ts";
import { HOUR, NOW, TEN_UTC, harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";
import { code, run } from "../fixtures/seed.ts";

const MIN = 60_000;
const TZ = "America/Los_Angeles";

interface Page { formId: string; slug: string; public: Ctx }
interface Slot { startsAt: number; endsAt: number; hostId: string }
interface Booking { bookingId: string; formId: string; recordId: string; startsAt: number; endsAt: number; hostId: string; state: string }

async function openPage(w: World, o: { hosts?: string[]; length?: number; buffer?: number; name?: string; publish?: boolean } = {}): Promise<Page> {
  const made = await run<{ form: { formId: string; slug: string } }>(w.ctx, "bookings.page_create", {
    name: o.name ?? "Call", hostIds: o.hosts ?? ["usr_host1"], lengthMinutes: o.length ?? 30, ...(o.buffer !== undefined ? { bufferMinutes: o.buffer } : {}), recordType: "contact",
  });
  await run(w.ctx, "forms.fields_set", { formId: made.form.formId, fields: [{ field: "email", mode: "ask" }, { field: "name", mode: "ask" }] });
  if (o.publish !== false) await run(w.ctx, "forms.publish", { formId: made.form.formId });
  return { formId: made.form.formId, slug: made.form.slug, public: w.as({ kind: "service", id: formPrincipal(made.form.formId) }) };
}

const slotsOf = async (p: Page, from: number, to: number, tz = TZ) => run<{ slots: Slot[]; available: boolean }>(p.public, "bookings.availability", { slug: p.slug, tz, from, to });
const book = (p: Page, startsAt: number, answers: Record<string, unknown> = { email: "lee@x.example", name: "Lee" }, tz = TZ) =>
  run<{ booking: Booking }>(p.public, "bookings.book", { slug: p.slug, startsAt, answers, tz });

test("a booking page is a form of kind booking that asks for an email and publishes at /book/<slug>", async () => {
  const w = harness();
  const made = await run<{ form: { formId: string; slug: string; kind: string; state: string } }>(w.ctx, "bookings.page_create", { name: "Intro call", hostIds: ["usr_host1", "usr_host1", "usr_host2"], lengthMinutes: 30, bufferMinutes: 10, recordType: "contact" });
  assert.equal(made.form.kind, "booking");
  assert.equal(made.form.state, "draft");
  assert.deepEqual(JSON.parse(String(w.db.rows("forms_booking_page")[0]?.host_ids)), ["usr_host1", "usr_host2"]);
  const got = await run<{ fields: { field: string; mode: string }[] }>(w.ctx, "forms.get", { formId: made.form.formId });
  assert.deepEqual(got.fields, [{ field: "email", mode: "ask" }]);
  const pub = await run<{ url: string }>(w.ctx, "forms.publish", { formId: made.form.formId });
  assert.equal(pub.url, `https://harbor.example/book/${made.form.slug}`);
  assert.equal(await code(run(w.ctx, "forms.fields_set", { formId: made.form.formId, fields: [{ field: "name", mode: "ask" }] })), "validation.precondition_failed");
  const listed = await run<{ forms: { kind: string }[] }>(w.ctx, "forms.list", {});
  assert.deepEqual(listed.forms.map((x) => x.kind), ["booking"]);
});

test("page_create refuses bad input", async () => {
  const w = harness();
  const make = (o: Record<string, unknown>) => run(w.ctx, "bookings.page_create", { name: "Call", hostIds: ["usr_host1"], lengthMinutes: 30, recordType: "contact", ...o });
  assert.equal(await code(make({ name: " " })), "validation.bad_input");
  assert.equal(await code(make({ hostIds: [] })), "validation.bad_input");
  assert.equal(await code(make({ hostIds: [5] })), "validation.bad_input");
  assert.equal(await code(make({ lengthMinutes: 3 })), "validation.bad_input");
  assert.equal(await code(make({ bufferMinutes: -1 })), "validation.bad_input");
  assert.equal(await code(make({ recordType: "Bad Type" })), "validation.bad_input");
  assert.equal(w.db.rows("forms_booking_page").length, 0);
});

test("slots sit on a 15 minute grid inside the hours, after the notice, and fit before the end of the range", async () => {
  const w = harness();
  const p = await openPage(w);
  const res = await slotsOf(p, NOW, NOW + 6 * HOUR);
  assert.equal(res.available, true);
  assert.equal(res.slots.length, 18);
  assert.equal(res.slots[0]?.startsAt, TEN_UTC);
  assert.equal(res.slots[res.slots.length - 1]?.startsAt, TEN_UTC + 255 * MIN);
  assert.ok(res.slots.every((s) => s.endsAt - s.startsAt === 30 * MIN && s.hostId === "usr_host1"));
});

test("weekends and hours outside 09:00 to 17:00 UTC are never offered", async () => {
  const w = harness();
  const p = await openPage(w);
  const res = await slotsOf(p, NOW, NOW + 4 * 24 * HOUR);
  assert.equal(res.slots.length, 58);
  for (const s of res.slots) {
    const d = new Date(s.startsAt);
    assert.ok(d.getUTCDay() >= 1 && d.getUTCDay() <= 5);
    const start = d.getUTCHours() * 60 + d.getUTCMinutes();
    assert.ok(start >= 9 * 60 && start + 30 <= 17 * 60);
  }
  assert.ok(res.slots.some((s) => new Date(s.startsAt).getUTCDay() === 5));
});

test("the visitor zone is checked and the range is bounded", async () => {
  const w = harness();
  const p = await openPage(w);
  assert.equal(await code(slotsOf(p, NOW, NOW + HOUR, "Mars/Base")), "validation.bad_input");
  assert.equal(await code(slotsOf(p, NOW + HOUR, NOW)), "validation.bad_input");
  assert.equal(await code(slotsOf(p, NOW, NOW + 63 * 24 * HOUR)), "validation.bad_input");
  assert.equal((await slotsOf(p, NOW, NOW + 62 * 24 * HOUR)).available, true);
});

test("a draft page and a plain form are not bookable", async () => {
  const w = harness();
  const draft = await openPage(w, { publish: false });
  assert.equal(await code(slotsOf(draft, NOW, NOW + HOUR)), "validation.not_found");
  const plain = await run<{ form: { formId: string; slug: string } }>(w.ctx, "forms.create", { name: "Plain", recordType: "contact", kind: "public" });
  await run(w.ctx, "forms.fields_set", { formId: plain.form.formId, fields: [{ field: "email", mode: "ask" }] });
  await run(w.ctx, "forms.publish", { formId: plain.form.formId });
  assert.equal(await code(run(w.ctx, "bookings.availability", { slug: plain.form.slug, tz: TZ, from: NOW, to: NOW + HOUR })), "validation.not_found");
});

test("busy blocks and the buffer remove slots around them", async () => {
  const w = harness();
  const p = await openPage(w, { buffer: 15 });
  w.state.busy = [{ who: "usr_host1", startsAt: TEN_UTC, endsAt: TEN_UTC + HOUR }];
  const res = await slotsOf(p, NOW, NOW + 6 * HOUR);
  assert.equal(res.slots[0]?.startsAt, TEN_UTC + 75 * MIN);
  const noBuffer = await openPage(w, { name: "Tight", buffer: 0 });
  const tight = await slotsOf(noBuffer, NOW, NOW + 6 * HOUR);
  assert.equal(tight.slots[0]?.startsAt, TEN_UTC + 60 * MIN);
});

test("round robin: the host with the fewest bookings on the page is offered first", async () => {
  const w = harness();
  const p = await openPage(w, { hosts: ["usr_host1", "usr_host2"] });
  assert.equal((await slotsOf(p, NOW, NOW + 3 * HOUR)).slots[0]?.hostId, "usr_host1");
  const first = await book(p, TEN_UTC);
  assert.equal(first.booking.hostId, "usr_host1");
  const after = await slotsOf(p, NOW, NOW + 3 * HOUR);
  const byStart = new Map(after.slots.map((s) => [s.startsAt, s.hostId]));
  assert.equal(byStart.get(TEN_UTC), "usr_host2", "host 1 is busy at 10:00");
  assert.equal(byStart.get(TEN_UTC + 60 * MIN), "usr_host2", "host 2 has fewer bookings");
  const second = await book(p, TEN_UTC, { email: "kim@x.example" });
  assert.equal(second.booking.hostId, "usr_host2");
  assert.equal(await code(book(p, TEN_UTC, { email: "third@x.example" })), "validation.precondition_failed");
});

test("a disconnected host is left out; with every host out the page says unavailable and the owner hears once", async () => {
  const w = harness();
  const two = await openPage(w, { hosts: ["usr_host1", "usr_host2"], name: "Pair" });
  w.state.unknown = ["usr_host1"];
  const some = await slotsOf(two, NOW, NOW + 3 * HOUR);
  assert.equal(some.available, true);
  assert.ok(some.slots.length > 0 && some.slots.every((s) => s.hostId === "usr_host2"));
  assert.equal(w.tasks.length, 0);

  const solo = await openPage(w, { name: "Solo" });
  const down = await slotsOf(solo, NOW, NOW + 3 * HOUR);
  assert.deepEqual(down, { slots: [], available: false });
  assert.equal(w.tasks.length, 1);
  assert.match(String((w.tasks[0] as { title: string }).title), /Solo/);
  assert.deepEqual((w.tasks[0] as { assigned: unknown }).assigned, { kind: "person", id: "usr_owner" });
  w.advance(HOUR);
  await slotsOf(solo, NOW, NOW + 3 * HOUR);
  assert.equal(w.tasks.length, 1, "no second alert inside 12 hours");
  assert.equal(await code(book(solo, TEN_UTC + 2 * HOUR)), "validation.precondition_failed");
  w.advance(13 * HOUR);
  await slotsOf(solo, NOW + 14 * HOUR, NOW + 20 * HOUR);
  assert.equal(w.tasks.length, 2);
});

test("a calendar that fails to answer counts as disconnected", async () => {
  const w = harness();
  const orig = w.ctx.call.bind(w.ctx);
  w.ctx.call = async (cap, input, opts) => {
    if (cap === "calendar.availability") throw new Error("provider down");
    return orig(cap, input, opts);
  };
  const p = await openPage(w);
  assert.equal((await slotsOf(p, NOW, NOW + 3 * HOUR)).available, false);
  assert.ok(w.warnings.some((m) => m.includes("availability")));
});

test("booking makes the record, the calendar event and the booking, and fires booking.created", async () => {
  const w = harness();
  const p = await openPage(w);
  const out = await book(p, TEN_UTC);
  const b = out.booking;
  assert.equal(b.state, "booked");
  assert.equal(b.hostId, "usr_host1");
  assert.equal(b.endsAt - b.startsAt, 30 * MIN);
  assert.deepEqual(w.records.get(b.recordId)?.fields, { email: "lee@x.example", name: "Lee" });
  const ev = w.calendarEvents[0];
  const { idempotencyKey: eventKey, ...eventInput } = ev?.input as Record<string, unknown>;
  assert.match(String(eventKey), /^forms\.book:.*:event$/);
  assert.deepEqual(eventInput, { calendarId: "cld_host1", title: "Call: Lee", startsAt: TEN_UTC, endsAt: TEN_UTC + 30 * MIN, attendees: [{ email: "lee@x.example" }], recordIds: [b.recordId], fromBookingPage: p.formId });
  assert.deepEqual(w.events.find((e) => e.name === "booking.created")?.payload, { bookingId: b.bookingId, formId: p.formId, recordId: b.recordId });
  const create = w.calls.find((c) => c.cap === "records.create");
  assert.equal(create?.principal.id, formPrincipal(p.formId));
  const listed = await run<{ bookings: Booking[] }>(w.ctx, "bookings.list", { formId: p.formId });
  assert.deepEqual(listed.bookings.map((x) => x.bookingId), [b.bookingId]);
  const subs = await run<{ total: number }>(w.ctx, "forms.submissions", { formId: p.formId });
  assert.equal(subs.total, 1);
  const after = await slotsOf(p, NOW, NOW + 3 * HOUR);
  assert.equal(after.slots.some((s) => s.startsAt === TEN_UTC || s.startsAt === TEN_UTC + 15 * MIN), false);
  assert.equal(after.slots[0]?.startsAt, TEN_UTC + 30 * MIN);
});

test("booking updates the contact it matches by email", async () => {
  const w = harness();
  w.addRecord({ id: "rec_lee", type: "contact", fields: { email: "lee@x.example", name: "Old" } });
  const p = await openPage(w);
  const out = await book(p, TEN_UTC, { email: "LEE@x.example", name: "Lee" });
  assert.equal(out.booking.recordId, "rec_lee");
  assert.equal(w.records.get("rec_lee")?.fields.name, "Lee");
  assert.equal((w.db.rows("forms_submission")[0] ?? {}).matched, 1);
});

test("booking refuses a taken slot, an off-grid time, a closed hour, a missing email and a bad zone", async () => {
  const w = harness();
  const p = await openPage(w);
  await book(p, TEN_UTC);
  assert.equal(await code(book(p, TEN_UTC, { email: "b@x.example" })), "validation.precondition_failed");
  assert.equal(await code(book(p, TEN_UTC + 30 * MIN + 1, { email: "b@x.example" })), "validation.precondition_failed");
  assert.equal(await code(book(p, TEN_UTC + 2 * 24 * HOUR, { email: "b@x.example" })), "validation.precondition_failed", "Saturday");
  assert.equal(await code(book(p, NOW + 5 * MIN, { email: "b@x.example" })), "validation.precondition_failed", "inside the notice");
  assert.equal(await code(book(p, TEN_UTC + HOUR, { name: "No email" })), "validation.bad_input");
  assert.equal(await code(book(p, TEN_UTC + HOUR, { email: "b@x.example" }, "Nowhere/Land")), "validation.bad_input");
  assert.equal(await code(book(p, TEN_UTC + HOUR, { email: "b@x.example", extra: "x" })), "validation.bad_input");
  assert.equal(w.db.rows("forms_booking").length, 1);
  assert.equal(w.calendarEvents.length, 1);
});

test("two bookings for one slot at once: one wins, no second event is left behind", async () => {
  const w = harness();
  const p = await openPage(w);
  const results = await Promise.allSettled([book(p, TEN_UTC, { email: "a@x.example" }), book(p, TEN_UTC, { email: "b@x.example" })]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.equal(lost.reason.error.code, "validation.precondition_failed");
  assert.equal(w.db.rows("forms_booking").filter((b) => b.state === "booked").length, 1);
  assert.equal(w.calendarEvents.length - w.deletedEvents.length, 1);
  assert.equal(w.names().filter((n) => n === "booking.created").length, 1);
});

test("cancelling frees the slot, removes the event and fires booking.cancelled once", async () => {
  const w = harness();
  const p = await openPage(w);
  const { booking } = await book(p, TEN_UTC);
  const cancelled = await run<{ booking: Booking }>(w.ctx, "bookings.cancel", { bookingId: booking.bookingId });
  assert.equal(cancelled.booking.state, "cancelled");
  assert.deepEqual(w.deletedEvents, [w.calendarEvents[0]?.id]);
  assert.deepEqual(w.events.find((e) => e.name === "booking.cancelled")?.payload, { bookingId: booking.bookingId, formId: p.formId });
  const again = await run<{ booking: Booking }>(w.ctx, "bookings.cancel", { bookingId: booking.bookingId });
  assert.equal(again.booking.state, "cancelled");
  assert.equal(w.names().filter((n) => n === "booking.cancelled").length, 1);
  assert.equal(w.deletedEvents.length, 1);
  assert.equal((await slotsOf(p, NOW, NOW + 3 * HOUR)).slots[0]?.startsAt, TEN_UTC);
  assert.equal(await code(run(w.ctx, "bookings.cancel", { bookingId: "bkg_missing" })), "validation.not_found");
  await book(p, TEN_UTC, { email: "next@x.example" });
});

test("a host with no calendar still gets the booking, without an event, and the gap is logged", async () => {
  const w = harness();
  w.state.calendars = [];
  const p = await openPage(w);
  const { booking } = await book(p, TEN_UTC);
  assert.equal(w.db.rows("forms_booking")[0]?.event_id, null);
  assert.equal(booking.state, "booked");
  assert.ok(w.warnings.some((m) => m.includes("no calendar")));
});

test("a calendar that refuses the event leaves no booking and no booking.created", async () => {
  const w = harness();
  const p = await openPage(w);
  w.state.failCreate = true;
  assert.equal(await code(book(p, TEN_UTC)), "internal.unexpected");
  assert.equal(w.db.rows("forms_booking").length, 0);
  assert.equal(w.names().includes("booking.created"), false);
  w.state.failCreate = false;
  assert.equal((await book(p, TEN_UTC)).booking.state, "booked");
});

test("booking pages obey the form's rate limit, consent text and captcha", async () => {
  const w = harness();
  const p = await openPage(w);
  await run(w.ctx, "forms.update", { formId: p.formId, rateLimit: 3, consentText: "I agree to be contacted.", captcha: true });
  const answers = (n: number, extra: Record<string, unknown> = {}) => ({ email: `v${n}@x.example`, ...extra });
  assert.equal(await code(book(p, TEN_UTC, answers(1, { captcha: "human" }))), "validation.bad_input", "consent first");
  assert.equal(await code(book(p, TEN_UTC, answers(2, { consent: true }))), "auth.invalid_code", "no captcha token");
  assert.equal(await code(book(p, TEN_UTC, answers(3, { consent: true, captcha: "robot" }))), "auth.invalid_code");
  assert.equal(await code(book(p, TEN_UTC, answers(4, { consent: true, captcha: "human" }))), "rate_limit.exceeded");
  w.advance(61_000);
  const ok = await book(p, TEN_UTC + 2 * HOUR, answers(5, { consent: true, captcha: "human" }));
  const stored = w.records.get(ok.booking.recordId)?.fields ?? {};
  assert.deepEqual(stored, { email: "v5@x.example" });
});

test("bookings.list pages by start time", async () => {
  const w = harness();
  const p = await openPage(w);
  for (const [n, off] of [[1, 3], [2, 1], [3, 2]] as const) await book(p, TEN_UTC + off * HOUR, { email: `p${n}@x.example` });
  const first = await run<{ bookings: Booking[]; next?: string; total: number }>(w.ctx, "bookings.list", { formId: p.formId, limit: 2 });
  assert.deepEqual(first.bookings.map((b) => b.startsAt), [TEN_UTC + HOUR, TEN_UTC + 2 * HOUR]);
  assert.equal(first.total, 3);
  assert.equal(first.next, "2");
  const rest = await run<{ bookings: Booking[]; next?: string }>(w.ctx, "bookings.list", { formId: p.formId, limit: 2, cursor: first.next });
  assert.deepEqual(rest.bookings.map((b) => b.startsAt), [TEN_UTC + 3 * HOUR]);
  assert.equal(rest.next, undefined);
});
