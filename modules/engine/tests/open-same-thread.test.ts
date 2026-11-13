// A thread opened by boot recovery or a control call (control.ts open) is the same thread the bridge opens for a new message: the agent's own model when the chat pins none, its name, how
// and when it answers, whether it runs outside, who leads a task's thread, and that a task, note or goal thread is personal. Before, recovery opened a thinner thread and the bridge's open was
// then refused as "already open", so a restart in the middle of a tool call left every later turn of the chat on no model (release gate, 12 Nov 2026), and lost the rest.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/harness.ts";
import { open } from "../handlers/control.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";

test("control.open builds the thread the bridge would: model from the agent, name, settings, outside, task lead, personal", async () => {
  const h = harness({
    threads: [
      {
        threadId: "thr_task",
        kind: "thread",
        starter: "usr_dana",
        agents: [
          {
            agentId: "agt_doer",
            mode: "listen",
            name: "Doer",
            quiet: true,
            when: "topics",
            topics: ["leases"],
          } as never,
          { agentId: "agt_out", mode: "listen", name: "Outside helper" } as never,
          { agentId: "agt_pin", mode: "listen", name: "Pinned", model: "glm-5" } as never,
          { agentId: "agt_empty", mode: "listen", name: "Empty", model: "" } as never,
        ],
      },
    ],
  });
  const base = h.ctx.call;
  h.ctx.call = async (cap, input) => {
    const i = input as Record<string, unknown>;
    if (cap === "threads.get") {
      const r = (await base(cap, input)) as { thread: Record<string, unknown> };
      return { thread: { ...r.thread, scopeType: "task", scopeId: "tsk_1" } };
    }
    if (cap === "agents.get")
      return {
        agent:
          i["agentId"] === "agt_out"
            ? { runtime: "outside" }
            : { model: i["agentId"] === "agt_doer" ? "deepseek-v4.1-flash" : "kimi-k2" },
      };
    if (cap === "tasks.get") return { task: { assigned: { kind: "agent", id: "agt_doer" }, createdBy: "usr_dana" } };
    return base(cap, input);
  };
  const engine = h.runtime({ openSession: scriptedProvider({ script: [{ type: "done" }] }).openSession });
  await open(h.ctx, "thr_task");
  const by = new Map(engine.agents("thr_task").map((a) => [a.id, a]));
  assert.equal(by.get("agt_doer")?.model, "deepseek-v4.1-flash", "the agent's own model when the chat pins none");
  assert.equal(by.get("agt_doer")?.name, "Doer");
  assert.equal(by.get("agt_doer")?.quiet, true);
  assert.equal(by.get("agt_doer")?.when, "topics");
  assert.equal(by.get("agt_doer")?.taskLead, true, "the agent that works the task leads its thread");
  assert.equal(by.get("agt_out")?.outside, true, "an outside agent stays outside");
  assert.equal(by.get("agt_pin")?.model, "glm-5", "a chat's pin wins");
  assert.equal(by.get("agt_empty")?.model, "kimi-k2", "an empty model is no model");
});
