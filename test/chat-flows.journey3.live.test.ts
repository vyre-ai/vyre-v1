// rc.9 chat flows in the real app, journey 3: a chat opened mid-answer shows the answer so far at once and finishes live, on desktop and phone. Needs Node 24, a Chromium and VYRE_APP_DIST; without them it skips and says why, and with VYRE_REQUIRE_CHROME=1 (CI) it fails instead. One journey per file so each stays inside the 120 s cap.
import test from "node:test";
import assert from "node:assert/strict";
import { connectClaude, makeAgent, unlockVault, until } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";
import { shoot } from "./support/chat-shots.ts";
import { OUT, arm, letGo, model, hash } from "./support/chat-flows.ts";

test("journey 3, a chat opened mid-answer shows the answer so far at once and finishes live, on desktop and phone", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  arm();
  const s = await bootScreens({ kind: "personal", engineOpenSession: model }, env);
  const dir = `${OUT}/3-mid-turn`;
  try {
    const w = s.world;
    await unlockVault(w);
    const account = await connectClaude(w);
    const agent = await makeAgent(w.owner, "Billing", account);
    const started = await w.owner.ok("chat.start", { kind: "chat", agentIds: [agent], idempotencyKey: "j3-chat" });
    const dm = started.thread.threadId as string;
    await w.owner.ok("chat.post", { threadId: dm, body: "answer slowly", mentions: [{ kind: "agent", id: agent }], idempotencyKey: "j3-q" });
    // the answer is half written on the server before any screen opens
    await until(async () => { await w.d.hooks?.pump?.(); const r = await w.owner.ok("engine.live_turns", { threadId: dm }); return (r.turns as Array<{ text: string }>).some((x) => x.text.includes("Three invoices are paid")) ? true : null; }, "the turn is half written");
    const me = await seat(s, w.owner, "Owner");
    await open(me, s, hash(dm));
    await me.page.getByText(/Three invoices are paid/).first().waitFor({ timeout: 20_000 });
    assert.equal(await me.page.getByText(/two are open/).count(), 0, "only the part written so far");
    await shoot(me.page, dir, "half-written", { restore: async () => { await open(me, s, hash(dm)); await me.page.getByText(/Three invoices are paid/).first().waitFor({ timeout: 20_000 }); } });
    letGo();
    await me.page.getByText(/Three invoices are paid, two are open\./).first().waitFor({ timeout: 30_000 });
    await shoot(me.page, dir, "finished");
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { letGo(); await s.close(); }
});
