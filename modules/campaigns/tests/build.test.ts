// campaigns build: the definition, the audience from a record view with Do-not-contact screening, steps, A/B variants, send windows by recipient zone, preview and the link builder
// (spec 2.19, 3.6; ARCH 7.6, 8.2). The migration is data: @reads keeps ci-select on this test instead of the whole suite.
// @reads /modules/campaigns/migrations/0001_campaigns.sql

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WINDOWS, inWindow, nextOpen } from "../projections.ts";
import { DAY, HOUR, NOW, harness } from "../fixtures/world.ts";
import { EMAIL_STEP, build, code, run } from "../fixtures/seed.ts";

interface Row { campaignId: string; name: string; kind: string; state: string; owner: string; audienceCount: number; sent: number; replies: number }

test("create, get, list, update and delete a draft", async () => {
  const w = harness();
  const made = await run<{ campaign: Row }>(w.ctx, "campaigns.create", { name: "  Spring outreach ", kind: "sequence" });
  const c = made.campaign;
  assert.match(c.campaignId, /^cmp_[a-z0-9]+$/);
  assert.deepEqual({ name: c.name, kind: c.kind, state: c.state, owner: c.owner, audienceCount: c.audienceCount, sent: c.sent, replies: c.replies }, { name: "Spring outreach", kind: "sequence", state: "draft", owner: "usr_owner", audienceCount: 0, sent: 0, replies: 0 });
  const got = await run<{ campaign: Row; steps: unknown[]; throttle: unknown }>(w.ctx, "campaigns.get", { campaignId: c.campaignId });
  assert.deepEqual(got.steps, []);
  assert.deepEqual(got.throttle, { stopOnReply: true });
  const upd = await run<{ campaign: Row }>(w.ctx, "campaigns.update", { campaignId: c.campaignId, name: "Spring outreach 2", settings: { emailField: "work_email", tzField: "tz" } });
  assert.equal(upd.campaign.name, "Spring outreach 2");
  await run(w.ctx, "campaigns.update", { campaignId: c.campaignId, settings: { phoneField: "mobile" } });
  assert.deepEqual(JSON.parse(String(w.db.rows("campaigns_campaign")[0]?.settings)), { emailField: "work_email", tzField: "tz", phoneField: "mobile" });
  const second = await run<{ campaign: Row }>(w.ctx, "campaigns.create", { name: "Later", kind: "one_time" });
  w.advance(1000);
  const listed = await run<{ campaigns: Row[]; total: number }>(w.ctx, "campaigns.list", {});
  assert.equal(listed.total, 2);
  assert.deepEqual(listed.campaigns.map((x) => x.campaignId).sort(), [c.campaignId, second.campaign.campaignId].sort());
  assert.equal((await run<{ total: number }>(w.ctx, "campaigns.list", { section: "personal" })).total, 0);
  assert.deepEqual(await run(w.ctx, "campaigns.delete", { campaignId: c.campaignId }), { deleted: true });
  assert.equal(await code(run(w.ctx, "campaigns.get", { campaignId: c.campaignId })), "validation.not_found");
  assert.equal((await run<{ total: number }>(w.ctx, "campaigns.list", {})).total, 1);
});

test("create and update refuse bad input", async () => {
  const w = harness();
  assert.equal(await code(run(w.ctx, "campaigns.create", { name: " ", kind: "sequence" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "campaigns.create", { name: "x", kind: "blast" })), "validation.bad_input");
  const { campaignId } = await build(w, { audience: false });
  assert.equal(await code(run(w.ctx, "campaigns.update", { campaignId, settings: { emailField: "bad field!" } })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "campaigns.update", { campaignId, settings: { trigger: { type: "contact" } } })), "validation.bad_input", "only a triggered campaign has a trigger");
  assert.equal(await code(run(w.ctx, "campaigns.update", { campaignId, settings: { startAt: -1 } })), "validation.bad_input");
  const trig = await build(w, { kind: "triggered", audience: false, name: "On new lead" });
  assert.equal(await code(run(w.ctx, "campaigns.update", { campaignId: trig.campaignId, settings: { trigger: { type: "Contact" } } })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "campaigns.update", { campaignId: trig.campaignId, settings: { trigger: { type: "contact", event: "record.deleted" } } })), "validation.bad_input");
  await run(w.ctx, "campaigns.update", { campaignId: trig.campaignId, settings: { trigger: { type: "contact", event: "record.created" } } });
});

// ---- audience ---------------------------------------------------------------------------------------------------

test("audience from a record type: addresses are tidied, Do-not-contact and the suppression list refuse, nobody without an address is added", async () => {
  const w = harness();
  w.contact(1);
  w.contact(2);
  w.contact(3);
  w.contact(4);
  w.addRecord({ id: "rec_nomail", type: "contact", fields: { name: "No address" } });
  w.addRecord({ id: "rec_upper", type: "contact", fields: { name: "Upper", email: "  UPPER@Client.Example " } });
  w.state.dndRefused.add("rec_c002");
  w.state.suppressed.add("p3@client.example");
  const { campaignId } = await build(w, { audience: false });
  const out = await run<{ count: number; excluded: number }>(w.ctx, "campaigns.audience_set", { campaignId, type: "contact" });
  assert.deepEqual(out, { count: 3, excluded: 3 });
  const members = w.db.rows("campaigns_member").sort((a, b) => String(a.record_id).localeCompare(String(b.record_id)));
  assert.deepEqual(members.map((m) => [m.record_id, m.address, m.state]), [["rec_c001", "p1@client.example", "active"], ["rec_c004", "p4@client.example", "active"], ["rec_upper", "upper@client.example", "active"]]);
  const screen = w.calls.find((c) => c.cap === "contacts.dnd_screen")!;
  assert.equal(screen.input.context, "campaign");
  assert.equal(screen.input.contextId, campaignId);
  assert.equal(screen.input.candidates.length, 5, "the contact with no address never reaches screening");
  assert.equal((await run<{ campaign: Row }>(w.ctx, "campaigns.get", { campaignId })).campaign.audienceCount, 3);
});

test("audience adds only: a second run keeps everyone, adds the new, and never removes", async () => {
  const w = harness();
  w.contact(1);
  w.contact(2);
  const { campaignId } = await build(w);
  assert.equal(w.db.rows("campaigns_member").length, 2);
  w.contact(3);
  w.state.dndRefused.add("rec_c001");
  const out = await run<{ count: number; excluded: number }>(w.ctx, "campaigns.audience_set", { campaignId, type: "contact" });
  assert.equal(out.count, 3, "rec_c001 is now Do-not-contact, but screening never removes someone already in");
  assert.deepEqual(w.db.rows("campaigns_member").map((m) => m.record_id).sort(), ["rec_c001", "rec_c002", "rec_c003"]);
  assert.equal(w.calls.filter((c) => c.cap === "contacts.dnd_screen").at(-1)!.input.candidates.length, 1, "only the new contact is screened");
});

test("audience from a view combines the view's filter with the one given", async () => {
  const w = harness();
  w.contact(1, { stage: "lead", city: "Roseville" });
  w.contact(2, { stage: "lead", city: "Reno" });
  w.contact(3, { stage: "client", city: "Roseville" });
  w.views.set("viw_leads", { type: "contact", filter: { field: "stage", op: "eq", value: "lead" } });
  const { campaignId } = await build(w, { audience: false });
  const both = await run<{ count: number }>(w.ctx, "campaigns.audience_set", { campaignId, type: "contact", viewId: "viw_leads", filter: { field: "city", op: "eq", value: "Roseville" } });
  assert.equal(both.count, 1);
  assert.deepEqual(w.db.rows("campaigns_member").map((m) => m.record_id), ["rec_c001"]);
  const q = w.calls.filter((c) => c.cap === "records.query").at(-1)!.input;
  assert.deepEqual(q.filter, { and: [{ field: "stage", op: "eq", value: "lead" }, { field: "city", op: "eq", value: "Roseville" }] });
  const got = await run<{ audienceViewId: string }>(w.ctx, "campaigns.get", { campaignId });
  assert.equal(got.audienceViewId, "viw_leads");
  assert.equal(await code(run(w.ctx, "campaigns.audience_set", { campaignId, type: "contact", viewId: "viw_missing" })), "validation.not_found");
  w.views.set("viw_company", { type: "company" });
  assert.equal(await code(run(w.ctx, "campaigns.audience_set", { campaignId, type: "contact", viewId: "viw_company" })), "validation.bad_input");
});

test("audience: custom field names, a contact's zone, and a cap on size", async () => {
  const w = harness();
  w.addRecord({ id: "rec_a", type: "contact", fields: { work_email: "a@x.example", mobile: "+15550100", tz: "America/Los_Angeles" } });
  w.addRecord({ id: "rec_b", type: "contact", fields: { work_email: "b@x.example", tz: "Mars/Base" } });
  const { campaignId } = await build(w, { audience: false });
  await run(w.ctx, "campaigns.update", { campaignId, settings: { emailField: "work_email", phoneField: "mobile", tzField: "tz" } });
  await run(w.ctx, "campaigns.audience_set", { campaignId, type: "contact" });
  const m = Object.fromEntries(w.db.rows("campaigns_member").map((r) => [String(r.record_id), r]));
  assert.deepEqual([m.rec_a?.address, m.rec_a?.phone, m.rec_a?.tz], ["a@x.example", "+15550100", "America/Los_Angeles"]);
  assert.equal(m.rec_b?.tz, null, "an unknown zone is ignored");
  const big = harness();
  for (let n = 0; n < 5001; n++) big.addRecord({ id: `rec_big${n}`, type: "contact", fields: { email: `b${n}@x.example` } });
  const b = await build(big, { audience: false });
  assert.equal(await code(run(big.ctx, "campaigns.audience_set", { campaignId: b.campaignId, type: "contact" })), "validation.too_large");
  assert.equal(big.db.rows("campaigns_member").length, 0);
});

// ---- steps ------------------------------------------------------------------------------------------------------

const email = (key: string, extra: Record<string, unknown> = {}) => ({ key, type: "email", config: { mailboxId: "mbx_sales", subject: "S", text: "T" }, ...extra });

test("steps: a sequence of email, wait, branch, SMS, task and call task is stored in order and read back", async () => {
  const w = harness();
  const { campaignId } = await build(w, { audience: false });
  const steps = [
    email("one"), { key: "gap", type: "wait", config: { days: 2 } }, { key: "check", type: "branch", config: { on: "open" }, next: ["thanks", "nudge"] },
    email("thanks", { next: [] }), { key: "nudge", type: "sms", config: { numberId: "num_1", body: "Did you see our note?" } },
    { key: "ring", type: "call_task", config: { title: "Call {{name}}" } }, { key: "todo", type: "task", config: { title: "Follow up" } },
  ];
  await run(w.ctx, "campaigns.steps_set", { campaignId, steps });
  const got = await run<{ steps: { key: string; type: string; next?: string[] }[] }>(w.ctx, "campaigns.get", { campaignId });
  assert.deepEqual(got.steps.map((s) => s.key), ["one", "gap", "check", "thanks", "nudge", "ring", "todo"]);
  assert.deepEqual(got.steps[2]!.next, ["thanks", "nudge"]);
  assert.deepEqual(got.steps[3]!.next, []);
  await run(w.ctx, "campaigns.steps_set", { campaignId, steps: [email("only")] });
  assert.deepEqual((await run<{ steps: unknown[] }>(w.ctx, "campaigns.get", { campaignId })).steps.length, 1, "setting steps replaces them");
});

test("steps: bad steps are refused with the field named", async () => {
  const w = harness();
  const { campaignId } = await build(w, { audience: false });
  const set = (steps: unknown) => run(w.ctx, "campaigns.steps_set", { campaignId, steps });
  const bad = async (steps: unknown, label: string) => assert.equal(await code(set(steps)), "validation.bad_input", label);
  await bad([], "none");
  await bad("x", "not a list");
  await bad([{ key: "Bad Key", type: "wait", config: { days: 1 } }], "key");
  await bad([{ key: "a", type: "ping", config: {} }], "type");
  await bad([email("a"), email("a")], "duplicate key");
  await bad([{ key: "a", type: "email", config: { subject: "S", text: "T" } }], "no mailbox");
  await bad([{ key: "a", type: "email", config: { mailboxId: "m", subject: "S" } }], "no body");
  await bad([{ key: "a", type: "sms", config: { numberId: "n" } }], "sms without body");
  await bad([{ key: "a", type: "wait", config: { days: 0 } }], "wait zero");
  await bad([{ key: "a", type: "wait", config: { days: 1, hours: 2 } }], "two units");
  await bad([{ key: "a", type: "wait", config: { days: 400 } }], "too long");
  await bad([{ key: "a", type: "branch", config: { on: "open" }, next: ["b"] }, email("b")], "branch needs two");
  await bad([{ key: "a", type: "branch", config: { on: "love" }, next: ["b", "b"] }, email("b")], "branch on");
  await bad([{ key: "a", type: "task", config: {} }], "task title");
  await bad([email("a", { next: ["zzz"] })], "next points nowhere");
  await bad([email("a", { next: ["b"] }), email("b", { next: ["a"] })], "loop");
  await bad([{ key: "a", type: "branch", config: { on: "open" }, next: ["b", "a"] }, email("b")], "branch loops to itself");
  await bad(Array.from({ length: 51 }, (_x, n) => email(`s${n}`)), "too many");
  assert.equal(w.db.rows("campaigns_step").length, 1, "the steps from build() stand; refused sets changed nothing");
});

test("steps, variants and schedule can change only before launch or while paused", async () => {
  const w = harness();
  w.contact(1);
  const { campaignId } = await build(w, { steps: [EMAIL_STEP, { key: "gap", type: "wait", config: { days: 1 } }, email("later")] });
  await run(w.ctx, "campaigns.launch", { campaignId });
  assert.equal(await code(run(w.ctx, "campaigns.steps_set", { campaignId, steps: [email("x")] })), "validation.precondition_failed");
  assert.equal(await code(run(w.ctx, "campaigns.variants_set", { campaignId, variants: [] })), "validation.precondition_failed");
  assert.equal(await code(run(w.ctx, "campaigns.delete", { campaignId })), "validation.precondition_failed");
  await run(w.ctx, "campaigns.pause", { campaignId });
  await run(w.ctx, "campaigns.steps_set", { campaignId, steps: [email("x")] });
});

// ---- variants -----------------------------------------------------------------------------------------------------

test("A/B variants split the audience by weight, the same way every time, and change one step", async () => {
  const w = harness();
  for (let n = 1; n <= 200; n++) w.contact(n);
  const { campaignId } = await build(w);
  await run(w.ctx, "campaigns.variants_set", { campaignId, variants: [{ key: "a", weight: 1, stepKey: "hello", config: { subject: "A: {{first_name}}" } }, { key: "b", weight: 1, stepKey: "hello", config: { subject: "B: {{first_name}}" } }] });
  const tally = (): Record<string, number> => {
    const t: Record<string, number> = {};
    for (const m of w.db.rows("campaigns_member")) t[String(m.variant)] = (t[String(m.variant)] ?? 0) + 1;
    return t;
  };
  const first = tally();
  assert.equal((first.a ?? 0) + (first.b ?? 0), 200);
  assert.ok((first.a ?? 0) > 70 && (first.b ?? 0) > 70, `a roughly even split: ${JSON.stringify(first)}`);
  const before = w.db.rows("campaigns_member").map((m) => [m.record_id, m.variant].join(":")).sort();
  await run(w.ctx, "campaigns.variants_set", { campaignId, variants: [{ key: "a", weight: 1, stepKey: "hello", config: { subject: "A2" } }, { key: "b", weight: 1, stepKey: "hello", config: { subject: "B2" } }] });
  assert.deepEqual(w.db.rows("campaigns_member").map((m) => [m.record_id, m.variant].join(":")).sort(), before, "same weights, same assignment");
  await run(w.ctx, "campaigns.variants_set", { campaignId, variants: [{ key: "a", weight: 9, stepKey: "hello", config: {} }, { key: "b", weight: 1, stepKey: "hello", config: {} }] });
  const lopsided = tally();
  assert.ok((lopsided.a ?? 0) > 150, `nine to one: ${JSON.stringify(lopsided)}`);
  const got = await run<{ variants: { key: string; weight: number }[] }>(w.ctx, "campaigns.get", { campaignId });
  assert.deepEqual(got.variants.map((v) => [v.key, v.weight]), [["a", 9], ["b", 1]]);
  await run(w.ctx, "campaigns.variants_set", { campaignId, variants: [] });
  assert.ok(w.db.rows("campaigns_member").every((m) => m.variant === null));
});

test("variants: bad variants are refused", async () => {
  const w = harness();
  const { campaignId } = await build(w, { audience: false, steps: [EMAIL_STEP, { key: "wait1", type: "wait", config: { days: 1 } }, email("second")] });
  const set = (variants: unknown) => code(run(w.ctx, "campaigns.variants_set", { campaignId, variants }));
  assert.equal(await set("x"), "validation.bad_input");
  assert.equal(await set([{ key: "a", weight: 0, stepKey: "hello", config: {} }]), "validation.bad_input");
  assert.equal(await set([{ key: "a", weight: 1, stepKey: "wait1", config: {} }]), "validation.bad_input", "a wait step has no message to test");
  assert.equal(await set([{ key: "a", weight: 1, stepKey: "nope", config: {} }]), "validation.bad_input");
  assert.equal(await set([{ key: "a", weight: 1, stepKey: "hello", config: {} }, { key: "a", weight: 1, stepKey: "hello", config: {} }]), "validation.bad_input");
  assert.equal(await set([{ key: "a", weight: 1, stepKey: "hello", config: {} }, { key: "b", weight: 1, stepKey: "second", config: {} }]), "validation.bad_input", "one test changes one step");
  assert.equal(await set([{ key: "a", weight: 1, stepKey: "hello" }]), "validation.bad_input");
});

// ---- windows and schedule -----------------------------------------------------------------------------------------

test("send windows are read in the recipient's zone", () => {
  // NOW is Thursday 10:00 UTC
  assert.equal(inWindow(NOW, DEFAULT_WINDOWS, "UTC"), true);
  assert.equal(inWindow(NOW, DEFAULT_WINDOWS, "America/Los_Angeles"), false, "03:00 in Los Angeles");
  assert.equal(inWindow(NOW, DEFAULT_WINDOWS, "Asia/Tokyo"), false, "19:00 in Tokyo");
  assert.equal(inWindow(NOW, DEFAULT_WINDOWS, "Europe/Berlin"), true, "12:00 in Berlin");
  assert.equal(inWindow(NOW, DEFAULT_WINDOWS, "Nowhere/Land"), true, "an unknown zone falls back to the window's own zone");
  assert.equal(nextOpen(NOW, DEFAULT_WINDOWS, "UTC"), NOW);
  assert.equal(nextOpen(NOW, DEFAULT_WINDOWS, "America/Los_Angeles"), NOW + 6 * HOUR, "09:00 PDT is 16:00 UTC");
  assert.equal(nextOpen(NOW, DEFAULT_WINDOWS, "Asia/Tokyo"), NOW + 14 * HOUR, "Friday 09:00 JST is Friday 00:00 UTC");
  const saturday = NOW + 2 * DAY;
  assert.equal(nextOpen(saturday, DEFAULT_WINDOWS, "UTC"), NOW + 4 * DAY - HOUR, "Saturday 10:00 waits for Monday 09:00");
  assert.equal(nextOpen(NOW, { ...DEFAULT_WINDOWS, days: [] }, "UTC"), NOW + 8 * DAY, "no open day pushes a week out");
  assert.equal(inWindow(NOW + 7 * HOUR, DEFAULT_WINDOWS, "UTC"), false, "17:00 is closed");
  assert.equal(inWindow(NOW - 1 * HOUR, DEFAULT_WINDOWS, "UTC"), true, "09:00 is open");
});

test("schedule_set stores the windows, the hourly throttle and stop on reply; bad values are refused", async () => {
  const w = harness();
  const { campaignId } = await build(w, { audience: false });
  const set = (o: Record<string, unknown>) => run(w.ctx, "campaigns.schedule_set", { campaignId, windows: { days: [1, 2, 3], from: "08:30", to: "16:00" }, stopOnReply: true, ...o });
  await set({ throttlePerHour: 40 });
  const got = await run<{ windows: Record<string, unknown>; throttle: Record<string, unknown> }>(w.ctx, "campaigns.get", { campaignId });
  assert.deepEqual(got.windows, { days: [1, 2, 3], from: "08:30", to: "16:00", tz: "UTC" });
  assert.deepEqual(got.throttle, { perHour: 40, stopOnReply: true });
  await set({ stopOnReply: false, windows: { days: [3, 1, 3], from: "00:00", to: "23:59", tz: "America/New_York" } });
  assert.deepEqual((await run<{ windows: unknown; throttle: unknown }>(w.ctx, "campaigns.get", { campaignId })).windows, { days: [1, 3], from: "00:00", to: "23:59", tz: "America/New_York" });
  for (const bad of [{ throttlePerHour: 0 }, { throttlePerHour: 20_000 }, { stopOnReply: "yes" }, { windows: null }, { windows: { days: [], from: "09:00", to: "17:00" } }, { windows: { days: [7], from: "09:00", to: "17:00" } },
    { windows: { days: [1], from: "17:00", to: "09:00" } }, { windows: { days: [1], from: "9am", to: "5pm" } }, { windows: { days: [1], from: "09:00", to: "17:00", tz: "Mars/Base" } }]) {
    assert.equal(await code(set(bad)), "validation.bad_input", JSON.stringify(bad));
  }
});

// ---- preview and link builder ---------------------------------------------------------------------------------------

test("preview renders the first message for the first contact and counts the audience", async () => {
  const w = harness();
  w.contact(1);
  w.contact(2);
  const { campaignId } = await build(w, { audience: false });
  assert.equal(await code(run(w.ctx, "campaigns.preview", { campaignId: (await build(w, { audience: false, steps: [{ key: "w", type: "wait", config: { days: 1 } }], name: "No message" })).campaignId })), "validation.precondition_failed");
  const empty = await run<{ sample: { subject?: string; body: string }; counts: Record<string, number> }>(w.ctx, "campaigns.preview", { campaignId });
  assert.equal(empty.sample.subject, "Hello Alex");
  assert.deepEqual(empty.counts, { audience: 0, excluded: 0, suppressed: 0 });
  await run(w.ctx, "campaigns.audience_set", { campaignId, type: "contact" });
  w.state.suppressed.add("p2@client.example");
  const full = await run<{ sample: { subject?: string; body: string }; counts: Record<string, number> }>(w.ctx, "campaigns.preview", { campaignId });
  assert.equal(full.sample.subject, "Hello Person");
  assert.equal(full.sample.body, "Hi Person, a note about your matter.");
  assert.deepEqual(full.counts, { audience: 2, excluded: 0, suppressed: 1 });
});

test("preview uses the variant's wording and shows an SMS body without a subject", async () => {
  const w = harness();
  w.contact(1);
  const { campaignId } = await build(w, { steps: [{ key: "text", type: "sms", config: { numberId: "num_1", body: "Hi {{first_name}}" } }] });
  const p = await run<{ sample: { subject?: string; body: string } }>(w.ctx, "campaigns.preview", { campaignId });
  assert.deepEqual(p.sample, { body: "Hi Person" });
  const e = await build(w, { name: "Mail test" });
  await run(w.ctx, "campaigns.variants_set", { campaignId: e.campaignId, variants: [{ key: "a", weight: 1, stepKey: "hello", config: { subject: "Variant {{first_name}}" } }] });
  assert.equal((await run<{ sample: { subject?: string } }>(w.ctx, "campaigns.preview", { campaignId: e.campaignId })).sample.subject, "Variant Person");
});

test("link_build adds UTM tags, keeps what is there, and refuses other addresses", async () => {
  const w = harness();
  const link = (o: Record<string, unknown>) => run<{ url: string }>(w.ctx, "campaigns.link_build", { url: "https://harbor.example/wills?ref=card", source: "Newsletter", medium: "Email", campaign: "Spring 2026", ...o });
  assert.equal((await link({})).url, "https://harbor.example/wills?ref=card&utm_source=newsletter&utm_medium=email&utm_campaign=spring+2026");
  assert.equal((await link({ url: "https://harbor.example/?utm_source=old" })).url, "https://harbor.example/?utm_source=newsletter&utm_medium=email&utm_campaign=spring+2026");
  assert.equal(await code(link({ url: "javascript:alert(1)" })), "validation.bad_input");
  assert.equal(await code(link({ url: "not a url" })), "validation.bad_input");
  assert.equal(await code(link({ source: "" })), "validation.bad_input");
  assert.equal(await code(link({ medium: "x".repeat(101) })), "validation.bad_input");
});
