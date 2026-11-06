// The Computer tab in the workspace model (6 Nov design): a Terminal section (the agent's workspace) and a Browser section (the agent's profile in the Space browser). No "give it a computer"
// step: every agent and every person's Assistant has a workspace, and its browser profile opens when it first browses. This file is the logic and the two interfaces the lanes fill; the pane
// that draws them is WorkSections.tsx. Nothing here reads the replica or a capability, so the tests drive every rule directly.
//   WorkspaceData is filled by l-ws (the workspace and its tmux terminal), BrowserData by l-sbrowser (the Space browser profile, its live view and takeover). Until a lane binds its half in
//   ChatRightPaneData (`workspace`, `browser`), its section says so in one line, and a pane with neither keeps drawing the single-computer Computer tab as before.
import type { ReactElement } from "react";

// ---- Terminal: the agent's workspace

export type WorkspaceState = "running" | "asleep" | "starting" | "waiting" | "error";
export interface WorkspaceSession { name: string; windows: number; /** people attached right now */ attached: number; lastActiveAt?: number }
export interface WorkspaceView {
  state: WorkspaceState;
  /** Where it runs: "the Space server", or a compute server's name. */
  host?: string;
  /** Waiting: "Waiting for room on <host>. Add a compute server in Console > Computers to run more." Error: the reason, in words. */
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
}

// ---- Browser: the agent's profile in the Space browser

export type BrowserState = "closed" | "starting" | "open" | "takeover" | "waiting" | "error";
export interface BrowserSite { site: string; signedInAs?: string; since: number }
export interface BrowserView {
  state: BrowserState;
  host?: string;
  tabs?: number;
  /** What it is doing now, while open. */
  caption?: string;
  /** Waiting: the room line. Error: the reason. */
  line?: string;
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

// ---- the words

export type Tone = "ok" | "quiet" | "warn" | "bad" | "mine";
export interface Words { chip: string; tone: Tone; /** the one line under the chip, when there is one */ note?: string }

export function workspaceWords(v: WorkspaceView): Words {
  switch (v.state) {
    case "running": return v.sessions.length === 0 ? { chip: "Running", tone: "ok", note: "No session open yet. A command starts one." } : { chip: "Running", tone: "ok" };
    case "asleep": return { chip: "Asleep", tone: "quiet", note: "Wakes in about a second on the next command." };
    case "starting": return { chip: "Starting", tone: "quiet" };
    case "waiting": return { chip: "Waiting for room", tone: "warn", note: v.line ?? "Waiting for room on the Space server. Add a compute server in Console > Computers to run more." };
    case "error": return { chip: "Needs attention", tone: "bad", note: v.line ?? "The workspace could not start." };
  }
}

export function browserWords(v: BrowserView): Words {
  switch (v.state) {
    case "closed": return { chip: "Closed", tone: "quiet", note: "Opens when it browses." };
    case "starting": return { chip: "Starting", tone: "quiet" };
    case "open": return { chip: v.tabs === undefined ? "Open" : `Open · ${v.tabs} ${v.tabs === 1 ? "tab" : "tabs"}`, tone: "ok", ...(v.caption ? { note: v.caption } : {}) };
    case "takeover": return v.mine ? { chip: "You're in control", tone: "mine" } : { chip: `${v.takenBy ?? "Someone"} is in control`, tone: "mine" };
    case "waiting": return { chip: "Waiting for room", tone: "warn", note: v.line ?? "Waiting for room on the Space server. Add a compute server in Console > Computers to run more." };
    case "error": return { chip: "Needs attention", tone: "bad", note: v.line ?? "The browser could not open." };
  }
}

/** The one button the Terminal section offers: Attach when the person may and the workspace is usable (it wakes on attach), nothing while it waits or failed. */
export function terminalAction(v: WorkspaceView): "attach" | null {
  if (!v.canAttach) return null;
  return v.state === "running" || v.state === "asleep" ? "attach" : null;
}

/** What the Browser section offers: Give back to the person at the controls, Take over to a permitted person while it is open or closed (taking over opens it), nothing otherwise. */
export function browserAction(v: BrowserView): "take" | "give" | null {
  if (v.state === "takeover") return v.mine ? "give" : null;
  if (!v.canTakeOver) return null;
  return v.state === "open" || v.state === "closed" ? "take" : null;
}

/** "2 sessions", "1 session". */
export const sessionsLine = (n: number): string => `${n} ${n === 1 ? "session" : "sessions"}`;
/** "Attached: you and 1 more", read from the count of people attached. */
export function attachedNote(s: WorkspaceSession): string {
  const w = `${s.windows} ${s.windows === 1 ? "window" : "windows"}`;
  return s.attached === 0 ? w : `${w} · ${s.attached} attached`;
}
