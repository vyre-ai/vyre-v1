// The writes of the chat's memory surfaces, each one capability through the store (so every read is stale afterwards and the lines refresh). Plain functions over a ChatMemoryData and the
// thread's memory, so the tests drive them without a renderer. A failed write becomes one quiet line (`say`), never a thrown error from a click; a change that can be taken back says so with Undo.
import { errorLine } from "./data.tsx";
import type { ChatMemoryData } from "./data.tsx";
import { FLASH, appendLine, rememberText } from "./model.ts";
import type { ChatFact, LearnedRow } from "./model.ts";

export type Say = (text: string, undo?: () => void | Promise<unknown>) => void;

/** Forget facts: they go to Trash for 60 days; the flash offers Undo, which restores them. */
export async function forgetFacts(mem: ChatMemoryData, factIds: readonly string[], say: Say, said?: string): Promise<boolean> {
  try {
    await mem.store.write("memory.forget", { factIds: [...factIds] });
    say(said ?? `Forgot ${factIds.length === 1 ? "it" : `${factIds.length} facts`}. It stays in Trash for 60 days.`, async () => { for (const id of factIds) await mem.store.write("memory.restore", { factId: id }); });
    return true;
  } catch (e) {
    say(errorLine(e, "Could not forget it"));
    return false;
  }
}

/** "Undo" on a Learned line: the fact goes to Trash. Resolves with an error line, or null. */
export async function undoLearned(mem: ChatMemoryData, factId: string): Promise<string | null> {
  try { await mem.store.write("memory.undo", { factId }); return null; } catch (e) { return errorLine(e, "Could not undo it"); }
}

/** "Restore" on the line that says Moved to Trash. */
export async function restoreLearned(mem: ChatMemoryData, factId: string): Promise<string | null> {
  try { await mem.store.write("memory.restore", { factId }); return null; } catch (e) { return errorLine(e, "Could not restore it"); }
}

/** "Edit" then Save on a Learned line or a Knows row: the old fact closes and a new one stands in its place (the old wording stays in history). */
export async function correctFact(mem: ChatMemoryData, factId: string, text: string): Promise<{ ok: true; fact: { factId: string; text: string } } | { ok: false; error: string }> {
  try {
    const out = await mem.store.write<{ fact: { factId: string; text: string } }>("memory.fact.correct", { factId, text });
    return { ok: true, fact: out.fact };
  } catch (e) {
    return { ok: false, error: errorLine(e, "Could not save the change") };
  }
}

/** Accept or reject a proposed fact (Knows tab). */
export async function decideFact(mem: ChatMemoryData, factId: string, accept: boolean, say: Say): Promise<void> {
  try {
    await mem.store.write(accept ? "memory.fact.accept" : "memory.fact.reject", { factId });
    say(accept ? "Accepted. It is in what the agent knows." : "Rejected. It will not be remembered.", () => mem.store.write(accept ? "memory.fact.reject" : "memory.fact.accept", { factId }));
  } catch (e) {
    say(errorLine(e, accept ? "Could not accept it" : "Could not reject it"));
  }
}

/** "Remember This": a fact from the message's words, learned in this thread from this message. */
export async function rememberMessage(mem: ChatMemoryData, threadId: string, m: { messageId: string; body: string }, say: Say): Promise<void> {
  const text = rememberText(m.body);
  if (text === "") { say("There are no words in this message to remember."); return; }
  try {
    const out = await mem.store.write<{ fact: { factId: string } }>("memory.remember", { text, threadId, sourceRef: m.messageId });
    say(FLASH.remembered, () => mem.store.write("memory.undo", { factId: out.fact.factId }));
  } catch (e) {
    say(errorLine(e, "Could not remember it"));
  }
}

/** "Add to a page": the message as one more line at the end of the page's Notes, written against the version just read so a stale write refuses. */
export async function addMessageToPage(mem: ChatMemoryData, m: { body: string }, pageId: string, title: string, say: Say): Promise<boolean> {
  const line = `- ${rememberText(m.body).slice(0, 200)}`;
  try {
    const got = await mem.store.read<{ page: { version: number }; notes: string }>("memory.page.get", { pageId });
    const out = await mem.store.write<{ page: { version: number } }>("memory.page.put", { pageId, notes: appendLine(got.notes, line), baseVersion: got.page.version });
    say(FLASH.added(title), () => mem.store.write("memory.page.put", { pageId, notes: got.notes, baseVersion: out.page.version }));
    return true;
  } catch (e) {
    say(errorLine(e, `Could not add it to ${title}`));
    return false;
  }
}

/** "Forget This" on a message: what it taught moves to Trash, or the line says there was nothing to forget. */
export async function forgetMessage(mem: ChatMemoryData, taught: readonly LearnedRow[], say: Say): Promise<boolean> {
  if (taught.length === 0) { say(FLASH.noneToForget); return false; }
  return forgetFacts(mem, taught.map((r) => r.factId), say, FLASH.forgot(taught.length));
}

export const isMine = (f: Pick<ChatFact, "by">, me: { id: string }): boolean => f.by === me.id;
