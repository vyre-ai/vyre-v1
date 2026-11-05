// Crew in a project or channel thread (owner, 5 Nov 2026, prototype p-crew scene crewthread): the agent answers in a thread under the ask; its helpers and their strip live in the thread, and the main chat keeps
// only the ask and the thread footer. Shots go to VYRE_CREW_SHOTS (paper and graphite). Needs the web export (VYRE_APP_DIST) and a browser.
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

test("an agent in a channel thread starts helpers: the strip is in the thread, the main chat stays clean", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for browser evidence"); return; }
  const pw = await import("playwright-core");
  const engine = process.env["VYRE_BROWSER"] === "webkit" ? pw.webkit : pw.chromium;
  const exe = process.env["CHROME_BIN"] || (engine === pw.chromium ? pw.chromium.executablePath() : undefined);
  if (exe) assert.ok(fs.existsSync(exe), `a browser is required at ${exe}`);
  const shots = process.env["VYRE_CREW_SHOTS"] ?? fs.mkdtempSync(path.join(os.tmpdir(), "vyre-crew-shots-"));
  fs.mkdirSync(shots, { recursive: true });

  let lead = ""; let channel = ""; let dir = ""; let owner = "";
  let begun = false;
  let letGo!: () => void;
  const hold = new Promise<void>((r) => { letGo = r; });
  let finished = false;
  let api!: (cap: string, input: unknown) => Promise<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
  async function* step(id: string, name: string, detail: string, ms: number): AsyncGenerator<{ type: "block"; kind: string; payload: Record<string, unknown> }> {
    yield { type: "block", kind: "tool_call", payload: { id, name } };
    yield { type: "block", kind: "tool_input", payload: { id, detail } };
    await Promise.race([hold, new Promise((r) => setTimeout(r, ms))]);
    yield { type: "block", kind: "tool_result", payload: { id, ok: true } };
  }
  const model = scriptedModel(async function* (input, run) {
    const body = input.trigger?.body ?? "";
    if (/Quotes job/.test(body)) { yield* step("q-1", "Read", "harbor-quote.pdf", 120_000); yield { type: "text", text: "Harbor is $4,180 in two weeks." }; return; }
    if (/Site job/.test(body)) {
      yield* step("s-1", "WebFetch", "northwind.com", 120_000);
      yield { type: "text", text: "northwind.com lists the same two-week terms." };
      return;
    }
    if (input.agent.id === lead) {
      if (/compare the quotes/.test(body) && !begun) {
        begun = true;
        yield { type: "text", text: "Two helpers are on it: one compares the quotes, one reads northwind.com." };
        yield* run("tool_search", { query: "sub task helper" });
        yield* run("sub_task_model", { threadId: input.threadId, title: "Compare the quotes", instruction: "Quotes job: compare the two vendor quotes.", idempotencyKey: "t-1" });
        yield* run("sub_task_model", { threadId: input.threadId, title: "Read northwind.com", instruction: "Site job: read northwind.com.", idempotencyKey: "t-2" });
      } else if (input.trigger?.author.kind === "agent" && !finished) {
        finished = true;
        yield { type: "text", text: "Harbor is the better quote, and northwind.com confirms the same terms." };
      }
      return;
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
    api = async (cap: string, input: unknown): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
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
    channel = (await api("channels.create", { name: "quotes", visibility: "public", memberIds: [], agentIds: [lead], idempotencyKey: "t-channel" })).channel.mainThreadId as string;
    for (const flow of ["team", "personal", "member"]) await api("spaces.onboarding.seen", { flow }).catch(() => undefined);
    const me = (await api("identity.whoami", {})).principal.id as string;
    owner = me;
    const marker = (await api("spaces.get", {})).space.fingerprint as string;
    const session = { baseUrl: web.origin, token, personId: me, marker, def: { spaceId, name: "Crew Co", kind: "team", address: web.origin, role: "Owner", tint: ["#6E5CF0", "#9B6BE8"], kit: "northwind", skinDefault: "system", starred: true, needsYou: false, console: true, terminal: false, counts: {}, dots: {} } };
    const shoot = async (page: import("playwright-core").Page, name: string): Promise<void> => { await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
    const phone = process.env["VYRE_CREW_PHONE"] === "1";

    await api("threads.agent_settings.set", { threadId: channel, agentId: lead, mode: "lead", idempotencyKey: "t-lead" });
    await api("chat.post", { threadId: channel, body: "Get a helper to compare the quotes, and one to read northwind.com.", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "t-ask" });
    const thread = await waitFor(async () => { const m = ((await api("chat.messages.list", { threadId: channel })).messages as Array<{ messageId: string }>)[0]; if (!m) return null; const t = (await api("chat.thread", { threadId: channel, messageId: m.messageId }).catch(() => null)); return t?.thread?.threadId ?? null; }, 40_000, () => hostLog(d)) as string;
    for (const [skin, mode] of [["paper", "light"], ["graphite", "dark"]] as const) {
      const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
      await ctx.addInitScript((x: unknown) => { try { localStorage.setItem("vyre.session.v1", JSON.stringify({ sessions: { [(x as { baseUrl: string }).baseUrl]: x } })); } catch { /* blocked */ } }, session);
      const page = await ctx.newPage();
      const guard = guardCrashes(page);
      const size = phone ? "phone" : "wide";
      const shot = async (name: string): Promise<void> => { await guard.check(name); await shoot(page, name); };
      await page.goto(`${web.origin}/chats?skin=${skin}`, { waitUntil: "load" });
      const later = page.getByText("Finish later", { exact: true });
      if (await later.count()) await later.first().click().catch(() => undefined);
      await page.getByText("quotes", { exact: true }).first().waitFor({ timeout: 40_000 });
      await page.getByText("quotes", { exact: true }).first().click({ timeout: 20_000 });
      await page.getByText("Get a helper to compare the quotes").first().waitFor({ timeout: 40_000 });
      // the main chat keeps the ask and the thread's own footer: no strip here
      await page.waitForTimeout(3000);
      assert.equal(await page.getByTestId("crew-strip").count(), 0, "the main chat holds no crew strip");
      await page.getByText(/Working · 2 helpers/).first().waitFor({ timeout: 20_000 });   // the thread's footer says the helpers are at work, not that the agent is done
      await shot(`crewthread-main-${mode}-${size}`);
      // the thread holds the strip
      await page.getByRole("button", { name: /^Open the thread/ }).first().click({ timeout: 20_000 }).catch(async (e) => { await guard.check("FAILED-open-thread"); await shoot(page, `FAILED-open-thread-${mode}`); throw e; });
      await page.getByTestId("crew-strip").first().waitFor({ timeout: 40_000 }).catch(async (e) => { await guard.check("FAILED-thread-strip"); await shoot(page, `FAILED-crewthread-${mode}`); throw e; });
      await shot(`crewthread-thread-${mode}-${size}`);
      await ctx.close();
    }
    letGo();
    await waitFor(async () => (((await api("chat.messages.list", { threadId: thread })).messages as Array<{ body: string }>).some((m) => /Harbor is the better quote/.test(m.body)) ? true : null), 60_000, () => hostLog(d));
    await waitFor(async () => (((await api("engine.helpers.status", { threadId: thread })).helpers as Array<{ state: string }>).every((h) => h.state !== "working") ? true : null), 60_000, () => hostLog(d));
  } finally { await browser.close(); web.close(); await stop(d); }
});
