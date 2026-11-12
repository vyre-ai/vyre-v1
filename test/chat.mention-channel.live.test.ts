// The @mention line in a channel, in the real app (the chat half is test/chat.mention-line.live.test.ts) (owner, 12 Nov 2026: "Lee is not in this chat." with Add, exactly like Slack): one quiet line under the sender's own message, for the sender only; a reload
// keeps it while it is true; Add brings the person in from that message on and they are told and can open it; an agent named who is not in the chat gets the same line and Add (and "No agent will
// reply" steps aside); in a channel Add goes through the channel, and the person is told once, by the post. Needs Node 24, a Chromium and VYRE_APP_DIST; without them it skips and says why.
// Its own file (slow by rule as a .live test, scripts/lib/slow-list.mjs): in ownerwalk.polish or chat-flows.journey2 it pushed those walks past their 120 s cap.
import test from "node:test";
import assert from "node:assert/strict";
import { connectClaude, makeAgent, unlockVault, until } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";
import { shoot } from "./support/chat-shots.ts";
import { OUT, model, hash } from "./support/chat-flows.ts";

test("the @mention line in a channel: Add goes through the channel and tells nobody twice; an agent named who is not in it gets the same line and Add", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team", engineOpenSession: model }, env);
  const dir = `${OUT}/mention-channel`;
  try {
    const w = s.world;
    await unlockVault(w);
    const account = await connectClaude(w);
    const agent = await makeAgent(w.owner, "Billing", account);
    const maya = await w.join("maya");
    const me = await seat(s, w.owner, "Owner");
    const her = await seat(s, maya, "Member");
    const mention = async (who: string, pick: string, rest: string): Promise<void> => {
      const c = me.page.getByTestId("composer-field");
      await c.click();
      await c.pressSequentially(`@${who}`, { delay: 60 });
      await me.page.getByText(pick, { exact: true }).last().click({ timeout: 10_000 });
      await c.pressSequentially(rest, { delay: 5 });
      await c.press("Enter");
    };
    const line = me.page.getByTestId("not-in-chat-text");
    void agent; void her;
    // in a channel, Add goes through the channel; the post itself already told Maya (a channel is not private), and Add does not tell her twice
    const ch = (await w.owner.ok("channels.create", { name: "launch", visibility: "public", memberIds: [], agentIds: [], idempotencyKey: "j2-ch" })).channel as { channelId: string; mainThreadId: string };
    await open(me, s, hash(ch.mainThreadId));
    await mention("may", "maya", " the launch post is ready");
    await line.waitFor({ timeout: 20_000 });
    assert.equal(await line.innerText(), "maya is not in this chat.");
    await me.page.getByTestId("not-in-chat-add").click();
    await line.waitFor({ state: "detached", timeout: 20_000 });
    assert.ok(((await w.owner.ok("channels.get", { channelId: ch.channelId })).channel.members as Array<{ id: string }>).some((m) => m.id === maya.id), "Maya is in the channel");
    const toldOf = async (): Promise<number> => (((await maya.ok("notifications.list", {})).notifications as Array<{ kind: string; subject?: { id: string } }> | undefined) ?? []).filter((n) => n.kind === "mention" && n.subject?.id === ch.mainThreadId).length;
    await until(async () => ((await toldOf()) >= 1 ? true : null), "Maya is told about the channel post", 15_000);
    assert.equal(await toldOf(), 1, "Maya is told once, by the post, and Add does not tell her again");
    // an agent named in a channel who is not in it gets the same line and Add (in a chat, the post itself brings a mentioned agent in), and "No agent will reply" steps aside
    const iris = await makeAgent(w.owner, "Iris", account);
    await open(me, s, hash(ch.mainThreadId));
    await mention("Iri", "Iris", " draft the launch email");
    await line.waitFor({ timeout: 20_000 });
    assert.equal(await line.innerText(), "Iris is not in this chat.");
    assert.equal(await me.page.getByTestId("no-agent-line").count(), 0, "one line for the message, not two");
    await shoot(me.page, dir, "agent-line", { restore: async () => { await open(me, s, hash(ch.mainThreadId)); } });
    await me.page.getByTestId("not-in-chat-add").click();
    await line.waitFor({ state: "detached", timeout: 20_000 });
    assert.ok(((await w.owner.ok("channels.get", { channelId: ch.channelId })).channel.agents as Array<{ agentId: string }>).some((a) => a.agentId === iris), "Iris is in the channel");
    assert.deepEqual([...me.errors, ...her.errors], [], "no page errors");
  } finally { await s.close(); }
});
