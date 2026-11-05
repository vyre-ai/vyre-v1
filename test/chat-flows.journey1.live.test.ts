// rc.9 chat flows in the real app, journey 1: Team: Catch me up, Make a Task from a message through its menu, Remember This, and both leave a card that links. Needs Node 24, a Chromium and VYRE_APP_DIST; without them it skips and says why, and with VYRE_REQUIRE_CHROME=1 (CI) it fails instead. One journey per file so each stays inside the 120 s cap.
import test from "node:test";
import assert from "node:assert/strict";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";
import { shoot } from "./support/chat-shots.ts";
import { OUT, model, hash } from "./support/chat-flows.ts";

test("journey 1, Team: Catch me up on open, Make a task from a message, Remember This from another, and both leave a card that links", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team", engineOpenSession: model }, env);
  const dir = `${OUT}/1-team`;
  try {
    const w = s.world;
    const maya = await w.join("maya");
    const dm = (await maya.ok("chat.start", { kind: "chat", agentIds: [], personId: w.owner.id, idempotencyKey: "j1-dm" })).thread.threadId as string;
    const say = async (body: string, key: string): Promise<string> => (await maya.ok("chat.post", { threadId: dm, body, idempotencyKey: key })).message.messageId as string;
    await say("Morning, the Rivera file is ready.", "j1-a");
    const ask = await say("@Olivia please send the Rivera letter by Friday", "j1-b");
    const decision = await say("We decided to ship the letter on Friday.", "j1-c");

    const me = await seat(s, w.owner, "Owner");
    await open(me, s, hash(dm));
    // Catch me up: one line on open, naming who wrote, with a way to jump and a way to dismiss
    await me.page.getByTestId("catch-up-line").waitFor({ timeout: 30_000 });
    assert.match(await me.page.getByTestId("catch-up-line").innerText(), /^maya wrote\./i);
    await shoot(me.page, dir, "catch-up", { only: "desktop" });   // no reopen here: opening the chat again reads it, and the line is gone
    // Got it clears the line, and it does not come back
    await me.page.getByTestId("catch-up-done").click();
    assert.equal(await me.page.getByTestId("catch-up").count(), 0, "the line is gone");

    // Make a task: a person's message has no Make task on its bar (that is for an agent's answer); hover it, open More, press Make a Task; a card says where it went
    await me.page.getByTestId(`msg-${ask}`).hover();
    await me.page.getByTestId(`act-more-${ask}`).click();
    await me.page.getByText("Make a Task", { exact: true }).click();
    await me.page.getByText(/Task created/).first().waitFor({ timeout: 20_000 });
    await shoot(me.page, dir, "task-card", { restore: async () => { await open(me, s, hash(dm)); } });
    const tasks = (await w.owner.ok("tasks.list", { scope: "all" })).tasks as Array<{ title: string; source?: { id?: string } }>;
    const made = tasks.filter((x) => /Rivera letter/.test(x.title));
    assert.equal(made.length, 1, "one task, made once");
    assert.equal(made[0]!.source?.id, dm, "the task points back at the chat");
    assert.match(JSON.stringify(made[0]), /Rivera letter by Friday/, "and carries the message's words");

    // Remember This: the message menu keeps it, and the card says so
    await me.page.getByTestId(`msg-${decision}`).hover();
    await me.page.getByTestId(`act-more-${decision}`).click();
    await me.page.getByText("Remember This").click();
    await me.page.getByText(/Remembered/).first().waitFor({ timeout: 20_000 });
    await shoot(me.page, dir, "remembered", { restore: async () => { await open(me, s, hash(dm)); } });
    const facts = (await w.owner.ok("memory.facts.list", {})).facts as Array<{ text: string }>;
    assert.ok(facts.some((f) => /ship the letter on Friday/.test(f.text)), "the fact is in memory");

    // the thread reads as read
    await open(me, s, hash(dm));
    await me.page.waitForTimeout(1200);
    assert.equal(await me.page.getByTestId("catch-up").count(), 0, "and does not come back");
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { await s.close(); }
});
