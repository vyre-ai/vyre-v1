// A message sent while an agent works waits for the turn to end (a real CLI folds or queues it unpredictably, so the driver keeps it): it must show as queued, with Edit (take it back into the composer,
// it leaves the chat and is never answered) and Send now (stop and send). The real app in Chromium, the real daemon, engine, CLI driver and MCP around the fake claude.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";
import { shoot } from "./support/chat-shots.ts";
import { cli, connectSubscription } from "./support/cli-world.ts";

const OUT = "shots-evidence/chat-queued";
// Known gap (see BACKLOG): see chat.btw.journeys; the process ends 1.5 s after the journey with the exit code of its result.
let passes = 0;
let ran = false;
after(() => { if (ran) setTimeout(() => process.exit(passes === 1 ? 0 : 1), 1_500); });

test("a message queued behind a running agent shows as queued; Edit takes it back, Send now sends it first", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  ran = true;
  const s = await bootScreens({ kind: "personal", engineCli: cli }, env);
  const dir = `${OUT}/queued`;
  try {
    const w = s.world;
    await connectSubscription(w);
    const agent = (await w.owner.ok("agents.create", { name: "Haiku", role: "You answer briefly.", idempotencyKey: "qd-agent" })).agent.agentId as string;
    const threadId = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [agent], idempotencyKey: "qd-chat" })).thread.threadId as string;
    await w.owner.ok("threads.set_mode", { threadId, mode: "auto", idempotencyKey: "qd-auto" });
    const me = await seat(s, w.owner, "Owner");
    await open(me, s, `/chat#screen=chats.conversation&threadId=${threadId}`);
    const field = me.page.getByTestId("composer-field");
    await field.click();
    await field.fill("slow 20 700");
    await me.page.getByTestId("composer-send").click();
    await me.page.getByText(/word2/).first().waitFor({ timeout: 15_000 });

    // a second message while it writes: shown as queued with Edit and Send now
    await field.click();
    await field.fill("tell me the plan after this");
    await me.page.getByTestId("composer-send").click();
    await me.page.getByTestId("queue-note").waitFor({ timeout: 10_000 });
    await me.page.getByTestId("queue-edit").waitFor({ state: "visible", timeout: 10_000 });
    await me.page.getByTestId("queue-send-now").waitFor({ state: "visible", timeout: 10_000 });
    assert.equal(await me.page.getByTestId("queue-note").innerText(), "Goes in at the next step", "a steering engine takes the message at its next step");
    await shoot(me.page, dir, "queued", { phone: false });

    // Edit: it leaves the queue and the chat, and its words are back in the composer
    await me.page.getByTestId("queue-edit").click();
    await me.page.waitForFunction(() => (document.querySelector('[data-testid="composer-field"]') as HTMLTextAreaElement | null)?.value === "tell me the plan after this", undefined, { timeout: 10_000 });
    await me.page.getByTestId("queue-note").waitFor({ state: "detached", timeout: 10_000 });   // nothing is queued now
    const msgs = (await w.owner.ok("chat.messages.list", { threadId })).messages as Array<{ body: string }>;
    assert.ok(!msgs.some((m) => /tell me the plan/.test(m.body)), "and the message is gone from the chat");
    await shoot(me.page, dir, "edit-back-in-composer", { phone: false });

    // send it again edited, then Send now: the running reply is cut and this one goes first
    await field.fill("slow 3 200");
    await me.page.getByTestId("composer-send").click();
    await me.page.getByTestId("queue-send-now").waitFor({ timeout: 10_000 });
    await me.page.getByTestId("queue-send-now").click();
    await me.page.getByText(/word3/).first().waitFor({ timeout: 25_000 });
    const feed = await me.page.getByTestId("conversation-feed").innerText();
    assert.ok(!/word20/.test(feed), "the long reply was cut");
    await shoot(me.page, dir, "sent-now", { phone: false });
    assert.deepEqual(me.errors, [], "no page errors");
    passes++;
  } finally { await s.close(); }
});
