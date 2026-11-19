// ui/InlineConfirm: the one in-place confirmation ("Delete this view? Cancel / Delete"), for an ask that replaces or sits beside the button that was pressed, in place of a dialog. Owner rule, 19 Nov 2026:
// a destructive ask must never confirm on a stray press, and one component serves them all.
//   - Cancel takes focus when the strip appears, so a stray Enter or Space cancels; Escape cancels (its own layer).
//   - Delete ignores presses for ARM_MS after the strip appears, so a double-click on the button that opened it, or a key held down, cannot land on the new Delete; and it fires once. If the strip is still
//     there after a press (the work failed and the caller left the ask open), Delete arms again after the same wait, so it can be tried again.
//   - A field beside the strip (a "type the name" box in the same block) takes focus in place of Cancel, as in ui/Dialog. When the strip goes, focus goes back to what held it before.
//   - The buttons read Cancel then Delete, the danger one last and filled in the danger colour (`danger={false}` fills it with the accent for an ask that is not destructive).
// Callers keep their own testIDs through `confirmTestID` and `cancelTestID`. Colours are skin tokens.
import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useEscapeLayer } from "../Overlay/escape.ts";
import { Tip } from "../Tip/index.tsx";
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
  /** Why the confirm is off, said as its tooltip while `disabled` ("Type the Space's name exactly"). */
  why?: string | undefined;
  /** Only the two buttons, for a slot that is already labelled (the end of a settings row): `question` then names them for a screen reader. */
  compact?: boolean;
  /** Tests shorten the wait. */
  armMs?: number;
  testID?: string;
  confirmTestID?: string;
  cancelTestID?: string;
}

const web = Platform.OS === "web";
type Focusable = { focus?: () => void };
interface FocusDoc {
  activeElement?: { isConnected?: boolean; tagName?: string; focus?: () => void } | null;
}
/** A text-like field: a checkbox, radio, file or hidden input is not one (Space would toggle it). */
const FIELD =
  "input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]):not([type=button]):not([type=submit]),textarea";

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
  why,
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
  const root = useRef<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm = (): void => {
    send("arm");
    setArmed(true);
  };
  const send = (e: ConfirmEvent): void => {
    const r = step(state.current, e);
    state.current = r.state;
    if (r.fire === "confirm") {
      // the press is spent; if the strip is still here after the wait (the work failed), it arms again
      setArmed(false);
      if (timer.current) clearTimeout(timer.current);
      if (armMs <= 0) arm();
      else timer.current = setTimeout(arm, armMs);
      calls.current.onConfirm();
    } else if (r.fire === "cancel") calls.current.onCancel();
  };
  useEffect(() => {
    const doc = web ? (globalThis as { document?: FocusDoc }).document : undefined;
    const opener = doc?.activeElement ?? null;
    if (web) {
      // a text field in the same block takes focus, as in ui/Dialog (the person types at once); else Cancel
      const near = (root.current as { parentElement?: { querySelector?: (q: string) => Focusable | null } } | null)
        ?.parentElement;
      (near?.querySelector?.(FIELD) ?? cancelRef.current)?.focus?.();
    }
    if (armMs <= 0) arm();
    else timer.current = setTimeout(arm, armMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      // focus goes back to what held it, unless something else has taken it since (a person who moved on keeps their place)
      const now = doc?.activeElement;
      if (opener && opener.isConnected !== false && (now === null || now === undefined || now.tagName === "BODY"))
        opener.focus?.();
    };
  }, []);
  useEscapeLayer(true, () => send("cancel"));
  const fill = danger ? "var(--danger)" : "var(--accent)";
  return (
    <View
      ref={root as never}
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
        <Tip help={disabled ? why : undefined}>
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
        </Tip>
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
