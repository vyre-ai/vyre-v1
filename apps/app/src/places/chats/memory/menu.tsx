// The memory items of a message's right-click menu (and of the hover bar's More menu): Remember This, Add to a Page, Show What the Agent Knew Here and Forget This. They are added to the menu the
// conversation already has, never instead of its items. Remember writes a fact from the message (memory.remember) and flashes "Remembered." with Undo; Add to a Page lists the pages and appends the
// message as a line to that page's Notes (memory.page.put with the version it read, so a stale write refuses); Show What the Agent Knew pins the right pane's Knows tab to this reply;
// Forget This moves what the message taught to Trash, or says there is nothing to forget.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { KIND_ONE } from "../../files/memory/know.ts";
import { addMessageToPage, forgetMessage, rememberMessage } from "./actions.ts";
import { SUBJECT_KINDS } from "./model.ts";
import { useThreadMemory } from "./thread.tsx";
import type { ThreadMemory } from "./thread.tsx";

/** What the menu needs of a message. */
export interface MenuMessage { messageId: string; body: string; createdAt: number }
export type ShowMenu = (items: readonly MenuEntry[], x: number, y: number, label: string) => void;

const MAX_PAGES = 14;

/** The memory entries for one message, or none where the chat has no memory. `at` is where the picker opens (under the menu that asked). */
export function memoryEntries(thread: ThreadMemory, m: MenuMessage, at: { x: number; y: number }, show: ShowMenu): MenuEntry[] {
  const { memory } = thread;
  const say = thread.flash;
  const pick = (): void => {
    const pages = thread.pages.filter((p) => SUBJECT_KINDS.has(p.kind)).slice(0, MAX_PAGES);
    show(
      pages.length > 0
        ? [{ head: "Add to a page" } as MenuEntry, ...pages.map((p): MenuEntry => ({ label: `${p.title} \u00B7 ${KIND_ONE[p.kind as keyof typeof KIND_ONE] ?? p.kind}`, onSelect: () => void addMessageToPage(memory, m, p.pageId, p.title, say) }))]
        : [{ head: "No pages to add to yet" } as MenuEntry],
      at.x, at.y, "Add to a page",
    );
  };
  return [
    { separator: true },
    { label: "Remember This", onSelect: () => void rememberMessage(memory, thread.threadId, m, say) },
    { label: "Add to a Page\u2026", onSelect: pick },
    { label: "Show What the Agent Knew Here", onSelect: () => { memory.store.pinKnows(m.messageId, m.createdAt); memory.showKnows?.(); } },
    { label: "Forget This", danger: true, onSelect: () => void forgetMessage(memory, thread.currentFrom(m.messageId), say) },
  ];
}

/** The hook the conversation calls once: a function from a message and a point to its memory entries (empty without memory). */
export function useMemoryEntries(): ((m: MenuMessage, x: number, y: number, show: ShowMenu) => MenuEntry[]) | undefined {
  const thread = useThreadMemory();
  if (!thread) return undefined;
  return (m, x, y, show) => memoryEntries(thread, m, { x, y }, show);
}
