// The Report a problem sheet (screen shell.report-problem; spec 5, 3.0): one optional line "What went wrong?", an expandable "What is sent" that lists
// exactly the bundle, Cancel and Send. After Send: "Sent, #1234" and who has it, or "Queued" when offline. Esc closes, Cmd-Enter sends.
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
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

function Button({ label, onPress, primary, testID, disabled }: { label: string; onPress: () => void; primary?: boolean; testID: string; disabled?: boolean }): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled === true}
      onPress={onPress}
      style={({ hovered }: { hovered?: boolean }) => [styles.btn, primary ? styles.btnPrimary : styles.btnPlain, hovered === true && !primary ? { backgroundColor: "var(--hover)" } : null, disabled === true ? { opacity: 0.5 } : null]}
    >
      <Text style={[styles.btnText, primary ? { color: "var(--accent-ink, #fff)", fontWeight: "600" } : null]}>{label}</Text>
    </Pressable>
  );
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

  return (
    <View testID="report-veil" style={styles.veil} {...webOnly({ onKeyDown: onKey })}>
      <Pressable accessibilityLabel="Close" onPress={() => controller.close()} style={StyleSheet.absoluteFill} />
      <View role="dialog" aria-label="Report a problem" testID="report-sheet" style={styles.card}>
        {done ? (
          <>
            <Text style={styles.title} testID="report-result">
              {s.status === "queued" ? "Queued · it sends when you are back online" : `Sent${s.issueNumber ? ` · #${s.issueNumber}` : ""} · ${controller.destination()}`}
            </Text>
            <Text style={styles.sub}>{s.status === "queued" ? `${s.waiting} ${s.waiting === 1 ? "change" : "changes"} waiting. The report keeps the trace ids it has now.` : "You will get a reply in your Inbox when it is fixed."}</Text>
            <View style={styles.actions}><Button testID="report-done" label="Done" primary onPress={() => controller.close()} /></View>
          </>
        ) : (
          <>
            <Text style={styles.title}>Report a problem</Text>
            <TextInput
              ref={input as never}
              testID="report-note"
              accessibilityLabel="What went wrong?"
              value={s.note}
              onChangeText={(t) => controller.setNote(t)}
              placeholder="What went wrong? (optional)"
              placeholderTextColor="var(--ink-3)"
              maxLength={500}
              style={[styles.input, webOnly({ outlineStyle: "none", outlineWidth: 0 }) as object]}
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
              <Text style={styles.summaryText}>{`${s.expanded ? "▾" : "▸"}  What is sent`}</Text>
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
            <View style={styles.actions}>
              <Button testID="report-cancel" label="Cancel" onPress={() => controller.close()} />
              <Button testID="report-send" label={s.status === "sending" ? "Sending…" : "Send"} primary disabled={s.status === "sending"} onPress={() => { void controller.send(); }} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const FIXED = (Platform.OS === "web" ? "fixed" : "absolute") as unknown as "absolute";

const styles = StyleSheet.create({
  veil: { position: FIXED, top: 0, left: 0, right: 0, bottom: 0, zIndex: 99998, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  card: { width: "100%", maxWidth: 520, backgroundColor: "var(--raised)", borderRadius: 14, paddingVertical: 18, paddingHorizontal: 20, boxShadow: "0 0 0 1px var(--line-2), 0 24px 60px rgba(0,0,0,0.4)" } as object,
  title: { fontSize: 15, fontWeight: "600", color: "var(--ink)", marginBottom: 10 },
  sub: { fontSize: 13, color: "var(--ink-3)", marginTop: 6 },
  input: { height: 36, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)", backgroundColor: "var(--sunk)", color: "var(--ink)", paddingHorizontal: 10, fontSize: 13 },
  summary: { marginTop: 12, alignSelf: "flex-start", paddingVertical: 2 },
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
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 16 },
  btn: { height: 32, paddingHorizontal: 14, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  btnPlain: { borderWidth: 1, borderColor: "var(--line-2)" },
  btnPrimary: { backgroundColor: "var(--accent)" },
  btnText: { fontSize: 13, color: "var(--ink)" },
});
