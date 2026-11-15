// @tsx
// The walk of delete for good (F77); the three test files run it by pointer, by keyboard and at phone width (each file has a 120 second cap).
// F77 in the real app: delete an agent for good, by pointer and then by keyboard alone, on the production export, a fresh claimed Team Space and a stand-in model. An agent is made and used (a one-to-one chat, a
// channel message, a task, an Automation step); Move to Trash from its page; Trash lists it; Restore; it answers again; Trash again; Delete for good: the sheet shows the real counts and what will need
// someone; Cancel keeps everything; confirm: the row says Deleting and is then gone, one line says so; the channel shows its old message with a quiet "deleted"; the one-to-one chat is gone from the
// sidebar; the Automation says "Choose another agent"; the task is unassigned. An Assistant has no Move to Trash. The same main path at phone width. Pictures go to VYRE_AGENTDEL_SHOTS.
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";
import { as, join } from "../../../test/support/people.ts";
import { vendor } from "../../../fixtures/model-vendor.ts";

const PRELOAD = fileURLToPath(new URL("../../../fixtures/model-vendor-preload.mjs", import.meta.url));
const KEY = "sk-test-fixture-0123456789abcdef"; // secret-scan: fake

export type Mode = "pointer" | "keyboard" | "phone";
export async function agentDeleteWalk(
  t: TestContext,
  walks: ReadonlyArray<readonly [Mode, string, string]>,
): Promise<void> {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const v = await vendor();
  const priorOptions = process.env["NODE_OPTIONS"];
  process.env["NODE_OPTIONS"] = `${priorOptions ?? ""} --import ${PRELOAD}`.trim();
  process.env["VYRE_TEST_VENDOR"] = v.base;
  const space = await bootFreshSpace(undefined, true);
  if (priorOptions === undefined) delete process.env["NODE_OPTIONS"];
  else process.env["NODE_OPTIONS"] = priorOptions;
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const shots = process.env["VYRE_AGENTDEL_SHOTS"] ?? "/tmp/vyre-agentdel-shots";
  fs.mkdirSync(shots, { recursive: true });
  const errors: string[] = [];
  try {
    // ---- the Space, claimed once in a desktop context
    const owner = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    const first = await owner.newPage();
    first.on("pageerror", (e) => errors.push(e.message));
    await first.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await first.getByTestId("claim-name").fill("Olivia Owner");
    await first.getByTestId("claim-username").fill("olivia");
    await first.getByTestId("claim-password").fill("fixture password 123");
    await first.getByTestId("claim-confirm").fill("fixture password 123");
    await first.getByTestId("claim-next").click();
    await first.getByTestId("claim-create").click();
    await dismissOnboarding(first);
    await first.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await first.evaluate(
      () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
    );
    const session = await first.evaluate(() => localStorage.getItem("vyre.session.v1")!);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = async (cap: string, data: unknown, expect = 200): Promise<any> => {
      const r = await owner.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, {
        headers: { authorization: `Bearer ${token}` },
        data,
      });
      assert.equal(r.status(), expect, `${cap}: ${await r.text()}`);
      return (await r.json()).data;
    };
    const provider = await api("providers.add", {
      idempotencyKey: "ad-provider",
      providerKey: "openai",
      connection: "api_key",
      apiKey: KEY,
      scope: "mine",
    });
    await api("providers.set_space_use", {
      idempotencyKey: "ad-spaceuse",
      providerId: provider.provider.id,
      allow: true,
    });
    const assistant = (await api("agents.list", {})).agents[0] as { agentId: string };
    await api("agents.update", {
      agentId: assistant.agentId,
      patch: { model: "gpt-4o-mini" },
      idempotencyKey: "ad-model",
    });
    await first.close();

    /** One agent with a life: a one-to-one chat, a channel message, a task and an Automation step. */
    const makeAgent = async (name: string, tag: string) => {
      const agent = (await api("agents.create", { name, role: "You help.", idempotencyKey: `ad-${tag}` })).agent as {
        agentId: string;
      };
      await api("agents.update", {
        agentId: agent.agentId,
        patch: { model: "gpt-4o-mini" },
        idempotencyKey: `ad-m-${tag}`,
      });
      v.script.push({ text: `${name} here.` });
      const chat = (
        await api("chat.start", {
          kind: "chat",
          agentIds: [agent.agentId],
          title: `${name} intake`,
          idempotencyKey: `ad-c-${tag}`,
          first: "Hello",
        })
      ).thread.threadId as string;
      for (let i = 0; i < 120; i++) {
        const msgs = (await api("chat.messages.list", { threadId: chat })).messages as Array<{ body?: string }>;
        if (msgs.some((m) => m.body === `${name} here.`)) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const ch = (
        await api("channels.create", {
          name: `launch ${tag}`,
          visibility: "public",
          memberIds: [],
          agentIds: [agent.agentId],
          idempotencyKey: `ad-ch-${tag}`,
        })
      ).channel as { mainThreadId: string; channelId: string };
      v.script.push({ text: `${name} says the list is ready.` });
      await api("chat.post", {
        threadId: ch.mainThreadId,
        body: `@${name} is the list ready?`,
        mentions: [{ kind: "agent", id: agent.agentId }],
        idempotencyKey: `ad-p-${tag}`,
      });
      const made = await api("tasks.create", {
        title: `Check the ${name} desk`,
        assigned: { kind: "agent", id: agent.agentId },
        idempotencyKey: `ad-t-${tag}`,
      });
      const task = { taskId: (made.task?.taskId ?? made.taskId ?? made.task?.id) as string };
      const auto = (await api("automations.create", { name: `Digest ${tag}`, idempotencyKey: `ad-a-${tag}` }))
        .automation as { id: string };
      await api("automations.update", {
        automationId: auto.id,
        definition: {
          triggers: [{ key: "manual" }],
          nodes: [{ id: "a", key: "ai", input: { prompt: "Summarise" }, ai: { agentId: agent.agentId } }],
        },
        idempotencyKey: `ad-au-${tag}`,
      });
      return {
        agentId: agent.agentId,
        name,
        chat,
        channel: ch.mainThreadId,
        taskId: task.taskId,
        autoId: auto.id,
        autoName: `Digest ${tag}`,
        tag,
      };
    };

    // a second person in the Space: she has a chat with the agent, so the confirm counts and names her
    let ana: { id: string; token: string } | null = null;
    const withAna = async (agentId: string): Promise<void> => {
      if (ana === null) {
        const call = async (cap: string, input: Record<string, unknown> = {}) => {
          const r = await owner.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, {
            headers: { authorization: `Bearer ${token}` },
            data: { idempotencyKey: `ad-j-${cap}-${Math.random()}`, ...input },
          });
          const body = (await r.json()) as { data?: unknown };
          return { status: r.status(), data: (body.data ?? body) as never };
        };
        ana = await join({ url: web.origin } as never, call as never, "Member", "ana", "Ana Adler");
      }
      const chat = await as({ url: web.origin } as never, ana.token)("chat.start", { kind: "chat", agentIds: [agentId] });
      assert.equal(chat.status, 200, JSON.stringify(chat.data));
    };
    const walk = async (mode: Mode, name: string, tag: string): Promise<void> => {
      const A = await makeAgent(name, tag);
      if (mode === "pointer") await withAna(A.agentId);
      const phone = mode === "phone";
      const ctx = await browser.newContext({
        viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        colorScheme: phone ? "light" : "dark",
        deviceScaleFactor: 1,
      });
      await ctx.addInitScript((s) => localStorage.setItem("vyre.session.v1", s), session);
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      const guard = guardCrashes(page);
      const shot = async (n: string): Promise<void> => {
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(shots, `${mode}-${tag}-${n}.png`) });
      };
      // by pointer: click; by keyboard: Tab to the control (by test id) and press Enter
      const act = async (testid: string): Promise<void> => {
        await page.getByTestId(testid).first().waitFor({ timeout: 30_000 });
        if (mode !== "keyboard") return void (await page.getByTestId(testid).first().click());
        for (let i = 0; i < 700; i++) {
          const on = await page.evaluate(
            (id) => (document.activeElement as HTMLElement | null)?.getAttribute("data-testid") === id,
            testid,
          );
          if (on) return void (await page.keyboard.press("Enter"));
          await page.keyboard.press("Tab");
        }
        assert.fail(`the keyboard could not reach ${testid}`);
      };
      // a row found by its words: pointer clicks it; the keyboard tabs to the element that holds them
      const actText = async (text: string): Promise<void> => {
        await page.getByText(text).first().waitFor({ timeout: 30_000 });
        if (mode !== "keyboard") return void (await page.getByText(text).first().click());
        for (let i = 0; i < 700; i++) {
          const on = await page.evaluate((x) => {
            const t = ((document.activeElement as HTMLElement | null)?.textContent ?? "").trim();
            return t.startsWith(x) && t.length < 120;
          }, text);
          if (on) return void (await page.keyboard.press("Enter"));
          await page.keyboard.press("Tab");
        }
        assert.fail(`the keyboard could not reach ${text}`);
      };
      const menuPick = async (openId: string, label: string): Promise<void> => {
        await act(openId);
        if (mode === "keyboard") {
          for (let i = 0; i < 20; i++) {
            const txt = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent ?? "");
            if (txt.trim().startsWith(label)) return void (await page.keyboard.press("Enter"));
            await page.keyboard.press("ArrowDown");
          }
          assert.fail(`the menu item ${label} was not reached by the keyboard`);
        } else
          await page
            .getByRole("menuitem", { name: new RegExp(`^${label}`) })
            .first()
            .click();
      };
      const openTrash = async (): Promise<void> => {
        await page.goto(`${web.origin}/files`, { waitUntil: "load" });
        await page.getByTestId("files-more").waitFor({ timeout: 30_000 });
        await menuPick("files-more", "Trash");
        await page.getByTestId("trash-agents").waitFor({ timeout: 20_000 });
      };
      try {
        // Move to Trash from the agent's own page
        const toTrash = async (): Promise<void> => {
          await page.goto(`${web.origin}/chat#screen=chats.agent-page&agentId=${A.agentId}&tab=settings`, {
            waitUntil: "load",
          });
          await page.getByTestId("tab-strip").first().waitFor({ timeout: 30_000 });
          await page.getByTestId("tab-strip").first().waitFor({ timeout: 30_000 });
          if (phone) {
            // on a phone the tab strip folds: Settings is under More
            await page.getByText("More", { exact: true }).first().click();
            await page.getByText("Settings", { exact: true }).last().click();
          }
          // the Settings rows scroll: bring Move to Trash into view
          for (let i = 0; i < 14 && (await page.getByText("Move to Trash\u2026").count()) === 0; i++) {
            await page.mouse.move(phone ? 195 : 900, 500);
            await page.mouse.wheel(0, 700);
            await page.waitForTimeout(250);
          }
          await actText("Move to Trash\u2026");
          await act("trash-yes");
          await page.waitForFunction(() => !document.querySelector('[data-testid="trash-confirm"]'), null, {
            timeout: 15_000,
          });
          const list = await api("agents.list", {});
          assert.ok(
            !list.agents.some((a: { agentId: string }) => a.agentId === A.agentId),
            "the agent is gone from the lists",
          );
        };
        await toTrash();
        // its page, reached by an old link: one calm line that it is in Trash, with Restore, not an error
        await page.goto(`${web.origin}/chat#screen=chats.agent-page&agentId=${A.agentId}`, { waitUntil: "load" });
        // (on a phone the one-column Chats place opens its home for a page it cannot show: the line is a desktop surface)
        if (!phone) {
          await page.getByTestId("agent-in-trash").waitFor({ timeout: 30_000 });
          await shot("0-page-in-trash");
        }
        // Trash lists it; Restore; it works again
        await openTrash();
        await page.getByText(name, { exact: true }).first().waitFor({ timeout: 20_000 });
        await shot("1-trash");
        await act(`trash-restore-${A.agentId}`);
        await page.waitForFunction((id) => !document.querySelector(`[data-testid="trash-restore-${id}"]`), A.agentId, {
          timeout: 20_000,
        });
        v.script.push({ text: `${name} is back.` });
        await api("chat.post", { threadId: A.chat, body: "Are you there?", idempotencyKey: `ad-back-${tag}` });
        await (async () => {
          for (let i = 0; i < 120; i++) {
            const msgs = (await api("chat.messages.list", { threadId: A.chat })).messages as Array<{ body?: string }>;
            if (msgs.some((m) => m.body === `${name} is back.`)) return;
            await new Promise((r) => setTimeout(r, 500));
          }
          assert.fail("a restored agent did not answer");
        })();
        // Trash again, then Delete for good: the sheet, Cancel, then the real thing
        await toTrash();
        await openTrash();
        await act(`trash-forgood-${A.agentId}`);
        await page.getByTestId("forgood-sheet").waitFor({ timeout: 20_000 });
        await page.getByTestId("forgood-need").waitFor({ timeout: 20_000 });
        const body = await page.getByTestId("forgood-sheet").innerText();
        assert.match(body, new RegExp(`Delete ${name} for good\\?`));
        assert.match(body, /1 chat with/);
        assert.match(body, /These will need someone/);
        if (mode === "pointer") {
          assert.match(body, /Ana Adler has a chat with it/);
          assert.match(body, /This cannot be undone\./);
        }
        // a task it held was handed to someone when it went to Trash (tasks.onAgentDeleted), so it is not listed here; the Automation is
        assert.match(body, new RegExp(`Digest ${tag}`));
        await shot("2-confirm");
        await act("forgood-cancel");
        await page.getByTestId("forgood-sheet").waitFor({ state: "detached", timeout: 10_000 });
        assert.ok(await page.getByTestId(`trash-forgood-${A.agentId}`).isVisible(), "Cancel keeps the row");
        assert.equal((await api("agents.trash.list", {})).agents.length, 1, "Cancel keeps everything");
        await act(`trash-forgood-${A.agentId}`);
        await page.getByTestId("forgood-need").waitFor({ timeout: 20_000 });
        await act("forgood-go");
        await page
          .getByTestId(`trash-deleting-${A.agentId}`)
          .waitFor({ timeout: 20_000 })
          .catch(() => undefined);
        await shot("3-deleting");
        await page.waitForFunction(
          (id) =>
            !document.querySelector(`[data-testid="trash-forgood-${id}"]`) &&
            !document.querySelector(`[data-testid="trash-deleting-${id}"]`),
          A.agentId,
          { timeout: 90_000 },
        );
        // what a person finds afterwards
        const gone = await api("agents.trash.list", {});
        assert.ok(!gone.agents.some((a: { agentId: string }) => a.agentId === A.agentId), "the row is gone");
        await page.goto(`${web.origin}/chat#subject=thread:${A.channel}`, { waitUntil: "load" });
        // the agent answered the mention in a thread of the message: open it
        const replies = page.getByText(/1 reply/).first();
        await replies.waitFor({ timeout: 30_000 });
        await replies.click(); // opening a thread is not part of delete for good: by pointer in every mode
        await page.getByText(`${name} says the list is ready.`, { exact: true }).first().waitFor({ timeout: 30_000 });
        await page.locator('[data-testid^="deleted-"]').first().waitFor({ timeout: 20_000 });
        assert.equal((await page.locator('[data-testid^="deleted-"]').first().innerText()).trim(), "deleted");
        assert.equal(await page.getByRole("link", { name: `Open ${name}` }).count(), 0, "its name is not pressable");
        await shot("4-channel-deleted-mark");
        await page.goto(`${web.origin}/chat`, { waitUntil: "load" });
        await page
          .getByText(/Chats|Channels/)
          .first()
          .waitFor({ timeout: 30_000 });
        await page.waitForTimeout(2500);
        assert.equal(
          await page.getByText(`${name} intake`, { exact: true }).count(),
          0,
          "the one-to-one chat is gone from the sidebar",
        );
        // the Automation list is a desktop surface: the phone walk covers the main path (Trash, sheet, Deleting, the mark, the chat gone)
        if (!phone) {
          await page.goto(`${web.origin}/automations`, { waitUntil: "load" });
          await page.getByText(A.autoName, { exact: true }).first().click({ timeout: 30_000 });
          // the new builder: the step's one orange line and its one button
          const need = page.locator('[data-testid^="sv-need-"]').first();
          await need.waitFor({ timeout: 30_000 });
          assert.match(await need.innerText(), /Choose an agent/i);
          await shot("5-automation-choose-another");
          await need.click(); // the button takes the person to the agent field of that step
          await page.waitForTimeout(800);
          await shot("6-automation-agent-field");
        }
        const task = (await api("tasks.get", { taskId: A.taskId })).task;
        assert.ok(!JSON.stringify(task).includes(`"id":"${A.agentId}"`), "the task is no longer assigned to it");
        // an Assistant has no Move to Trash
        if (mode === "pointer") {
          await page.goto(`${web.origin}/chat#screen=chats.agent-page&agentId=${assistant.agentId}&tab=settings`, {
            waitUntil: "load",
          });
          await page
            .getByTestId("pause")
            .first()
            .waitFor({ timeout: 30_000 })
            .catch(() => undefined);
          assert.equal(await page.getByTestId("trash").count(), 0, "an Assistant's page has no Move to Trash");
        }
        assert.deepEqual(guard.crashes?.() ?? [], [], "no crash");
      } catch (e) {
        await page.screenshot({ path: path.join(shots, `FAIL-${mode}.png`) }).catch(() => undefined);
        fs.writeFileSync(
          path.join(shots, `FAIL-${mode}.txt`),
          await page.evaluate(() => document.body.innerText).catch(() => ""),
        );
        throw e;
      } finally {
        await ctx.close();
      }
    };

    for (const [mode, name, tag] of walks) await walk(mode, name, tag);
    assert.deepEqual(errors, [], "no page error in the whole walk");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
    await v.close?.();
  }
}
