// A text that saves itself: the host gives the saved text and a save, gets the draft and a status. For the places that keep one value (a task's description, its working notes, a note, a long-text field) rather than a file with versions.
// A pause after the last edit saves; leaving the editor and unmounting flush what is pending, so closing an edit never drops a word.
import { useCallback, useEffect, useRef, useState } from "react";
import { Autosaver } from "./autosave.ts";
import type { AutosaveStatus } from "./autosave.ts";

export interface AutosavedText {
  text: string;
  /** The editor's onChange. */
  edit: (t: string) => void;
  status: AutosaveStatus;
  error: string | null;
  /** Save now (Done, Cmd+S, leaving). */
  flush: () => Promise<void>;
}

/**
 * `saved` is the text the host holds; a change to it from outside replaces the draft. `save` returns true when the host kept the text, or a sentence when it refused.
 * `delay` is the quiet time after the last key.
 */
export function useAutosavedText(saved: string, save: (text: string) => Promise<true | string>, delay = 800): AutosavedText {
  const [text, setText] = useState(saved);
  const [state, setState] = useState<{ status: AutosaveStatus; error: string | null }>({ status: "idle", error: null });
  const latest = useRef(save);
  latest.current = save;
  const ref = useRef<Autosaver | null>(null);
  if (ref.current === null) {
    ref.current = new Autosaver({ delay, saved: { text: saved, version: 0 }, save: async (t) => { const r = await latest.current(t); return r === true ? { ok: true, version: 0 } : { ok: false, error: r }; } });
  }
  const saver = ref.current;
  useEffect(() => saver.subscribe((s) => setState({ status: s.status, error: s.error })), [saver]);
  useEffect(() => () => { void saver.flush(); saver.destroy(); }, [saver]);
  const was = useRef(saved);
  const now = useRef(text);
  now.current = text;
  useEffect(() => {
    if (saved === was.current) return;
    was.current = saved;
    if (saved !== now.current) { setText(saved); saver.reset({ text: saved, version: 0 }); }
  }, [saved]);
  const edit = useCallback((t: string) => { setText(t); now.current = t; saver.edit(t); }, [saver]);
  const flush = useCallback(() => saver.flush(), [saver]);
  return { text, edit, status: state.status, error: state.error, flush };
}
