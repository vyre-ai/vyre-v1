// Reading goals by capability, following the Space's changes: a goal moves on the server (a reading, a check-in, an answer) and every open view reads it again on the same tick the
// live queries do. Show what we have and patch it: a re-read never empties the list or the page, and a failed re-read keeps the last answer.
import { useCallback, useEffect, useRef, useState } from "react";
import { useFollow } from "../conversation/use-follow.ts";
import type { Changes } from "../conversation/use-follow.ts";
import type { GoalLine, GoalPageData } from "./model.ts";

export type Call = (cap: string, input: unknown) => Promise<unknown>;
export type Load<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

function useRead<T>(read: (() => Promise<T>) | null, changes: Changes | undefined, key: string): { state: Load<T>; reload(): void } {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const had = useRef(false);
  const fn = useRef(read);
  fn.current = read;
  const reload = useCallback((): void => {
    const f = fn.current;
    if (!f) return;
    void f().then((data) => { had.current = true; setState({ status: "ready", data }); }, (e: unknown) => {
      if (had.current) return;
      setState({ status: "error", message: e instanceof Error && e.message ? e.message : "Couldn't load this" });
    });
  }, []);
  useEffect(() => { had.current = false; setState({ status: "loading" }); reload(); }, [key, reload]);
  useFollow(changes, reload, read !== null);
  return { state, reload };
}

/** Your goals and the ones you help with, one list. */
export function useGoals(call: Call, changes: Changes | undefined, active = true): { state: Load<GoalLine[]>; reload(): void } {
  return useRead<GoalLine[]>(active ? async () => {
    const [mine, helping] = await Promise.all([call("goals.list", { scope: "mine" }), call("goals.list", { scope: "helping" }).catch(() => ({ goals: [] }))]);
    const seen = new Map<string, GoalLine>();
    for (const g of [...(mine as { goals: GoalLine[] }).goals, ...(helping as { goals: GoalLine[] }).goals]) seen.set(g.id, g);
    return [...seen.values()];
  } : null, changes, active ? "goals" : "off");
}

/** The goals of a project, a record or a task: the "Goals" strip of a project page, a record's side panel, the "Part of" line. */
export function useGoalsOf(call: Call, changes: Changes | undefined, scope: "project" | "record", id: string | null): { state: Load<GoalLine[]>; reload(): void } {
  return useRead<GoalLine[]>(id ? async () => ((await call("goals.list", { scope, ...(scope === "project" ? { projectId: id } : { recordId: id }) })) as { goals: GoalLine[] }).goals : null, changes, `${scope}:${id ?? ""}`);
}

export function useGoal(call: Call, changes: Changes | undefined, goalId: string): { state: Load<GoalPageData>; reload(): void } {
  return useRead<GoalPageData>(async () => (await call("goals.get", { goalId })) as GoalPageData, changes, goalId);
}
