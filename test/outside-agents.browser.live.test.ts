// The owner's walk in a real browser, on the production web export: an app asks to join, the tab it opened says so, the Allow page takes one press, the tab hands the sign-in to the app by itself, and the agent's page shows what it did.
// Screenshots go to OUTSIDE_SHOTS. Needs VYRE_APP_DIST (the web export) and a Chromium; without them it says so and skips.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "../apps/app/tests/real-app-harness.test.ts";

const DIST = process.env["VYRE_APP_DIST"] ?? "";
const OUT = process.env["OUTSIDE_SHOTS"] ?? fs.mkdtempSync("/tmp/outside-shots-");
type Json = any;   // eslint-disable-line @typescript-eslint/no-explicit-any

test("the tab, the Allow page, the hand back, and the agent's page", { skip: DIST === "" ? "VYRE_APP_DIST is not set" : false, timeout: 240_000 }, async () => {
  const { chromium } = await import("playwright-core");
  const space = await bootFreshSpace(undefined, true);
  const web = await edge(DIST, space.url);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "dark" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // the app's own callback, the way Claude Code listens
  let code = "";
  const verifier = randomBytes(40).toString("base64url");
  const callback = http.createServer((req, res) => { code = new URL(req.url ?? "/", "http://x").searchParams.get("code") ?? ""; res.writeHead(200, { "content-type": "text/html" }); res.end("<h1>Authenticated</h1>"); });
  await new Promise<void>((r) => callback.listen(0, "127.0.0.1", r));
  const redirect = `http://127.0.0.1:${(callback.address() as { port: number }).port}/callback`;
  const shot = (name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin));
    for (const [id, value] of [["claim-name", "Dana Wine"], ["claim-username", "dana"], ["claim-password", "fixture password123"], ["claim-confirm", "fixture password123"]]) await page.getByTestId(id!).fill(value!);
    await page.getByTestId("claim-submit").click({ timeout: 20_000 }).catch(() => page.keyboard.press("Enter"));
    await dismissOnboarding(page as never);

    // the app: from the 401
    const r401 = await fetch(`${web.origin}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r401.status, 401);
    const reg = (await (await fetch(`${web.origin}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude Code (vyre)", redirect_uris: [redirect] }) })).json()) as Json;
    const authorize = `${web.origin}/oauth/authorize?${new URLSearchParams({ client_id: reg.client_id, redirect_uri: redirect, response_type: "code", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: "s1", resource: `${web.origin}/mcp` })}`;

    // the tab it opens
    const tab = await context.newPage();
    await tab.goto(authorize);
    await tab.getByText("Claude Code wants to join").waitFor({ timeout: 10_000 });
    await tab.screenshot({ path: path.join(OUT, "tab.png") });
    assert.equal(await tab.getByRole("button", { name: "Allow" }).count(), 0, "no Allow on the tab");
    const framed = await context.newPage();
    await framed.goto(`${web.origin}/healthz`);
    const blocked = await framed.evaluate((url) => new Promise<boolean>((resolve) => { const f = document.createElement("iframe"); f.src = url; f.onload = () => { try { resolve(!f.contentDocument || f.contentDocument.body.innerText === ""); } catch { resolve(true); } }; f.onerror = () => resolve(true); document.body.append(f); setTimeout(() => resolve(true), 3000); }), authorize);
    assert.equal(blocked, true, "the tab refuses to sit in a frame");
    await framed.close();

    // the person, signed in here: the one press
    const requestId = /"request":"(oar_[a-z0-9]+)"/.exec(await (await fetch(authorize)).text())?.[1] ?? "";
    assert.ok(requestId);
    const tabRequest = await tab.evaluate(() => /"request":"(oar_[a-z0-9]+)"/.exec(document.documentElement.innerHTML)?.[1] ?? "");
    await page.goto(`${web.origin}/oauth/allow?request=${tabRequest}`);
    await page.getByTestId("allow-allow").waitFor({ timeout: 20_000 });
    await shot("allow");
    const small = await context.newPage();
    await small.setViewportSize({ width: 390, height: 780 });
    await small.goto(`${web.origin}/oauth/allow?request=${tabRequest}`);
    await small.getByTestId("allow-allow").waitFor({ timeout: 20_000 });
    await small.screenshot({ path: path.join(OUT, "allow-phone.png") });
    await small.close();
    await page.getByTestId("allow-allow").click();
    await page.getByTestId("allow-joined").or(page.getByTestId("allow-done")).first().waitFor({ timeout: 20_000 });
    await shot("joined");

    // the tab hands the sign-in over by itself
    for (let i = 0; i < 60 && code === ""; i++) await new Promise((r) => setTimeout(r, 200));
    assert.ok(code, "the tab followed the redirect");
    const t = (await (await fetch(`${web.origin}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: reg.client_id, code, redirect_uri: redirect, code_verifier: verifier, resource: `${web.origin}/mcp` }).toString() })).json()) as Json;
    assert.ok(t.access_token, JSON.stringify(t));
    const rpc = async (method: string, params: unknown = {}): Promise<Json> => {
      const r = await fetch(`${web.origin}/mcp`, { method: "POST", headers: { authorization: `Bearer ${t.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      return r.status === 202 ? null : r.json();
    };
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1" } });
    assert.equal((await rpc("tools/call", { name: "tasks_list", arguments: {} })).result.isError, false);
    await rpc("tools/call", { name: "records_query", arguments: { type: "contact" } });

    // the agent's page
    const token = await page.evaluate(() => { const o = JSON.parse(localStorage.getItem("vyre.session.v1") ?? "{}"); return Object.values(o.sessions ?? {}).map((s) => (s as { token: string }).token)[0]; });
    const v1 = async (cap: string, body: unknown = {}): Promise<Json> => (await (await fetch(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { authorization: `Bearer ${token as string}`, "content-type": "application/json" }, body: JSON.stringify(body) })).json()).data;
    const agents = (await v1("mcp.connected.list")).agents;
    assert.equal(agents.length, 1);
    const agentId = agents[0].agentId as string;
    await page.goto(`${web.origin}/chat#screen=chats.agent-page&agentId=${agentId}`);
    await page.getByTestId("agent-page").waitFor({ timeout: 30_000 });
    await page.getByTestId("agent-outside-line").waitFor({ timeout: 20_000 });
    await page.getByTestId("activity-list").waitFor({ timeout: 20_000 });
    await shot("profile");
    await page.goto(`${web.origin}/chat#screen=chats.connect-outside-agent&channelId=none`);
    await page.getByTestId("connect-outside-agent").waitFor({ timeout: 20_000 }).catch(() => undefined);
    await shot("sheet");
    await page.goto(`${web.origin}/settings#page=connected`);
    await page.getByTestId("outside-agents").waitFor({ timeout: 30_000 }).catch(() => undefined);
    await page.getByTestId("outside-agents").scrollIntoViewIfNeeded().catch(() => undefined);
    await shot("settings");
    console.log(`shots in ${OUT}; page errors: ${errors.length}`);
    assert.deepEqual(errors, []);
  } finally {
    callback.close();
    await context.close(); await browser.close(); web.close(); await space.stop();
  }
});
