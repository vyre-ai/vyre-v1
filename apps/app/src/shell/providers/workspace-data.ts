// The agent's workspace for the Computer tab's Terminal section (6 Nov design), read from the terminal replica and driven with terminal calls. Sessions are the agent's terminal rows (host
// agent_computer); `by` says whose each tab is. The workspace has no state of its own on the wire: it is Running while a session of it is alive and Asleep otherwise (it sleeps when idle and wakes on the
// next command, which is what Attach and Wake do by opening a session). A refusal on open, such as no room, comes back as the sentence the server sent.
import type { ScreenHooks } from "../../../../../client/src/index.ts";
import type { WorkspaceData, WorkspaceSession, WorkspaceView } from "../../places/chats/rightpane/work-model.ts";

export interface TerminalRowLike {
  terminalId: string; name: string; host: string; agentId?: string | undefined; state: "running" | "idle" | "exited"; lastActiveAt?: number | undefined;
  by?: { kind: "agent" | "helper" | "person"; name?: string | undefined } | undefined;
}

/** May this person attach to this agent's workspace, and if not, the one sentence why. Own Assistant and own agents: yes. An agent of the Space (no owner): owners and admins. */
export function attachRule(a: { agentId: string; me: string; ownerOf(id: string): string | undefined; nameOf(id: string): string; manage: boolean }): { canAttach: boolean; cannotAttach?: string } {
  const owner = a.ownerOf(a.agentId);
  if (owner === a.me) return { canAttach: true };
  if (owner === undefined) return a.manage ? { canAttach: true } : { canAttach: false, cannotAttach: "A team agent's terminal is for owners and admins." };
  return { canAttach: false, cannotAttach: `Only ${a.nameOf(owner)} can attach to their Assistant's terminal.` };
}

/** The workspace as the pane draws it, from the agent's live terminal rows. */
export function workspaceView(agentId: string, rows: readonly TerminalRowLike[], rule: { canAttach: boolean; cannotAttach?: string }): WorkspaceView {
  const mine = rows.filter((r) => r.agentId === agentId && r.host === "agent_computer" && r.state !== "exited");
  const sessions: WorkspaceSession[] = mine.map((r) => ({ name: r.name, owner: r.by ?? { kind: "agent" }, ...(r.lastActiveAt !== undefined ? { lastActiveAt: r.lastActiveAt } : {}) }));
  return { state: mine.length > 0 ? "running" : "asleep", sessions, canAttach: rule.canAttach, ...(rule.cannotAttach ? { cannotAttach: rule.cannotAttach } : {}) };
}

const sentence = (e: unknown): string => (e instanceof Error && e.message ? e.message : "That did not work. Try again.");

export function workspaceData(d: {
  screens: ScreenHooks; call(cap: string, input: unknown): Promise<unknown>; newKey(): string;
  me: string; ownerOf(id: string): string | undefined; nameOf(id: string): string; manage(): boolean;
  openTerminal(terminalId: string): void;
}): WorkspaceData {
  const rule = (agentId: string): { canAttach: boolean; cannotAttach?: string } => attachRule({ agentId, me: d.me, ownerOf: d.ownerOf, nameOf: d.nameOf, manage: d.manage() });
  const open = async (agentId: string): Promise<string> => {
    try { return ((await d.call("terminal.open", { host: "agent_computer", agentId, idempotencyKey: d.newKey() })) as { terminal: { terminalId: string } }).terminal.terminalId; } catch (e) { throw new Error(sentence(e)); }
  };
  return {
    watch(agentId, on) {
      const q = d.screens.query("chats.terminal-list", "terminals", { host: "agent_computer" }) as { subscribe(l: () => void): () => void; getSnapshot(): { status: string; data?: { terminals: readonly TerminalRowLike[] } } };
      const push = (): void => { const s = q.getSnapshot(); if (s.status === "ready" && s.data) on(workspaceView(agentId, s.data.terminals, rule(agentId))); };
      const off = q.subscribe(push);
      push();
      return off;
    },
    async wake(agentId) { await open(agentId); },
    async attach(agentId) {
      const q = d.screens.query("chats.terminal-list", "terminals", { host: "agent_computer" }) as { getSnapshot(): { status: string; data?: { terminals: readonly TerminalRowLike[] } } };
      const s = q.getSnapshot();
      const own = s.status === "ready" && s.data ? s.data.terminals.find((r) => r.agentId === agentId && r.host === "agent_computer" && r.state !== "exited" && (!r.by || r.by.kind === "agent")) : undefined;
      d.openTerminal(own ? own.terminalId : await open(agentId));
    },
  };
}
