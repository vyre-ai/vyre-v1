// An agent works in its Space browser for a chat (f-wire, 12 Nov): the chat shows the same live card a computer's work gets, keyed by the agent's profile, and the Computer tab's Browser section
// lists the steps, each with its caption; picking one shows its picture. The browser is the Space browser port with a scripted service (no Docker); the chat, the engine, the agent's tool path,
// Files and the app are real. Needs the web export (VYRE_APP_DIST) and a browser.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBundle } from "../client/src/crypto/keys.ts";
import { holdKeyOnOwnNode } from "../client/src/gateway/local-key.ts";
import { edge } from "../apps/app/tests/real-app-harness.test.ts";
import { guardCrashes } from "../apps/app/tests/crash-guard.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { bindSpaceBrowser } from "../modules/computers/sbrowser/port.ts";
import type { ProfileRow, SpaceBrowser } from "../modules/computers/sbrowser/port.ts";
import { boot, hostLog, scriptedModel, stop, waitFor, KEY } from "./support/eco-live.ts";

const PASSWORD = "browser card password 7731";
// a one-pixel PNG: the step's picture in Files
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));

/** The Space browser service, scripted: one profile per agent, busy while a tool runs, a picture for each step. */
function scriptedBrowser(): { sb: SpaceBrowser; rows: Map<string, ProfileRow> } {
  const rows = new Map<string, ProfileRow>();
  const row = (id: string): ProfileRow => rows.get(id) ?? { profileId: id, running: true, tabs: 1, busy: false, takeover: false, viewers: 0, lastActiveAt: Date.now(), held: 0, paused: false };
  const sb: SpaceBrowser = {
    async available() { return true; },
    async tool(a) { rows.set(a.profileId, { ...row(a.profileId), busy: true, lastActiveAt: Date.now() }); return { url: "https://www.harborquotes.com/pricing", title: "Pricing", tree: "- page [e1]", truncated: false, ok: true, tabId: "t1", loading: false }; },
    async downloads() { return []; }, async downloadRead() { return new Uint8Array(); }, async downloadAck() {},
    async takeover() {}, async giveBack() {},
    async screenshot() { return { bytes: PNG, width: 1, height: 1 }; },
    async stream(a) { return { transport: "mjpeg", url: `/live/browser/${a.profileId}` }; },
    async sessions() { return []; }, async signOut() { return true; }, async importChrome() { return { bytes: 0 }; }, async stop() {}, async forget() {},
    async profiles() { return { profiles: [...rows.values()], maxRunning: 6 }; }, async health() { return { ok: true }; },
  } as SpaceBrowser;
  return { sb, rows };
}

test("an agent's Space browser work shows in the chat as the live card and in the Computer tab as steps", { timeout: 180_000 }, async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for browser evidence"); return; }
  const pw = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || pw.chromium.executablePath();
  assert.ok(fs.existsSync(exe), `a browser is required at ${exe}`);
  const shots = process.env["VYRE_TEST_CAPTURE_DIR"] ?? fs.mkdtempSync(path.join(os.tmpdir(), "vyre-browser-card-"));
  fs.mkdirSync(shots, { recursive: true });
  const browserd = scriptedBrowser();
  bindSpaceBrowser(browserd.sb);
  t.after(() => bindSpaceBrowser(null));

  let agent = "";
  let toolSaid = "";
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id === agent && /pricing/.test(input.trigger?.body ?? "")) {
      yield* run("tool_search", { query: "chrome open" });   // deferred tools are found first, as the engine does
      const r = yield* run("chrome_open", { url: "https://www.harborquotes.com/pricing" });
      toolSaid = JSON.stringify(r).slice(0, 600);
      yield { type: "text", text: "The pricing page is open." };
    }
  });
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-browser-card-")));
  const d = await boot(dir, model, { config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_fresh", "--space-name", "Card Co"], {}, "1.2.3") });
  const web = await edge(dist, d.url);
  const browser = await pw.chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  try {
    const code = /claim\/([^#]+)/.exec(d.claim!.url)![1]!;
    const spaceId = /s=([^&]+)/.exec(d.claim!.url)![1]!;
    const made = await makeBundle(PASSWORD, "browser-card-recovery-code-1", { spaceId });
    const claimed = await fetch(`${d.url}/v1/identity/claim_owner`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, spaceId, displayName: "Maya Chen", username: "maya", password: PASSWORD, deviceName: "card", deviceClass: "desktop", keys: { personKeyByPassword: made.personKeyByPassword, personKeyByRecovery: made.personKeyByRecovery, publicKey: made.publicKey, privateKeyWrapped: made.privateKeyWrapped, spaceKeys: made.spaceKeys ?? [] } }) });
    assert.equal(claimed.status, 200, await claimed.clone().text());
    const token = ((await claimed.json()) as { data: { session: { token: string } } }).data.session.token;
    assert.equal(await holdKeyOnOwnNode(d.url, token, made.personKey), true);
    const api = async (cap: string, input: unknown): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
      const body = (await r.json()) as { data?: unknown };
      assert.equal(r.status, 200, `${cap}: ${r.status} ${JSON.stringify(body)}`);
      return body.data;
    };
    const folder = (await api("vault.folders.create", { idempotencyKey: "b-folder", name: "Accounts", scope: "mine" })).folder.id as string;
    const flow = await api("providers.subscription_start", { idempotencyKey: "b-flow", providerKey: "claude-code" });
    await api("vault.item.put", { idempotencyKey: "b-item", folderId: folder, name: "Maya_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY, secret: true }] });
    const provider = (await api("providers.subscription_complete", { flowId: flow.flowId })).provider.id as string;
    await api("providers.set_space_use", { idempotencyKey: "b-spaceuse", providerId: provider, allow: true });
    agent = (await api("agents.create", { name: "Scout", role: "You browse the web for the team.", idempotencyKey: "b-agent" })).agent.agentId as string;
    browserd.rows.set(agent, { profileId: agent, running: true, tabs: 1, busy: false, takeover: false, viewers: 0, lastActiveAt: Date.now(), held: 0, paused: false });
    const threadId = (await api("chat.start", { kind: "chat", agentIds: [agent], title: "Pricing check", idempotencyKey: "b-chat" })).thread.threadId as string;
    for (const flow of ["team", "personal", "member"]) await api("spaces.onboarding.seen", { flow }).catch(() => undefined);
    await api("chat.post", { threadId, body: "Open the pricing page", mentions: [{ kind: "agent", id: agent }], idempotencyKey: "b-ask" });
    // the step is kept with its caption and picture, and the chat gets one browser_screenshot block
    let said = "";
    // the agent's tool call reaches its Space browser: refused before the handler, it was "/computerId: the id is missing" for every agent with no old desktop (f-wire, 12 Nov)
    await waitFor(async () => (toolSaid !== "" ? true : null), 60_000, () => hostLog(d));
    assert.doesNotMatch(toolSaid, /"ok":false/, `chrome_open as the agent: ${toolSaid}`);
    const steps = await waitFor(async () => {
      await d.hooks?.pump?.();
      said = JSON.stringify(((await api("chat.messages.list", { threadId })).messages as Array<{ body?: string; author?: unknown; blocks?: unknown }>).map((m) => [m.author, m.body, m.blocks])).slice(0, 1500);
      const r = await api("computers.browser.timeline", { agentId: agent });
      return (r.steps as unknown[]).length > 0 ? (r.steps as Array<{ caption: string; frameFileId?: string }>) : null;
    }, 60_000, () => `tool: ${toolSaid}\n${said}\n${hostLog(d)}`);
    assert.ok(steps[0]!.frameFileId, "the step has its picture");
    await waitFor(async () => (((await api("chat.messages.list", { threadId })).messages as Array<{ blocks?: Array<{ type: string }> }>).some((m) => (m.blocks ?? []).some((b) => b.type === "browser_screenshot")) ? true : null), 30_000, () => hostLog(d));

    const me = (await api("identity.whoami", {})).principal.id as string;
    const marker = (await api("spaces.get", {})).space.fingerprint as string;
    const session = { baseUrl: web.origin, token, personId: me, marker, def: { spaceId, name: "Card Co", kind: "team", address: web.origin, role: "Owner", tint: ["#6E5CF0", "#9B6BE8"], kit: "northwind", skinDefault: "system", starred: true, needsYou: false, console: true, terminal: false, counts: {}, dots: {} } };
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript((x: unknown) => { try { localStorage.setItem("vyre.session.v1", JSON.stringify({ sessions: { [(x as { baseUrl: string }).baseUrl]: x } })); } catch { /* blocked */ } }, session);
    const page = await ctx.newPage();
    const guard = guardCrashes(page);
    const shot = async (name: string): Promise<void> => { await guard.check(name); await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
    await page.goto(`${web.origin}/chats#subject=thread:${threadId}`, { waitUntil: "load" });
    const later = page.getByText("Finish later", { exact: true });
    if (await later.count()) await later.first().click().catch(() => undefined);
    // the chat: the browser step is the live card (the same one a computer's work gets), not a bare line
    const card = page.locator("[data-testid^=live-card-]").first();
    await card.waitFor({ timeout: 40_000 });
    assert.match(await card.innerText(), /Open|pricing/i);
    await shot("browser-card-chat");
    // the Computer tab: the Browser section lists the step with its caption; picking it shows its picture
    if (await page.getByTestId("pane-agent").count() === 0) await page.getByTestId("pane-button").click();
    await page.getByTestId("pane-agent").waitFor({ timeout: 20_000 });
    await page.getByTestId("tab-computer").click();
    await page.getByText("Steps", { exact: true }).first().waitFor({ timeout: 20_000 });
    assert.ok(await page.getByText(steps[0]!.caption, { exact: true }).count() > 0, "the step's caption is listed");
    await shot("browser-steps-tab");
    await page.getByText(steps[0]!.caption, { exact: true }).first().click();
    await page.getByTestId("browser-step-picture").waitFor({ timeout: 20_000 });
    await shot("browser-step-picture");
    await ctx.close();
  } finally { await browser.close(); web.close(); await stop(d); fs.rmSync(dir, { recursive: true, force: true }); }
});
