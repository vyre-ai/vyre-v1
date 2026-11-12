// The @mention line in the real app (owner, 12 Nov 2026: "Lee is not in this chat." with Add, exactly like Slack): one quiet line under the sender's own message, for the sender only; a reload
// keeps it while it is true; Add brings the person in from that message on and they are told and can open it; an agent named who is not in the chat gets the same line and Add (and "No agent will
// reply" steps aside); in a channel Add goes through the channel, and the person is told once, by the post. Needs Node 24, a Chromium and VYRE_APP_DIST; without them it skips and says why.
// Its own file (slow by rule as a .live test, scripts/lib/slow-list.mjs): in ownerwalk.polish or chat-flows.journey2 it pushed those walks past their 120 s cap.
import test from "node:test";
import assert from "node:assert/strict";
import { connectClaude, makeAgent, unlockVault, until } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";
import { shoot } from "./support/chat-shots.ts";
import { OUT, model, hash } from "./support/chat-flows.ts";

test("the @mention line in a chat: Lee is not in this chat, with Add, for the sender only; a reload keeps it; Add brings Lee in, tells them, and they open the message", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team", engineOpenSession: model }, env);
  const dir = `${OUT}/mention-line`;
  try {
    const w = s.world;
    await unlockVault(w);
    const account = await connectClaude(w);
    const agent = await makeAgent(w.owner, "Billing", account);
    const maya = await w.join("maya");
    const me = await seat(s, w.owner, "Owner");
    const her = await seat(s, maya, "Member");
    const lee = await w.join("lee");
    const leeSeat = await seat(s, lee, "Member");
    const pricing = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [agent], title: "Pricing copy", idempotencyKey: "j2-pricing" })).thread.threadId as string;
    await w.owner.ok("threads.members.add", { threadId: pricing, personId: maya.id });
    const mention = async (who: string, pick: string, rest: string): Promise<void> => {
      const c = me.page.getByTestId("composer-field");
      await c.click();
      await c.pressSequentially(`@${who}`, { delay: 60 });
      await me.page.getByText(pick, { exact: true }).last().click({ timeout: 10_000 });
      await c.pressSequentially(rest, { delay: 5 });
      await c.press("Enter");
    };
    const line = me.page.getByTestId("not-in-chat-text");
    // the sender sees one quiet line with Add under their own message
    await open(me, s, hash(pricing));
    await mention("le", "lee", " can you check the pricing copy?");
    await line.waitFor({ timeout: 20_000 });
    assert.equal(await line.innerText(), "lee is not in this chat.");
    assert.equal(await me.page.getByTestId("not-in-chat-add").innerText(), "Add");
    await shoot(me.page, dir, "line-under-message", { restore: async () => { await open(me, s, hash(pricing)); } });
    // Maya, in the same chat, does not see it
    await open(her, s, hash(pricing));
    await her.page.getByText(/check the pricing copy/).first().waitFor({ timeout: 20_000 });
    await her.page.waitForTimeout(800);
    assert.equal(await her.page.getByTestId("not-in-chat-text").count(), 0, "only the sender sees the line");
    // a reload keeps it while it is true
    await me.page.reload({ waitUntil: "load" });
    await line.waitFor({ timeout: 20_000 });
    // Add: Lee is in the chat, the line goes, Lee is told and can open the message
    await me.page.getByTestId("not-in-chat-add").click();
    await line.waitFor({ state: "detached", timeout: 20_000 });
    assert.ok(((await w.owner.ok("threads.get", { threadId: pricing })).thread.members as Array<{ id: string }>).some((m) => m.id === lee.id), "Lee is a member now");
    const told = await until(async () => (((await lee.ok("notifications.list", {})).notifications as Array<{ kind: string; subject?: { id: string } }> | undefined) ?? []).some((n) => n.kind === "mention" && n.subject?.id === pricing) ? true : null, "Lee is told about the mention", 15_000);
    assert.ok(told, "Lee has a mention notification for the chat");
    await open(leeSeat, s, hash(pricing));
    await leeSeat.page.getByText(/check the pricing copy/).first().waitFor({ timeout: 20_000 });
    assert.deepEqual([...me.errors, ...her.errors, ...leeSeat.errors], [], "no page errors");
  } finally { await s.close(); }
});
