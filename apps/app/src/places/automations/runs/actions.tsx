// What a person can do to a Run, in one place so the history, the run chat and Failed runs act the same way: retry (from the start or from a step), stop, undo, replay, copy.
// Each action is one capability call; a refusal shows as a quiet line, never a thrown error.
import { useCallback, useEffect, useState } from "react";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useRunsData } from "./data.tsx";
import type { RunsData } from "./data.tsx";
import { undoResult } from "./model.ts";
import type { Run, RunStep, UndoPreview } from "./model.ts";

export interface RunActions {
  /** A quiet one-line result ("Retrying the run", or why it did not work); clears itself. */
  note: string | null;
  retry(run: Run, fromStep?: string): Promise<string | null>;
  /** Retry from the step that failed (found in the step log); from the start when the log names none. */
  retryStep(run: Run): Promise<string | null>;
  stop(run: Run): Promise<void>;
  replay(run: Run, version: "same" | "current"): Promise<void>;
  copy(text: string, what: string): void;
  say(text: string): void;
}

const writeClipboard = (text: string): void => {
  const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator;
  void nav?.clipboard?.writeText?.(text)?.catch(() => undefined);
};

export function useRunActions(): RunActions {
  const data = useRunsData();
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);
  const fail = useCallback((e: unknown): void => setNote(e instanceof Error ? e.message : "That did not work."), []);
  return {
    note,
    say: setNote,
    async retry(run, fromStep) {
      try {
        const out = (await data.call("runs.retry", { runId: run.id, ...(fromStep ? { fromStep } : {}) })) as { runId?: string };
        setNote(fromStep ? "Retrying from that step" : "Retrying the run");
        return out?.runId ?? null;
      } catch (e) { fail(e); return null; }
    },
    async retryStep(run) {
      try {
        const out = (await data.call("runs.steps", { runId: run.id })) as { steps?: readonly RunStep[] };
        const bad = [...(out?.steps ?? [])].reverse().find((x) => x.state === "failed");
        const res = (await data.call("runs.retry", { runId: run.id, ...(bad ? { fromStep: bad.step } : {}) })) as { runId?: string };
        setNote(bad ? "Retrying from the step that failed" : "Retrying the run");
        return res?.runId ?? null;
      } catch (e) { fail(e); return null; }
    },
    async stop(run) {
      try { await data.call("runs.stop", { runId: run.id }); setNote("Stopped the run"); } catch (e) { fail(e); }
    },
    async replay(run, version) {
      try {
        const out = (await data.call("runs.replay", { runId: run.id, version })) as { runId?: string };
        setNote(version === "same" ? "Replaying on the same version" : "Replaying on the current version");
        if (out?.runId) data.nav.openRunSide(out.runId);
      } catch (e) { fail(e); }
    },
    copy(text, what) { writeClipboard(text); setNote(`Copied ${what}`); },
  };
}

export type ShowMenu = (items: readonly MenuEntry[], x: number, y: number, source?: "context" | "other", context?: { label?: string }) => void;

export const isActive = (r: Run): boolean => r.status === "queued" || r.status === "running" || r.status === "waiting";
export const runLink = (r: Run): string => `vyre://run/${r.id}`;

/** The menu of a run row or a run chat: open, copy, retry, stop. `failedStillOpen` is a failed run nobody retried. */
export function runMenu(run: Run, a: RunActions, nav: { openRun(id: string): void; openRunSide(id: string): void }, show: ShowMenu, at: { x: number; y: number }, failedStillOpen: boolean): MenuEntry[] {
  const items: MenuEntry[] = [
    { label: "Open to the Side", onSelect: () => nav.openRunSide(run.id) },
    { label: "Open in Main", onSelect: () => nav.openRun(run.id) },
    { label: "Copy Link", onSelect: () => a.copy(runLink(run), "the link to this run") },
    { label: "Copy Trace Id", onSelect: () => a.copy(run.traceId, "the trace id") },
  ];
  if (failedStillOpen) items.push({ separator: true }, { label: "Retry", onSelect: () => void a.retry(run) });
  if (isActive(run)) items.push({ separator: true }, { label: "Stop", danger: true, onSelect: () => show([{ head: "Stop this run?" }, { label: "Stop", danger: true, onSelect: () => void a.stop(run) }, { label: "Cancel" }], at.x, at.y, "other") });
  return items;
}

/** Where a press happened, for a menu opened from a button. */
export function pressPoint(e: unknown): { x: number; y: number } {
  const n = (e as { nativeEvent?: { pageX?: number; pageY?: number; clientX?: number; clientY?: number } } | null)?.nativeEvent ?? (e as { clientX?: number; clientY?: number } | null) ?? {};
  const r = n as { pageX?: number; pageY?: number; clientX?: number; clientY?: number };
  return { x: r.clientX ?? r.pageX ?? 0, y: r.clientY ?? r.pageY ?? 0 };
}

/* ---------- the calls behind the run chat, as plain functions (the chat wires them to its controls; the tests call them) ---------- */

export const previewUndo = async (data: RunsData, runId: string): Promise<UndoPreview> => (await data.call("runs.preview_undo", { runId })) as UndoPreview;

/** Undo this run: replays the inverse of the run's writes; the result says what was reversed and what stayed. */
export async function undoRun(data: RunsData, runId: string): Promise<{ text: string; result: UndoPreview }> {
  const result = (await data.call("runs.undo", { runId })) as UndoPreview;
  return { text: undoResult(result), result };
}

/** Approve or decline the Approve task a waiting run is parked on; the run goes on at once. */
export async function decideTask(data: RunsData, taskId: string, action: "approve" | "reject"): Promise<string> {
  await data.call("tasks.act", { taskId, action });
  return action === "approve" ? "Approved. The run goes on." : "Declined. Nothing was sent.";
}

/** A message in the run's own thread: ask about the run, or tell an agent what to do. */
export async function postToRun(data: RunsData, run: Pick<Run, "id" | "threadId">, body: string, key: string): Promise<boolean> {
  const text = body.trim();
  if (!text || !run.threadId) return false;
  await data.call("chat.post", { threadId: run.threadId, body: text, idempotencyKey: `run-${run.id}-${key}` });
  return true;
}
