// The agent's workspace for the Computer tab's Terminal section (6 Nov design), read from the terminal replica and driven with terminal calls. Sessions are the agent's terminal rows (host
// agent_computer); `by` says whose each tab is. The workspace has no state of its own on the wire: it is Running while a session of it is alive and Asleep otherwise (it sleeps when idle and wakes on the
// next command, which is what Attach and Wake do by opening a session). A refusal on open, such as no room, comes back as the sentence the server sent.
import type { ScreenHooks } from "../../../../../client/src/index.ts";
import type { WorkspaceData, WorkspaceSession, WorkspaceView } from "../../places/chats/rightpane/work-model.ts";

export interface TerminalRowLike {
  terminalId: string; name: string; host: string; agentId?: string | undefined; state: "running" | "idle" | "exited"; lastActiveAt?: number | undefined;
  by?: { kind: "agent" | "helper" | "person"; name?: string | undefined } | undefined;
}

/** What terminal.workspace says (never wakes anything): the workspace's state, where it runs, the project folders it mounts, and whether this person may attach and why not. One source for the rule. */
export interface WorkspaceRead {
  state: "running" | "asleep" | "waiting" | "none" | "unavailable"; line?: string | undefined; host?: "space" | "server" | undefined; nodeId?: string | undefined;
  projects?: readonly string[] | undefined; canAttach: boolean; cannotAttach?: string | undefined;
}

/**
 * The workspace as the pane draws it: its state from terminal.workspace, its sessions from the agent's live terminal rows. A workspace not made yet (none) is Asleep: it is made and woken by the first
 * Attach. One with no machine to run it (unavailable) is a line the person can act on.
 */
export function workspaceView(agentId: string, read: WorkspaceRead, rows: readonly TerminalRowLike[], projectNames: readonly string[] = []): WorkspaceView {
  const mine = rows.filter((r) => r.agentId === agentId && r.host === "agent_computer" && r.state !== "exited");
  const sessions: WorkspaceSession[] = mine.map((r) => ({ name: r.name, owner: r.by ?? { kind: "agent" }, ...(r.lastActiveAt !== undefined ? { lastActiveAt: r.lastActiveAt } : {}) }));
  const state = read.state === "unavailable" ? "error" : read.state === "none" ? "asleep" : read.state;
  return {
    state, sessions, canAttach: read.canAttach && read.state !== "unavailable",
    ...(read.state === "waiting" || read.state === "unavailable" ? (read.line ? { line: read.line } : {}) : {}),
    ...(read.cannotAttach ? { cannotAttach: read.cannotAttach } : read.state === "unavailable" && read.line ? { cannotAttach: read.line } : {}),
    ...(projectNames.length > 0 ? { projects: projectNames } : {}),
  };
}

const sentence = (e: unknown): string => (e instanceof Error && e.message ? e.message : "That did not work. Try again.");

const POLL_MS = 5000;

export function workspaceData(d: {
  screens: ScreenHooks; call(cap: string, input: unknown): Promise<unknown>; newKey(): string; openTerminal(terminalId: string): void;
  every?(f: () => void, ms: number): () => void;
}): WorkspaceData {
  const every = d.every ?? ((f, ms) => { const t = setInterval(f, ms); return () => clearInterval(t); });
  const names = new Map<string, string>();
  const nameOfProject = async (id: string): Promise<string | null> => {
    const known = names.get(id);
    if (known !== undefined) return known;
    try { const n = ((await d.call("projects.get", { projectId: id })) as { project?: { title?: string; name?: string } }).project; const v = n?.title ?? n?.name; if (v) { names.set(id, v); return v; } } catch { /* left out: never a raw id */ }
    return null;
  };
  const open = async (agentId: string): Promise<string> => {
    try { return ((await d.call("terminal.open", { host: "agent_computer", agentId, idempotencyKey: d.newKey() })) as { terminal: { terminalId: string } }).terminal.terminalId; } catch (e) { throw new Error(sentence(e)); }
  };
  type Rows = { getSnapshot(): { status: string; data?: { terminals: readonly TerminalRowLike[] } }; subscribe(l: () => void): () => void };
  const rowsQuery = (): Rows => d.screens.query("chats.terminal-list", "terminals", { host: "agent_computer" }) as unknown as Rows;
  return {
    watch(agentId, on) {
      const q = rowsQuery();
      let live = true;
      let seq = 0;
      let shown = false;
      const push = (): void => {
        const mine = ++seq;
        void (async () => {
          const read = (await d.call("terminal.workspace", { agentId })) as WorkspaceRead;
          const snap = q.getSnapshot();
          const rows = snap.status === "ready" && snap.data ? snap.data.terminals : [];
          const projects = (await Promise.all((read.projects ?? []).map(nameOfProject))).filter((x): x is string => x !== null);
          if (live && mine === seq) { shown = true; on(workspaceView(agentId, read, rows, projects)); }
        })().catch((e: unknown) => {
          // never a placeholder that does not fill: until a first answer comes, the refusal is the line (the next poll replaces it)
          if (live && mine === seq && !shown) on({ state: "error", sessions: [], canAttach: false, line: sentence(e) });
        });
      };
      const off = q.subscribe(push);
      const stop = every(push, POLL_MS);
      push();
      return () => { live = false; off(); stop(); };
    },
    async wake(agentId) { await open(agentId); },
    async attach(agentId) {
      const s = rowsQuery().getSnapshot();
      const own = s.status === "ready" && s.data ? s.data.terminals.find((r) => r.agentId === agentId && r.host === "agent_computer" && r.state !== "exited" && (!r.by || r.by.kind === "agent")) : undefined;
      d.openTerminal(own ? own.terminalId : await open(agentId));
    },
  };
}
