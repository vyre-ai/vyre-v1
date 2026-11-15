// @tsx
// Findings F90 to F94 in the real app (lane w-crew, 16 Nov 2026, the owner's own rc.28 chat): an agent on a command-line engine starts THREE helpers in the background (the launch call answers "Async agent launched
// successfully." at once) and its turn ends. The production export, a booted daemon with the real engine, the real CLI driver and the stand-in claude of host/tests/fixtures/fake-cli-driver (scenario bgsubagents: the
// helpers finish 5, 10 and 15 s later and the engine wakes itself as it does), a browser signed in as the owner. The walk, per skin and size: at launch all three Work (none Done, no "4 of 4 done"), the launch
// tool's words are nowhere, the chat says one live line "3 helpers working" with Stop, the chat's row in the sidebar keeps its working ring; the Crew pane draws the Session block once and no Side by side; at one
// done the line says "2 helpers working, 1 of 3 done" and the Assistant has not posted a line for it; at all done the line is gone, the ring is gone and the Assistant comes back by itself, once, with the answer. No id
// or tool name is on screen. Pictures go to VYRE_CREW_SHOTS.
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

test("helpers launched in the background, real app: Working until their own end, one live line with Stop, the sidebar ring, the Assistant back once (dark and light, wide and phone)", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const shots = process.env["VYRE_CREW_SHOTS"] ?? "/tmp/vyre-bg-shots";
  fs.mkdirSync(shots, { recursive: true });
  // a fresh Space the owner claims through its one-time link, as a person does; the daemon is in this process, with the real engine around the fake claude
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-crew-walk-"));
  const daemon = await boot(dir, null, {
    engineCli: cli,
    args: ["--space", "spc_bgwalk", "--space-name", "Fresh Co"],
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
      assert.deepEqual(serverRefusals().slice(before.length), [], "a plain turn refuses no call");
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
      await page.waitForSelector(T("conversation-title"), { timeout: 30_000 });
      const shot = async (name: string): Promise<void> => {
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(shots, `${name}-${tag}.png`) });
      };
      const screenText = (): Promise<string> => page.evaluate(() => document.body.innerText);
      type Member = { kind: string; state: string; title: string; step?: string; found?: string };
      const status = async (): Promise<{
        members: Member[];
        totals: { working: number; done: number; members: number; elapsedMs: number };
      }> => (await call(d, "engine.crew.status", { threadId })).data;
      const agentLines = async (): Promise<string[]> =>
        (
          (await call(d, "chat.messages.list", { threadId })).data.messages as Array<{
            author: { kind: string };
            body: string;
          }>
        )
          .filter((m) => m.author.kind === "agent")
          .map((m) => m.body);

      const posted = await call(d, "chat.post", {
        threadId,
        body: "bgsubagents",
        mentions: [{ kind: "agent", id: agentId }],
        idempotencyKey: `w-post-${tag}`,
      });
      assert.equal(posted.status, 200, JSON.stringify(posted.data));

      // 1. LAUNCH: the turn ended ("I am waiting"), the three helpers Work: not one is Done, none says what the launch tool said
      await waitFor(async () => ((await status()).members.length === 3 ? true : null), 20_000);
      await waitFor(
        async () => ((await agentLines()).some((b) => /waiting for all three/.test(b)) ? true : null),
        20_000,
      );
      const at0 = await status();
      assert.deepEqual(
        at0.members.map((m) => m.state),
        ["working", "working", "working"],
        "launched is not done",
      );
      assert.equal(at0.totals.done, 0);
      assert.equal(
        JSON.stringify(at0).includes("Async agent launched"),
        false,
        "the launch tool's words are not a helper's line",
      );
      await page.waitForSelector(T("background-line"), { timeout: 10_000 });
      assert.match(await page.locator(T("background-text")).innerText(), /^3 helpers working, /);
      await page.waitForSelector(T("crew-strip-title"), { timeout: 10_000 });
      const strip0 = await page.locator(T("crew-strip-title")).first().innerText();
      assert.match(strip0, /3 helpers.*working/);
      assert.doesNotMatch(strip0, /3 of 3 done/);
      assert.doesNotMatch(await screenText(), /Async agent launched/);
      if (size === "wide") {
        // the chat's row in the sidebar keeps its working ring while the helpers work after the reply
        await page.screenshot({ path: path.join(shots, `ring-check-start-${tag}.png`) });
        const seenRing = await waitFor(
          async () => ((await page.locator(".vyre-face-ring.vyre-working").count()) > 0 ? true : null),
          12_000,
        ).catch(() => null);
        if (seenRing === null) {
          const now = await call(d, "engine.now", {});
          await page.screenshot({ path: path.join(shots, `no-ring-${tag}.png`) });
          const html = await page.evaluate(
            () =>
              (document.querySelector('[data-testid="chats-sidebar"]') as HTMLElement | null)?.innerText ??
              "no sidebar",
          );
          throw new Error(
            `no working ring in the sidebar: engine.now=${JSON.stringify(now.data)} sidebar=${html.slice(0, 300)}`,
          );
        }
      }
      await shot("01-launch-working");
      await guard.check(`${tag} launch`);

      // a person writes while the helpers work: the Assistant answers from Vyre's own count (the stand-in says the count line of its context)
      assert.equal(
        (
          await call(d, "chat.post", {
            threadId,
            body: "howmany",
            mentions: [{ kind: "agent", id: agentId }],
            idempotencyKey: `w-echo-${tag}`,
          })
        ).status,
        200,
      );
      await waitFor(async () => ((await agentLines()).length >= 2 ? true : null), 20_000);
      const echoed = (await agentLines())[1] ?? "";
      assert.match(
        echoed,
        /3 of 3 helpers or jobs you started in the background are still working: Research applicants batch 1/,
      );

      // the Crew pane: the Session block at most once; Side by side shows because three helpers have real durations now
      await page.locator(T("background-open")).click();
      await page.waitForSelector(T("crew-overview"), { timeout: 10_000 });
      assert.ok(
        (await page.locator(T("session-block")).count()) <= 1,
        "the Session block is drawn at most once (it has rows only once the chat has steps)",
      );
      await shot("02-crew-pane-working");
      if (size === "phone") await page.locator(T("crew-side-close")).click();

      // 2. ONE DONE: the line counts it; the Assistant says nothing for it
      await waitFor(async () => ((await status()).totals.done >= 1 ? true : null), 25_000);
      await page.waitForFunction(
        () => /1 of 3 done/.test(document.querySelector('[data-testid="background-text"]')?.textContent ?? ""),
        undefined,
        { timeout: 10_000 },
      );
      assert.match(await page.locator(T("background-text")).innerText(), /^2 helpers working, 1 of 3 done, /);
      assert.equal(
        (await agentLines()).some((b) => /is back, still waiting/.test(b)),
        false,
        "no line per helper",
      );
      await shot("03-one-done");

      // 3. ALL DONE: the line and the ring go, the Assistant comes back by itself, once, with the answer
      await waitFor(async () => ((await status()).totals.done === 3 ? true : null), 30_000);
      await page.waitForFunction(() => !document.querySelector('[data-testid="background-line"]'), undefined, {
        timeout: 10_000,
      });
      await page.getByText("All three helpers are back. Ranked list ready.").first().waitFor({ timeout: 30_000 });
      if (size === "wide")
        await page.waitForFunction(
          () => document.querySelectorAll(".vyre-face-ring.vyre-working").length === 0,
          undefined,
          { timeout: 15_000 },
        );
      const lines = await agentLines();
      assert.equal(lines.filter((b) => /All three helpers are back/.test(b)).length, 1, "the Assistant came back once");
      assert.equal(
        lines.some((b) => /is back, still waiting/.test(b)),
        false,
        "no status line per helper",
      );
      assert.equal(
        lines.length,
        3,
        `three replies in all: the launch, the answer to the person, and the one continuation (${JSON.stringify(lines.map((b) => b.slice(0, 40)))})`,
      );
      const end = await status();
      assert.deepEqual(
        end.members.map((m) => m.state),
        ["done", "done", "done"],
      );
      assert.ok(
        end.totals.elapsedMs >= 14_000,
        `Total time is the real time, not the launch's seconds (${end.totals.elapsedMs} ms)`,
      );
      await shot("04-all-done");
      const text = await screenText();
      assert.doesNotMatch(
        text,
        /toolu_|\bsub_[A-Za-z0-9]|\bmcp__|\bthr_[0-9a-f]{6}|\bagt_[0-9a-f]{6}|Async agent/,
        "no raw id, tool name or launch text on screen",
      );
      await guard.check(`${tag} end`);
      seen.push({ config: tag, liveAfterMs: end.totals.elapsedMs, names: end.members.map((m) => m.title) });
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
