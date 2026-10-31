// Report a problem is mounted in the shell: the error panel's event opens the sheet with the failed action's trace id, and Send submits it through reports.submit.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press } from "../../../../../ui/src/testing/dom.ts";
import { ReportHost } from "./ReportHost.tsx";
import { REPORT_PROBLEM_EVENT } from "../../../../../ui/src/States/index.tsx";
import type { CapCall } from "../session/caps.ts";

test("the error panel's Report a problem opens the sheet with the trace id, and Send submits it", async () => {
  const win = Object.assign(new EventTarget(), { Image: class { set src(_v: string) { /* never loads */ } } });
  (globalThis as { window?: unknown }).window = win;
  const restore = installDom();
  const calls: { cap: string; input: unknown }[] = [];
  const call = (async (cap: string, input?: unknown) => {
    calls.push({ cap, input });
    if (cap === "reports.policy_get") return { policy: "on" };
    if (cap === "reports.submit") return { reportId: "rpt_1", taskId: "tsk_1", sentToVyre: true };
    return {};
  }) as unknown as CapCall;
  try {
    const root = await mount(createRoot, <ReportHost call={call} place="files" />);
    assert.equal(find(root, "report-disclosure"), null, "closed at first");
    win.dispatchEvent(Object.assign(new Event(REPORT_PROBLEM_EVENT), { detail: { traceId: "tr_8f2a91", code: "files.list", message: "Could not load Files" } }));
    await flush();
    assert.ok(find(root, "report-disclosure"), "the sheet is open");
    await press(find(root, "report-send"));
    await flush(); await flush();
    const submit = calls.find((c) => c.cap === "reports.submit")?.input as { bundle: { context: { place: string; itemId?: string }; traceIds: string[] } };
    assert.ok(submit, "reports.submit was called");
    assert.equal(submit.bundle.context.place, "files");
    assert.equal(submit.bundle.context.itemId, "tr_8f2a91", "the failed action's trace id is on the report");
  } finally { delete (globalThis as { window?: unknown }).window; restore(); }
});

test("with no session the sheet still opens from an error panel and Send queues the report", async () => {
  const win = Object.assign(new EventTarget(), { Image: class { set src(_v: string) { /* never loads */ } } });
  (globalThis as { window?: unknown }).window = win;
  const restore = installDom();
  try {
    const root = await mount(createRoot, <ReportHost call={null} place="files" />);
    win.dispatchEvent(Object.assign(new Event(REPORT_PROBLEM_EVENT), { detail: { traceId: "tr_1", message: "Could not reach the Space" } }));
    await flush();
    assert.ok(find(root, "report-disclosure"), "the sheet is open");
    assert.ok(find(root, "report-offline"), "it says Send queues the report");
    await press(find(root, "report-send"));
    await flush(); await flush();
    assert.ok(find(root, "report-result"), "the result shows (Queued)");
  } finally { delete (globalThis as { window?: unknown }).window; restore(); }
});
