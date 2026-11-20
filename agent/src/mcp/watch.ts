// What a connected app can watch (lane r42-mcp, 19 Nov 2026): an event in the Space's log, as the addresses it shows under and the read that proves an app may see it. The server (server.ts changed)
// makes that read as each watching app before it tells it anything, so an event about a thing an app cannot read reaches nobody. Pure: no clock and no I/O. Only ids leave here, never a field or a title.
import type { McpChange } from "./types.ts";

/** The events the mcp module's consumer listens for. */
export const WATCHED_EVENTS = [
  "record.created",
  "record.updated",
  "task.created",
  "task.assigned",
  "task.completed",
  "task.transitioned",
  "task.updated",
  "run.succeeded",
  "run.failed",
  "run.stopped",
  "file.created",
  "file.version_added",
  "file.renamed",
  "skill.added",
  "skill.changed",
  "skill.removed",
] as const;

const ID = /^[a-z]{2,5}_[a-z0-9]+$/;
const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const id = (v: unknown): string | null => (typeof v === "string" && ID.test(v) ? v : null);

/** The people an event names in one of its fields: an id, a `{ id }`, or a list of either. */
function peopleIn(...values: unknown[]): string[] {
  const out = new Set<string>();
  const take = (v: unknown): void => {
    if (typeof v === "string") {
      if (ID.test(v)) out.add(v);
    } else if (Array.isArray(v)) v.forEach(take);
    else if (v !== null && typeof v === "object") take((v as { id?: unknown }).id);
  };
  values.forEach(take);
  return [...out];
}

/** The change an event is, for the apps that watch; null for an event nobody can watch. */
export function changeOf(name: string, payload: unknown): McpChange | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (name.startsWith("skill.")) return { prompts: true };
  if (name.startsWith("record.")) {
    const recordId = id(p["recordId"]);
    const type = typeof p["type"] === "string" && KEY.test(p["type"]) ? p["type"] : null;
    if (!recordId || !type) return null;
    return {
      targets: [{ uri: `vyre://records/${type}` }, { uri: `vyre://record/${type}/${recordId}` }],
      proof: { tool: "records_get", args: { type, recordId } },
    };
  }
  if (name.startsWith("task.")) {
    const taskId = id(p["taskId"]);
    if (!taskId) return null;
    // a person's own list changes when a task comes to them: the event names them
    const people = peopleIn(p["to"], p["assigned"]);
    return {
      targets: [{ uri: `vyre://task/${taskId}` }, ...(people.length > 0 ? [{ uri: "vyre://tasks/mine", people }] : [])],
      proof: { tool: "tasks_get", args: { taskId } },
    };
  }
  if (name.startsWith("run.")) {
    const runId = id(p["runId"]);
    if (!runId) return null;
    const people = peopleIn(p["owner"]);
    return {
      targets: [{ uri: `vyre://run/${runId}` }, ...(people.length > 0 ? [{ uri: "vyre://runs/mine", people }] : [])],
      proof: { tool: "runs_get", args: { runId } },
    };
  }
  if (name.startsWith("file.")) {
    const fileId = id(p["fileId"]);
    if (!fileId) return null;
    return {
      targets: [{ uri: `vyre://file/${fileId}` }, { uri: "vyre://files/recent" }],
      proof: { tool: "files_get", args: { fileId } },
    };
  }
  return null;
}
