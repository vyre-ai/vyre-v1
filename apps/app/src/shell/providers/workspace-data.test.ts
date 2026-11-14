// The Terminal section's data in the shell: the workspace's state and the attach rule from terminal.workspace (one source), the sessions from the agent's terminal rows, and Attach and Wake as terminal calls.
import test from "node:test";
import assert from "node:assert/strict";
import { workspaceData, workspaceView } from "./workspace-data.ts";
import { terminalsHead } from "../../places/chats/rightpane/work-model.ts";
import type { TerminalRowLike, WorkspaceRead } from "./workspace-data.ts";

const row = (o: Partial<TerminalRowLike> & { terminalId: string; name: string }): TerminalRowLike => ({
  host: "agent_computer",
  agentId: "agt_dex",
  state: "running",
  ...o,
});
const LINE = "Waiting for room on the Space server. Add a compute server in Console > Computers to run more.";
const read = (o: Partial<WorkspaceRead> = {}): WorkspaceRead => ({ state: "running", canAttach: true, ...o });

test("the workspace view takes its state, line and attach rule from terminal.workspace, and its sessions from the agent's live rows", () => {
  const rows = [
    row({ terminalId: "t1", name: "main", by: { kind: "agent" } }),
    row({ terminalId: "t2", name: "tests", by: { kind: "helper", name: "Tess" } }),
    row({ terminalId: "t3", name: "old", state: "exited" }),
    row({ terminalId: "t4", name: "other", agentId: "agt_other" }),
    row({ terminalId: "t5", name: "mine", host: "device" }),
    row({ terminalId: "t6", name: "plain" }),
  ];
  const v = workspaceView("agt_dex", read(), rows, ["Client portal launch"]);
  assert.equal(v.state, "running");
  assert.deepEqual(
    v.sessions.map((s) => [s.name, s.owner]),
    [
      ["main", { kind: "agent" }],
      ["tests", { kind: "helper", name: "Tess" }],
      ["plain", { kind: "agent" }],
    ],
  );
  assert.deepEqual(v.projects, ["Client portal launch"]);
  assert.equal(v.canAttach, true);
});

test("asleep, waiting (with the line), not made yet (asleep: Attach makes it) and no machine to run it (a line to act on, nothing to press)", () => {
  assert.equal(workspaceView("agt_dex", read({ state: "asleep" }), []).state, "asleep");
  assert.deepEqual(workspaceView("agt_dex", read({ state: "waiting", line: LINE }), []), {
    state: "waiting",
    sessions: [],
    canAttach: true,
    line: LINE,
  });
  assert.equal(workspaceView("agt_dex", read({ state: "none" }), []).state, "asleep");
  const gone = workspaceView(
    "agt_dex",
    read({ state: "unavailable", line: "No machine here can run workspaces. Install Docker, or add a server." }),
    [],
  );
  // owner walk, 12 Nov: not a red "Needs attention" but its own quiet state, with the line and nothing to press
  assert.equal(gone.state, "unavailable");
  assert.equal(gone.canAttach, false);
  assert.match(gone.line ?? "", /Install Docker/);
});

test("who may attach is the server's answer, with its sentence", () => {
  const v = workspaceView(
    "agt_dex",
    read({ canAttach: false, cannotAttach: "Only Maya can attach to their Assistant's terminal." }),
    [],
  );
  assert.deepEqual([v.canAttach, v.cannotAttach], [false, "Only Maya can attach to their Assistant's terminal."]);
});

function wire(
  rows: TerminalRowLike[],
  o: {
    fail?: string;
    ws?: WorkspaceRead;
    projects?: Record<string, string>;
    status?: Array<{ terminalId: string; lastLine?: string }>;
  } = {},
) {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const opened: string[] = [];
  let listener: () => void = () => undefined;
  const ticks: Array<() => void> = [];
  const queries: Array<{ id: string; name: string; state: unknown }> = [];
  let workspace = o.ws ?? read({ projects: ["prj_a", "prj_gone"] });
  const screens = {
    query: (id: string, name: string, state: unknown) => {
      queries.push({ id, name, state });
      return {
        subscribe: (l: () => void) => {
          listener = l;
          return () => {
            listener = () => undefined;
          };
        },
        getSnapshot: () => ({ status: "ready", data: { terminals: rows } }),
      };
    },
  };
  const data = workspaceData({
    screens: screens as never,
    newKey: () => "k1",
    openTerminal: (id) => opened.push(id),
    every: (f) => {
      ticks.push(f);
      return () => {
        ticks.splice(ticks.indexOf(f), 1);
      };
    },
    call: async (cap, input) => {
      calls.push({ cap, input: input as Record<string, unknown> });
      if (cap === "terminal.workspace") return workspace;
      if (cap === "projects.get") {
        const t = (o.projects ?? { prj_a: "Client portal launch" })[String((input as { projectId: string }).projectId)];
        if (!t) throw new Error("no such project");
        return { project: { title: t } };
      }
      if (cap === "terminal.status") return { rows: o.status ?? [] };
      if (o.fail) throw new Error(o.fail);
      return { terminal: { terminalId: "t_new" } };
    },
  });
  return {
    data,
    calls,
    opened,
    queries,
    ticks,
    fire: () => listener(),
    rows,
    set: (w: WorkspaceRead) => {
      workspace = w;
    },
  };
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

test("watch reads terminal.workspace and the agent's rows now, on a change of the rows and on each tick; project names, never raw ids; stopping ends it", async () => {
  const w = wire([row({ terminalId: "t1", name: "main" })]);
  const seen: string[] = [];
  const off = w.data.watch("agt_dex", (v) =>
    seen.push(`${v.state}:${v.sessions.length}:${(v.projects ?? []).join("|")}`),
  );
  await flush();
  assert.deepEqual(w.queries, [{ id: "chats.terminal-list", name: "terminals", state: { host: "agent_computer" } }]);
  assert.deepEqual(seen, ["running:1:Client portal launch"], "the project that cannot be read is left out");
  w.rows.length = 0;
  w.set(read({ state: "asleep" }));
  w.fire();
  await flush();
  assert.equal(seen.at(-1), "asleep:0:");
  w.ticks[0]!();
  await flush();
  assert.equal(seen.length, 3);
  off();
  assert.equal(w.ticks.length, 0);
});

test("attach opens the agent's own live session in the terminal tab, and opens one first (waking the workspace) when there is none", async () => {
  const a = wire([
    row({ terminalId: "t_helper", name: "tests", by: { kind: "helper", name: "Tess" } }),
    row({ terminalId: "t_own", name: "main", by: { kind: "agent" } }),
  ]);
  await a.data.attach("agt_dex");
  assert.deepEqual(a.opened, ["t_own"]);
  assert.deepEqual(a.calls, []);
  const b = wire([]);
  await b.data.attach("agt_dex");
  assert.deepEqual(b.calls, [
    { cap: "terminal.open", input: { host: "agent_computer", agentId: "agt_dex", idempotencyKey: "k1" } },
  ]);
  assert.deepEqual(b.opened, ["t_new"]);
});

test("wake opens a session without showing it; a refusal comes back as the server's sentence", async () => {
  const a = wire([]);
  await a.data.wake("agt_dex");
  assert.equal(a.calls[0]?.cap, "terminal.open");
  assert.deepEqual(a.opened, []);
  const b = wire([], { fail: LINE });
  await assert.rejects(() => b.data.attach("agt_dex"), /Waiting for room on the Space server/);
  assert.deepEqual(b.opened, []);
});

test("a workspace kept awake by running work shows what runs in its line (12 Nov, review 6)", () => {
  const v = workspaceView(
    "agt_dex",
    { state: "running", canAttach: true, line: "running: tail -f app.log" } as never,
    [],
  );
  assert.equal(v.line, "running: tail -f app.log");
  assert.deepEqual(terminalsHead(v), { word: "Running", dot: "run" });
});

test("owner walk: a workspace nothing can run is 'Not running' with the line, and nothing to open", async () => {
  const v = workspaceView(
    "agt_dex",
    {
      state: "unavailable",
      canAttach: false,
      line: "This Space can't run agent workspaces yet. That needs Docker on the Space's server, or another server with Docker added in Console > Computers.",
      cannotAttach: "There is no workspace to attach to.",
    } as never,
    [],
  );
  assert.equal(v.state, "unavailable");
  assert.deepEqual(terminalsHead(v), { word: "Not running", dot: "dead" });
  assert.equal(v.canAttach, false, "nothing to open");
});

test("the agent's terminal is opened in the background once when it has none, never twice at the same time, never when it already has one", async () => {
  const a = wire([]);
  await Promise.all([a.data.ensure!("agt_dex"), a.data.ensure!("agt_dex")]);
  assert.equal(a.calls.filter((c) => c.cap === "terminal.open").length, 1, "two panes, one terminal");
  assert.deepEqual(a.opened, [], "no layer opens over the chat");
  const b = wire([row({ terminalId: "t_own", name: "main", by: { kind: "agent" } })]);
  await b.data.ensure!("agt_dex");
  assert.deepEqual(b.calls, [], "it has one");
  const c = wire([], { fail: LINE });
  await assert.rejects(() => c.data.ensure!("agt_dex"), /Waiting for room/);
});

test("a terminal row opens that terminal, and the view carries each row's id, state and folder", () => {
  const a = wire([row({ terminalId: "t_1", name: "main", cwd: "~/portal", state: "idle", by: { kind: "agent" } })]);
  a.data.open!("t_1");
  assert.deepEqual(a.opened, ["t_1"]);
  const v = workspaceView("agt_dex", read(), [
    row({ terminalId: "t_1", name: "main", cwd: "~/portal", state: "idle" }),
  ]);
  assert.deepEqual(
    v.sessions.map((s) => [s.terminalId, s.state, s.cwd]),
    [["t_1", "idle", "~/portal"]],
  );
});

test("a row carries who has the keyboard and what it last printed", () => {
  const v = workspaceView(
    "agt_dex",
    read(),
    [row({ terminalId: "t_1", name: "main", heldBy: "usr_sara" }), row({ terminalId: "t_2", name: "build" })],
    [],
    new Map([["t_1", "$ npm test"]]),
  );
  assert.deepEqual(
    v.sessions.map((s) => [s.terminalId, s.heldBy, s.lastLine]),
    [
      ["t_1", "usr_sara", "$ npm test"],
      ["t_2", undefined, undefined],
    ],
  );
});

test("the last line of each terminal comes from terminal.status after the first paint; the same lines do not paint again", async () => {
  const w = wire([row({ terminalId: "t1", name: "main", cwd: "~/portal" })], {
    status: [{ terminalId: "t1", lastLine: "  ✓ accepts a file (41 ms)  " }],
  });
  const seen: Array<string | undefined> = [];
  const off = w.data.watch("agt_dex", (v) => seen.push(v.sessions[0]?.lastLine));
  await flush();
  await flush();
  assert.deepEqual(seen, [undefined, "✓ accepts a file (41 ms)"], "first paint without it, then the line, trimmed");
  w.ticks[0]!();
  await flush();
  await flush();
  assert.equal(seen.length, 3, "a tick repaints from the workspace read, but the status answer was the same");
  assert.ok(w.calls.some((c) => c.cap === "terminal.status"));
  off();
});
