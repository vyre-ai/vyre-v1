// The lead asks before it starts (owner, 5 Nov 2026, prototype p-crew scene crewask): a question card "Which account should Orin use?" comes first and no helper starts until it is answered; the answer starts the
// helpers. Shots go to VYRE_CREW_SHOTS (paper and graphite). Needs the web export (VYRE_APP_DIST) and a browser.
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

test("the lead asks which account a helper should use before it starts, and the person answers on the card", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for browser evidence"); return; }
  const pw = await import("playwright-core");
  const engine = process.env["VYRE_BROWSER"] === "webkit" ? pw.webkit : pw.chromium;
  const exe = process.env["CHROME_BIN"] || (engine === pw.chromium ? pw.chromium.executablePath() : undefined);
  if (exe) assert.ok(fs.existsSync(exe), `a browser is required at ${exe}`);
  const shots = process.env["VYRE_CREW_SHOTS"] ?? fs.mkdtempSync(path.join(os.tmpdir(), "vyre-crew-shots-"));
  fs.mkdirSync(shots, { recursive: true });

  let lead = ""; let chat = ""; let dir = ""; let owner = "";
  let started = false; let begun = false;
  const model = scriptedModel(async function* (input, run) {
    const body = input.trigger?.body ?? "";
    if (input.agent.id === lead && input.threadId === chat) {
      if (/compare the quotes/.test(body) && !started) {
        started = true;
        yield { type: "text", text: "Before I start Orin: you have two accounts that can run this." };
        yield* run("tool_search", { query: "ask question" });
        yield* run("ask_question", { threadId: input.threadId, prompt: "Which account should Orin use?\nOrin spends from the account you pick. Pia reads northwind.com and needs no question.", mode: "single", options: [{ key: "mine", label: "My Claude", detail: "Maya_Claude · Mine" }, { key: "space", label: "Space account", detail: "Shared with the Space" }] });
        return;
      }
      if (started && !begun) {
        begun = true;
        yield { type: "text", text: "Starting Orin on your Claude, and Pia on the Space account." };
        yield* run("tool_search", { query: "sub task helper" });
        yield* run("sub_task_model", { threadId: input.threadId, title: "Compare the quotes", instruction: "Quotes job: compare the two vendor quotes.", idempotencyKey: "a-1" });
        yield* run("sub_task_model", { threadId: input.threadId, title: "Read northwind.com", instruction: "Site job: read northwind.com.", idempotencyKey: "a-2" });
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 4_000));
    yield { type: "text", text: "Done." };
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
    chat = (await api("chat.start", { kind: "chat", agentIds: [lead], title: "Quotes and site", idempotencyKey: "a-chat" })).thread.threadId as string;
    for (const flow of ["team", "personal", "member"]) await api("spaces.onboarding.seen", { flow }).catch(() => undefined);
    const me = (await api("identity.whoami", {})).principal.id as string;
    owner = me;
    const marker = (await api("spaces.get", {})).space.fingerprint as string;
    const session = { baseUrl: web.origin, token, personId: me, marker, def: { spaceId, name: "Crew Co", kind: "team", address: web.origin, role: "Owner", tint: ["#6E5CF0", "#9B6BE8"], kit: "northwind", skinDefault: "system", starred: true, needsYou: false, console: true, terminal: false, counts: {}, dots: {} } };
    const shoot = async (page: import("playwright-core").Page, name: string): Promise<void> => { await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
    const phone = process.env["VYRE_CREW_PHONE"] === "1";

    await api("chat.post", { threadId: chat, body: "Get a helper to compare the quotes, and one to read northwind.com.", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "a-ask" });
    for (const [skin, mode] of [["paper", "light"], ["graphite", "dark"]] as const) {
      const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
      await ctx.addInitScript((x: unknown) => { try { localStorage.setItem("vyre.session.v1", JSON.stringify({ sessions: { [(x as { baseUrl: string }).baseUrl]: x } })); } catch { /* blocked */ } }, session);
      const page = await ctx.newPage();
      const guard = guardCrashes(page);
      const size = phone ? "phone" : "wide";
      const shot = async (name: string): Promise<void> => { await guard.check(name); await shoot(page, name); };
      await page.goto(`${web.origin}/chats?skin=${skin}`, { waitUntil: "load" });
      await page.getByText("Quotes and site", { exact: false }).first().waitFor({ timeout: 40_000 });
      const later = page.getByText("Finish later", { exact: true });
      if (await later.count()) await later.first().click().catch(() => undefined);
      await page.getByText("Quotes and site", { exact: false }).first().click({ timeout: 30_000 });
      await page.getByText("Which account should Orin use?").first().waitFor({ timeout: 60_000 }).catch(async (e) => { await guard.check("FAILED-ask"); await shoot(page, `FAILED-crewask-${mode}`); throw e; });
      if (mode === "light") {
        assert.equal(await page.getByTestId("crew-strip").count(), 0, "no helper starts before the question is answered");
        await shot(`crewask-question-${mode}-${size}`);
        await page.getByText("My Claude", { exact: false }).first().click({ timeout: 15_000 });
        await page.getByTestId("crew-strip").first().waitFor({ timeout: 60_000 }).catch(async (e) => { await guard.check("FAILED-after"); await shoot(page, `FAILED-crewask-after-${mode}`); throw e; });
        await shot(`crewask-answered-${mode}-${size}`);
      } else {
        await page.getByTestId("crew-strip").first().waitFor({ timeout: 30_000 });
        await shot(`crewask-answered-${mode}-${size}`);
      }
      await ctx.close();
    }
    // let both helpers finish before the Space closes
    await waitFor(async () => (((await api("engine.helpers.status", { threadId: chat })).helpers as Array<{ state: string }>).every((h) => h.state !== "working") ? true : null), 60_000, () => hostLog(d));
  } finally { await browser.close(); web.close(); await stop(d); }
});
