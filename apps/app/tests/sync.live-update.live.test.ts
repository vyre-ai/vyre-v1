// With the sync module's hub serving the socket, a change committed on the Space reaches an open Records screen through the sync module's live socket, not through polling: the production export, a freshly claimed Space, a real browser.
// The session polls only while its link is not live (session.ts), so a table that updates inside the poll interval, with an `ev` frame carrying the new row on the page's own socket, was pushed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCapCaller } from "../../../client/src/gateway/index.ts";
import { routes } from "../../../generated/routes.ts";
import { fileURLToPath } from "node:url";
import { bootFreshSpace, edge, claimOnEdge } from "./real-app-harness.test.ts";
import { vendor } from "../../../fixtures/model-vendor.ts";

const PRELOAD = fileURLToPath(new URL("../../../fixtures/model-vendor-preload.mjs", import.meta.url));
const KEY = "sk-test-fixture-0123456789abcdef"; // secret-scan: fake

const POLL_MS = 5000;

test("with sync live, a committed record and a real agent turn's reply each reach the open screen through the live socket, inside the poll interval", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("production artifact required"); t.skip("VYRE_APP_DIST required"); return; }
  const { chromium } = await import("playwright-core");
  // the model vendor is a local stand-in that api.openai.com requests are sent to inside the daemon process; everything else (chat, agents, engine, driver, Vault key) is real
  const v = await vendor();
  const priorOptions = process.env["NODE_OPTIONS"];
  process.env["NODE_OPTIONS"] = `${priorOptions ?? ""} --import ${PRELOAD}`.trim();
  process.env["VYRE_TEST_VENDOR"] = v.base;
  const space = await bootFreshSpace();
  if (priorOptions === undefined) delete process.env["NODE_OPTIONS"]; else process.env["NODE_OPTIONS"] = priorOptions;
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath() });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const received: string[] = [];
    page.on("websocket", (ws) => { if (ws.url().includes("/sync/v1/ws")) ws.on("framereceived", (f) => received.push(String(f.payload)));  });
    await page.goto(claimOnEdge(space.claim!, web.origin));
    for (const [id, value] of [["claim-name", "Live owner"], ["claim-username", "liveowner"], ["claim-password", "fixture live password123"], ["claim-confirm", "fixture live password123"]] as const) await page.getByTestId(id).fill(value);
    for (const id of ["claim-next", "claim-saved", "claim-create"]) await page.getByTestId(id).click();
    await page.getByTestId("shell").waitFor({ timeout: 30000 });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin]);
    const api = createCapCaller({ baseUrl: web.origin, token: () => stored.token, routes: async () => routes });
    await api("schema.apply", { idempotencyKey: "live-update-type", ops: [{ op: "type.create", type: "live_contact", def: { title: "Live contact", plural: "Live contacts", icon: "user", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }] } }] });

    await page.goto(web.origin + "/records?skin=paper");
    await page.getByTestId("records-table").waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="records-table"]')?.getAttribute("aria-label")?.includes("table"));
    for (const end = Date.now() + 15000; Date.now() < end && !received.some((f) => f.includes('"hello_ok"')); await new Promise<void>((r) => setTimeout(r, 100)));
    const hello = received.find((f) => f.includes('"hello_ok"'));
    assert.ok(hello, "the page's socket was answered by the hub");
    assert.equal((JSON.parse(hello!) as { ok?: { mode?: string } }).ok?.mode, "live", "in the modern envelope, live: the session therefore does not poll");

    await page.getByText("Live contacts", { exact: true }).first().click();
    await page.getByText("No live contacts yet.").first().waitFor({ timeout: 10000 });
    const name = `Pushed ${Date.now()}`;
    const started = Date.now();
    await api("records.create", { idempotencyKey: "live-update-row", type: "live_contact", fields: { name } });
    await page.getByText(name).first().waitFor({ timeout: POLL_MS - 1000 });
    assert.ok(Date.now() - started < POLL_MS, "it appeared before any poll could have run");
    assert.ok(received.some((f) => f.includes('"ev"') && f.includes(name)), "and an ev frame on the page's own socket carried the row");

    // a chat message is not a synced row (chat keeps its own tables): it reaches the open conversation through the server's `changed` tick, with the link live and nothing polling
    const provider = (await api("providers.add", { idempotencyKey: "live-provider", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" })) as { provider: { id: string } };
    await api("providers.set_space_use", { idempotencyKey: "live-spaceuse", providerId: provider.provider.id, allow: true });
    const agent = (await api("agents.create", { name: "Live agent", role: "Replies", model: "gpt-4o-mini", idempotencyKey: "live-update-agent" })) as { agent: { agentId: string } };
    await api("engine.pool.status", {});   // the first engine call builds the runtime; a message written before it exists is never handed to an engine
    const thread = (await api("chat.start", { kind: "chat", agentIds: [agent.agent.agentId], title: "Live chat", idempotencyKey: "live-update-thread" })) as { thread: { threadId: string } };
    await page.goto(web.origin + "/chat?skin=paper");
    await page.getByTestId("chats-place").waitFor({ timeout: 20000 });
    await page.getByText("Live chat", { exact: true }).first().click();
    await page.getByTestId("composer-field").waitFor({ timeout: 15000 });
    const before = received.length;
    // a real agent turn: the person sends a message from the composer, the engine asks the model, and the model's streamed answer is posted as the agent's reply, which must reach the open screen
    const answer = `Model reply ${Date.now()}`;
    v.script.push({ text: answer });
    await api("chat.post", { threadId: thread.thread.threadId, body: "Please answer", mentions: [{ kind: "agent", id: agent.agent.agentId }], idempotencyKey: "live-update-ask" });
    await page.getByText("Please answer").first().waitFor({ timeout: POLL_MS - 1000 });
    await page.getByText(answer).first().waitFor({ timeout: 30000 });
    assert.ok(v.requests.length >= 1, "the model stand-in was asked: a real turn ran");
    assert.ok(received.slice(before).filter((f) => f.includes('"changed"')).length >= 1, "and the page's socket was told that something changed");
  } finally { v.close(); await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); }
});
