// What each chat's right pane was showing: open or not, and which of its own tabs. Kept for as long as the app is open, so a chat's pane comes back as it was when its tab is returned to.
import { useEffect, useRef } from "react";
import type { TabKey } from "../rightpane/model.ts";

export const PANE_MEMORY = new Map<string, { open: boolean; tab?: TabKey }>();

/** For tests and sample places: every chat starts with nothing remembered. */
export function forgetPanes(): void {
  PANE_MEMORY.clear();
}

export type PaneMem = { open: boolean; tab?: TabKey } | undefined;

/**
 * The pane of a chat is the chat's own (NAV R5: remembered per chat, closed as well as open). When the chat on screen changes, the pane of the chat that was left is written down as it stood (closed counts), and the
 * pane of the one that comes in is made to match what was written for it, in both directions: a chat left closed comes back closed even when the chat shown in between had its pane open. A chat with nothing written
 * keeps the flag it arrives with. The same holds when a kept place is shown again (its effects start again): the chat there is the same, so nothing is left or entered and the pane stays as it is.
 */
export function usePaneMemory(o: {
  chat: string | null;
  pane: boolean;
  tab: TabKey | undefined;
  /** the chat that came in: its remembered tab (or none); the place resets what belongs to the chat before it */
  arrive(mem: PaneMem): void;
  setPane(open: boolean): void;
}): void {
  const saved = useRef<string | null>(null);
  const skipSave = useRef(false);
  /** the pane flag of `saved`'s chat as it last stood on its own */
  const flag = useRef(false);
  const paneNow = useRef(o.pane);
  paneNow.current = o.pane;
  const latest = useRef(o);
  latest.current = o;
  useEffect(() => {
    const { chat, arrive, setPane } = latest.current;
    const leaving = saved.current;
    if (leaving !== null && leaving !== chat) {
      const was = PANE_MEMORY.get(leaving);
      PANE_MEMORY.set(leaving, { open: flag.current, ...(was?.tab !== undefined ? { tab: was.tab } : {}) });
    }
    const mem = chat === null ? undefined : PANE_MEMORY.get(chat);
    arrive(mem);
    saved.current = chat;
    // the commit that brings a chat in still carries the last chat's pane flag: what it says is not this chat's
    skipSave.current = true;
    if (mem !== undefined && mem.open !== paneNow.current) setPane(mem.open);
    flag.current = mem !== undefined ? mem.open : paneNow.current;
  }, [o.chat]); // eslint-disable-line react-hooks/exhaustive-deps -- runs when the chat on screen changes (and when a hidden place is shown again)
  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    if (o.chat === null || saved.current !== o.chat) return;
    flag.current = o.pane;
    PANE_MEMORY.set(o.chat, { open: o.pane, ...(o.tab !== undefined ? { tab: o.tab } : {}) });
  }, [o.chat, o.pane, o.tab]);
}
