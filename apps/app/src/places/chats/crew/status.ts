// The live crew of a chat: engine.crew.status read once, then again every two seconds while anything works, and whenever `signal` changes (a new message in the chat). One read feeds the strip, the pane, the Island
// and the header. Nothing is estimated here: a failed read keeps the last good one.
import { useCallback, useEffect, useRef, useState } from "react";
import type { CrewMember, CrewStatusOut } from "./model.ts";

export type Call = (cap: string, input: unknown) => Promise<unknown>;

const live = (s: CrewStatusOut | null): boolean => s !== null && s.totals.working + s.totals.needsYou > 0;

export function useCrewStatus(call: Call | undefined, threadId: string, signal = 0): { status: CrewStatusOut | null; refresh(): void } {
  const [status, setStatus] = useState<CrewStatusOut | null>(null);
  const [tick, setTick] = useState(0);
  const dead = useRef(false);
  useEffect(() => { dead.current = false; return () => { dead.current = true; }; }, []);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!call || threadId === "") return undefined;
    let stop = false;
    void Promise.resolve(call("engine.crew.status", { threadId })).then((r) => { if (!stop && !dead.current) setStatus(r as CrewStatusOut); }, () => undefined);
    return () => { stop = true; };
  }, [call, threadId, signal, tick]);
  useEffect(() => {
    if (!live(status)) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 2000);
    (t as { unref?: () => void }).unref?.();
    return () => clearInterval(t);
  }, [status]);
  return { status, refresh };
}

/** The member for a helper thread, from the live read. */
export const memberOf = (status: CrewStatusOut | null, threadId: string): CrewMember | undefined => status?.members.find((m) => m.id === threadId);

/** What the strip draws before the first read lands, or where there is no read: the helper's own block in the chat. */
export function memberFromBlock(b: { data?: unknown; state?: string }, parentThreadId: string): CrewMember {
  const d = (b.data && typeof b.data === "object" ? b.data : {}) as Record<string, unknown>;
  const s = (k: string): string => (typeof d[k] === "string" ? (d[k] as string) : "");
  const state = d["status"] === "failed" || b.state === "error" ? "failed" : d["status"] === "done" || b.state === "done" ? "done" : "working";
  const startedAt = typeof d["startedAt"] === "number" ? (d["startedAt"] as number) : Date.now();
  const finishedAt = typeof d["finishedAt"] === "number" ? (d["finishedAt"] as number) : undefined;
  return {
    kind: "helper", id: s("helperThreadId") || s("threadId"), parentThreadId, title: s("title") || "Helper", agentId: s("agentId"), state, ...(s("found") ? { found: s("found") } : {}),
    startedAt, ...(finishedAt !== undefined ? { endedAt: finishedAt } : {}), elapsedMs: finishedAt !== undefined ? Math.max(0, finishedAt - startedAt) : 0, tokensIn: 0, tokensOut: 0, costMicros: 0,
  } as CrewMember;
}
