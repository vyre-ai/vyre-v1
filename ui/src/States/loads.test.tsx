// Nothing sits on a loading mark for ever: a failed read is told from a waiting one, the failure draws an error with Retry, Retry reaches the session as one window event, and the quiet
// mark itself says it is taking too long, with Retry, when nothing arrives.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../testing/dom.ts";
import { BACK_TO_START_EVENT, LoadFailed, RETRY_LOADS_EVENT, failureOf, isRefused } from "./Loads.tsx";
import { Quiet } from "./Quiet.tsx";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("failureOf tells a failed read from one that is only waiting or done", () => {
  const waiting = { status: "loading" as const };
  const failed = {
    status: "loading" as const,
    error: { message: "validation.bad_input", code: "validation.bad_input", traceId: "tr_1" },
  };
  const ready = { status: "ready" as const, data: {} };
  assert.equal(failureOf(waiting, ready), undefined);
  assert.equal(failureOf(null, undefined), undefined);
  assert.deepEqual(failureOf(waiting, failed, ready), failed.error);
});

test("a failed load draws Couldn't load, the reason and Retry; Retry is one window event the session hears", async () => {
  const restore = installDom();
  const g = globalThis as { dispatchEvent?: unknown; CustomEvent?: unknown };
  const sent: string[] = [];
  g.dispatchEvent = (e: { type: string }) => {
    sent.push(e.type);
    return true;
  };
  g.CustomEvent = class {
    type: string;
    constructor(t: string) {
      this.type = t;
    }
  };
  try {
    const root = await mount(
      createRoot,
      <LoadFailed
        what="this chat"
        failure={{ message: "That is not a thread id.", code: "validation.bad_input", traceId: "tr_2" }}
      />,
    );
    const text = textOf(find(root, "load-failed"));
    assert.match(text, /Couldn't load this chat/);
    assert.match(text, /That is not a thread id\./);
    await press(find(root, "state-retry"));
    await flush();
    assert.deepEqual(sent, [RETRY_LOADS_EVENT]);
  } finally {
    delete g.dispatchEvent;
    delete g.CustomEvent;
    restore();
  }
});

test("the quiet mark says it is taking too long, with Retry, when nothing arrives; Retry asks again and the wait starts over", async () => {
  const restore = installDom();
  let asked = 0;
  try {
    const root = await mount(
      createRoot,
      <Quiet
        delay={0}
        stall={40}
        onRetry={() => {
          asked++;
        }}
      />,
    );
    assert.equal(find(root, "quiet-stalled"), null, "not before the wait is up");
    await wait(80);
    await flush();
    assert.match(textOf(find(root, "quiet-stalled")), /This is taking longer than it should\./);
    await press(find(root, "quiet-retry"));
    await flush();
    assert.equal(asked, 1);
    assert.equal(find(root, "quiet-stalled"), null, "the line goes while it asks again");
    await wait(80);
    await flush();
    assert.match(textOf(find(root, "quiet-stalled")), /taking longer/, "and comes back if nothing arrives again");
  } finally {
    restore();
  }
});

// K9 guard (13 Nov 2026): Retry appears only where trying again can work. A read the server refused (not yours, not found) says so in plain words and never offers Retry.
const REFUSED = ["permission.no_grant", "permission.denied", "permission.not_found", "validation.not_found"];
const WAITABLE = ["internal.error", "provider.unavailable", "timeout", "validation.bad_input", ""];

test("a refused read never renders Retry and says in plain words that the person cannot open it", async () => {
  const restore = installDom();
  try {
    for (const code of REFUSED) {
      assert.equal(isRefused({ message: "x", code }), true, code);
      const root = await mount(createRoot, <LoadFailed what="this chat" failure={{ message: "That chat does not exist or is not yours.", code }} />);
      const text = textOf(find(root, "load-failed"));
      assert.equal(find(root, "state-retry"), null, `${code}: no Retry on a refusal`);
      assert.match(text, /You can't open this chat/, code);
      assert.doesNotMatch(text, /Couldn't load|does not exist/, code);
    }
  } finally { restore(); }
});

test("a read that can work on a second try keeps its Retry", async () => {
  const restore = installDom();
  try {
    for (const code of WAITABLE) {
      assert.equal(isRefused({ message: "x", code }), false, code);
      const root = await mount(createRoot, <LoadFailed what="this chat" failure={{ message: "It broke.", ...(code ? { code } : {}) }} />);
      assert.ok(find(root, "state-retry"), `${code || "no code"}: Retry stays`);
    }
  } finally { restore(); }
});

// C (review, 13 Nov): a refusal is a dead end unless it offers the way out; "what needs you" cannot be refused by a person, so its read failing keeps Retry.
test("a refused read offers Back to Chats, which sends the one event the place hears; what needs you keeps Retry", async () => {
  const restore = installDom();
  const g = globalThis as { dispatchEvent?: unknown; CustomEvent?: unknown };
  const sent: string[] = [];
  g.dispatchEvent = (e: { type: string }) => { sent.push(e.type); return true; };
  g.CustomEvent = class { type: string; constructor(t: string) { this.type = t; } };
  try {
    const refused = await mount(createRoot, <LoadFailed what="this chat" failure={{ message: "x", code: "validation.not_found" }} />);
    assert.match(textOf(find(refused, "state-action")), /Back to Chats/);
    await press(find(refused, "state-action"));
    await flush();
    assert.deepEqual(sent, [BACK_TO_START_EVENT]);
    const needs = await mount(createRoot, <LoadFailed what="what needs you" refusable={false} failure={{ message: "x", code: "validation.not_found" }} />);
    assert.ok(find(needs, "state-retry"), "a list that cannot be refused keeps Retry");
    assert.equal(find(needs, "state-action"), null);
    assert.match(textOf(find(needs, "load-failed")), /Couldn't load what needs you/);
  } finally { delete g.dispatchEvent; delete g.CustomEvent; restore(); }
});
