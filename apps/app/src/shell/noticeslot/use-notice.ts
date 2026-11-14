// A screen that raised a passing notice follows it: is it still showing? (Escape closes it only while it is, so a notice that ran out never swallows the key.)
import { useSyncExternalStore } from "react";
import { notices as shared } from "./model.ts";
import type { NoticeStore } from "./model.ts";

export function useNoticeLive(id: string | null, store: NoticeStore = shared): boolean {
  const read = (): boolean => id !== null && store.getSnapshot().live.some((n) => n.id === id);
  return useSyncExternalStore(store.subscribe, read, read);
}
