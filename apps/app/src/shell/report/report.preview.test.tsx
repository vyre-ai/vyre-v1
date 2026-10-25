// @reads ../../../../../scripts/shots/mounts/P-L9_16.tsx
// Path mapping: the packet lists apps/app/tests/report*.test.tsx, outside lane L9a (lanes-check); the tests live beside the code.
// P-L9_16 preview: the sheet lists exactly the bundle fields, Send submits that same bundle, secrets and Restricted values never leave, Cmd-Shift-/ opens it.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { reportProblem } from "../../../../../ui/src/Menu/index.tsx";
import { REPORT_PROBLEM_EVENT } from "../../../../../ui/src/States/index.tsx";
import { ReportController } from "./controller.ts";
import { ReportSheet } from "./ReportSheet.tsx";
import { buildBundle, scrubText } from "./bundle.ts";
import { installReport } from "./install.ts";
import { isReportKey } from "./keys.ts";
import { Captures, Ring } from "./ring.ts";
import { LEFT_OUT, previewRows } from "./rows.ts";
import { createSampleDeps, sampleCaptures } from "./sample.ts";

const ctx = { place: "records", itemId: "rec_9", hash: "table" } as const;

test("the last 20 trace ids: the 21st pushes out the first, a repeat of the newest is not a second action", () => {
  const c = new Captures();
  for (let i = 0; i < 25; i++) c.noteAction(`tr_${i}`);
  c.noteAction("tr_24");
  const ids = c.snapshot().traceIds;
  assert.equal(ids.length, 20);
  assert.equal(ids[0], "tr_5");
  assert.equal(ids[19], "tr_24");
  const r = new Ring<number>(3);
  [1, 2, 3, 4].forEach((n) => r.push(n));
  assert.deepEqual(r.list(), [2, 3, 4]);
});

test("a snapshot is a copy: actions after the sheet opened do not change the bundle", () => {
  const run = createSampleDeps();
  const ctl = new ReportController(run.deps);
  ctl.open(ctx);
  const before = ctl.getState().bundle?.traceIds.slice();
  run.captures.noteAction("tr_later");
  assert.deepEqual(ctl.getState().bundle?.traceIds, before);
});

test("What is sent lists exactly the bundle's fields, one line each, plus the fixed Left out line", async () => {
  const run = createSampleDeps();
  run.captures.noteError({ code: "net.timeout", message: "Request timed out", at: 1, traceId: "tr_7a3f00" });
  const ctl = new ReportController(run.deps);
  ctl.open(ctx);
  ctl.setNote("The intake form would not send");
  await ctl.send();
  const bundle = run.submitted[0]?.bundle;
  assert.ok(bundle);
  const shown = new Set(ctl.getState().rows.map((r) => r.field));
  for (const key of Object.keys(bundle)) assert.ok(shown.has(key as never), `bundle field ${key} has a line`);
  for (const f of shown) assert.ok(f === "left_out" || f in bundle, `line for ${f} has a bundle field`);
  const labels = ctl.getState().rows.map((r) => r.label);
  assert.deepEqual(labels, ["Where", "Last 20 trace ids", "Recent events", "Recent errors", "Versions", "Device", "Screenshot", "Local log", "What went wrong", "Left out"]);
  assert.equal(ctl.getState().rows.at(-1)?.value, LEFT_OUT);
});

test("Send submits the bundle that was previewed, with the note, and an idempotency key", async () => {
  const run = createSampleDeps();
  const ctl = new ReportController(run.deps);
  ctl.open(ctx);
  ctl.setNote("Nothing happens when I press Save");
  await new Promise((r) => setTimeout(r, 0)); // the screenshot and the log finish attaching, and the preview follows them
  const shown = JSON.stringify(ctl.getState().bundle);
  await ctl.send();
  assert.equal(run.submitted.length, 1);
  assert.equal(JSON.stringify(run.submitted[0]?.bundle), shown);
  assert.match(run.submitted[0]?.idempotencyKey ?? "", /^rpt_/);
  assert.equal(run.submitted[0]?.bundle.screenshotFileId, "fil_shot1");
  assert.equal(run.submitted[0]?.bundle.clientLogFileId, "fil_log1");
  assert.equal(run.submitted[0]?.bundle.traceIds.length, 20);
  assert.equal(ctl.getState().status, "sent");
  assert.equal(ctl.getState().issueNumber, 1234);
});

test("secrets never leave and Restricted values appear as [Restricted: code]", () => {
  const caps = sampleCaptures();
  caps.noteError({ code: "record.save_failed", message: "Save failed for token=abc123supersecretvalue on rec_9", at: 5 });
  caps.noteError({ code: "field.restricted", message: "Fee was 41,500 for Maya Chen", at: 6, restricted: true });
  const built = buildBundle({ context: ctx, snapshot: caps.snapshot(), versions: { app: "1", server: "1", device: "d" }, note: "key is sk-abcdefghijklmnopqrstuv12345 and Bearer abcdefghijklmnop" });
  const text = JSON.stringify(built.bundle);
  assert.ok(!text.includes("abc123supersecretvalue"));
  assert.ok(!text.includes("sk-abcdefghij"));
  assert.ok(!text.includes("Bearer abcdefgh"));
  assert.ok(!text.includes("41,500") && !text.includes("Maya Chen"));
  assert.ok(text.includes("[Restricted: field.restricted]"));
  assert.ok(built.redactions >= 4, `redactions ${built.redactions}`);
  assert.equal(scrubText("nothing secret here").removed, 0);
});

test("a long note is cut to 500 characters", () => {
  const run = createSampleDeps();
  const ctl = new ReportController(run.deps);
  ctl.open(ctx);
  ctl.setNote("x".repeat(900));
  assert.equal(ctl.getState().bundle?.note?.length, 500);
});

test("Cmd-Shift-/ opens the sheet; Cmd and Ctrl are told apart by platform", () => {
  assert.ok(isReportKey({ key: "/", metaKey: true, shiftKey: true }, "mac"));
  assert.ok(isReportKey({ key: "?", metaKey: true, shiftKey: true }, "mac"));
  assert.ok(isReportKey({ key: "?", code: "Slash", ctrlKey: true, shiftKey: true }, "other"));
  assert.ok(!isReportKey({ key: "/", metaKey: true }, "mac"));
  assert.ok(!isReportKey({ key: "/", ctrlKey: true, shiftKey: true }, "mac"));
  assert.ok(!isReportKey({ key: "/", metaKey: true, shiftKey: true, altKey: true }, "mac"));

  const listeners: Record<string, ((e: never) => void)[]> = {};
  const target = {
    addEventListener: (t: string, f: (e: never) => void) => { (listeners[t] ??= []).push(f); },
    removeEventListener: (t: string, f: (e: never) => void) => { listeners[t] = (listeners[t] ?? []).filter((x) => x !== f); },
  };
  const run = createSampleDeps();
  const ctl = new ReportController(run.deps);
  const off = installReport(ctl, { currentPlace: () => "files", platform: "mac", keyTarget: target, eventTarget: target });
  let prevented = false;
  for (const f of listeners["keydown"] ?? []) f({ key: "/", metaKey: true, shiftKey: true, preventDefault: () => { prevented = true; } } as never);
  assert.ok(prevented);
  assert.equal(ctl.getState().open, true);
  assert.equal(ctl.getState().context.place, "files");
  ctl.close();

  reportProblem({ label: "Referral fee log" });
  assert.equal(ctl.getState().open, true, "the shared menu's Report a problem item opens it");
  assert.equal(ctl.getState().context.itemId, "Referral fee log");
  ctl.close();

  for (const f of listeners[REPORT_PROBLEM_EVENT] ?? []) f({ detail: { traceId: "tr_err1", code: "records.load", message: "Couldn't load Records" } } as never);
  assert.equal(ctl.getState().open, true, "an error state's Report a problem opens it");
  assert.equal(ctl.getState().context.itemId, "tr_err1");
  off();
  assert.equal((listeners["keydown"] ?? []).length, 0);
});

test("the sheet shows the one optional line, the expandable list, Cancel and Send", () => {
  const run = createSampleDeps();
  const ctl = new ReportController(run.deps);
  ctl.open(ctx);
  const closed = renderToStaticMarkup(<ReportSheet controller={ctl} autoFocus={false} />);
  assert.match(closed, /placeholder="What went wrong\? \(optional\)"/);
  assert.match(closed, /data-testid="report-send"/);
  assert.match(closed, /data-testid="report-cancel"/);
  assert.ok(!closed.includes('data-testid="report-facts"'), "the list is collapsed until asked for");
  ctl.toggleExpanded();
  const open = renderToStaticMarkup(<ReportSheet controller={ctl} autoFocus={false} />);
  for (const label of ["Where", "Last 20 trace ids", "Versions", "Device", "Screenshot", "Local log", "Left out"]) assert.ok(open.includes(`>${label}<`), label);
  assert.ok(open.includes("tr_7a3f00"));
  assert.ok(open.includes("Records · rec_9 · #table"));
  assert.ok(open.includes("window 1280×800"));
});

test("after Send the sheet says Sent with the issue number and who has the report", async () => {
  const run = createSampleDeps();
  const ctl = new ReportController(run.deps);
  ctl.open(ctx);
  await ctl.send();
  const html = renderToStaticMarkup(<ReportSheet controller={ctl} autoFocus={false} />);
  assert.match(html, /Sent · #1234 · the Vyre team and your admins have it/);
  assert.match(html, /You will get a reply in your Inbox when it is fixed/);
  run.setPolicy("off");
  const off = new ReportController(run.deps);
  off.open(ctx);
  await off.send();
  assert.match(renderToStaticMarkup(<ReportSheet controller={off} autoFocus={false} />), /your admins have it/);
});

test("policy Ask: the sheet asks, and only a yes sends to the Vyre team", async () => {
  const run = createSampleDeps({ policy: "ask" });
  const ctl = new ReportController(run.deps);
  ctl.open(ctx);
  assert.match(renderToStaticMarkup(<ReportSheet controller={ctl} autoFocus={false} />), /Also send to the Vyre team/);
  await ctl.send();
  assert.deepEqual(run.sentToVyre, []);
  const yes = new ReportController(run.deps);
  yes.open(ctx);
  yes.setShare(true);
  await yes.send();
  assert.deepEqual(run.sentToVyre, ["rpt_2"]);
  assert.equal(yes.getState().issueNumber, 1234);
  const off = createSampleDeps({ policy: "off" });
  const o = new ReportController(off.deps);
  o.open(ctx);
  assert.ok(!renderToStaticMarkup(<ReportSheet controller={o} autoFocus={false} />).includes("Also send to the Vyre team"));
});

test("a failed send says so and can be tried again", async () => {
  const run = createSampleDeps({ failSubmit: true });
  const ctl = new ReportController(run.deps);
  ctl.open(ctx);
  await ctl.send();
  assert.equal(ctl.getState().status, "error");
  assert.match(renderToStaticMarkup(<ReportSheet controller={ctl} autoFocus={false} />), /It did not send: server unavailable/);
});

test("previewRows without screenshot or log say Not attached, with no note line", () => {
  const rows = previewRows({ context: { place: "home" }, traceIds: [], events: [], versions: { app: "1", server: "1", device: "d" } }, "Home");
  assert.equal(rows.find((r) => r.label === "Screenshot")?.value, "Not attached");
  assert.equal(rows.find((r) => r.label === "Last 20 trace ids")?.value, "None yet");
  assert.ok(!rows.some((r) => r.label === "What went wrong"));
});
