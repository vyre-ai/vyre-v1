// The Computer tab in the workspace model (6 Nov design): a Terminal section (the agent's workspace) and a Browser section (the agent's profile in the Space browser). No "give it a computer"
// step: every agent and every person's Assistant has a workspace, and its browser profile opens when it first browses. This file is the logic and the two interfaces the lanes fill; the pane
// that draws them is WorkSections.tsx. Nothing here reads the replica or a capability, so the tests drive every rule directly.
//   WorkspaceData is filled by l-ws (the workspace and its tmux terminal), BrowserData by l-sbrowser (the Space browser profile, its live view and takeover). Until a lane binds its half in
//   ChatRightPaneData (`workspace`, `browser`), its section says so in one line, and a pane with neither keeps drawing the single-computer Computer tab as before.
import type { ReactElement } from "react";

// ---- Terminal: the agent's workspace

/** unavailable: nothing in this Space can run a workspace now (no Docker, no server): a plain line on what would, never an Attach that cannot work. */
export type WorkspaceState = "running" | "asleep" | "starting" | "waiting" | "error" | "unavailable";
/** Who a terminal session belongs to: the agent itself, a helper it started (by name), or a person who attached. */
export interface SessionOwner {
  kind: "agent" | "helper" | "person";
  name?: string;
}
export interface WorkspaceSession {
  name: string;
  /** the terminal's id, so a row can open it */ terminalId?: string;
  /** running a command, waiting at a prompt, or ended */ state?: "running" | "idle" | "exited";
  /** where it is, as the terminal says it: "~/portal" */ cwd?: string;
  /** the person at its keyboard now, by id */ heldBy?: string;
  /** the person whose own tab it is, by id */ ownerId?: string;
  /** what it last printed, one line (terminal.status) */ lastLine?: string;
  owner?: SessionOwner;
  /** left out when the host does not say */ windows?: number;
  /** people attached right now; left out when not known */ attached?: number;
  lastActiveAt?: number;
}
export interface WorkspaceView {
  state: WorkspaceState;
  /** Where it runs: "the Space server", or a compute server's name. */
  host?: string;
  /** Waiting: "Waiting for room on <host>. The workspace starts by itself when there is room." Error: the reason, in words. */
  line?: string;
  /** The tmux sessions the agent and attached people share. */
  sessions: readonly WorkspaceSession[];
  /** The folders it has beside its own: the projects it is on. */
  projects?: readonly string[];
  /** May this person attach? A person for their own Assistant's workspace; an owner or admin for a team agent's. */
  canAttach: boolean;
  /** Why not, as one sentence, when canAttach is false. */
  cannotAttach?: string;
}
export interface WorkspaceData {
  /** Live read of the agent's workspace; calls `on` with each change and once at the start. Returns the unsubscribe. */
  watch(agentId: string, on: (v: WorkspaceView) => void): () => void;
  /** Start it when it sleeps. Resolves when it runs; rejects with a sentence. */
  wake(agentId: string): Promise<void>;
  /** Attach the person's Terminal tab to its tmux sessions (the same sessions the agent uses). Wakes it first. Rejects with a sentence. */
  attach(agentId: string): Promise<void>;
  /** The agent's own terminal is open before anyone asks (13 Nov: nobody presses Attach). Never wakes the computer for a person who may not enter it; resolves with the terminal's id when it is there. */
  ensure?(agentId: string): Promise<string>;
  /** Open one terminal full screen. */
  open?(terminalId: string): void;
}

// ---- Browser: the agent's profile in the Space browser

export type BrowserState = "closed" | "starting" | "open" | "takeover" | "waiting" | "error";
export interface BrowserSite {
  site: string;
  signedInAs?: string;
  since: number;
}
export interface BrowserView {
  state: BrowserState;
  host?: string;
  tabs?: number;
  /** What it is doing now, while open. */
  caption?: string;
  /** Waiting: the room line. Error: the reason. */
  line?: string;
  /** When it last worked, for "Last seen 2:32 PM" while it sleeps. */
  lastActiveAt?: number;
  /** Takeover: who has the controls, by name; `mine` when it is the person looking. */
  takenBy?: string;
  mine?: boolean;
  /** May this person see its live view and take over? Owner and admin for a team agent; the owner alone for a personal agent. */
  canTakeOver: boolean;
  cannotTakeOver?: string;
  /** The logins its profile keeps. */
  sites: readonly BrowserSite[];
}
export interface BrowserData {
  watch(agentId: string, on: (v: BrowserView) => void): () => void;
  /** Open its profile (it also opens by itself when the agent browses). */
  open(agentId: string): Promise<void>;
  takeOver(agentId: string): Promise<void>;
  giveBack(agentId: string): Promise<void>;
  signOut(agentId: string, site: string): Promise<void>;
  /** The live view, drawn by the Space browser (Chrome's screencast and input). Absent: a picture of a browser window stands in. */
  renderLive?(agentId: string, o: { state: BrowserState; control: boolean }): ReactElement;
}

/** "Dex", "helper: Tess", "Maya": the owner of a session in words, the agent's own name when it is the agent. */
export function ownerLabel(o: SessionOwner | undefined, agentName: string): string {
  if (!o || o.kind === "agent") return agentName;
  if (o.kind === "helper") return `helper: ${o.name ?? "a helper"}`;
  return o.name ?? "a person";
}
/** The agent's own sessions first, then helpers, then people; each group keeps its order. */
export function orderSessions(list: readonly WorkspaceSession[]): WorkspaceSession[] {
  const rank = (s: WorkspaceSession): number =>
    !s.owner || s.owner.kind === "agent" ? 0 : s.owner.kind === "helper" ? 1 : 2;
  return list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .map((x) => x.s);
}
/** When both sections wait for the same reason the line is said once, above them. Null otherwise. */
export function sharedWait(
  w: { state: string; line?: string } | undefined,
  b: { state: string; line?: string } | undefined,
): string | null {
  if (!w || !b || w.state !== "waiting" || b.state !== "waiting") return null;
  const a = workspaceWordsLine(w.line),
    c = workspaceWordsLine(b.line);
  return a === c ? a : null;
}
const DEFAULT_WAIT = "Waiting for room on the Space server. Add a compute server in Console > Computers to run more.";
const workspaceWordsLine = (l: string | undefined): string => l ?? DEFAULT_WAIT;

/** The row's menu: Remove is an owner's or admin's and lives in Console > Computers, so only they, and only where the pane can open the Console, are offered it. */
export function olderDesktopMenu(a: {
  canRemove: boolean;
  open?: (() => void) | undefined;
}): Array<{ label: string; danger: true; onSelect: () => void }> {
  return a.canRemove && a.open ? [{ label: "Remove in Console > Computers", danger: true, onSelect: a.open }] : [];
}

// ---- the Computer tab as drawn (AGENT-COMPUTER-2026-11-13.md part A): a dot and a word, never a pill or a paragraph

export type Dot = "run" | "wait" | "idle" | "zz" | "dead";
/** The Terminals head: one dot and one state word. */
export function terminalsHead(v: WorkspaceView): { word: string; dot: Dot } {
  switch (v.state) {
    case "running":
      return v.line !== undefined || v.sessions.some((s) => s.state === "running")
        ? { word: "Running", dot: "run" }
        : { word: "Ready", dot: "idle" };
    case "asleep":
      return { word: "Asleep", dot: "zz" };
    case "starting":
      return { word: "Starting", dot: "wait" };
    case "waiting":
      return { word: "Waiting", dot: "wait" };
    case "error":
    case "unavailable":
      return { word: "Not running", dot: "dead" };
  }
}
/** One terminal row: its dot and the state word at the right ("running", "idle", "Ended", "Asleep"). */
export function sessionWords(
  s: WorkspaceSession,
  computerAsleep: boolean,
  keyboard?: { me?: string | undefined; nameOf?: ((id: string) => string) | undefined },
): { word: string; dot: Dot } {
  if (s.state === "exited") return { word: "Ended", dot: "dead" };
  if (s.heldBy !== undefined && !computerAsleep)
    return {
      word:
        s.heldBy === keyboard?.me
          ? "You have the keyboard"
          : `${keyboard?.nameOf?.(s.heldBy) ?? "Someone"} has the keyboard`,
      dot: "wait",
    };
  if (computerAsleep) return { word: "Asleep", dot: "zz" };
  return s.state === "running" ? { word: "Running", dot: "run" } : { word: "Idle", dot: "idle" };
}
export interface SessionGroup {
  key: string;
  /** the owner's name: the agent's own, a helper's, a person's */ name: string;
  kind: "agent" | "helper" | "person";
  /** the quiet word after the name */ tag?: string;
  rows: WorkspaceSession[];
}
/** The terminals grouped by whose they are: the agent, then each helper, then each person. */
export function groupSessions(
  list: readonly WorkspaceSession[],
  agentName: string,
  who: { me?: string | undefined; nameOf?: ((id: string) => string) | undefined } = {},
): SessionGroup[] {
  const out: SessionGroup[] = [];
  for (const s of orderSessions(list)) {
    const o = s.owner;
    const kind = !o || o.kind === "agent" ? "agent" : o.kind;
    // a person's own tab is named for the person: "You" to themselves, their name to everyone else, never a generic
    const person =
      s.ownerId !== undefined
        ? s.ownerId === who.me
          ? "You"
          : (who.nameOf?.(s.ownerId) ?? o?.name ?? "Someone")
        : (o?.name ?? "Someone");
    const name = kind === "agent" ? agentName : kind === "person" ? person : (o?.name ?? "A helper");
    const key = `${kind}:${name}`;
    let g = out.find((x) => x.key === key);
    if (!g) {
      g = {
        key,
        name,
        kind,
        ...(kind === "helper" ? { tag: "helper" } : kind === "person" ? { tag: "own tab" } : {}),
        rows: [],
      };
      out.push(g);
    }
    g.rows.push(s);
  }
  return out;
}
/** The browser head word and dot. */
export function browserHead(v: BrowserView): { word: string; dot: Dot } {
  switch (v.state) {
    case "open":
    case "takeover":
      return { word: "Live", dot: "run" };
    case "starting":
      return { word: "Starting", dot: "wait" };
    case "waiting":
      return { word: "Waiting", dot: "wait" };
    case "error":
      return { word: "Stopped", dot: "dead" };
    case "closed":
      return { word: "Asleep", dot: "zz" };
  }
}

/** The stage words of a start, by how long it has taken against its budget. */
export function startStage(elapsedMs: number, budgetMs = 9000): string {
  return elapsedMs < budgetMs * 0.4
    ? "Making the computer"
    : elapsedMs < budgetMs * 0.8
      ? "Opening the browser"
      : "Almost ready";
}
