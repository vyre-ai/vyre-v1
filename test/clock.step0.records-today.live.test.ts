// P1 step 0 (CONTRACTS-2026-11-13/P1-clock-wake.md, section 4): a characterisation test. It RECORDS what the engine does today, before the clock and the wake table change anything; it does not say what is right.
// Question (a): while a routine's turn is parked at the Gate (a held send), does the next scheduled run of the same routine start a second turn?
// A booted daemon, its real scheduler job (agents.routines_due, run by hand) on a clock the test moves, and a scripted model that tries to send an email on every routine turn.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as mk from "./memory-live-kit.ts";
import { boot, call, connect, hostLog, makeAgent, scriptedModel, seededDir, waitFor } from "./support/live.ts";

const HOUR = 3_600_000;
const TITLE = "Daily digest";

test("RECORDS TODAY: a routine's next run while its first turn waits at the Gate (held send)", async () => {
  const dir = seededDir();
  // Tuesday 3 Nov 2026, 08:59 UTC. The routine runs every minute and the clock moves a minute at a time: the hourly job that clears stale holds (see the control test) does not run in between, so only the engine decides.
  let at = Date.UTC(2026, 10, 3, 8, 59);
  const turns: { at: number; resumed: boolean }[] = [];
  let mailboxId = "";
  const toolAnswers: string[] = [];
  const d = await boot(
    dir,
    scriptedModel(async function* (input, run) {
      const notice = String((input as { notice?: string }).notice ?? "");
      if (!notice.includes(TITLE)) {
        yield { type: "text", text: "ok" };
        return;
      }
      turns.push({ at, resumed: false });
      yield* run("tool_search", { query: "mail_send" });
      const sent = yield* run("mail_send", {
        mailboxId,
        to: [{ address: "dana@fox.test", name: "Dana Fox" }],
        subject: `Digest ${turns.length}`,
        text: "The digest.",
        idempotencyKey: `digest-${turns.length}`,
      });
      toolAnswers.push(JSON.stringify(sent).slice(0, 160));
      yield { type: "text", text: `sent ${turns.length}` };
    }),
    { now: () => at },
  );
  const pump = async (): Promise<void> => {
    await d.hooks?.pump?.();
  };
  const settle = async (ms: number): Promise<void> => {
    for (let i = 0; i < ms / 100; i++) {
      await pump();
      await new Promise<void>((r) => setTimeout(r, 100));
    }
  };
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Digester");
    mailboxId = (
      await call(d, "mail.mailbox.create", {
        kind: "shared",
        address: "hello@acme.test",
        title: "Hello",
        privacy: "space",
        idempotencyKey: "s0-mailbox",
      })
    ).data.mailbox.id as string;
    const saved = await call(d, "agents.routine.save", {
      agentId,
      title: TITLE,
      cron: "* * * * *",
      prompt: "Send the digest.",
      idempotencyKey: "s0-routine",
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const routineId = saved.data.routine.routineId as string;

    const holdsAll = async (): Promise<{ state: string; capName?: string }[]> =>
      ((await call(d, "gate.holds.list", {})).data.holds as { state: string; capName?: string }[]) ?? [];
    const holds = async (states: string[]): Promise<number> =>
      (await holdsAll()).filter((h) => states.includes(h.state)).length;
    const turnStates = async (): Promise<string[]> => {
      const chat = (
        (await call(d, "threads.list", { kind: ["chat"], limit: 50 })).data.threads as {
          threadId: string;
          title?: string;
        }[]
      ).find((t) => t.title === TITLE);
      if (!chat) return [];
      return ((await call(d, "engine.turns.list", { threadId: chat.threadId })).data.turns as { state: string }[]).map(
        (t) => t.state,
      );
    };
    const row = async (): Promise<{ nextRunAt?: number; lastRun?: { status: string } }> =>
      (await call(d, "agents.routines.list", { agentId })).data.routines.find(
        (r: { routineId: string }) => r.routineId === routineId,
      );

    const seen: Record<string, unknown>[] = [];
    // three scheduled times, a minute apart: the first turn starts and its send is held; the next two come while it waits
    for (const label of ["run 1", "run 2", "run 3"]) {
      const next = (await row()).nextRunAt!;
      at = next + 1_000;
      await d.hooks!.runPeriodic("agents.routines_due");
      if (label === "run 1")
        await waitFor(
          async () => ((await holdsAll()).length > 0 ? true : null),
          40_000,
          () => hostLog(d),
        );
      await settle(4_000);
      seen.push({
        label,
        turnsStartedSoFar: turns.length,
        heldHoldsOpen: await holds(["held"]),
        holdStates: (await holdsAll()).map((h) => `${h.capName}:${h.state}`),
        holdDetail: JSON.stringify((await holdsAll())[0] ?? null).slice(0, 700),
        turnStates: await turnStates(),
        toolAnswers: [...toolAnswers],
        lastRun: (await row()).lastRun?.status ?? null,
        nextRunAt: (await row()).nextRunAt ?? null,
      });
    }
    console.log(`OBSERVED step 0 (a): ${JSON.stringify(seen)}`);
    // RECORDED 13 Nov 2026: nothing stops a second turn. Each scheduled run starts its own turn while the earlier ones wait at the Gate, and each leaves its own held send.
    // The contract (P1 section 2, "Overlap") changes this on purpose: one open fire per wake, the next one skipped and said so. This assertion goes with that step.
    assert.deepEqual(
      seen.map((x) => [x["turnsStartedSoFar"], x["heldHoldsOpen"], x["turnStates"]]),
      [
        [1, 1, ["waiting"]],
        [2, 2, ["waiting", "waiting"]],
        [3, 3, ["waiting", "waiting", "waiting"]],
      ],
    );
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("RECORDS TODAY (control): the hourly stale-hold job and a held send in an ordinary chat that is not a routine's", async () => {
  const dir = mk.seededDir();
  const d = await mk.boot(dir);
  try {
    await mk.connect(d);
    const agent = await mk.newAgent(d, "Digester");
    const box = (
      await mk.call(d, "mail.mailbox.create", {
        kind: "shared",
        address: "hello@acme.test",
        title: "Hello",
        privacy: "space",
        idempotencyKey: "s0c-mailbox",
      })
    ).data.mailbox;
    const threadId = (
      await mk.call(d, "chat.start", { kind: "chat", agentIds: [agent.id], idempotencyKey: "s0c-chat" })
    ).data.thread.threadId as string;
    await mk.call(d, "threads.set_mode", { threadId, mode: "auto", idempotencyKey: "s0c-mode" });
    const send = {
      mailboxId: box.id,
      to: [{ address: "dana@fox.test", name: "Dana Fox" }],
      subject: "Digest",
      text: "The digest.",
      idempotencyKey: "s0c-send",
    };
    await mk.call(d, "chat.post", {
      threadId,
      body: `TOOL mail_send ${JSON.stringify(send)}`,
      mentions: [{ kind: "agent", id: agent.id }],
      idempotencyKey: "s0c-post",
    });
    const states = async (): Promise<string[]> =>
      ((await mk.call(d, "gate.holds.list", {})).data.holds as { state: string }[]).map((h) => h.state);
    await mk.waitFor(
      async () => {
        await d.hooks?.pump?.();
        return (await states()).length > 0 ? true : null;
      },
      40_000,
      () => mk.hostLog(d),
    );
    const before = await states();
    await d.hooks!.runPeriodic("gate.stale_holds");
    const after = await states();
    console.log(
      `OBSERVED control: holds before the stale job ${JSON.stringify(before)}, after ${JSON.stringify(after)}`,
    );
    // RECORDED 13 Nov 2026, on a booted daemon: running the stale-hold job (it runs at start and every hour) drops a send that was held a moment ago, with the note "Not sent, the chat it was asked in was
    // closed". The chat is open; the job reads it as the host's system principal, and a private chat answers not_found to that principal (see the comment on callAs in engine/handlers/bridge.ts), which
    // modules/gate/handlers/stale.ts closedWhy reads as "the chat is gone". Reported to the lead as a defect of its own; it is not P1's. This assertion goes when that is fixed.
    assert.deepEqual([before, after], [["held"], ["denied"]]);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
