// Helpers as a person meets them (owner, 4 Nov 2026), in the real app against a booted daemon whose model vendor is a scripted session: two helpers are one row each in the chat, updated in place, with one line of what they found;
// row for it; one result card arrives in the lead's chat; pressing Merge on the card lands the branch in the project's repository and the card collapses to one line. Screenshots of every step go to
// VYRE_CREW_SHOTS (light and dark). Needs the web export (VYRE_APP_DIST) and a browser; without Chrome it fails when VYRE_REQUIRE_CHROME=1 and skips otherwise.
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

test("helpers are one row each, updated in place, the lead answers once, and a helper chat shows its brief as a block", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for browser evidence"); return; }
  const pw = await import("playwright-core");
  const engine = process.env["VYRE_BROWSER"] === "webkit" ? pw.webkit : pw.chromium;
  const exe = process.env["CHROME_BIN"] || (engine === pw.chromium ? pw.chromium.executablePath() : undefined);
  if (exe) assert.ok(fs.existsSync(exe), `a browser is required at ${exe}`);
  const shots = process.env["VYRE_CREW_SHOTS"] ?? fs.mkdtempSync(path.join(os.tmpdir(), "vyre-crew-shots-"));
  fs.mkdirSync(shots, { recursive: true });

  let lead = ""; let chat = "";
  let wakes = 0;
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead) return;
    if (input.threadId !== chat) {
      // a helper: it works from its brief and answers
      yield { type: "text", text: /1/.test(input.trigger?.body ?? "") ? "The pricing page lists three plans. Each one has a monthly and a yearly price." : "The fee schedule has two fees: a filing fee and a copy fee. Both are flat." };
      return;
    }
    const ask = input.trigger?.body ?? "";
    if (/research the two pages/.test(ask)) {
      yield* run("tool_search", { query: "sub task helper" });
      for (const n of [1, 2]) yield* run("sub_task_model", { threadId: input.threadId, title: `Crew test: subagent ${n}`, instruction: `Read page ${n} and tell me what it says.`, idempotencyKey: `h-${n}` });
      yield { type: "text", text: "I started two helpers." };
    } else if (input.trigger?.author.kind === "agent") {
      wakes += 1;
      if (wakes >= 2) yield { type: "text", text: "Both helpers are back: three plans on the pricing page and two flat fees on the schedule." };
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

    await api("chat.post", { threadId: chat, body: "research the two pages", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "j-ask" });
    // the lead answers once, after both helpers are in; nothing of theirs is pasted
    const answer = await waitFor(async () => {
      const ms = (await api("chat.messages.list", { threadId: chat })).messages as Array<{ author: { kind: string }; body: string }>;
      return ms.find((m) => /^Both helpers are back/.test(m.body)) ?? null;
    }, 60_000, () => hostLog(d));
    assert.doesNotMatch(answer.body, /found:|three plans\. Each one/, "the lead does not paste the helpers' replies");
    const ms = (await api("chat.messages.list", { threadId: chat })).messages as Array<{ body: string; blocks: Array<{ type: string; state?: string; data?: Record<string, unknown> }> }>;
    assert.equal(ms.filter((m) => m.blocks.some((b) => b.type === "helper" && b.data?.["helperThreadId"] !== undefined)).length, 2, "one start line per helper");

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
      await page.getByText(/^Both helpers are back/).first().waitFor({ timeout: 30_000 });
      assert.equal(await page.getByText("Started a helper", { exact: false }).count(), 0, "no 'Started a helper' line");
      assert.equal(await page.getByText(/found:/).count(), 0, "no pasted result");
      // one strip for the two helpers, a row each, no Open button
      await page.getByTestId("crew-strip").first().waitFor({ timeout: 20_000 }).catch(async (e) => { await shoot(page, `${mode}-FAILED-strip`); throw e; });
      assert.equal(await page.getByTestId("crew-strip").count(), 1, "one strip");
      assert.equal(await page.locator('[data-testid^="crew-chip-"][data-testid$="-line"]').count(), 2, "a row per helper");
      assert.equal(await page.getByText("Open", { exact: true }).count(), 0, "no Open button");
      await shoot(page, `crew-t27-${mode}-${phone ? "phone" : "wide"}`);
      // the row opens the peek in the pane
      await page.locator('[role="button"][data-testid^="crew-chip-"]').first().click({ timeout: 15_000 });
      await page.getByTestId("crew-peek").first().waitFor({ timeout: 20_000 }).catch(async (e) => { await shoot(page, `${mode}-FAILED-peek`); throw e; });
      await shoot(page, `crew-peek1-${mode}-${phone ? "phone" : "wide"}`);
      await page.getByTestId("crew-peek-back").click({ timeout: 10_000 });
      await page.getByTestId("crew-overview").first().waitFor({ timeout: 20_000 });
      await shoot(page, `crew-over-${mode}-${phone ? "phone" : "wide"}`);
      await page.getByTestId("crew-overview").locator('[data-testid^="crew-row-"]').first().click({ timeout: 10_000 });
      await page.getByTestId("crew-peek-open").click({ timeout: 15_000 });
      await page.getByText(/Brief from/).first().waitFor({ timeout: 20_000 }).catch(async (e) => { await shoot(page, `${mode}-FAILED-helper-chat`); throw e; });
      await shoot(page, `crew-chat1-${mode}-${phone ? "phone" : "wide"}`);
      await ctx.close();
    }
  } finally { await browser.close(); web.close(); await stop(d); }
});
