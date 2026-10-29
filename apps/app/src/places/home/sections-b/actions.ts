// What a press does in Home sections B: one capability call, then the quiet line under the greeting, with Undo where the change can be taken back.
// A failed write becomes "Could not ...", never a thrown error from a click.
import type { StarType } from "./model.ts";

export interface ActionDeps {
  call(cap: string, input: unknown): Promise<unknown>;
  note(text: string, undo: () => Promise<void> | void): void;
}

async function attempt(d: ActionDeps, what: string, fn: () => Promise<void>): Promise<boolean> {
  try { await fn(); return true; } catch { d.note(`Could not ${what}. Try again.`, () => undefined); return false; }
}

/** Remove a star. Undo stars it again. */
export function unstar(d: ActionDeps, resource: { type: StarType; id: string }, title: string): Promise<boolean> {
  return attempt(d, "remove that star", async () => {
    await d.call("stars.toggle", { resource, on: false });
    d.note(`Removed the star from ${title}`, () => attempt(d, "undo that", async () => { await d.call("stars.toggle", { resource, on: true }); }).then(() => undefined));
  });
}

export function dismissChecklist(d: ActionDeps): Promise<boolean> {
  return attempt(d, "hide the checklist", async () => { await d.call("home.dismiss_checklist", {}); });
}

let seq = 0;
/**
 * Ask Vyre from Home: the same door as every place. The person's Ask thread about Home with the agent they picked (their assistant by default), started with what they typed, then opened as a chat so it
 * shows in Recent. Returns the thread to open, or null when it failed.
 */
export async function startAsk(d: ActionDeps, assistantId: string, text: string, at: number): Promise<string | null> {
  const key = `home-ask-${at}-${++seq}`;
  let thread: string | null = null;
  const ok = await attempt(d, "start that chat", async () => {
    const out = (await d.call("chat.start", { kind: "ask", agentIds: [assistantId], scopeType: "home", scopeId: "home", first: text, idempotencyKey: key })) as { thread: { threadId: string } };
    thread = out.thread.threadId;
    try { await d.call("chat.open_as_chat", { threadId: thread }); } catch { /* it stays an Ask pane, found from its object */ }
  });
  return ok ? thread : null;
}
