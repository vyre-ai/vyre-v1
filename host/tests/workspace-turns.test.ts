// The room rule's turn check (fifth look V1): a waiting turn counts as a running one, and a crew helper's turn counts for the parent's workspace it works in.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { workspaceInTurn } from "../src/daemon/workspace-turns.ts";

const NOW = 1_800_000_000_000;
function world() {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE engine_turns (turn_id TEXT, agent_id TEXT, state TEXT, started_at INTEGER)");
  d.exec("CREATE TABLE terminal_sessions (terminal_id TEXT, agent_id TEXT, closed_at INTEGER)");
  d.exec("CREATE TABLE terminal_tabs (terminal_id TEXT, kind TEXT, name TEXT, actor TEXT)");
  const db = { all: (sql: string, ...a: unknown[]) => d.prepare(sql).all(...(a as never[])) as unknown[] };
  return { d, db };
}

test("a turn waiting on an approval keeps the workspace awake as a running one does; a finished or 12-hour-old one does not", () => {
  const { d, db } = world();
  assert.equal(workspaceInTurn(db, "agt_p", NOW), false);
  d.prepare("INSERT INTO engine_turns VALUES ('t1', 'agt_p', 'waiting', ?)").run(NOW - 60_000);
  assert.equal(workspaceInTurn(db, "agt_p", NOW), true, "waiting counts");
  d.exec("UPDATE engine_turns SET state = 'completed'");
  assert.equal(workspaceInTurn(db, "agt_p", NOW), false);
  d.prepare("INSERT INTO engine_turns VALUES ('t2', 'agt_p', 'running', ?)").run(NOW - 13 * 3_600_000);
  assert.equal(workspaceInTurn(db, "agt_p", NOW), false, "a stale row does not hold it");
});

test("a crew helper's turn counts for the parent's workspace it has a tab in, not for another's; a closed tab no longer counts", () => {
  const { d, db } = world();
  d.exec("INSERT INTO terminal_sessions VALUES ('trm_h', 'agt_p', NULL)");
  d.exec("INSERT INTO terminal_tabs VALUES ('trm_h', 'helper', 'Researcher', 'agt_helper')");
  d.prepare("INSERT INTO engine_turns VALUES ('t3', 'agt_helper', 'running', ?)").run(NOW - 5_000);
  assert.equal(workspaceInTurn(db, "agt_p", NOW), true, "the helper works in the parent's workspace");
  assert.equal(workspaceInTurn(db, "agt_other", NOW), false);
  d.prepare("UPDATE terminal_sessions SET closed_at = ?").run(NOW);
  assert.equal(workspaceInTurn(db, "agt_p", NOW), false);
});

test("tables it cannot read: unknown (the 90 s wait), never no", () => {
  assert.equal(workspaceInTurn({ all: () => { throw new Error("no such table"); } }, "agt_p", NOW), undefined);
});
