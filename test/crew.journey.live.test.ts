// The crew as a person meets it (DESIGN-crew.md, step 3): in the real app, in a browser, against a booted daemon whose model vendor is a scripted session. The lead starts a teammate; the Crew tab appears with a
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

test("a person watches a crew build in the real app: the Crew tab, one result card, and Merge", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for browser evidence"); return; }
  const pw = await import("playwright-core");
  const engine = process.env["VYRE_BROWSER"] === "webkit" ? pw.webkit : pw.chromium;
  const exe = process.env["CHROME_BIN"] || (engine === pw.chromium ? pw.chromium.executablePath() : undefined);
  if (exe) assert.ok(fs.existsSync(exe), `a browser is required at ${exe}`);
  const shots = process.env["VYRE_CREW_SHOTS"] ?? fs.mkdtempSync(path.join(os.tmpdir(), "vyre-crew-shots-"));
  fs.mkdirSync(shots, { recursive: true });

  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-crew-repo-")));
  git(repo, "init", "--quiet", "-b", "main");
  fs.writeFileSync(path.join(repo, "README.md"), "a small site\n");
  git(repo, "add", "-A"); git(repo, "commit", "--quiet", "-m", "first");

  let dir = ""; let owner = ""; let teammate = ""; let project = ""; let lead = "";
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id === teammate) {
      const work = workFolder(dir, owner, input.threadId);
      await waitFor(async () => (fs.existsSync(path.join(work, "README.md")) ? true : null), 20_000);
      fs.writeFileSync(path.join(work, "dark-mode.txt"), "toggle: on\n");
      fs.writeFileSync(path.join(work, "dark-mode.test.txt"), "test: toggle is on\n");
      yield { type: "text", text: "Added the dark mode toggle and a test. The test passes." };
      return;
    }
    if (input.agent.id !== lead) return;
    const ask = input.trigger?.body ?? "";
    if (/build dark mode/.test(ask)) {
      yield* run("tool_search", { query: "crew teammate" });
      yield* run("crew_start", { threadId: input.threadId, idempotencyKey: "journey-start", projectId: project, teammateId: teammate, title: "Dark mode", brief: "Add a dark mode toggle and a test." });
      yield { type: "text", text: "I started Ember on the dark mode toggle. You will get one card when it is done." };
    } else if (input.trigger?.author.id === teammate) {
      yield { type: "text", text: "Ember is done. The branch is ready for you to merge." };
    }
  });
  const fresh = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-crew-journey-")));
  const d = await boot(fresh, model, { config: loadConfig(["--data-dir", fresh, "--port", "0", "--space", "spc_fresh", "--space-name", "Crew Co"], {}, "1.2.3") });
  dir = d.paths.root;
  const web = await edge(dist, d.url);
  const browser = await engine.launch(exe ? { executablePath: exe, args: ["--no-sandbox"] } : {});
  try {
    // the owner claims the Space the way a person does, and the key stays on this computer
    assert.ok(d.claim, "a fresh Space offers a claim link");
    const code = /claim\/([^#]+)/.exec(d.claim!.url)![1]!;
    const spaceId = /s=([^&]+)/.exec(d.claim!.url)![1]!;
    const made = await makeBundle(PASSWORD, "crew-journey-recovery-code-1", { spaceId });
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

    lead = (await api("agents.create", { name: "Lead", role: "You lead the build.", idempotencyKey: "j-lead" })).agent.agentId as string;
    owner = (await api("agents.get", { agentId: lead })).agent.ownerId as string;
    project = (await api("projects.create", { type: "project", title: "Small site", idempotencyKey: "j-project" })).projectId as string;
    teammate = (await api("projects.teammates.create", { projectId: project, name: "Ember", role: "member", idempotencyKey: "j-ember" })).teammate.agentId as string;
    await api("engine.crew.repo.set", { projectId: project, path: repo });
    const chat = (await api("chat.start", { kind: "chat", agentIds: [lead], title: "Build the site", idempotencyKey: "j-chat" })).thread.threadId as string;

    // the first-run screen has been seen: a person who is already working does not meet it
    for (const flow of ["team", "personal", "member"]) await api("spaces.onboarding.seen", { flow }).catch(() => undefined);
    const me = (await api("identity.whoami", {})).principal.id as string;
    const marker = (await api("spaces.get", {})).space.fingerprint as string;
    const session = { baseUrl: web.origin, token, personId: me, marker, def: { spaceId, name: "Crew Co", kind: "team", address: web.origin, role: "Owner", tint: ["#6E5CF0", "#9B6BE8"], kit: "northwind", skinDefault: "system", starred: true, needsYou: false, console: true, terminal: false, counts: {}, dots: {} } };
    const shoot = async (page: import("playwright-core").Page, name: string): Promise<void> => { await page.screenshot({ path: path.join(shots, `${name}.png`) }); };

    for (const [skin, mode] of [["paper", "light"], ["graphite", "dark"]] as const) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addInitScript((s: unknown) => { try { localStorage.setItem("vyre.session.v1", JSON.stringify({ sessions: { [(s as { baseUrl: string }).baseUrl]: s } })); } catch { /* blocked */ } }, session);
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${web.origin}/chats?skin=${skin}`, { waitUntil: "load" });
      await page.getByTestId("shell").waitFor({ timeout: 40_000 });
      if (mode === "light") {
        // the lead is asked in the chat the way a person asks: the message is posted into the thread
        await api("chat.post", { threadId: chat, body: "build dark mode", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "j-ask" });
        await waitFor(async () => {
          const jobs = (await api("engine.crew.list", { threadId: chat })).jobs as Array<{ state: string }>;
          return jobs[0] && jobs[0].state !== "working" ? true : null;
        }, 60_000, () => hostLog(d));
      }
      const later = page.getByText("Finish later", { exact: true });
      if (await later.count()) await later.first().click().catch(() => undefined);
      await page.getByText("Build the site", { exact: false }).first().click({ timeout: 30_000 });
      const jobId = ((await api("engine.crew.list", { threadId: chat })).jobs as Array<{ jobId: string }>)[0]!.jobId;
      const card = page.getByTestId(`crew-card-${jobId}`);
      await card.waitFor({ timeout: 40_000 });
      // the dark pass opens the chat after the merge: the same card, now one line
      assert.match(await card.innerText(), mode === "light" ? /Ember finished Dark mode[\s\S]*1 commit · 2 files/ : /Merged · Ember: Dark mode/);
      await shoot(page, `${mode}-1-card`);
      // the Crew tab: open the pane, choose Crew, one row for Ember
      await page.getByTestId("pane-button").click({ timeout: 10_000 });
      await page.getByTestId("chats-right-pane").waitFor({ timeout: 15_000 });
      await page.getByTestId("tab-crew").click({ timeout: 15_000 });
      const row = page.getByText("Ember · Dark mode").first();
      await row.waitFor({ timeout: 15_000 }).catch(async (e) => { await shoot(page, `${mode}-FAILED-crew-tab`); throw e; });
      assert.match(await page.getByTestId("chats-right-pane").innerText(), mode === "light" ? /Done .* · 2 files/ : /Merged/);
      await shoot(page, `${mode}-2-crew-tab`);
      if (mode === "light") {
        // Merge on the card lands the branch and the card collapses to one line
        await page.getByTestId(`crew-merge-${jobId}`).first().click();
        await card.getByText(/Merged/).first().waitFor({ timeout: 15_000 });
        assert.equal(fs.readFileSync(path.join(repo, "dark-mode.txt"), "utf8"), "toggle: on\n");
        assert.match(git(repo, "log", "--format=%s", "-n", "2"), /Merge crew\/ember-1/);
        await shoot(page, `${mode}-3-merged`);
      }
      assert.deepEqual(errors.filter((e) => !/#418/.test(e)), [], "no page error");
      await ctx.close();
    }
  } finally { await browser.close(); web.close(); await stop(d); }
});
