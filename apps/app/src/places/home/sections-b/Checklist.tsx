// Home > Set up: the one setup card. Home draws the person's onboarding steps and nothing else: one ui/Row per step with an icon tile, the title, and Set up (or Resume) on the right.
// A done step shows a check and no button; a step put off says so. The card shows "n of N", can be hidden (with Undo on the line that replaces it) and goes away once every step is done.
// The rows come from the onboarding host's progress (onboarding/store.ts); a Space whose host has not read the progress yet draws nothing.
import { createElement, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { setupRows } from "../../../onboarding/SetupRows.tsx";
import { detectDevice } from "../../../onboarding/device.ts";
import { openOnboarding, readProgress, watchProgress } from "../../../onboarding/store.ts";
import { stepLook } from "../../../onboarding/stepStyle.ts";
import { GoButton, Icon } from "./parts.tsx";

// Hiding is the person's own choice on this computer, kept across restarts.
const KEY = "vyre.home.setup.hidden";
const watchers = new Set<() => void>();
let hidden = ((): boolean => { try { return (globalThis as { localStorage?: Storage }).localStorage?.getItem(KEY) === "1"; } catch { return false; } })();
const readHidden = (): boolean => hidden;
const watchHidden = (fn: () => void): (() => void) => { watchers.add(fn); return () => { watchers.delete(fn); }; };
export function setSetupHidden(v: boolean): void {
  hidden = v;
  try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(KEY, v ? "1" : "0"); } catch { /* private window: it lasts until the page reloads */ }
  for (const w of watchers) w();
}

export function Checklist(): ReactElement | null {
  const p = useSyncExternalStore(watchProgress, readProgress, readProgress);
  const off = useSyncExternalStore(watchHidden, readHidden, readHidden);
  const width = useWindowDimensions().width;
  if (!p) return null;
  const rows = setupRows(p.flow, p.progress, detectDevice(width));
  const done = rows.filter((r) => r.state === "done").length;
  if (rows.length === 0 || done === rows.length) return null;
  if (off) {
    return (
      <View testID="s-first" accessibilityLabel="Set up" style={local.card}>
        <View style={local.hidden}><Text style={local.n}>Setup hidden</Text><Pressable accessibilityRole="button" testID="first-undo" onPress={() => setSetupHidden(false)}><Text style={local.link}>Undo</Text></Pressable></View>
      </View>
    );
  }
  const items: ReactElement[] = [];
  rows.forEach((r, i) => {
    const open = (): void => { openOnboarding(r.key); };
    items.push(
      <View key={r.key} style={[local.item, i > 0 && local.itemLine]} testID={`first-setup-${r.key}`}>
        <Row
          id={`first-setup-${r.key}`}
          title={r.title}
          {...(r.state === "done" ? {} : { note: r.state === "later" ? "Skipped" : r.note })}
          leading={<StepIcon flow={p.flow} k={r.key} done={r.state === "done"} />}
          trailing={r.state === "done" ? null : <GoButton label={r.state === "later" ? "Resume" : "Set up"} testID={`first-go-setup-${r.key}`} onPress={open} />}
          {...(r.state === "done" ? {} : { onPress: open })}
        />
      </View>,
    );
  });
  return (
    <View testID="s-first" accessibilityLabel="Set up" style={local.card}>
      <View style={local.head}>
        <Text accessibilityRole="header" style={local.title}>Set up</Text>
        <Text style={local.n} testID="first-progress">{`${done} of ${rows.length}`}</Text>
        <View style={local.grow} />
        <Pressable accessibilityRole="button" testID="first-hide" onPress={() => setSetupHidden(true)}><Text style={local.hide}>Hide checklist</Text></Pressable>
      </View>
      <View style={local.body} accessibilityRole="list">{items}</View>
    </View>
  );
}

const PATH_ICON = (paths: readonly string[], size: number): ReactElement | null => {
  if (Platform.OS !== "web") return null;
  const kids: ReactElement[] = [];
  for (const d of paths) kids.push(createElement("path", { key: d, d }));
  return createElement("svg", { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: "#fff", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } }, ...kids);
};

function StepIcon({ flow, k, done }: { flow: Parameters<typeof stepLook>[0]; k: string; done: boolean }): ReactElement {
  const look = stepLook(flow, k);
  const bg = done ? { backgroundColor: "var(--ok)" } : { backgroundImage: `linear-gradient(180deg, ${look.from}, ${look.to})` };
  return (
    <View testID={done ? "check-done" : "check-open"} style={[local.tile, bg as object]}>
      {done ? <Icon name="check" size={14} color="#fff" width={2.2} /> : PATH_ICON(look.icon, 15)}
    </View>
  );
}

const local = StyleSheet.create({
  card: { marginTop: -4, marginBottom: 22 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, height: 24, marginBottom: 4 },
  title: { fontSize: 12, fontWeight: "500", color: "var(--ink-3)" as string },
  n: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  grow: { flex: 1 },
  hide: { fontSize: 12, color: "var(--ink-3)" as string },
  link: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  hidden: { flexDirection: "row", alignItems: "center", gap: 8, height: 24 },
  body: { borderRadius: 12, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string, overflow: "hidden" },
  item: { paddingVertical: 4, paddingHorizontal: 6 },
  itemLine: { borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  tile: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", marginRight: 12 },
  tileOpen: {},
});
