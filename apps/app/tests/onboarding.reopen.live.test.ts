// A fresh install walked in a real browser against the production export and a claimed Personal Space daemon (lane l-chrome2a): the machine has a Codex sign-in and a Claude Code sign-in
// and a few sessions, as a new Mac does. The person picks Codex ("Use the Codex sign-in on this computer"), goes back to that step from the rail, switches to Claude, keeps an answer while
// moving between steps, and imports their sessions (one of them holds nothing readable). Shots (paper and graphite, wide and phone) go to VYRE_ONBOARD_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";

const PASSWORD = "fixture password 123";
const jwt = (claims: object): string => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

// ~/.codex and ~/.claude of a new Mac, as the daemon reads them for "use the sign-in on this computer"
function freshHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-fresh-home-"));
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "auth.json"), JSON.stringify({ tokens: { access_token: "codex-access", refresh_token: "codex-refresh", id_token: jwt({ email: "saqib@example.com" }) } }));
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "claude-access", refreshToken: "claude-refresh" } }));
  return home;
}

// what the desktop shell's two session commands answer: two sessions with words, one that holds nothing a person can read
const CLAUDE_LINE = JSON.stringify({ type: "user", uuid: "u1", timestamp: "2026-11-04T10:00:00Z", cwd: "/Users/saqib/work/site", message: { role: "user", content: "Fix the login redirect" } });
const CLAUDE_REPLY = JSON.stringify({ type: "assistant", uuid: "a1", timestamp: "2026-11-04T10:00:05Z", message: { role: "assistant", content: [{ type: "text", text: "Done." }] } });
const CODEX_REAL = [JSON.stringify({ type: "session_meta", payload: { id: "c2", cwd: "/Users/saqib/work/api" } }), JSON.stringify({ type: "response_item", timestamp: "2026-11-04T09:30:02Z", payload: { type: "message", id: "m2", role: "user", content: [{ type: "input_text", text: "Add a health endpoint" }] } })].join("\n");
const CODEX_EMPTY = [JSON.stringify({ type: "session_meta", payload: { id: "c1" } }), JSON.stringify({ type: "response_item", payload: { type: "message", id: "m1", role: "user", content: [{ type: "input_text", text: "<environment_context><cwd>/x</cwd></environment_context>" }] } })].join("\n");
const SOURCES = [
  { provider: "claude", sessionId: "a1", sessionKey: "claude:a1", projectKey: "p", cwd: "/Users/saqib/work/site", title: "Fix the login redirect", updatedAt: String(Date.now() - 2 * 3_600_000) },
  { provider: "codex", sessionId: "c2", sessionKey: "codex:c2", projectKey: "q", cwd: "/Users/saqib/work/api", title: "Add a health endpoint", updatedAt: String(Date.now() - 30 * 3_600_000) },
  { provider: "codex", sessionId: "c1", sessionKey: "codex:c1", projectKey: "q", cwd: "/Users/saqib/work/api", title: "", updatedAt: String(Date.now() - 50 * 3_600_000) },
];
const DOCS: Record<string, string> = { "claude:a1": `${CLAUDE_LINE}\n${CLAUDE_REPLY}`, "codex:c2": CODEX_REAL, "codex:c1": CODEX_EMPTY };
const TAURI = `(() => { const S = ${JSON.stringify(SOURCES)}, D = ${JSON.stringify(DOCS)};
  window.__TAURI__ = { core: { invoke: async (cmd, args) => {
    if (cmd === "discover_session_sources") return S;
    if (cmd === "read_session_source") return { source: S.find((x) => x.sessionKey === args.sessionKey), documents: [{ namespace: "main", text: D[args.sessionKey] }] };
    throw new Error("not available in this test"); } } }; })();`;

test("a fresh install: pick Codex, go back, switch to Claude, keep an answer, import sessions", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const home = freshHome();
  const realHome = process.env["HOME"];
  process.env["HOME"] = home; delete process.env["CODEX_HOME"]; delete process.env["CLAUDE_CONFIG_DIR"];
  const space = await bootFreshSpace("personal");
  process.env["HOME"] = realHome;
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const shots = process.env["VYRE_ONBOARD_SHOTS"] ?? "/tmp/vyre-onboard-shots"; fs.mkdirSync(shots, { recursive: true });
  try {
    // claim in a plain browser, then carry the session into the "desktop" (the shell's commands answered by the fixture)
    const first = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const claim = await first.newPage();
    await claim.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await claim.getByTestId("claim-name").fill("Saqib Khan"); await claim.getByTestId("claim-username").fill("saqib");
    await claim.getByTestId("claim-password").fill(PASSWORD); await claim.getByTestId("claim-confirm").fill(PASSWORD);
    await claim.getByTestId("claim-next").click(); await claim.getByTestId("claim-saved").click(); await claim.getByTestId("claim-create").click();
    await claim.getByTestId("shell").waitFor({ timeout: 30_000 });
    const state = await first.storageState();
    const token = await claim.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const call = async (cap: string, data: unknown): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await first.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data });
      const body = await r.json();
      assert.equal(r.status(), 200, `${cap}: ${JSON.stringify(body).slice(0, 400)}`);
      return body.data;
    };

    const run = async (size: "wide" | "phone"): Promise<void> => {
      const ctx = await browser.newContext({ viewport: size === "wide" ? { width: 1440, height: 900 } : { width: 390, height: 844 }, storageState: state });
      await ctx.addInitScript(TAURI);
      const p = await ctx.newPage();
      const guard = guardCrashes(p);
      const shot = async (name: string): Promise<void> => {
        await p.screenshot({ path: path.join(shots, `onboard-${name}-${size}-paper.png`) });
        await p.evaluate(() => { document.documentElement.setAttribute("data-skin", "graphite"); document.documentElement.setAttribute("data-theme", "graphite"); });
        await p.waitForTimeout(250);
        await p.screenshot({ path: path.join(shots, `onboard-${name}-${size}-graphite.png`) });
        await p.evaluate(() => { document.documentElement.setAttribute("data-skin", "paper"); document.documentElement.setAttribute("data-theme", "paper"); });
      };
      const ok = (where: string): Promise<void> => guard.check(`${size} ${where}`);
      const row = (k: string) => p.getByTestId(`row-step-${k}`);
      await p.goto(`${web.origin}/chat`, { waitUntil: "load" });
      // it opened by itself once, in the claim browser, and was left; here it is reopened from "Finish setup", as a person does
      await p.getByTestId("resume-open").waitFor({ timeout: 40_000 });
      await p.getByTestId("resume-open").click();
      await p.getByTestId("onboarding").waitFor({ timeout: 20_000 });
      await ok("onboarding opens");
      // 1. the AI step: pick the Codex sign-in on this computer
      await p.getByTestId("ai-tiles").waitFor({ timeout: 20_000 });
      await shot("1-connect-ai");
      await p.getByTestId("ai-local-codex").click();
      // this computer has the Codex sign-in but not the Codex program: the card says so, right there, before moving on
      await p.getByTestId("ai-problem").waitFor({ timeout: 30_000 });
      assert.match(await p.getByTestId("ai-problem").innerText(), /Codex is not installed on this computer\. Install it, or pick another AI\./);
      await shot("1b-codex-not-installed");
      await p.getByTestId("ai-continue-anyway").click();
      await p.getByTestId("interview-card").waitFor({ timeout: 30_000 });
      const afterCodex = (await call("providers.list", {})).providers as Array<{ providerKey: string; id: string }>;
      assert.deepEqual(afterCodex.map((x) => x.providerKey), ["codex"], "Codex is connected, and only Codex");
      await ok("Codex picked");
      // 2. back to that step: it shows what was picked and can change it
      if (size === "wide") await row("ai").click(); else { await p.getByTestId("step-back").click(); }
      await p.getByTestId("ai-connected").waitFor({ timeout: 15_000 });
      assert.match(await p.getByTestId("ai-connected").innerText(), /Codex/);
      await shot("2-reopened-ai");
      // 3. switch to Claude: the Claude sign-in goes in first, then Codex is removed
      await p.getByTestId(`ai-switch-${afterCodex[0]!.id}`).click();
      await p.getByTestId("ai-local-claude-code").click();
      // this computer has no Claude program either: the same plain line; the person keeps it, and the Codex account goes
      await p.getByTestId("ai-problem").waitFor({ timeout: 30_000 });
      assert.match(await p.getByTestId("ai-problem").innerText(), /Claude is not installed on this computer/);
      await p.getByTestId("ai-continue-anyway").click();
      await p.getByTestId("ai-note").waitFor({ timeout: 30_000 });
      assert.match(await p.getByTestId("ai-note").innerText(), /Switched from .*Codex/);
      const afterSwitch = (await call("providers.list", {})).providers as Array<{ providerKey: string }>;
      assert.deepEqual(afterSwitch.map((x) => x.providerKey), ["claude-code"], "Claude is connected and Codex is gone");
      await shot("3-switched-to-claude");
      await ok("switched");
      // 4. the interview keeps an answer across steps
      await p.getByTestId("step-next").click();
      await p.getByTestId("interview-card").waitFor({ timeout: 15_000 });
      await p.getByTestId("interview-add-free").or(p.getByTestId("interview-suggestions")).first().waitFor({ timeout: 10_000 });
      await p.getByText("Accountant", { exact: true }).first().click();
      await p.getByTestId("step-next").click();   // Next: tools
      await p.getByText("Gmail", { exact: true }).first().click();
      await p.getByTestId("step-next").click();   // Next: style
      await p.getByText("Full detail", { exact: true }).first().click();
      await p.getByTestId("step-next").click();   // Save
      await p.getByTestId("step-next").waitFor({ timeout: 15_000 });
      await ok("interview saved");
      // 5. sessions: three found, one holds nothing readable; Select all, Import
      await p.getByTestId("sessions-card").waitFor({ timeout: 20_000 });
      await p.getByTestId("sessions-list").waitFor({ timeout: 15_000 });
      await shot("5-sessions");
      await p.getByTestId("sessions-all").click();
      await p.getByTestId("step-next").click();
      await p.getByTestId("sessions-imported").waitFor({ timeout: 30_000 });
      const said = await p.getByTestId("sessions-imported").innerText();
      assert.match(said, /Imported 2\./); assert.match(said, /1 session had nothing to read and was left out\./);
      const listed = (await call("sessions.list", {})).sessions as unknown[];
      assert.equal(listed.length, 2, "the two readable sessions are in Chats");
      await shot("6-imported");
      await ok("imported");
      // 6. back to the interview from the rail: the answers are still there
      if (size === "wide") {
        await row("interview").click();
        await p.getByTestId("interview-card").waitFor({ timeout: 10_000 });
        assert.ok((await p.getByTestId("interview-card").innerText()).length > 0);
        await shot("7-reopened-interview");
        await row("ai").click();
        await p.getByTestId("ai-connected").waitFor({ timeout: 10_000 });
        assert.match(await p.getByTestId("ai-connected").innerText(), /Claude/, "going back and forth, the choice is still Claude");
        await ok("back and forth");
      }
      await ctx.close();
    };
    await run("wide");
  } finally { await browser.close(); web.close(); await space.stop(); }
});
