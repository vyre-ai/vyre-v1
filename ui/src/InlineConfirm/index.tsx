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
import { reportProblem } from "../Menu/index.tsx";
import { armDelay, step } from "./logic.ts";

/** The longest a caller's promise holds the strip dimmed. */
const PENDING_MAX_MS = 30_000;
import type { ConfirmEvent, ConfirmState } from "./logic.ts";
export { ARM_MS, armDelay, setArmDelay, step } from "./logic.ts";

export interface InlineConfirmProps {
  /** The question, in the caller's words: "Delete “Q3 plan”?". */
  question: ReactNode;
  /** One quiet line under it: what happens (and what does not). */
  note?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** May return a promise: the strip does not arm again until it settles (a slow delete can never fire twice). A caller that returns nothing should pass `busy` while its work runs. */
  onConfirm(): void | Promise<unknown>;
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
  /** A field that belongs to this ask ("type the name to confirm"): drawn inside the strip, and it takes focus in place of Cancel. Only a field inside the strip counts, never one elsewhere in the form. */
  children?: ReactNode;
  /** Tests shorten the wait. */
  armMs?: number;
  testID?: string;
  confirmTestID?: string;
  cancelTestID?: string;
}

/** The verb of a strip, for "You don't have access to <verb> this.": the first word of its confirm label when that is an action word, else "do". */
export function verbOf(confirmLabel: string): string {
  const w = confirmLabel.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const known = [
    "delete",
    "remove",
    "revoke",
    "discard",
    "disconnect",
    "leave",
    "release",
    "erase",
    "drain",
    "unmount",
    "stop",
    "archive",
    "restore",
    "suspend",
    "move",
    "turn",
    "switch",
    "apply",
    "end",
    "close",
    "start",
    "create",
  ];
  return known.includes(w) ? w : "do";
}

/** What a rejection is, read once from either shape (an Error, or the gateway's `{ error: { code, message } }`): a short safe code, and whether it is a real transport failure (no code: a fetch TypeError, or the browser is offline). */
export function readFailure(e: unknown): { code: string; transport: boolean } {
  const o = e as { code?: unknown; error?: { code?: unknown } } | null;
  const raw = typeof o?.error?.code === "string" ? o.error.code : typeof o?.code === "string" ? o.code : "";
  const code = /^[a-z0-9_.-]{1,40}$/i.test(raw) ? raw : "";
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  const transport = code === "" && (e instanceof TypeError || nav?.onLine === false);
  return { code, transport };
}

/** Plain words for a failed confirm, chosen from the error's code and never from the server's own message, which can carry hosts, SQL, names or ids. `field`: the strip holds a "type the name" box. */
export function wordsFor(f: { code: string; transport: boolean }, verb: string, field = false): string {
  const { code } = f;
  if (f.transport || /^(net|network|offline)\./i.test(code)) return "Couldn't reach the Space.";
  if (/^access\./.test(code)) return `You don't have access to ${verb} this.`;
  if (/^conflict\./.test(code) || code === "validation.version_conflict") return "It changed first. Try again.";
  if (code === "validation.not_found") return "It's already gone.";
  if (code === "validation.duplicate") return "That name is taken.";
  if (code === "validation.precondition_failed") return "Something it depends on changed. Refresh and try again.";
  if (code === "validation.bad_input" && field) return "Type the name exactly to confirm.";
  if (/^validation\./.test(code)) return "That can't be done as it is.";
  return "That did not work. You can try again.";
}

/** The layout rules of the failure line, plain objects so a test can read them. The reason is always read in full: in a compact row it takes its own full-width line under the buttons (the buttons stay on the strip), in the full strip it wraps beside Report. */
export const LAYOUT = {
  compact: { flexDirection: "row", flexWrap: "wrap", flexShrink: 1, minWidth: 0, alignItems: "center", gap: 6 },
  failedRowCompact: {
    flexDirection: "row",
    flexWrap: "wrap",
    flexBasis: "100%",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  failedRowFull: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 4 },
} as const;

const web = Platform.OS === "web";
type Focusable = { focus?: () => void };
interface FocusDoc {
  activeElement?: {
    isConnected?: boolean;
    tagName?: string;
    focus?: () => void;
    getAttribute?: (n: string) => string | null;
  } | null;
  querySelector?: (q: string) => Focusable | null;
}
type Opener = { el: NonNullable<FocusDoc["activeElement"]>; testid: string | null } | null;
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
  children,
  compact = false,
  armMs = armDelay(),
  testID,
  confirmTestID,
  cancelTestID,
}: InlineConfirmProps): ReactElement {
  const state = useRef<ConfirmState>("wary");
  const [armed, setArmed] = useState(false);
  const [failed, setFailed] = useState<{ code: string; text: string } | null>(null);
  const cancelRef = useRef<{ focus?: () => void } | null>(null);
  const calls = useRef({ onConfirm, onCancel });
  calls.current = { onConfirm, onCancel };
  const root = useRef<unknown>(null);
  // the button that opened the strip: read while rendering the first time, before the strip replaces it in the page
  const [opener] = useState<Opener>(() => {
    const a = web ? (globalThis as { document?: FocusDoc }).document?.activeElement : null;
    return a && a.tagName !== "BODY" ? { el: a, testid: a.getAttribute?.("data-testid") ?? null } : null;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // the press is spent until three things are true: the wait is over, the caller's promise (if it gave one) has settled, and the caller is not busy
  const spent = useRef({ waited: true, pending: false });
  const busyNow = useRef(busy);
  busyNow.current = busy;
  const arm = (): void => {
    if (state.current === "gone") return; // a cancel ends it: nothing arms afterwards
    send("arm");
    setArmed(true);
  };
  const tryArm = (): void => {
    if (state.current !== "spent") return;
    if (spent.current.waited && !spent.current.pending && !busyNow.current) arm();
  };
  const send = (e: ConfirmEvent): void => {
    const r = step(state.current, e);
    state.current = r.state;
    if (r.fire === "confirm") {
      setArmed(false);
      setFailed(null);
      spent.current = { waited: armMs <= 0, pending: false };
      if (timer.current) clearTimeout(timer.current);
      if (armMs > 0)
        timer.current = setTimeout(() => {
          spent.current.waited = true;
          tryArm();
        }, armMs);
      const out = calls.current.onConfirm();
      if (out && typeof (out as Promise<unknown>).then === "function") {
        spent.current.pending = true;
        let settled = false;
        const done = (): void => {
          if (settled) return; // the cap and the real answer may both come
          settled = true;
          spent.current.pending = false;
          tryArm();
        };
        // a request that never answers does not hold Delete off for ever: after a long wait the strip arms again. That is a deliberate trade: the request may still be running, so a person
        // who presses again after that wait starts a second one.
        const cap = setTimeout(done, PENDING_MAX_MS);
        (cap as { unref?: () => void }).unref?.();
        void (out as Promise<unknown>).then(
          () => {
            clearTimeout(cap);
            done();
          },
          (e: unknown) => {
            clearTimeout(cap);
            const f = readFailure(e);
            const code = f.code;
            // the gateway's own words only for a user-facing family; anything else (a network error, a stack) gets the plain line
            setFailed({ code, text: wordsFor(f, verbOf(confirmLabel), children !== undefined) });
            done();
            // the strip says it did not work (inline); a person who wants to tell Vyre presses Report. Nothing opens by itself and nothing is thrown.
          },
        );
      } else tryArm();
    } else if (r.fire === "cancel") {
      if (timer.current) clearTimeout(timer.current);
      calls.current.onCancel();
    }
  };
  // a caller that shows its work with `busy` re-arms the strip when the work ends
  useEffect(() => {
    if (!busy) tryArm();
  }, [busy]);
  useEffect(() => {
    const doc = web ? (globalThis as { document?: FocusDoc }).document : undefined;
    if (web) {
      // a text field inside the strip (a "type the name" box passed as children) takes focus, as in ui/Dialog; else Cancel. Never a field elsewhere in the form.
      const el = root.current as { querySelector?: (q: string) => Focusable | null } | null;
      (el?.querySelector?.(FIELD) ?? cancelRef.current)?.focus?.();
    }
    if (armMs <= 0) arm();
    else timer.current = setTimeout(arm, armMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      // focus goes back to the button that opened the strip (a new node by then if the strip replaced it: found by its test id), unless something else has taken it since.
      // A button that shows only on hover is still a button: focus inside its row shows it again.
      setTimeout(() => {
        const now = doc?.activeElement;
        if (!(now === null || now === undefined || now.tagName === "BODY") || !opener) return;
        const again =
          opener.el.isConnected !== false
            ? opener.el
            : opener.testid
              ? doc?.querySelector?.(`[data-testid="${opener.testid}"]`)
              : null;
        again?.focus?.();
      }, 0);
    };
  }, []);
  useEscapeLayer(true, () => send("cancel"));
  const fill = danger ? "var(--danger)" : "var(--accent)";
  const failureLine = failed ? (
    <View
      accessibilityRole="alert"
      testID={testID ? `${testID}-failed` : undefined}
      style={compact ? LAYOUT.failedRowCompact : LAYOUT.failedRowFull}
    >
      <Text style={s.failed}>{failed.text}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Report this"
        testID={testID ? `${testID}-report` : undefined}
        onPress={() => reportProblem({ label: `${confirmLabel} failed${failed.code ? ` (${failed.code})` : ""}` })}
      >
        <Text style={s.report}>Report</Text>
      </Pressable>
    </View>
  ) : null;
  return (
    <View
      ref={root as never}
      testID={testID}
      accessibilityRole="alert"
      {...(compact && typeof question === "string" ? { accessibilityLabel: question } : {})}
      style={compact ? s.compact : s.strip}
    >
      {compact ? (
        <>
          {children}
          {failureLine}
        </>
      ) : (
        <View style={s.text}>
          <Text style={s.question}>{question}</Text>
          {note ? <Text style={s.note}>{note}</Text> : null}
          {children}
          {failureLine}
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
  compact: LAYOUT.compact,
  text: { flexGrow: 1, flexShrink: 1, minWidth: 160 },
  question: { fontSize: 13.5, lineHeight: 19, fontWeight: "600", color: "var(--ink)" as string },
  failed: { flexShrink: 1, minWidth: 0, fontSize: 12.5, lineHeight: 18, color: "var(--danger)" as string },
  report: { fontSize: 12.5, lineHeight: 18, fontWeight: "500", color: "var(--accent)" as string },
  note: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string, marginTop: 2 },
  buttons: { flexDirection: "row", flexShrink: 0, alignItems: "center", gap: 6 },
  btn: { height: 30, paddingHorizontal: 12, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 13, fontWeight: "500", color: "var(--ink-2)" as string },
  btnFill: { color: "#FFFFFF", fontWeight: "600" },
});
