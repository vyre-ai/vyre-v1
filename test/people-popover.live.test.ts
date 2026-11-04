// The people popover in the real app (owner, 4 Nov: it must look like the prototype): opened from the head of a chat and of a project. "People and agents", one row per member with the role
// on the right, a divider and the footer that belongs to the place (a chat: Add people and agents, which opens the Add sheet; a project: Manage on the Overview, which shows the Overview).
// Arrow keys move through the rows, Escape closes. Needs the production web export (VYRE_APP_DIST) and Chromium; with VYRE_REQUIRE_CHROME=1 (CI) it fails instead of skipping.
import test from "node:test";
import assert from "node:assert/strict";
import { SIZES, bootScreens, browserOrSkip, open, seat, shoot } from "./support/mail-browser.ts";

const OUT = "shots-evidence/people-popover";

test("people popover, team: a chat and a project show People and agents with roles and their own footer", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team" }, env);
  try {
    const w = s.world;
    const agent = (await w.owner.ok("agents.create", { name: "Ember", role: "You help.", idempotencyKey: "pp-agent" })).agent.agentId as string;
    const threadId = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [agent], idempotencyKey: "pp-chat" })).thread.threadId as string;
    const projectId = (await w.owner.ok("projects.create", { type: "project", title: "Rivera account", idempotencyKey: "pp-project" })).projectId as string;
    const me = await seat(s, w.owner, "Owner");

    // a chat: the people count in the head
    await open(me, s, `/chat#screen=chats.conversation&threadId=${threadId}`);
    await me.page.getByTestId("participants-button").click();
    const pop = me.page.getByTestId("people-popover");
    await pop.waitFor({ timeout: 15_000 });
    assert.equal((await me.page.getByTestId("people-title").innerText()).trim(), "People and agents");
    assert.ok(await me.page.locator('[data-testid^="people-row-"]').count() >= 2, "a row per member");
    assert.equal((await me.page.getByTestId("people-footer").innerText()).trim(), "Add people and agents");
    await me.page.waitForTimeout(1500);   // the faces draw a moment after the popover: shoot them drawn
    await shoot(me.page, OUT, "chat-people");
    await me.page.keyboard.press("ArrowDown");
    await me.page.keyboard.press("Escape");
    await pop.waitFor({ state: "detached", timeout: 10_000 });
    await me.page.getByTestId("participants-button").click();
    await me.page.getByTestId("people-footer").click();
    await me.page.getByTestId("add-sheet").waitFor({ timeout: 15_000 });
    await me.page.keyboard.press("Escape");

    // a project: the members count under the name
    await open(me, s, `/records#subject=project:${projectId}`);
    await me.page.getByTestId("project-members").click();
    await me.page.getByTestId("people-popover").waitFor({ timeout: 15_000 });
    assert.equal((await me.page.getByTestId("people-footer").innerText()).trim(), "Manage on the Overview");
    await me.page.waitForTimeout(1500);   // the faces draw a moment after the popover: shoot them drawn
    await shoot(me.page, OUT, "project-people");
    await me.page.getByTestId("people-footer").click();
    await me.page.getByTestId("people-popover").waitFor({ state: "detached", timeout: 10_000 });
    assert.ok(await me.page.getByTestId("project-people").count() >= 1, "the Overview's People section is shown");

    // the phone width
    await me.page.setViewportSize(SIZES.phone);
    await open(me, s, `/records#subject=project:${projectId}`);
    await me.page.getByTestId("project-members").click();
    await me.page.getByTestId("people-popover").waitFor({ timeout: 15_000 });
    assert.equal(await me.page.getByTestId("people-popover").getAttribute("data-sheet"), "phone", "a phone gets the bottom sheet");
    await me.page.waitForTimeout(1500);   // the faces draw a moment after the popover: shoot them drawn
    await shoot(me.page, OUT, "project-people-phone");
    // the Add people and agents sheet at the same size, for the comparison
    await me.page.keyboard.press("Escape");
    await me.page.getByTestId("people-popover").waitFor({ state: "detached", timeout: 10_000 });
    await me.page.getByText("Teammates", { exact: true }).first().click();
    await me.page.getByTestId("teammate-add").click();
    await me.page.getByTestId("add-sheet").waitFor({ timeout: 15_000 });
    await shoot(me.page, OUT, "add-sheet-phone");
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { await s.close(); }
});
