// A turn the person stopped stays stopped across a restart. The Stop answers at once (agent/src/turn-engine/engine.ts stop()); the engine's queue row is what boot recovery reads
// (recover(): a row left "running" that called no tool goes back to "queued" and runs again). So the Stop must be on that row before it answers, or recovery brings the turn back.
//   starting   Stop pressed while the turn is between the queue and its run (admission and the account are being read), then the server restarts: the turn never runs, and the chat shows
//              the stopped state once.
//   running    Stop pressed on a running turn, the server restarts at once (before the turn has wound down): the turn does not run again and no second reply appears.
// A booted daemon with the real engine; the model is a stand-in, and agents.status (the engine's admission) is a stand-in that can be held, to keep a turn in its start.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { boot, call, clock, connect, hostLog, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

interface Sent {
  agent: string;
  body: string;
  after: boolean;
}
const phase = { restarted: false, holdAdmit: false, holdModel: false };
const admitted: string[] = [];
function model(): { open: OpenSession; sent: Sent[] } {
  const sent: Sent[] = [];
  const open: OpenSession = async () => {
    let stop = (): void => undefined;
    const stopped = new Promise<void>((res) => {
      stop = res;
    });
    return {
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
        sent.push({ agent: input.agent.id, body: String(input.trigger?.body ?? ""), after: phase.restarted });
        // held until cancelled: a running turn the person stops; a model that is slow to wind down after the Stop (the restart comes first)
        if (phase.holdModel && !phase.restarted) {
          await stopped;
          await new Promise<void>(() => undefined);
        }
        yield { type: "text", text: "Here is my answer." };
        yield { type: "done" };
      },
      sendToolResult() {},
      inject() {},
      async cancel() {
        stop();
      },
      async close() {},
    } as unknown as EngineSession;
  };
  return { open, sent };
}
/** agents.status, the engine's admission: held while phase.holdAdmit, so a turn sits between the queue and its run. */
const admission = {
  extra: {
    handlers: {
      "agents.status": async (_ctx: unknown, input: unknown) => {
        admitted.push(String((input as { agentId?: string }).agentId ?? ""));
        if (phase.holdAdmit && !phase.restarted) await new Promise<void>(() => undefined);
        return { status: "awake" };
      },
    },
  },
};

let keys = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `rs-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};
type Msg = {
  author?: { kind?: string; id?: string };
  body?: string;
  blocks?: Array<{ type: string; data?: { state?: string } }>;
};
const messages = async (d: Daemon, threadId: string): Promise<Msg[]> =>
  (await call(d, "chat.messages.list", { threadId })).data.messages as Msg[];
const stoppedLines = (msgs: Msg[]): number =>
  msgs.flatMap((m) => (m.blocks ?? []).filter((b) => b.type === "turn_status" && b.data?.state === "cancelled")).length;
const replies = (msgs: Msg[], agentId: string): number =>
  msgs.filter((m) => m.author?.kind === "agent" && m.author.id === agentId && /Here is my answer/.test(m.body ?? ""))
    .length;
const queueRows = (d: Daemon, threadId: string): string =>
  JSON.stringify(
    new DatabaseSync(d.paths.modules, { readOnly: true })
      .prepare("SELECT qseq, state, touched FROM engine_thread_queue WHERE thread_id = ?")
      .all(threadId),
  );
/** The server stops (bounded: a turn held in its start must not hold the test), its leases run out, and it starts again on the same data. */
async function restart(d: Daemon, dir: string, open: OpenSession): Promise<Daemon> {
  await Promise.race([d.stop(), new Promise((r) => setTimeout(r, 45_000))]);
  clock.t += 120_000;
  phase.restarted = true;
  const next = await boot(dir, open, undefined, admission);
  await next.hooks!.runPeriodic("engine.runtime"); // the recovery sweep, as the scheduler runs it every few seconds
  for (let i = 0; i < 6; i++) {
    await next.hooks!.pump();
    await new Promise((r) => setTimeout(r, 500));
  }
  return next;
}

test(
  "Stop pressed while the turn is starting, then a restart: the turn never runs and the chat shows it stopped once",
  { timeout: 180_000 },
  async () => {
    Object.assign(phase, { restarted: false, holdAdmit: false, holdModel: false });
    const m = model();
    const dir = seededDir();
    let d = await boot(dir, m.open, undefined, admission);
    let pumping = setInterval(() => void d.hooks?.pump?.(), 100);
    try {
      await connect(d);
      const desk = await newAgent(d, "Front Desk");
      const chat = await ok(d, "chat.start", { kind: "chat", agentIds: [desk.id] });
      const threadId = chat.thread.threadId as string;
      phase.holdAdmit = true;
      admitted.length = 0;
      await ok(d, "chat.post", {
        threadId,
        body: "Please draft the letter",
        mentions: [{ kind: "agent", id: desk.id }],
      });
      await waitFor(
        async () => (admitted.includes(desk.id) ? true : null),
        20_000,
        () => hostLog(d),
      ); // off the queue, in admission
      const stop = await ok(d, "engine.stop", { threadId });
      assert.equal(m.sent.length, 0, "nothing reached the model before the Stop");
      void stop;
      clearInterval(pumping);
      d = await restart(d, dir, m.open);
      pumping = setInterval(() => void d.hooks?.pump?.(), 100);
      await new Promise((r) => setTimeout(r, 3_000));
      await d.hooks!.pump();
      const msgs = await messages(d, threadId);
      assert.deepEqual(
        m.sent.filter((s) => s.agent === desk.id),
        [],
        `the stopped turn did not run after the restart: ${queueRows(d, threadId)}`,
      );
      assert.equal(replies(msgs, desk.id), 0, "no reply");
      assert.equal(
        stoppedLines(msgs),
        1,
        `the chat shows the stopped state once: ${JSON.stringify(msgs.map((x) => x.blocks))} ${queueRows(d, threadId)}`,
      );
    } finally {
      clearInterval(pumping);
      await d.stop();
    }
  },
);

test(
  "Stop pressed on a running turn, then a restart at once: the turn does not run again and no second reply appears",
  { timeout: 180_000 },
  async () => {
    Object.assign(phase, { restarted: false, holdAdmit: false, holdModel: true });
    const m = model();
    const dir = seededDir();
    let d = await boot(dir, m.open, undefined, admission);
    let pumping = setInterval(() => void d.hooks?.pump?.(), 100);
    try {
      await connect(d);
      const desk = await newAgent(d, "Back Desk");
      const chat = await ok(d, "chat.start", { kind: "chat", agentIds: [desk.id] });
      const threadId = chat.thread.threadId as string;
      await ok(d, "chat.post", { threadId, body: "Summarise the file", mentions: [{ kind: "agent", id: desk.id }] });
      await waitFor(
        async () => (m.sent.some((s) => s.agent === desk.id) ? true : null),
        20_000,
        () => hostLog(d),
      ); // running, the model is working
      await ok(d, "engine.stop", { threadId });
      clearInterval(pumping);
      d = await restart(d, dir, m.open); // at once: the model has not wound down
      pumping = setInterval(() => void d.hooks?.pump?.(), 100);
      await new Promise((r) => setTimeout(r, 3_000));
      await d.hooks!.pump();
      const msgs = await messages(d, threadId);
      assert.deepEqual(
        m.sent.filter((s) => s.after && s.agent === desk.id),
        [],
        `the stopped turn did not run again after the restart: ${queueRows(d, threadId)}`,
      );
      assert.equal(replies(msgs, desk.id), 0, "no reply, not one and not two");
      assert.equal(
        stoppedLines(msgs),
        1,
        `the chat shows the stopped state once: ${JSON.stringify(msgs.map((x) => x.blocks))} ${queueRows(d, threadId)}`,
      );
    } finally {
      clearInterval(pumping);
      await d.stop();
    }
  },
);
