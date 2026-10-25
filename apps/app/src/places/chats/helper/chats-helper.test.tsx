// Helper chat: read-only, with an address bar. The page shows the brief, the steps and the result from the kept copy; there is no composer because helpers take no messages;
// a note says so and "Reply in ..." goes to the parent thread. While the helper runs there is Stop. (Mapped from apps/app/tests/chats-helper.test.tsx: lane L9b owns only
// apps/app/src/places/chats/. The Needs you checks of the same packet are in ../needsyou/chats-needsyou.test.tsx.)
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { HelperChat, HelperChatLoading } from "./HelperChat.tsx";
import { READ_ONLY_NOTE, addressParts, blockLine, byOrder, helperStatus, metaLine, parentOf, seconds, stepCount, workSummary } from "./model.ts";
import type { Message, Thread } from "./model.ts";
import { createSample } from "./sample.ts";
import type { Sample, Variant } from "./sample.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const html = (s: Sample): string => clean(renderToStaticMarkup(<HelperChat data={s.data} />));
const at = (s: string, needle: string): number => {
  const i = s.indexOf(needle);
  assert.ok(i >= 0, `expected ${needle}`);
  return i;
};
const has = (s: string, needle: string): boolean => s.includes(needle);
const inOrder = (s: string, needles: string[]): void => {
  const idx = needles.map((n) => at(s, n));
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, `in the order ${needles.join(" > ")}`);
};
const thread = (s: Sample): Thread => (s.data.screens.query("chats.helper-chat", "thread", { threadId: s.data.threadId }).getSnapshot() as { data: { thread: Thread } }).data.thread;
const messages = (s: Sample): Message[] => (s.data.screens.query("chats.helper-chat", "messages", { threadId: s.data.threadId }).getSnapshot() as { data: { messages: Message[] } }).data.messages;

test("the address bar reads Competitor pricing > Firms 1-3; the first part links back, the last is where you are", () => {
  const out = html(createSample("done"));
  inOrder(out, ['data-testid="helper-address"', "Competitor pricing", "›", "Firms 1–3"]);
  assert.ok(has(out, 'data-testid="helper-crumb-c2"'), "the parent is a link");
  assert.ok(has(out, 'data-testid="helper-current"') && !has(out, 'data-testid="helper-crumb-h1"'), "the helper itself is not a link");
  assert.ok(has(out, "Back to Competitor pricing"));
});

test("a helper chat is read-only: no composer, a note that says why, and a way to reply in the parent", () => {
  const out = html(createSample("done"));
  assert.ok(!/<(textarea|input)\b/.test(out), "no text field anywhere on the page");
  assert.ok(!has(out, 'data-testid="composer"') && !has(out, "contenteditable"));
  assert.ok(has(out, 'data-testid="helper-readonly"') && has(out, READ_ONLY_NOTE));
  assert.ok(has(out, 'data-testid="helper-reply"') && has(out, "Reply in “Competitor pricing”"));
  assert.equal(READ_ONLY_NOTE, "Helpers work from their brief and can't take messages.");
});

test("a finished helper: the brief, the steps in order, the result, and model and time on the right", () => {
  const out = html(createSample("done"));
  assert.ok(has(out, "Helper of Research · from “Competitor pricing”"));
  inOrder(out, ["Read the pricing pages of Harlow & Price", "Worked for 31s, 3 steps", "Opened harlowprice.example/pricing", "Opened grantlegal.example/fees", "Opened meyerlaw.example/consult", "Harlow & Price $300 · Grant Legal free first 30 min"]);
  assert.ok(has(out, "headless Chrome") && has(out, "haiku · 31s"));
  assert.ok(!has(out, 'data-testid="helper-stop"') && !has(out, 'data-testid="helper-live"'));
});

test("a running helper shows Working and Stop, and the steps so far", () => {
  const out = html(createSample("running"));
  assert.ok(has(out, 'data-testid="helper-live"') && has(out, ">Working<") && has(out, 'data-testid="helper-stop"'));
  assert.ok(has(out, "Working, 2 steps so far") && has(out, "Searching parcel 104-22-009"));
  assert.ok(has(out, "Helper of Scout · from “County records search”"));
  assert.ok(!has(out, 'data-testid="helper-meta"') || !has(out, "haiku ·"), "no time while it runs");
});

test("Stop calls engine.stop for the helper's thread and the page then shows it done", async () => {
  const s = createSample("running");
  await s.data.call("engine.stop", { threadId: s.data.threadId });
  assert.deepEqual(s.calls, [{ cap: "engine.stop", input: { threadId: "h4" } }]);
  const out = html(s);
  assert.ok(!has(out, 'data-testid="helper-stop"') && !has(out, 'data-testid="helper-live"'));
  assert.ok(has(out, "Worked for"));
});

test("offline: the page says so and still draws the helper from the device", () => {
  const out = html(createSample("done", { online: false }));
  assert.ok(has(out, 'data-testid="helper-offline"') && has(out, "Opened grantlegal.example/fees"));
});

test("before data the page draws a frame of the right size", () => {
  assert.ok(has(clean(renderToStaticMarkup(<HelperChatLoading />)), 'data-testid="helper-loading"'));
  assert.ok(has(clean(renderToStaticMarkup(<HelperChat />)), 'data-testid="helper-loading"'));
});

test("no em dash in any copy", () => {
  assert.ok(!html(createSample("done")).includes(String.fromCharCode(0x2014)));
});

/* ---------- the rules behind it ---------- */

test("status: running until the thread closes; an error block makes it failed", () => {
  const s = createSample("done");
  const t = thread(s);
  const m = messages(s);
  assert.equal(helperStatus(t, m), "done");
  const { closedAt: _c, ...open } = t;
  assert.equal(helperStatus(open, m), "running");
  const bad: Message[] = m.map((x) => ({ ...x, blocks: x.blocks.map((b, i) => (i === 0 ? { ...b, state: "error" as const } : b)) }));
  assert.equal(helperStatus(t, bad), "failed");
});

test("address parts: ancestors link, the helper is current; without a path it is just the title", () => {
  const t = thread(createSample("done"));
  assert.deepEqual(addressParts(t).map((p) => [p.title, p.current]), [["Competitor pricing", false], ["Firms 1–3", true]]);
  const { path: _p, ...bare } = t;
  assert.deepEqual(addressParts(bare).map((p) => [p.title, p.current]), [["Firms 1–3", true]]);
  assert.deepEqual(parentOf(t), { title: "Competitor pricing", threadId: "c2" });
  assert.deepEqual(parentOf(bare), { title: "the chat", threadId: "c2" });
  const { parentThreadId: _q, ...orphan } = bare;
  assert.equal(parentOf(orphan), null);
});

test("meta, seconds, step count and the work summary", () => {
  const s = createSample("done");
  const t = thread(s);
  const m = byOrder(messages(s));
  assert.equal(seconds(t), 31);
  assert.equal(metaLine(t, "done"), "haiku · 31s");
  assert.equal(metaLine(t, "running"), "");
  assert.equal(stepCount(m), 3);
  assert.equal(workSummary(t, m, "done"), "Worked for 31s, 3 steps");
  assert.equal(workSummary(t, m.slice(0, 1), "running"), "Working, 0 steps so far");
  assert.equal(workSummary(t, [{ ...m[1]!, blocks: m[1]!.blocks.slice(0, 1) }], "done"), "Worked for 31s, 1 step");
});

test("a block line reads from the registry's template for a known type and from its own title for any other", () => {
  assert.deepEqual(blockLine({ type: "terminal", v: 1, id: "a", data: { host: "Intake computer" }, traceId: "t" }), { title: "Ran commands on Intake computer", sub: "", state: undefined });
  assert.deepEqual(blockLine({ type: "step", v: 1, id: "b", data: { title: "Opened a page", sub: "headless Chrome" }, state: "done", traceId: "t" }), { title: "Opened a page", sub: "headless Chrome", state: "done" });
  assert.equal(blockLine({ type: "comet_trail", v: 1, id: "c", data: null, traceId: "t" }).title, "comet trail");
});

test("variants exist for the screenshots", () => {
  const variants: Variant[] = ["done", "running"];
  for (const v of variants) assert.ok(createSample(v).data.threadId.length > 0, v);
});
