// "Link automatically": one sheet to make a rule. A rule links matching things from now on (a repository's pull requests, records that match, email from a domain); they carry an auto mark and can be unlinked one by one.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../../../ui/src/Dialog/index.tsx";
import { TextField } from "../../../../../../../ui/src/TextField/index.tsx";
import { useProjectPageData } from "../data.tsx";
import { EMPTY_RULE, RULE_KINDS, ruleBody, ruleInput, ruleProblem } from "./model.ts";
import type { Rule, RuleForm } from "./model.ts";

export function RuleSheet({ projectId, rules, onClose, onAdded }: { projectId: string; rules: readonly Rule[]; onClose(): void; onAdded(): void }): ReactElement {
  const d = useProjectPageData();
  const [f, setF] = useState<RuleForm>(EMPTY_RULE);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<RuleForm>): void => { setF((c) => ({ ...c, ...p })); setProblem(""); };
  const add = async (): Promise<void> => {
    const bad = ruleProblem(f);
    if (bad !== "") { setProblem(bad); return; }
    setBusy(true);
    try {
      await d.call("projects.links.rules.set", { projectId, rules: [...rules.map(ruleInput), ruleBody(f)] });
      onAdded();
    } catch (e) { setProblem(e instanceof Error && e.message ? e.message : "The rule could not be added."); } finally { setBusy(false); }
  };
  const field = (id: string, label: string, key: keyof RuleForm, placeholder: string): ReactElement => (
    <View style={st.field}><Text style={st.label}>{label}</Text><TextField testID={`rule-${id}`} accessibilityLabel={label} value={f[key]} onChangeText={(v) => set({ [key]: v } as Partial<RuleForm>)} placeholder={placeholder} placeholderTextColor="var(--ink-4)" style={st.input} /></View>
  );
  return (
    <Dialog title="Link automatically" onClose={onClose} width={480} testID="rule-sheet" actions={[{ label: "Cancel", onPress: onClose, testID: "rule-cancel" }, { label: "Add rule", primary: true, disabled: busy, onPress: () => void add(), testID: "rule-add" }]}>
      <Text style={st.lead}>A rule links matching things from now on. They show an auto mark and can be unlinked one by one.</Text>
      <View accessibilityRole="radiogroup" style={st.kinds}>
        {RULE_KINDS.map((k) => (
          <Pressable key={k.key} accessibilityRole="radio" accessibilityState={{ checked: f.kind === k.key }} testID={`rule-kind-${k.key}`} onPress={() => set({ kind: k.key })} style={({ hovered }: { hovered?: boolean }) => [st.kind, f.kind === k.key && st.kindOn, hovered === true && st.hover]}>
            <View style={[st.dot, f.kind === k.key && st.dotOn]} /><View style={{ flex: 1 }}><Text style={st.kindTitle}>{k.label}</Text><Text style={st.lead}>{k.hint}</Text></View>
          </Pressable>
        ))}
      </View>
      {f.kind === "repo" ? field("repo", "Repository", "repo", "owner/repo") : null}
      {f.kind === "email_domain" ? field("domain", "Domain", "domain", "client.com") : null}
      {f.kind === "record_filter" ? <>{field("type", "Record type", "recordType", "invoice")}{field("field", "Field", "field", "client")}{field("equals", "Equals", "equals", "Rivera")}</> : null}
      {problem !== "" ? <Text accessibilityRole="alert" testID="rule-problem" style={st.problem}>{problem}</Text> : null}
    </Dialog>
  );
}

const st = StyleSheet.create({
  lead: { fontSize: 12.5, color: "var(--ink-3)" as string },
  kinds: { gap: 4, marginTop: 8, marginBottom: 8 },
  kind: { flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: 9 },
  kindOn: { backgroundColor: "var(--sel)" as string },
  hover: { backgroundColor: "var(--hover)" },
  kindTitle: { fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: "var(--ink-4)" as string },
  dotOn: { borderColor: "var(--accent)" as string, backgroundColor: "var(--accent)" as string },
  field: { marginTop: 6 },
  label: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string, marginBottom: 4 },
  input: { height: 34, paddingHorizontal: 11, borderRadius: 9, backgroundColor: "var(--sunk)" as string, color: "var(--ink)" as string, fontSize: 13.5 },
  problem: { fontSize: 12.5, color: "var(--danger)" as string, marginTop: 8 },
});
