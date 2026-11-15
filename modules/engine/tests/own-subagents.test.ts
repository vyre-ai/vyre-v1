// The subagents a command-line engine starts in its own turn (finding F41): a row at the start and one at the end, nothing per line; the row hangs under the reply and goes with it; and who reads what.
import test from "node:test";
import assert from "node:assert/strict";
import {
  backgroundCount,
  backgroundLine,
  backgroundNow,
  eraseOwn,
  hangOwn,
  listOwn,
  noteOwn,
  noteTask,
  settleOwn,
} from "../own-subagents.ts";
import { crewStatus } from "../handlers/crew-status.ts";
import { harness } from "../fixtures/harness.ts";
import type { EngineCtx } from "../projections.ts";

const e = { threadId: "thr_1", turnId: "trn_1", agentId: "agt_dex", asker: "usr_asker" };
const live = new Set(["trn_1"]);
const rows = (h: ReturnType<typeof harness>) => listOwn(h.ctx.db, "thr_1", live);

test("a subagent starts on its call, takes its task, ends with what it returned; its own lines write nothing", () => {
  const h = harness();
  noteOwn(
    h.ctx.db,
    e,
    [
      { phase: "call", id: "toolu_a", name: "Agent" },
      { phase: "input", id: "toolu_a", detail: "Test the terminal" },
    ],
    100,
  );
  const writes = (): number =>
    (h.ctx.db.all("SELECT COUNT(*) AS n FROM engine_own_subagent") as Array<{ n: number }>)[0]!.n;
  assert.equal(writes(), 1);
  let [row] = rows(h);
  assert.deepEqual(
    [row!.title, row!.state, row!.startedAt, row!.asker],
    ["Test the terminal", "working", 100, "usr_asker"],
  );
  // lines the subagent works through carry `parent` and are not kept
  noteOwn(
    h.ctx.db,
    e,
    [
      { phase: "call", id: "tu_1", name: "Bash", parent: "toolu_a" },
      { phase: "input", id: "tu_1", detail: "x", parent: "toolu_a" },
    ],
    200,
  );
  assert.equal(writes(), 1);
  noteOwn(h.ctx.db, e, [{ phase: "result", id: "toolu_a", ok: true, result: "It works." }], 900);
  [row] = rows(h);
  assert.deepEqual([row!.state, row!.found, row!.endedAt], ["done", "It works.", 900]);
});

test("a call that is not a subagent starts nothing, a failed one fails, an unfinished one is stopped with its turn or a restart", () => {
  const h = harness();
  noteOwn(
    h.ctx.db,
    e,
    [
      { phase: "call", id: "x", name: "Bash" },
      { phase: "input", id: "x", detail: "ls" },
      { phase: "result", id: "x", ok: true },
    ],
    1,
  );
  assert.deepEqual(rows(h), []);
  noteOwn(
    h.ctx.db,
    e,
    [
      { phase: "call", id: "t", name: "Task" },
      { phase: "result", id: "t", ok: false },
    ],
    2,
  );
  noteOwn(h.ctx.db, { ...e, turnId: "trn_2" }, [{ phase: "call", id: "a", name: "Agent" }], 3);
  assert.deepEqual(
    listOwn(h.ctx.db, "thr_1", new Set()).map((x) => x.state),
    ["failed", "stopped"],
    "no live turn: a restart",
  );
  settleOwn(h.ctx.db, "trn_2", 50);
  assert.deepEqual(
    listOwn(h.ctx.db, "thr_1", new Set(["trn_2"])).map((x) => [x.state, x.endedAt]),
    [
      ["failed", 2],
      ["stopped", 50],
    ],
  );
});

test("rows hang under the reply and go with that message or its chat, and with nothing else", () => {
  const h = harness();
  noteOwn(h.ctx.db, e, [{ phase: "call", id: "a", name: "Agent" }], 1);
  noteOwn(h.ctx.db, { ...e, turnId: "trn_2" }, [{ phase: "call", id: "b", name: "Agent" }], 2);
  noteOwn(h.ctx.db, { ...e, threadId: "thr_2", turnId: "trn_3" }, [{ phase: "call", id: "c", name: "Agent" }], 3);
  hangOwn(h.ctx.db, "trn_1", "msg_1");
  hangOwn(h.ctx.db, "trn_2", "msg_2");
  hangOwn(h.ctx.db, "trn_3", "msg_3");
  assert.equal(eraseOwn(h.ctx.db, { messageId: "msg_1" }), 1);
  assert.deepEqual(
    listOwn(h.ctx.db, "thr_1", new Set()).map((x) => x.callId),
    ["b"],
  );
  assert.equal(eraseOwn(h.ctx.db, { threadId: "thr_1" }), 1, "an erased chat takes its rows");
  assert.deepEqual(
    listOwn(h.ctx.db, "thr_2", new Set()).map((x) => x.callId),
    ["c"],
    "another chat's rows stay",
  );
});

/** engine.crew.status as one person reads it: the helpers read is stubbed, only the chat's readers pass. */
async function read(h: ReturnType<typeof harness>, who: string, readers: string[]) {
  const ctx = {
    ...h.ctx,
    principal: { kind: "person", id: who },
    async call(cap: string) {
      if (!readers.includes(who)) throw new Error("validation.not_found");
      if (cap === "chat.helpers.list") return { helpers: [] };
      if (cap === "engine.accounts.list") return { accounts: [] };
      return {};
    },
  } as unknown as EngineCtx;
  return crewStatus(ctx, { threadId: "thr_1" });
}

test("who sees a subagent: the asker the whole row; every other reader only that a helper ran, its state and clock (never the task line, steps or answer); a stranger nothing", async () => {
  for (const kind of ["group chat", "private chat"]) {
    const h = harness();
    noteOwn(
      h.ctx.db,
      e,
      [
        { phase: "call", id: "toolu_a", name: "Agent" },
        { phase: "input", id: "toolu_a", detail: "Test the terminal" },
        { phase: "result", id: "toolu_a", ok: true, result: "Secret words it returned." },
      ],
      10,
    );
    const readers = kind === "group chat" ? ["usr_asker", "usr_member", "usr_guest"] : ["usr_asker"];
    const asker = (await read(h, "usr_asker", readers)).members[0]!;
    assert.deepEqual([asker.kind, asker.title, asker.state], ["subagent", "Test the terminal", "done"], kind);
    assert.equal(asker.answer, "Secret words it returned.", `${kind}: the asker reads the answer`);
    if (kind === "group chat")
      for (const other of ["usr_member", "usr_guest"]) {
        const m = (await read(h, other, readers)).members[0]!;
        assert.deepEqual(
          [m.kind, m.title, m.state, m.elapsedMs],
          ["subagent", "Helper 1", "done", 0],
          `${other} sees that a helper ran`,
        );
        assert.equal(m.answer, undefined, `${other}: no answer`);
        assert.equal(m.found, undefined, `${other}: no words of it`);
        assert.doesNotMatch(JSON.stringify(m), /Secret|terminal/i, `${other}: no task line, no answer`);
      }
    await assert.rejects(read(h, "usr_stranger", readers), Error, `${kind}: a stranger is refused`);
  }
});

test("the consumer erases on message.deleted and thread.erased, as chat emits them (also for each thread of an erased family)", async () => {
  const { bridgeConsumers } = await import("../handlers/bridge.ts");
  const run = bridgeConsumers["engine.own_subagents_erase"].run;
  const h = harness();
  noteOwn(h.ctx.db, e, [{ phase: "call", id: "a", name: "Agent" }], 1);
  hangOwn(h.ctx.db, "trn_1", "msg_1");
  noteOwn(h.ctx.db, { ...e, threadId: "thr_9", turnId: "trn_9" }, [{ phase: "call", id: "z", name: "Agent" }], 1);
  assert.deepEqual(
    await run(h.ctx, { name: "message.deleted", payload: { messageId: "msg_1", threadId: "thr_1" } } as never),
    { removed: 1 },
  );
  assert.deepEqual(await run(h.ctx, { name: "thread.erased", payload: { threadId: "thr_9" } } as never), {
    removed: 1,
  });
  assert.deepEqual(listOwn(h.ctx.db, "thr_9", new Set()), []);
});

test("retention: a purge that names the messages it removed takes their rows; a soft-deleted chat keeps them, and they go when the chat is erased for good", async () => {
  const { bridgeConsumers } = await import("../handlers/bridge.ts");
  const run = bridgeConsumers["engine.own_subagents_erase"].run;
  const h = harness();
  noteOwn(h.ctx.db, e, [{ phase: "call", id: "a", name: "Agent" }], 1);
  noteOwn(h.ctx.db, { ...e, turnId: "trn_2" }, [{ phase: "call", id: "b", name: "Agent" }], 2);
  hangOwn(h.ctx.db, "trn_1", "msg_1");
  hangOwn(h.ctx.db, "trn_2", "msg_2");
  // the chat is soft-deleted (restorable): no event, the rows stay and come back with it
  assert.deepEqual(
    listOwn(h.ctx.db, "thr_1", new Set()).map((x) => x.callId),
    ["a", "b"],
  );
  // the retention purge removes msg_1 for good
  assert.deepEqual(
    await run(h.ctx, { name: "transcripts.purged", payload: { removed: 1, messageIds: ["msg_1"] } } as never),
    { removed: 1 },
  );
  assert.deepEqual(
    listOwn(h.ctx.db, "thr_1", new Set()).map((x) => x.callId),
    ["b"],
  );
  // the soft-deleted chat passes its restore window: the purge erases it for good
  assert.deepEqual(await run(h.ctx, { name: "thread.erased", payload: { threadId: "thr_1" } } as never), {
    removed: 1,
  });
  assert.deepEqual(listOwn(h.ctx.db, "thr_1", new Set()), []);
});

// ---- helpers started in the background (owner's rc.28 report, 16 Nov 2026): launched is not finished ----

const bgE = { threadId: "thr_bg", turnId: "trn_bg", agentId: "agt_dex", asker: "usr_asker" };
const launched = (id: string, title: string): unknown[] => [
  { phase: "call", id, name: "Agent" },
  { phase: "input", id, detail: title },
  // what the engine's launch call returns: it started, it did not finish (no answer, whatever its words)
  { phase: "result", id, ok: true, launched: true },
];

test("a helper launched in the background keeps working after its launch result and after its turn ends; its own end finishes it", () => {
  const h = harness();
  noteOwn(h.ctx.db, bgE, [...launched("c1", "Batch 1"), ...launched("c2", "Batch 2")], 1_000);
  const rows = (): ReturnType<typeof listOwn> => listOwn(h.ctx.db, "thr_bg", new Set());
  assert.deepEqual(
    rows().map((x) => [x.title, x.state]),
    [
      ["Batch 1", "working"],
      ["Batch 2", "working"],
    ],
    "launched, not done",
  );
  assert.equal(backgroundCount("thr_bg"), 2);
  settleOwn(h.ctx.db, "trn_bg", 2_000); // the turn ends: "I'm waiting for all four"
  assert.deepEqual(
    rows().map((x) => x.state),
    ["working", "working"],
    "a background helper is not the turn's to end",
  );
  noteTask(h.ctx.db, bgE, { state: "progress", id: "c1", taskId: "ag_1", text: "Reading the second profile" }, 3_000);
  assert.equal(rows()[0]!.step, "Reading the second profile");
  noteTask(h.ctx.db, bgE, { state: "end", id: "c1", taskId: "ag_1", ok: true, text: "11 rows ranked" }, 4_000);
  assert.deepEqual(
    rows().map((x) => [x.state, x.found, x.endedAt, x.step]),
    [
      ["done", "11 rows ranked", 4_000, undefined],
      ["working", undefined, undefined, undefined],
    ],
  );
  assert.equal(backgroundCount("thr_bg"), 1);
  assert.match(
    backgroundLine(h.ctx.db, "thr_bg") ?? "",
    /^1 of 2 helpers or jobs you started in the background is still working: Batch 2\./,
  );
  // a task line that names only the engine's own id finds its row by it; a stopped one is stopped, a failed one failed
  noteTask(h.ctx.db, bgE, { state: "end", id: "ag_2", taskId: "ag_2", ok: false, text: "no network" }, 5_000);
  assert.equal(rows()[1]!.state, "working", "an unknown id ends nothing");
  noteTask(h.ctx.db, bgE, { state: "start", id: "c2", taskId: "ag_2" }, 5_100);
  noteTask(h.ctx.db, bgE, { state: "end", id: "ag_2", taskId: "ag_2", ok: false, text: "no network" }, 5_200);
  assert.deepEqual([rows()[1]!.state, rows()[1]!.found], ["failed", "no network"]);
  assert.equal(backgroundCount("thr_bg"), 0);
  assert.equal(backgroundLine(h.ctx.db, "thr_bg"), null);
});

test("a background shell job is a row of its own; a server that restarted has no process, so a row still working is read as stopped", () => {
  const h = harness();
  const e2 = { ...bgE, threadId: "thr_sh" };
  noteOwn(
    h.ctx.db,
    e2,
    [
      { phase: "call", id: "sh1", name: "Bash" },
      { phase: "result", id: "sh1", ok: true, launched: true, detail: "Build the site" },
    ],
    1,
  );
  assert.deepEqual(
    listOwn(h.ctx.db, "thr_sh", new Set()).map((x) => [x.title, x.state]),
    [["Build the site", "working"]],
  );
  assert.deepEqual(
    backgroundNow()
      .filter((b) => b.threadId === "thr_sh")
      .map((b) => b.count),
    [1],
  );
  noteTask(h.ctx.db, e2, { state: "end", id: "sh1", taskId: "", stopped: true }, 9);
  assert.equal(listOwn(h.ctx.db, "thr_sh", new Set())[0]!.state, "stopped");
  assert.equal(backgroundCount("thr_sh"), 0);
  // a row that says working with no process behind it (the server restarted)
  h.ctx.db.run(
    "INSERT INTO engine_own_subagent (thread_id, call_id, agent_id, turn_id, asker, started_at, title, background) VALUES ('thr_old', 'x', 'agt', 'trn', 'usr_asker', 1, 'Old', 1)",
  );
  assert.equal(listOwn(h.ctx.db, "thr_old", new Set())[0]!.state, "stopped");
});

test("the crew read says a background helper works, with its step and a clock that counts, and 2 of 4 done only for what ended", async () => {
  const h = harness();
  noteOwn(
    h.ctx.db,
    bgE,
    [...launched("c1", "B1"), ...launched("c2", "B2"), ...launched("c3", "B3"), ...launched("c4", "B4")],
    1_000,
  );
  noteTask(h.ctx.db, bgE, { state: "progress", id: "c1", taskId: "", text: "Searching the web" }, 1_500);
  noteTask(h.ctx.db, bgE, { state: "end", id: "c2", taskId: "", ok: true, text: "Done: 3 rows" }, 2_000);
  noteTask(h.ctx.db, bgE, { state: "end", id: "c3", taskId: "", ok: true, text: "Done: 4 rows" }, 2_500);
  const ctx = {
    ...h.ctx,
    now: () => 63_000,
    principal: { kind: "person", id: "usr_asker" },
    async call(cap: string) {
      if (cap === "chat.helpers.list") return { helpers: [] };
      if (cap === "engine.accounts.list") return { accounts: [] };
      return {};
    },
  } as unknown as EngineCtx;
  const out = await crewStatus(ctx, { threadId: "thr_bg" });
  assert.deepEqual(
    out.members.map((m) => [m.title, m.state, m.step]),
    [
      ["B1", "working", "Searching the web"],
      ["B2", "done", undefined],
      ["B3", "done", undefined],
      ["B4", "working", undefined],
    ],
  );
  assert.deepEqual([out.totals.working, out.totals.done, out.totals.members], [2, 2, 4]);
  assert.equal(out.totals.elapsedMs, 62_000, "the real elapsed time of the longest, not 0:08");
  assert.equal(JSON.stringify(out).includes("Async agent launched"), false);
});
