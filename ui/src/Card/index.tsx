// ui/Card: the one card for everything that asks, tells or shows something in a chat or a page (lane l-cards, owner 6 Nov: "standardize cards into a few categories and use that single library everywhere").
// Six kinds share the same parts, so a card is built from header, body, fields and an action row and never from its own StyleSheet:
//   status    a fact and what to do next (an error, a notice)          decision  someone must say yes or no (approve, deny, choose)
//   input     fields, then submit (a key, a name)                      item      one thing with a name and Open (a file, a link, a page)
//   progress  something live with a state and Stop or Watch             result    what changed and the buttons that land it (a diff, a merge)
// One width (560 full, 420 compact), one radius, one edge, one title size. The action row has a fixed order, the owner's approval vocabulary: the primary first, then the secondary actions, the destructive one (Deny, Discard) last. It wraps on a phone
// and the buttons grow to a thumb. Enter runs the card's `onEnter` and Escape its `onCancel` when focus is inside the card (never from a multi-line or rich field or a button, which keep their own Enter).
// A busy card disables its actions and shows a ring on the primary; the label never changes, so nothing jumps. A field's error line has its place reserved, so showing it moves nothing.
// Colours are skin tokens only, so light and graphite both work. The ring's turn goes in through the sheet (injectCss); reduced motion stops it.
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { injectCss } from "../theme/css.ts";

export type CardKind = "status" | "decision" | "input" | "item" | "progress" | "result";
export type CardTone = "neutral" | "info" | "warn" | "error" | "ok";
export type CardSize = "full" | "compact";

export const CARD_WIDTH = { full: 560, compact: 420 } as const;
/** The phone width under which the buttons grow to a thumb. */
export const PHONE_UNDER = 600;

export const CARD_CSS = [
  "@keyframes vyre-card-ring{to{transform:rotate(360deg)}}",
  "@media (prefers-reduced-motion:reduce){[data-card-ring]{animation:none!important}}",
].join("");

export interface CardProps {
  kind: CardKind;
  /** The colour of the header mark and, for a status, the edge. */
  tone?: CardTone;
  size?: CardSize;
  testID?: string;
  /** Read out for the card as a whole. */
  label: string;
  /** Enter inside the card (not in a multi-line field, not on a button) runs this: the primary action. */
  onEnter?: () => void;
  /** No padding: a picture runs edge to edge and the card clips it (a live screen, a page shot). */
  flush?: boolean;
  /** Escape inside the card runs this: the way out (Deny, Not now, Back, Cancel). */
  onCancel?: () => void;
  children?: ReactNode;
}

const edgeOf = (kind: CardKind, tone: CardTone): string => (kind === "status" ? "transparent" : tone === "warn" ? "var(--warn)" : tone === "error" ? "var(--danger)" : "var(--line-2)");

/** Keys on the web arrive as DOM events on the View; a native build has none, so the handler is only attached where the event has a `key`. */
export function keyHandler(onEnter: (() => void) | undefined, onCancel: (() => void) | undefined): ((e: { key?: string; target?: { tagName?: string; isContentEditable?: boolean; getAttribute?(n: string): string | null }; stopPropagation?(): void; metaKey?: boolean; ctrlKey?: boolean }) => void) | undefined {
  if (!onEnter && !onCancel) return undefined;
  return (e) => {
    if (e.key === "Escape" && onCancel) { e.stopPropagation?.(); onCancel(); return; }
    if (e.key !== "Enter" || !onEnter) return;
    const tag = String(e.target?.tagName ?? "").toLowerCase();
    // a button keeps its own Enter; a multi-line field keeps its newline unless Cmd or Ctrl is down
    if (e.target?.isContentEditable === true || e.target?.getAttribute?.("contenteditable") === "true") return;
    if (tag === "button" || tag === "a" || e.target?.getAttribute?.("role") === "button") return;
    if (tag === "textarea" && !(e.metaKey || e.ctrlKey)) return;
    e.stopPropagation?.();
    onEnter();
  };
}

export function Card({ kind, tone = "neutral", size = "full", flush = false, testID, label, onEnter, onCancel, children }: CardProps): ReactElement {
  injectCss((globalThis as { document?: Parameters<typeof injectCss>[0] }).document, "vyre-ui-card", CARD_CSS);
  const key = keyHandler(onEnter, onCancel);
  return (
    <View
      testID={testID} accessibilityRole={kind === "status" && tone === "error" ? "alert" : "summary"} accessibilityLabel={label}
      {...(key ? ({ onKeyDown: key } as object) : {})}
      style={[s.card, kind === "status" ? s.sunk : s.raised, { maxWidth: CARD_WIDTH[size], borderColor: edgeOf(kind, tone) }, size === "compact" && s.compact, flush && s.flush]}
    >
      {children}
    </View>
  );
}

const MARK_INK: Record<CardTone, string> = { neutral: "var(--ink-3)", info: "var(--accent)", warn: "var(--warn)", error: "var(--danger)", ok: "var(--ok)" };

export interface CardHeadProps {
  /** A face, a glyph, a site initial: whatever leads the title. */
  lead?: ReactNode;
  title: string;
  /** Under the title: when, where, who. */
  meta?: string;
  metaTestID?: string;
  /** On the right: a state word, a menu button. */
  trailing?: ReactNode;
  tone?: CardTone;
  testID?: string;
}

export function CardHead({ lead, title, meta, metaTestID, trailing, tone = "neutral", testID }: CardHeadProps): ReactElement {
  return (
    <View style={s.head} testID={testID}>
      {lead ? <View style={s.lead}>{lead}</View> : null}
      <View style={s.titles}>
        <Text style={[s.title, tone === "neutral" ? null : { color: "var(--ink)" }]} numberOfLines={2}>{title}</Text>
        {meta ? <Text style={s.meta} numberOfLines={2} testID={metaTestID}>{meta}</Text> : null}
      </View>
      {trailing ? <View style={s.trailing}>{trailing}</View> : null}
    </View>
  );
}

/** The ink a tone gives a glyph in the header. */
export const toneInk = (tone: CardTone): string => MARK_INK[tone];

/** What the card says: a sunk panel by default (an excerpt, a diff), or bare text when `bare`. */
export function CardBody({ children, bare = false, testID }: { children?: ReactNode; bare?: boolean; testID?: string }): ReactElement {
  return <View testID={testID} style={bare ? s.bodyBare : s.body}>{children}</View>;
}

/** Label and value rows: the fields a card shows (To, Subject, When). */
export function CardFields({ children, testID }: { children?: ReactNode; testID?: string }): ReactElement {
  return <View testID={testID} style={s.fields}>{children}</View>;
}

export function CardRow({ label, children, testID }: { label: string; children?: ReactNode; testID?: string }): ReactElement {
  return (
    // ui-rows-lint: not a list (the labelled fields of one card)
    <View testID={testID} style={s.row}>
      <Text style={s.label}>{label}</Text>
      <View style={s.value}>{typeof children === "string" ? <Text style={s.valueText}>{children}</Text> : children}</View>
    </View>
  );
}

export interface CardFieldProps {
  label: string;
  value: string;
  onChange(v: string): void;
  /** One line (Enter submits) or several (Cmd or Ctrl + Enter submits). */
  multiline?: boolean;
  placeholder?: string;
  /** Under the field, quiet: what goes here. Replaced by `error` while there is one. */
  hint?: string;
  error?: string | null;
  secure?: boolean;
  testID?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Read out in place of `label` when the visible label is shorter than the question. */
  accessLabel?: string;
}

/** A labelled input. The line under it is always one line tall, so a hint turning into an error moves nothing. */
export function CardField({ label, value, onChange, multiline = false, placeholder, hint, error, secure = false, testID, disabled = false, autoFocus = false, accessLabel }: CardFieldProps): ReactElement {
  const [focus, setFocus] = useState(false);
  const bad = Boolean(error);
  return (
    <View style={s.fieldWrap}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={accessLabel ?? label} testID={testID} value={value} onChangeText={onChange} editable={!disabled} autoFocus={autoFocus}
        multiline={multiline} secureTextEntry={secure} {...(secure ? { autoCapitalize: "none", autoCorrect: false } : {})} {...(placeholder ? { placeholder } : {})} placeholderTextColor="var(--ink-4)"
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        {...(bad ? { "aria-invalid": true } : {})}
        style={[s.input, multiline && s.inputMulti, focus && s.inputFocus, bad && s.inputBad, disabled && { opacity: 0.5 }]}
      />
      <Text accessibilityRole={bad ? "alert" : "text"} style={[s.under, bad && { color: "var(--danger)" }]} numberOfLines={2}>{error || hint || " "}</Text>
    </View>
  );
}

export interface CardActionSpec {
  label: string;
  onPress(): void;
  testID?: string;
  disabled?: boolean;
  /** A glyph before the label. */
  icon?: ReactNode;
  /** Destructive text. */
  danger?: boolean;
  /** Drawn as an accent text link (a status card's next steps). */
  link?: boolean;
}

export interface CardActionsProps {
  /** The one filled action, first (the approval vocabulary: Allow, Always allow, Deny). */
  primary?: CardActionSpec;
  /** Quiet actions after the primary, in order; the destructive one (Deny, Discard) goes last. */
  secondary?: readonly CardActionSpec[];
  /** The primary is working: every action is disabled and the primary shows a ring. */
  busy?: boolean;
  /** Under the row, one line, in danger ink. Its place is not reserved: it appears after a failed press. */
  error?: string | null;
  /** On the left of the row, quiet: a stopped note, a "..." menu. */
  note?: ReactNode;
  testID?: string;
}

export function CardActions({ primary, secondary = [], busy = false, error, note, testID }: CardActionsProps): ReactElement {
  return (
    <View testID={testID} style={s.actionsWrap}>
      <View style={s.actions}>
        <View style={s.buttons}>
          {primary ? <CardButton {...primary} primary busy={busy} disabled={busy || primary.disabled === true} /> : null}
          {secondary.map((a) => <CardButton key={a.label} {...a} disabled={busy || a.disabled === true} />)}
        </View>
        {note ? <View style={s.note}>{note}</View> : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={s.error} testID={testID ? `${testID}-error` : undefined}>{error}</Text> : null}
    </View>
  );
}

export interface CardButtonProps extends CardActionSpec {
  primary?: boolean;
  busy?: boolean;
}

export function CardButton({ label, onPress, testID, disabled = false, icon, danger = false, primary = false, busy = false, link = false }: CardButtonProps): ReactElement {
  const { width } = useWindowDimensions();
  const [over, setOver] = useState(false);
  const [focus, setFocus] = useState(false);
  const tall = width < PHONE_UNDER;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy }} disabled={disabled} testID={testID} onPress={onPress}
      onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      style={[s.btn, tall && s.btnTall, primary && !danger ? s.btnPrimary : link ? s.btnLink : over && s.btnOver, focus && s.btnFocus, disabled && !busy && { opacity: 0.5 }]}
    >
      {icon ? <View>{icon}</View> : null}
      <Text style={[s.btnText, primary && !danger && s.btnTextPrimary, link && s.btnTextLink, danger && { color: "var(--danger)" }]}>{label}</Text>
      {busy ? <View {...({ dataSet: { cardRing: "" } } as object)} style={[s.ring, { borderColor: danger ? "var(--danger)" : "var(--accent-ink)" }]} /> : null}
    </Pressable>
  );
}

/** The one line an answered card folds to: "Allowed · edit Q4 pricing.docx", "Sent to Aliza · 04:38", "Not sent". */
export function CardDone({ ok = true, text, glyph, testID }: { ok?: boolean; text: string; glyph?: ReactNode; testID?: string }): ReactElement {
  return (
    <View testID={testID} style={s.done} accessibilityRole="text">
      {glyph ? <View>{glyph}</View> : null}
      <Text style={[s.doneText, ok ? null : { color: "var(--ink-4)" }]}>{text}</Text>
    </View>
  );
}

export interface CardDenyProps {
  /** Runs with the reason, trimmed, possibly empty. */
  onDeny(reason: string): void;
  onBack(): void;
  busy?: boolean;
  /** The test ids of the reason field, Back and the confirming button. */
  ids: { reason: string; back: string; go: string };
  /** The label of the confirming button. */
  label?: string;
}

/** The step after Deny: an optional reason that goes back to the agent, with Back and the confirming Deny. Shared by every decision card. */
export function CardDeny({ onDeny, onBack, busy = false, ids, label = "Deny" }: CardDenyProps): ReactElement {
  const [reason, setReason] = useState("");
  return (
    <View style={s.deny}>
      <TextInput
        accessibilityLabel="Why not (optional)" testID={ids.reason} value={reason} onChangeText={setReason} placeholder="Reason (optional)" placeholderTextColor="var(--ink-4)" multiline
        style={[s.input, s.inputMulti]}
      />
      <CardActions
        primary={{ label, danger: true, onPress: () => onDeny(reason.trim()), testID: ids.go }}
        secondary={[{ label: "Back", onPress: onBack, testID: ids.back }]}
        busy={busy}
      />
    </View>
  );
}

export const s = StyleSheet.create({
  card: { marginTop: 8, padding: 12, gap: 10, borderRadius: 12, borderWidth: 1, alignSelf: "stretch" },
  compact: { padding: 10, gap: 8 },
  flush: { padding: 0, gap: 0, overflow: "hidden" },
  raised: { backgroundColor: "var(--raised)" as string },
  sunk: { backgroundColor: "var(--sunk)" as string },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  lead: { flexDirection: "row", alignItems: "center" },
  titles: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontSize: 14, fontWeight: "600", lineHeight: 19, color: "var(--ink)" as string },
  meta: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  trailing: { flexDirection: "row", alignItems: "center", gap: 6 },
  body: { gap: 6, padding: 10, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  bodyBare: { gap: 6 },
  fields: { gap: 6 },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  label: { width: 60, fontSize: 12, lineHeight: 18, color: "var(--ink-3)" as string },
  value: { flex: 1, minWidth: 0 },
  valueText: { fontSize: 13, lineHeight: 18, color: "var(--ink)" as string },
  fieldWrap: { gap: 4 },
  input: { minHeight: 34, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, fontSize: 13, color: "var(--ink)" as string },
  inputMulti: { minHeight: 56, paddingTop: 8 },
  inputFocus: { borderColor: "var(--accent)" as string },
  inputBad: { borderColor: "var(--danger)" as string },
  under: { minHeight: 16, fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  actionsWrap: { gap: 6 },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  note: { flexShrink: 1, marginLeft: "auto" },
  buttons: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  error: { fontSize: 12.5, lineHeight: 17, color: "var(--danger)" as string },
  btn: { height: 30, paddingHorizontal: 12, borderRadius: 8, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, borderWidth: 1, borderColor: "transparent" },
  btnTall: { height: 40, paddingHorizontal: 14 },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnPrimary: { backgroundColor: "var(--accent)" as string },
  btnLink: { paddingHorizontal: 4 },
  btnFocus: { borderColor: "var(--accent)" as string },
  btnText: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  btnTextPrimary: { color: "var(--accent-ink)" as string },
  btnTextLink: { color: "var(--accent)" as string, fontWeight: "400" },
  ring: { width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderTopColor: "transparent", animationName: "vyre-card-ring", animationDuration: "0.8s", animationIterationCount: "infinite", animationTimingFunction: "linear" } as object,
  done: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  doneText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  deny: { gap: 8 },
});
