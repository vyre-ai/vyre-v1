// The "how you work" card: three short questions, answers saved to the person's own memory. Works without an AI account.
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { QUESTIONS, saveInterview } from "./interview.ts";
import type { Question } from "./interview.ts";

export function InterviewCard({ call, onSaved }: { call: CapCall; onSaved(count: number): void }): ReactElement {
  const run = useRef(globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
  const [answers, setAnswers] = useState<Partial<Record<Question["key"], string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const any = Object.values(answers).some((a) => (a ?? "").trim() !== "");
  const save = async (): Promise<void> => {
    if (busy || !any) return;
    setBusy(true); setError("");
    try { onSaved(await saveInterview(call, answers, run.current)); } catch { setError("Could not save to your memory. Try again."); } finally { setBusy(false); }
  };
  return (
    <View testID="interview-card" style={s.col}>
      {QUESTIONS.map((q) => (
        <View key={q.key} style={s.col}>
          <Text style={s.ask}>{q.ask}</Text>
          <TextInput testID={`interview-${q.key}`} accessibilityLabel={q.ask} value={answers[q.key] ?? ""} onChangeText={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))} placeholder={q.hint} multiline style={s.input} />
        </View>
      ))}
      {error ? <Text testID="interview-error" style={s.err}>{error}</Text> : null}
      <Pressable testID="interview-save" accessibilityRole="button" disabled={busy || !any} onPress={() => void save()} style={[s.primary, (busy || !any) && s.off]}><Text style={s.primaryText}>{busy ? "Saving" : "Save to my memory"}</Text></Pressable>
      <Text style={s.dim}>Kept in your own memory. You can edit or remove any of it later.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 6 },
  ask: { fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  input: { minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, color: "var(--ink)" as string, fontSize: 14 },
  dim: { fontSize: 12.5, color: "var(--ink-3)" as string },
  err: { fontSize: 13, color: "var(--danger, #c0392b)" as string },
  primary: { height: 34, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center", alignSelf: "flex-start", marginTop: 6 },
  primaryText: { fontSize: 13.5, fontWeight: "500", color: "#fff" },
  off: { opacity: 0.45 },
});
