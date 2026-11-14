// The subagents a command-line engine starts in its own turn (finding F41): a row at the start and one at the end, nothing per line; the row hangs under the reply and goes with it; and who reads what.
import test from "node:test";
import assert from "node:assert/strict";
import { eraseOwn, hangOwn, listOwn, noteOwn, settleOwn } from "../own-subagents.ts";
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

test("who sees a subagent: every reader sees that it ran, its task, its state and clock; its answer is the asker's alone; a stranger sees nothing", async () => {
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
        assert.deepEqual([m.title, m.state, m.elapsedMs], ["Test the terminal", "done", 0], `${other} sees the row`);
        assert.equal(m.answer, undefined, `${other}: no answer`);
        assert.equal(m.found, undefined, `${other}: no words of it`);
        assert.doesNotMatch(JSON.stringify(m), /Secret/);
      }
    await assert.rejects(read(h, "usr_stranger", readers), Error, `${kind}: a stranger is refused`);
  }
});
