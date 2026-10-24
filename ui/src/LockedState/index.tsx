// ui/LockedState: what a deny of no_grant or role_lacks_permission shows (spec 4.8, 4.12, ARCH 4.13).
// One calm state: what is locked, why in plain words, the level being asked for, an optional note and one button, Ask for access.
// Pressing it sends access.request for this person and resource and the state moves to Waiting at once; the approver's answer moves it to Granted or Declined.
// A guest cannot ask. A second ask is the same request (one open request per person and resource).
// Colours are skin tokens (CSS variables on web), so a skin switch repaints with no re-render.

import { createElement, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { TextStyle } from "react-native";
import { menuTrigger, useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { ACCESS_REQUEST_STATUS_LABEL, ASK_FOR_ACCESS_LABEL } from "./props.ts";
import type { AccessRequestStatus, LockedLevel, LockedReason, LockedStateProps } from "./props.ts";

export type { AccessRequestStatus, Density, LockedLevel, LockedReason, LockedStateProps } from "./props.ts";
export { ACCESS_REQUEST_STATUS_LABEL, ASK_FOR_ACCESS_LABEL, frozenLockedStateProps } from "./props.ts";

/** The capability the button calls. */
export const ASK_CAPABILITY = "access.request" as const;

/** The input of access.request (manifests/access.ts). The note is left out when empty. */
export interface AccessRequestInput {
  resource: { type: string; id: string };
  level: LockedLevel;
  note?: string;
}

export type AskInvoke = (capability: typeof ASK_CAPABILITY, input: AccessRequestInput) => Promise<unknown> | unknown;

export const LOCKED_LEVELS: readonly { id: LockedLevel; label: string; hint: string }[] = [
  { id: "view", label: "View", hint: "See it" },
  { id: "use", label: "Use", hint: "Open it and use it" },
  { id: "edit", label: "Edit", hint: "Change how it works" },
  { id: "manage", label: "Manage", hint: "Share it, move it and delete it" },
];

export function levelLabel(level: LockedLevel): string {
  return LOCKED_LEVELS.find((l) => l.id === level)?.label ?? level;
}

/** Plain words for why, no jargon. */
export function reasonLine(reason: LockedReason, title: string): string {
  return reason === "no_grant"
    ? `You do not have access to ${title} yet.`
    : `Your role does not include what ${title} needs.`;
}

export function requestInput(props: Pick<LockedStateProps, "resourceType" | "resourceId">, level: LockedLevel, note: string): AccessRequestInput {
  const text = note.trim();
  return { resource: { type: props.resourceType, id: props.resourceId }, level, ...(text.length > 0 ? { note: text } : {}) };
}

/** What the state shows for each status: the button label, whether it can be pressed, and a quiet line. */
export function statusView(status: AccessRequestStatus, canRequest: boolean, note: string): { button: string; enabled: boolean; line: string } {
  if (status === "waiting") return { button: ACCESS_REQUEST_STATUS_LABEL.waiting, enabled: false, line: "Asked. You will see the answer here." };
  if (status === "granted") return { button: ACCESS_REQUEST_STATUS_LABEL.granted, enabled: false, line: "You have access now." };
  if (status === "declined") return { button: ASK_FOR_ACCESS_LABEL, enabled: canRequest, line: note.trim().length > 0 ? `Declined: ${note.trim()}` : "Declined." };
  if (!canRequest) return { button: ASK_FOR_ACCESS_LABEL, enabled: false, line: "Guests cannot ask for access. Ask a member to share it with you." };
  return { button: ASK_FOR_ACCESS_LABEL, enabled: true, line: "" };
}

/** Sends the request. The caller's invoke is the generated client; a duplicate means one is already open, so the state is Waiting either way. */
export async function askForAccess(invoke: AskInvoke, props: Pick<LockedStateProps, "resourceType" | "resourceId">, level: LockedLevel, note: string): Promise<AccessRequestStatus> {
  try {
    await invoke(ASK_CAPABILITY, requestInput(props, level, note));
    return "waiting";
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "validation.duplicate") return "waiting";
    throw error;
  }
}

export interface LockedStateViewProps extends LockedStateProps {
  invoke?: AskInvoke;
  /** Opens the thing once it is granted. */
  onOpen?: () => void;
  testID?: string;
}

const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});
const FIELD_STYLE = { outlineStyle: "none", outlineWidth: 0 } as unknown as TextStyle;
const LOCK = '<svg viewBox="0 0 16 16" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.500" y="7" width="9" height="6.500" rx="1.600"/><path d="M5.500 7V5.200a2.500 2.500 0 015 0V7"/></svg>';
const CHEVRON = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';

function Svg({ markup, color }: { markup: string; color: string }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  return createElement("span", { style: { display: "inline-flex", color }, dangerouslySetInnerHTML: { __html: markup } });
}

export function LockedState(props: LockedStateViewProps): ReactElement {
  const [status, setStatus] = useState<AccessRequestStatus>(props.status);
  const [level, setLevel] = useState<LockedLevel>(props.level);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const menu = useMenu();
  useEffect(() => setStatus(props.status), [props.status]);

  const view = statusView(status, props.canRequest, props.note);
  const compact = props.density === "compact";

  const ask = (): void => {
    if (!view.enabled) return;
    setStatus("waiting");
    setError(null);
    if (props.invoke === undefined) return;
    askForAccess(props.invoke, props, level, note).then(setStatus, (e: unknown) => {
      setStatus(props.status);
      setError((e as { message?: string } | null)?.message ?? "Could not send the request. Try again.");
    });
  };

  const levels = (): MenuEntry[] => LOCKED_LEVELS.map((l) => ({ label: l.label, checked: l.id === level, onSelect: () => setLevel(l.id) }));
  const pickLevel = (x: number, y: number): void => menu.show(levels(), x, y, "context", { label: "Access level" });
  const canPick = status === "none" || status === "declined";

  return (
    <View style={[styles.root, compact && styles.rootCompact]} testID={props.testID ?? `locked-${props.resourceId}`} accessibilityRole="alert" accessibilityLabel={`${props.title} is locked`}>
      <View style={styles.icon}><Svg markup={LOCK} color="var(--ink-4)" />{Platform.OS === "web" ? null : <Text style={styles.nativeLock}>{"⚿"}</Text>}</View>
      <Text style={styles.title}>{props.title}</Text>
      <Text style={styles.reason} testID="locked-reason">{reasonLine(props.reason, props.title)}</Text>
      {canPick && props.canRequest ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Level to ask for: ${levelLabel(level)}`}
          onPress={(e: { nativeEvent?: { pageX?: number; pageY?: number } }) => pickLevel(e.nativeEvent?.pageX ?? 0, e.nativeEvent?.pageY ?? 0)}
          testID="locked-level"
          {...menuTrigger(pickLevel)}
          style={({ hovered }: { hovered?: boolean }) => [styles.level, hovered === true && styles.levelHover]}
        >
          <Text style={styles.levelText}>{`Ask for ${levelLabel(level)}`}</Text>
          <Svg markup={CHEVRON} color="var(--ink-3)" />
        </Pressable>
      ) : null}
      {canPick && props.canRequest ? (
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Add a note for the owner (optional)"
          placeholderTextColor="var(--ink-4)"
          accessibilityLabel="Note for the owner"
          testID="locked-note"
          style={[styles.note, FIELD_STYLE]}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={view.button}
        accessibilityState={{ disabled: !view.enabled }}
        disabled={!view.enabled}
        onPress={status === "granted" ? props.onOpen : ask}
        testID="locked-ask"
        {...webProps({ title: view.button })}
        style={({ hovered }: { hovered?: boolean }) => [styles.button, !view.enabled && styles.buttonOff, status === "granted" && styles.buttonOk, hovered === true && view.enabled && styles.buttonHover]}
      >
        <Text style={[styles.buttonText, !view.enabled && status !== "granted" && styles.buttonTextOff]}>{status === "granted" ? "Open" : view.button}</Text>
      </Pressable>
      {error !== null ? <Text style={[styles.line, styles.lineError]} testID="locked-error" accessibilityLiveRegion="polite">{error}</Text> : view.line.length > 0 ? <Text style={styles.line} testID="locked-line" accessibilityLiveRegion="polite">{view.line}</Text> : null}
      {menu.element}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: "100%", maxWidth: 360, alignSelf: "center", alignItems: "center", paddingVertical: 24, paddingHorizontal: 24, gap: 6 },
  rootCompact: { paddingHorizontal: 20 },
  icon: { width: 24, height: 24, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  nativeLock: { color: "var(--ink-4)" as string, fontSize: 20 },
  title: { color: "var(--ink)" as string, fontSize: 17, lineHeight: 24, fontWeight: "600", textAlign: "center" },
  reason: { color: "var(--ink-3)" as string, fontSize: 13.5, lineHeight: 20, textAlign: "center" },
  level: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 5, height: 28, paddingHorizontal: 10, borderRadius: 7 },
  levelHover: { backgroundColor: "var(--hover)" as string },
  levelText: { color: "var(--ink-2)" as string, fontSize: 13 },
  note: { width: "100%", height: 34, borderRadius: 8, paddingHorizontal: 11, backgroundColor: "var(--sunk)" as string, color: "var(--ink)" as string, fontSize: 13, borderWidth: 0 },
  button: { marginTop: 12, minWidth: 120, height: 32, paddingHorizontal: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent)" as string },
  buttonOff: { backgroundColor: "var(--hover)" as string },
  buttonOk: { backgroundColor: "var(--accent)" as string },
  buttonHover: { opacity: 0.92 },
  buttonText: { color: "var(--accent-ink)" as string, fontSize: 13, fontWeight: "500" },
  buttonTextOff: { color: "var(--ink-3)" as string },
  line: { color: "var(--ink-3)" as string, fontSize: 12.5, lineHeight: 18, textAlign: "center", marginTop: 4 },
  lineError: { color: "var(--danger)" as string },
});
