import test from "node:test";
import assert from "node:assert/strict";
import { connectionNeedsYou, connectionWorks } from "./needs-you.ts";

const to = { kind: "role" as const, id: "admin" };

test("opens one task for a connection and keeps it on the next failure", async () => {
  const calls: string[] = [];
  let open: unknown[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push(cap);
    if (cap === "tasks.list") return { tasks: open };
    if (cap === "tasks.create") {
      open = [{ id: "tsk_1", state: "todo", source: (input as { source: unknown }).source }];
      return { task: open[0] };
    }
    return {};
  };
  await connectionNeedsYou(call, { id: "con_1", title: "Replace the key", to });
  await connectionNeedsYou(call, { id: "con_1", title: "Replace the key", to });
  assert.equal(calls.filter((c) => c === "tasks.create").length, 1);
});

test("closes it when the connection works again, and never throws", async () => {
  const sent: Array<[string, unknown]> = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    sent.push([cap, input]);
    if (cap === "tasks.list")
      return {
        tasks: [
          { id: "tsk_9", state: "todo", source: { kind: "manual", id: "connection:con_2" } },
          { id: "tsk_8", state: "todo", source: { kind: "manual", id: "connection:con_3" } },
        ],
      };
    return {};
  };
  await connectionWorks(call, "con_2");
  assert.deepEqual(
    sent.filter(([c]) => c === "tasks.transition").map(([, i]) => (i as { taskId: string }).taskId),
    ["tsk_9"],
  );
  await connectionWorks(async () => {
    throw new Error("no");
  }, "con_2");
  await connectionNeedsYou(
    async () => {
      throw new Error("no");
    },
    { id: "con_2", title: "x", to },
  );
});

test("a routine's refusal opens one plain line for its owner, naming the agent and no tool, key or code", async () => {
  const { agentRefusedNeedsYou } = await import("./needs-you.ts");
  const made: Array<Record<string, unknown>> = [];
  let open: unknown[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    if (cap === "tasks.list") return { tasks: open };
    if (cap === "tasks.create") {
      made.push(input as Record<string, unknown>);
      open = [{ id: "tsk_1", state: "todo", source: (input as { source: unknown }).source }];
      return { task: open[0] };
    }
    return {};
  };
  const n = { agentId: "agt_dex", agentName: "Dex", asker: "usr_dana", tool: "vault_use" };
  await agentRefusedNeedsYou(call, n);
  await agentRefusedNeedsYou(call, n);
  assert.equal(made.length, 1, "once, however many runs");
  const t = made[0] as { title: string; summary: string; assigned: unknown };
  assert.deepEqual(t.assigned, { kind: "person", id: "usr_dana" });
  assert.match(t.title, /Dex/);
  assert.ok(!/vault_use|above_clearance|permission\.|agt_/.test(`${t.title} ${t.summary}`), "no tool, code or id");
});
