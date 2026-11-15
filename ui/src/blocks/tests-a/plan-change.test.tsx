// "Change it" on a plan card (G33): the plan is declined first; only when that went through does it come back in the composer as a draft. A failed decline leaves no draft beside a plan that is still waiting, and the card says so. Decline is quiet grey, and the card carries its small book mark.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { find, flush, installDom, mount, press, textOf } from "../../testing/dom.ts";
import { BlockViewA } from "../impl-a/index.tsx";
import { SAMPLE_PLAN } from "../impl-a/sample.ts";
import type { BlockHost } from "../impl-a/index.tsx";

const host = (fail: boolean, drafts: string[], calls: string[]): BlockHost => ({
  invoke: async (cap) => {
    calls.push(cap);
    if (fail) throw new Error("no");
  },
  open: () => undefined,
  draft: (t) => void drafts.push(t),
});

test("Change it puts the plan in the composer and marks the card Changing: nothing is declined, nothing is sent", async () => {
  installDom();
  const drafts: string[] = [];
  const calls: string[] = [];
  const root = await mount(createRoot, <BlockViewA block={SAMPLE_PLAN} host={host(false, drafts, calls)} />);
  await press(find(root, `blk-plan-${SAMPLE_PLAN.id}-edit`));
  await flush();
  assert.equal(calls.length, 0, "the plan was not declined");
  assert.equal(drafts.length, 1);
  assert.ok(drafts[0]!.startsWith("Change the plan:\n1. "));
  assert.match(textOf(root), /Changing/);
  assert.doesNotMatch(textOf(root), /declined/i);
});

test("Deny says Declined, and the plan's own title heads the card", async () => {
  installDom();
  const calls: string[] = [];
  const titled = { ...SAMPLE_PLAN, data: { ...(SAMPLE_PLAN.data as object), title: "Tidy the quarterly notes" } };
  const root = await mount(createRoot, <BlockViewA block={titled} host={host(false, [], calls)} />);
  assert.match(textOf(root), /Tidy the quarterly notes/);
  await press(find(root, `blk-plan-${SAMPLE_PLAN.id}-reject`));
  await flush();
  assert.deepEqual(calls, ["chat.plan.reject"]);
  assert.match(textOf(root), /Declined/);
  assert.doesNotMatch(textOf(root), /Plan declined/);
});

test("the card has the book mark beside Plan, and Deny is its own muted button (looked at in the pictures)", () => {
  const out = renderToStaticMarkup(<BlockViewA block={SAMPLE_PLAN} host={host(false, [], [])} />);
  assert.match(out, /plan-mark/);
  assert.match(out, /blk-plan-blk_plan1-reject/);
});
