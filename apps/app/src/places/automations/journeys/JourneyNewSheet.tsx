// New Journey type (spec 2.12): a name, the Subject (the record type each record follows) and the stages, one per line or comma. A Journey needs a Subject and at least one stage; the
// start rule can be added after. Creating one makes its record type, so the records appear in Records at once.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import { TextButton, pointer, webOnly } from "../canvas/parts.tsx";
import type { KeyEventLike } from "../canvas/parts.tsx";
import { each } from "../runs/each.ts";
import { Glyph } from "../config/glyphs.tsx";
import { PickButton } from "../config/parts.tsx";
import { joinTitles } from "./model.ts";
import type { Stage } from "./model.ts";

export const SUBJECT_CHOICES: readonly string[] = ["client", "lead", "person", "company", "matter", "project"];

/** One stage per line or comma, blanks dropped, each with the default exit rule. */
export function stagesFromText(text: string): Stage[] {
  return text.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean).map((title, order) => ({ key: `stage${order + 1}`, title, order, exit: { requireTasks: true }, tasks: [], automations: [] }));
}
export function newJourneyIssue(name: string, subject: string, stages: readonly Stage[]): string | null {
  if (!name.trim()) return "Give it a name";
  if (!subject.trim()) return "A Journey needs a Subject";
  if (stages.length === 0) return "Add at least one stage";
  const seen = new Set<string>();
  for (const s of stages) { const k = s.title.toLowerCase(); if (seen.has(k)) return `Two stages are named ${s.title}`; seen.add(k); }
  return null;
}

export function JourneyNewSheet({ onClose, initialName = "", initialSubject = "", initialStages = "Start, In progress, Done" }: { onClose(): void; initialName?: string; initialSubject?: string; initialStages?: string }): ReactElement {
  const data = useAutomationsData();
  const { element, show } = useMenu();
  const [name, setName] = useState(initialName);
  const [subject, setSubject] = useState(initialSubject);
  const [stagesText, setStagesText] = useState(initialStages);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stages = stagesFromText(stagesText);
  const issue = newJourneyIssue(name, subject, stages);
  const create = async (): Promise<void> => {
    if (issue) { setErr(issue); return; }
    setBusy(true); setErr(null);
    try {
      const out = (await data.call("journeys.create", { name: name.trim(), subjectType: subject.trim(), stages, idempotencyKey: `journey-${name.trim().toLowerCase()}-${stages.length}` })) as { journey: { id: string } };
      data.nav.openJourney(out.journey.id);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "That did not work."); setBusy(false); }
  };
  return (
    <View testID="journey-new" accessibilityLabel="New Journey type" style={s.card}>
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>New Journey type</Text>
          <Text style={s.sub}>Records of this type move through the stages you list.</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} testID="new-close" style={[s.x, pointer]}><Glyph name="x" size={14} color="var(--ink-3)" /></Pressable>
      </View>
      <View style={s.body}>
        <Text style={s.fl}>Name</Text>
        <TextInput accessibilityLabel="Journey name" testID="new-name" value={name} onChangeText={setName} placeholder="Client onboarding" placeholderTextColor="var(--ink-4)" autoFocus style={s.input} />
        <Text style={s.fl}>Subject</Text>
        <View style={s.subjectRow}>
          <TextInput accessibilityLabel="Subject" testID="new-subject" value={subject} onChangeText={setSubject} placeholder="The record each one follows" placeholderTextColor="var(--ink-4)" style={[s.input, { flex: 1 }]} />
          <PickButton label="Choose a Subject" value="Choose" testID="new-subject-pick" onPress={(x, y) => show(each(SUBJECT_CHOICES, (c) => ({ label: c, checked: c === subject, onSelect: () => setSubject(c) })), x, y, "other", { label: "Subject" })} />
        </View>
        <Text style={s.fl}>Stages</Text>
        <TextInput
          accessibilityLabel="Stages" testID="new-stages" value={stagesText} onChangeText={setStagesText} multiline placeholder="One per line, or separated by commas" placeholderTextColor="var(--ink-4)"
          {...webOnly({ onKeyDown: (e: KeyEventLike) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault?.(); void create(); } } })}
          style={[s.input, s.stagesInput]}
        />
        <Text testID="new-stage-count" style={s.hint}>{stages.length === 0 ? "No stages yet" : `${stages.length} ${stages.length === 1 ? "stage" : "stages"}: ${joinTitles(stages)}`}</Text>
        {err ? <Text testID="new-error" style={s.err}>{err}</Text> : null}
      </View>
      <View style={s.foot}>
        <View style={{ flex: 1 }} />
        <TextButton label="Cancel" testID="new-cancel" onPress={onClose} />
        <TextButton label="Make the Journey" primary disabled={issue !== null || busy} testID="new-create" onPress={() => void create()} />
      </View>
      {element}
    </View>
  );
}

const s = StyleSheet.create({
  card: { width: 480, maxWidth: "100%", borderRadius: 14, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingTop: 18, paddingHorizontal: 20, paddingBottom: 6 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string, marginTop: 2 },
  x: { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 20, paddingBottom: 14 },
  fl: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, marginTop: 14, marginBottom: 6 },
  input: { height: 32, borderRadius: 8, paddingHorizontal: 10, fontSize: 13, color: "var(--ink)" as string, backgroundColor: "var(--hover)" as string, ...({ outlineStyle: "none", outlineWidth: 0 } as object) },
  stagesInput: { height: undefined, minHeight: 72, paddingTop: 8, paddingBottom: 8 },
  subjectRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  hint: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string, marginTop: 6 },
  err: { fontSize: 12.5, color: "var(--danger)" as string, marginTop: 8 },
  foot: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
});
