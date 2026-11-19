// ui/InlineConfirm: the one in-place confirmation ("Delete this view? Cancel / Delete"), for an ask that replaces or sits beside the button that was pressed, in place of a dialog. Owner rule, 19 Nov 2026:
// a destructive ask must never confirm on a stray press, and one component serves them all.
//   - Cancel takes focus when the strip appears, so a stray Enter or Space cancels; Escape cancels (its own layer).
//   - Delete ignores presses for ARM_MS after the strip appears, so a double-click on the button that opened it, or a key held down, cannot land on the new Delete; and it fires once.
//   - The buttons read Cancel then Delete, the danger one last and filled in the danger colour (`danger={false}` fills it with the accent for an ask that is not destructive).
// Callers keep their own testIDs through `confirmTestID` and `cancelTestID`. Colours are skin tokens.
import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useEscapeLayer } from "../Overlay/escape.ts";
import { armDelay, step } from "./logic.ts";
import type { ConfirmEvent, ConfirmState } from "./logic.ts";
export { ARM_MS, armDelay, setArmDelay, step } from "./logic.ts";

export interface InlineConfirmProps {
  /** The question, in the caller's words: "Delete “Q3 plan”?". */
  question: ReactNode;
  /** One quiet line under it: what happens (and what does not). */
  note?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm(): void;
  onCancel(): void;
  /** False for an ask that does not destroy anything. */
  danger?: boolean;
  /** The caller's own work is running: the confirm shows it and takes no press. */
  busy?: boolean;
  /** Nothing to confirm yet (nothing picked): the confirm takes no press. */
  disabled?: boolean;
  /** Only the two buttons, for a slot that is already labelled (the end of a settings row): `question` then names them for a screen reader. */
  compact?: boolean;
  /** Tests shorten the wait. */
  armMs?: number;
  testID?: string;
  confirmTestID?: string;
  cancelTestID?: string;
}

const web = Platform.OS === "web";

export function InlineConfirm({
  question,
  note,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  danger = true,
  busy = false,
  disabled = false,
  compact = false,
  armMs = armDelay(),
  testID,
  confirmTestID,
  cancelTestID,
}: InlineConfirmProps): ReactElement {
  const state = useRef<ConfirmState>("wary");
  const [armed, setArmed] = useState(false);
  const cancelRef = useRef<{ focus?: () => void } | null>(null);
  const calls = useRef({ onConfirm, onCancel });
  calls.current = { onConfirm, onCancel };
  const send = (e: ConfirmEvent): void => {
    const r = step(state.current, e);
    state.current = r.state;
    if (r.fire === "confirm") calls.current.onConfirm();
    else if (r.fire === "cancel") calls.current.onCancel();
  };
  useEffect(() => {
    if (web) cancelRef.current?.focus?.();
    if (armMs <= 0) {
      send("arm");
      setArmed(true);
      return undefined;
    }
    const t = setTimeout(() => {
      send("arm");
      setArmed(true);
    }, armMs);
    return () => clearTimeout(t);
  }, []);
  useEscapeLayer(true, () => send("cancel"));
  const fill = danger ? "var(--danger)" : "var(--accent)";
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      {...(compact && typeof question === "string" ? { accessibilityLabel: question } : {})}
      style={compact ? s.compact : s.strip}
    >
      {compact ? null : (
        <View style={s.text}>
          <Text style={s.question}>{question}</Text>
          {note ? <Text style={s.note}>{note}</Text> : null}
        </View>
      )}
      <View style={s.buttons}>
        <Pressable
          ref={cancelRef as never}
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          testID={cancelTestID}
          onPress={() => send("cancel")}
          style={({ hovered }: { hovered?: boolean }) => [
            s.btn,
            hovered === true && { backgroundColor: "var(--hover)" },
          ]}
        >
          <Text style={s.btnText}>{cancelLabel}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
          // disabled while wary: a screen reader says so, and a browser test's click waits until it is armed instead of landing on a strip that has just appeared
          disabled={!armed || busy || disabled}
          accessibilityState={{ busy, disabled: !armed || busy || disabled }}
          testID={confirmTestID}
          onPress={() => (disabled || busy ? undefined : send("confirm"))}
          style={[s.btn, { backgroundColor: fill }, !armed || busy || disabled ? { opacity: 0.55 } : null]}
        >
          <Text style={[s.btnText, s.btnFill]}>{confirmLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  strip: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "var(--sunk)" as string,
  },
  compact: { flexDirection: "row", alignItems: "center", gap: 6 },
  text: { flexGrow: 1, flexShrink: 1, minWidth: 160 },
  question: { fontSize: 13.5, lineHeight: 19, fontWeight: "600", color: "var(--ink)" as string },
  note: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string, marginTop: 2 },
  buttons: { flexDirection: "row", alignItems: "center", gap: 6 },
  btn: { height: 30, paddingHorizontal: 12, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 13, fontWeight: "500", color: "var(--ink-2)" as string },
  btnFill: { color: "#FFFFFF", fontWeight: "600" },
});
