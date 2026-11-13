// @tsx
// Real-app PROBE (13 Nov 2026, lane f-kinds-b), not a gate: what a guest of one channel sees in that channel's Details, and what pressing a person row does. It writes what it saw to VYRE_KINDS_B_SHOTS/guest-result.txt
// and does not fail on either outcome (the server rule for guests is the lead's to settle); it is not in shots.yml. First result: the guest is refused the channel chat altogether (see the report).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, edge } from "./real-app-harness.test.ts";
import { claimOwner, joinGuest, joinMaya } from "./kinds-b-kit.test.ts";

test("kinds-b guest: the People list of a channel and a press on a person row", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required"); return; }
  const { chromium } = await import("playwright-core");
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
  const shots = process.env["VYRE_KINDS_B_SHOTS"] ?? "/tmp/vyre-kinds-b-shots"; fs.mkdirSync(shots, { recursive: true });
  try {
    const { call } = await claimOwner(browser, web.origin, space.claim!);
    const { mayaId } = await joinMaya(browser, web.origin, call);
    const ch = (await call("channels.create", { name: "partners", topic: "Work with our partner", visibility: "public", memberIds: [mayaId], agentIds: [], idempotencyKey: "kg-channel" })).channel as { mainThreadId: string };
    const invite = await call("threads.invite_guest", { threadId: ch.mainThreadId, email: "gus@example.com", level: "reply", idempotencyKey: "kg-guest" });
    const guest = await joinGuest(browser, web.origin, invite.link as string);
    await guest.goto(`${web.origin}/chat#subject=thread:${ch.mainThreadId}`, { waitUntil: "load" });
    await guest.waitForTimeout(3000);
    if (await guest.getByTestId("pane-header").first().isVisible().catch(() => false) === false && await guest.getByTestId("pane-button").count() > 0) await guest.getByTestId("pane-button").first().click();
    await guest.getByTestId("chat-details").waitFor({ timeout: 20_000 }).catch(async () => { await guest.screenshot({ path: path.join(shots, "guest-no-details.png") }); fs.writeFileSync(path.join(shots, "guest-result.txt"), `No Details pane for the guest. Page text: ${(await guest.locator("body").innerText()).slice(0, 500)}`); return "none"; });
    if (fs.existsSync(path.join(shots, "guest-result.txt"))) return;
    const people = await guest.locator('[data-testid^="row-chat-person-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    await guest.screenshot({ path: path.join(shots, "guest-details.png") });
    let result = `People rows a guest sees: ${JSON.stringify(people)}\n`;
    const other = people.find((id) => id && !id.includes("gus"));
    if (other) {
      await guest.getByTestId(other).click();
      await guest.waitForTimeout(2500);
      await guest.screenshot({ path: path.join(shots, "guest-person-press.png") });
      const profile = await guest.locator('[data-testid^="profile-"]').count();
      const refused = await guest.getByText(/You can't open|Couldn't load/).count();
      result += `After pressing ${other}: profile views=${profile}, refusal texts=${refused}\n`;
    }
    fs.writeFileSync(path.join(shots, "guest-result.txt"), result);
  } finally { await browser.close(); web.close(); await space.stop(); }
});
