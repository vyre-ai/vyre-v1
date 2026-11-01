// The owner's report (rc.8): in a chat with Claude Code every reply arrived as one block after a pause, with no sign of work, and every reply was followed by "Used N memories" and big quote cards.
// The real app in a real Chromium, the real daemon, engine, CLI driver and MCP, around the fake claude of host/tests/fixtures/fake-cli-driver: it pauses, then streams words as partial messages like the real
// one (and repeats the text in its final message). What a person must see: a sign of work the moment they send, the words arriving in pieces, no word twice, and a reply with no recall cards.
import test from "node:test";
import assert from "node:assert/strict";
import { cli, connectSubscription } from "./support/cli-world.ts";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";
import { shoot } from "./support/chat-shots.ts";

const OUT = "shots-evidence/chat-streaming";
test("a reply from the CLI shows a sign of work at once, streams in pieces, repeats nothing, and carries no recall cards", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "personal", engineCli: cli }, env);
  const dir = `${OUT}/cli`;
  try {
    const w = s.world;
    await connectSubscription(w);
    const agent = (await w.owner.ok("agents.create", { name: "Haiku", role: "You answer briefly.", idempotencyKey: "st-agent" })).agent.agentId as string;
    const threadId = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [agent], idempotencyKey: "st-chat" })).thread.threadId as string;
    await w.owner.ok("threads.set_mode", { threadId, mode: "auto", idempotencyKey: "st-auto" });
    const me = await seat(s, w.owner, "Owner");
    // what the live socket carried, for the failure message: the frames of the turn and when they came
    const frames: string[] = [];
    let t0 = Date.now();
    me.page.on("websocket", (ws) => ws.on("framereceived", (f) => { const p = String(f.payload); if (p.includes('"turn"')) frames.push(`${Date.now() - t0}ms ${p.slice(0, 140)}`); }));
    await open(me, s, `/chat#screen=chats.conversation&threadId=${threadId}`);
    await me.page.getByTestId("composer-field").click();
    await me.page.getByTestId("composer-field").fill("slow 8 700");
    const sent = Date.now();
    t0 = sent;
    await me.page.getByTestId("composer-send").click();

    // 1. a sign of work: the Stop button is the app's mark that an agent is writing; it must be there before the first word (the fake pauses 1.4 s first)
    await me.page.getByTestId("stop-button").waitFor({ timeout: 1_200 }).catch((e) => { throw new Error(`no sign of work; turn frames: ${JSON.stringify(frames)}; ${String(e).slice(0, 80)}`); });
    const signAt = Date.now() - sent;
    assert.equal(await me.page.getByText(/word1/).count(), 0, "and no word yet: the sign came first");
    await shoot(me.page, dir, "working-before-text", { phone: false });

    // 2. the words arrive one by one: sample the screen while the turn runs
    const seen: number[] = [];
    let last = "";
    for (const end = Date.now() + 12_000; Date.now() < end;) {
      const text = await me.page.getByTestId("conversation-feed").innerText();
      const n = (text.match(/word\d/g) ?? []).length;
      if (seen.at(-1) !== n) seen.push(n);
      last = text;
      if (n >= 8 && (await me.page.getByTestId("stop-button").count()) === 0) break;
      await me.page.waitForTimeout(100);
    }
    assert.ok(seen.length >= 4, `the words arrived in pieces, not as one block: ${JSON.stringify(seen)}`);
    assert.ok(seen.every((n, i) => i === 0 || n > seen[i - 1]!), `and only grew: ${JSON.stringify(seen)}`);
    await me.page.waitForTimeout(2_500);
    const after = (await me.page.getByTestId("conversation-feed").innerText()).match(/word\d/g) ?? [];
    assert.equal(after.length, 8, `every word exactly once once the turn is saved: ${JSON.stringify(seen)} then ${after.length}: ${(await me.page.getByTestId("conversation-feed").innerText()).slice(0, 300)}`);
    assert.ok(seen.every((n) => n <= 8), `and never twice, not even for a moment: ${JSON.stringify(seen)}`);
    assert.ok(signAt < 1_200, `the sign of work showed ${signAt} ms after sending`);
    assert.ok(!/Used \d+ memor/.test(last), "no recall line under a reply to a plain message");
    assert.equal(await me.page.locator('[data-testid^="qcard-"]').count(), 0, "and no quote cards");
    await shoot(me.page, dir, "reply-done", { restore: async () => { await open(me, s, `/chat#screen=chats.conversation&threadId=${threadId}`); } });
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { await s.close(); }
});
