// @tsx
// Real-app proof for the layout bugs the owner reported on rc.22 (19, 22, 30, 31, 32): the production export, a fresh claimed Team Space, real chats made through the API, screenshots looked at by a person.
// Reaches: a 14-line draft in the composer (30), a long channel scrolled up so "Jump to latest" shows (31), a thread pane beside a channel with a long name (32), the same chat opened again and again in
// the tab strip (19), and real chats whose first message is long in the sidebar (22). Shots go to VYRE_CHAT_LAYOUT_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";
import { vendor } from "../../../fixtures/model-vendor.ts";

const PRELOAD = fileURLToPath(new URL("../../../fixtures/model-vendor-preload.mjs", import.meta.url));
const KEY = "sk-test-fixture-0123456789abcdef"; // secret-scan: fake

test("chat layout, team Space: long draft, scrolled feed, thread pane beside a long channel name, repeated tabs, long first messages", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const v = await vendor();
  const priorOptions = process.env["NODE_OPTIONS"];
  process.env["NODE_OPTIONS"] = `${priorOptions ?? ""} --import ${PRELOAD}`.trim();
  process.env["VYRE_TEST_VENDOR"] = v.base;
  const space = await bootFreshSpace(undefined, true);
  if (priorOptions === undefined) delete process.env["NODE_OPTIONS"]; else process.env["NODE_OPTIONS"] = priorOptions;
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const guard = guardCrashes(page);
  const shots = process.env["VYRE_CHAT_LAYOUT_SHOTS"] ?? "/tmp/vyre-chat-layout-shots"; fs.mkdirSync(shots, { recursive: true });
  const shot = async (name: string): Promise<void> => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Chat Owner"); await page.getByTestId("claim-username").fill("chatowner");
    await page.getByTestId("claim-password").fill("fixture password 123"); await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click(); await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const api = async (cap: string, data: unknown): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data });
      assert.equal(r.status(), 200, `${cap}: ${await r.text()}`); return (await r.json()).data;
    };
    const provider = await api("providers.add", { idempotencyKey: "cl-provider", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
    await api("providers.set_space_use", { idempotencyKey: "cl-spaceuse", providerId: provider.provider.id, allow: true });
    const assistant = (await api("agents.list", {})).agents[0] as { agentId: string };
    await api("agents.update", { agentId: assistant.agentId, patch: { model: "gpt-4o-mini" }, idempotencyKey: "cl-model" });

    // 22: real chats whose first message is long, answered by the stand-in model
    const firsts = [
      "I want you to create a landing page for the intake clinic and then send the draft to Maya for review before Friday",
      "Can you set up the onboarding goal for the vendor call next week and compare the two quotes we got",
      "please help me write the reminder emails for the registrants of the October workshop in plain words",
      "I need you to go through the retainer letters and tell me which ones still read two thousand five hundred",
    ];
    for (const [i, first] of firsts.entries()) {
      v.script.push({ text: "On it." }); v.script.push({ text: "Intake clinic page" });
      const id = (await api("chat.start", { kind: "chat", agentIds: [assistant.agentId], idempotencyKey: `cl-chat-${i}`, first })).thread.threadId as string;
      await page.goto(`${web.origin}/chat#subject=thread:${id}`, { waitUntil: "load" });
      await page.getByText("On it.", { exact: true }).first().waitFor({ timeout: 60_000 }).catch(() => undefined);
    }
    await page.waitForTimeout(3000);   // titles are made after the first turn
    await shot("22-sidebar-titles");
    const sidebarText = await page.getByTestId("sidebar-outlet").innerText().catch(() => "");
    fs.writeFileSync(path.join(shots, "22-sidebar-text.txt"), sidebarText);

    // 31, 32: a channel with a long name and a long history
    const ch = (await api("channels.create", { name: "Amicus pro bono intake coordination", visibility: "public", memberIds: [], agentIds: [], idempotencyKey: "cl-channel" })).channel as { mainThreadId: string };
    let firstMessage = "";
    for (let i = 0; i < 70; i++) {
      const m = (await api("chat.post", { threadId: ch.mainThreadId, body: `Message ${i + 1}: the intake form for matter ${1000 + i} came back and the retainer reads two thousand five hundred; please confirm before Thursday.`, idempotencyKey: `cl-m-${i}` })).message as { messageId: string };
      if (i === 68) firstMessage = m.messageId;
    }
    const th = (await api("chat.thread", { threadId: ch.mainThreadId, messageId: firstMessage })).thread as { threadId: string };
    await api("chat.post", { threadId: th.threadId, body: "Replying in the thread so the pane has something to show.", idempotencyKey: "cl-reply" });
    await page.goto(`${web.origin}/chat#screen=chats.conversation&threadId=${ch.mainThreadId}`, { waitUntil: "load" });
    await page.getByTestId("composer-field").first().waitFor({ timeout: 30_000 });
    await guard.check("the long channel");
    await page.waitForTimeout(1500);
    await page.evaluate(`(() => { const f = document.querySelector("[data-testid=conversation-feed]"); if (f) f.scrollTop = 0; })()`);
    await page.waitForTimeout(800);
    const jump = await page.getByTestId("to-latest").count();
    await shot("31-jump-to-latest");
    fs.writeFileSync(path.join(shots, "31-jump.txt"), `to-latest buttons: ${jump}\n`);
    await page.goto(`${web.origin}/chat#screen=chats.conversation&threadId=${ch.mainThreadId}`, { waitUntil: "load" });
    await page.getByTestId("composer-field").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await page.getByText("1 reply", { exact: true }).first().click({ timeout: 15_000 }).catch((e) => fs.writeFileSync(path.join(shots, "32-click-error.txt"), String(e)));
    await page.getByTestId("thread-side").first().waitFor({ timeout: 15_000 }).catch(async () => { fs.writeFileSync(path.join(shots, "32-no-pane.txt"), (await page.url()) + "\n"); });
    await page.waitForTimeout(1500);
    await shot("32-thread-pane");
    const widths = await page.evaluate(`(() => { const e = document.querySelector("[data-testid=thread-side]"); return { side: e ? Math.round(e.getBoundingClientRect().width) : null, window: window.innerWidth }; })()`);
    fs.writeFileSync(path.join(shots, "32-widths.txt"), JSON.stringify(widths) + "\n");

    // 30: a 14-line draft
    await page.goto(`${web.origin}/chat#screen=chats.conversation&threadId=${ch.mainThreadId}`, { waitUntil: "load" });
    const field = page.getByTestId("composer-field").first();
    await field.waitFor({ timeout: 30_000 });
    await field.fill(Array.from({ length: 14 }, (_, i) => `Line ${i + 1} of a long draft that keeps going`).join("\n"));
    await page.waitForTimeout(600);
    const box = await page.getByTestId("composer").first().boundingBox();
    await shot("30-long-draft");
    fs.writeFileSync(path.join(shots, "30-composer.txt"), `composer height ${Math.round(box?.height ?? -1)} of window 900\n`);
    assert.ok((box?.height ?? 9999) < 900 * 0.45, `a 14-line draft stays capped: ${box?.height}`);
    await field.fill("");

    // 19: the same chat opened again and again from the sidebar and by address
    for (const id of [ch.mainThreadId, ch.mainThreadId]) { await page.goto(`${web.origin}/chat#screen=chats.conversation&threadId=${id}`, { waitUntil: "load" }); await page.waitForTimeout(800); }
    await shot("19-tabs-after-repeats");
    const tabs = await page.getByTestId("tab-strip").innerText().catch(() => "");
    fs.writeFileSync(path.join(shots, "19-tab-text.txt"), tabs + "\n");
    // a tab has no title of its own: each of the chats opened above reads as that chat's real title, and "New chat" shows nowhere
    const strip = await page.getByTestId("tab-strip").innerText();
    for (const title of ["Create a landing page", "Set up the onboarding goal", "Write the reminder emails", "Go through the retainer letters"]) assert.ok(strip.includes(title), `the tab for "${title}" reads that title; the strip says: ${strip.replaceAll("\n", " | ")}`);
    assert.ok(!/New chat/.test(strip), `no tab still reads New chat: ${strip.replaceAll("\n", " | ")}`);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); web.close(); await space.stop(); v.close(); }
});
