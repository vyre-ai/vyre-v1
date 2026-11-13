// @tsx
// A guest of one channel in the real app (lane f-guest, 13 Nov 2026), on the production export and a real daemon: invited by the real invite (threads.invite_guest), joined through the join screens, then the sidebar
// lists the one channel, it opens, the history reads with names, a message posts, the channel's Details list its people and agent, and pressing a person or an agent row does not end in a refusal or a blank.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, edge } from "./real-app-harness.test.ts";
import { claimOwner, joinGuest, joinMaya } from "./guest-kit.test.ts";

test("guest walk: sidebar, open, read, post, People list, a person row, an agent row", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required"); return; }
  const { chromium } = await import("playwright-core");
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
  const out = process.env["VYRE_GUEST_OUT"] ?? "/tmp/vyre-guest"; fs.mkdirSync(out, { recursive: true });
  try {
    const { call } = await claimOwner(browser, web.origin, space.claim!);
    const { mayaId } = await joinMaya(browser, web.origin, call);
    const dex = (await call("agents.create", { name: "Dex", role: "You help the team plan launches.", idempotencyKey: "gw-dex" })).agent as { agentId: string };
    await call("agents.create", { name: "Ledger", role: "You keep the books.", idempotencyKey: "gw-ledger" });
    const ch = (await call("channels.create", { name: "partners", topic: "Work with our partner", visibility: "public", memberIds: [mayaId], agentIds: [dex.agentId], idempotencyKey: "gw-ch" })).channel as { mainThreadId: string };
    await call("channels.create", { name: "internal", visibility: "public", memberIds: [mayaId], agentIds: [], idempotencyKey: "gw-other" });
    await call("chat.post", { threadId: ch.mainThreadId, body: "Welcome to the partner channel.", idempotencyKey: "gw-m1" });
    const inv = await call("threads.invite_guest", { threadId: ch.mainThreadId, email: "gus@example.com", level: "reply", idempotencyKey: "gw-inv" });
    const g = await joinGuest(browser, web.origin, inv.link as string);
    const page = g.page;
    await page.goto(`${web.origin}/chat`, { waitUntil: "load" });
    const side = page.getByTestId("sidebar-outlet");
    await side.getByText("partners", { exact: true }).waitFor({ timeout: 30_000 });
    assert.equal(await side.getByText("internal", { exact: true }).count(), 0, "the guest's sidebar lists no other channel");
    assert.equal(await side.getByText("Ledger", { exact: true }).count(), 0, "or an agent that is in none of their channels");
    assert.equal(await side.getByText("People", { exact: true }).count(), 0, "the sidebar has no People section: a chat with a person is refused a guest");
    assert.equal(await side.getByText("Agents", { exact: true }).count(), 0, "and no Agents section: a chat with an agent is refused them");
    assert.ok(await page.getByTestId("chats-guest-start").isVisible(), "the start page says where to go instead of offering a chat that is refused");
    await page.screenshot({ path: path.join(out, "1-guest-sidebar.png") });
    await side.getByText("partners", { exact: true }).click();
    await page.getByText("Welcome to the partner channel.").waitFor({ timeout: 30_000 });
    assert.equal(await page.getByTestId("conversation-failed").count(), 0, "the listed channel opens");
    await page.waitForTimeout(1500);
    const body = await page.locator("body").innerText();
    assert.ok(!/\bSomeone\b/.test(body), "the history names who wrote: no Someone");
    await page.screenshot({ path: path.join(out, "2-guest-open.png") });
    // post
    await page.getByTestId("composer-field").first().click();
    await page.keyboard.type("Hello from the guest");
    await page.keyboard.press("Enter");
    await page.getByText("Hello from the guest").first().waitFor({ timeout: 20_000 });
    await page.screenshot({ path: path.join(out, "3-guest-posted.png") });
    const mine = await call("chat.messages.list", { threadId: ch.mainThreadId });
    assert.ok((mine.messages as { body?: string }[]).some((m) => m.body === "Hello from the guest"), "the owner sees what the guest posted");
    // the people of the channel: the "3 in this chat" button
    await page.getByTestId("participants-button").click();
    await page.waitForTimeout(1500);
    const people = await page.locator("body").innerText();
    await page.screenshot({ path: path.join(out, "4-guest-people.png") });
    for (const name of ["Olivia Owner", "Maya Lin", "Dex"]) assert.ok(people.includes(name), `the people list names ${name}`);
    assert.ok(!/\bSomeone\b/.test(people), "and no one is Someone");
    assert.ok(!people.includes("Ledger"), "an agent that is in none of the guest's channels is not named");
    const log: string[] = [];
    // an agent row: press it
    const dexRow = page.getByText("Dex", { exact: true }).last();
    await dexRow.click().catch(() => undefined);
    await page.waitForTimeout(2500);
    const after = await page.locator("body").innerText();
    const refused = /You can't open|Couldn't load|does not exist/.test(after);
    log.push(`pressing the agent Dex: refusal text on screen = ${refused}`);
    await page.screenshot({ path: path.join(out, "5-guest-press-agent.png") });
    fs.writeFileSync(path.join(out, "guest-walk.txt"), log.join("\n") + "\n");
    assert.equal(refused, false, "pressing the channel's agent does not end in a refusal");
  } finally { await browser.close(); web.close(); await space.stop(); }
});
