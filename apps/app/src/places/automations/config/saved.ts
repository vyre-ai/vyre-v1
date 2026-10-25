// "Changes save as you make them (quiet Saved, Undo where possible)" (spec 3.9, used by the config pane): one hook that runs a write, shows the quiet line, and keeps the way back.
import { useCallback, useEffect, useRef, useState } from "react";

export interface SavedNote { text: string; undo?: () => void; failed?: boolean }
export interface Saved {
  note: SavedNote | null;
  /** Runs `write`; on success shows `text` with Undo when `undo` is given; on a refusal shows why. */
  run(text: string, write: () => Promise<unknown>, undo?: () => Promise<unknown>): Promise<boolean>;
  say(text: string): void;
  clear(): void;
}

export function useSaved(ms = 5000): Saved {
  const [note, setNote] = useState<SavedNote | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const show = useCallback((n: SavedNote | null): void => {
    if (timer.current) clearTimeout(timer.current);
    setNote(n);
    if (n) timer.current = setTimeout(() => setNote(null), ms);
  }, [ms]);
  const fail = useCallback((e: unknown): void => show({ text: e instanceof Error ? e.message : "That did not work.", failed: true }), [show]);
  return {
    note,
    say: (text) => show({ text }),
    clear: () => show(null),
    async run(text, write, undo) {
      try {
        await write();
        show({ text, ...(undo ? { undo: () => { void undo().then(() => show({ text: "Undone" })).catch(fail); } } : {}) });
        return true;
      } catch (e) { fail(e); return false; }
    },
  };
}
