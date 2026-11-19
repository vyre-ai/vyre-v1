// The Journey as a path (rc.41): its stages as columns, each with the Automations that run there, how a record gets in and where it ends, where one record is on it, and a test of the whole path.
// What the page draws comes from pathModel.ts; the page only reads (journeys.where, journeys.test_path, records.query) and never changes a record.
import { useReducer, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import { TextButton } from "../canvas/parts.tsx";
import { useConfigExtras } from "../config/data.tsx";
import { columns, pathTest, runOf, strip, testLine, whereLine } from "./pathModel.ts";
import type { Column, Where } from "./pathModel.ts";
import type { Journey, StageCounts } from "./model.ts";

interface Rec {
  id: string;
  name: string;
}
const nameOfRow = (r: { id: string; fields?: Record<string, unknown> }): string => {
  const f = r.fields ?? {};
  for (const k of ["name", "title", "label"]) if (typeof f[k] === "string" && f[k]) return f[k] as string;
  return r.id;
};

export function PathTab({ journey: j, counts }: { journey: Journey; counts: StageCounts }): ReactElement {
  const data = useAutomationsData();
  const extras = useConfigExtras();
  const { element, show } = useMenu();
  const [test, send] = useReducer(pathTest, { phase: "idle" } as const);
  const [rec, setRec] = useState<Rec | null>(null);
  const [where, setWhere] = useState<Where | "none" | null>(null);
  const nameOf = (id: string): string => extras.directory.automations.find((a) => a.id === id)?.name ?? data.name(id);
  const cols = columns(j, counts, nameOf);
  const facts = strip(j);

  const pick = async (x: number, y: number): Promise<void> => {
    let rows: Rec[] = [];
    try {
      const r = (await data.call("records.query", { type: j.recordType, limit: 8 })) as {
        rows?: { id: string; fields?: Record<string, unknown> }[];
      };
      rows = (r.rows ?? []).map((x) => ({ id: x.id, name: nameOfRow(x) }));
    } catch {
      rows = [];
    }
    const items: MenuEntry[] = rows.map((r) => ({ label: r.name, onSelect: () => void choose(r) }));
    if (rec) items.push({ separator: true }, { label: "Clear", onSelect: () => (setRec(null), setWhere(null)) });
    if (items.length === 0) items.push({ label: "No records yet", disabled: true } as MenuEntry);
    show(items, x, y, "context", { label: "Where is a record" });
  };
  const choose = async (r: Rec): Promise<void> => {
    setRec(r);
    setWhere(null);
    try {
      setWhere((await data.call("journeys.where", { journeyId: j.id, recordId: r.id })) as Where);
    } catch {
      setWhere("none");
    }
  };
  const runTest = async (): Promise<void> => {
    if (test.phase === "starting") return;
    send({ type: "start", ...(rec ? { recordName: rec.name } : {}) });
    try {
      const out = (await data.call("journeys.test_path", { journeyId: j.id, ...(rec ? { recordId: rec.id } : {}) })) as {
        runs: Parameters<typeof pathTest>[1] extends infer E ? (E extends { type: "started"; runs: infer R } ? R : never) : never;
      };
      send({ type: "started", runs: out.runs });
    } catch (e) {
      send({ type: "failed", message: (e as { error?: { message?: string } } | null)?.error?.message ?? "The test did not start." });
    }
  };
  const here = where && where !== "none" ? where.stage : null;

  return (
    <View testID="journey-path" style={s.root}>
      <View style={s.strip}>
        {/* ui-rows-lint: not a list (three facts) */}
        {(
          [
            ["Starts when", facts.starts],
            ["Finishes at", facts.finishes],
            ["Carried forward", facts.carried],
          ] as const
        ).map(([k, v]) => (
          <View key={k} style={s.fact}>
            <Text style={s.factKey}>{k}</Text>
            <Text style={s.factVal}>{v}</Text>
          </View>
        ))}
      </View>
      <View style={s.bar}>
        <Pressable
          testID="path-pick"
          accessibilityRole="button"
          onPress={(e) => {
            const n = (e as { nativeEvent?: { pageX?: number; pageY?: number } } | undefined)?.nativeEvent;
            void pick(n?.pageX ?? 0, n?.pageY ?? 0);
          }}
          style={s.pick}
        >
          <Text style={s.pickText}>{rec ? rec.name : "Where is a record?"}</Text>
        </Pressable>
        {where === "none" ? (
          <Text style={s.quiet} testID="path-where">
            That record is not on this Journey.
          </Text>
        ) : where ? (
          <Text style={s.quiet} testID="path-where">
            {whereLine(where)}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        <TextButton
          label={test.phase === "started" || test.phase === "failed" ? "Run again" : "Test the whole path"}
          icon="play"
          testID="path-test"
          disabled={test.phase === "starting"}
          onPress={() => void runTest()}
        />
      </View>
      {test.phase !== "idle" ? (
        <View style={s.testBar} testID="path-test-bar">
          <Text style={s.testText}>{testLine(test)}</Text>
          <TextButton label="Done" testID="path-test-done" onPress={() => send({ type: "reset" })} />
        </View>
      ) : null}
      <ScrollView horizontal contentContainerStyle={s.cols} testID="path-columns">
        {/* ui-rows-lint: not a list (stage columns) */}
        {cols.map((c) => (
          <ColumnView key={c.key} col={c} here={here === c.key} test={test} />
        ))}
      </ScrollView>
      {element}
    </View>
  );
}

function ColumnView({ col, here, test }: { col: Column; here: boolean; test: Parameters<typeof runOf>[0] }): ReactElement {
  return (
    <View style={[s.col, col.final ? s.colFinal : null]} testID={`path-col-${col.key}`}>
      <View style={s.colHead}>
        <Text style={s.colTitle} numberOfLines={1}>
          {col.title}
        </Text>
        <Text style={s.colCount}>{col.count}</Text>
        {here ? <View style={s.here} testID={`path-here-${col.key}`} /> : null}
      </View>
      <Text style={[s.quiet, col.over > 0 ? s.late : null]}>{col.over > 0 ? `${col.limit}. ${col.over} late` : col.limit}</Text>
      {/* ui-rows-lint: not a list (Automation cards) */}
      {col.cards.map((a) => {
        const r = runOf(test, a.id, col.key);
        return (
          <View key={a.id} style={s.card} testID={`path-card-${col.key}-${a.id}`}>
            <Text style={s.cardName} numberOfLines={2}>
              {a.name}
            </Text>
            {r ? <Text style={[s.quiet, r.error ? s.late : null]}>{r.error ?? "Test started. Nothing is sent."}</Text> : null}
          </View>
        );
      })}
      {col.cards.length === 0 ? <Text style={s.quiet}>{col.final ? "A record here has finished." : "Nothing runs here."}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: 12 },
  pick: { height: 32, paddingHorizontal: 12, borderRadius: 12, justifyContent: "center", borderWidth: 1, borderColor: "var(--line-2)" as string },
  pickText: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  strip: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fact: { flexGrow: 1, flexBasis: 180, padding: 12, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  factKey: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase", color: "var(--ink-3)" as string },
  factVal: { marginTop: 2, fontSize: 13, color: "var(--ink)" as string },
  bar: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 36 },
  testBar: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: 12, backgroundColor: "var(--accent-wash)" as string },
  testText: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
  quiet: { fontSize: 12.5, lineHeight: 17, color: "var(--ink-3)" as string },
  late: { color: "var(--warn)" as string },
  cols: { gap: 12, paddingBottom: 12, alignItems: "flex-start" },
  col: { width: 240, gap: 8 },
  colFinal: { opacity: 0.85 },
  colHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  colTitle: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  colCount: { fontSize: 12, color: "var(--ink-3)" as string },
  here: { width: 8, height: 8, borderRadius: 4, backgroundColor: "var(--accent)" as string },
  card: { padding: 12, gap: 4, borderRadius: 12, backgroundColor: "var(--raised)" as string },
  cardName: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
});
