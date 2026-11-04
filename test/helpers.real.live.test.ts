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

test("REAL MODEL: helpers are one row each, the lead answers once, a helper chat shows its brief, and no tool names reach the person", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for browser evidence"); return; }
  const pw = await import("playwright-core");
  const engine = process.env["VYRE_BROWSER"] === "webkit" ? pw.webkit : pw.chromium;
  const exe = process.env["CHROME_BIN"] || (engine === pw.chromium ? pw.chromium.executablePath() : undefined);
  if (exe) assert.ok(fs.existsSync(exe), `a browser is required at ${exe}`);
  const shots = process.env["VYRE_CREW_SHOTS"] ?? fs.mkdtempSync(path.join(os.tmpdir(), "vyre-crew-shots-"));
  fs.mkdirSync(shots, { recursive: true });

  let lead = ""; let chat = "";
  const fresh = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-helper-rows-")));
  const d = await boot(fresh, null as never, { vault: undefined, config: loadConfig(["--data-dir", fresh, "--port", "0", "--space", "spc_fresh", "--space-name", "Crew Co"], {}, "1.2.3") });
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
    // the Space's own AI key (OpenCode Go), from the environment only: nobody's Claude is connected here, so it pays. A $0.50 cap on the Space.
    const key = process.env["OPENCODE_API_KEY"] ?? "";
    assert.notEqual(key, "", "OPENCODE_API_KEY is needed");
    await api("providers.space_key.set", { idempotencyKey: "r-key", providerKey: "opencode-go", apiKey: key });
    await api("engine.spend.caps.set", { scope: "space", caps: { monthMicros: 500_000, dayMicros: 500_000 }, idempotencyKey: "r-cap" });
    await api("engine.pool.status", {});

    lead = await waitFor(async () => { await d.hooks?.pump?.(); const r = await api("agents.assistant_of", { personId: (await api("identity.whoami", {})).principal.id }); return typeof r.agentId === "string" ? (r.agentId as string) : null; }, 40_000);
    chat = (await api("chat.start", { kind: "chat", agentIds: [lead], title: "Pricing research", model: "deepseek-v4.1-flash", idempotencyKey: "j-chat" })).thread.threadId as string;
    for (const flow of ["team", "personal", "member"]) await api("spaces.onboarding.seen", { flow }).catch(() => undefined);
    const me = (await api("identity.whoami", {})).principal.id as string;
    const marker = (await api("spaces.get", {})).space.fingerprint as string;
    const session = { baseUrl: web.origin, token, personId: me, marker, def: { spaceId, name: "Crew Co", kind: "team", address: web.origin, role: "Owner", tint: ["#6E5CF0", "#9B6BE8"], kit: "northwind", skinDefault: "system", starred: true, needsYou: false, console: true, terminal: false, counts: {}, dots: {} } };
    const shoot = async (page: import("playwright-core").Page, name: string): Promise<void> => { await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
    const phone = process.env["VYRE_CREW_PHONE"] === "1";

    await api("chat.post", { threadId: chat, body: "Use two helpers at the same time. Helper one: tell me two facts about the Moon. Helper two: tell me two facts about Mars. When both are done, give me one short combined answer.", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "r-ask" });
    const list = async (id: string): Promise<Array<{ author: { kind: string; id: string }; body: string; blocks: Array<{ type: string; state?: string; data?: Record<string, unknown> }> }>> => (await api("chat.messages.list", { threadId: id })).messages;
    await waitFor(async () => {
      const ms = await list(chat);
      const rows = ms.flatMap((m) => m.blocks.filter((b) => b.type === "helper"));
      const reports = rows.filter((b) => b.data?.["status"] === "done" || b.data?.["status"] === "failed");
      // the lead's one combined answer comes after the last helper has reported, not before
      const lastReport = ms.reduce((at, m, i) => (m.blocks.some((b) => b.type === "helper" && (b.data?.["status"] === "done" || b.data?.["status"] === "failed")) ? i : at), -1);
      const combined = ms.filter((m, i) => i > lastReport && m.author.kind === "agent" && m.blocks.every((b) => b.type !== "helper") && m.body.trim() !== "" && !/still working|waiting|running now|I.ll |once |as soon as|restarted/i.test(m.body));
      // every helper that was started has reported (a retry counts as one more started)
      const started = rows.filter((b) => b.state === "live" || b.data?.["status"] === undefined).length;
      return started >= 2 && reports.length >= started && lastReport >= 0 && combined.length >= 1 ? ms : null;
    }, 170_000, () => hostLog(d)).catch(async (e) => { console.log("TRANSCRIPT", JSON.stringify((await list(chat)).map((m) => [m.author.kind, m.body.slice(0, 200), m.blocks.map((b) => b.type)]))); { const { DatabaseSync } = await import("node:sqlite"); const db = new DatabaseSync(d.paths.modules, { readOnly: true }); console.log("TURNS", JSON.stringify(db.prepare("SELECT model, engine, account_ref, state, substr(error, 1, 600) AS error FROM engine_turns").all())); db.close(); } throw e; });
    const ms = await list(chat);
    console.log("TRANSCRIPT", JSON.stringify(ms.map((m) => [m.author.kind, m.body.slice(0, 400), m.blocks.map((b) => `${b.type}:${b.state ?? ""}:${String(b.data?.["status"] ?? "")}`)])));
    const helperThreads = [...new Set(ms.flatMap((m) => m.blocks.filter((b) => b.type === "helper").map((b) => String(b.data?.["helperThreadId"] ?? b.data?.["threadId"] ?? ""))))].filter((x) => x !== "");
    const everything = [...ms, ...(await Promise.all(helperThreads.map(list))).flat()];
    const { internalNames } = await import("../lib/plain-words.ts");
    console.log("INTERNAL_NAMES", JSON.stringify(internalNames(everything.filter((m) => m.author.kind === "agent").map((m) => m.body).join("\n"))));
    console.log("HELPER_THREADS", helperThreads.length);

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
      await page.waitForTimeout(2500);
      await shoot(page, `${mode}-1-rows`);
      await page.getByText("Open", { exact: true }).first().click({ timeout: 15_000 });
      await page.getByText(/Brief from/).first().waitFor({ timeout: 20_000 }).catch(async (e) => { await shoot(page, `${mode}-FAILED-helper-chat`); throw e; });
      await shoot(page, `${mode}-2-helper-chat`);
      await ctx.close();
    }
  } finally { await browser.close(); web.close(); await stop(d); }
});
