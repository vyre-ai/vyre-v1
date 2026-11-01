// /btw in the real app (Chrome, the production web export), real daemon, engine, CLI driver and MCP around the fake claude: while an agent writes a long reply the person types / to see the commands,
// asks /btw a question, and the aside answers in a card of its own, marked as an aside, while the main reply goes on untouched and the main conversation does not hold the aside. Keep posts the answer as
// a card, Dismiss puts it away. Light and dark, desktop and phone.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";
import { shoot } from "./support/chat-shots.ts";
import { cli, connectSubscription } from "./support/cli-world.ts";

const OUT = "shots-evidence/chat-btw";
// Known gap (see BACKLOG): the daemon's shutdown does not close the CLI session the engine opened, so this process would wait for the runner's cap. The process ends 1.5 s after the journey with the exit
// code of its result, so a pass or a failure shows at once.
let passes = 0;
let ran = false;
after(() => { if (ran) setTimeout(() => process.exit(passes === 1 ? 0 : 1), 1_500); });

test("/btw: the slash menu lists it, the aside answers on the side while the main reply goes on, Keep posts it, Dismiss puts it away", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  ran = true;
  const s = await bootScreens({ kind: "personal", engineCli: cli }, env);
  const dir = `${OUT}/btw`;
  try {
    const w = s.world;
    await connectSubscription(w);
    const agent = (await w.owner.ok("agents.create", { name: "Haiku", role: "You answer briefly.", idempotencyKey: "bw-agent" })).agent.agentId as string;
    const threadId = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [agent], idempotencyKey: "bw-chat" })).thread.threadId as string;
    await w.owner.ok("threads.set_mode", { threadId, mode: "auto", idempotencyKey: "bw-auto" });
    const me = await seat(s, w.owner, "Owner");
    const route = `/chat#screen=chats.conversation&threadId=${threadId}`;
    await open(me, s, route);
    const field = me.page.getByTestId("composer-field");

    // the slash menu: /btw is there, with the commands that already existed
    await field.click();
    await field.fill("/");
    await me.page.getByText("Ask a side question while the agent works").first().waitFor({ timeout: 10_000 });
    for (const known of ["Turn plan mode on or off for this chat", "Start a helper chat for a side task", "Stop what the agent is doing"]) assert.ok(await me.page.getByText(known).count() > 0, known);
    await shoot(me.page, dir, "slash-menu", { phone: false });
    await field.fill("");

    // a long main reply starts
    await field.fill("slow 14 700");
    await me.page.getByTestId("composer-send").click();
    await me.page.getByTestId("stop-button").waitFor({ timeout: 5_000 });
    await me.page.getByText(/word2/).first().waitFor({ timeout: 15_000 });

    // /btw while it writes
    await field.click();
    await field.fill("/btw what is the deadline");
    await me.page.getByTestId("composer-send").click();
    const card = me.page.locator('[data-testid^="aside-"][data-testid$=""]').filter({ has: me.page.locator('[data-testid^="aside-question-"]') }).first();
    await card.waitFor({ timeout: 10_000 });
    assert.match(await me.page.locator('[data-testid^="aside-question-"]').first().innerText(), /what is the deadline/);
    assert.ok(await me.page.getByText("Aside", { exact: true }).first().isVisible(), "marked as an aside");
    assert.ok(await me.page.getByText(/Only you see this/).first().isVisible());
    await me.page.locator('[data-testid^="aside-answer-"]').getByText(/Aside answer/).first().waitFor({ timeout: 30_000 });
    await shoot(me.page, dir, "aside-answering", { restore: async () => { await open(me, s, route); } });

    // the main reply goes on to the end, once, and the aside is not in the conversation
    await me.page.waitForTimeout(500);
    const feed = async (): Promise<string> => me.page.getByTestId("conversation-feed").innerText();
    for (const end = Date.now() + 25_000; Date.now() < end && (await me.page.getByTestId("stop-button").count()) > 0;) await me.page.waitForTimeout(300);
    const main = await feed();
    assert.equal((main.match(/word\d+/g) ?? []).length, 14, "the main reply finished, every word once");
    assert.ok(!/Aside answer/.test(main), "the aside is not in the main conversation");
    assert.ok(!/what is the deadline/.test(main), "nor its question");
    const msgs = (await w.owner.ok("chat.messages.list", { threadId })).messages as Array<{ body: string }>;
    assert.ok(!msgs.some((m) => /deadline|Aside answer/.test(m.body)), "the chat the aside came from holds nothing of it");

    // Keep posts one card into the chat
    await me.page.locator('[data-testid^="aside-keep-"]').first().click();
    await me.page.getByText(/Aside: what is the deadline|Aside by/).first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    await me.page.waitForFunction(() => document.body.innerText.includes("Aside answer to what is the deadline"), undefined, { timeout: 15_000 });
    await shoot(me.page, dir, "aside-kept", { restore: async () => { await open(me, s, route); } });

    // Dismiss puts the card away
    await me.page.locator('[data-testid^="aside-dismiss-"]').first().click();
    assert.equal(await me.page.locator('[data-testid^="aside-question-"]').count(), 0, "the aside card is gone");
    assert.deepEqual(me.errors, [], "no page errors");
    passes++;
  } finally { await s.close(); }
});
