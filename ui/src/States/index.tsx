// ui/States: the one empty, offline and error state for every place (spec 3.0).
// Empty and offline: an icon, one line, one primary action. Error: title, one line, Retry; trace id, Copy trace id and Report a problem behind a Details link.

import { createElement, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { STATE_ICONS } from "./props.ts";
import type { ErrorProps, StateIcon, StateProps } from "./props.ts";

export type { StateProps, StateIcon } from "./props.ts";

/** Event name the Report a problem sheet (P-L9_16) listens for. The frozen props carry no report handler. */
export const REPORT_PROBLEM_EVENT = "vyre:report-problem";

// 16px viewBox paths, from VyreUI.empty in the prototype.
export const ICON_PATHS: Record<StateIcon, string[]> = {
  inbox: ["M2.5 9.5l1.6-5.2a1 1 0 011-.8h5.8a1 1 0 011 .8l1.6 5.2V12a1 1 0 01-1 1h-9a1 1 0 01-1-1z", "M2.5 9.5h3l1 1.5h3l1-1.5h3"],
  search: ["M10.5 10.5L14 14", "M11.5 7a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"],
  files: ["M2.5 4.5a1 1 0 011-1h3l1.5 1.5h4.5a1 1 0 011 1v6.5a1 1 0 01-1 1h-9a1 1 0 01-1-1z"],
  records: ["M3.5 2.5h9a1 1 0 011 1v9a1 1 0 01-1 1h-9a1 1 0 01-1-1v-9a1 1 0 011-1z", "M2.5 6h11M2.5 9.5h11M6.5 6v7.5"],
  chat: ["M3 3.5h10a1 1 0 011 1v6a1 1 0 01-1 1H7l-3 2.5v-2.5H3a1 1 0 01-1-1v-6a1 1 0 011-1z"],
  offline: ["M2 6.2a8 8 0 0112 0M4.3 8.8a4.8 4.8 0 017.4 0M8 12h.01", "M2.5 2.5l11 11"],
  error: ["M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z", "M8 5v3.4M8 10.8h.01"],
  done: ["M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z", "M5.6 8.2l1.7 1.7 3.2-3.4"],
};

export function isStateIcon(name: string): name is StateIcon {
  return (STATE_ICONS as readonly string[]).includes(name);
}

/** The icon sits on a quiet rounded tile, so an empty page reads as designed and not as missing. An error's tile is tinted with the danger colour. */
function Icon({ name }: { name: StateIcon }) {
  const tone = name === "error" ? styles.tileError : styles.tile;
  if (Platform.OS !== "web") return <View style={tone}><Text style={styles.glyph}>{name === "error" ? "!" : "o"}</Text></View>;
  const paths = [];
  for (const d of ICON_PATHS[name]) paths.push(createElement("path", { key: d, d }));
  return (
    <View style={tone}>
      {createElement(
        "svg",
        { viewBox: "0 0 16 16", width: 22, height: 22, "aria-hidden": true, "data-icon": name, style: { display: "block", fill: "none", stroke: name === "error" ? "var(--danger)" : "var(--ink-3)", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" } },
        ...paths,
      )}
    </View>
  );
}

function Button({ label, onPress, primary, testID }: { label: string; onPress?: () => void; primary?: boolean; testID: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID} style={({ hovered }: { hovered?: boolean }) => [styles.btn, primary ? styles.primary : styles.quiet, hovered && styles.btnHover]}>
      <Text style={primary ? styles.primaryText : styles.quietText}>{label}</Text>
    </Pressable>
  );
}

function copyTrace(traceId?: string): void {
  const clip = (globalThis as { navigator?: { clipboard?: { writeText(t: string): unknown } } }).navigator?.clipboard;
  if (traceId && clip) void clip.writeText(traceId);
}

function reportProblem(detail: { traceId?: string; code?: string; message: string }): void {
  const g = globalThis as { dispatchEvent?: (e: unknown) => boolean; CustomEvent?: new (t: string, i: { detail: unknown }) => unknown };
  if (g.dispatchEvent && g.CustomEvent) g.dispatchEvent(new g.CustomEvent(REPORT_PROBLEM_EVENT, { detail }));
}

/** Error: title, one line, Retry. The trace id and the two help actions sit behind one quiet Details link. */
export function ErrorState({ props, startOpen = false }: { props: ErrorProps; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const line = props.cause ?? props.next;
  return (
    <View accessibilityRole="alert" testID="state-error" style={styles.box}>
      <Icon name="error" />
      <Text style={styles.title}>{props.message}</Text>
      {line ? <Text style={styles.sub} testID="state-cause">{line}</Text> : null}
      {props.retryable ? <View style={styles.actions}><Button label="Retry" onPress={props.onRetry} primary testID="state-retry" /></View> : null}
      <Pressable accessibilityRole="button" onPress={() => setOpen(!open)} testID="state-details" style={styles.detailsLink}>
          <Text style={styles.detailsText}>{open ? "Hide details" : "Details"}</Text>
      </Pressable>
      {open ? (
        <View style={styles.details} testID="state-details-body">
          {props.next && props.cause ? <Text style={styles.sub} testID="state-next">{props.next}</Text> : null}
          {props.code || props.traceId ? <Text style={styles.trace} testID="state-trace">{[props.code, props.traceId].filter(Boolean).join("  ")}</Text> : null}
          <View style={styles.actions}>
            <Button label="Copy trace id" onPress={() => copyTrace(props.traceId)} testID="state-copy" />
            <Button label="Report a problem" onPress={() => reportProblem({ traceId: props.traceId, code: props.code, message: props.message })} testID="state-report" />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function States(props: StateProps) {
  if (props.kind === "error") return <ErrorState props={props} />;
  const icon: StateIcon = props.icon ?? (props.kind === "offline" ? "offline" : "search");
  return (
    <View accessibilityRole="summary" testID={`state-${props.kind}`} style={styles.box}>
      <Icon name={icon} />
      <Text style={styles.title}>{props.title}</Text>
      {props.action ? <Button label={props.action.label} onPress={props.action.onPress} primary testID="state-action" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, minHeight: 200, alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 56, paddingHorizontal: 24 },
  tile: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 4, backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  tileError: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 4, backgroundColor: "color-mix(in srgb, var(--danger) 10%, transparent)" as string, },
  glyph: { color: "var(--ink-4)" as string, fontSize: 20 },
  title: { color: "var(--ink)" as string, fontSize: 14, lineHeight: 20, fontWeight: "600", textAlign: "center" },
  sub: { color: "var(--ink-3)" as string, fontSize: 12.5, lineHeight: 18, textAlign: "center" },
  detailsLink: { paddingVertical: 2 },
  detailsText: { color: "var(--ink-4)" as string, fontSize: 12 },
  details: { alignItems: "center", gap: 6 },
  trace: { color: "var(--ink-4)" as string, fontSize: 11.5, textAlign: "center" },
  actions: { flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap", justifyContent: "center" },
  btn: { height: 32, paddingHorizontal: 14, borderRadius: 8, justifyContent: "center", marginTop: 4 },
  primary: { backgroundColor: "var(--ink)" as string },
  quiet: { backgroundColor: "transparent" },
  btnHover: { opacity: 0.88 },
  primaryText: { color: "var(--win)" as string, fontSize: 13, fontWeight: "500" },
  quietText: { color: "var(--ink-2)" as string, fontSize: 13, fontWeight: "500" },
});
