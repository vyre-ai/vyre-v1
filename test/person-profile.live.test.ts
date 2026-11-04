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
    // three asks of Sara in this chat, each answered within seconds: her usual reply time reads "within minutes"
    for (let i = 0; i < 3; i++) {
      await w.owner.ok("chat.post", { threadId, body: `Sara, can you look at item ${i + 1}?`, idempotencyKey: `pf-ask-${i}` });
      await sara.ok("chat.post", { threadId, body: `Done with item ${i + 1}`, idempotencyKey: `pf-ans-${i}` });
    }
    // what Sara set about herself, and a project the two can see: the role line, About and Shared context draw from these
    await sara.ok("settings.set", { key: "profile.timezone", value: "Europe/Berlin" });
    await sara.ok("settings.set", { key: "profile.title", value: "Account lead" });
    // one fact in her public profile and one in her private: the public one shows, the private one never reaches the owner's page
    const PUBLIC_FACT = "Prefers a short written summary before a call";
    const PRIVATE_FACT = "Takes Thursday mornings for a standing appointment";
    await sara.ok("memory.profile.add", { text: PUBLIC_FACT, to: "public" });
    await sara.ok("memory.profile.add", { text: PRIVATE_FACT, to: "private" });
    const projectId = (await w.owner.ok("projects.create", { type: "project", title: "Client portal launch", idempotencyKey: "pf-project" })).projectId as string;
    await w.owner.ok("projects.members.set", { projectId, principal: sara.id, role: "lead" });
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
    assert.match(await me.page.getByTestId("person-header").innerText(), /Account lead.*for sara/i, "the role line carries their local time");
    await me.page.getByTestId(`row-person-project-${projectId}`).waitFor({ timeout: 15_000 });   // Shared context lists the project you both see
    await me.page.getByText(PUBLIC_FACT).first().waitFor({ timeout: 15_000 });   // About shows the public line
    await me.page.getByText("Usually within minutes").first().waitFor({ timeout: 15_000 });   // how she responds here: from the chat the two of you are in
    await me.page.getByText("All messages").first().waitFor({ timeout: 15_000 });
    await me.page.waitForTimeout(1500);
    assert.equal((await me.page.locator("body").innerText()).includes(PRIVATE_FACT), false, "the private fact never reaches the page");
    await shoot(me.page, OUT, "chat-person-wide");

    // the phone: the full-screen sheet like the other panes
    await me.page.setViewportSize(SIZES.phone);
    await open(me, s, `/chat#screen=chats.conversation&threadId=${threadId}`);
    await me.page.getByTestId("participants-button").click();
    await me.page.getByTestId(`people-row-${sara.id}`).click();
    await me.page.getByTestId(`profile-${sara.id}`).waitFor({ timeout: 15_000 });
    assert.ok(await me.page.getByTestId("phone-profile-back").count() === 1, "a back arrow");
    // where the bottom nav would be, the page the profile draws is on top
    assert.equal(await me.page.evaluate("(function(){var e=document.elementFromPoint(195,window.innerHeight-20);return !!(e&&e.closest('[data-testid=phone-profile]'))})()"), true, "the profile covers the bottom nav");
    await me.page.waitForTimeout(1500);
    await me.page.getByText(PUBLIC_FACT).first().waitFor({ timeout: 15_000 });
    assert.equal((await me.page.locator("body").innerText()).includes(PRIVATE_FACT), false, "nor on a phone");
    await shoot(me.page, OUT, "chat-person-phone");
    await me.page.getByTestId("phone-profile-back").click();
    await me.page.getByTestId("phone-profile").waitFor({ state: "detached", timeout: 10_000 });
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { await s.close(); }
});
