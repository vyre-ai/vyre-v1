// An artifact published for this person while the chat is open opens in a tab, once (artifact-open.ts); the chat reports itself open while it is mounted.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { installDom } from "../../../../../../ui/src/testing/dom.ts";
import { FRESH_MS, VIEWING_EVERY_MS, artifactsToOpen, forgetOpened, useChatViewing, useOpenPublished } from "./artifact-open.ts";

const NOW = 1_800_000_000_000;
const card = (messageId: string, over: { openFor?: string; ageMs?: number; type?: string } = {}) => ({
  messageId, createdAt: NOW - (over.ageMs ?? 1000),
  blocks: [{ type: over.type ?? "artifact", data: { artifactId: `sit_${messageId}`, title: "Numbers", ...(over.openFor ? { openFor: over.openFor } : {}) } }],
});

test("a fresh card marked for this person opens once; a card for someone else, an old one, a plain one and another block type do not", () => {
  const done = new Set<string>();
  const rows = [card("m1", { openFor: "usr_me" }), card("m2", { openFor: "usr_sam" }), card("m3"), card("m4", { openFor: "usr_me", ageMs: FRESH_MS + 1 }), card("m5", { openFor: "usr_me", type: "mount" })];
  assert.deepEqual(artifactsToOpen(rows, "usr_me", NOW, done), ["sit_m1"]);
  assert.deepEqual(artifactsToOpen(rows, "usr_me", NOW, done), [], "once");
  assert.deepEqual(artifactsToOpen([...rows, card("m6", { openFor: "usr_me" })], "usr_me", NOW, done), ["sit_m6"], "a republish is a new card and opens its tab again");
});

test("the chat reports itself open at once and every half minute, and stops when it unmounts", async () => {
  const restore = installDom();
  const { act } = await import("react");
  const calls: { cap: string; input: unknown }[] = [];
  const timers: { f: () => void; ms: number; live: boolean }[] = [];
  const realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
  (globalThis as { setInterval: unknown }).setInterval = ((f: () => void, ms: number) => { timers.push({ f, ms, live: true }); return timers.length - 1; }) as never;
  (globalThis as { clearInterval: unknown }).clearInterval = ((i: number) => { if (timers[i]) timers[i]!.live = false; }) as never;
  try {
    function Probe() { useChatViewing((cap, input) => { calls.push({ cap, input }); return Promise.resolve({ ok: true }); }, "thr_1"); return null; }
    const root = createRoot();
    await act(async () => { root.render(<Probe />); });
    assert.deepEqual(calls, [{ cap: "sites.chat_viewing", input: { threadId: "thr_1" } }]);
    assert.equal(timers[0]!.ms, VIEWING_EVERY_MS);
    await act(async () => { timers[0]!.f(); });
    assert.equal(calls.length, 2);
    await act(async () => { root.unmount(); });
    assert.equal(timers[0]!.live, false, "no report after the chat closes");
  } finally { globalThis.setInterval = realSet; globalThis.clearInterval = realClear; restore(); }
});

test("useOpenPublished opens the tab for a card that arrives, and not again when the list repaints", async () => {
  forgetOpened();
  const restore = installDom();
  const { act } = await import("react");
  const opened: string[] = [];
  try {
    function Probe({ rows }: { rows: ReturnType<typeof card>[] }) { useOpenPublished(rows, "usr_me", (id) => opened.push(id), () => NOW); return null; }
    const root = createRoot();
    await act(async () => { root.render(<Probe rows={[card("m1")]} />); });
    assert.deepEqual(opened, [], "a plain card is only a card");
    await act(async () => { root.render(<Probe rows={[card("m1"), card("m2", { openFor: "usr_me" })]} />); });
    assert.deepEqual(opened, ["sit_m2"]);
    await act(async () => { root.render(<Probe rows={[card("m1"), card("m2", { openFor: "usr_me" }), card("m3")]} />); });
    assert.deepEqual(opened, ["sit_m2"], "the same card never opens twice, even after the chat is left and come back to");
    await act(async () => { root.unmount(); });
  } finally { restore(); }
});
