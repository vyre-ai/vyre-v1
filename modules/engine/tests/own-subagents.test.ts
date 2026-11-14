// The subagents a command-line engine starts in its own turn (finding F41): one row per Agent call, read from the step stream. It starts on the call, takes its task from the call's input, shows what it is
// on from the lines it works through (they carry the call's id as `parent`), and ends on the call's result with the words it returned. A turn that ends takes any that never returned.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { listOwn, noteOwn, settleOwn } from "../own-subagents.ts";
import type { Db } from "../projections.ts";

const mk = (): Db => {
  const s = new DatabaseSync(":memory:");
  return {
    run: (sql: string, ...a: unknown[]) => {
      s.prepare(sql).run(...(a as never[]));
    },
    all: (sql: string, ...a: unknown[]) => s.prepare(sql).all(...(a as never[])),
  } as unknown as Db;
};
const e = { threadId: "thr_1", turnId: "trn_1", agentId: "agt_dex" };
const live = new Set(["trn_1"]);

test("a subagent starts on its call, takes its task, shows what it is on, and ends with what it returned", () => {
  const db = mk();
  noteOwn(
    db,
    e,
    [
      { phase: "call", id: "toolu_a", name: "Agent" },
      { phase: "input", id: "toolu_a", detail: "Test the terminal" },
    ],
    100,
  );
  let [row] = listOwn(db, "thr_1", live);
  assert.deepEqual([row!.title, row!.state, row!.startedAt], ["Test the terminal", "working", 100]);
  noteOwn(db, e, [{ phase: "call", id: "tu_1", name: "Bash", parent: "toolu_a" }], 200);
  noteOwn(
    db,
    e,
    [
      { phase: "call", id: "tu_2", name: "Read", parent: "toolu_a" },
      { phase: "input", id: "tu_2", detail: "page.html", parent: "toolu_a" },
    ],
    300,
  );
  [row] = listOwn(db, "thr_1", live);
  assert.equal(row!.step, "Reading page.html");
  assert.deepEqual(row!.steps, ["Running a command", "Reading page.html"]);
  noteOwn(db, e, [{ phase: "result", id: "toolu_a", ok: true, result: "It works." }], 900);
  [row] = listOwn(db, "thr_1", live);
  assert.deepEqual([row!.state, row!.found, row!.endedAt, row!.step], ["done", "It works.", 900, undefined]);
  // a late line of a finished subagent changes nothing
  noteOwn(db, e, [{ phase: "call", id: "tu_3", name: "Bash", parent: "toolu_a" }], 950);
  assert.deepEqual(listOwn(db, "thr_1", live)[0]!.steps, ["Running a command", "Reading page.html"]);
});

test("a call that is not a subagent starts nothing, and a failed one fails", () => {
  const db = mk();
  noteOwn(
    db,
    e,
    [
      { phase: "call", id: "x", name: "Bash" },
      { phase: "input", id: "x", detail: "ls" },
      { phase: "result", id: "x", ok: true },
    ],
    1,
  );
  assert.deepEqual(listOwn(db, "thr_1", live), []);
  noteOwn(
    db,
    e,
    [
      { phase: "call", id: "t", name: "Task" },
      { phase: "result", id: "t", ok: false },
    ],
    2,
  );
  assert.equal(listOwn(db, "thr_1", live)[0]!.state, "failed");
});

test("a turn that ends, or a server that went away, never leaves a subagent working", () => {
  const db = mk();
  noteOwn(db, e, [{ phase: "call", id: "a", name: "Agent" }], 1);
  noteOwn(db, { ...e, turnId: "trn_2" }, [{ phase: "call", id: "b", name: "Agent" }], 2);
  // after a restart no turn is live: both read as stopped
  assert.deepEqual(
    listOwn(db, "thr_1", new Set()).map((x) => x.state),
    ["stopped", "stopped"],
  );
  settleOwn(db, "trn_1", 50);
  assert.deepEqual(
    listOwn(db, "thr_1", new Set(["trn_2"])).map((x) => [x.state, x.endedAt]),
    [
      ["stopped", 50],
      ["working", undefined],
    ],
  );
});
