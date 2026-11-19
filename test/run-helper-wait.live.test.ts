// r42-runtime on a booted daemon, only the model scripted: a helper told to start after another waits (its node queued behind it, its model not called), starts when that one has succeeded, and fails with it, never starting, when that one fails.
import test from "node:test";
import assert from "node:assert/strict";
import {
  boot,
  call,
  connect,
  makeAgent,
  ok,
  scriptedModel,
  seededDir,
  startChat,
  stop,
  waitFor,
} from "./support/eco-live.ts";

test("a helper that depends on another waits, then starts; one whose dependency fails fails and never starts", async () => {
  const calls: Record<string, number> = { ALPHA: 0, BETA: 0, GAMMA: 0, DELTA: 0 };
  let release!: () => void;
  const alphaGo = new Promise<void>((r) => (release = r));
  const model = scriptedModel(async function* (input) {
    const body = String(input.trigger?.body ?? "");
    if (/HOLD/.test(body)) await new Promise<void>(() => undefined); // the lead's turn stays open: it is the job the helpers belong to
    for (const k of Object.keys(calls)) if (body.includes(k)) calls[k] = (calls[k] ?? 0) + 1;
    if (body.includes("ALPHA")) {
      await alphaGo;
      yield { type: "text", text: "alpha done" };
    } else if (body.includes("GAMMA")) {
      yield { type: "error", code: "model.failed", message: "gamma could not finish" };
      return;
    } else if (/BETA|DELTA/.test(body)) {
      yield { type: "text", text: "done" };
    }
  });
  const dir = seededDir();
  const d = await boot(dir, model);
  try {
    await connect(d);
    const agent = await makeAgent(d, "Lead");
    const chat = await startChat(d, agent, "hw");
    await ok(d, "threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "hw-auto" });
    await ok(d, "chat.post", {
      threadId: chat,
      body: "HOLD the job",
      mentions: [{ kind: "agent", id: agent }],
      idempotencyKey: "hw-hold",
    });
    const lead = await waitFor(async () => {
      const rows = (await ok(d, "runs.activity.list", {})).rows as Array<{
        runId: string;
        kind: string;
        status: string;
      }>;
      return rows.find((r) => r.kind === "turn" && r.status === "running") ?? null;
    }, 20_000);
    const start = (title: string, instruction: string, dependsOn?: string[]) =>
      ok(d, "chat.helper.start", {
        threadId: chat,
        title,
        instruction,
        agentId: agent,
        ...(dependsOn ? { dependsOn } : {}),
        idempotencyKey: `hw-${title}`,
      });
    const nodes = async (): Promise<
      Array<{
        id: string;
        name?: string;
        status: string;
        dependsOn?: string[];
        errorCode?: string;
        reason?: string;
      }>
    > => (await ok(d, "runs.tree.get", { runId: lead.runId })).nodes;
    const named = async (name: string) => (await nodes()).find((n) => n.name === name);

    await start("Alpha", "ALPHA: add the figures");
    const alpha = await waitFor(async () => {
      const n = await named("Alpha");
      return n?.status === "running" ? n : null;
    }, 20_000);
    await start("Beta", "BETA: write it up", ["Alpha"]);
    const beta = await waitFor(async () => (await named("Beta")) ?? null, 20_000);
    assert.equal(beta.status, "queued", "it waits");
    assert.deepEqual(beta.dependsOn, [alpha.id], "and the node says for what");
    await new Promise((r) => setTimeout(r, 3_000));
    assert.equal(calls["BETA"], 0, "its model was not called while Alpha works");

    release();
    await waitFor(async () => ((await named("Beta"))?.status === "succeeded" ? true : null), 30_000);
    assert.equal(calls["BETA"], 1, "it started once Alpha was done");
    assert.equal((await named("Alpha"))?.status, "succeeded");

    await start("Gamma", "GAMMA: this one fails");
    await start("Delta", "DELTA: after gamma", ["Gamma"]);
    await waitFor(async () => ((await named("Gamma"))?.status === "failed" ? true : null), 30_000);
    const delta = await waitFor(async () => {
      const n = await named("Delta");
      return n?.status === "failed" ? n : null;
    }, 30_000);
    assert.equal(delta.status, "failed", "a helper whose dependency failed fails with it");
    assert.equal(calls["DELTA"], 0, "and never started");
    // one asked to wait for work that had already failed is failed at once, naming it
    await start("Epsilon", "DELTA: after a failed one", ["Gamma"]);
    const eps = await waitFor(async () => {
      const n = (await nodes()).find((x) => x.name === "Epsilon");
      return n?.status === "failed" ? n : null;
    }, 20_000);
    assert.equal(eps.errorCode, "dependency_failed");
    assert.equal(eps.reason, "Didn't start because Gamma failed.");
    assert.equal(calls["DELTA"], 0, "still never started");
    // and the crew list agrees: those two are failed, not working
    const crew = (await ok(d, "engine.crew.status", { threadId: chat })).members as Array<{
      title: string;
      state: string;
    }>;
    for (const t of ["Delta", "Epsilon"])
      assert.equal(crew.find((m) => m.title === t)?.state, "failed", `${t} is not working`);
  } finally {
    await stop(d);
  }
});

test("a re-run: a finished helper is started again with another brief; the new node stands at once, its first turn takes it over, and compare reads both", async () => {
  let runs = 0;
  const model = scriptedModel(async function* (input) {
    const body = String(input.trigger?.body ?? "");
    if (/HOLD/.test(body)) await new Promise<void>(() => undefined);
    if (body.includes("ALPHA")) {
      runs += 1;
      yield { type: "text", text: `answer ${body.includes("two") ? "two" : "one"}` };
    }
  });
  const dir = seededDir();
  const d = await boot(dir, model);
  try {
    await connect(d);
    const agent = await makeAgent(d, "Lead");
    const chat = await startChat(d, agent, "rr");
    await ok(d, "threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "rr-auto" });
    await ok(d, "chat.post", {
      threadId: chat,
      body: "HOLD the job",
      mentions: [{ kind: "agent", id: agent }],
      idempotencyKey: "rr-hold",
    });
    const lead = await waitFor(async () => {
      const rows = (await ok(d, "runs.activity.list", {})).rows as Array<{
        runId: string;
        kind: string;
        status: string;
      }>;
      return rows.find((r) => r.kind === "turn" && r.status === "running") ?? null;
    }, 20_000);
    await ok(d, "chat.helper.start", {
      threadId: chat,
      title: "Alpha",
      instruction: "ALPHA one: price it from the 2025 sheet",
      agentId: agent,
      idempotencyKey: "rr-alpha",
    });
    const nodes = async (): Promise<Array<{ id: string; name?: string; status: string; threadId?: string }>> =>
      (await ok(d, "runs.tree.get", { runId: lead.runId })).nodes;
    const first = await waitFor(async () => {
      const n = (await nodes()).find((x) => x.name === "Alpha" && x.status === "succeeded");
      return n ?? null;
    }, 30_000);

    const again = await ok(d, "runs.node.rerun", {
      runId: first.id,
      instructions: "ALPHA two: price it from the 2026 sheet",
    });
    assert.ok(again.threadId, "a new helper was started");
    const early = (await ok(d, "runs.node.compare", { runId: first.id })).sides;
    assert.equal(early.length, 2);
    assert.ok(early[1].runId, "its node stands from the first moment");

    await waitFor(async () => {
      const s = (await ok(d, "runs.node.compare", { runId: first.id })).sides;
      return s[1]?.status === "succeeded" ? true : null;
    }, 30_000);
    const sides = (await ok(d, "runs.node.compare", { runId: first.id })).sides;
    assert.equal(sides[1].runId, early[1].runId, "its first turn took that node over: one node, not two");
    assert.match(sides[0].brief.instructions, /ALPHA one/);
    assert.match(sides[1].brief.instructions, /ALPHA two/);
    assert.match(String(sides[0].result), /answer one/);
    assert.match(String(sides[1].result), /answer two/);
    assert.equal(runs, 2);
    assert.equal(
      (await ok(d, "runs.node.get", { runId: first.id })).node.status,
      "succeeded",
      "the first is as it was",
    );
    const same = await ok(d, "runs.node.rerun", {
      runId: first.id,
      instructions: "ALPHA two: price it from the 2026 sheet",
    });
    assert.equal(same.threadId, again.threadId, "the same press again is the same helper");
    assert.equal(runs, 2);
  } finally {
    await stop(d);
  }
});

test("a helper cannot wait for one of earlier work: chat.helper.start refuses it and starts nothing", async () => {
  let betaCalls = 0;
  const model = scriptedModel(async function* (input) {
    const body = String(input.trigger?.body ?? "");
    if (/HOLD/.test(body)) await new Promise<void>(() => undefined);
    if (body.includes("BETA")) betaCalls += 1;
    if (body.includes("ALPHA")) yield { type: "text", text: "alpha done" };
  });
  const dir = seededDir();
  const d = await boot(dir, model);
  try {
    await connect(d);
    const agent = await makeAgent(d, "Lead");
    const chat = await startChat(d, agent, "oj");
    await ok(d, "threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "oj-auto" });
    // earlier work: a helper that ran with no job open, so it is a job of its own
    const first = await ok(d, "chat.helper.start", {
      threadId: chat,
      title: "Alpha",
      instruction: "ALPHA: earlier work",
      agentId: agent,
      idempotencyKey: "oj-alpha",
    });
    const alphaThread = first.helper.threadId as string;
    await waitFor(async () => {
      const f = (await ok(d, "runs.node.find", { threadIds: [alphaThread] })).byThread as Record<string, string>;
      const id = f[alphaThread];
      return id && (await ok(d, "runs.node.get", { runId: id })).node.status === "succeeded" ? true : null;
    }, 30_000);
    // a new job: the lead's turn is open
    await ok(d, "chat.post", {
      threadId: chat,
      body: "HOLD the new job",
      mentions: [{ kind: "agent", id: agent }],
      idempotencyKey: "oj-hold",
    });
    await waitFor(async () => {
      const rows = (await ok(d, "runs.activity.list", {})).rows as Array<{ kind: string; status: string }>;
      return rows.some((r) => r.kind === "turn" && r.status === "running") ? true : null;
    }, 20_000);
    const before = ((await ok(d, "chat.helpers.list", { threadId: chat })).helpers as unknown[]).length;
    const refused = await call(d, "chat.helper.start", {
      threadId: chat,
      title: "Beta",
      instruction: "BETA: after the earlier work",
      agentId: agent,
      dependsOn: ["Alpha"],
      idempotencyKey: "oj-beta",
    });
    assert.notEqual(refused.status, 200, "refused");
    assert.match(JSON.stringify(refused.data), /no_such_helper|same job/);
    assert.equal(
      ((await ok(d, "chat.helpers.list", { threadId: chat })).helpers as unknown[]).length,
      before,
      "nothing started",
    );
    await new Promise((r) => setTimeout(r, 1_500));
    assert.equal(betaCalls, 0);
  } finally {
    await stop(d);
  }
});
