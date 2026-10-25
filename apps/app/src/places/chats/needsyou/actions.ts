// The writes Needs you makes, each one capability, as plain functions so the tests drive them without a renderer. Acting in Needs you acts at the source: approving continues the
// chat or run at once, and Send back carries the note in. A failed write becomes one quiet line, never a thrown error from a click.
import { doneLine, isSendBack, snoozeUntil } from "./model.ts";
import type { Action, Clock, SnoozeChoice, Task } from "./model.ts";

export interface NeedsDeps {
  call(cap: string, input: unknown): Promise<unknown>;
  /** The quiet line under the list. */
  note(text: string): void;
}

async function attempt(d: NeedsDeps, what: string, fn: () => Promise<void>): Promise<boolean> {
  try { await fn(); return true; } catch { d.note(`Could not ${what}. Try again.`); return false; }
}

/** Act on a request. A note is sent with it; Send back and a required note need one, so an empty note does nothing. */
export function act(d: NeedsDeps, t: Task, a: Action, who: string, note?: string): Promise<boolean> {
  const text = note?.trim() ?? "";
  if ((isSendBack(a) || a.note === "required") && text === "") return Promise.resolve(false);
  return attempt(d, isSendBack(a) ? "send it back" : a.label.replace(/…$/, "").toLowerCase(), async () => {
    await d.call("tasks.act", { taskId: t.id, action: a.key, ...(text ? { note: text } : {}) });
    d.note(doneLine(t, a, who));
  });
}

/** Take a request addressed to a group or role: others then see "taken by". */
export function take(d: NeedsDeps, t: Task): Promise<boolean> {
  return attempt(d, "take it", async () => { await d.call("tasks.take", { taskId: t.id }); d.note(`You took “${t.title}”`); });
}

/** Snooze a request: it leaves the list and returns at its time. */
export function snooze(d: NeedsDeps, t: Task, choice: SnoozeChoice["key"], c: Clock): Promise<boolean> {
  return attempt(d, "snooze it", async () => { await d.call("tasks.snooze", { taskId: t.id, until: snoozeUntil(choice, c) }); d.note(`Snoozed “${t.title}”`); });
}
