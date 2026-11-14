// Background jobs in a chat (G45, prototype scene bgjob): a long command an agent runs in a terminal tab of its computer is a Job. While it runs the chat shows one quiet line, "Tests  2 min  Background",
// and when it ends one line says how it ended. The jobs are read from the terminals of the agents in the chat (terminal.list), so nothing new is stored: the terminal and its log belong to the host and
// outlive the chat. Pure here; the hook that reads is below. The rows come from the live terminal feed (lane b-pc): no reads at all.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { durationWords } from "../../../../../../../lib/duration.ts";

/** The live terminal rows (screen chats.terminal-list, query terminals): patched by terminal events, so nothing here reads or polls. */
export interface TerminalFeed {
  subscribe(f: () => void): () => void;
  getSnapshot(): { status: string; data?: { terminals: readonly Term[] } };
}
const IDLE = { status: "idle" };
const NONE: TerminalFeed = { subscribe: () => () => undefined, getSnapshot: () => IDLE };

/** The part of a terminal row a job needs. */
export interface Term {
  terminalId: string;
  name: string;
  agentId?: string | undefined;
  /** The chat the command was started in, when the terminal row says. A row without it matches no chat: another chat's job is never shown here. */
  threadId?: string | undefined;
  state: "running" | "idle" | "exited";
  exitCode: number | null;
  createdAt: number;
  lastActiveAt: number;
}

export interface Job {
  id: string;
  title: string;
  startedAt: number;
}
export interface Finished {
  id: string;
  title: string;
  /** How long it ran, in ms. */
  ms: number;
  ok: boolean;
}

/** "build" and "unit-tests" read as "Build" and "Unit tests". */
export const titleOf = (name: string): string => {
  const w = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return w === "" ? "Command" : `${w[0]!.toUpperCase()}${w.slice(1)}`;
};

/** Running jobs of the agents in the chat, oldest first. A shell sitting at its prompt is not a job. */
export function jobsOf(terms: readonly Term[], agentIds: ReadonlySet<string>, threadId?: string): Job[] {
  return terms
    .filter(
      (t) =>
        t.state === "running" &&
        t.agentId !== undefined &&
        agentIds.has(t.agentId) &&
        (threadId === undefined || t.threadId === threadId),
    )
    .map((t) => ({ id: t.terminalId, title: titleOf(t.name), startedAt: t.createdAt }))
    .sort((a, b) => a.startedAt - b.startedAt);
}

/** "Tests  2 min  Background": what the running line says, in the app's one duration words. */
export const runningWords = (j: Job, now: number): { title: string; time: string; tag: string } => ({
  title: j.title,
  time: durationWords(now - j.startedAt),
  tag: "Background",
});

/** The one line a finished job leaves. */
export const finishedWords = (f: Finished): string =>
  f.ok ? `${f.title} finished in ${durationWords(f.ms)}` : `${f.title} failed after ${durationWords(f.ms)}`;

/**
 * What the last read changes: jobs that were running and are not are finished (read from the terminal's exit code, or lost when it is gone), and the running ones now.
 * `before` is the running set of the read before.
 */
export function settle(
  before: readonly Job[],
  terms: readonly Term[],
  agentIds: ReadonlySet<string>,
  now: number,
  threadId?: string,
): { running: Job[]; finished: Finished[] } {
  const running = jobsOf(terms, agentIds, threadId);
  const live = new Set(running.map((j) => j.id));
  const finished: Finished[] = [];
  for (const j of before) {
    if (live.has(j.id)) continue;
    const t = terms.find((x) => x.terminalId === j.id);
    finished.push({
      id: j.id,
      title: j.title,
      ms: Math.max(0, (t?.lastActiveAt ?? now) - j.startedAt),
      ok: t === undefined ? true : t.exitCode === null || t.exitCode === 0,
    });
  }
  return { running, finished };
}

/** The finished lines kept in a chat window: the newest few. */
export const MAX_FINISHED = 5;

/** The words "2 min" are redrawn this often while a job runs: a clock on this computer, never a read. */
export const JOB_CLOCK_MS = 30_000;

export function useJobs(o: {
  feed: TerminalFeed | undefined;
  agentIds: readonly string[];
  threadId?: string | undefined;
  now: () => number;
}): {
  running: Job[];
  finished: Finished[];
  tick: number;
} {
  const feed = o.feed ?? NONE;
  const snap = useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getSnapshot);
  const ids = o.agentIds.join(",");
  const rows = snap.status === "ready" && snap.data ? snap.data.terminals : [];
  const before = useRef<Job[]>([]);
  const [finished, setFinished] = useState<Finished[]>([]);
  const [tick, setTick] = useState(0);
  const running = jobsOf(rows, new Set(ids === "" ? [] : ids.split(",")), o.threadId);
  const key = running.map((j) => j.id).join(",");
  useEffect(() => {
    before.current = [];
    setFinished([]);
  }, [ids]);
  useEffect(() => {
    const next = settle(before.current, rows, new Set(ids === "" ? [] : ids.split(",")), o.now(), o.threadId);
    before.current = next.running;
    if (next.finished.length > 0) setFinished((cur) => [...cur, ...next.finished].slice(-MAX_FINISHED));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the set of running jobs changes
  }, [key, ids]);
  const live = running.length > 0;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setTick((n) => n + 1), JOB_CLOCK_MS);
    (t as { unref?: () => void }).unref?.();
    return () => clearInterval(t);
  }, [live]);
  return { running, finished, tick };
}

const TERMINAL_TOOL = /terminal|shell|bash|exec/i;
/** Has an agent in these messages used a terminal? The job line watches the live rows only then (or while an agent works): a chat that never ran a command asks for nothing. */
export function usedTerminal(
  messages: ReadonlyArray<{ blocks: ReadonlyArray<{ type: string; data?: unknown }> }>,
): boolean {
  for (let i = messages.length - 1, n = 0; i >= 0 && n < 40; i--, n++)
    for (const b of messages[i]!.blocks) {
      if (b.type === "terminal") return true;
      if (b.type === "tool_call" || b.type === "tool_result") {
        const name = (b.data as { name?: unknown } | null | undefined)?.name;
        if (typeof name === "string" && TERMINAL_TOOL.test(name)) return true;
      }
    }
  return false;
}
