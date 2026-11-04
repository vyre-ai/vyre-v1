// A file's text that saves itself as new versions: the draft, the save state, Undo and an outside change that replaces the draft. The one place the rule lives, so every editor of a file
// (AGENT.md and agent.toml in Files review, a .md in the viewer) saves the same way: files.save with the version the draft started from (a save over a newer version is refused, never lost),
// after a pause, one at a time; Undo restores the version before as a new version.
import { useCallback, useEffect, useRef, useState } from "react";
import { Autosaver } from "../../../../../../ui/src/RichEditor/index.tsx";
import type { AutosaveState } from "../../../../../../ui/src/RichEditor/index.tsx";
import { restoreVersion, saveFile } from "./actions.ts";
import type { Call } from "./actions.ts";

export interface FileAutosaveOptions {
  call: Call;
  fileId: string;
  /** The text the file has now, and its version. A change to either from outside replaces the draft. */
  saved: string;
  version: number;
  /** The first draft, when the editor opens on an edit (a mount, a test). */
  startDraft?: string;
  /** A sentence when the draft must not be saved yet (a red check); null otherwise. */
  blocked?: () => string | null;
  /** Warnings are accepted by the save. */
  acceptWarnings?: () => boolean;
  /** Edits stay drafts: nothing saves by itself (a Space that asks for a review). */
  manual?: boolean;
  /** The saved reason, for the version history. */
  reason?: string;
  pause?: number;
  onSaved?: (versionId: string, n: number) => void;
}

export interface FileAutosave {
  draft: string;
  setDraft: (t: string) => void;
  /** The text and version the file is at (what a diff is against). */
  base: { text: string; version: number };
  auto: AutosaveState;
  /** An edit is made: kept as a draft and, unless manual, saved after the pause. */
  edit: (t: string) => void;
  flush: () => void;
  /** Go back to the version before the last save, saved as a new version. */
  undo: () => void;
  /** Save the draft now with a reason and the version it started from (the save after a review). */
  saveReviewed: (reason: string) => Promise<{ ok: true; n: number } | { ok: false; error: string }>;
  discard: () => void;
  line: { text: string; kind: "ok" | "error" | "warn" } | null;
  setLine: (l: { text: string; kind: "ok" | "error" | "warn" } | null) => void;
}

export function useFileAutosave(o: FileAutosaveOptions): FileAutosave {
  const [draft, setDraft] = useState(o.startDraft ?? o.saved);
  const [base, setBase] = useState({ text: o.saved, version: o.version });
  const [auto, setAuto] = useState<AutosaveState>({ status: "idle", version: o.version, error: null, undoTo: null });
  const [line, setLine] = useState<FileAutosave["line"]>(null);
  const latest = useRef(o);
  latest.current = o;
  const ref = useRef<Autosaver | null>(null);
  if (ref.current === null) {
    ref.current = new Autosaver({
      delay: o.pause ?? 800,
      saved: { text: o.saved, version: o.version },
      save: async (text) => {
        const cur = latest.current;
        const why = cur.blocked?.() ?? null;
        if (why !== null) return { ok: false, error: why };
        const r = await saveFile(cur.call, { fileId: cur.fileId, text, baseVersion: ref.current?.state.version ?? cur.version, reason: cur.reason ?? "", acceptWarnings: cur.acceptWarnings?.() === true });
        if (!r.ok) return { ok: false, error: r.error };
        setBase({ text, version: r.value.n });
        cur.onSaved?.(r.value.versionId, r.value.n);
        return { ok: true, version: r.value.n };
      },
    });
  }
  const saver = ref.current;
  useEffect(() => saver.subscribe(setAuto), [saver]);
  useEffect(() => () => { void saver.flush(); saver.destroy(); }, [saver]);
  useEffect(() => {
    if (o.saved === base.text && o.version === base.version) return;
    setBase({ text: o.saved, version: o.version });
    setDraft(o.saved);
    saver.reset({ text: o.saved, version: o.version });
  }, [o.saved, o.version]);
  useEffect(() => { if (o.startDraft !== undefined && o.startDraft !== o.saved && o.manual !== true) saver.edit(o.startDraft); }, []);

  const edit = useCallback((t: string): void => { setDraft(t); setLine(null); if (latest.current.manual !== true) saver.edit(t); }, [saver]);
  const flush = useCallback((): void => { void saver.flush(); }, [saver]);
  const undo = useCallback((): void => {
    const to = saver.state.undoTo;
    if (to === null) return;
    const cur = latest.current;
    void (async () => {
      try {
        const list = (await cur.call("files.versions", { fileId: cur.fileId })) as { versions: { n: number; versionId: string }[] };
        const v = list.versions.find((x) => x.n === to);
        if (!v) { setLine({ kind: "error", text: "That version is not there to go back to." }); return; }
        const r = await restoreVersion(cur.call, cur.fileId, v.versionId);
        if (!r.ok) { setLine({ kind: "error", text: r.error }); return; }
        const read = (await cur.call("files.read", { fileId: cur.fileId, versionId: v.versionId, as: "text" })) as { text?: string };
        const text = read.text ?? "";
        setDraft(text);
        setBase({ text, version: r.value.n });
        saver.undone(text, r.value.n);
        setLine({ kind: "ok", text: `Went back to version ${to}, saved as version ${r.value.n}.` });
        cur.onSaved?.(r.value.versionId, r.value.n);
      } catch { setLine({ kind: "error", text: "Could not go back. Try again." }); }
    })();
  }, [saver]);
  const saveReviewed = useCallback(async (reason: string) => {
    const cur = latest.current;
    const r = await saveFile(cur.call, { fileId: cur.fileId, text: draftRef.current, baseVersion: baseRef.current.version, reason, acceptWarnings: cur.acceptWarnings?.() === true });
    if (!r.ok) return { ok: false as const, error: r.error };
    setBase({ text: draftRef.current, version: r.value.n });
    saver.reset({ text: draftRef.current, version: r.value.n });
    cur.onSaved?.(r.value.versionId, r.value.n);
    return { ok: true as const, n: r.value.n };
  }, [saver]);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baseRef = useRef(base);
  baseRef.current = base;
  const discard = useCallback((): void => { setDraft(baseRef.current.text); setLine(null); }, []);
  return { draft, setDraft, base, auto, edit, flush, undo, saveReviewed, discard, line, setLine };
}
