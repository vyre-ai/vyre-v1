// reports.preview, reports.submit and the rest of the client half (P-L7b_08; spec 4.18, b9, ARCH 7.14):
// a bundle built over Restricted and sealed rows contains none of their values; the policy On, Ask or Off changes the destination only.
// @reads ../migrations/0001_init.sql

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { NOW, trace, world } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";
import { configureReports, handlers } from "../handlers/index.ts";
import { leaves, redactBundle, REDACTED, scrubber } from "../handlers/submit.ts";
import type { Bundle, ReportsCtx } from "../handlers/submit.ts";
import * as impl from "../impl.ts";

type Fn = (ctx: ReportsCtx, input: never) => Promise<unknown>;
const call = (name: string, ctx: ReportsCtx, input: unknown): Promise<unknown> => {
  const fn = (handlers as unknown as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};
const failed = async (p: Promise<unknown>): Promise<VyreErr> => {
  try { await p; } catch (e) { assert.ok(e instanceof VyreErr, "a typed error"); return e; }
  throw new Error("expected the call to fail");
};

const bundleOf = (o: Partial<Bundle> = {}): Bundle => ({
  context: { place: "Records", itemId: "rec_a1b2", hash: "#/records/rec_a1b2" },
  traceIds: [trace(1), trace(2)],
  events: [{ type: "records.update", at: NOW - 2000, traceId: trace(2) }],
  versions: { app: "1.2.0", server: "1.2.1", device: "mac-14" },
  note: "the save button did nothing",
  ...o,
});

function ready(o: { policy?: string } = {}): World {
  const w = world(o);
  configureReports(w.drivers);
  return w;
}

afterEach(() => configureReports(null));

// ---- redaction

/** A small deterministic generator, so a failing case can be replayed from its number. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const hex = (r: () => number, n: number): string => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join("");

function sensitiveValue(r: () => number): string {
  switch (Math.floor(r() * 6)) {
    case 0: return `${hex(r, 8)}@clients-${hex(r, 3)}.example`;
    case 1: return `${100 + Math.floor(r() * 900)}-${10 + Math.floor(r() * 90)}-${1000 + Math.floor(r() * 9000)}`;
    case 2: return `sk_live_${hex(r, 24)}`;
    case 3: return `Maria ${hex(r, 4)} Okafor`;
    case 4: return `$${1 + Math.floor(r() * 9)},${100 + Math.floor(r() * 900)},000`;
    default: return `+1 (${200 + Math.floor(r() * 700)}) ${100 + Math.floor(r() * 900)}-${1000 + Math.floor(r() * 9000)}`;
  }
}

/** The values of the Space must not appear in any string of the bundle, in any case, nor as digits alone when they are formatted numbers. */
function assertClean(b: unknown, values: readonly string[], label: string): void {
  for (const leaf of leaves(b)) {
    const low = leaf.toLowerCase();
    for (const v of values) {
      assert.ok(!low.includes(v.toLowerCase()), `${label}: "${leaf}" holds "${v}"`);
      const digits = v.replace(/\D/g, "");
      if (digits.length >= 6 && digits !== v) assert.ok(!leaf.includes(digits), `${label}: "${leaf}" holds the digits of "${v}"`);
    }
  }
}

test("redaction property: a bundle built over Restricted and sealed rows contains none of their values", async () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = rng(seed);
    const w = ready();
    const values = Array.from({ length: 1 + Math.floor(r() * 4) }, () => sensitiveValue(r));
    w.sensitive = values;
    const splice = (text: string): string => `${text} ${pick(r, values)} ${r() < 0.5 ? pick(r, values).toUpperCase() : ""} end`;
    const digitsOnly = (v: string): string => v.replace(/\D/g, "");
    const sent = bundleOf({
      context: { place: splice("Records"), itemId: splice("rec_x"), hash: `#/r/${pick(r, values)}` },
      events: [{ type: splice("records.update"), at: NOW, traceId: trace(5) }, { type: digitsOnly(pick(r, values)) || "none", at: NOW }],
      versions: { app: splice("1.2.0"), server: "1.2.1", device: splice("mac") },
      note: splice("it says"),
      errors: [{ code: splice("provider.rate_limited"), message: splice("the model said no to"), at: NOW, traceId: trace(6) }],
      clientLogFileId: "fil_log1",
      screenshotFileId: "fil_shot1",
    });
    // what the person sees before sending
    w.recent.events = [{ type: splice("records.update"), at: NOW }];
    const preview = await call("reports.preview", w.ctx, { context: sent.context, note: sent.note }) as { bundle: Bundle; redactions: number };
    assertClean(preview.bundle, values, `seed ${seed} preview`);
    assert.ok(preview.redactions >= 1, `seed ${seed}: something was removed`);
    // what is stored and sent
    const out = await call("reports.submit", w.ctx, { bundle: sent }) as { reportId: string; sentToVyre: boolean };
    assertClean(JSON.parse(String(w.raw.rows("reports_client_report")[0]!["bundle_json"])), values, `seed ${seed} stored`);
    assert.equal(w.posted.length, 1);
    assertClean(w.posted[0]!.bundle, values, `seed ${seed} posted`);
    const got = await call("reports.get", w.ctx, { reportId: out.reportId }) as { bundle: Bundle };
    assertClean(got.bundle, values, `seed ${seed} get`);
    assert.equal(got.bundle.screenshotFileId, undefined, `seed ${seed}: no screenshot over sensitive values`);
    assertClean(w.tasks, values, `seed ${seed} task`);
  }
});

test("values shorter than four characters are removed as whole words only, longer ones anywhere", () => {
  const s = scrubber(["7", "abc", "Secret99"]);
  assert.equal(s.scrub("page 7 of 17, abc and abcd, my SECRET99!"), `page ${REDACTED} of 17, ${REDACTED} and abcd, my ${REDACTED}!`);
  assert.equal(s.count, 3);
});

test("a formatted number is removed in its digits-only form too", () => {
  const s = scrubber(["123-45-6789"]);
  assert.equal(s.scrub("ssn 123-45-6789 or 123456789"), `ssn ${REDACTED} or ${REDACTED}`);
});

test("a screenshot is kept when the view holds nothing sensitive and dropped when it does", () => {
  const withShot = bundleOf({ screenshotFileId: "fil_shot1" });
  const clean = redactBundle(withShot, []);
  assert.equal(clean.bundle.screenshotFileId, "fil_shot1");
  assert.equal(clean.redactions, 0);
  const dirty = redactBundle(withShot, ["Maria Okafor"]);
  assert.equal(dirty.bundle.screenshotFileId, undefined);
  assert.equal(dirty.redactions, 1);
});

test("the shape is forced to the manifest: 20 trace ids at most, real trace ids only, a note of 500 characters", () => {
  const many = Array.from({ length: 30 }, (_, i) => trace(i + 1));
  const { bundle } = redactBundle(bundleOf({ traceIds: [...many.slice(0, 25), "not-a-trace"], note: "x".repeat(900) }), []);
  assert.deepEqual(bundle.traceIds, many.slice(0, 20));
  assert.equal(bundle.note!.length, 500);
});

// ---- preview and submit

test("preview builds the bundle from the host's recent traces, events and versions", async () => {
  const w = ready();
  w.sensitive = ["Maria Okafor"];
  w.recent.events = [{ type: "note.created for Maria Okafor", at: NOW - 10 }];
  const out = await call("reports.preview", w.ctx, { context: { place: "Records", itemId: "rec_1" }, note: "Maria Okafor's page is blank" }) as { bundle: Bundle; redactions: number };
  assert.deepEqual(out.bundle.traceIds, [trace(1), trace(2), trace(3)]);
  assert.deepEqual(out.bundle.versions, { app: "1.2.0", server: "1.2.1", device: "mac-14" });
  assert.equal(out.bundle.note, `${REDACTED}'s page is blank`);
  assert.equal(out.bundle.events[0]!.type, `note.created for ${REDACTED}`);
  assert.equal(out.redactions, 2);
  assert.deepEqual(w.raw.rows("reports_client_report"), [], "a preview stores nothing");
});

test("submit stores the redacted bundle, makes the Review task for admins and keeps the original trace ids in order", async () => {
  const w = ready();
  const ids = [trace(9), trace(4), trace(7)];
  const out = await call("reports.submit", w.ctx, { bundle: bundleOf({ traceIds: ids }) }) as { reportId: string; taskId: string; sentToVyre: boolean };
  assert.match(out.reportId, /^rpt_[a-z0-9]+$/);
  assert.equal(out.taskId, "tsk_1");
  const task = w.tasks[0] as { kind: string; title: string; assigned: unknown; source: unknown };
  assert.deepEqual([task.kind, task.title, task.assigned, task.source], ["review", "Problem report from Omar", { kind: "role", id: "admin" }, { kind: "manual", id: out.reportId }]);
  const row = w.raw.rows("reports_client_report")[0]!;
  assert.deepEqual([row["status"], row["reporter"], row["task_id"], JSON.parse(String(row["trace_ids"]))], ["sent", "usr_omar", "tsk_1", ids]);
  assert.deepEqual(w.events.map((e) => e.name), ["report.submitted", "report.sent_to_vyre"]);
  assert.deepEqual(w.events[0]!.payload, { reportId: out.reportId, by: "usr_omar", traceIds: ids });
});

test("an incomplete bundle is refused", async () => {
  const w = ready();
  const err = await failed(call("reports.submit", w.ctx, { bundle: { context: {}, versions: {} } }));
  assert.equal(err.error.code, "validation.bad_input");
  assert.deepEqual(w.raw.rows("reports_client_report"), []);
  assert.deepEqual(w.tasks, []);
});

test("policy On posts the redacted bundle; Ask and Off keep the report here: only the destination changes", async () => {
  const stored: Record<string, unknown> = {};
  const results: Record<string, { sentToVyre: boolean }> = {};
  for (const policy of ["on", "ask", "off"]) {
    const w = ready({ policy });
    w.sensitive = ["Maria Okafor", "123-45-6789"];
    const sent = bundleOf({ note: "Maria Okafor 123-45-6789 broke it", screenshotFileId: "fil_shot1" });
    results[policy] = await call("reports.submit", w.ctx, { bundle: sent }) as { sentToVyre: boolean };
    const row = w.raw.rows("reports_client_report")[0]!;
    stored[policy] = JSON.parse(String(row["bundle_json"]));
    assert.equal(row["redactions"], 3);
    assert.equal(w.posted.length, policy === "on" ? 1 : 0, `${policy}: destination`);
    assert.equal(row["status"], policy === "on" ? "sent" : "new");
    assert.equal(row["issue_number"], policy === "on" ? 1234 : null);
    if (policy === "on") assert.deepEqual(w.posted[0]!.bundle, stored[policy], "what is sent is what is stored");
    assert.equal((w.tasks[0] as { summary: string }).summary.includes("Send it to the Vyre team?"), policy === "ask");
    assert.equal((w.tasks[0] as { summary: string }).summary.includes("stays in this Space"), policy === "off");
    assert.equal(w.events.some((e) => e.name === "report.submitted"), true, `${policy}: the admins are told`);
  }
  assert.deepEqual(stored["on"], stored["ask"]);
  assert.deepEqual(stored["on"], stored["off"], "what is captured never changes");
  assert.deepEqual([results["on"]!.sentToVyre, results["ask"]!.sentToVyre, results["off"]!.sentToVyre], [true, false, false]);
});

test("an admin can send an Ask report later; Off refuses to send; a second send changes nothing", async () => {
  const w = ready({ policy: "ask" });
  const { reportId } = await call("reports.submit", w.ctx, { bundle: bundleOf() }) as { reportId: string };
  assert.equal(w.posted.length, 0);
  w.events.length = 0;
  assert.deepEqual(await call("reports.send_to_vyre", w.ctx, { reportId }), { issueNumber: 1234, stored: true });
  assert.deepEqual(w.events.map((e) => e.name), ["report.sent_to_vyre"]);
  assert.deepEqual(w.events[0]!.payload, { reportId, issueNumber: 1234 });
  w.events.length = 0;
  assert.deepEqual(await call("reports.send_to_vyre", w.ctx, { reportId }), { issueNumber: 1234, stored: true });
  assert.equal(w.posted.length, 1);
  assert.deepEqual(w.events, []);
  const off = ready({ policy: "off" });
  const made = await call("reports.submit", off.ctx, { bundle: bundleOf() }) as { reportId: string };
  assert.deepEqual(await call("reports.send_to_vyre", off.ctx, { reportId: made.reportId }), { stored: false });
  assert.equal(off.posted.length, 0);
  assert.equal((await failed(call("reports.send_to_vyre", off.ctx, { reportId: "rpt_nope" }))).error.code, "validation.not_found");
});

test("the service slowing down or being unreachable keeps the report and says what happened", async () => {
  const w = ready({ policy: "ask" });
  const { reportId } = await call("reports.submit", w.ctx, { bundle: bundleOf() }) as { reportId: string };
  w.serviceFails = "rate_limit";
  assert.equal((await failed(call("reports.send_to_vyre", w.ctx, { reportId }))).error.code, "rate_limit.exceeded");
  w.serviceFails = "down";
  assert.equal((await failed(call("reports.send_to_vyre", w.ctx, { reportId }))).error.code, "provider.unavailable");
  assert.equal(w.raw.rows("reports_client_report")[0]!["status"], "new");
  w.serviceFails = null;
  assert.deepEqual(await call("reports.send_to_vyre", w.ctx, { reportId }), { issueNumber: 1234, stored: true });
});

test("a post that fails while submitting does not lose the report", async () => {
  const w = ready();
  w.serviceFails = "down";
  const out = await call("reports.submit", w.ctx, { bundle: bundleOf() }) as { sentToVyre: boolean; reportId: string; taskId: string };
  assert.equal(out.sentToVyre, false);
  assert.equal(w.raw.rows("reports_client_report").length, 1);
  assert.equal(w.tasks.length, 1);
});

// ---- the inbound webhook

test("resolved closes a report this Space sent, with the issue number it was given, and only once", async () => {
  const w = ready();
  const { reportId } = await call("reports.submit", w.ctx, { bundle: bundleOf() }) as { reportId: string };
  w.events.length = 0;
  assert.equal((await failed(call("reports.resolved", w.ctx, { reportId, issueNumber: 999 }))).error.code, "validation.precondition_failed");
  assert.equal((await failed(call("reports.resolved", w.ctx, { reportId: "rpt_nope", issueNumber: 1234 }))).error.code, "validation.not_found");
  assert.deepEqual(w.events, []);
  assert.deepEqual(await call("reports.resolved", w.ctx, { reportId, issueNumber: 1234, fixedIn: "1.2.2" }), { ok: true });
  assert.deepEqual(w.events.map((e) => [e.name, e.payload]), [["report.resolved", { reportId, issueNumber: 1234, fixedIn: "1.2.2" }]]);
  const row = w.raw.rows("reports_client_report")[0]!;
  assert.deepEqual([row["status"], row["fixed_in"]], ["resolved", "1.2.2"]);
  w.events.length = 0;
  assert.deepEqual(await call("reports.resolved", w.ctx, { reportId, issueNumber: 1234 }), { ok: true });
  assert.deepEqual(w.events, [], "a repeated webhook changes nothing");
});

test("a report that was never sent cannot be resolved from outside", async () => {
  const w = ready({ policy: "off" });
  const { reportId } = await call("reports.submit", w.ctx, { bundle: bundleOf() }) as { reportId: string };
  assert.equal((await failed(call("reports.resolved", w.ctx, { reportId, issueNumber: 1234 }))).error.code, "validation.precondition_failed");
  assert.equal(w.raw.rows("reports_client_report")[0]!["status"], "new");
});

// ---- list, get, policy, health

test("a reporter sees their own reports; an admin sees all of them; someone else's report does not exist for a member", async () => {
  const w = ready();
  const a = (await call("reports.submit", w.ctx, { bundle: bundleOf() }) as { reportId: string }).reportId;
  w.setNow(NOW + 1000);
  w.asPerson("usr_ines", []);
  const b = (await call("reports.submit", w.ctx, { bundle: bundleOf({ note: "second" }) }) as { reportId: string }).reportId;
  const mine = await call("reports.list", w.ctx, {}) as { reports: { reportId: string; status: string; issueNumber?: number; title: string }[]; total: number };
  assert.deepEqual(mine.reports.map((r) => r.reportId), [b]);
  assert.equal(mine.total, 1);
  assert.equal((await failed(call("reports.get", w.ctx, { reportId: a }))).error.code, "permission.not_found");
  assert.equal(((await call("reports.get", w.ctx, { reportId: b })) as { status: string }).status, "sent");
  w.asPerson("usr_admin", ["policy.manage"]);
  const all = await call("reports.list", w.ctx, { limit: 1 }) as { reports: { reportId: string }[]; next?: string; total: number };
  assert.deepEqual([all.reports.map((r) => r.reportId), all.next, all.total], [[b], "1", 2]);
  const rest = await call("reports.list", w.ctx, { limit: 1, cursor: "1" }) as { reports: { reportId: string }[]; next?: string };
  assert.deepEqual([rest.reports.map((r) => r.reportId), rest.next], [[a], undefined]);
  assert.equal(((await call("reports.get", w.ctx, { reportId: a })) as { issueNumber: number }).issueNumber, 1234);
});

test("policy get and set go through the setting reports.vyre; the default is On", async () => {
  const w = ready();
  assert.deepEqual(await call("reports.policy_get", w.ctx, {}), { policy: "on" });
  assert.deepEqual(await call("reports.policy_set", w.ctx, { policy: "ask" }), { ok: true });
  assert.equal(w.settings.get("reports.vyre"), "ask");
  assert.deepEqual(await call("reports.policy_get", w.ctx, {}), { policy: "ask" });
  assert.equal((await failed(call("reports.policy_set", w.ctx, { policy: "sometimes" }))).error.code, "validation.bad_input");
  w.settings.set("reports.vyre", "garbage");
  assert.deepEqual(await call("reports.policy_get", w.ctx, {}), { policy: "on" });
});

test("health: reachable and registered, reachable but not registered, unreachable", async () => {
  const w = ready();
  assert.deepEqual(await call("reports.health", w.ctx, {}), { state: "healthy", latencyMs: 0 });
  w.keyRegistered = false;
  const unreg = await call("reports.health", w.ctx, {}) as { state: string; detail: string };
  assert.equal(unreg.state, "degraded");
  assert.match(unreg.detail, /does not know this server's key/);
  w.serviceFails = "down";
  const down = await call("reports.health", w.ctx, {}) as { state: string; detail: string };
  assert.equal(down.state, "down");
  assert.match(down.detail, /cannot be reached/);
});

test("the drivers must be wired", async () => {
  const w = ready();
  configureReports(null);
  assert.equal((await failed(call("reports.preview", w.ctx, { context: { place: "x" } }))).error.code, "internal.unavailable");
});

test("impl.ts registers every reports-client capability as deferred: it refuses with the shared message", async () => {
  const w = world();
  for (const name of Object.keys(impl.handlers)) {
    let err: { error?: { code?: string; message?: string } } | null = null;
    try { await (impl.handlers as Record<string, (c: unknown, i: unknown) => unknown>)[name]!(w.ctx, {}); } catch (e) { err = e as { error?: { code?: string; message?: string } }; }
    assert.equal(err?.error?.code, "internal.unavailable", name);
    assert.equal(err?.error?.message, "Not in this version yet", name);
  }
});

test("impl.ts exposes every reports-client handler, the host wiring and no projections", () => {
  // Report a problem is deferred (ruling 60): impl.handlers carries the same capabilities as the real table, each registered to refuse; the real table stays in handlers/index.ts
  assert.deepEqual(Object.keys(impl.handlers).sort(), Object.keys(handlers).sort());
  assert.equal(impl.configureReports, configureReports);
  assert.equal(typeof impl.configureReplay, "function");
  assert.equal(typeof impl.replayRun, "function");
  assert.deepEqual(impl.projections, []);
  assert.deepEqual(impl.inline, {});
  assert.deepEqual(impl.consumers, {});
  assert.deepEqual(impl.codecs, {});
  assert.deepEqual(Object.keys(impl.handlers).sort(), [
    "reports.get", "reports.health", "reports.list", "reports.policy_get", "reports.policy_set", "reports.preview", "reports.resolved", "reports.send_to_vyre", "reports.submit",
  ]);
});
