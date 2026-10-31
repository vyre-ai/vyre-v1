// A sealed field on the record page. The page holds a reference, never the value: the value is in the Vault. Reveal asks for it (the Vault checks who may, and logs it), shows it for ten seconds with
// Copy, then hides it again. Setting or replacing a value sends the text over the sealed path of records.update, once, and the page never keeps it.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { TextButton } from "../typeedit/parts.tsx";
import { usePageData } from "./data.tsx";
import type { FieldDef, RecordRow } from "./model.ts";

/** How long a revealed value stays on screen. */
export const SHOW_MS = 10_000;

export const hasSealedValue = (v: unknown): boolean => !!v && typeof v === "object" && (v as { present?: unknown }).present === true;

/** What to say when the Vault would not show the value, in a sentence a person can act on. */
export function revealProblem(e: unknown): string {
  const msg = e instanceof Error ? e.message : "";
  if (/permission|access|allowed|grant|role/i.test(msg)) return "You do not have access to reveal this value. Ask an owner or admin.";
  return "The value could not be shown. Try again in a moment.";
}

export function SealedField({ field, row, type }: { field: FieldDef; row: RecordRow; type: string }): ReactElement {
  const data = usePageData();
  const k = field.key;
  const [shown, setShown] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; if (timer.current) clearTimeout(timer.current); }, []);
  const hide = (): void => { if (timer.current) clearTimeout(timer.current); timer.current = null; setShown(null); setCopied(false); };
  const reveal = (): void => {
    setBusy(true); setError(null);
    data.call("records.reveal", { type, recordId: row.id, field: k }).then(
      (out) => {
        if (!live.current) return;
        setBusy(false); setShown(String((out as { value: unknown }).value));
        timer.current = setTimeout(hide, SHOW_MS);
      },
      (e: unknown) => { if (live.current) { setBusy(false); setError(revealProblem(e)); } },
    );
  };
  const copy = (): void => {
    const text = shown;
    if (text === null) return;
    void Promise.resolve((globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard?.writeText(text)).then(() => { if (live.current) setCopied(true); }, () => undefined);
  };
  const save = (): void => {
    if (editing === null || editing === "") return;
    const text = editing;
    setBusy(true); setError(null);
    data.call("records.update", { type, recordId: row.id, patch: { [k]: { sealed: true, value: text } }, baseVersion: row.version }).then(
      () => { if (live.current) { setBusy(false); setEditing(null); hide(); } },
      () => { if (live.current) { setBusy(false); setError("The value was not saved. Try again."); } },
    );
  };
  const has = hasSealedValue(row.fields[k]);

  if (editing !== null) {
    return (
      <View style={s.col}>
        <TextInput
          autoFocus secureTextEntry value={editing} onChangeText={setEditing} accessibilityLabel={field.title} placeholder={field.title} placeholderTextColor="var(--ink-3)" testID={`sealed-input-${k}`}
          onSubmitEditing={save} style={s.input}
        />
        <View style={s.inline}>
          <TextButton label="Cancel" testID={`sealed-cancel-${k}`} onPress={() => { setEditing(null); setError(null); }} />
          <TextButton label="Save" primary testID={`sealed-save-${k}`} off={editing === "" || busy ? true : undefined} onPress={save} />
        </View>
        <Text style={s.hint}>It goes into the Vault. This page keeps a reference, not the value.</Text>
        {error ? <Text style={s.err} accessibilityRole="alert" testID={`sealed-error-${k}`}>{error}</Text> : null}
      </View>
    );
  }
  return (
    <View style={s.col}>
      {has ? (
        <View style={s.inline}>
          {shown === null
            ? <Text style={s.dots} testID={`sealed-dots-${k}`} accessibilityLabel={`${field.title}, sealed`}>{"••••••"}</Text>
            : <Text selectable style={s.value} testID={`sealed-value-${k}`}>{shown}</Text>}
          {shown === null
            ? <TextButton label="Reveal" testID={`sealed-reveal-${k}`} off={busy ? true : undefined} onPress={reveal} />
            : <><TextButton label={copied ? "Copied" : "Copy"} testID={`sealed-copy-${k}`} onPress={copy} /><TextButton label="Hide" testID={`sealed-hide-${k}`} onPress={hide} /></>}
          <TextButton label="Replace" testID={`sealed-replace-${k}`} onPress={() => { hide(); setEditing(""); }} />
        </View>
      ) : (
        <View style={s.inline}>
          <Text style={s.empty}>Empty</Text>
          <TextButton label="Set value" testID={`sealed-set-${k}`} onPress={() => setEditing("")} />
        </View>
      )}
      {shown !== null ? <Text style={s.hint} testID={`sealed-hint-${k}`}>Shown for ten seconds. This was logged.</Text> : null}
      {error ? <Text style={s.err} accessibilityRole="alert" testID={`sealed-error-${k}`}>{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 6 },
  inline: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  dots: { fontSize: 13.5, color: "var(--ink-3)" as string, letterSpacing: 1 },
  value: { fontSize: 13.5, color: "var(--ink)" as string },
  empty: { fontSize: 13.5, color: "var(--ink-4)" as string },
  hint: { fontSize: 12, color: "var(--ink-3)" as string },
  err: { fontSize: 12.5, color: "var(--danger)" as string },
  input: { height: 30, paddingHorizontal: 9, borderRadius: 7, borderWidth: 1, borderColor: "var(--field-line)", backgroundColor: "var(--field)" as string, fontSize: 13.5, color: "var(--ink)" as string },
});
