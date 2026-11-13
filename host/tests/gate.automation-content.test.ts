// The host list of what Automation content may not do without a yes (lib/automation-content.ts), on the Gate hook: held only for an agent, only in a thread whose chain carries an
// Automation-origin mark; a page-read mark, a person's own call and an unmarked thread are as in rc.25; a new task's, helper's or crew job's thread takes the Run's mark (runs-as review pass 3, 4).
import test from "node:test";
import assert from "node:assert/strict";
import { createGateHook } from "../src/daemon/gate-hook.ts";
import { HELD_FROM_AUTOMATION_CONTENT } from "../../lib/automation-content.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

const AUTO = "automation:aut_0123456789abcdef0123456789abcdef:webhook:usr_olivia";
function hook(
  marks: Record<string, string>,
  made: Record<string, number> = { thr_new: 10, thr_help: 10, thr_new2: 10, thr_new3: 10 },
) {
  const calls: Array<[string, unknown]> = [];
  const h = createGateHook({
    call: async (cap, input) => {
      calls.push([cap, input]);
      return { ok: true };
    },
    unseal: () => new Uint8Array(),
    now: () => 0,
    hold: () => null,
    automationMarked: (ids) => {
      for (const id of ids) if (marks[id]?.startsWith("automation:")) return marks[id]!;
      return null;
    },
    madeSince: (id, at) => (made[id] ?? -1) >= at,
    threads: (id) => (id === "thr_child" ? ["thr_child", "thr_run"] : [id]),
  });
  return { h, calls };
}
const cap = (name: string) => ({ name, v: 1, effects: "write" }) as unknown as CapabilityDef;
const agent = (thread?: string) => ({
  space: "spc_core",
  principal: { kind: "agent" as const, id: "agt_desk" },
  actingFor: "usr_olivia",
  ...(thread ? { thread } : {}),
});
const person = (thread: string) => ({
  space: "spc_core",
  principal: { kind: "person" as const, id: "usr_olivia" },
  thread,
});

test("every listed capability is held for an agent in an Automation-marked thread or one under it, and nothing else is", async () => {
  const { h } = hook({ thr_run: AUTO, thr_read: "automations.read_docs" });
  for (const name of HELD_FROM_AUTOMATION_CONTENT) {
    assert.equal(
      await h.fromAutomationContent!(cap(name), agent("thr_run") as never),
      true,
      `${name} held in the Run's thread`,
    );
    assert.equal(
      await h.fromAutomationContent!(cap(name), agent("thr_child") as never),
      true,
      `${name} held in a thread under it`,
    );
    assert.equal(
      await h.fromAutomationContent!(cap(name), agent("thr_read") as never),
      false,
      `${name}: a page-read mark is as in rc.25`,
    );
    assert.equal(
      await h.fromAutomationContent!(cap(name), agent("thr_plain") as never),
      false,
      `${name}: an unmarked chat`,
    );
    assert.equal(
      await h.fromAutomationContent!(cap(name), person("thr_run") as never),
      false,
      `${name}: a person's own call`,
    );
  }
  assert.equal(
    await h.fromAutomationContent!(cap("webhooks.create"), agent() as never),
    false,
    "no thread: not held (recorded risk)",
  );
  assert.equal(
    await h.fromAutomationContent!(cap("records.create"), agent("thr_run") as never),
    false,
    "a plain create is not listed",
  );
  assert.equal(
    await h.fromAutomationContent!(cap("files.move"), agent("thr_run") as never),
    false,
    "moves are not listed (rc.27 risk)",
  );
});

test("a task, helper or crew job the Run's agent starts gets the Run's mark; from a page-read or unmarked chat, nothing is marked", async () => {
  const { h, calls } = hook({ thr_run: AUTO, thr_read: "automations.read_docs" });
  await h.seen!(cap("tasks.create"), {}, { task: { id: "tsk_1", threadId: "thr_new" } }, agent("thr_run") as never, 5);
  await h.seen!(cap("chat.helper.start"), {}, { helper: { threadId: "thr_help" } }, agent("thr_run") as never, 5);
  assert.deepEqual(
    calls.filter(([c]) => c === "gate.taint.mark").map(([, i]) => i),
    [
      { threads: ["thr_new"], source: AUTO },
      { threads: ["thr_help"], source: AUTO },
    ],
  );
  calls.length = 0;
  await h.seen!(cap("tasks.create"), {}, { task: { threadId: "thr_new2" } }, agent("thr_read") as never, 5);
  await h.seen!(cap("tasks.create"), {}, { task: { threadId: "thr_new3" } }, agent("thr_plain") as never, 5);
  assert.deepEqual(
    calls.filter(([c]) => c === "gate.taint.mark"),
    [],
  );
});

test("a read that names threads never marks them, and a creating call marks only the thread it made, not one it names that existed before (pass 4b)", async () => {
  const { h, calls } = hook({ thr_run: AUTO }, { thr_made: 10, thr_old: 1 });
  await h.seen!(
    { name: "tasks.list", v: 1, effects: "read" } as unknown as CapabilityDef,
    {},
    { tasks: [{ threadId: "thr_old" }, { threadId: "thr_made" }] },
    agent("thr_run") as never,
    5,
  );
  await h.seen!(
    { name: "chat.search", v: 1, effects: "read" } as unknown as CapabilityDef,
    {},
    { hits: [{ threadId: "thr_old" }] },
    agent("thr_run") as never,
    5,
  );
  assert.deepEqual(
    calls.filter(([c]) => c === "gate.taint.mark"),
    [],
    "reads mark nothing",
  );
  await h.seen!(
    cap("tasks.plan"),
    {},
    { tasks: [{ threadId: "thr_old" }, { threadId: "thr_made" }] },
    agent("thr_run") as never,
    5,
  );
  assert.deepEqual(
    calls.filter(([c]) => c === "gate.taint.mark").map(([, i]) => i),
    [{ threads: ["thr_made"], source: AUTO }],
    "only the thread this call made",
  );
});

test("a crew started in a marked Run is marked: engine.crew.start returns the crew's new thread (job.threadId, made by its nested helper start during the call) beside the lead's existing one, and only the new one is marked (pass 4c)", async () => {
  const { h, calls } = hook({ thr_run: AUTO }, { thr_crew: 10, thr_lead: 1 });
  await h.seen!(
    cap("engine.crew.start"),
    {},
    { job: { jobId: "crw_1", threadId: "thr_crew", leadThreadId: "thr_lead", agentId: "agt_mate" } },
    agent("thr_run") as never,
    5,
  );
  assert.deepEqual(
    calls.filter(([c]) => c === "gate.taint.mark").map(([, i]) => i),
    [{ threads: ["thr_crew"], source: AUTO }],
  );
});
