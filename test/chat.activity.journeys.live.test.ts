// The live activity line (owner, rc.9): where a reply is being written the chat says what the agent is really doing, from real engine events: Thinking with the last of its thinking, then the steps it takes
// ("Reading", "Searching the web"), changing as they happen; press it for the trail; the finished reply keeps "Worked for N s" with its steps. The real app in Chromium, the real daemon, engine, CLI driver
// and MCP around the fake claude, which thinks, reads and searches before it answers. Light, dark, desktop and phone.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";
import { shoot } from "./support/chat-shots.ts";
import { cli, connectSubscription } from "./support/cli-world.ts";

const OUT = "shots-evidence/chat-activity";
// Known gap (see BACKLOG): the process ends 1.5 s after the journey with the exit code of its result (see chat.btw.journeys).
let passes = 0;
let ran = false;
after(() => { if (ran) setTimeout(() => process.exit(passes === 1 ? 0 : 1), 1_500); });

test("a reply being written says what the agent is doing, from its real steps and thinking, and keeps the trail when it is done", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  ran = true;
  const s = await bootScreens({ kind: "personal", engineCli: cli }, env);
  const dir = `${OUT}/activity`;
  try {
    const w = s.world;
    await connectSubscription(w);
    const agent = (await w.owner.ok("agents.create", { name: "Haiku", role: "You answer briefly.", idempotencyKey: "ac-agent" })).agent.agentId as string;
    const threadId = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [agent], idempotencyKey: "ac-chat" })).thread.threadId as string;
    await w.owner.ok("threads.set_mode", { threadId, mode: "auto", idempotencyKey: "ac-auto" });
    const me = await seat(s, w.owner, "Owner");
    const route = `/chat#screen=chats.conversation&threadId=${threadId}`;
    await open(me, s, route);
    const field = me.page.getByTestId("composer-field");
    await field.click();
    await field.fill("think 900");
    await me.page.getByTestId("composer-send").click();

    // before the first word: one line, "Thinking", with the last of its thinking
    const line = me.page.getByTestId("activity-line");
    await line.waitFor({ timeout: 10_000 });
    assert.match(await line.innerText(), /Thinking/);
    await me.page.getByTestId("activity-excerpt").filter({ hasText: /notes|plan|look/i }).waitFor({ timeout: 10_000 });   // a live excerpt of its thinking
    await shoot(me.page, dir, "thinking", { phone: false });

    // then its steps, as they happen
    await me.page.getByText("Reading", { exact: false }).first().waitFor({ timeout: 15_000 });
    assert.match(await line.innerText(), /Reading/);
    await me.page.getByText(/Searching the web/).first().waitFor({ timeout: 15_000 });

    // open the trail while it works, then fold it
    await line.click();
    await me.page.getByTestId("activity-trail").waitFor({ timeout: 5_000 });
    assert.ok(await me.page.getByText(/Reading/).count() > 0 && await me.page.getByText(/Searching the web/).count() > 0, "the trail lists the steps");
    await shoot(me.page, dir, "trail-open", { phone: false });
    await line.click();
    await me.page.getByTestId("activity-trail").waitFor({ state: "detached", timeout: 5_000 });

    // the reply arrives and the line goes; the finished reply keeps "Worked for N s" with the steps
    await me.page.getByText(/The notes agree with the plan/).first().waitFor({ timeout: 30_000 });
    await me.page.getByTestId("activity").waitFor({ state: "detached", timeout: 10_000 });
    const fold = me.page.locator('[data-testid^="work-"]').first();
    await fold.waitFor({ timeout: 10_000 });
    assert.match(await fold.innerText(), /Worked/);
    await fold.getByRole("button").click();
    assert.ok(await me.page.getByText("Read", { exact: false }).count() > 0);
    await shoot(me.page, dir, "worked", { phone: false });

    // the same on a phone, as its own pass
    await me.page.setViewportSize({ width: 390, height: 844 });
    await open(me, s, route);
    await me.page.getByTestId("composer-field").click();
    await me.page.getByTestId("composer-field").fill("think 900");
    await me.page.getByTestId("composer-send").click();
    await me.page.getByTestId("activity-line").waitFor({ timeout: 10_000 });
    await me.page.getByTestId("activity-excerpt").waitFor({ timeout: 10_000 }).catch(() => undefined);
    await shoot(me.page, dir, "thinking-on-phone", { only: "phone" });
    assert.deepEqual(me.errors, [], "no page errors");
    passes++;
  } finally { await s.close(); }
});
