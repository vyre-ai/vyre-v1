// The terminal tab's logic, with no renderer (spec 2.7, ARCH 7.2): how a session of the terminal module reads in ui/Terminal, which call opens a session on which host, the
// polled source that turns terminal.read into ordered frames, and the rules lists as text. Nothing here touches the network; the tests drive every rule directly.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { TerminalFrame, TerminalHost, TerminalSessionState, TerminalSource } from "../../../../../../ui/src/Terminal/index.tsx";

export type TerminalRow = CapMap["terminal.get"]["out"]["terminal"];
export type ApiHost = TerminalRow["host"];
export type Rules = CapMap["terminal.rules.get"]["out"]["rules"];
export type OpenIn = CapMap["terminal.open"]["in"];
export type OpenServerIn = CapMap["terminal.open_server"]["in"];

export const uiHost = (h: ApiHost): TerminalHost => (h === "agent_computer" ? "agent" : h === "space_server" ? "server" : "device");
export const apiHost = (h: TerminalHost): ApiHost => (h === "agent" ? "agent_computer" : h === "server" ? "space_server" : "device");
/** ui/Terminal knows two states; an idle session (nothing running in it) is still a live shell. */
export const uiState = (s: TerminalRow["state"]): TerminalSessionState => (s === "exited" ? "exited" : "running");

export const HOST_LABEL: Readonly<Record<ApiHost, string>> = { agent_computer: "Agent computer", space_server: "Space server", device: "This computer" };

/** What the chip names: the session's host title ("Intake's computer"), else the host's own name. */
export const chipLabel = (t: Pick<TerminalRow, "host" | "hostTitle">): string => (t.hostTitle.length > 0 ? t.hostTitle : HOST_LABEL[t.host]);

/** The call that opens a session on a host: an agent computer or this computer through terminal.open, the Space server through terminal.open_server. */
export type OpenCall =
  | { cap: "terminal.open"; input: OpenIn }
  | { cap: "terminal.open_server"; input: OpenServerIn };

export function openCall(host: TerminalHost, who: { agentId?: string; computerId?: string }, key: string): OpenCall {
  if (host === "server") return { cap: "terminal.open_server", input: { idempotencyKey: key } };
  if (host === "agent") {
    return { cap: "terminal.open", input: { host: "agent_computer", ...(who.agentId ? { agentId: who.agentId } : {}), ...(who.computerId ? { computerId: who.computerId } : {}), idempotencyKey: key } };
  }
  return { cap: "terminal.open", input: { host: "device", idempotencyKey: key } };
}

/** "Ran 4 commands" is what a chat step says; the tab's own line says where the session runs and whether it still does. */
export function sessionLine(t: TerminalRow): string {
  return `${chipLabel(t)} · ${t.state === "exited" ? `exited${t.exitCode === null ? "" : ` (${t.exitCode})`}` : "running"}`;
}

/* ---------- the live frames: terminal.read polled, in order ---------- */

export interface ReadOut { text: string; next: number }

/**
 * The frames of one attached session. terminal.attach gave the replay; from the cursor `since` on, terminal.read answers whatever the shell printed since, and each non-empty
 * answer is one frame with the next sequence number. A failed read is tried again on the next tick; nothing is lost because the cursor moves only when a read succeeds.
 */
export function pollSource(read: (since: number) => Promise<ReadOut>, since: number, everyMs = 400): TerminalSource {
  let seq = 0;
  let cursor = since;
  return {
    subscribe(onFrame: (frame: TerminalFrame) => void): () => void {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = (): void => {
        void read(cursor).then(
          (r) => {
            if (stopped) return;
            cursor = r.next;
            if (r.text.length > 0) { seq += 1; onFrame({ seq, data: r.text }); }
          },
          () => undefined,
        ).then(() => { if (!stopped) timer = setTimeout(tick, everyMs); });
      };
      timer = setTimeout(tick, 0);
      return () => { stopped = true; if (timer !== undefined) clearTimeout(timer); };
    },
  };
}

/* ---------- rules ---------- */

export const RULE_LISTS = ["allow", "ask", "deny", "folders"] as const;
export type RuleList = (typeof RULE_LISTS)[number];

export const RULE_TITLE: Readonly<Record<RuleList, string>> = { allow: "Always allow", ask: "Ask first", deny: "Never allow", folders: "Folders it may work in" };
export const RULE_NOTE: Readonly<Record<RuleList, string>> = {
  allow: "Commands that start with one of these run without asking.",
  ask: "These wait for your yes before they run.",
  deny: "These never run, whatever asks. A rule here wins over the others.",
  folders: "A command only runs inside one of these.",
};
export const RULE_EXAMPLE: Readonly<Record<RuleList, string>> = { allow: "git status", ask: "git push", deny: "rm -rf", folders: "~/Work" };

export const MAX_RULES = 200;
export const MAX_RULE_CHARS = 200;

/** One entry per line: trimmed, empty lines dropped, the same entry once. */
export function parseLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length > 0 && !out.includes(line)) out.push(line);
  }
  return out;
}

export const linesText = (list: readonly string[]): string => list.join("\n");

export function sameRules(a: Rules, b: Rules): boolean {
  return RULE_LISTS.every((k) => a[k].length === b[k].length && a[k].every((v, i) => v === b[k][i]));
}

/** Why these rules cannot be saved, or null. The module checks the same limits; this says so before the call. */
export function rulesProblem(r: Rules): string | null {
  const total = RULE_LISTS.reduce((n, k) => n + r[k].length, 0);
  if (total > MAX_RULES) return `Up to ${MAX_RULES} rules in all. You have ${total}.`;
  for (const k of RULE_LISTS) for (const e of r[k]) if (e.length > MAX_RULE_CHARS) return `A rule is at most ${MAX_RULE_CHARS} characters.`;
  return null;
}

export const NO_RULES: Rules = { allow: [], ask: [], deny: [], folders: [] };

/** Sessions for the list: running ones first, then by the last thing done in them. */
export function ordered(list: readonly TerminalRow[]): TerminalRow[] {
  const rank = (t: TerminalRow): number => (t.state === "exited" ? 1 : 0);
  return [...list].sort((a, b) => rank(a) - rank(b) || b.lastActiveAt - a.lastActiveAt);
}

/** The line under a session in the list: where, and how long ago it was last used. */
export function ago(now: number, at: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
