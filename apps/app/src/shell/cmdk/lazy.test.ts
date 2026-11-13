// @tsx
// The "+" tab's search is there from the first press, whether or not the Space has answered yet (owner, 13 Nov: the new tab showed a dead "Open anything, or start something" for as long as the Space was connecting).
// lazySearch stands in for the real search until it exists: typing works at once, results and the chat start arrive when the Space answers, with no second press.
import test from "node:test";
import assert from "node:assert/strict";
import { lazySearch } from "./lazy.ts";
import { CmdKController } from "./controller.ts";
import { createSampleData } from "./sample.ts";
import type { CmdKData } from "./controller.ts";

test("held back, then released: the search answers after the release without a second press", async () => {
  let real: CmdKData | null = null;
  const lazy = lazySearch(() => real, { pollMs: 5 });
  const c = new CmdKController(lazy, { enterStartsChat: true, pauseMs: 0 });
  c.setRaw("referral"); // typing works while the Space is not there
  assert.equal(c.getState().raw, "referral");
  assert.deepEqual(
    c.getState().rows.filter((r) => r.type === "hit"),
    [],
    "nothing to show yet, and no error",
  );
  const { data } = createSampleData({ ask: true, serverDelayMs: 1 });
  real = data; // the connection arrives
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(
    c.getState().rows.some((r) => r.type === "hit"),
    "the server results arrived by themselves",
  );
  c.setRaw("referral fee");
  assert.ok(
    c.getState().rows.some((r) => r.type === "hit"),
    "and typing again searches the replica",
  );
});

test("Enter before the Space has answered starts the chat when it does: his words are on screen at once, the start waits", async () => {
  let real: CmdKData | null = null;
  const started: string[] = [];
  const lazy = lazySearch(() => real, { pollMs: 5 });
  const c = new CmdKController(lazy, { enterStartsChat: true });
  c.setRaw("Heyy");
  c.enter();
  assert.equal(c.getState().chat?.phase, "sending", "his words show at once");
  assert.equal(c.getState().chat?.title, "Heyy");
  assert.deepEqual(started, []);
  real = {
    ...createSampleData().data,
    startChat: (x) => {
      started.push(x.text);
      return { title: x.text, sent: Promise.resolve() };
    },
  };
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(started, ["Heyy"], "sent once, after the release");
  assert.equal(c.getState().chat?.phase, "sending");
});

test("a Space that never answers ends in the failed state with Retry, not in silence", async () => {
  const lazy = lazySearch(() => null, { pollMs: 2, giveUpMs: 20 });
  const c = new CmdKController(lazy, { enterStartsChat: true });
  c.setRaw("Heyy");
  c.enter();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(c.getState().chat?.phase, "failed");
});
