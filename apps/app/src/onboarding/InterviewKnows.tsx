// "Vyre knows": the three answers of the How you work step as lines, when an AI account is connected and the Assistant leads the talk. A line is whatever the person's memory holds (the Assistant
// saves each answer as the person gives it), each one editable in place and removable, and the list follows the memory while the talk goes on. The step is done when all three exist.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TextField } from "../../../../ui/src/TextField/index.tsx";
import { RADIUS } from "../../../../ui/src/tokens/radius.ts";
import type { CapCall } from "../shell/session/caps.ts";
import { CARD } from "./card-style.ts";
import { LABELS, QUESTIONS, interviewDone, loadKnown, removeKnown, saveInterviewEdit } from "./interview.ts";
import type { Question, SavedAnswers } from "./interview.ts";
import { Glyph } from "./StepGlyph.tsx";

/** The person's three answers as the memory holds them, read again every two seconds while `on` (the Assistant saves them from the chat) and after every edit. */
export function useKnown(
  call: CapCall | null,
  on: boolean,
): { saved: SavedAnswers; refresh(): Promise<void>; error: boolean } {
  const [saved, setSaved] = useState<SavedAnswers>({});
  const [error, setError] = useState(false);
  const live = useRef(true);
  const refresh = useCallback(async (): Promise<void> => {
    if (!call) return;
    try {
      const next = await loadKnown(call);
      if (!live.current) return;
      setSaved((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
      setError(false);
    } catch {
      if (live.current) setError(true);
    }
  }, [call]);
  useEffect(() => {
    live.current = true;
    if (!on) return undefined;
    void refresh();
    const t = setInterval(() => void refresh(), 2000);
    return () => {
      live.current = false;
      clearInterval(t);
    };
  }, [on, refresh]);
  return { saved, refresh, error };
}

export function InterviewKnows({
  call,
  saved,
  refresh,
  gate,
  onByHand,
}: {
  call: CapCall;
  saved: SavedAnswers;
  refresh(): Promise<void>;
  gate?(save: (() => Promise<boolean>) | null, label?: string): void;
  /** the way out when the Assistant cannot answer (an account whose program is not installed, no connection): the same three questions as a form */
  onByHand?(): void;
}): ReactElement {
  const [editing, setEditing] = useState<Question["key"] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useRef(globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
  const done = interviewDone(saved);
  // Continue is there once all three are saved; until then the talk is the way forward
  useEffect(() => {
    if (!gate) return undefined;
    if (done) gate(async () => true, "Continue");
    else gate(null);
    return () => gate(null);
  }, [gate, done]);
  const begin = (k: Question["key"]): void => {
    setEditing(k);
    setText(saved[k]?.text ?? "");
    setError("");
  };
  const keep = async (k: Question["key"]): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await saveInterviewEdit(call, { [k]: text }, run.current, saved);
      await refresh();
      setEditing(null);
    } catch {
      setError("Could not save to your memory. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const drop = async (k: Question["key"]): Promise<void> => {
    const fact = saved[k];
    if (!fact || busy) return;
    setBusy(true);
    setError("");
    try {
      await removeKnown(call, fact.factId);
      await refresh();
    } catch {
      setError("Could not remove that. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const rows: ReactElement[] = [];
  for (const q of QUESTIONS) {
    const fact = saved[q.key];
    rows.push(
      <View key={q.key} testID={`knows-${q.key}`} style={[s.row, editing === q.key && s.rowEdit]}>
        <Text style={s.label}>{LABELS[q.key]}</Text>
        {editing === q.key ? (
          <View style={s.edit}>
            <TextField
              testID={`knows-edit-${q.key}`}
              accessibilityLabel={LABELS[q.key]}
              value={text}
              onChangeText={setText}
              autoCorrect={false}
              onSubmitEditing={() => void keep(q.key)}
              style={s.input}
            />
            <Pressable
              testID={`knows-save-${q.key}`}
              accessibilityRole="button"
              disabled={busy || text.trim() === ""}
              onPress={() => void keep(q.key)}
              style={[s.small, (busy || text.trim() === "") && s.off]}
            >
              <Text style={s.smallText}>Save</Text>
            </Pressable>
            <Pressable
              testID={`knows-cancel-${q.key}`}
              accessibilityRole="button"
              onPress={() => setEditing(null)}
              style={s.ghost}
            >
              <Text style={s.ghostText}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <View style={s.value}>
            <Text testID={`knows-text-${q.key}`} style={fact ? s.text : s.none} numberOfLines={2}>
              {fact ? fact.text : "Not yet"}
            </Text>
            {fact ? (
              <>
                <Pressable
                  testID={`knows-change-${q.key}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Change: ${LABELS[q.key]}`}
                  onPress={() => begin(q.key)}
                  style={s.icon}
                >
                  <Glyph paths={["M3 13l.700-3L11 2.700 13.300 5 6 12.300z"]} size={13} color="var(--ink-3)" />
                </Pressable>
                <Pressable
                  testID={`knows-remove-${q.key}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove: ${LABELS[q.key]}`}
                  onPress={() => void drop(q.key)}
                  style={s.icon}
                >
                  <Glyph paths={["M4 4l8 8M12 4l-8 8"]} size={12} color="var(--ink-3)" width={2} />
                </Pressable>
              </>
            ) : null}
          </View>
        )}
      </View>,
    );
  }
  return (
    <View testID="interview-knows" style={s.col}>
      <Text style={s.head} accessibilityRole="header">
        Vyre knows
      </Text>
      <View style={s.list}>{rows}</View>
      {onByHand && !done ? (
        <Pressable testID="interview-by-hand" accessibilityRole="link" onPress={onByHand}>
          <Text style={s.hand}>Fill it in myself</Text>
        </Pressable>
      ) : null}
      {error ? (
        <Text testID="knows-error" style={s.err}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 10 },
  head: { fontSize: 15, lineHeight: 22, fontWeight: "600", color: "var(--ink)" as string },
  list: { borderRadius: RADIUS, borderWidth: 1, borderColor: "var(--line)" as string, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40, paddingVertical: 4, paddingHorizontal: 12 },
  rowEdit: { flexDirection: "column", alignItems: "stretch", gap: 4, paddingVertical: 8 },
  label: { width: 140, fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  value: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 4 },
  text: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 20, color: "var(--ink)" as string },
  none: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 20, color: "var(--ink-4)" as string },
  icon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  edit: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  input: { ...CARD.input, flex: 1, minWidth: 160, height: 36 },
  small: { ...CARD.primary, height: 36, paddingHorizontal: 12 },
  smallText: { ...CARD.primaryText, fontSize: 13 },
  off: CARD.off,
  ghost: { ...CARD.ghost, height: 36, paddingHorizontal: 12 },
  ghostText: { ...CARD.ghostText, fontSize: 13 },
  hand: { fontSize: 13, color: "var(--accent)" as string },
  err: CARD.err,
});
