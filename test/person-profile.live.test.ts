// A person's profile in the real app (owner, 4 Nov): pressing a person in the chat's People popover opens their profile in the shared right pane of the chat you are in, not a jump to Chats.
// The header has Message, the About tab shows only the public layer, and at phone width the pane is the full-screen sheet. Needs the production web export (VYRE_APP_DIST) and Chromium; with
// VYRE_REQUIRE_CHROME=1 (CI) it fails instead of skipping.
import test from "node:test";
import assert from "node:assert/strict";
import { SIZES, bootScreens, browserOrSkip, open, seat, shoot } from "./support/mail-browser.ts";

const OUT = "shots-evidence/person-profile";

test("person profile, team: pressing a person in the chat's People popover opens their public profile in the right pane", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team" }, env);
  try {
    const w = s.world;
    const sara = await w.join("sara");
    const agent = (await w.owner.ok("agents.create", { name: "Ember", role: "You help.", idempotencyKey: "pf-agent" })).agent.agentId as string;
    const threadId = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [agent], idempotencyKey: "pf-chat" })).thread.threadId as string;
    await w.owner.ok("threads.members.add", { threadId, personId: sara.id });
    const me = await seat(s, w.owner, "Owner");

    await open(me, s, `/chat#screen=chats.conversation&threadId=${threadId}`);
    await me.page.getByTestId("participants-button").click();
    await me.page.getByTestId(`people-row-${sara.id}`).click();
    await me.page.getByTestId("people-popover").waitFor({ state: "detached", timeout: 10_000 });
    // the profile is beside the chat: the chat is still the page
    await me.page.getByTestId(`profile-${sara.id}`).waitFor({ timeout: 15_000 });
    assert.ok(await me.page.getByTestId("person-header").count() >= 1, "the person header");
    assert.ok(await me.page.getByTestId("profile-message").count() + (await me.page.getByTestId("person-header").getByText("Message").count()) >= 1, "Message is offered");
    assert.ok(await me.page.getByTestId("participants-button").count() >= 1, "the chat is still open beside it");
    await me.page.waitForTimeout(1500);
    await shoot(me.page, OUT, "chat-person-wide");

    // the phone: the full-screen sheet like the other panes
    await me.page.setViewportSize(SIZES.phone);
    await open(me, s, `/chat#screen=chats.conversation&threadId=${threadId}`);
    await me.page.getByTestId("participants-button").click();
    await me.page.getByTestId(`people-row-${sara.id}`).click();
    await me.page.getByTestId(`profile-${sara.id}`).waitFor({ timeout: 15_000 });
    await me.page.waitForTimeout(1500);
    await shoot(me.page, OUT, "chat-person-phone");
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { await s.close(); }
});
