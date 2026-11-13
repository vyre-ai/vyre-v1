// @tsx
// Real-app proof (13 Nov 2026, lane f-kinds-b): a member who follows a link to a chat or a goal they cannot open reads "You can't open this" with no Retry; the Console's refusal page has its way back under the words.
// Shots: VYRE_KINDS_B_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, edge } from "./real-app-harness.test.ts";

import { claimOwner, joinMaya } from "./kinds-b-kit.test.ts";

test("kinds-b: a member's refused links say so plainly with no Retry", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const shots = process.env["VYRE_KINDS_B_SHOTS"] ?? "/tmp/vyre-kinds-b-shots"; fs.mkdirSync(shots, { recursive: true });
  const errs: string[] = [];
  try {
    const { page, call } = await claimOwner(browser, web.origin, space.claim!);
    page.on("pageerror", (e) => errs.push(e.message));
    const { maya } = await joinMaya(browser, web.origin, call);
    const dex = (await call("agents.create", { name: "Dex", role: "You help the team plan launches.", idempotencyKey: "kb-dex" })).agent as { agentId: string };
    const agentChat = (await call("chat.start", { kind: "chat", agentIds: [dex.agentId], idempotencyKey: "kb-agent" })).thread.threadId as string;
    maya.on("pageerror", (e) => errs.push(e.message));
    // 4. Maya follows links to places she cannot open
    await maya.goto(`${web.origin}/chat#subject=thread:${agentChat}`, { waitUntil: "load" });
    await maya.getByTestId("conversation-failed").waitFor({ timeout: 20_000 });
    const chatText = await maya.getByTestId("conversation-failed").innerText();
    assert.match(chatText, /You can't open this chat/);
    assert.doesNotMatch(chatText, /does not exist|Couldn't load/);
    assert.equal(await maya.getByTestId("state-retry").count(), 0, "a chat she cannot open offers no Retry");
    await maya.screenshot({ path: path.join(shots, "9-member-chat.png") });
    await maya.goto(`${web.origin}/chat#subject=goal:gol_0000000000000000`, { waitUntil: "load" });
    await maya.getByTestId("goal-refused").waitFor({ timeout: 20_000 });
    assert.match(await maya.getByTestId("goal-refused").innerText(), /You can't open this goal/);
    assert.equal(await maya.getByTestId("state-retry").count(), 0, "a goal she cannot open offers no Retry");
    await maya.screenshot({ path: path.join(shots, "10-member-goal.png") });
    await maya.goto(`${web.origin}/console`, { waitUntil: "load" });
    await maya.getByTestId("console-refused").waitFor({ timeout: 30_000 });
    await maya.screenshot({ path: path.join(shots, "11-member-console.png") });
    assert.ok(await maya.getByText("Back to Vyre").isVisible(), "the way back is on the page");
    assert.deepEqual(errs.filter((e) => !/^Loading module .* failed/.test(e)), [], "no page error");   // a face image chunk that a page change cut off is not an error of the page
  } finally { await browser.close(); web.close(); await space.stop(); }
});
