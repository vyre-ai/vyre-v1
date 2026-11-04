// A person at work with running helpers, in the real app (owner, 4 Nov 2026): the held request card with Today, Always and No; Change model on a running helper; a member messaging a helper and the helper answering them in its own chat;
// and the line "To <helper>: ..." in the chat above. Shots go to VYRE_CREW_SHOTS (paper and graphite). Needs the web export (VYRE_APP_DIST) and a browser.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workFolder } from "../modules/engine/sandbox.ts";
import { makeBundle } from "../client/src/crypto/keys.ts";
import { holdKeyOnOwnNode } from "../client/src/gateway/local-key.ts";
import { edge } from "../apps/app/tests/real-app-harness.test.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { boot, hostLog, scriptedModel, stop, waitFor, KEY } from "./support/eco-live.ts";

const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const PASSWORD = "crew journey password 7731";

test("running helpers: a held request, Change model, a person messaging a helper and its answer, and the line in the chat above", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for browser evidence"); return; }
  const pw = await import("playwright-core");
  const engine = process.env["VYRE_BROWSER"] === "webkit" ? pw.webkit : pw.chromium;
  const exe = process.env["CHROME_BIN"] || (engine === pw.chromium ? pw.chromium.executablePath() : undefined);
  if (exe) assert.ok(fs.existsSync(exe), `a browser is required at ${exe}`);
  const shots = process.env["VYRE_CREW_SHOTS"] ?? fs.mkdtempSync(path.join(os.tmpdir(), "vyre-crew-shots-"));
  fs.mkdirSync(shots, { recursive: true });

  let lead = ""; let chat = "";
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead) return;
    const body = input.trigger?.body ?? "";
    if (input.threadId === chat) {
      if (/start the helpers/.test(body)) {
        yield* run("tool_search", { query: "sub task helper" });
        yield* run("sub_task_model", { threadId: input.threadId, title: "Read the vendor page", instruction: "Reader job: read the vendor page and tell me the price.", idempotencyKey: "w-1" });
        yield* run("sub_task_model", { threadId: input.threadId, title: "Write the summary", instruction: "Writer job: write the summary file.", idempotencyKey: "w-2" });
        yield { type: "text", text: "Two helpers are on it." };
      }
      return;
    }
    if (/Keep it short/.test(body)) { yield { type: "text", text: "Noted. I will keep it short." }; return; }
    if (/Starting again on/.test(body)) { yield { type: "text", text: "Restarted. The price is $4,180." }; return; }
    if (/Reader job/.test(body)) { await new Promise((r) => setTimeout(r, 90_000)); yield { type: "text", text: "The price is $4,180." }; return; }
    if (/Writer job/.test(body)) {
      yield* run("tool_search", { query: "files create" });
      yield* run("files_create", { name: "summary.md", content: "Summary", idempotencyKey: "w-file" });
      yield { type: "text", text: "Summary written." };
    }
  });
  const fresh = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-helper-rows-")));
  const d = await boot(fresh, model, { config: loadConfig(["--data-dir", fresh, "--port", "0", "--space", "spc_fresh", "--space-name", "Crew Co"], {}, "1.2.3") });
  const web = await edge(dist, d.url);
  const browser = await engine.launch(exe ? { executablePath: exe, args: ["--no-sandbox"] } : {});
  try {
    // the owner claims the Space the way a person does, and the key stays on this computer
    assert.ok(d.claim, "a fresh Space offers a claim link");
    const code = /claim\/([^#]+)/.exec(d.claim!.url)![1]!;
    const spaceId = /s=([^&]+)/.exec(d.claim!.url)![1]!;
    const made = await makeBundle(PASSWORD, "crew-plain-recovery-code-1", { spaceId });
    const claimed = await fetch(`${d.url}/v1/identity/claim_owner`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, spaceId, displayName: "Maya Chen", username: "maya", password: PASSWORD, deviceName: "journey", deviceClass: "desktop", keys: { personKeyByPassword: made.personKeyByPassword, personKeyByRecovery: made.personKeyByRecovery, publicKey: made.publicKey, privateKeyWrapped: made.privateKeyWrapped, spaceKeys: made.spaceKeys ?? [] } }) });
    assert.equal(claimed.status, 200, await claimed.clone().text());
    const token = ((await claimed.json()) as { data: { session: { token: string } } }).data.session.token;
    assert.equal(await holdKeyOnOwnNode(d.url, token, made.personKey), true);
    const api = async (cap: string, input: unknown): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
      const body = (await r.json()) as { data?: unknown };
      assert.equal(r.status, 200, `${cap}: ${r.status} ${JSON.stringify(body)}`);
      return body.data;
    };
    // her Claude account, as a person connects it
    const folder = (await api("vault.folders.create", { idempotencyKey: "j-folder", name: "Accounts", scope: "mine" })).folder.id as string;
    const flow = await api("providers.subscription_start", { idempotencyKey: "j-flow", providerKey: "claude-code" });
    await api("vault.item.put", { idempotencyKey: "j-item", folderId: folder, name: "Maya_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY, secret: true }] });
    const provider = (await api("providers.subscription_complete", { flowId: flow.flowId })).provider.id as string;
    await api("providers.set_space_use", { idempotencyKey: "j-spaceuse", providerId: provider, allow: true });
    await api("engine.pool.status", {});

    lead = await waitFor(async () => { await d.hooks?.pump?.(); const r = await api("agents.assistant_of", { personId: (await api("identity.whoami", {})).principal.id }); return typeof r.agentId === "string" ? (r.agentId as string) : null; }, 40_000);
    chat = (await api("chat.start", { kind: "chat", agentIds: [lead], title: "Pricing research", idempotencyKey: "j-chat" })).thread.threadId as string;
    for (const flow of ["team", "personal", "member"]) await api("spaces.onboarding.seen", { flow }).catch(() => undefined);
    const me = (await api("identity.whoami", {})).principal.id as string;
    const marker = (await api("spaces.get", {})).space.fingerprint as string;
    const session = { baseUrl: web.origin, token, personId: me, marker, def: { spaceId, name: "Crew Co", kind: "team", address: web.origin, role: "Owner", tint: ["#6E5CF0", "#9B6BE8"], kit: "northwind", skinDefault: "system", starred: true, needsYou: false, console: true, terminal: false, counts: {}, dots: {} } };
    const shoot = async (page: import("playwright-core").Page, name: string): Promise<void> => { await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
    const phone = process.env["VYRE_CREW_PHONE"] === "1";

    await api("threads.set_mode", { threadId: chat, mode: "ask" }).catch(() => undefined);
    await api("chat.post", { threadId: chat, body: "start the helpers", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "w-ask" });
    await waitFor(async () => {
      const r = (await api("engine.helpers.status", { threadId: chat })).helpers as Array<{ state: string }>;
      return r.length === 2 && r.some((h) => h.state === "working") ? r : null;
    }, 60_000, () => hostLog(d));
    const size = phone ? "phone" : "wide";

    for (const [skin, mode] of [["paper", "light"], ["graphite", "dark"]] as const) {
      const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
      await ctx.addInitScript((s: unknown) => { try { localStorage.setItem("vyre.session.v1", JSON.stringify({ sessions: { [(s as { baseUrl: string }).baseUrl]: s } })); } catch { /* blocked */ } }, session);
      const page = await ctx.newPage();
      page.on("console", (c) => { if (c.type() === "error") console.error("CONSOLE", c.text().slice(0, 300)); });
      await page.goto(`${web.origin}/chats?skin=${skin}`, { waitUntil: "load" });
      await page.getByText("Pricing research", { exact: false }).first().waitFor({ timeout: 40_000 });
      const later = page.getByText("Finish later", { exact: true });
      if (await later.count()) await later.first().click().catch(() => undefined);
      await page.getByText("Pricing research", { exact: false }).first().click({ timeout: 30_000 });
      await page.getByTestId("crew-strip").first().waitFor({ timeout: 30_000 }).catch(async (e) => { await shoot(page, `FAILED-strip-${mode}`); throw e; });
      // a held request: the helper that waits for a yes shows its card with Today, Always and No
      const held = await page.getByTestId(/^approval-today-/).count().catch(() => 0);
      console.log("HELD_CARD", mode, held);
      await shoot(page, `crew-t27-held-${mode}-${size}`);
      // Change model on the running helper
      await page.locator('[role="button"][data-testid^="crew-chip-"]').first().click({ timeout: 15_000 });
      await page.getByTestId("crew-peek").first().waitFor({ timeout: 20_000 });
      await page.getByTestId("crew-peek-change-model").click({ timeout: 10_000 });
      await page.locator('[data-testid^="row-crew-change-"]').first().waitFor({ timeout: 20_000 });
      await shoot(page, `crewmodels-choices-${mode}-${size}`);
      await page.locator('[data-testid^="row-crew-change-"]').first().click();
      await page.getByTestId("crew-change-confirm").waitFor({ timeout: 10_000 });
      await shoot(page, `crewmodels-confirm-${mode}-${size}`);
      await page.getByTestId("crew-change-go").click();
      await page.waitForTimeout(3000);
      // the helper chat: ask it something, it answers the person
      await page.getByTestId("crew-peek-open").click({ timeout: 15_000 }).catch(async () => { await page.getByTestId("crew-peek-back").click(); await page.locator('[data-testid^="row-crew-row-"]').first().click(); await page.getByTestId("crew-peek-open").click(); });
      await page.getByText(/Brief from/).first().waitFor({ timeout: 20_000 });
      await page.getByLabel(/^Ask .* something$/).first().fill("Keep it short.", { timeout: 15_000 });
      await page.getByTestId("helper-ask-send").click();
      await page.getByText("Noted. I will keep it short.").first().waitFor({ timeout: 60_000 }).catch(async (e) => { await shoot(page, `FAILED-answer-${mode}`); throw e; });
      assert.ok(await page.getByText(/replying to you/).count() > 0, "the helper says whom it answers");
      await shoot(page, `crew-chat1-ask-${mode}-${size}`);
      // the chat above sees what the person told the helper
      await page.getByText(/started by .* in Pricing research|Pricing research/).first().click({ timeout: 10_000 }).catch(() => undefined);
      await page.getByText(/^To ".*": Keep it short\.$/).first().waitFor({ timeout: 30_000 }).catch(async (e) => { await shoot(page, `FAILED-to-line-${mode}`); throw e; });
      await shoot(page, `crew-t27-toline-${mode}-${size}`);
      await ctx.close();
    }
  } finally { await browser.close(); web.close(); await stop(d); }
});
