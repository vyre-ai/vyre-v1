// A guest reads from the moment they accept, with time passing between the lines (lane f-guest, 14 Nov 2026). The harness's clock stands still unless it is moved, which the first floor test never did (the line before and the
// invite shared one millisecond); here it moves a second at each step, as time does:
// a line posted a second BEFORE the invite is accepted is not readable by id, in the list, in history, in pins, in the catch-up or in chapters; a line posted a second AFTER is, in all of them.
import test from "node:test";
import assert from "node:assert/strict";
import { clock } from "./memory-live-kit.ts";
import { world } from "./guest-channel-kit.ts";

const pass = (ms: number): void => {
  clock.t += ms;
};

test("a message posted a second before the guest accepts is read by no door; one a second after is read by all", async () => {
  const w = await world();
  try {
    const thread = w.pub.mainThreadId;
    // a long chat (past 40 lines) so that chapters exist for the owner: the guest must get none of its past
    for (let i = 0; i < 24; i++) await w.say(w.pub, `filler line ${i}`);
    pass(4 * 3_600_000); // a gap of hours starts a chapter
    for (let i = 24; i < 48; i++) await w.say(w.pub, `filler line ${i}`);
    const before = await w.say(w.pub, "BEFORE the guest came");
    await w.o("chat.pin", { threadId: thread, messageId: before });
    const ownerChapters = (await w.o("chat.chapters", { threadId: thread })).chapters as unknown[];
    assert.ok(ownerChapters.length > 0, "control: the owner's long chat has chapters");
    pass(1_100);
    const g = await w.invite(w.pub, "reply", "floor@example.com", "floorguest");
    pass(1_100);
    const after = await w.say(w.pub, "AFTER the guest came");
    await w.o("chat.pin", { threadId: thread, messageId: after });

    const text = (r: { data: unknown }): string => JSON.stringify(r.data);
    // by id
    assert.equal(
      (await g.call("chat.message.get", { threadId: thread, messageId: before })).status,
      404,
      "a line from before is not readable by id",
    );
    assert.equal(
      (await g.call("chat.message.get", { threadId: thread, messageId: after })).status,
      200,
      "a line from after is",
    );
    // the list and history
    const list = text(await g.call("chat.messages.list", { threadId: thread }));
    assert.ok(
      !list.includes("BEFORE the guest came") && !list.includes("filler line"),
      "the list holds nothing from before",
    );
    assert.ok(list.includes("AFTER the guest came"), "and holds what came after");
    const page = text(await g.call("chat.history.page", { threadId: thread, before: 100000 }));
    assert.ok(
      !page.includes("BEFORE the guest came") && !page.includes("filler line"),
      "history reads nothing from before",
    );
    assert.ok(page.includes("AFTER the guest came"));
    // pins
    const pins = text(await g.call("chat.pins.list", { threadId: thread }));
    assert.ok(!pins.includes("BEFORE the guest came"), "a pin from before is not theirs");
    assert.ok(pins.includes("AFTER the guest came"), "a pin from after is");
    // catch-up and chapters
    const caught = text(await g.call("chat.catch_up", { threadId: thread }));
    assert.ok(
      !caught.includes("BEFORE the guest came") && !caught.includes("filler line"),
      "the catch-up tells nothing of before",
    );
    const chapters = await g.call("chat.chapters", { threadId: thread });
    assert.equal(chapters.status, 200, "chapters answer");
    assert.deepEqual(chapters.data.chapters, [], "and hold none of the past: a chat of a few lines has no chapters");
    assert.ok(!text(chapters).includes("BEFORE the guest came") && !text(chapters).includes("filler line"));
  } finally {
    await w.stop();
  }
});
