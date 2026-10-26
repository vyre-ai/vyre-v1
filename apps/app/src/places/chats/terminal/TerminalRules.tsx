// Terminal rules (spec 2.7, 4.17, registry screen chats.terminal-rules): the person's own allow, ask and deny lists and the folders a command may work in, one entry per line. A command
// that starts like an entry on Never allow does not run, one on Ask first waits for a yes, one on Always allow runs. terminal.rules.get fills the sheet; Save sends terminal.rules.set,
// and what comes back (an entry on two lists stays only on the stronger one) is what the sheet then shows.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { errorWords, useLive } from "../mounts/live.ts";
import { LayerHead, Sheet } from "../mounts/Layers.tsx";
import { Icon, TextButton } from "../rightpane/parts.tsx";
import { RULES_SCREEN } from "./data.ts";
import { saveRules } from "./session.ts";
import type { TerminalData } from "./data.ts";
import { MAX_RULES, NO_RULES, RULE_EXAMPLE, RULE_LISTS, RULE_NOTE, RULE_TITLE, linesText, parseLines, rulesProblem, sameRules } from "./model.ts";
import type { RuleList, Rules } from "./model.ts";

type RulesOut = CapMap["terminal.rules.get"]["out"];

const textOf = (r: Rules): Record<RuleList, string> => ({ allow: linesText(r.allow), ask: linesText(r.ask), deny: linesText(r.deny), folders: linesText(r.folders) });

export function TerminalRules({ data, onClose }: { data: TerminalData; onClose: () => void }): ReactElement {
  const q = useLive<RulesOut>(data.screens, RULES_SCREEN, "rules", {});
  const saved: Rules = q.status === "ready" ? q.data.rules : NO_RULES;
  const [text, setText] = useState<Record<RuleList, string>>(() => textOf(saved));
  const [dirty, setDirty] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The sheet shows what the Space keeps until the person types; after that their text is theirs.
  useEffect(() => {
    if (q.status !== "ready" || dirty) return;
    setText(textOf(saved));
  }, [q.status, saved, dirty]);

  const draft: Rules = { allow: parseLines(text.allow), ask: parseLines(text.ask), deny: parseLines(text.deny), folders: parseLines(text.folders) };
  const problem = rulesProblem(draft);
  const changed = !sameRules(draft, saved);
  const total = RULE_LISTS.reduce((n, k) => n + draft[k].length, 0);

  const save = (): void => {
    if (busy || problem !== null) return;
    setBusy(true);
    void saveRules({ call: data.call, newKey: data.newKey }, draft).then(
      (r) => {
        setText(textOf(r));
        setLine("Saved. New commands follow these rules at once.");
        setBusy(false);
      },
      (e: unknown) => { setLine(errorWords(e, "Could not save the rules.")); setBusy(false); },
    );
  };
  const revert = (): void => { setDirty(false); setLine(null); };

  const boxes: ReactElement[] = [];
  for (const k of RULE_LISTS) {
    boxes.push(
      <View key={k} testID={`rules-${k}`} style={st.group}>
        <View style={st.groupHead}>
          <Text style={st.groupTitle}>{RULE_TITLE[k]}</Text>
          <Text style={st.count}>{draft[k].length}</Text>
        </View>
        <Text style={st.note}>{RULE_NOTE[k]}</Text>
        <TextInput
          testID={`rules-input-${k}`} accessibilityLabel={RULE_TITLE[k]} multiline numberOfLines={3} value={text[k]}
          placeholder={RULE_EXAMPLE[k]} placeholderTextColor="var(--ink-4)" autoCapitalize="none" autoCorrect={false} spellCheck={false}
          onChangeText={(t) => { setDirty(true); setLine(null); setText((cur) => ({ ...cur, [k]: t })); }}
          style={st.input}
        />
      </View>,
    );
  }

  return (
    <Sheet label="Terminal rules" testID="terminal-rules" width={520} onClose={onClose}>
      <LayerHead title="Terminal rules" sub="What a command may do on your terminals and on agents' computers. One entry per line." lead={<Icon name="terminal" size={16} />} onClose={onClose} />
      <ScrollView style={st.body} contentContainerStyle={st.bodyIn}>{boxes}</ScrollView>
      {problem ? <Text testID="rules-problem" accessibilityRole="alert" style={st.problem}>{problem}</Text> : null}
      {line ? <Text testID="rules-line" accessibilityLiveRegion="polite" style={st.line}>{line}</Text> : null}
      <View style={st.foot}>
        <Text style={st.total}>{`${total} of ${MAX_RULES}`}</Text>
        <View style={{ flex: 1 }} />
        <TextButton label="Revert" onPress={revert} disabled={!changed || busy} testID="rules-revert" />
        <TextButton label="Save" primary onPress={save} disabled={!changed || problem !== null || busy} testID="rules-save" />
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  body: { flexShrink: 1, maxHeight: 460 },
  bodyIn: { paddingHorizontal: 14, paddingBottom: 6, gap: 14 },
  group: { gap: 4 },
  groupHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  groupTitle: { fontSize: 12.5, fontWeight: "600", color: "var(--ink)" as string },
  count: { fontSize: 11.5, color: "var(--ink-4)" as string, fontVariant: ["tabular-nums"] },
  note: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  input: { minHeight: 64, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--win)" as string, color: "var(--ink)" as string, fontSize: 12.5, lineHeight: 18, fontFamily: "var(--mono, ui-monospace, Menlo, monospace)" as string },
  problem: { fontSize: 12.5, color: "var(--danger)" as string, paddingHorizontal: 14, paddingTop: 6 },
  line: { fontSize: 12.5, color: "var(--ink-2)" as string, paddingHorizontal: 14, paddingTop: 6 },
  foot: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
  total: { fontSize: 12, color: "var(--ink-3)" as string },
});
