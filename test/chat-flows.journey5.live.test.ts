// rc.9 chat flows in the real app, journey 5: Team: Share to a channel from the message menu; a card lands there and a line says where it went. Needs Node 24, a Chromium and VYRE_APP_DIST; without them it skips and says why, and with VYRE_REQUIRE_CHROME=1 (CI) it fails instead. One journey per file so each stays inside the 120 s cap.
import test from "node:test";
import assert from "node:assert/strict";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";
import { shoot } from "./support/chat-shots.ts";
import { OUT, model, hash } from "./support/chat-flows.ts";

test("journey 5, Team: Share to a channel from the message menu; a card lands there and a line says where it went", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team", engineOpenSession: model }, env);
  const dir = `${OUT}/5-share`;
  try {
    const w = s.world;
    const maya = await w.join("maya");
    const ch = (await w.owner.ok("channels.create", { name: "ops", visibility: "public", idempotencyKey: "j5-ch" })).channel as { mainThreadId: string };
    const dm = (await maya.ok("chat.start", { kind: "chat", agentIds: [], personId: w.owner.id, idempotencyKey: "j5-dm" })).thread.threadId as string;
    const said = (await maya.ok("chat.post", { threadId: dm, body: "We ship on Friday", idempotencyKey: "j5-say" })).message.messageId as string;
    const me = await seat(s, w.owner, "Owner");
    await open(me, s, hash(dm));
    await me.page.getByTestId(`msg-${said}`).hover();
    await me.page.getByTestId(`act-more-${said}`).click();
    await me.page.getByText("Share to...").click();
    await me.page.getByText("#ops").click();
    await me.page.getByText(/Shared to #ops/).first().waitFor({ timeout: 20_000 });
    await shoot(me.page, dir, "shared-line", { restore: async () => { await open(me, s, hash(dm)); } });
    // the line opens the channel; the card there says who shared it and opens the chat it came from
    await me.page.getByText(/Shared to #ops/).first().locator("..").getByText("We ship on Friday").click();
    await me.page.getByText(/Shared by Olivia/).first().waitFor({ timeout: 20_000 });
    await shoot(me.page, dir, "shared-card", { phone: false, restore: async () => { await open(me, s, hash(dm)); await me.page.getByText(/Shared to #ops/).first().locator("..").getByText("We ship on Friday").click(); await me.page.getByText(/Shared by Olivia/).first().waitFor({ timeout: 20_000 }); } });
    await me.page.getByText(/Shared by Olivia/).first().locator("..").getByText("We ship on Friday").click();
    await me.page.getByText(/Shared to #ops/).first().waitFor({ timeout: 20_000 });
    void ch;
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { await s.close(); }
});
