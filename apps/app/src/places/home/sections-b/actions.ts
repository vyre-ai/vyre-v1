// What a press does in Home sections B: one capability call, then the quiet line under the greeting, with Undo where the change can be taken back.
// A failed write becomes "Could not ...", never a thrown error from a click.
import { currentScreen } from "../../../shell/ask/screen.ts";
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
export interface AskExtras { mentions?: readonly { kind: "person" | "agent"; id: string }[]; refs?: readonly { kind: string; id: string; title: string }[] }

/**
 * Start a chat with the assistant from the Ask box. Returns the thread to open, or null when it failed. A plain question is the first message of the new chat. When the person @mentioned someone or
 * linked things with #, the message is posted the way the Chats composer posts it (mentions and the refs block), so an @agent answers and a linked record is seen, not flattened to text.
 */
export async function startAsk(d: ActionDeps, assistantId: string, text: string, at: number, extras: AskExtras = {}): Promise<string | null> {
  const key = `home-ask-${at}-${++seq}`;
  // the question goes the way a chat's message goes, with the screen it was asked from: the first message of a chat carries none
  const screen = currentScreen();
  const rich = screen !== null || (extras.mentions?.length ?? 0) > 0 || (extras.refs?.length ?? 0) > 0;
  let thread: string | null = null;
  const ok = await attempt(d, "start that chat", async () => {
    const out = (await d.call("chat.start", { kind: "chat", agentIds: [assistantId], ...(rich ? {} : { first: text }), idempotencyKey: key })) as { thread: { threadId: string } };
    thread = out.thread.threadId;
    if (rich) {
      await d.call("chat.post", {
        threadId: thread, body: text, idempotencyKey: `${key}-post`, ...(screen ? { screen } : {}),
        ...((extras.mentions?.length ?? 0) > 0 ? { mentions: extras.mentions!.map((m) => ({ kind: m.kind, id: m.id })) } : {}),
        ...((extras.refs?.length ?? 0) > 0 ? { blocks: [{ type: "refs", v: 1, data: { refs: extras.refs!.map((r) => ({ kind: r.kind, id: r.id, title: r.title })) } }] } : {}),
      });
    }
  });
  return ok ? thread : null;
}
