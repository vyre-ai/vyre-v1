// What the agent page writes: one capability per action. Plain functions over a `call` and a `note`, so the tests drive them without a renderer. A failed write becomes one
// quiet line ("Could not ..."), never a thrown error from a click; a change that can be taken back says so with Undo.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { Suggestion } from "./model.ts";

export interface PageDeps {
  call(cap: string, input: unknown): Promise<unknown>;
  /** The quiet line at the foot of the page. `undo` is absent when the change cannot be taken back. */
  note(text: string, undo?: () => Promise<void> | void): void;
}

async function attempt(d: PageDeps, what: string, fn: () => Promise<void>): Promise<boolean> {
  try { await fn(); return true; } catch { d.note(`Could not ${what}. Try again.`); return false; }
}

let seq = 0;
const key = (what: string, id: string): string => `ap-${what}-${id}-${++seq}`;

/** Enter on the role line: saves to `description` in agent.toml (agents.role_line.set), and the line below offers Undo, which restores the version the save returned. */
export function saveRoleLine(d: PageDeps, agentId: string, description: string, previous: string): Promise<boolean> {
  return attempt(d, "save the role line", async () => {
    const out = (await d.call("agents.role_line.set", { agentId, description } satisfies CapMap["agents.role_line.set"]["in"])) as CapMap["agents.role_line.set"]["out"];
    d.note("Role line saved.", async () => {
      try {
        await d.call("agents.restore_version", { agentId, file: "agent.toml", versionId: out.undoVersionId } satisfies CapMap["agents.restore_version"]["in"]);
        d.note(previous === "" ? "Role line removed." : `Role line is back to "${previous}".`);
      } catch { d.note("Could not undo the role line. Try again."); }
    });
  });
}

/** The Chat button: a new chat with this agent, opened in place. */
export async function startChat(d: PageDeps, agentId: string, name: string): Promise<string | null> {
  try {
    const out = (await d.call("chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: key("chat", agentId) } satisfies CapMap["chat.start"]["in"])) as CapMap["chat.start"]["out"];
    return out.thread.threadId;
  } catch { d.note(`Could not start a chat with ${name}. Try again.`); return null; }
}

export function pause(d: PageDeps, agentId: string, name: string, reason: string): Promise<boolean> {
  return attempt(d, `pause ${name}`, async () => {
    await d.call("agents.pause", { agentId, reason } satisfies CapMap["agents.pause"]["in"]);
    d.note(`${name} is paused. Its routines wait until you resume it.`, async () => { await d.call("agents.resume", { agentId } satisfies CapMap["agents.resume"]["in"]); d.note(`${name} is running again.`); });
  });
}

export function resume(d: PageDeps, agentId: string, name: string): Promise<boolean> {
  return attempt(d, `resume ${name}`, async () => {
    await d.call("agents.resume", { agentId } satisfies CapMap["agents.resume"]["in"]);
    d.note(`${name} is running again.`);
  });
}

export function setRoutine(d: PageDeps, agentId: string, r: { routineId: string; title: string; cron?: string; kind?: "schedule" | "watch"; watch?: { on: "message"; channelId: string }; prompt: string; channelId?: string }, enabled: boolean): Promise<boolean> {
  return attempt(d, `${enabled ? "turn on" : "pause"} the routine`, async () => {
    await d.call("agents.routine.save", { agentId, routineId: r.routineId, idempotencyKey: key("routine", r.routineId), title: r.title, ...(r.cron !== undefined ? { cron: r.cron } : {}), ...(r.kind !== undefined ? { kind: r.kind } : {}), ...(r.watch !== undefined ? { watch: r.watch } : {}), prompt: r.prompt, enabled, ...(r.channelId ? { channelId: r.channelId } : {}) } satisfies CapMap["agents.routine.save"]["in"]);
    d.note(enabled ? `${r.title} is on.` : `${r.title} is paused.`, async () => {
      await d.call("agents.routine.save", { agentId, routineId: r.routineId, idempotencyKey: key("routine", r.routineId), title: r.title, ...(r.cron !== undefined ? { cron: r.cron } : {}), ...(r.kind !== undefined ? { kind: r.kind } : {}), ...(r.watch !== undefined ? { watch: r.watch } : {}), prompt: r.prompt, enabled: !enabled, ...(r.channelId ? { channelId: r.channelId } : {}) } satisfies CapMap["agents.routine.save"]["in"]);
    });
  });
}

export function acceptSuggestion(d: PageDeps, s: Suggestion): Promise<boolean> {
  return attempt(d, "accept the change", async () => {
    await d.call("agents.suggestion.accept", { suggestionId: s.suggestionId } satisfies CapMap["agents.suggestion.accept"]["in"]);
    d.note(`Accepted. ${s.file} has the change.`);
  });
}

export function dismissSuggestion(d: PageDeps, s: Suggestion): Promise<boolean> {
  return attempt(d, "dismiss the change", async () => {
    await d.call("agents.suggestion.dismiss", { suggestionId: s.suggestionId } satisfies CapMap["agents.suggestion.dismiss"]["in"]);
    d.note("Dismissed.");
  });
}

/** Move to Trash, after the page asked "Move this agent to Trash?". */
export function moveToTrash(d: PageDeps, agentId: string, name: string): Promise<boolean> {
  return attempt(d, `move ${name} to Trash`, async () => {
    await d.call("agents.delete", { agentId } satisfies CapMap["agents.delete"]["in"]);
  });
}

export async function copyText(d: PageDeps, text: string): Promise<boolean> {
  const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator;
  try { await nav?.clipboard?.writeText?.(text); d.note("Copied."); return true; } catch { d.note("Could not copy. Try again."); return false; }
}
