// The chat surfaces in the real app with a live reply: the production export, a fresh claimed daemon (Team and Personal), the real engine and OpenAI driver, and a local stand-in for the model vendor.
// Proved here: the record Chat tab streams a reply in the shared conversation, Stop ends a held turn, the Ask thread carries the record on screen, and what the engine puts in front of the model
// names the record (its type and title), not only its id. Shots in paper and graphite, desktop and phone, go to VYRE_CHAT_SURFACES_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { vendor } from "../../../fixtures/model-vendor.ts";

const PRELOAD = fileURLToPath(new URL("../../../fixtures/model-vendor-preload.mjs", import.meta.url));
const KEY = "sk-test-fixture-0123456789abcdef"; // secret-scan: fake

for (const kind of ["team", "personal"] as const) {
  test(`chat surfaces, ${kind} Space: the record Chat tab answers live, Stop works, and the agent is told which record it is about`, async (t) => {
    const dist = process.env["VYRE_APP_DIST"];
    if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
    const { chromium } = await import("playwright-core");
    const exe = process.env["CHROME_BIN"] || chromium.executablePath();
    assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
    const v = await vendor();
    const priorOptions = process.env["NODE_OPTIONS"];
    process.env["NODE_OPTIONS"] = `${priorOptions ?? ""} --import ${PRELOAD}`.trim();
    process.env["VYRE_TEST_VENDOR"] = v.base;
    const space = await bootFreshSpace(kind === "personal" ? "personal" : undefined, true);
    if (priorOptions === undefined) delete process.env["NODE_OPTIONS"]; else process.env["NODE_OPTIONS"] = priorOptions;
    const web = await edge(dist, space.url);
    const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const shots = process.env["VYRE_CHAT_SURFACES_SHOTS"] ?? "/tmp/vyre-chat-surfaces-shots"; fs.mkdirSync(shots, { recursive: true });
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
      // a model the way a person connects it, and the assistant using it
      const provider = await api("providers.add", { idempotencyKey: "cs-provider", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
      if (kind === "team") await api("providers.set_space_use", { idempotencyKey: "cs-spaceuse", providerId: provider.provider.id, allow: true });
      const assistant = (await api("agents.list", {})).agents[0] as { agentId: string; name: string };
      await api("agents.update", { agentId: assistant.agentId, patch: { model: "gpt-4o-mini" }, idempotencyKey: "cs-model" });
      const rec = (await api("records.create", { type: "contact", fields: { name: "Ada Lovelace" }, idempotencyKey: "cs-rec" })).record as { id: string };

      // the record Chat tab: the right pane's overflow, then Chat
      await page.goto(`${web.origin}/records#subject=record:${rec.id}&type=contact`, { waitUntil: "load" });
      await page.getByTestId("tab-more").waitFor({ timeout: 20_000 });
      await page.getByTestId("tab-more").click(); await page.getByRole("menuitem", { name: "Chat", exact: true }).click();
      const field = page.getByTestId("composer-field").first();
      await field.waitFor({ timeout: 30_000 });
      const ask = async (text: string): Promise<void> => { await field.fill(text); await field.press("Enter"); };

      // 1 a live reply streams into the shared conversation
      v.script.push({ text: "Ada Lovelace is a contact record." });
      await ask("what is this record?");
      await page.getByText("Ada Lovelace is a contact record.", { exact: true }).waitFor({ timeout: 60_000 });
      // 2 the model was told which record this is: its type and title, not only the id
      const told = v.requests.map((r) => { try { const j = JSON.parse(r) as { messages?: { content?: unknown }[]; instructions?: unknown }; return JSON.stringify(j.messages ?? j.instructions ?? j).replaceAll("\\n", "\n").replaceAll('\\"', '"'); } catch { return r; } }).join("\n");
      const where = told.split("\n").filter((l) => l.includes("about record")).join(" | ");
      assert.ok(told.includes(`about record ${rec.id} "contact: Ada Lovelace"`), `the turn context names the record; it says: ${where.slice(0, 300)}`);

      // 3 the Ask thread carries the screen: the record is on it
      // (an Ask pane is never listed in Recent: ask for the same thread again with the key the pane used, which returns it)
      const me = (await api("identity.whoami", {})).principal.id as string;
      const again = await api("chat.start", { kind: "ask", agentIds: [assistant.agentId], scopeType: "record", scopeId: rec.id, title: "Record", idempotencyKey: `record-ask-${me}-${rec.id}` });
      const screen = (await api("chat.screen.get", { threadId: again.thread.threadId })).screen as { open?: { type: string; id: string }[] } | null;
      const sawScreen = screen?.open?.some((o) => o.type === "record" && o.id === rec.id) === true;
      assert.ok(sawScreen, "a message sent from the record Chat tab carries the record on screen");

      // 4 Working and Stop: a held turn shows Stop on the composer, and Stop ends it
      v.script.push({ hold: true });
      const seen = v.requests.length;
      await ask("keep thinking");
      while (v.requests.length === seen) await new Promise((r) => setTimeout(r, 50));
      const stop = page.getByRole("button", { name: "Stop", exact: true }).first();
      const paneHasStop = await stop.waitFor({ timeout: 15_000 }).then(() => true, () => false);
      await page.screenshot({ path: path.join(shots, `${kind}-record-chat-working-paper-desktop.png`) });
      if (paneHasStop) { await stop.click(); await page.getByRole("button", { name: "Stop", exact: true }).first().waitFor({ state: "detached", timeout: 20_000 }); }
      // 5 the same held turn in the Chats place: Working and Stop are on the composer there too
      const chatThread = (await api("chat.start", { kind: "chat", agentIds: [assistant.agentId], title: "Held chat", idempotencyKey: "cs-chat" })).thread.threadId as string;
      await page.goto(`${web.origin}/chat#subject=thread:${chatThread}`, { waitUntil: "load" });
      const chatField = page.getByTestId("composer-field").first();
      await chatField.waitFor({ timeout: 30_000 });
      v.script.push({ hold: true });
      const seenChat = v.requests.length;
      await chatField.fill("hold this one"); await chatField.press("Enter");
      while (v.requests.length === seenChat) await new Promise((r) => setTimeout(r, 50));
      const chatStop = page.getByRole("button", { name: "Stop", exact: true }).first();
      await chatStop.waitFor({ timeout: 20_000 }).catch(async (e) => { await page.screenshot({ path: path.join(shots, `${kind}-chats-stop-missing.png`) }); throw e; });
      await page.screenshot({ path: path.join(shots, `${kind}-chats-working-paper-desktop.png`) });
      await chatStop.click();
      for (const [skin, w, h] of [["paper", 1280, 900], ["graphite", 1280, 900], ["paper", 390, 844], ["graphite", 390, 844]] as const) {
        await page.setViewportSize({ width: w, height: h });
        await page.evaluate((s) => document.documentElement.setAttribute("data-mode", s === "graphite" ? "dark" : "light"), skin);
        await page.screenshot({ path: path.join(shots, `${kind}-record-chat-reply-${skin}-${w < 700 ? "phone" : "desktop"}.png`) });
      }
      await page.setViewportSize({ width: 1280, height: 900 }); await page.evaluate(() => document.documentElement.setAttribute("data-mode", "light"));

      assert.ok(paneHasStop, "the record Chat tab shows Stop while the agent works");
      assert.deepEqual(errors, []);
    } finally { await browser.close(); web.close(); await space.stop(); v.close(); }
  });
}
