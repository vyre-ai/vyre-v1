// A plain helper row while the helper waits for a person (gate blocker, 12 Nov): it said "Working" with a clock that kept running while the helper sat on a held call. It says Needs you and what
// for, from the live crew read; the approval card itself is the helper's message in the same chat.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, installDom, mount, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { HelperRow } from "./helper-row.tsx";

const block = { id: "b1", state: "running" as const, data: { title: "Rates on the web", helperThreadId: "thr_h1", status: "running" } };   // no start time: no ticking clock in a test

test("a waiting helper's row says Needs you and what it waits for; a working one says Working", async () => {
  const off = installDom();
  try {
    const waiting = await mount(createRoot, <HelperRow block={block as never} onOpen={() => undefined} waiting="Needs your OK to open harborquotes.com" />);
    assert.equal(textOf(find(waiting, "helper-row-b1-state")), "Needs you");
    assert.equal(textOf(find(waiting, "helper-row-b1-waiting")), "Needs your OK to open harborquotes.com");
    const working = await mount(createRoot, <HelperRow block={block as never} onOpen={() => undefined} />);
    assert.doesNotMatch(textOf(find(working, "helper-row-b1-state")), /Needs you/);
    assert.equal(find(working, "helper-row-b1-waiting"), null);
  } finally { off(); }
});
