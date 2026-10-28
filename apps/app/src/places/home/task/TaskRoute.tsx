import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { TaskPage } from "../../../../../../ui/src/TaskPage/index.tsx";
import type { TaskCap } from "../../../../../../ui/src/TaskPage/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { TaskBlock } from "../../chats/needsyou/NeedsYou.tsx";
import { blockView } from "../../chats/needsyou/model.ts";
import { useHomeData, useOnline, usePrincipals, useScreenQuery } from "../sections-a/data.tsx";

type Task = CapMap["tasks.get"]["out"]["task"];
type TaskOut = CapMap["tasks.get"]["out"];
type History = CapMap["tasks.history"]["out"];
export function TaskRoute({ taskId, onBack, onOpen }: { taskId: string; onBack(): void; onOpen(type: string, id: string): void }): ReactElement {
  const data = useHomeData(), people = usePrincipals(), online = useOnline();
  const read = useScreenQuery<TaskOut>("tasks.page", "task", { route: { taskId } });
  const activity = useScreenQuery<History>("tasks.page", "activity", { route: { taskId } });
  const [fresh, setFresh] = useState<Task | null>(null), [history, setHistory] = useState<History | null>(null), [error, setError] = useState("");
  useEffect(() => { setFresh(null); setHistory(null); setError(""); }, [taskId]);
  useEffect(() => {
    if (read.status === "ready" && fresh && (read.data.task.updatedAt > fresh.updatedAt || JSON.stringify(read.data.task) === JSON.stringify(fresh))) setFresh(null);
  }, [read, fresh]);
  const refresh = async (): Promise<void> => {
    setError("");
    try { const [task, entries] = await Promise.all([data.call("tasks.get", { taskId }) as Promise<TaskOut>, data.call("tasks.history", { taskId, limit: 100 }) as Promise<History>]); setFresh(task.task); setHistory(entries); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't open this task."); }
  };
  const task = fresh ?? (read.status === "ready" ? read.data.task : null);
  const readError = read.status === "loading" ? read.error : undefined;
  const activityError = activity.status === "loading" ? activity.error : undefined;
  const historyRows = history?.entries ?? (activity.status === "ready" ? activity.data.entries : []);
  const command = async (cap: TaskCap, input: Record<string, unknown>): Promise<void> => {
    const out = await data.call(cap, input) as { task?: Task };
    if (!out.task || out.task.id !== taskId) throw new Error("The task change did not return a completed result. Refresh and try again.");
    const canonical = await data.call("tasks.get", { taskId }) as TaskOut;
    if (canonical.task.id !== taskId || canonical.task.updatedAt < out.task.updatedAt) throw new Error("The task change could not be verified. Refresh before trying again.");
    if (cap === "tasks.transition" && canonical.task.state !== input.to) throw new Error("The task changed again. Refresh before continuing.");
    if (cap === "tasks.assign") { const value = canonical.task[input.slot as "assigned" | "reviewer" | "approver"]; const wanted = input.to as { id: string; kind: string } | null; if (wanted ? value?.id !== wanted.id || value?.kind !== wanted.kind : value !== undefined) throw new Error("The assignment could not be verified."); }
    if (cap === "tasks.update") for (const key of ["title", "summary", "why", "due", "effort"] as const) if (key in input && (input[key] === null ? canonical.task[key] !== undefined : canonical.task[key] !== input[key])) throw new Error("The task edit could not be verified.");
    if (cap === "tasks.working_notes.set" && canonical.task.workingNotes[String(input.key)] !== input.value) throw new Error("The working note could not be verified.");
    setFresh(canonical.task);
    try { setHistory(await data.call("tasks.history", { taskId, limit: 100 }) as History); } catch { /* The verified task remains usable; Activity can retry below. */ }
  };
  if (!task) return <View testID="task-page-loading" style={{ flex: 1, padding: 28 }}>{readError || error ? <States kind="error" message={error || readError?.message || "Couldn't open this task."} retryable onRetry={() => void refresh()} /> : <Text style={{ color: "var(--ink-3)" as string }}>Opening task…</Text>}</View>;
  return <TaskPage key={task.id} task={task} me={data.me.id} principals={people.list} history={historyRows} online={online} onCommand={command} onBack={onBack} onOpen={onOpen} nameOf={(type, id) => type === "record" ? data.recordTitle(id) ?? "Linked record" : ["person", "agent", "group", "role"].includes(type) ? people.byId(id)?.name ?? "Unavailable teammate" : `Linked ${type}`}>
    {/* ui-rows-lint: not a list (rich task content uses the shared structured block renderer) */}
    {task.blocks.map((block, index) => <TaskBlock key={`${block.type}-${index}`} view={blockView(block)} />)}
    {activityError ? <States kind="error" message={activityError.message} retryable onRetry={() => void refresh()} /> : null}
  </TaskPage>;
}
