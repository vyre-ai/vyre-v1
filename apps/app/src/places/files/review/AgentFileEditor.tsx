// An agent's instruction file with its lint bar (spec 2.14, 3.5; screen files.lint-bar): the bar on top, the text (or, for agent.toml, the Form) below, and a save that shows the diff first.
// Save asks files.save with the version the draft started from (baseVersion), so a save over someone else's newer version is refused, never lost. A red check blocks the save; amber saves after the diff.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { DiffTab } from "../../../../../../ui/src/DiffTab/index.tsx";
import type { Density } from "../../../../../../ui/src/DiffTab/index.tsx";
import { saveFile } from "./actions.ts";
import { useCap, useReviewData } from "./data.tsx";
import { Prose } from "../runbook/Prose.tsx";
import { LintBar } from "./LintBar.tsx";
import type { EditView } from "./LintBar.tsx";
import { draftDiff, saveBlocked } from "./model.ts";
import { Btn, Note, TextField } from "./parts.tsx";
import { TomlForm } from "./TomlForm.tsx";

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
  start?: { view?: EditView; draft?: string; review?: boolean };
  /** Shown between the lint bar and the text (the agent's suggestion card). */
  above?: ReactNode;
  /** "view": the file as read (a rendered note), "edit": the text box. The page's View and Edit switch drives it. */
  mode?: "view" | "edit";
}

/** Where a line starts in the text, so a jump from the lint bar can select it. */
export function lineRange(text: string, line: number): { start: number; end: number } {
  const lines = text.split("\n");
  let start = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) start += (lines[i] ?? "").length + 1;
  return { start, end: start + (lines[line - 1] ?? "").length };
}

export function AgentFileEditor({ fileId, name, saved, version, density = "regular", onSaved, start, above, mode = "edit" }: AgentFileEditorProps): ReactElement {
  const data = useReviewData();
  const isToml = name.endsWith(".toml");
  const [base, setBase] = useState({ text: saved, version });
  const [draft, setDraft] = useState(start?.draft ?? saved);
  const [view, setView] = useState<EditView>(start?.view ?? "text");
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [review, setReview] = useState(start?.review === true);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [line, setLine] = useState<{ text: string; kind: "ok" | "error" | "warn" } | null>(null);
  const lint = useCap("files.lint", { fileId, text: draft });
  const changed = draft !== base.text;
  const red = lint.status === "ready" && saveBlocked(lint.data);
  const diff = useMemo(() => draftDiff(name, base.text, draft), [name, base.text, draft]);

  const edit = (t: string): void => { setDraft(t); setSel(null); setLine(null); if (review) setReview(false); };
  const jump = (n: number): void => { setView("text"); setSel(lineRange(draft, n)); };

  const save = (): void => {
    if (!changed || saving || red) return;
    if (!review) { setReview(true); return; }
    setSaving(true);
    const amber = lint.status === "ready" && lint.data.state === "amber";
    void saveFile(data.call, { fileId, text: draft, baseVersion: base.version, reason, acceptWarnings: amber }).then((r) => {
      setSaving(false);
      if (r.ok) {
        setBase({ text: draft, version: r.value.n });
        setReview(false);
        setReason("");
        setLine({ kind: amber ? "warn" : "ok", text: `Saved version ${r.value.n}${amber ? " with warnings" : ""}.` });
        onSaved?.(r.value.versionId, r.value.n);
      } else setLine({ kind: "error", text: r.error });
    });
  };

  const discard = (): void => { setDraft(base.text); setSel(null); setReview(false); setLine(null); };

  return (
    <View style={st.wrap} testID="agent-file-editor">
      <LintBar fileId={fileId} name={name} text={draft} {...(isToml ? { view, onView: setView } : {})} onJump={jump} />
      {above}
      {mode === "view" && !(isToml && view === "form") ? (
        <View style={st.body} testID="agent-file-view">{isToml ? <Text style={st.mono}>{draft}</Text> : <Prose text={draft} />}</View>
      ) : isToml && view === "form" ? (
        <TomlForm text={draft} onChange={edit} />
      ) : (
        <View style={st.body}>
          <TextField multiline mono rows={14} value={draft} onChange={edit} label={`Text of ${name}`} testID="agent-file-text" {...(sel ? { selection: sel } : {})} />
        </View>
      )}
      {review && changed ? (
        <View style={st.diff} testID="agent-file-diff">
          <DiffTab title={name} layout="unified" wordMarks files={[diff]} comments={[]} selectedPath={name} density={density} bare />
          <View style={st.reason}>
            <TextField value={reason} onChange={setReason} label="Why this change" placeholder="Why? (optional)" onSubmit={save} onEscape={() => setReview(false)} testID="agent-file-reason" />
          </View>
        </View>
      ) : null}
      {mode === "view" && !changed && !line ? null : <View style={st.bar}>
        <Text style={st.status} testID="agent-file-status">{changed ? `Edited · based on version ${base.version}` : `Version ${base.version}`}</Text>
        <View style={st.grow} />
        {changed ? <Btn label="Discard edits" onPress={discard} testID="agent-file-discard" /> : null}
        <Btn
          label={review ? "Save version" : "Review and save"}
          primary
          disabled={!changed || saving || red}
          hint={red ? "Fix the errors the lint bar shows first" : "Nothing to save"}
          onPress={save}
          testID="agent-file-save"
        />
      </View>}
      {line ? <Note text={line.text} kind={line.kind} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { width: "100%" },
  body: { paddingHorizontal: 16, paddingVertical: 12 },
  diff: { paddingHorizontal: 16, paddingBottom: 8 },
  reason: { paddingTop: 8 },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  status: { fontSize: 12, color: "var(--ink-3)" as string },
  grow: { flex: 1 },
  mono: { fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--ink)" as string },
});
