// Move in-flight records to the current version (spec 2.12): "in-flight records stay on their version until a Migrate step with a stage mapping preview". The sheet asks the server what
// would move (journeys.preview_migrate), shows each old stage with how many records are in it and where they would go, lets the person map the ones that have no match, and moves
// nothing until the button is pressed (journeys.migrate). Blockers, such as a stage in use that has no mapping, are listed and keep the button off.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import { TextButton, pointer } from "../canvas/parts.tsx";
import { each } from "../runs/each.ts";
import { Glyph } from "../config/glyphs.tsx";
import { canMigrate, joinNames, migrationLine, plural, stageMapOf } from "./model.ts";
import type { Journey, Preview } from "./model.ts";

export function MigrateSheet({ journey: j, toVersion = j.version, onClose }: { journey: Journey; toVersion?: number; onClose(): void }): ReactElement {
  const data = useAutomationsData();
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [state, setState] = useState<MigrateState>({ phase: "loading" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(overrides);
  useEffect(() => {
    let live = true;
    data.call("journeys.preview_migrate", { journeyId: j.id, toVersion, stageMap: JSON.parse(key) as Record<string, string> })
      .then((p) => { if (live) setState({ phase: "ready", preview: p as Preview }); })
      .catch((e: unknown) => { if (live) setState({ phase: "failed", message: e instanceof Error ? e.message : "That did not load." }); });
    return () => { live = false; };
  }, [data, j.id, toVersion, key]);
  const map = state.phase === "ready" ? stageMapOf(state.preview, overrides) : {};
  const move = async (): Promise<void> => {
    setBusy(true); setErr(null);
    try { await data.call("journeys.migrate", { journeyId: j.id, toVersion, stageMap: map }); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : "That did not work."); setBusy(false); }
  };
  return <MigrateView journey={j} toVersion={toVersion} state={state} overrides={overrides} busy={busy} error={err} onMap={(from, to) => setOverrides((cur) => ({ ...cur, [from]: to }))} onMove={() => void move()} onClose={onClose} />;
}

export type MigrateState = { phase: "loading" } | { phase: "ready"; preview: Preview } | { phase: "failed"; message: string };

/** The sheet itself, from a preview already read: each old stage with its records and where they would go, the blockers, and the button. */
export function MigrateView({ journey: j, toVersion, state, overrides, busy, error, onMap, onMove, onClose }: { journey: Journey; toVersion: number; state: MigrateState; overrides: Readonly<Record<string, string>>; busy: boolean; error: string | null; onMap(from: string, to: string): void; onMove(): void; onClose(): void }): ReactElement {
  const { element, show } = useMenu();
  const titleOf = (k: string): string => j.stages.find((x) => x.key === k)?.title ?? k;
  const map = state.phase === "ready" ? stageMapOf(state.preview, overrides) : {};
  const ok = state.phase === "ready" && canMigrate(state.preview, map) && state.preview.recordsAffected > 0 && !busy;
  return (
    <View testID="migrate-sheet" accessibilityLabel={`Move ${j.name} records to version ${toVersion}`} style={s.card}>
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{`Move records to version ${toVersion}`}</Text>
          <Text style={s.sub}>See where each stage goes before anything moves.</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} testID="migrate-close" style={[s.x, pointer]}><Glyph name="x" size={14} color="var(--ink-3)" /></Pressable>
      </View>
      <ScrollView style={s.scroll} contentContainerStyle={s.body}>
        {state.phase === "loading" ? <Text style={s.dim}>Working out where the records would go…</Text> : null}
        {state.phase === "failed" ? <Text testID="migrate-failed" style={s.err}>{state.message}</Text> : null}
        {state.phase === "ready" ? (
          <>
            <Text testID="migrate-line" style={s.line}>{migrationLine(state.preview)}</Text>
            {each(state.preview.moves, (m) => {
              const to = overrides[m.from] ?? m.to;
              return (
                <View key={m.from} testID={`move-${m.from}`} style={s.move}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={s.from}>{titleOf(m.from)}</Text>
                    <Text style={s.dim}>{plural(m.records, "record")}</Text>
                  </View>
                  <Glyph name="arrow" size={12} color="var(--ink-4)" />
                  <Pressable
                    accessibilityRole="button" accessibilityLabel={`Where ${titleOf(m.from)} goes, ${to ? titleOf(to) : "choose a stage"}`} testID={`map-${m.from}`}
                    onPress={(e) => { const n = (e as { nativeEvent?: { clientX?: number; clientY?: number; pageX?: number; pageY?: number } }).nativeEvent ?? {}; show(each(j.stages, (g) => ({ label: g.title, checked: g.key === to, onSelect: () => onMap(m.from, g.key) })), n.clientX ?? n.pageX ?? 0, n.clientY ?? n.pageY ?? 0, "other", { label: "Where these records go" }); }}
                    style={[s.pick, !to && s.pickEmpty, pointer]}
                  >
                    <Text numberOfLines={1} style={[s.pickText, !to && { color: "var(--warn)" as string }]}>{to ? titleOf(to) : "Choose a stage"}</Text>
                    <Glyph name="chevD" size={11} color="var(--ink-3)" />
                  </Pressable>
                </View>
              );
            })}
            {state.preview.unmapped.length ? <Text testID="migrate-unmapped" style={s.warn}>{`Not mapped yet: ${joinNames(state.preview.unmapped, titleOf)}.`}</Text> : null}
            {each(state.preview.blockers, (b) => <Text key={b} testID="migrate-blocker" style={s.err}>{b}</Text>)}
          </>
        ) : null}
        {error ? <Text testID="migrate-error" style={s.err}>{error}</Text> : null}
      </ScrollView>
      <View style={s.foot}>
        <Text style={s.dim}>Nothing moves until you press the button.</Text>
        <View style={{ flex: 1 }} />
        <TextButton label="Cancel" testID="migrate-cancel" onPress={onClose} />
        <TextButton label={state.phase === "ready" && state.preview.recordsAffected ? `Move ${plural(state.preview.recordsAffected, "record")}` : "Move records"} primary disabled={!ok} testID="migrate-confirm" onPress={onMove} />
      </View>
      {element}
    </View>
  );
}

const s = StyleSheet.create({
  card: { width: 520, maxWidth: "100%", maxHeight: "92%", borderRadius: 14, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingTop: 18, paddingHorizontal: 20, paddingBottom: 10 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string, marginTop: 2 },
  x: { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  scroll: { flexGrow: 0 },
  body: { paddingHorizontal: 20, paddingBottom: 14 },
  line: { fontSize: 13, lineHeight: 19, color: "var(--ink)" as string, marginBottom: 8 },
  move: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  from: { fontSize: 13, color: "var(--ink)" as string },
  dim: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  pick: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, borderRadius: 7, backgroundColor: "var(--hover)" as string, maxWidth: 200 },
  pickEmpty: { borderWidth: 1, borderColor: "var(--warn)" as string },
  pickText: { fontSize: 12.5, color: "var(--ink)" as string, flexShrink: 1 },
  warn: { fontSize: 12.5, lineHeight: 18, color: "var(--warn)" as string, marginTop: 8 },
  err: { fontSize: 12.5, lineHeight: 18, color: "var(--danger)" as string, marginTop: 8 },
  foot: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
});
