// An agent paused or deleted while the server stops does not take its queued turn after the restart. The pause and the delete are stored when they are made; the events that tell the engine
// (agent.paused, agent.deleted) are delivered only by the next start, and boot recovery may reach the agent's queued turn first: the engine's admission (agents.status, runtime.ts admission) must
// refuse it before any model call.
// A booted daemon with the real engine and agents; the model is a stand-in that holds each agent's first turn, so a second message waits in the queue when the server stops.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { KEY } from "./support/eco-live.ts";
import { boot, call, clock, connect, hostLog, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import { hostSeams } from "../modules/engine/impl.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

interface Sent {
  agent: string;
  body: string;
  after: boolean;
}
const phase = { restarted: false };
function holder(): { open: OpenSession; sent: Sent[] } {
  const sent: Sent[] = [];
  const open: OpenSession = async () =>
    ({
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
        sent.push({ agent: input.agent.id, body: String(input.trigger?.body ?? ""), after: phase.restarted });
        if (!phase.restarted) await new Promise<void>(() => undefined); // held: the next message waits in the queue
        yield { type: "text", text: "Done." };
        yield { type: "done" };
      },
      sendToolResult() {},
      inject() {},
      async cancel() {},
      async close() {},
    }) as unknown as EngineSession;
  return { open, sent };
}

let keys = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `rd-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

test(
  "an agent paused, and one deleted, while the server stops take none of their queued turns after the restart; an active agent takes its own",
  { timeout: 120_000 },
  async () => {
    const m = holder();
    const dir = seededDir();
    let d = await boot(dir, m.open);
    let pumping = setInterval(() => void d.hooks?.pump?.(), 100);
    try {
      await connect(d);
      const paused = await newAgent(d, "Night Desk");
      const deleted = await newAgent(d, "Old Desk");
      const control = await newAgent(d, "Day Desk"); // active: its queued turn must run after the restart, so recovery did happen
      for (const a of [paused, deleted, control]) {
        const chat = await ok(d, "chat.start", { kind: "chat", agentIds: [a.id] });
        const threadId = chat.thread.threadId as string;
        await ok(d, "chat.post", { threadId, body: "First question", mentions: [{ kind: "agent", id: a.id }] });
        await waitFor(
          async () => (m.sent.some((s) => s.agent === a.id) ? true : null),
          20_000,
          () => hostLog(d),
        );
        await ok(d, "chat.post", {
          threadId,
          body: "Second question, queued",
          mentions: [{ kind: "agent", id: a.id }],
        });
      }
      // the server is stopping: the engine goes first, and the pause and the delete land in that window (their events wait for the next start)
      hostSeams.setEngineHost(null);
      await ok(d, "agents.pause", { agentId: paused.id, reason: "Paused for the night" });
      await ok(d, "agents.delete", { agentId: deleted.id });
      clearInterval(pumping);
      await d.stop();
      clock.t += 120_000; // the stopped host's thread leases have run out, so recovery takes the threads at once
      phase.restarted = true;
      d = await boot(dir, m.open);
      pumping = setInterval(() => void d.hooks?.pump?.(), 100);
      await d.hooks!.runPeriodic("engine.runtime"); // the recovery sweep, as the scheduler runs it every few seconds
      await waitFor(
        async () => (m.sent.some((s) => s.after && s.agent === control.id) ? true : null),
        20_000,
        () => `${hostLog(d)} ${JSON.stringify(m.sent)}`,
      );
      await new Promise((r) => setTimeout(r, 2_000));
      await d.hooks!.pump();
      const after = m.sent
        .filter((s) => s.after && (s.agent === paused.id || s.agent === deleted.id))
        .map((s) => [s.agent === paused.id ? "paused" : s.agent === deleted.id ? "deleted" : s.agent, s.body]);
      // (the memory upkeep's own one-shot turns read the chats too; they are not the agents' turns)
      assert.deepEqual(
        after,
        [],
        `no turn ran for the paused or the deleted agent after the restart: ${JSON.stringify(after)} ${hostLog(d)}`,
      );
    } finally {
      clearInterval(pumping);
      await d.stop();
    }
  },
);

test(
  "a person removed while the server stops: their queued turn does not run after the restart, and the turn says why; the owner's own queued turn runs",
  { timeout: 120_000 },
  async () => {
    const m = holder();
    phase.restarted = false;
    const dir = seededDir();
    // the owner signs in with the daemon's own token; a member (usr_noah, a seeded member of the Space) with a bearer that names them
    const owner = { token: "" };
    const session = (headers: Record<string, string | string[] | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      if (t === "usr_noah")
        return {
          space: CORE_SPACE,
          principal: { kind: "person" as const, id: "usr_noah" },
          device: "restart-departures",
        };
      if (t !== "" && t === owner.token)
        return {
          space: CORE_SPACE,
          principal: { kind: "person" as const, id: "usr_olivia" },
          device: "restart-departures",
        };
      return null;
    };
    // the provider's own API, for the key check of the team account: a stand-in that lists one model (no test reaches an outside service)
    const http = async (): Promise<Response> =>
      new Response(JSON.stringify({ data: [{ id: "claude-sonnet-4-5", type: "model" }], has_more: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const up = async (): Promise<Daemon> => {
      const x = await boot(dir, m.open, undefined, { session, providerFetch: http as never });
      owner.token = x.token;
      return x;
    };
    let d = await up();
    let pumping = setInterval(() => void d.hooks?.pump?.(), 100);
    const as = async (who: string, cap: string, input: Record<string, unknown>): Promise<any> => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
        method: "POST",
        headers: { authorization: `Bearer ${who}`, "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: `rp-${cap}-${++keys}`, ...input }),
      });
      const b = (await r.json()) as { data?: unknown; error?: unknown };
      assert.equal(r.status, 200, `${cap} as ${who}: ${JSON.stringify(b.error ?? b.data)}`);
      return b.data;
    };
    try {
      await connect(d);
      const desk = await newAgent(d, "Help Desk");
      // a team account the agent works on, so a member's turn has an account to run on (as test/agent-dm.team.live.test.ts sets it up)
      const keysFolder = await as(owner.token, "vault.folders.create", { name: "AI accounts", scope: "shared" });
      const acct = await as(owner.token, "providers.add", {
        providerKey: "anthropic",
        connection: "api_key",
        apiKey: `${KEY}A`,
        name: "Team AI",
        scope: "shared",
        folderId: keysFolder.folder.id,
      });
      await as(owner.token, "agents.update", {
        agentId: desk.id,
        patch: { accountPolicy: "key", accountKey: acct.provider.handle },
      });
      const queued = async (who: string, words: string): Promise<string> => {
        const chat = await as(who, "chat.start", { kind: "chat", agentIds: [desk.id] });
        const threadId = chat.thread.threadId as string;
        await as(who, "chat.post", { threadId, body: `${words}: first`, mentions: [{ kind: "agent", id: desk.id }] });
        await waitFor(
          async () => (m.sent.some((s) => s.body === `${words}: first`) ? true : null),
          20_000,
          () => hostLog(d),
        );
        await as(who, "chat.post", {
          threadId,
          body: `${words}: second, queued`,
          mentions: [{ kind: "agent", id: desk.id }],
        });
        return threadId;
      };
      await queued("usr_noah", "Noah asks");
      await queued(owner.token, "Olivia asks"); // the control: an active person's queued turn, so recovery is seen to run
      // the server is stopping (the engine first); the owner removes the member in that window, so member.removed waits for the next start
      hostSeams.setEngineHost(null);
      await call(d, "members.remove", { idempotencyKey: "rp-remove", personId: "usr_noah", plan: [] }).then((r) =>
        assert.equal(r.status, 200, JSON.stringify(r.data)),
      );
      clearInterval(pumping);
      await d.stop();
      clock.t += 120_000;
      phase.restarted = true;
      d = await up();
      pumping = setInterval(() => void d.hooks?.pump?.(), 100);
      await d.hooks!.runPeriodic("engine.runtime");
      await waitFor(
        async () => (m.sent.some((s) => s.after && s.body.startsWith("Olivia asks")) ? true : null),
        20_000,
        () => `${hostLog(d)} ${JSON.stringify(m.sent)}`,
      );
      await new Promise((r) => setTimeout(r, 2_000));
      await d.hooks!.pump();
      assert.deepEqual(
        m.sent.filter((s) => s.after && s.body.startsWith("Noah asks")),
        [],
        `the removed person's queued turn did not run: ${hostLog(d)}`,
      );
      // it says why: the queued turn is dropped with the reason in the log, and the queue holds nothing of theirs any more (before, the row waited for ever)
      const db = new DatabaseSync(d.paths.modules, { readOnly: true });
      const log = `${hostLog(d)} QUEUE ${JSON.stringify(db.prepare("SELECT thread_id, qseq, kind, from_principal, state FROM engine_thread_queue").all())} TURNS ${JSON.stringify(db.prepare("SELECT thread_id, asker, state, error FROM engine_turns").all())}`;
      d.sink.flush();
      const said = new DatabaseSync(d.paths.logs, { readOnly: true })
        .prepare("SELECT msg, attrs FROM logs WHERE msg LIKE ?")
        .all("a queued turn was not run%") as Array<{ msg: string; attrs: string | null }>;
      assert.ok(
        said.some((r) => String(r.attrs).includes("usr_noah")),
        `the reason is in the log, with the person: ${log}`,
      );
      const left = new DatabaseSync(d.paths.modules, { readOnly: true })
        .prepare("SELECT state FROM engine_thread_queue WHERE from_principal = ? AND state IN ('queued', 'running')")
        .all("usr_noah");
      assert.deepEqual(left, [], "nothing of the removed person's waits in the queue");
    } finally {
      clearInterval(pumping);
      await d.stop();
    }
  },
);
