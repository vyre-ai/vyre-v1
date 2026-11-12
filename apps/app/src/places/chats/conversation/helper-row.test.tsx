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

// lead, 12 Nov, H3 and H4: a helper's raised card names the helper, links nowhere, and a reader who may not see the request reads that it waits for the person who asked
test("a raised helper card names the helper, and a reader who cannot read the task gets one plain line", async () => {
  const { helperName, raisedHelperCard } = await import("./MessageView.tsx");
  const raised = { blocks: [{ type: "turn_status", data: { state: "waiting", taskId: "tsk_1" } }, { type: "from_thread", data: { threadId: "thr_h1" } }] };
  assert.equal(raisedHelperCard(raised), true);
  assert.equal(raisedHelperCard({ blocks: [{ type: "turn_status", data: { state: "waiting" } }] }), false);
  const crew = { members: [{ id: "thr_h1", title: "Rates on the web" }, { id: "thr_h2", title: "Plans on the web" }] };
  assert.equal(helperName(raised, "Scout", crew), "Rates on the web (Scout)");
  assert.equal(helperName({ blocks: [{ type: "from_thread", data: { threadId: "thr_h2" } }] }, "Scout", crew), "Plans on the web (Scout)", "two helpers read apart");
  assert.equal(helperName({ blocks: [] }, "Scout", crew), "Scout");
  const { ApprovalCard } = await import("./approval.tsx");
  const off = installDom();
  try {
    const data = { call: async () => { throw Object.assign(new Error("no"), { error: { code: "permission.not_found" } }); }, nav: {}, threadId: "thr_lead", changes: { subscribe: () => () => undefined } } as never;
    const root = await mount(createRoot, <ApprovalCard taskId="tsk_1" agent="Rates on the web (Scout)" agentId="agt_1" data={data} othersLine="Rates on the web (Scout) is waiting for the OK of the person who asked." />);
    assert.equal(textOf(find(root, "approval-others-tsk_1")), "Rates on the web (Scout) is waiting for the OK of the person who asked.");
  } finally { off(); }
});
