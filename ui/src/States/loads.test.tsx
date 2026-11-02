// Nothing sits on a loading mark for ever: a failed read is told from a waiting one, the failure draws an error with Retry, Retry reaches the session as one window event, and the quiet
// mark itself says it is taking too long, with Retry, when nothing arrives.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../testing/dom.ts";
import { LoadFailed, RETRY_LOADS_EVENT, failureOf } from "./Loads.tsx";
import { Quiet } from "./Quiet.tsx";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("failureOf tells a failed read from one that is only waiting or done", () => {
  const waiting = { status: "loading" as const };
  const failed = { status: "loading" as const, error: { message: "validation.bad_input", code: "validation.bad_input", traceId: "tr_1" } };
  const ready = { status: "ready" as const, data: {} };
  assert.equal(failureOf(waiting, ready), undefined);
  assert.equal(failureOf(null, undefined), undefined);
  assert.deepEqual(failureOf(waiting, failed, ready), failed.error);
});

test("a failed load draws Couldn't load, the reason and Retry; Retry is one window event the session hears", async () => {
  const restore = installDom();
  const g = globalThis as { dispatchEvent?: unknown; CustomEvent?: unknown };
  const sent: string[] = [];
  g.dispatchEvent = (e: { type: string }) => { sent.push(e.type); return true; };
  g.CustomEvent = class { type: string; constructor(t: string) { this.type = t; } };
  try {
    const root = await mount(createRoot, <LoadFailed what="this chat" failure={{ message: "That is not a thread id.", code: "validation.bad_input", traceId: "tr_2" }} />);
    const text = textOf(find(root, "load-failed"));
    assert.match(text, /Couldn't load this chat/);
    assert.match(text, /That is not a thread id\./);
    await press(find(root, "state-retry"));
    await flush();
    assert.deepEqual(sent, [RETRY_LOADS_EVENT]);
  } finally { delete g.dispatchEvent; delete g.CustomEvent; restore(); }
});

test("the quiet mark says it is taking too long, with Retry, when nothing arrives; Retry asks again and the wait starts over", async () => {
  const restore = installDom();
  let asked = 0;
  try {
    const root = await mount(createRoot, <Quiet delay={0} stall={40} onRetry={() => { asked++; }} />);
    assert.equal(find(root, "quiet-stalled"), null, "not before the wait is up");
    await wait(80); await flush();
    assert.match(textOf(find(root, "quiet-stalled")), /This is taking longer than it should\./);
    await press(find(root, "quiet-retry"));
    await flush();
    assert.equal(asked, 1);
    assert.equal(find(root, "quiet-stalled"), null, "the line goes while it asks again");
    await wait(80); await flush();
    assert.match(textOf(find(root, "quiet-stalled")), /taking longer/, "and comes back if nothing arrives again");
  } finally { restore(); }
});
