// What the runtime lets a person see around a delegated run (lane r42-subagents, section G of DIRECTION-agent-runtime.md, 19 Nov 2026): the board its helpers write to, the messages they send each other, who waits for
// whom, what sleeps and what it waits on, and what the run cost. Pure functions over the runtime's own shapes (nodeRow, nodeWake, nodeSpent in manifests/runs.ts at 84176c17c; the board, message and activity
// shapes are the ones agreed with r42-runtime and carry its names: rootRun, parentRun, byRun, fromRun, toRun, wokeCount, dueAt). Nothing here reads a server: a read feeds these, so wiring one is a one-file change.
import type { NodeLike } from "../run-view.ts";

export type NodeStatus = NodeLike["status"];
export interface RunNode extends NodeLike {
  rootRun?: string;
  dependsOn?: readonly string[];
  stuck?: { since: number; reason: string };
  whoName?: string;
  /** The one current line of what it is on. */
  step?: string;
  /** Waiting for a person's yes: the request (a Gate task), what for and why. */
  need?: { requestId: string; what: string; why: string };
}
export interface BoardEntry {
  id: string;
  kind: "fact" | "decision" | "question";
  text: string;
  /** The node that wrote it. */
  byRun: string;
  /** Where it came from: a file, a page, a quote. A question needs none. */
  evidence?: readonly string[];
  at: number;
  /** A question's answer: who gave it, what it said. */
  answer?: { byRun: string; text: string; at: number };
}
export interface NodeMessage {
  id: string;
  fromRun: string;
  toRun: string;
  body: string;
  at: number;
  deliveredAt?: number;
  seenAt?: number;
}
export interface ActivityRow {
  runId: string;
  rootRun: string;
  kind: string;
  name: string;
  /** Who it works for or is: "Dex", "Docs". */
  whoName?: string;
  status: NodeStatus;
  /** The one line of what it is on now. */
  step?: string;
  wake?: { kind: string; label?: string; dueAt?: number; wokeCount?: number };
  stuck?: { since: number; reason: string };
  need?: { requestId: string; what: string; why: string };
  startedAt: number;
}

const first = (name: string): string => name.split(" ")[0] ?? name;
const byId = (nodes: readonly Pick<RunNode, "id" | "name">[]): ((id: string) => string) => {
  const m = new Map(nodes.map((n) => [n.id, n.name ?? "Helper"] as const));
  return (id) => m.get(id) ?? "Helper";
};

/** The board in the order a person reads it: what is still open first, then what was answered, what was decided, what was found; each oldest first. */
export function boardGroups(entries: readonly BoardEntry[]): {
  open: BoardEntry[];
  answered: BoardEntry[];
  decisions: BoardEntry[];
  facts: BoardEntry[];
} {
  const by = (f: (e: BoardEntry) => boolean): BoardEntry[] => entries.filter(f).sort((a, b) => a.at - b.at);
  return {
    open: by((e) => e.kind === "question" && e.answer === undefined),
    answered: by((e) => e.kind === "question" && e.answer !== undefined),
    decisions: by((e) => e.kind === "decision"),
    facts: by((e) => e.kind === "fact"),
  };
}

/** The last few messages between helpers as quiet lines ("Numbers to Docs: ..."), newest last. A message to a person is not a line here: it is a Needs you. */
export function messageLines(
  messages: readonly NodeMessage[],
  nodes: readonly Pick<RunNode, "id" | "name">[],
  limit = 2,
): Array<{ id: string; from: string; to: string; fromId: string; toId: string; body: string; seen: boolean }> {
  const name = byId(nodes);
  return [...messages]
    .sort((a, b) => a.at - b.at)
    .slice(-limit)
    .map((m) => ({
      id: m.id,
      from: first(name(m.fromRun)),
      to: first(name(m.toRun)),
      fromId: m.fromRun,
      toId: m.toRun,
      body: m.body,
      seen: m.seenAt !== undefined,
    }));
}

/** "Starts when Research and Numbers are done", only while something it waits for is not done; nothing otherwise. */
export function dependencyLine(
  node: Pick<RunNode, "dependsOn" | "status">,
  nodes: readonly Pick<RunNode, "id" | "name" | "status">[],
): string | null {
  if (node.status === "succeeded" || node.status === "failed" || node.status === "stopped") return null;
  const name = byId(nodes);
  const pending = (node.dependsOn ?? []).filter((id) => {
    const n = nodes.find((x) => x.id === id);
    return n !== undefined && n.status !== "succeeded";
  });
  if (pending.length === 0) return null;
  const names = pending.map((id) => first(name(id)));
  return `Starts when ${names.join(" and ")} ${names.length > 1 ? "are" : "is"} done`;
}

/** What a sleeping run waits on, as the words after "Asleep": "until the export finishes", "until Monday 09:00"; empty when it says nothing. `when` words a time in the Space's time zone. */
export function wakeCondition(w: NonNullable<RunNode["wake"]>, when: (ts: number) => string): string {
  if (w.kind === "time" && w.dueAt !== undefined) return `until ${when(w.dueAt)}`;
  const label = w.label ?? "";
  if (label === "") return "";
  const lower = `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
  return lower.startsWith("until ") || lower.startsWith("wakes ") ? lower : `until ${lower}`;
}

/** The one calm line for a run that sleeps: what it waits on, how often it has woken, and that waiting costs nothing. */
export function sleepLine(
  n: Pick<RunNode, "status" | "wake">,
  when: (ts: number) => string,
): { head: string; tail: string } | null {
  if (n.status !== "waiting" || n.wake === undefined) return null;
  const cond = wakeCondition(n.wake, when);
  const woke = n.wake.wokeCount ?? 0;
  return {
    head: cond === "" ? "Asleep" : `Asleep ${cond}`,
    tail: `${woke > 0 ? `woke ${woke === 1 ? "once" : `${woke} times`} · ` : ""}no tokens while asleep`,
  };
}

/** The token report: tokens, cost, how much was read from the run's cache (the runtime counts cacheRead inside tokensIn), and each node's share. */
export function tokenReport(nodes: readonly RunNode[]): {
  tokens: number;
  costMicros: number;
  cacheRead: number;
  cachePct: number;
  rows: Array<{ id: string; name: string; model: string; tokens: number; cachePct: number; costMicros: number }>;
} {
  const rows = nodes.map((n) => {
    const tokens = n.spent.tokensIn + n.spent.tokensOut;
    return {
      id: n.id,
      name: n.name ?? "Helper",
      model: n.model ?? "",
      tokens,
      cachePct: n.spent.tokensIn > 0 ? Math.min(100, Math.round((n.spent.cacheRead / n.spent.tokensIn) * 100)) : 0,
      costMicros: n.spent.usdMicros,
    };
  });
  const inTotal = nodes.reduce((s, n) => s + n.spent.tokensIn, 0);
  const cacheRead = nodes.reduce((s, n) => s + n.spent.cacheRead, 0);
  return {
    tokens: rows.reduce((s, r) => s + r.tokens, 0),
    costMicros: rows.reduce((s, r) => s + r.costMicros, 0),
    cacheRead,
    cachePct: inTotal > 0 ? Math.min(100, Math.round((cacheRead / inTotal) * 100)) : 0,
    rows,
  };
}

/** Everything running or asleep in the Space, in three groups a person reads top down: what needs them (paused or stuck), what runs, what sleeps. */
export function activityGroups(
  rows: readonly ActivityRow[],
): Array<{ key: "needs" | "running" | "asleep"; title: string; rows: ActivityRow[] }> {
  const needs = rows.filter((r) => r.status === "paused" || r.stuck !== undefined || r.need !== undefined);
  const rest = rows.filter((r) => !needs.includes(r));
  const g = [
    { key: "needs" as const, title: "Needs you", rows: needs },
    {
      key: "running" as const,
      title: "Running",
      rows: rest.filter((r) => r.status === "running" || r.status === "queued"),
    },
    { key: "asleep" as const, title: "Asleep", rows: rest.filter((r) => r.status === "waiting") },
  ];
  return g.filter((x) => x.rows.length > 0);
}

/** Who "@Nu" can mean: a helper or subagent still on it or finished (not stopped), by the start of its first name. */
export function atCandidates<T extends Pick<RunNode, "id" | "name" | "kind" | "status">>(
  nodes: readonly T[],
  query: string,
): T[] {
  const q = query.toLowerCase();
  return nodes.filter(
    (n) =>
      (n.kind === "helper" || n.kind === "subagent" || n.kind === "crew") &&
      n.status !== "stopped" &&
      (n.name ?? "").toLowerCase().startsWith(q),
  );
}

/** "@Numbers use the 8% rate" as a message to that one helper; null when it does not start with a name that is on it, so an ordinary message is never swallowed. */
export function parseAtSend<T extends Pick<RunNode, "id" | "name" | "kind" | "status">>(
  text: string,
  nodes: readonly T[],
): { node: T; body: string } | null {
  const m = /^@(\S+)\s+([\s\S]+\S)\s*$/.exec(text.trim());
  if (!m) return null;
  const hits = atCandidates(nodes, "").filter((n) => first(n.name ?? "").toLowerCase() === m[1]!.toLowerCase());
  return hits.length === 1 ? { node: hits[0]!, body: m[2]! } : null;
}

export type AtRoute<T> =
  | { kind: "to"; node: T; body: string }
  | { kind: "ambiguous"; name: string }
  | { kind: "finished"; name: string };

/**
 * Where a message that starts with "@Name" goes. To the one helper at work with that first name, and only then. If a person or agent of the chat has the same first name, or two helpers do, it goes NOWHERE: the person
 * picks from the @ list ("@Ana (helper)" names the helper outright). A helper that has already finished is not messaged and the words are not posted to the chat as if they were for someone else. Null: not a helper's name at
 * all, so it is an ordinary message.
 */
export function routeAt<T extends Pick<RunNode, "id" | "name" | "kind" | "status">>(
  text: string,
  nodes: readonly T[],
  otherFirstNames: readonly string[],
): AtRoute<T> | null {
  // "@Ana, use it" and "@Ana: use it" name Ana too: the punctuation after a name is not part of it
  const m = /^@(\S+?)[,:;.!?]*(\s+\(helper\))?\s+(\S[\s\S]*)$/i.exec(text.trim());
  if (!m) return null;
  const first = m[1]!.toLowerCase();
  const hits = nodes.filter(
    (n) =>
      (n.kind === "helper" || n.kind === "subagent" || n.kind === "crew") &&
      (n.name ?? "").split(" ")[0]!.toLowerCase() === first,
  );
  if (hits.length === 0) return null;
  const name = hits[0]!.name ?? "Helper";
  const explicit = m[2] !== undefined && m[2] !== "";
  if (hits.length > 1 || (!explicit && otherFirstNames.some((o) => o.toLowerCase() === first)))
    return { kind: "ambiguous", name: name.split(" ")[0]! };
  const n = hits[0]!;
  return n.status === "running" || n.status === "queued" || n.status === "waiting"
    ? { kind: "to", node: n, body: m[3]!.trim() }
    : { kind: "finished", name: name.split(" ")[0]! };
}
