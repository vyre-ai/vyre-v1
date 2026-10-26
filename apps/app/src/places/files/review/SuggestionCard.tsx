// "Intake suggests 2 changes to AGENT.md" (spec 2.14; vyre-v1.html agent file view): an agent's open suggestion for the file, its diff, Dismiss and Apply to AGENT.md.
// Reads agents.suggestions.list for the agent and the file; Apply is agents.suggestion.accept and Dismiss is agents.suggestion.dismiss. A suggestion that loosens a rule says so.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { DiffTab } from "../../../../../../ui/src/DiffTab/index.tsx";
import type { Density } from "../../../../../../ui/src/DiffTab/index.tsx";
import { acceptSuggestion, dismissSuggestion } from "./actions.ts";
import { useCap, useReviewData } from "./data.tsx";
import { suggestionHunks, suggestsLine } from "./model.ts";
import { Btn, Note } from "./parts.tsx";

export interface SuggestionCardProps {
  agentId: string;
  /** "AGENT.md". */
  file: string;
  density?: Density;
  /** The suggestion was applied: the diff that went into the file, so the editor can show the new text. */
  onApplied?(diff: string): void;
}

export function SuggestionCard({ agentId, file, density = "regular", onApplied }: SuggestionCardProps): ReactElement | null {
  const data = useReviewData();
  const q = useCap("agents.suggestions.list", { agentId, kind: "agent_md", state: ["open"] });
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<{ text: string; kind: "ok" | "error" } | null>(null);
  const open = q.status === "ready" ? q.data.suggestions.find((s) => s.file === file && s.state === "open") : undefined;
  const hunks = useMemo(() => (open ? suggestionHunks(open.diff) : []), [open]);
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
    <View style={st.card} testID="suggestion-card" role="group" aria-label={suggestsLine(who, hunks.length, file)}>
      <View style={st.head}>
        <Avatar name={who} kind="agent" size={24} testID="suggestion-face" />
        <View style={st.headText}>
          <Text accessibilityRole="header" aria-level={3} style={st.title}>{suggestsLine(who, hunks.length, file)}</Text>
          {open.reason ? <Text style={st.reason}>{open.reason}</Text> : null}
        </View>
      </View>
      {open.widening ? <Text style={st.warn} testID="suggestion-widening">This loosens a rule. An admin sees it in the overrides.</Text> : null}
      <DiffTab title={file} layout="unified" wordMarks files={[{ path: file, added: hunks.reduce((n, h) => n + (h.added ? h.added.split("\n").length : 0), 0), removed: hunks.reduce((n, h) => n + (h.removed ? h.removed.split("\n").length : 0), 0), body: "text", hunks }]} comments={[]} selectedPath={file} density={density} bare testID="suggestion-diff" />
      <View style={st.foot}>
        <Text style={st.footText} testID="suggestion-foot">Nothing changes until you apply it. The old version stays in history.</Text>
        <Btn label="Dismiss" small disabled={busy} onPress={() => go("dismiss")} testID="suggestion-dismiss" />
        <Btn label={`Apply to ${file}`} small primary disabled={busy} onPress={() => go("apply")} testID="suggestion-apply" />
      </View>
      {line ? <Note text={line.text} kind={line.kind} testID="suggestion-note" /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 12, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: "var(--line)", backgroundColor: "var(--win)" as string },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
  headText: { flex: 1, minWidth: 0 },
  title: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  reason: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  warn: { fontSize: 12.5, color: "var(--warn)" as string, paddingHorizontal: 14, paddingBottom: 6 },
  foot: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "var(--line)" },
  footText: { flexGrow: 1, flexShrink: 1, flexBasis: 200, fontSize: 12, color: "var(--ink-3)" as string },
});
