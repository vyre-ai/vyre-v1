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
import { guardCrashes } from "../apps/app/tests/crash-guard.ts";
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

  let lead = ""; let chat = ""; let dir = ""; let owner = "";
  const model = scriptedModel(async function* (input, run) {
    const body = input.trigger?.body ?? "";
    if (input.agent.id === lead && input.threadId === chat) {
      if (/start the crew/.test(body)) {
        yield* run("tool_search", { query: "sub task helper" });
        yield* run("sub_task_model", { threadId: input.threadId, title: "Check the calendar", instruction: "Calendar job: find a free slot next week.", idempotencyKey: "w-1" });
        yield* run("sub_task_model", { threadId: input.threadId, title: "Compare the quotes", instruction: "Quotes job: compare the two vendor quotes.", idempotencyKey: "w-2" });
        yield* run("sub_task_model", { threadId: input.threadId, title: "Read the Pine quote", instruction: "Writer job: read the Pine Works quote page.", idempotencyKey: "w-3" });
        yield* run("tool_search", { query: "crew teammate" });
        yield* run("crew_start", { threadId: input.threadId, idempotencyKey: "w-code", title: "Fix the invoice date bug", brief: "Fix the invoice date bug and add a test." });
        yield { type: "text", text: "Three helpers and a coder are on it. I will bring it together when they are back." };
      } else if (/Compare the quotes/.test(body) && input.trigger?.author.kind === "agent") {
        yield { type: "text", text: "Harbor costs more up front but is ready in two weeks [2]. Pine Works is cheaper but takes four [2]. The calendar check is still running [1]." };
      }
      return;
    }
    if (input.agent.id !== lead) {
      // a coder teammate: it adds its file on its own branch, then says so
      const work = workFolder(dir, owner, input.threadId, input.agent.id);
      await waitFor(async () => (fs.existsSync(path.join(work, ".git")) ? true : null), 30_000);
      fs.writeFileSync(path.join(work, "invoice-dates.ts"), "export const fixed = true;\n");
      git(work, "add", "-A"); git(work, "commit", "--quiet", "-m", "fix the invoice date bug");
      yield { type: "text", text: "Fixed the date bug and added a test." };
      return;
    }
    if (/Keep it short/.test(body)) { yield { type: "text", text: "Noted. I will keep it short." }; return; }
    if (/Starting again on/.test(body)) { yield { type: "text", text: "Restarted. Thursday at 14:00 is free." }; return; }
    if (/Calendar job/.test(body)) { await new Promise((r) => setTimeout(r, 60_000)); yield { type: "text", text: "Thursday at 14:00 is free." }; return; }
    if (/Quotes job/.test(body)) { await new Promise((r) => setTimeout(r, 20_000)); yield { type: "text", text: "Harbor is $4,180 in two weeks. Pine Works is $3,920 in four." }; return; }
    if (/Writer job/.test(body)) {
      await new Promise((r) => setTimeout(r, 8_000));
      yield* run("tool_search", { query: "read link" });
      // a link the agent put together itself waits for the person: the held request
      yield* run("read_link", { url: "https://pine-works.example/quote?ref=harbor-compare" });
      yield { type: "text", text: "Summary written." };
    }
  });
  const fresh = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-helper-rows-")));
  dir = fresh;
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
    chat = (await api("chat.start", { kind: "chat", agentIds: [lead], title: "Vendor call and quotes", idempotencyKey: "j-chat" })).thread.threadId as string;
    for (const flow of ["team", "personal", "member"]) await api("spaces.onboarding.seen", { flow }).catch(() => undefined);
    const me = (await api("identity.whoami", {})).principal.id as string;
    owner = me;
    const marker = (await api("spaces.get", {})).space.fingerprint as string;
    const session = { baseUrl: web.origin, token, personId: me, marker, def: { spaceId, name: "Crew Co", kind: "team", address: web.origin, role: "Owner", tint: ["#6E5CF0", "#9B6BE8"], kit: "northwind", skinDefault: "system", starred: true, needsYou: false, console: true, terminal: false, counts: {}, dots: {} } };
    const shoot = async (page: import("playwright-core").Page, name: string): Promise<void> => { await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
    const phone = process.env["VYRE_CREW_PHONE"] === "1";

    await api("chat.post", { threadId: chat, body: "start the crew", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "w-ask" });
    await waitFor(async () => {
      const r = (await api("engine.helpers.status", { threadId: chat })).helpers as Array<{ state: string }>;
      return r.length >= 3 && r.some((h) => h.state === "working") ? r : null;
    }, 60_000, () => hostLog(d)).catch(async (e) => {
      console.log("CHAT", JSON.stringify(((await api("chat.messages.list", { threadId: chat })).messages as Array<{ author: { kind: string }; body: string; blocks: Array<{ type: string }> }>).map((m) => [m.author.kind, m.body.slice(0, 120), m.blocks.map((b) => b.type)])));
      console.log("STATUS", JSON.stringify(((await api("engine.crew.status", { threadId: chat })).members as Array<{ title: string; state: string }>).map((m) => [m.title, m.state])));
      throw e;
    });
    const size = phone ? "phone" : "wide";
    // a thread under the first message, and a reply sent also to the chat
    const first = ((await api("chat.messages.list", { threadId: chat })).messages as Array<{ messageId: string }>)[0]!.messageId;
    const th = (await api("chat.thread", { threadId: chat, messageId: first })).thread.threadId as string;
    await api("chat.post", { threadId: th, body: "Decision: book Thursday 14:00 and go with Harbor.", alsoToChat: true, idempotencyKey: "w-also" });
    const copied = ((await api("chat.messages.list", { threadId: chat })).messages as Array<{ body: string; blocks: Array<{ type: string }> }>).some((m) => m.body.startsWith("Decision:") && m.blocks.some((b) => b.type === "from_thread"));
    assert.ok(copied, "Also post to the chat puts the decision in the chat, marked from the thread");

    for (const [skin, mode] of [["paper", "light"], ["graphite", "dark"]] as const) {
      const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
      await ctx.addInitScript((s: unknown) => { try { localStorage.setItem("vyre.session.v1", JSON.stringify({ sessions: { [(s as { baseUrl: string }).baseUrl]: s } })); } catch { /* blocked */ } }, session);
      const page = await ctx.newPage();
      const guard = guardCrashes(page);
      const shot = async (name: string): Promise<void> => { await guard.check(name); await shoot(page, name); };
      page.on("console", (c) => { if (c.type() === "error") console.error("CONSOLE", c.text().slice(0, 300)); });
      await page.goto(`${web.origin}/chats?skin=${skin}`, { waitUntil: "load" });
      await guard.check("after the chats page loaded");
      await page.getByText("Vendor call and quotes", { exact: false }).first().waitFor({ timeout: 40_000 });
      const later = page.getByText("Finish later", { exact: true });
      if (await later.count()) await later.first().click().catch(() => undefined);
      await page.getByText("Vendor call and quotes", { exact: false }).first().click({ timeout: 30_000 });
      await page.getByTestId("crew-strip").first().waitFor({ timeout: 40_000 }).catch(async (e) => { await guard.check("FAILED-strip"); await shoot(page, `FAILED-strip-${mode}`); throw e; });
      await page.waitForTimeout(4000);
      await shot(`crew-t14-running-${mode}-${size}`);
      await page.locator('[data-testid^="approval-"]').first().waitFor({ timeout: 40_000 }).catch(() => undefined);
      console.log("HELD_CARD", mode, await page.locator('[data-testid^="approval-"]').count());
      await shot(`crew-t27-held-${mode}-${size}`);
      // the quotes helper reports: the answer marks what came from which helper with chips
      await page.getByText(/Pine Works is cheaper/).first().waitFor({ timeout: 90_000 }).catch(async (e) => { await guard.check("FAILED-answer"); await shoot(page, `FAILED-answer-${mode}`); throw e; });
      console.log("CITE_CHIPS", mode, await page.locator('[data-testid^="cite-"]').count());
      await page.locator('[data-testid="cite-2"]').first().hover().catch(() => undefined);
      await page.waitForTimeout(400);
      await shot(`crew-t45-citations-${mode}-${size}`);
      console.log("CODE_ROW", mode, await page.locator('[data-testid$="-branch"]').count());
      await shot(`crewcode-${mode}-${size}`);
      // the header chip and the Crew pane
      await page.getByTestId("helpers-button").first().click({ timeout: 15_000 });
      await page.getByTestId("crew-overview").first().waitFor({ timeout: 20_000 });
      await shot(`crew-over-${mode}-${size}`);
      await page.getByTestId("crew-overview").locator('[data-testid^="crew-chip-"][role="button"]').filter({ hasText: "Check the calendar" }).first().click({ timeout: 15_000 });
      await page.getByTestId("crew-peek").first().waitFor({ timeout: 20_000 });
      await shot(`crew-peek1-${mode}-${size}`);
      if (mode === "light") {
        // Change model on the running helper
        await page.getByTestId("crew-peek-change-model").click({ timeout: 10_000 });
        await page.locator('[data-testid^="row-crew-change-"]').first().waitFor({ timeout: 20_000 });
        await shot(`crewmodels-choices-${mode}-${size}`);
        await page.locator('[data-testid^="row-crew-change-"]').first().click();
        await page.getByTestId("crew-change-confirm").waitFor({ timeout: 10_000 });
        await shot(`crewmodels-confirm-${mode}-${size}`);
        await page.getByTestId("crew-change-go").click();
        await page.waitForTimeout(3000);
        // the helper chat: ask it something, it answers the person
        await page.getByTestId("crew-peek-open").click({ timeout: 15_000 });
        await page.getByText(/Brief from/).first().waitFor({ timeout: 20_000 });
        await page.getByLabel(/^Ask .* something$/).first().fill("Keep it short.", { timeout: 15_000 }).catch(async (e) => { await shoot(page, `FAILED-ask-box-${mode}`); console.log("MEMBER", JSON.stringify(await api("engine.crew.status", { threadId: chat }).then((r: any) => r.members.map((m: any) => [m.title, m.state, m.step])))); throw e; });
        await page.getByTestId("helper-ask-send").click();
        await page.getByText("Noted. I will keep it short.").first().waitFor({ timeout: 100_000 }).catch(async (e) => { await guard.check("FAILED-reply"); await shoot(page, `FAILED-reply-${mode}`); throw e; });
        assert.ok(await page.getByText(/replying to you/).count() > 0, "the helper says whom it answers");
        await shot(`crew-chat1-ask-${mode}-${size}`);
      }
      if (mode === "light") {
        // the chat above sees what the person told the helper
        await page.getByText("Vendor call and quotes", { exact: false }).first().click({ timeout: 10_000 }).catch(() => undefined);
        await page.getByText(/^To ".*": Keep it short\.$/).first().waitFor({ timeout: 30_000 }).catch(async (e) => { await guard.check("FAILED-to-line"); await shoot(page, `FAILED-to-line-${mode}`); throw e; });
        await shot(`crew-t27-toline-${mode}-${size}`);
      }
      await ctx.close();
    }
  } finally { await browser.close(); web.close(); await stop(d); }
});
