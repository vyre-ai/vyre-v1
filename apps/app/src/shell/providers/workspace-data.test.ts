// The Terminal section's data in the shell: who may attach, what the agent's terminal rows say about its workspace, and Attach and Wake as terminal calls.
import test from "node:test";
import assert from "node:assert/strict";
import { attachRule, workspaceData, workspaceView } from "./workspace-data.ts";
import type { TerminalRowLike } from "./workspace-data.ts";

const row = (o: Partial<TerminalRowLike> & { terminalId: string; name: string }): TerminalRowLike => ({ host: "agent_computer", agentId: "agt_dex", state: "running", ...o });
const names: Record<string, string> = { usr_maya: "Maya", usr_me: "Irfad" };
const base = { agentId: "agt_dex", me: "usr_me", nameOf: (id: string) => names[id] ?? id, manage: false };

test("attach rule: my own Assistant and agents yes; a team agent for owners and admins; someone else's Assistant never", () => {
  assert.deepEqual(attachRule({ ...base, ownerOf: () => "usr_me" }), { canAttach: true });
  assert.deepEqual(attachRule({ ...base, ownerOf: () => undefined, manage: true }), { canAttach: true });
  assert.deepEqual(attachRule({ ...base, ownerOf: () => undefined }), { canAttach: false, cannotAttach: "A team agent's terminal is for owners and admins." });
  assert.deepEqual(attachRule({ ...base, ownerOf: () => "usr_maya", manage: true }), { canAttach: false, cannotAttach: "Only Maya can attach to their Assistant's terminal." });
});

test("the workspace is Running while one of the agent's sessions is alive, Asleep otherwise; sessions carry whose tab they are, and other agents' and exited ones are left out", () => {
  const rows = [
    row({ terminalId: "t1", name: "main", by: { kind: "agent" } }), row({ terminalId: "t2", name: "tests", by: { kind: "helper", name: "Tess" } }), row({ terminalId: "t3", name: "old", state: "exited" }),
    row({ terminalId: "t4", name: "other", agentId: "agt_other" }), row({ terminalId: "t5", name: "mine", host: "device" }), row({ terminalId: "t6", name: "plain" }),
  ];
  const v = workspaceView("agt_dex", rows, { canAttach: true });
  assert.equal(v.state, "running");
  assert.deepEqual(v.sessions.map((s) => [s.name, s.owner]), [["main", { kind: "agent" }], ["tests", { kind: "helper", name: "Tess" }], ["plain", { kind: "agent" }]]);
  assert.equal(workspaceView("agt_dex", [row({ terminalId: "t3", name: "old", state: "exited" })], { canAttach: true }).state, "asleep");
  assert.deepEqual(workspaceView("agt_dex", [], { canAttach: false, cannotAttach: "No." }), { state: "asleep", sessions: [], canAttach: false, cannotAttach: "No." });
});

function wire(rows: TerminalRowLike[], over: { fail?: string } = {}) {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const opened: string[] = [];
  let listener: () => void = () => undefined;
  const queries: Array<{ id: string; name: string; state: unknown }> = [];
  const screens = { query: (id: string, name: string, state: unknown) => { queries.push({ id, name, state }); return { subscribe: (l: () => void) => { listener = l; return () => { listener = () => undefined; }; }, getSnapshot: () => ({ status: "ready", data: { terminals: rows } }) }; } };
  const data = workspaceData({
    screens: screens as never, call: async (cap, input) => { calls.push({ cap, input: input as Record<string, unknown> }); if (over.fail) throw new Error(over.fail); return { terminal: { terminalId: "t_new" } }; }, newKey: () => "k1",
    me: "usr_me", ownerOf: () => "usr_me", nameOf: (id) => id, manage: () => false, openTerminal: (id) => opened.push(id),
  });
  return { data, calls, opened, queries, fire: () => listener(), rows };
}

test("watch reads the agent's terminal rows now and on each change, and stops when told", () => {
  const w = wire([row({ terminalId: "t1", name: "main" })]);
  const seen: string[] = [];
  const off = w.data.watch("agt_dex", (v) => seen.push(`${v.state}:${v.sessions.length}`));
  assert.deepEqual(w.queries, [{ id: "chats.terminal-list", name: "terminals", state: { host: "agent_computer" } }]);
  w.rows.length = 0;
  w.fire();
  assert.deepEqual(seen, ["running:1", "asleep:0"]);
  off();
});

test("attach opens the agent's own live session in the terminal tab, and opens one first (waking the workspace) when there is none", async () => {
  const a = wire([row({ terminalId: "t_helper", name: "tests", by: { kind: "helper", name: "Tess" } }), row({ terminalId: "t_own", name: "main", by: { kind: "agent" } })]);
  await a.data.attach("agt_dex");
  assert.deepEqual(a.opened, ["t_own"]);
  assert.deepEqual(a.calls, []);
  const b = wire([]);
  await b.data.attach("agt_dex");
  assert.deepEqual(b.calls, [{ cap: "terminal.open", input: { host: "agent_computer", agentId: "agt_dex", idempotencyKey: "k1" } }]);
  assert.deepEqual(b.opened, ["t_new"]);
});

test("wake opens a session without showing it; a refusal comes back as the server's sentence", async () => {
  const a = wire([]);
  await a.data.wake("agt_dex");
  assert.equal(a.calls[0]?.cap, "terminal.open");
  assert.deepEqual(a.opened, []);
  const b = wire([], { fail: "Waiting for room on the Space server. Add a compute server in Console > Computers to run more." });
  await assert.rejects(() => b.data.attach("agt_dex"), /Waiting for room on the Space server/);
  assert.deepEqual(b.opened, []);
});
