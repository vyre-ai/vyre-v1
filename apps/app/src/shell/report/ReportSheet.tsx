// The Report a problem sheet (screen shell.report-problem; spec 5, 3.0): one optional line "What went wrong?", an expandable "What is sent" that lists
// exactly the bundle, Cancel and Send. After Send: "Sent, #1234" and who has it, or "Queued" when offline. Esc closes, Cmd-Enter sends.
import { createElement, useEffect, useRef, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { TextField } from "../../../../../ui/src/TextField/index.tsx";
import { Dialog } from "../../../../../ui/src/Dialog/index.tsx";
import type { ReportController, ReportState } from "./controller.ts";

const webOnly = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});

export function useReportState(ctl: ReportController): ReportState {
  return useSyncExternalStore(ctl.subscribe, ctl.getState, ctl.getState);
}

export interface ReportSheetProps {
  controller: ReportController;
  /** False when the device is offline: the sheet says Send queues. */
  online?: boolean;
  /** Where the sheet sits: "fixed" over the window (default) or "absolute" inside a frame (the screenshot mount). */
  autoFocus?: boolean;
}

export function ReportSheet({ controller, online = true, autoFocus = true }: ReportSheetProps): ReactElement | null {
  const s = useReportState(controller);
  const input = useRef<unknown>(null);
  useEffect(() => {
    if (s.open && autoFocus && Platform.OS === "web") (input.current as { focus?: () => void } | null)?.focus?.();
  }, [s.open, autoFocus]);
  if (!s.open) return null;

  const done = s.status === "sent" || s.status === "queued";
  const onKey = (e: { key: string; metaKey?: boolean; ctrlKey?: boolean; preventDefault?: () => void }): void => {
    if (e.key === "Escape") { e.preventDefault?.(); controller.close(); }
    else if (e.key === "Enter" && !done) { e.preventDefault?.(); void controller.send(); }
  };

  const facts: ReactNode[] = [];
  for (const r of s.rows) {
    facts.push(
      <View key={r.label} style={styles.fr}>
        <Text style={styles.fl}>{r.label}</Text>
        <Text style={styles.fv} testID={`report-fact-${r.label}`}>{r.value}</Text>
      </View>,
    );
  }

  const doneTitle = s.status === "queued" ? "Queued · it sends when you are back online" : `Sent${s.issueNumber ? ` · #${s.issueNumber}` : ""} · ${controller.destination()}`;
  if (done) {
    return (
      <Dialog title={doneTitle} titleTestID="report-result" testID="report-sheet" veilTestID="report-veil" onClose={() => controller.close()} actions={[{ label: "Done", primary: true, testID: "report-done", onPress: () => controller.close() }]}>
        <Text style={styles.sub}>{s.status === "queued" ? `${s.waiting} ${s.waiting === 1 ? "change" : "changes"} waiting. The report keeps the trace ids it has now.` : "You will get a reply in your Inbox when it is fixed."}</Text>
      </Dialog>
    );
  }
  return (
    <Dialog
      title="Report a problem" testID="report-sheet" veilTestID="report-veil" onClose={() => controller.close()} width={520}
      actions={[{ label: "Cancel", testID: "report-cancel", onPress: () => controller.close() }, { label: s.status === "sending" ? "Sending…" : "Send", primary: true, testID: "report-send", disabled: s.status === "sending", onPress: () => { void controller.send(); } }]}
    >
      <TextField
        ref={input as never}
        testID="report-note"
        accessibilityLabel="What went wrong?"
        value={s.note}
        onChangeText={(t) => controller.setNote(t)}
        placeholder="What went wrong? (optional)"
                maxLength={500}
                {...webOnly({ onKeyDown: onKey })}
      />
      <Pressable
        testID="report-disclosure"
        accessibilityRole="button"
        accessibilityLabel="What is sent"
        accessibilityState={{ expanded: s.expanded }}
        onPress={() => controller.toggleExpanded()}
        style={styles.summary}
      >
        <Text style={styles.summaryText}>What is sent</Text>
        <View style={{ transform: [{ rotate: s.expanded ? "90deg" : "0deg" }] }}>{Platform.OS !== "web" ? <Text style={styles.summaryText}>{">"}</Text> : createElement("svg", { viewBox: "0 0 16 16", width: 14, height: 14, "aria-hidden": true, style: { display: "block", fill: "none", stroke: "var(--ink-4)", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } }, createElement("path", { d: "M6 3.500L10.500 8L6 12.500" }))}</View>
      </Pressable>
      {s.expanded ? <View testID="report-facts" style={styles.facts}>{facts}</View> : null}
      {s.policy === "ask" ? (
        <Pressable testID="report-share" accessibilityRole="checkbox" accessibilityState={{ checked: s.shareWithVyre }} onPress={() => controller.setShare(!s.shareWithVyre)} style={styles.shareRow}>
          <View style={[styles.box, s.shareWithVyre ? styles.boxOn : null]}>{s.shareWithVyre ? <Text style={styles.tick}>{"✓"}</Text> : null}</View>
          <Text style={styles.shareText}>Also send to the Vyre team</Text>
        </Pressable>
      ) : null}
      {s.status === "error" ? <Text accessibilityRole="alert" testID="report-error" style={styles.error}>{`It did not send: ${s.error ?? "try again"}`}</Text> : null}
      {!online ? <Text testID="report-offline" style={styles.sub}>You are offline. Send queues the report and it goes when you are back.</Text> : null}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: "var(--ink-3)", marginTop: 6 },
  summary: { marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, borderTopWidth: 1, borderTopColor: "var(--line)" },
  summaryText: { fontSize: 13, color: "var(--ink-3)" },
  facts: { marginTop: 8, maxHeight: 200, overflow: "scroll" } as object,
  fr: { flexDirection: "row", paddingVertical: 3 },
  fl: { width: 110, fontSize: 12, color: "var(--ink-4)", paddingRight: 10 },
  fv: { flex: 1, minWidth: 0, fontSize: 12, color: "var(--ink)" },
  shareRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  box: { width: 16, height: 16, borderRadius: 5, borderWidth: 1.5, borderColor: "var(--line-2)", alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: "var(--accent)", borderColor: "var(--accent)" },
  tick: { fontSize: 11, color: "var(--accent-ink, #fff)", lineHeight: 12 },
  shareText: { fontSize: 13, color: "var(--ink)" },
  error: { marginTop: 10, fontSize: 13, color: "var(--danger)" },
});
