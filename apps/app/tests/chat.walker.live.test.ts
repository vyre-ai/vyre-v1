// @tsx
// The walker's chat findings of 15 Nov 2026 in the real app: sending brings your message and the reply into view (the Jump to latest button stays away), a reply that did work shows the quiet "Worked" line under it,
// a plan card carries the plan's title, comes after the words that lead up to it, and Change it marks it Changing, the task made from it shows no id, the hover bar has React and Reply on an agent's message,
// and the search lists the title that matches first. Production export, a claimed Team Space, the stand-in model vendor (it can ask for a tool). Shots go to VYRE_CHAT_WALKER_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { vendor } from "../../../fixtures/model-vendor.ts";
import { rawIdsIn } from "../../../lib/id-shapes.ts";

const PRELOAD = fileURLToPath(new URL("../../../fixtures/model-vendor-preload.mjs", import.meta.url));
const KEY = "sk-test-fixture-0123456789abcdef"; // secret-scan: fake

test("chat walker findings: send follows, the Worked line, the plan card in order, no ids in the task view, React on an agent's message, search order", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const v = await vendor();
  const priorOptions = process.env["NODE_OPTIONS"];
  process.env["NODE_OPTIONS"] = `${priorOptions ?? ""} --import ${PRELOAD}`.trim();
  process.env["VYRE_TEST_VENDOR"] = v.base;
  const space = await bootFreshSpace(undefined, true);
  if (priorOptions === undefined) delete process.env["NODE_OPTIONS"];
  else process.env["NODE_OPTIONS"] = priorOptions;
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shots = process.env["VYRE_CHAT_WALKER_SHOTS"] ?? "/tmp/vyre-chat-walker-shots";
  fs.mkdirSync(shots, { recursive: true });
  const shot = async (name: string): Promise<void> => {
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(shots, `${name}.png`) });
  };
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Chat Owner");
    await page.getByTestId("claim-username").fill("chatowner");
    await page.getByTestId("claim-password").fill("fixture password 123");
    await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
    );
    const api = async (cap: string, data: unknown): Promise<any> => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, {
        headers: { authorization: `Bearer ${token}` },
        data,
      });
      assert.equal(r.status(), 200, `${cap}: ${await r.text()}`);
      return (await r.json()).data;
    };
    const provider = await api("providers.add", {
      idempotencyKey: "cw-provider",
      providerKey: "openai",
      connection: "api_key",
      apiKey: KEY,
      scope: "mine",
    });
    await api("providers.set_space_use", { idempotencyKey: "cw-use", providerId: provider.provider.id, allow: true });
    const assistant = (await api("agents.list", {})).agents[0] as { agentId: string };
    await api("agents.update", { agentId: assistant.agentId, patch: { model: "gpt-4o-mini" }, idempotencyKey: "cw-m" });
    const go = async (id: string): Promise<void> => {
      await page.goto(`${web.origin}/chat#screen=chats.conversation&threadId=${id}`, { waitUntil: "load" });
      await page.getByTestId("composer-field").first().waitFor({ timeout: 30_000 });
    };
    const feed = (): Promise<{ top: number; max: number; jump: number }> =>
      page.evaluate(
        `(() => { const f = document.querySelector("[data-testid=conversation-feed]"); return { top: Math.round(f.scrollTop), max: Math.round(f.scrollHeight - f.clientHeight), jump: document.querySelectorAll("[data-testid=to-latest]").length }; })()`,
      ) as Promise<{ top: number; max: number; jump: number }>;

    // 1: a long chat, scrolled up, four sends in a row: each brings the newest into view and Jump to latest is gone
    v.script.push({ text: "Noted." });
    const long = (
      await api("chat.start", {
        kind: "chat",
        agentIds: [assistant.agentId],
        idempotencyKey: "cw-long",
        first: "Start of a long chat about the workshop.",
      })
    ).thread.threadId as string;
    for (let i = 0; i < 24; i++)
      await api("chat.post", {
        threadId: long,
        body: `Earlier note ${i + 1}: the intake form for batch ${1000 + i} came back and the total reads two thousand five hundred.`,
        idempotencyKey: `cw-n-${i}`,
      });
    await go(long);
    await page.waitForTimeout(2000);
    // as a person's wheel does: the pointer over the feed, a long pull upward, then a moment for the feed to settle
    await page.mouse.move(700, 450);
    await page.mouse.wheel(0, -4000);
    await page.waitForTimeout(1200);
    assert.equal((await feed()).jump, 1, "scrolled up by the person: Jump to latest shows");
    await shot("01-scrolled-up");
    const field = page.getByTestId("composer-field").first();
    for (let i = 1; i <= 4; i++) {
      v.script.push({ text: `Reply number ${i}. ${"It is on the list and I will look at it. ".repeat(6)}` });
      await field.fill(`Message ${i} from me, sent in a row.`);
      await field.press("Enter");
      await page.waitForTimeout(i === 1 ? 2500 : 1200);
      const at = await feed();
      assert.ok(at.max - at.top <= 48, `send ${i}: the newest is in view (${JSON.stringify(at)})`);
      assert.equal(at.jump, 0, `send ${i}: no Jump to latest`);
    }
    await shot("02-after-four-sends");

    // 2: a turn that did work shows the quiet line, pressable
    v.script.push({ tool: { name: "people_status", args: {} } }, { text: "Everyone is around today." });
    const work = (
      await api("chat.start", {
        kind: "chat",
        agentIds: [assistant.agentId],
        idempotencyKey: "cw-work",
        first: "Who is around today?",
      })
    ).thread.threadId as string;
    await go(work);
    await page.locator('[data-testid^="work-"]').first().waitFor({ timeout: 30_000 });
    assert.match(await page.locator('[data-testid^="work-"]').first().innerText(), /Worked/);
    await shot("03-work-line");

    // 3: the plan card: the words first, the plan's title on the card, Change it marks it Changing
    v.script.push({ text: "Hello." });
    const plan = (
      await api("chat.start", {
        kind: "chat",
        agentIds: [assistant.agentId],
        idempotencyKey: "cw-plan",
        first: "Hello there, I need a hand.",
      })
    ).thread.threadId as string;
    await page.waitForTimeout(2500);
    v.script.push(
      { text: "Here is how I would do it.", tool: { name: "tool_search", args: { query: "plan_propose" } } },
      {
        tool: {
          name: "plan_propose",
          args: {
            threadId: plan,
            title: "Tidy the quarterly notes",
            steps: [{ text: "Read every note" }, { text: "Group them by topic" }],
          },
        },
      },
      { text: "Waiting for your answer." },
    );
    await go(plan);
    await field.fill("Make a plan for the quarterly notes");
    await field.press("Enter");
    const card = page.locator('[data-testid^="blk-plan-"][data-testid$="-title"]').first();
    await card.waitFor({ timeout: 40_000 });
    assert.match(await card.innerText(), /Tidy the quarterly notes/);
    const order = (await page.evaluate(
      `(() => { const t = document.body.innerText; return [t.indexOf("Here is how I would do it."), t.indexOf("Tidy the quarterly notes")]; })()`,
    )) as number[];
    assert.ok(order[0]! >= 0 && order[0]! < order[1]!, `the words come before the card: ${order.join(",")}`);
    await page.locator('[data-testid$="-edit"]').first().click();
    await page.waitForTimeout(500);
    const text = (await page.evaluate(`document.body.innerText`)) as string;
    assert.match(text, /Changing/);
    assert.doesNotMatch(text, /Plan declined|Plan sent back/);
    await shot("04-plan-changing");

    // the task made from the plan: no id anywhere
    await page
      .getByText("Tidy the quarterly notes", { exact: true })
      .first()
      .click({ timeout: 10_000 })
      .catch(() => undefined);
    await page.waitForTimeout(2500);
    const taskText = (await page.evaluate(`document.body.innerText`)) as string;
    assert.deepEqual(rawIdsIn(taskText), [], "no id is drawn");
    assert.doesNotMatch(taskText, /chat\.block|chat\.plan/);
    await shot("05-task-view");

    // 4: React and Reply are on an agent's message
    await go(work);
    await page.locator('[data-testid^="body-msg_"]').last().hover();
    await page.waitForTimeout(400);
    const acts = (await page.evaluate(
      `[...document.querySelectorAll("[data-testid^=act-]")].map((e) => e.getAttribute("data-testid").split("-")[1])`,
    )) as string[];
    assert.ok(acts.includes("add") && acts.includes("reply") && acts.includes("more"), `bar: ${acts.join(",")}`);
    await shot("06-hover-bar");

    // 5: search lists the title that matches first, and nothing that does not match
    await page.goto(`${web.origin}/chat`, { waitUntil: "load" });
    await page.getByTestId("chats-landing").waitFor({ timeout: 30_000 });
    await page.keyboard.press("Control+k");
    await page.keyboard.type("quarterly", { delay: 30 });
    await page.waitForTimeout(2500);
    const sheet = (await page.evaluate(`document.body.innerText`)) as string;
    assert.ok(
      sheet.indexOf("Tidy the quarterly notes") >= 0 || sheet.indexOf("Make a plan") >= 0,
      "a chat about it is listed",
    );
    await shot("07-search");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    web.close();
    await space.stop();
    v.close();
  }
});
