// "Intake suggests 2 changes to AGENT.md" (spec 2.14; vyre-v1.html agent file view): an agent's open suggestion for the file, its diff, Dismiss and Apply to AGENT.md.
// Reads agents.suggestions.list for the agent and the file; Apply is agents.suggestion.accept and Dismiss is agents.suggestion.dismiss. A suggestion that loosens a rule says so.
import { Card, CardActions, CardHead } from "../../../../../../ui/src/Card/index.tsx";
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { DiffTab } from "../../../../../../ui/src/DiffTab/index.tsx";
import type { Density } from "../../../../../../ui/src/DiffTab/index.tsx";
import { acceptSuggestion, dismissSuggestion } from "./actions.ts";
import { useCap, useReviewData } from "./data.tsx";
import { applySuggestionStrict, diffNote, draftDiff, suggestionHunks, suggestsLine } from "./model.ts";
import { Note } from "./parts.tsx";

export interface SuggestionCardProps {
  agentId: string;
  /** "AGENT.md". */
  file: string;
  density?: Density;
  /**
   * The file as it is now. With it, the card shows the diff of that text against the text the suggestion makes of it, computed here as a line diff of the two real texts; the suggestion's own diff is only how the change is stored.
   * A suggestion that does not fit this text says so and cannot be applied. Without it the card draws the stored diff.
   */
  text?: string;
  /** The suggestion was applied: the diff that went into the file, so the editor can show the new text. */
  onApplied?(diff: string): void;
}

export function SuggestionCard({ agentId, file, density = "regular", text, onApplied }: SuggestionCardProps): ReactElement | null {
  const data = useReviewData();
  const q = useCap("agents.suggestions.list", { agentId, kind: "agent_md", state: ["open"] });
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<{ text: string; kind: "ok" | "error" } | null>(null);
  const open = q.status === "ready" ? q.data.suggestions.find((s) => s.file === file && s.state === "open") : undefined;
  // the text the suggestion makes of the file, and the diff of the two texts: what the card shows is what Apply writes
  const after = useMemo(() => (open && text !== undefined ? applySuggestionStrict(text, open.diff) : null), [open, text]);
  const fits = text === undefined || after !== null;
  const real = useMemo(() => (text !== undefined && after !== null ? draftDiff(file, text, after) : null), [text, after, file]);
  const hunks = useMemo(() => (real ? real.hunks : open && text === undefined ? suggestionHunks(open.diff) : []), [real, open, text]);
  if (!open) return line ? <Note text={line.text} kind={line.kind} testID="suggestion-note" /> : null;

  const go = (what: "apply" | "dismiss"): void => {
    if (busy) return;
    setBusy(true);
    const p = what === "apply" ? acceptSuggestion(data.call, open.suggestionId) : dismissSuggestion(data.call, open.suggestionId);
    void p.then((r) => {
      setBusy(false);
      if (r.ok && what === "apply") onApplied?.(open.diff);
      setLine(r.ok ? { kind: "ok", text: what === "apply" ? `Applied to ${file}. The next version shows in History.` : "Dismissed." } : { kind: "error", text: r.error });
    });
  };

  const who = data.nameOf(agentId);
  return (
    <View style={st.wrap}>
    <Card kind="result" testID="suggestion-card" label={suggestsLine(who, hunks.length, file)}>
      <CardHead title={suggestsLine(who, hunks.length, file)} {...(open.reason ? { meta: open.reason } : {})} lead={<Avatar name={who} kind="agent" size={24} testID="suggestion-face" />} />
      {open.widening ? <Text style={st.warn} testID="suggestion-widening">This loosens a rule. An admin sees it in the overrides.</Text> : null}
      {text !== undefined && after !== null && text === after ? <Text style={st.same} testID="suggestion-nochange">No changes. The file already says this.</Text> : null}
      {!fits ? <Text style={st.warn} testID="suggestion-stale">This suggestion no longer fits the file as it is now. Dismiss it, and Intake can suggest again.</Text> : null}
      {text !== undefined && after !== null && diffNote(text, after) ? <Text style={st.same} testID="suggestion-note-eol">{diffNote(text, after)}</Text> : null}
      {fits ? <DiffTab title={file} layout="unified" wordMarks files={[real ?? { path: file, added: hunks.reduce((n, h) => n + (h.added ? h.added.split("\n").length : 0), 0), removed: hunks.reduce((n, h) => n + (h.removed ? h.removed.split("\n").length : 0), 0), body: "text", hunks }]} comments={[]} selectedPath={file} density={density} bare testID="suggestion-diff" /> : null}
      <CardActions
        busy={busy}
        primary={{ label: `Apply to ${file}`, disabled: !fits, onPress: () => go("apply"), testID: "suggestion-apply" }}
        secondary={[{ label: "Dismiss", onPress: () => go("dismiss"), testID: "suggestion-dismiss" }]}
        note={<Text style={st.footText} testID="suggestion-foot" {...{ title: "The old version stays in History." }}>Nothing changes until you apply it.</Text>}
      />
      {line ? <Note text={line.text} kind={line.kind} testID="suggestion-note" /> : null}
    </Card>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { marginHorizontal: 16 },
  same: { fontSize: 12.5, color: "var(--ink-3)" as string },
  warn: { fontSize: 12.5, color: "var(--warn)" as string },
  footText: { flexGrow: 1, flexShrink: 1, flexBasis: 200, fontSize: 12, color: "var(--ink-3)" as string },
});
