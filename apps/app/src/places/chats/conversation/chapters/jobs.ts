// Background jobs in a chat (G45, prototype scene bgjob): a long command an agent runs in a terminal tab of its computer is a Job. While it runs the chat shows one quiet line, "Tests  2 min  Background",
// and when it ends one line says how it ended. The jobs are read from the terminals of the agents in the chat (terminal.list), so nothing new is stored: the terminal and its log belong to the host and
// outlive the chat. Pure here; the hook that reads is below. It reads once when the chat opens and once when work ends; the terminal feed of lane b-pc will replace the reads.
import { useCallback, useEffect, useRef, useState } from "react";
import { durationWords } from "../../../../../../../lib/duration.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;

/** The part of a terminal row a job needs. */
export interface Term {
  terminalId: string;
  name: string;
  agentId?: string | undefined;
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
export function jobsOf(terms: readonly Term[], agentIds: ReadonlySet<string>): Job[] {
  return terms
    .filter((t) => t.state === "running" && t.agentId !== undefined && agentIds.has(t.agentId))
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
): { running: Job[]; finished: Finished[] } {
  const running = jobsOf(terms, agentIds);
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

/** The words "2 min" are redrawn this often while a job runs: a clock on this computer, never a read. */
export const JOB_CLOCK_MS = 30_000;

export function useJobs(o: {
  call: Call | undefined;
  agentIds: readonly string[];
  /** An agent is working in this chat right now. */
  working: boolean;
  now: () => number;
}): { running: Job[]; finished: Finished[]; tick: number } {
  const [state, setState] = useState<{ running: Job[]; finished: Finished[] }>({ running: [], finished: [] });
  const [tick, setTick] = useState(0);
  const before = useRef<Job[]>([]);
  const ids = o.agentIds.join(",");
  const callRef = useRef(o.call);
  callRef.current = o.call;
  const nowRef = useRef(o.now);
  nowRef.current = o.now;
  const read = useCallback((): void => {
    const call = callRef.current;
    if (!call || ids === "") return;
    void Promise.resolve(call("terminal.list", { state: ["running", "exited"] })).then(
      (r) => {
        const terms = ((r as { terminals?: Term[] } | null)?.terminals ?? []) as Term[];
        const next = settle(before.current, terms, new Set(ids.split(",")), nowRef.current());
        before.current = next.running;
        setState((cur) => ({ running: next.running, finished: [...cur.finished, ...next.finished] }));
      },
      () => undefined,
    );
  }, [ids]);
  useEffect(() => {
    before.current = [];
    setState({ running: [], finished: [] });
    read();
  }, [ids, read]);
  // no polling (P7): one read when the chat opens, one when an agent's work ends (the turn's own end), and a clock for the words only
  const was = useRef(false);
  useEffect(() => {
    if (!o.working && was.current) read();
    was.current = o.working;
  }, [o.working, read]);
  const running = state.running.length > 0;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), JOB_CLOCK_MS);
    (t as { unref?: () => void }).unref?.();
    return () => clearInterval(t);
  }, [running]);
  return { ...state, tick };
}
