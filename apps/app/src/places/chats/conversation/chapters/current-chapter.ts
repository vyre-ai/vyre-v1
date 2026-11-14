// The title of the chapter a long chat is in now, for the head's grey subtitle (G1). The chapter layer sets it, the head reads it with `useCurrentChapter(threadId)`: "" for a chat with no chapters.
import { useSyncExternalStore } from "react";

const titles = new Map<string, string>();
const subs = new Set<() => void>();

export function setCurrentChapter(threadId: string, title: string): void {
  if ((titles.get(threadId) ?? "") === title) return;
  if (title === "") titles.delete(threadId);
  else titles.set(threadId, title);
  for (const f of subs) f();
}

export function useCurrentChapter(threadId: string): string {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => titles.get(threadId) ?? "",
    () => "",
  );
}
