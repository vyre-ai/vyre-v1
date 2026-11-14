// @tsx
// Finding F41 in the real app (lane b-crew, 14 Nov 2026): an agent on a command-line engine starts two subagents of its own and a person SEES them. The production export, a booted daemon with the real engine, the real
// CLI driver and the fake claude of host/tests/fixtures/fake-cli-driver (scenario twosubagents), a browser signed in as the owner. The walk, per skin and size: post the request; both subagents are on screen within a
// second of the server knowing them, each with the task it was given and working; a row opens to what it is on; its name opens the pane's peek; both end done; the rows sit under the reply with the answers kept, and a
// row still opens the peek with what it returned. No id or tool name is on screen at any point, and no call of the walk is refused on every open (the refused calls are listed in refused.json). Pictures go to VYRE_CREW_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { claimOnEdge, dismissOnboarding, edge } from "../apps/app/tests/real-app-harness.test.ts";
import { guardCrashes } from "../apps/app/tests/crash-guard.ts";
import { boot, call, connect, makeAgent, waitFor } from "./support/live.ts";

const FAKE_CLI = fileURLToPath(new URL("../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const cli = { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] };
const T = (id: string): string => `[data-testid="${id}"]`;

test("subagents of a CLI engine, real app: on screen within a second, openable, done, kept under the reply (dark and light, wide and phone)", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const shots = process.env["VYRE_CREW_SHOTS"] ?? "/tmp/vyre-crew-shots";
  fs.mkdirSync(shots, { recursive: true });
  // a fresh Space the owner claims through its one-time link, as a person does; the daemon is in this process, with the real engine around the fake claude
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-crew-walk-"));
  const daemon = await boot(dir, null, {
    engineCli: cli,
    args: ["--space", "spc_crewwalk", "--space-name", "Fresh Co"],
  });
  assert.ok(daemon.claim, "a fresh Space has its claim link");
  const web = await edge(dist, daemon.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const refused = new Map<string, number>();
  const seen: Array<{ config: string; liveAfterMs: number; names: string[] }> = [];
  let d = daemon;
  try {
    const claimCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const claimPage = await claimCtx.newPage();
    await claimPage.goto(claimOnEdge(daemon.claim!.url, web.origin), { waitUntil: "load", timeout: 60_000 });
    await claimPage.getByTestId("claim-name").fill("Olivia Owner");
    await claimPage.getByTestId("claim-username").fill("olivia");
    await claimPage.getByTestId("claim-password").fill("fixture password 123");
    await claimPage.getByTestId("claim-confirm").fill("fixture password 123");
    await claimPage.getByTestId("claim-next").click();
    await claimPage.getByTestId("claim-saved").click();
    await claimPage.getByTestId("claim-create").click();
    await dismissOnboarding(claimPage);
    const session = await claimPage.evaluate(() => localStorage.getItem("vyre.session.v1")!);
    const token = (JSON.parse(session) as { sessions: Record<string, { token: string }> }).sessions[web.origin]!.token;
    await claimCtx.close();
    // the calls of the walk are the owner's own, so the chats are the owner's chats
    d = Object.assign(Object.create(daemon) as typeof daemon, { token });
    await connect(d);
    const agentId = await makeAgent(d, "Dex");
    // a plain turn with no subagents: no call is refused, in the browser or in the Space's own log (a refusal that is swallowed is still a refusal)
    const serverRefusals = (): string[] => {
      daemon.sink.flush();
      const ro = new DatabaseSync(daemon.paths.logs, { readOnly: true });
      try {
        return (ro.prepare("SELECT attrs FROM logs WHERE msg = 'invoke'").all() as Array<{ attrs: string }>)
          .map((r) => JSON.parse(r.attrs) as { cap?: string; status?: string; actor?: string })
          .filter((r) => (r.status ?? "ok") !== "ok")
          .map((r) => `${r.cap} ${r.status} ${r.actor ?? ""}`);
      } finally {
        ro.close();
      }
    };
    {
      const plain = (await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "w-plain" })).data
        .thread.threadId as string;
      assert.equal(
        (
          await call(d, "engine.set_model", {
            threadId: plain,
            agentId,
            model: "sonnet",
            provider: "anthropic",
            idempotencyKey: "w-plain-model",
          })
        ).status,
        200,
      );
      const before = serverRefusals();
      assert.equal(
        (
          await call(d, "chat.post", {
            threadId: plain,
            body: "resumecheck",
            mentions: [{ kind: "agent", id: agentId }],
            idempotencyKey: "w-plain-post",
          })
        ).status,
        200,
      );
      await waitFor(async () => {
        const ms = (await call(d, "chat.messages.list", { threadId: plain })).data.messages as Array<{
          author: { kind: string };
        }>;
        return ms.some((m) => m.author.kind === "agent") ? true : null;
      }, 20_000);
      await new Promise((r) => setTimeout(r, 1500));
      // What is left is not this lane's: the Space's own service reading a person's private chat or agent (the search indexer, the engine bridge's agent lookup) and being told not_found,
      // six times a turn (reported as a finding). Every other refusal, the settings, placement, thread and helper-note calls this lane fixed, must be absent.
      const left = serverRefusals().slice(before.length);
      assert.deepEqual(
        left.filter((x) => !/^(agents|threads)\.get validation\.not_found (svc_host)?$/.test(x)),
        [],
        "a plain turn refuses nothing but the service's reads of private items",
      );
    }
    for (const [skin, size, vp] of [
      ["graphite", "wide", { width: 1440, height: 900 }],
      ["paper", "wide", { width: 1440, height: 900 }],
      ["graphite", "phone", { width: 390, height: 844 }],
      ["paper", "phone", { width: 390, height: 844 }],
    ] as const) {
      const tag = `${skin}-${size}`;
      const threadId = (
        await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: `w-start-${tag}` })
      ).data.thread.threadId as string;
      const picked = await call(d, "engine.set_model", {
        threadId,
        agentId,
        model: "sonnet",
        provider: "anthropic",
        idempotencyKey: `w-model-${tag}`,
      });
      assert.equal(picked.status, 200, JSON.stringify(picked.data));
      const ctx = await browser.newContext({
        viewport: vp,
        colorScheme: skin === "graphite" ? "dark" : "light",
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      const guard = guardCrashes(page);
      page.on("response", (r) => {
        const u = new URL(r.url());
        if (u.pathname.startsWith("/v1/") && r.status() >= 400) {
          const k = `${r.status()} ${u.pathname}`;
          refused.set(k, (refused.get(k) ?? 0) + 1);
        }
      });
      const seed = await ctx.newPage();
      await seed.goto(`${web.origin}/home?skin=${skin}`, { waitUntil: "load", timeout: 60_000 });
      await seed.evaluate((v) => localStorage.setItem("vyre.session.v1", v), session);
      await seed.close();
      await page.goto(`${web.origin}/chat?skin=${skin}#screen=chats.conversation&threadId=${threadId}`, {
        waitUntil: "load",
        timeout: 60_000,
      });
      try {
        await page.waitForSelector(T("conversation-title"), { timeout: 30_000 });
      } catch (e) {
        await page.screenshot({ path: path.join(shots, `${tag}-no-conversation.png`) });
        throw new Error(
          `${String(e)}; the page says: ${(await page.evaluate(() => document.body.innerText)).slice(0, 400)}`,
        );
      }
      const shot = async (name: string): Promise<void> => {
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(shots, `${tag}-${name}.png`) });
      };
      const screenText = (): Promise<string> => page.evaluate(() => document.body.innerText);

      const posted = await call(d, "chat.post", {
        threadId,
        body: "twosubagents",
        mentions: [{ kind: "agent", id: agentId }],
        idempotencyKey: `w-post-${tag}`,
      });
      assert.equal(posted.status, 200, JSON.stringify(posted.data));
      // the moment the server knows both
      const status = async (): Promise<{ members: Array<{ kind: string; state: string; title: string }> }> =>
        (await call(d, "engine.crew.status", { threadId })).data;
      await waitFor(async () => ((await status()).members.length === 2 ? true : null), 15_000);
      const knownAt = Date.now();
      // and the moment the person sees both
      await page.waitForSelector(T("subagents-live"), { timeout: 8_000 });
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="subagents-live"]')
            ?.querySelectorAll('[data-testid^="crew-chip-sub_"][data-testid$="-state"]').length === 2,
        undefined,
        { timeout: 8_000 },
      );
      const liveAfterMs = Date.now() - knownAt;
      assert.ok(liveAfterMs <= 1_000, `both on screen ${liveAfterMs} ms after the server knew them`);
      await page.waitForFunction(
        () => /Test the terminal/.test(document.body.innerText) && /Test the browser/.test(document.body.innerText),
        undefined,
        { timeout: 5_000 },
      );
      const names = await page
        .locator(`${T("subagents-live")} ${T("crew-strip")} [data-testid$="-toggle"]`)
        .allInnerTexts();
      assert.ok(
        names.some((n) => /Test the terminal/.test(n)) && names.some((n) => /Test the browser/.test(n)),
        `the two tasks are the rows: ${JSON.stringify(names)}`,
      );
      seen.push({ config: tag, liveAfterMs, names });
      assert.match(
        await page.locator(`${T("subagents-live")} ${T("crew-strip-title")}`).innerText(),
        /2 helpers.*working/,
      );
      await shot("1-working");
      await guard.check(`${tag} working`);

      // a row opens to what it is on
      await page
        .locator(`${T("subagents-live")} [data-testid$="-toggle"]`)
        .first()
        .click();
      await page.waitForSelector(`${T("subagents-live")} [data-testid$="-steps"]`, { timeout: 5_000 });
      await shot("2-row-open");

      // its face opens the pane's peek
      await page
        .locator(`${T("subagents-live")} [data-testid$="-name"]`)
        .first()
        .click();
      await page.waitForSelector(T("crew-peek"), { timeout: 8_000 });
      assert.equal(await page.locator(T("crew-peek-open")).count(), 0, "no Open chat for a subagent");
      assert.equal(await page.locator(T("crew-peek-ask")).count(), 0);
      // what it is on rides the asker's own live frames: the person who asked sees steps in the peek
      await page.waitForSelector(T("crew-step-0"), { timeout: 8_000 });
      await shot("3-peek-working");

      // on a phone the pane is a screen of its own: closed, the chat is back under it
      if (size === "phone") await page.locator(T("crew-side-close")).click();
      // both end; the rows sit under the reply and the live block is gone
      await page.waitForSelector(`${T("conversation-title")}`);
      await waitFor(async () => ((await status()).members.every((m) => m.state === "done") ? true : null), 20_000);
      await page.waitForFunction(() => !document.querySelector('[data-testid="subagents-live"]'), undefined, {
        timeout: 10_000,
      });
      await page.getByText("Both subagents finished.").first().waitFor({ timeout: 10_000 });
      await shot("4-done-under-reply");
      assert.equal((await screenText()).includes("SUBAGENT-CHATTER"), false, "a subagent's words are not on screen");

      // the answer is still reachable from the reply: a row opens the peek with what it returned
      const under = page.locator(`${T("crew-strip")} [data-testid$="-name"]`).first();
      await under.click();
      await page.waitForSelector(T("crew-peek-answer"), { timeout: 8_000 });
      assert.match(
        await page.locator(T("crew-peek-answer")).innerText(),
        /ran echo and saw hello|browser opened the page/,
      );
      await shot("5-peek-done");

      // no id and no tool name anywhere on the screen
      const text = await screenText();
      assert.doesNotMatch(
        text,
        /toolu_|\bsub_[A-Za-z0-9]|\bmcp__|\bthr_[0-9a-f]{6}|\bagt_[0-9a-f]{6}|\bAgent\b(?! )/,
        "no raw id or tool name on screen",
      );
      await guard.check(`${tag} end`);
      await ctx.close();
    }
    fs.writeFileSync(path.join(shots, "refused.json"), JSON.stringify({ refused: [...refused], seen }, null, 2));
    assert.deepEqual([...refused], [], "no call of the walk is refused");
  } finally {
    await browser.close();
    web.close();
    await daemon.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
