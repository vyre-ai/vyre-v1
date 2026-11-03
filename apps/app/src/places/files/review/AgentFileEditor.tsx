// An agent's instruction file with its check strip (spec 2.14, 3.5; screen files.lint-bar): the strip on top, the text (or, for agent.toml, the Form) below. A .md is edited in the one Markdown editor
// (ui/RichEditor): styled by default, raw Markdown on the header's switch. Nothing is saved with a button: a pause after typing saves a new version (files.save with the version the draft started from,
// so a save over someone else's newer version is refused, never lost), and the page's header shows Saved with the version number and Undo. A red check holds the save back. Where a Space asks for a review
// (reviewRequired), an edit stays a draft; Review in the header opens the diff in the History pane, and saving is there.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, ReactElement } from "react";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { DiffTab } from "../../../../../../ui/src/DiffTab/index.tsx";
import type { Density } from "../../../../../../ui/src/DiffTab/index.tsx";
import { Autosaver, MarkdownEditor } from "../../../../../../ui/src/RichEditor/index.tsx";
import type { AutosaveState, MarkdownView } from "../../../../../../ui/src/RichEditor/index.tsx";
import { restoreVersion, saveFile } from "./actions.ts";
import { useCap, useReviewData } from "./data.tsx";
import { Prose } from "../runbook/Prose.tsx";
import { LintBar } from "./LintBar.tsx";
import { openByName, useFileLinks } from "../links.ts";
import type { EditView } from "./LintBar.tsx";
import { draftDiff, saveBlocked } from "./model.ts";
import { Btn, Note, TextField } from "./parts.tsx";
import { TomlForm } from "./TomlForm.tsx";

/** What the page's header shows about the open edit: the save state, the version, and the switches. */
export interface AgentFileHeader {
  status: AutosaveState["status"] | "draft";
  version: number;
  error: string | null;
  canUndo: boolean;
  view: MarkdownView;
  reviewRequired: boolean;
  /** An edit that is not saved yet (a draft in a Space that asks for a review). */
  changed: boolean;
}

/** What the page's header can do to the open edit. */
export interface AgentFileApi {
  undo(): void;
  review(): void;
  discard(): void;
  setView(v: MarkdownView): void;
}

export interface AgentFileEditorProps {
  fileId: string;
  /** "AGENT.md", "agent.toml". */
  name: string;
  /** The saved text and its version number. */
  saved: string;
  version: number;
  density?: Density;
  onSaved?(versionId: string, n: number): void;
  /** Where the editor opens (the screenshot mount and the tests): the Form view, an edited draft, the diff before the save. */
  start?: { view?: EditView; draft?: string; review?: boolean; mdView?: MarkdownView };
  /** Shown between the lint bar and the text (the agent's suggestion card). */
  above?: ReactNode;
  /** "view": the file as read (a rendered note), "edit": the editor. The page's View and Edit switch drives it. */
  mode?: "view" | "edit";
  /**
   * Where the diff before a save is shown. Given, the page owns a place for it (the History pane beside the file) and gets the diff, the reason box and the Save button as a node, or null when there is nothing to review;
   * the editor draws nothing under the file. Missing, the diff sits under the file.
   */
  onReviewPane?(node: ReactNode | null): void;
  /** A Space that asks for a review keeps an edit as a draft until it is reviewed; otherwise a pause after typing saves it. */
  reviewRequired?: boolean;
  /** The page's header takes the save state; without it the editor draws a quiet status line of its own. */
  onHeader?(h: AgentFileHeader): void;
  /** The page's header drives Undo, Review, Discard and the Styled/Markdown switch through this. */
  apiRef?: MutableRefObject<AgentFileApi | null>;
}

/** Where a line starts in the text, so a jump from the check strip can select it. */
export function lineRange(text: string, line: number): { start: number; end: number } {
  const lines = text.split("\n");
  let start = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) start += (lines[i] ?? "").length + 1;
  return { start, end: start + (lines[line - 1] ?? "").length };
}

/** Autosave waits this long after the last key. */
export const SAVE_PAUSE_MS = 800;

/** The header's words for the save state. */
export function statusWords(h: Pick<AgentFileHeader, "status" | "version" | "error">): string {
  switch (h.status) {
    case "saving": case "dirty": return "Saving…";
    case "saved": return `Saved · v${h.version}`;
    case "draft": return "Draft, not in use yet";
    case "error": return "Not saved";
    default: return `v${h.version}`;
  }
}

export function AgentFileEditor({ fileId, name, saved, version, density = "regular", onSaved, start, above, mode = "edit", onReviewPane, reviewRequired = false, onHeader, apiRef }: AgentFileEditorProps): ReactElement {
  const data = useReviewData();
  const isToml = name.endsWith(".toml");
  const [draft, setDraft] = useState(start?.draft ?? saved);
  const [view, setView] = useState<EditView>(start?.view ?? "text");
  const [mdView, setMdView] = useState<MarkdownView>(start?.mdView ?? "styled");
  const [jump, setJump] = useState<{ line: number; n: number } | null>(null);
  const [review, setReview] = useState(start?.review === true);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [line, setLine] = useState<{ text: string; kind: "ok" | "error" | "warn" } | null>(null);
  const [auto, setAuto] = useState<AutosaveState>({ status: "idle", version, error: null, undoTo: null });
  const [base, setBase] = useState({ text: saved, version });
  const lint = useCap("files.lint", { fileId, text: draft });
  // the folder the file is in, so the names written in it can be looked up beside it
  const [folderId, setFolderId] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void (data.call("files.get", { fileId }) as Promise<{ file: { folderId: string } }>).then((o) => { if (live) setFolderId(o.file.folderId); }, () => undefined);
    return () => { live = false; };
  }, [data, fileId]);
  const links = useFileLinks(data, folderId !== null ? { folderId } : null, mode === "view" && !isToml ? draft : "");
  const red = lint.status === "ready" && saveBlocked(lint.data);
  const amber = lint.status === "ready" && lint.data.state === "amber";

  // the latest facts for the save, which runs from a timer
  const latest = useRef({ red, amber, call: data.call, onSaved });
  latest.current = { red, amber, call: data.call, onSaved };
  const saverRef = useRef<Autosaver | null>(null);
  if (saverRef.current === null) {
    saverRef.current = new Autosaver({
      delay: SAVE_PAUSE_MS,
      saved: { text: saved, version },
      save: async (text) => {
        if (latest.current.red) return { ok: false, error: "Not saved yet: fix the red checks first." };
        const r = await saveFile(latest.current.call, { fileId, text, baseVersion: saverRef.current?.state.version ?? version, reason: "", acceptWarnings: latest.current.amber });
        if (!r.ok) return { ok: false, error: r.error };
        latest.current.onSaved?.(r.value.versionId, r.value.n);
        return { ok: true, version: r.value.n };
      },
    });
  }
  const saver = saverRef.current;
  useEffect(() => saver.subscribe(setAuto), [saver]);
  useEffect(() => () => { void saver.flush(); saver.destroy(); }, [saver]);
  // a text that came in from outside (a restored version, an applied suggestion) is the file now
  useEffect(() => {
    if (saved === base.text && version === base.version) return;
    setBase({ text: saved, version });
    setDraft(saved);
    saver.reset({ text: saved, version });
  }, [saved, version]);
  // a draft the editor was opened with is saved (or kept for review) like any edit
  useEffect(() => { if (start?.draft !== undefined && start.draft !== saved && !reviewRequired && !review) saver.edit(start.draft); }, []);

  const changed = draft !== base.text && (reviewRequired || review);
  const diff = useMemo(() => draftDiff(name, base.text, draft), [name, base.text, draft]);

  const edit = useCallback((t: string): void => {
    setDraft(t);
    setLine(null);
    if (reviewRequired) { if (review) setReview(false); return; }
    saver.edit(t);
  }, [saver, reviewRequired, review]);
  const flush = useCallback((): void => { void saver.flush(); }, [saver]);
  const doJump = (n: number): void => { setView("text"); setJump({ line: n, n: (jump?.n ?? 0) + 1 }); };

  const undo = useCallback((): void => {
    const to = saver.state.undoTo;
    if (to === null) return;
    void (async () => {
      try {
        const list = (await data.call("files.versions", { fileId })) as { versions: { n: number; versionId: string }[] };
        const v = list.versions.find((x) => x.n === to);
        if (!v) { setLine({ kind: "error", text: "That version is not there to go back to." }); return; }
        const r = await restoreVersion(data.call, fileId, v.versionId);
        if (!r.ok) { setLine({ kind: "error", text: r.error }); return; }
        const read = (await data.call("files.read", { fileId, versionId: v.versionId, as: "text" })) as { text?: string };
        const text = read.text ?? "";
        setDraft(text);
        setBase({ text, version: r.value.n });
        saver.undone(text, r.value.n);
        setLine({ kind: "ok", text: `Went back to version ${to}, saved as version ${r.value.n}.` });
        onSaved?.(r.value.versionId, r.value.n);
      } catch { setLine({ kind: "error", text: "Could not go back. Try again." }); }
    })();
  }, [saver, data, fileId, onSaved]);

  const discard = useCallback((): void => { setDraft(base.text); setReview(false); setLine(null); }, [base.text]);

  // the save after a review
  const saveReviewed = (): void => {
    if (!changed || saving || red) return;
    setSaving(true);
    void saveFile(data.call, { fileId, text: draft, baseVersion: base.version, reason, acceptWarnings: amber }).then((r) => {
      setSaving(false);
      if (r.ok) {
        setBase({ text: draft, version: r.value.n });
        saver.reset({ text: draft, version: r.value.n });
        setReview(false);
        setReason("");
        setLine({ kind: amber ? "warn" : "ok", text: `Saved version ${r.value.n}${amber ? " with warnings" : ""}.` });
        onSaved?.(r.value.versionId, r.value.n);
      } else setLine({ kind: "error", text: r.error });
    });
  };
  const saveNow = useRef(saveReviewed);
  saveNow.current = saveReviewed;
  const reviewing = review && changed;
  useEffect(() => {
    onReviewPane?.(reviewing ? (
      <View style={st.pane} testID="agent-file-diff">
        <DiffTab title={name} layout="unified" wordMarks files={[diff]} comments={[]} selectedPath={name} density="compact" bare />
        <View style={st.reason}>
          <TextField value={reason} onChange={setReason} label="Why this change" placeholder="Why? (optional)" onSubmit={() => saveNow.current()} onEscape={() => setReview(false)} testID="agent-file-reason" />
          <View style={st.reasonRow}>
            <Btn label="Keep editing" small onPress={() => setReview(false)} testID="agent-file-keep" />
            <Btn label="Save version" primary small disabled={saving || red} hint="Fix the errors the checks show first" onPress={() => saveNow.current()} testID="agent-file-save" />
          </View>
        </View>
      </View>
    ) : null);
  }, [onReviewPane, reviewing, diff, name, reason, saving, red]);
  // The page keeps no diff of a file that is gone.
  useEffect(() => () => onReviewPane?.(null), [onReviewPane]);

  // what the page's header shows
  const status: AgentFileHeader["status"] = reviewRequired && draft !== base.text ? "draft" : auto.status;
  const header: AgentFileHeader = { status, version: reviewRequired ? base.version : auto.version, error: auto.error, canUndo: auto.undoTo !== null && !reviewRequired, view: mdView, reviewRequired, changed: reviewRequired && draft !== base.text };
  const headerKey = JSON.stringify(header);
  useEffect(() => { onHeader?.(header); }, [headerKey, onHeader]);
  useEffect(() => {
    if (!apiRef) return undefined;
    apiRef.current = { undo, review: () => { if (draft !== base.text) setReview(true); }, discard, setView: setMdView };
    return () => { apiRef.current = null; };
  }, [apiRef, undo, discard, draft, base.text]);
  const quiet = onHeader === undefined;

  return (
    <View style={st.wrap} testID="agent-file-editor">
      <LintBar fileId={fileId} name={name} text={draft} {...(isToml ? { view, onView: setView } : {})} onJump={doJump} {...(folderId !== null && data.openFileTab ? { onOpenName: (n: string, background: boolean) => void openByName(data, folderId, n, background) } : {})} />
      {above}
      {mode === "view" && !(isToml && view === "form") ? (
        <View style={st.body} testID="agent-file-view">{isToml ? <Text style={st.mono}>{draft}</Text> : <Prose text={draft} links={links} />}</View>
      ) : isToml && view === "form" ? (
        <TomlForm text={draft} onChange={edit} issues={lint.status === "ready" ? lint.data.problems : []} />
      ) : isToml ? (
        <View style={st.body}>
          <TextField multiline mono rows={14} value={draft} onChange={edit} label={`Text of ${name}`} testID="agent-file-text" {...(jump ? { selection: lineRange(draft, jump.line) } : {})} />
        </View>
      ) : (
        <View style={st.editor}>
          <MarkdownEditor value={draft} onChange={edit} view={mdView} onView={setMdView} toggle={false} label={`Text of ${name}`} density={density === "compact" ? "compact" : "regular"} jump={jump} onSave={flush} testID="agent-file-text" placeholder="Write the instructions" />
        </View>
      )}
      {reviewing && !onReviewPane ? (
        <View style={st.diff} testID="agent-file-diff">
          <DiffTab title={name} layout="unified" wordMarks files={[diff]} comments={[]} selectedPath={name} density={density} bare />
          <View style={st.reason}>
            <TextField value={reason} onChange={setReason} label="Why this change" placeholder="Why? (optional)" onSubmit={saveReviewed} onEscape={() => setReview(false)} testID="agent-file-reason" />
            <View style={st.reasonRow}>
              <Btn label="Keep editing" small onPress={() => setReview(false)} testID="agent-file-keep" />
              <Btn label="Save version" primary small disabled={saving || red} hint="Fix the errors the checks show first" onPress={saveReviewed} testID="agent-file-save" />
            </View>
          </View>
        </View>
      ) : null}
      {quiet && mode === "edit" ? <Text style={st.status} testID="agent-file-status">{statusWords(header)}</Text> : null}
      {line ? <Note text={line.text} kind={line.kind} /> : null}
      {auto.status === "error" && auto.error ? <Note text={auto.error} kind="error" /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { width: "100%" },
  body: { paddingHorizontal: 16, paddingVertical: 12 },
  editor: { minHeight: 280 },
  diff: { paddingHorizontal: 16, paddingBottom: 8 },
  reason: { paddingTop: 8, gap: 8 },
  reasonRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  pane: { paddingHorizontal: 12, paddingBottom: 8 },
  status: { fontSize: 12, color: "var(--ink-3)" as string, paddingHorizontal: 16, paddingVertical: 8 },
  mono: { fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--ink)" as string },
});
