// Home's first line: the words, the counts it names, and a render that is true with no assistant and says nothing when nothing could be read.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { HomeDataProvider } from "./data.tsx";
import type { HomeData } from "./data.tsx";
import { SinceLine } from "./SinceLine.tsx";
import { lead, lineParts, sinceWord } from "./since.ts";

const FRI = Date.UTC(2026, 9, 30, 9, 0);   // Friday 30 Oct 2026, 09:00
const DAY = 86_400_000;

test("the since word is how the person would say it", () => {
  const c = { now: FRI, offsetMin: 0 };
  assert.equal(sinceWord(FRI - 2 * 3_600_000, c), "this morning");
  assert.equal(sinceWord(FRI - DAY, c), "yesterday");
  assert.equal(sinceWord(FRI - 3 * DAY, c), "Tuesday");
  assert.equal(sinceWord(FRI - 9 * DAY, c), "a while ago");
});

test("the line names only what is counted, what waits on the person first, and reads well when nothing did", () => {
  const parts = lineParts({ waiting: 2, unread: 1, match: 0, changes: 4 });
  assert.deepEqual(parts.map((p) => p.text), ["2 tasks wait on you", "1 unread message", "4 records you follow changed"]);
  assert.equal(lineParts({ waiting: 1, unread: 0, match: 3, changes: 0 }).map((p) => p.text).join("|"), "1 task waits on you|3 senders to match");
  assert.equal(lead(parts, "Friday"), "Since Friday:");
  assert.equal(lead([], "Friday"), "All quiet since Friday.");
});

function data(answers: Record<string, unknown>, opened: string[]): HomeData {
  return {
    call: async (cap: string) => { if (cap in answers) return answers[cap]; throw new Error("no"); }, clock: () => ({ now: FRI, offsetMin: 0 }),
    nav: { openNeedsYou: () => void opened.push("needs"), openActivity: () => void opened.push("activity"), openInbox: (w: string) => void opened.push(`inbox:${w}`) },
  } as unknown as HomeData;
}
async function show(d: HomeData): Promise<{ root: ReturnType<typeof createRoot>; node: import("../../../../../../ui/src/testing/dom.ts").Node }> {
  const root = createRoot();
  await act(async () => { root.render(<HomeDataProvider value={d}><SinceLine /></HomeDataProvider>); });
  await flush();
  return { root, node: root.container as never };
}

test("the line is built from the three reads, and each part opens where it lives", async () => {
  const restore = installDom();
  const opened: string[] = [];
  const { root, node } = await show(data({
    "home.activity": { items: [{ kind: "record_change", title: "a", line: "b" }, { kind: "record_change", title: "c", line: "d" }, { kind: "finished", title: "e", line: "f" }] },
    "inbox.counts": { byInbox: [], total: 5, needsMatch: 1 }, "tasks.needs_you": { items: [], total: 2 },
  }, opened));
  try {
    assert.match(textOf(find(node, "home-since")), /Since yesterday: 2 tasks wait on you, 5 unread messages, 1 sender to match, 2 records you follow changed\./);
    await press(find(node, "since-waiting")); await press(find(node, "since-unread")); await press(find(node, "since-match")); await press(find(node, "since-changes"));
    assert.deepEqual(opened, ["needs", "inbox:unread", "inbox:match", "activity"]);
  } finally { await act(async () => { root.unmount(); }); restore(); }
});

test("nothing counted reads as all quiet, and nothing readable says nothing at all", async () => {
  const restore = installDom();
  const quiet = await show(data({ "home.activity": { items: [] }, "inbox.counts": { byInbox: [], total: 0, needsMatch: 0 }, "tasks.needs_you": { items: [], total: 0 } }, []));
  try { assert.match(textOf(find(quiet.node, "home-since")), /^All quiet since yesterday\.$/); } finally { await act(async () => { quiet.root.unmount(); }); }
  const dark = await show(data({}, []));
  try { assert.equal(find(dark.node, "home-since"), null, "offline or no access: no false all-clear"); } finally { await act(async () => { dark.root.unmount(); }); restore(); }
});
