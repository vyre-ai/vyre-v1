// In a task thread the baton tools are in the agent's list, so it never has to search for the call its turn must end with. Elsewhere they are found with tool_search like any other tool.
import test from "node:test";
import assert from "node:assert/strict";
import { ctx, makeSession, thread } from "../src/tools/harness.ts";

const BATON = ["task_submit", "task_ask", "task_block", "task_review", "task_decide", "tasks_take"];

test("a task thread lists the baton tools; a chat finds them with tool_search", () => {
  const { session } = makeSession();
  const inTask = session.toolsFor(ctx({ thread: thread({ scope: { type: "task", id: "tsk_1" } }) }));
  const listed = new Set(inTask.listed.map((t) => t.name));
  for (const n of BATON) assert.ok(listed.has(n), `${n} is listed in a task thread`);
  const chat = session.toolsFor(ctx({ thread: thread({}) }));
  const chatListed = new Set(chat.listed.map((t) => t.name));
  const chatSearchable = new Set(chat.searchable.map((t) => t.name));
  for (const n of BATON) { assert.ok(!chatListed.has(n), `${n} is not listed in a chat`); assert.ok(chatSearchable.has(n), `${n} is found by tool_search`); }
});

test("an agent that may not use a baton tool does not get it even in a task thread", () => {
  const { session } = makeSession();
  const set = session.toolsFor(ctx({ thread: thread({ scope: { type: "task", id: "tsk_1" } }), rules: { deny: ["task_decide"] } }));
  const names = new Set([...set.listed, ...set.searchable].map((t) => t.name));
  assert.ok(!names.has("task_decide"));
  assert.ok(names.has("task_submit"));
});
