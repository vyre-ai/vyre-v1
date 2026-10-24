// Empty, offline, error and loading views for a Kit screen (spec 3.0). One line and one primary action for empty and
// offline. Error: what, a next step, the trace id, Retry, Copy trace id, Report a problem. Loading is a skeleton of the
// same row height as real rows so the swap never moves the layout.
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { KitScreenDef } from "../types.ts";
import type { KitEnv } from "./env.ts";
import { Icon } from "./icons.tsx";

export const ROW_HEIGHT = 40;
export const SKELETON_ROWS = 8;

function QuietButton({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.button, (hovered || pressed) && styles.buttonHover]}
    >
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
    </Pressable>
  );
}

export function SkeletonRows({ rows = SKELETON_ROWS }: { rows?: number }) {
  return (
    <View accessibilityLabel="Loading" accessibilityState={{ busy: true }} testID="kit-skeleton" style={styles.fill}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.skelRow}>
          <View style={[styles.skelBar, { width: `${70 - (i % 4) * 11}%` }]} />
        </View>
      ))}
    </View>
  );
}

export function KitStateView({ def, kind, env, onPrimary }: {
  def: KitScreenDef;
  kind: "empty" | "offline" | "error";
  env: KitEnv;
  onPrimary?: () => void;
}) {
  const line = def.states[kind];
  if (kind === "error") {
    const err = def.states.error;
    const traceId = env.traceId;
    return (
      <View style={styles.center} accessibilityRole="alert" testID="kit-state-error">
        <Icon name="error" color="var(--danger)" />
        <Text style={styles.line}>{err.line}</Text>
        {traceId ? <Text style={styles.trace} selectable>{traceId}</Text> : null}
        <View style={styles.actions}>
          <QuietButton primary label={err.primary} onPress={() => (onPrimary ?? (() => env.retry?.(def.id)))()} />
          {traceId ? <QuietButton label="Copy trace id" onPress={() => env.copyTraceId?.(traceId)} /> : null}
          <QuietButton label="Report a problem" onPress={() => env.reportProblem?.(def.id, traceId)} />
        </View>
      </View>
    );
  }
  const primary = line.primary;
  return (
    <View style={styles.center} testID={`kit-state-${kind}`}>
      <Icon name={kind === "offline" ? "offline" : "inbox"} />
      <Text style={styles.line}>{line.line}</Text>
      {primary ? <QuietButton primary label={primary} onPress={() => onPrimary?.()} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  line: { color: "var(--ink-2)" as string, fontSize: 14, textAlign: "center" },
  trace: { color: "var(--ink-4)" as string, fontSize: 12 },
  actions: { flexDirection: "row", gap: 4, flexWrap: "wrap", justifyContent: "center" },
  button: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  buttonHover: { backgroundColor: "var(--hover)" as string },
  buttonText: { color: "var(--ink-2)" as string, fontSize: 13, fontWeight: "500" },
  primaryText: { color: "var(--accent-ink)" as string },
  skelRow: { height: ROW_HEIGHT, justifyContent: "center", paddingHorizontal: 16 },
  skelBar: { height: 10, borderRadius: 5, backgroundColor: "var(--sunk)" as string },
});
