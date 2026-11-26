// The sign-in hand-off in the real app (rc.44): an agent working in a channel needs a person to finish a login in its terminal. The owner sees the card in the chat, presses Open terminal, takes over, types the login,
// gives the keyboard back and presses Done; the agent that asked carries on. A member of the channel who may not take that computer over sees the same card as "Waiting for <name> to sign in" with no button. Pictures in
// dark and light for both under shots-evidence/signin-card. The agent's computer is the real container (VYRE_WORKSPACE_TEST_IMAGE). Needs the production web export (VYRE_APP_DIST), Chromium and Docker.
import test from "node:test";
import assert from "node:assert/strict";
import { open, seat, shoot } from "./support/mail-browser.ts";
import { world } from "./support/computer-tab-world.ts";

const DIR = "shots-evidence/signin-card";

test(
  "the agent asks for a sign-in: the owner opens the terminal, takes over, presses Done and the agent resumes; a member without the right sees who it waits for",
  { timeout: 420_000 },
  async (t) => {
    const k = await world(t, { noTerminal: true, realWorkspace: true, model: true });
    if (!k) return;
    try {
      const bea = await k.s.world.join("bea");
      const channel = (
        await k.w.owner.ok("channels.create", {
          name: "ops",
          visibility: "invite",
          memberIds: [bea.id],
          agentIds: [k.agentId],
          leadAgentId: k.agentId,
        })
      ).channel as { mainThreadId: string };
      const threadId = channel.mainThreadId;
      const say = (body: string) =>
        k.w.owner.ok("chat.post", {
          threadId,
          body,
          mentions: [{ kind: "agent", id: k.agentId }],
          idempotencyKey: `say-${Math.random()}`,
        });
      // the agent works in its own terminal first, so it has one to ask about
      await say(`TOOL terminal_run ${JSON.stringify({ command: "echo working", idempotencyKey: "run-1" })}`);
      let terminalId = "";
      for (let i = 0; i < 60 && terminalId === ""; i++) {
        await k.w.d.hooks?.pump?.();
        const list = (await k.w.owner.ok("terminal.list", { host: "agent_computer" })) as {
          terminals: Array<{ terminalId: string; agentId?: string; by?: { kind: string }; state: string }>;
        };
        terminalId =
          list.terminals.find((x) => x.agentId === k.agentId && x.by?.kind === "agent" && x.state !== "exited")
            ?.terminalId ?? "";
        if (terminalId === "") await new Promise((r) => setTimeout(r, 500));
      }
      assert.notEqual(terminalId, "", "the agent has a terminal of its own");
      await say(
        `TOOL terminal_ask_signin ${JSON.stringify({
          threadId,
          terminalId,
          why: "Sign in to GitHub: the terminal shows a one-time code to type at github.com/login/device",
          idempotencyKey: "ask-1",
        })}`,
      );
      // the card is a question block waiting in the channel
      let blockId = "";
      for (let i = 0; i < 60 && blockId === ""; i++) {
        await k.w.d.hooks?.pump?.();
        const m = (await k.w.owner.ok("chat.messages.list", { threadId })) as {
          messages: Array<{
            blocks?: Array<{ id: string; type: string; state?: string; data?: { card?: { kind?: string } } }>;
          }>;
        };
        blockId =
          m.messages
            .flatMap((x) => x.blocks ?? [])
            .find((b) => b.type === "question" && b.data?.card?.kind === "signin")?.id ?? "";
        if (blockId === "") await new Promise((r) => setTimeout(r, 500));
      }
      assert.notEqual(blockId, "", "the agent's sign-in card is in the channel");

      // the Inbox copy: the card is also a task of the owner (Needs you, with its notification), the same question; answering it there answers the card
      const mine = (await k.w.owner.ok("tasks.list", { scope: "mine" })) as {
        tasks: Array<{ title: string; kind: string }>;
      };
      assert.ok(
        mine.tasks.some((x) => x.kind === "answer" && /Sign in to GitHub/.test(x.title)),
        "the owner has the sign-in as a task",
      );
      // the owner, in the real app
      const page = k.me.page;
      await open(k.me, k.s, "/chat");
      await page.getByText("ops", { exact: true }).first().waitFor({ timeout: 30_000 });
      await page.getByText("ops", { exact: true }).first().click();
      await page.getByTestId(`signin-card-${blockId}`).waitFor({ timeout: 30_000 });
      await page.getByTestId(`signin-card-open-${blockId}`).waitFor({ timeout: 15_000 });
      await shoot(page, DIR, "01-owner-card");
      await page.getByTestId(`signin-card-open-${blockId}`).click();
      // Open terminal opens THAT terminal, full screen, where the person watches until they take the keyboard
      await page.getByTestId("terminal-take").waitFor({ timeout: 30_000 });
      await shoot(page, DIR, "02-owner-terminal-opened");
      await page.getByTestId("terminal-take").click();
      await page.getByTestId("terminal-give").waitFor({ timeout: 15_000 });
      await page.getByTestId("terminal-screen").click();
      await page.keyboard.type("echo signed-in-by-person");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.body.innerText.includes("signed-in-by-person"), undefined, {
        timeout: 20_000,
      });
      await shoot(page, DIR, "03-owner-took-over");
      await page.getByTestId("terminal-give").click();
      await page.getByTestId("terminal-take").waitFor({ timeout: 15_000 });
      // close the sheet: the chat is where it was, with the card, and Done
      await page.getByText("Close", { exact: true }).first().click();
      await page.getByTestId(`signin-card-done-btn-${blockId}`).waitFor({ timeout: 30_000 });
      await page.getByTestId(`signin-card-done-btn-${blockId}`).click();
      await page.getByTestId(`signin-card-done-${blockId}`).waitFor({ timeout: 15_000 });
      assert.match(
        (await page.getByTestId(`signin-card-done-${blockId}`).innerText()).trim(),
        /^Olivia signed in, \d{1,2}:\d{2}/,
      );
      assert.equal(
        await page.getByText(/^Answered: /).count(),
        0,
        "the line sent to the agent is not shown to people, and there is no raw (done)",
      );
      await shoot(page, DIR, "04-owner-done");
      // the agent was told, in the person's own words, and that message is what wakes it (the card answered the parked question: "Answered: Done, I signed in")
      let resumed = false;
      for (let i = 0; i < 40 && !resumed; i++) {
        await k.w.d.hooks?.pump?.();
        const m = (await k.w.owner.ok("chat.messages.list", { threadId })) as {
          messages: Array<{ body?: string; author?: { kind?: string } }>;
        };
        resumed = m.messages.some(
          (x) => /^Answered: Done, I signed in/i.test(x.body ?? "") && x.author?.kind !== "agent",
        );
        if (!resumed) await new Promise((r) => setTimeout(r, 500));
      }
      assert.ok(resumed, "the agent was told the person signed in");

      // a background job the agent keeps running shows as a row in the Computer tab, with Stop
      await say(
        `TOOL terminal_job_start ${JSON.stringify({ command: "while true; do echo tick; sleep 2; done", name: "ticker", restart: "always", idempotencyKey: "job-1" })}`,
      );
      let jobId = "";
      for (let i = 0; i < 40 && jobId === ""; i++) {
        await k.w.d.hooks?.pump?.();
        const jl = (await k.w.owner.ok("terminal.job.list", { agentId: k.agentId })) as {
          jobs: Array<{ jobId: string; state: string }>;
        };
        jobId = jl.jobs.find((j) => j.state === "running")?.jobId ?? "";
        if (jobId === "") await new Promise((r) => setTimeout(r, 500));
      }
      assert.notEqual(jobId, "", "the agent's job is running");
      await open(k.me, k.s, `/chat#screen=chats.agent-page&agentId=${k.agentId}&tab=computer`);
      await page.getByTestId(`row-job-${jobId}`).waitFor({ timeout: 40_000 });
      assert.match(await page.getByTestId(`row-job-${jobId}`).innerText(), /ticker/);
      await shoot(page, DIR, "06-jobs-row");
      await page.getByTestId(`job-stop-${jobId}`).click();
      await page.getByTestId(`job-stop-${jobId}`).waitFor({ state: "detached", timeout: 30_000 });
      assert.match(await page.getByTestId(`row-job-${jobId}`).innerText(), /Stopped/);
      await shoot(page, DIR, "07-jobs-stopped");
      await open(k.me, k.s, "/chat");
      // a second card for the member's view (the first one is answered): the agent asks again
      await say(
        `TOOL terminal_ask_signin ${JSON.stringify({ threadId, terminalId, why: "Sign in to the staging server too", idempotencyKey: "ask-2" })}`,
      );
      let second = "";
      for (let i = 0; i < 60 && second === ""; i++) {
        await k.w.d.hooks?.pump?.();
        const m = (await k.w.owner.ok("chat.messages.list", { threadId })) as {
          messages: Array<{
            blocks?: Array<{ id: string; type: string; state?: string; data?: { card?: { kind?: string } } }>;
          }>;
        };
        second =
          m.messages
            .flatMap((x) => x.blocks ?? [])
            .find((b) => b.type === "question" && b.state === "waiting" && b.data?.card?.kind === "signin")?.id ?? "";
        if (second === "") await new Promise((r) => setTimeout(r, 500));
      }
      assert.notEqual(second, "");
      const beaSeat = await seat(k.s, bea, "Bea");
      await open(beaSeat, k.s, "/chat");
      await beaSeat.page.getByText("ops", { exact: true }).first().waitFor({ timeout: 30_000 });
      await beaSeat.page.getByText("ops", { exact: true }).first().click();
      await beaSeat.page.getByTestId(`signin-card-wait-${second}`).waitFor({ timeout: 30_000 });
      assert.match(
        await beaSeat.page.getByTestId(`signin-card-wait-${second}`).innerText(),
        /Waiting for .* to sign in/,
      );
      assert.equal(await beaSeat.page.getByTestId(`signin-card-open-${second}`).count(), 0, "no button for her");
      assert.equal(await beaSeat.page.getByTestId(`signin-card-done-btn-${second}`).count(), 0);
      assert.equal(
        await beaSeat.page.getByText("Done, I signed in", { exact: true }).count(),
        0,
        "and the dock above the composer does not offer her the answer either",
      );
      await shoot(beaSeat.page, DIR, "05-member-waits");
      // (no id guard here: the stand-in model is driven by typed `TOOL name {json}` posts, which carry ids by design; the card itself shows none, and the pictures are looked at)
    } finally {
      await k.close();
    }
  },
);
