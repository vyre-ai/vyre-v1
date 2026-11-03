// Two computers of one Personal Space never do the Space's work twice (lane l-multidevice). Two booted daemons and a real relay node:
//   - one computer holds the scheduled-work lease, so only it runs automations, routines, watchers, provider pulls and nightly jobs; each still looks after its own files and engine;
//   - when the holder stops, the other takes the lease once it runs out;
//   - a scheduled tick both computers fired while apart is one Run once they sync (the Run's id comes from the tick's key);
//   - a chat message to an agent made on A and synced to B starts nothing on B: no event, no queued turn. The turn starts where the message was sent.
import test from "node:test";
import assert from "node:assert/strict";
import { createRelay } from "../relay/node/server.js";
import { boot, call, firstComputer, pause, stageSecond } from "./peers-kit.mjs";

// short so the failover below takes seconds, long enough that a loaded runner gets from one renewal to the checks that follow it (1.5 s ran out between them under CI load)
const LEASE = 4_000;

test("one runner at a time with failover, one Run per tick, and a synced message starts no turn on the other computer", { timeout: 60_000 }, async () => {
  const relay = createRelay();
  const base = await relay.listen();
  let A = null, B = null;
  try {
    const first = await firstComputer(base);
    await first.A.stop();
    A = await boot(first.dirA, ["--relay", base, "--peer-name", "Office iMac"], { peerLeaseMs: LEASE });
    const { dirB } = await stageSecond(A, first.dirA);
    B = await boot(dirB, ["--space", "spc_staged", "--relay", base, "--peer-name", "Home laptop"], { peerLeaseMs: LEASE });
    await A.peers.tick();
    await B.peers.tick();

    // the lease: A takes it, B learns it and waits
    assert.equal(A.peers.sync.lease().mine, true);
    await B.peers.sync.round();
    for (const job of ["automations.schedule_tick", "calendar.pull_provider", "memory.nightly", "runs.sweep_waits"]) {
      assert.equal(A.peers.mayRun(job), true, `A runs ${job}`);
      assert.equal(B.peers.mayRun(job), false, `B does not run ${job}`);
    }
    for (const job of ["agents.agent_files", "engine.runtime"]) assert.equal(B.peers.mayRun(job), true, `B still runs its own ${job}`);
    assert.equal(B.peers.sync.lease().mine, false, "B renews nothing it does not hold");

    // a tick both computers fired while apart is one Run
    const key = "run:aut_nightly:aut_nightly:1790000000000";
    const startA = await call(A, "/v1/runs/start", { kind: "automation", name: "Nightly digest", owner: "usr_olivia", idempotencyKey: key });
    const startB = await call(B, "/v1/runs/start", { kind: "automation", name: "Nightly digest", owner: "usr_olivia", idempotencyKey: key });
    assert.equal(startA.status, 200, JSON.stringify(startA.body));
    assert.equal(startA.body.data.runId, startB.body.data.runId, "both computers made the same Run from the tick's key");
    await B.peers.sync.round();
    await A.peers.sync.round();
    for (const d of [A, B]) assert.equal(d.db.all("SELECT count(*) AS n FROM runs_items WHERE name = 'Nightly digest'")[0].n, 1, "one Run, not two");

    // a message to an agent, sent on A: the turn starts on A, and the copy of the message on B starts nothing
    const headB = (await B.log.currentHead()).seq;
    const chat = await call(A, "/v1/chat/start", { kind: "chat", agentIds: ["agt_scout"], first: "@Scout what is on today?" }, "tok-usr_noah");
    assert.equal(chat.status, 200, JSON.stringify(chat.body));
    const threadId = chat.body.data.thread.threadId;
    await pause(300);
    await B.peers.sync.round();
    assert.equal(B.db.all("SELECT count(*) AS n FROM chat_thread WHERE id = ?", threadId)[0].n, 1, "the chat reached B");
    await B.hooks.pump();
    await B.hooks.runPeriodic("engine.runtime").catch(() => undefined);
    const after = await B.log.read({ after: headB, limit: 500 });
    const started = after.filter((e) => /^(message\.|agent\.engaged|turn\.|thread\.started|mention)/.test(e.type));
    assert.deepEqual(started.map((e) => e.type), [], "B wrote no message, mention or turn event of its own");
    assert.equal(B.db.all("SELECT count(*) AS n FROM engine_thread_queue WHERE thread_id = ?", threadId)[0].n, 0, "nothing is queued for B's engine");
    const onA = await A.log.read({ type: "message.received", limit: 500 });
    assert.equal(onA.filter((e) => JSON.stringify(e).includes(threadId)).length + (await A.log.read({ type: "agent.engaged", limit: 500 })).filter((e) => JSON.stringify(e).includes(threadId)).length >= 1, true, "the message was received on A, where it was sent");

    // A goes to sleep: once its lease runs out, B takes over. A renews as it would on its last round before sleeping, so the lease B sees is a fresh one
    assert.equal(A.peers.sync.lease().mine, true, "A renews its lease");
    await B.peers.sync.round();
    await A.stop(); A = null;
    assert.equal(B.peers.mayRun("automations.schedule_tick"), false, "not while A's lease still runs");
    await pause(LEASE + 300);
    await B.peers.sync.round();
    assert.equal(B.peers.sync.lease().mine, true, "B holds the lease once A's ran out");
    assert.equal(B.peers.mayRun("automations.schedule_tick"), true);
  } finally {
    await B?.stop();
    await A?.stop();
    await relay.close();
  }
});
