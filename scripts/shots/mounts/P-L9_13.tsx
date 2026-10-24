// Mount for P-L9_13: the Kit runtime navigating a 20-screen run. Each screen is a KitScreenDef built from the generated
// screen index, its queries answer from a delayed fake replica (loading, then rows), so the layout-shift probe sees every
// loading-to-ready swap. The run scrolls (selector [data-testid="kit-run"]); the probe reports p95 frame time and layout shift.
import { useEffect, useState } from "react";
import { ScrollView, Text, StyleSheet, View } from "react-native";
import { screens } from "../../../generated/screens.ts";
import { KitScreen, previewDef, type KitEnv } from "../../../ui/src/kit/runtime/index.ts";
import type { ScreenHooks } from "../../../client/src/index.ts";
import { isScreenPlace } from "../../../ui/src/kit/types.ts";

export const title = "Kit runtime, 20 screens";

const SAMPLE = [
  { title: "Northwind intake", note: "Updated today" },
  { title: "Harbor Legal renewal", note: "Waiting on you" },
  { title: "Voss & Park engagement", note: "3 documents" },
  { title: "Maya Chen", note: "Northwind" },
  { title: "Omar Haddad", note: "Harbor Legal" },
  { title: "Lena Voss", note: "Voss & Park" },
];

type Snap = { status: "loading" } | { status: "ready"; data: unknown };

/** Rows arrive 60 ms after the first subscription, the way a replica answers a fresh screen. */
function delayedHooks(): ScreenHooks {
  const cache = new Map<string, { snap: Snap; listeners: Set<() => void>; started: boolean }>();
  return {
    query(screenId, name) {
      const key = `${screenId}/${name}`;
      let entry = cache.get(key);
      if (!entry) { entry = { snap: { status: "loading" }, listeners: new Set(), started: false }; cache.set(key, entry); }
      const e = entry;
      return {
        subscribe(listener) {
          e.listeners.add(listener);
          if (!e.started) {
            e.started = true;
            setTimeout(() => { e.snap = { status: "ready", data: SAMPLE }; e.listeners.forEach((l) => l()); }, 60);
          }
          return () => { e.listeners.delete(listener); };
        },
        getSnapshot: () => e.snap,
      };
    },
  };
}

const env: KitEnv = { hooks: delayedHooks(), online: true, invoke: () => {} };
const run = screens.filter((s) => isScreenPlace(s.place)).slice(0, 20).map(previewDef);

type Shift = { value: number; sources: { node?: { tagName?: string; getAttribute?(n: string): string | null; parentElement?: { getAttribute?(n: string): string | null } }; previousRect: { y: number; height: number }; currentRect: { y: number; height: number } }[] };

function useShiftReport(): string {
  const [text, setText] = useState("");
  useEffect(() => {
    const G = globalThis as unknown as { PerformanceObserver?: new (cb: (l: { getEntries(): Shift[] }) => void) => { observe(o: object): void } };
    if (!G.PerformanceObserver) return;
    const lines: string[] = [];
    const po = new G.PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        const src = e.sources.map((x) => `${x.node?.tagName}[${x.node?.getAttribute?.("data-testid") ?? x.node?.parentElement?.getAttribute?.("data-testid") ?? ""}] y${Math.round(x.previousRect.y)}->${Math.round(x.currentRect.y)} h${Math.round(x.previousRect.height)}->${Math.round(x.currentRect.height)}`).join(" | ");
        lines.push(`${e.value.toFixed(3)} ${src}`);
      }
      setText(lines.slice(0, 12).join("\n"));
    });
    try { po.observe({ type: "layout-shift", buffered: true }); } catch { /* unsupported */ }
  }, []);
  return text;
}

export default function Mount() {
  const report = useShiftReport();
  return (
    <View style={{ flex: 1 }}>
      <Text testID="shift-report" style={{ position: "absolute", zIndex: 9, right: 0, top: 0, width: 600, backgroundColor: "#fff", color: "#000", fontSize: 10 }}>{report}</Text>
    <ScrollView testID="kit-run" style={styles.run}>
      {run.map((def) => (
        <View key={def.id} style={styles.slot}>
          <KitScreen def={def} env={env} />
        </View>
      ))}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  run: { flex: 1, backgroundColor: "var(--win)" as string },
  slot: { height: 320, overflow: "hidden", borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
});
