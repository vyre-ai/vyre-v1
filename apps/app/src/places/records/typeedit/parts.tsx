// Small pieces of the type and field sheets: a quiet text button that says why it is off, the mark before a field type, and the one confirm line.
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Glyph } from "../schemamap/icons.tsx";
import type { IconName } from "../schemamap/icons.tsx";
import { fieldMark } from "../schemamap/model.ts";

/** A text button. Off, it stays drawn and `why` is its hover text, so a person sees the reason and no button is dead without a word. */
export function TextButton({ label, onPress, testID, danger = false, primary = false, off, selected = false }: { label: string; onPress(): void; testID?: string; danger?: boolean; primary?: boolean; off?: string | true | undefined; selected?: boolean }): ReactElement {
  const disabled = off !== undefined;
  const why = typeof off === "string" ? off : undefined;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }} accessibilityHint={why} testID={testID} disabled={disabled} onPress={onPress}
      {...(Platform.OS === "web" && why ? ({ title: why } as object) : {})}
      style={({ hovered }: { hovered?: boolean }) => [b.btn, primary && b.primary, hovered === true && !disabled && (primary ? b.primaryOver : b.over), selected && b.selected, disabled && b.off]}
    >
      <Text style={[b.text, danger && b.danger, primary && b.primaryText]}>{label}</Text>
    </Pressable>
  );
}

export function FieldMark({ type, size = 16 }: { type: string; size?: number }): ReactElement {
  const m = fieldMark(type);
  return <View style={[b.mark, { width: size, height: size }]}>{m.symbol !== undefined ? <Text style={b.symbol}>{m.symbol}</Text> : <Glyph name={m.icon as IconName} size={size - 2} color="var(--ink-2)" />}</View>;
}

export function ConfirmLine({ text, busy, onConfirm, onCancel, confirmLabel = "Delete" }: { text: string; busy: boolean; onConfirm(): void; onCancel(): void; confirmLabel?: string }): ReactElement {
  return (
    <View style={b.confirm} accessibilityRole="alert" testID="schema-confirm">
      <Text style={b.confirmText} testID="schema-confirm-text">{text}</Text>
      <View style={b.confirmRow}>
        <TextButton label="Cancel" onPress={onCancel} testID="schema-confirm-cancel" />
        <TextButton label={confirmLabel} danger onPress={onConfirm} testID="schema-confirm-yes" off={busy ? true : undefined} />
      </View>
    </View>
  );
}

export const b = StyleSheet.create({
  btn: { height: 28, paddingHorizontal: 10, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  over: { backgroundColor: "var(--hover)" as string },
  primary: { backgroundColor: "var(--accent)" as string },
  primaryOver: { opacity: 0.9 },
  selected: { backgroundColor: "var(--accent-wash)" as string },
  off: { opacity: 0.45 },
  text: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  danger: { color: "var(--danger)" as string },
  primaryText: { color: "var(--accent-ink, #fff)" as string, fontWeight: "600" },
  mark: { alignItems: "center", justifyContent: "center" },
  symbol: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-2)" as string },
  confirm: { gap: 8, padding: 10, borderRadius: 8, backgroundColor: "var(--hover)" as string },
  confirmText: { fontSize: 12.5, lineHeight: 18, color: "var(--ink)" as string },
  confirmRow: { flexDirection: "row", justifyContent: "flex-end", gap: 6 },
});
