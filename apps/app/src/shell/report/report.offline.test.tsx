// Path mapping: the packet lists apps/app/tests/report*.test.tsx, outside lane L9a (lanes-check); the tests live beside the code.
// P-L9_16 offline: Send while offline queues reports.submit and sends it on reconnect with the original trace ids.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportController } from "./controller.ts";
import { ReportSheet } from "./ReportSheet.tsx";
import { createSampleDeps } from "./sample.ts";

const ctx = { place: "inbox", itemId: "thr_3" } as const;

test("offline Send queues a pending reports.submit op and does not call the server", async () => {
  const run = createSampleDeps({ online: false });
  const ctl = new ReportController(run.deps);
  ctl.open(ctx);
  ctl.setNote("It froze");
  await ctl.send();
  assert.equal(run.submitted.length, 0);
  const ops = run.outbox.list();
  assert.equal(ops.length, 1);
  assert.equal(ops[0]?.cap, "reports.submit");
  assert.equal(ops[0]?.input.bundle.note, "It froze");
  assert.equal(ops[0]?.traceId, ops[0]?.input.bundle.traceIds.at(-1) ?? null);
  assert.equal(ctl.getState().status, "queued");
  assert.equal(ctl.getState().waiting, 1);
  const html = renderToStaticMarkup(<ReportSheet controller={ctl} online={false} autoFocus={false} />);
  assert.match(html, /Queued · it sends when you are back online/);
  assert.match(html, /1 change waiting/);
});

test("on reconnect the queued report is submitted with the trace ids it was built with, not the newer ones", async () => {
  const run = createSampleDeps({ online: false });
  const ctl = new ReportController(run.deps);
  ctl.open(ctx);
  await ctl.send();
  const original = run.outbox.list()[0]?.input.bundle.traceIds.slice();
  const key = run.outbox.list()[0]?.input.idempotencyKey;
  assert.equal(original?.length, 20);
  for (let i = 0; i < 5; i++) run.captures.noteAction(`tr_after_${i}`);
  run.setOnline(true);
  await ctl.reconnect();
  assert.equal(run.submitted.length, 1);
  assert.deepEqual(run.submitted[0]?.bundle.traceIds, original);
  assert.equal(run.submitted[0]?.idempotencyKey, key, "the same idempotency key, so a retry cannot file it twice");
  assert.equal(run.outbox.list().length, 0);
  assert.equal(ctl.getState().waiting, 0);
  assert.equal(ctl.getState().status, "sent", "an open sheet turns from Queued to Sent");
});

test("queued reports go in the order they were made; a failure stops the run and keeps the rest", async () => {
  const run = createSampleDeps({ online: false });
  const a = new ReportController(run.deps);
  a.open({ place: "home" });
  a.setNote("first");
  await a.send();
  a.close();
  const b = new ReportController(run.deps);
  b.open({ place: "files" });
  b.setNote("second");
  await b.send();
  assert.deepEqual(run.outbox.list().map((o) => o.input.bundle.note), ["first", "second"]);
  run.setOnline(true);
  let calls = 0;
  const flaky = { ...run.deps, submit: async (i: Parameters<typeof run.deps.submit>[0]) => { calls += 1; if (calls === 2) throw new Error("down"); return run.deps.submit(i); } };
  const ctl = new ReportController(flaky);
  await ctl.reconnect();
  assert.deepEqual(run.submitted.map((s) => s.bundle.note), ["first"]);
  assert.deepEqual(run.outbox.list().map((o) => o.input.bundle.note), ["second"]);
  assert.equal(ctl.getState().waiting, 1);
  await ctl.reconnect();
  assert.deepEqual(run.submitted.map((s) => s.bundle.note), ["first", "second"]);
  assert.equal(run.outbox.list().length, 0);
});

test("reconnect with nothing queued does nothing", async () => {
  const run = createSampleDeps();
  const ctl = new ReportController(run.deps);
  await ctl.reconnect();
  assert.equal(run.submitted.length, 0);
});

test("the sheet offline says Send queues the report", () => {
  const run = createSampleDeps({ online: false });
  const ctl = new ReportController(run.deps);
  ctl.open(ctx);
  assert.match(renderToStaticMarkup(<ReportSheet controller={ctl} online={false} autoFocus={false} />), /You are offline\. Send queues the report/);
});
