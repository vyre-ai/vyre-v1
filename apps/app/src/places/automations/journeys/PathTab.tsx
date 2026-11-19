// The Journey as a path (rc.41): its stages as columns with the Automations that run in each, how a record gets in, where it ends, where one record is on it, and a test of the whole path.
// What the page draws comes from pathModel.ts. The page reads (journeys.where, journeys.test_path, records.query, automations.list); the only things it changes are the design (add an Automation to a stage, a stage's time limit),
// saved through the same journeys.design every edit uses.
import { useEffect, useReducer, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import { TextButton } from "../canvas/parts.tsx";
import { useConfigExtras } from "../config/data.tsx";
import { needsYou } from "../sidebar/model.ts";
import type { AutoRow } from "../sidebar/model.ts";
import type { Design } from "./data.ts";
import { LIMIT_CHOICES, addAutomation, limitWords, setTimeLimit } from "./model.ts";
import type { Journey, StageCounts } from "./model.ts";
import { columns, pathTest, runOf, strip, testLine, whereLine } from "./pathModel.ts";
import type { AutoInfo, Column, Where } from "./pathModel.ts";

interface Rec {
  id: string;
  name: string;
}
const nameOfRow = (r: { id: string; fields?: Record<string, unknown> }): string => {
  const f = r.fields ?? {};
  for (const k of ["name", "title", "label"]) if (typeof f[k] === "string" && f[k]) return f[k] as string;
  return r.id;
};
const at = (e: unknown): { x: number; y: number } => {
  const n = (e as { nativeEvent?: { pageX?: number; pageY?: number } } | undefined)?.nativeEvent;
  return { x: n?.pageX ?? 0, y: n?.pageY ?? 0 };
};
const DOT = { on: "var(--ok)", needs: "var(--warn)", off: "var(--ink-4)" } as const;

export function PathTab({
  journey: j,
  counts,
  start,
  design,
  canDesign = false,
}: {
  journey: Journey;
  counts: StageCounts;
  /** Open already looking at one record, and optionally with its whole-path test started (a link into the page, and the screenshots). */
  start?: { recordId: string; name: string; test?: boolean };
  /** The design writer; with canDesign the columns can take an Automation and a time limit. */
  design?: Design;
  canDesign?: boolean;
}): ReactElement {
  const data = useAutomationsData();
  const extras = useConfigExtras();
  const { element, show } = useMenu();
  const [test, send] = useReducer(pathTest, { phase: "idle" } as const);
  const [rec, setRec] = useState<Rec | null>(null);
  const [where, setWhere] = useState<Where | "none" | null>(null);
  const [autos, setAutos] = useState<readonly AutoRow[]>([]);
  useEffect(() => {
    let live = true;
    data
      .call("automations.list", {})
      .then((r) => {
        if (live) setAutos(((r as { automations?: AutoRow[] }).automations ?? []) as AutoRow[]);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [data]);
  const info = (id: string): AutoInfo | undefined => {
    const a = autos.find((x) => x.id === id);
    const name = a?.name ?? extras.directory.automations.find((x) => x.id === id)?.name;
    if (!name) return undefined;
    return { name, ...(a?.sentence ? { sentence: a.sentence } : {}), state: a ? (needsYou(a) ? "needs" : a.status === "on" ? "on" : "off") : "off" };
  };
  const cols = columns(j, counts, info);
  const facts = strip(j);
  const open = cols.filter((c) => !c.final);
  const done = cols.filter((c) => c.final);

  const choose = async (r: Rec): Promise<void> => {
    setRec(r);
    setWhere(null);
    try {
      setWhere((await data.call("journeys.where", { journeyId: j.id, recordId: r.id })) as Where);
    } catch {
      setWhere("none");
    }
  };
  const pick = async (x: number, y: number): Promise<void> => {
    let rows: Rec[] = [];
    try {
      const r = (await data.call("records.query", { type: j.recordType, limit: 8 })) as {
        rows?: { id: string; fields?: Record<string, unknown> }[];
      };
      rows = (r.rows ?? []).map((q) => ({ id: q.id, name: nameOfRow(q) }));
    } catch {
      rows = [];
    }
    const items: MenuEntry[] = rows.map((r) => ({ label: r.name, onSelect: () => void choose(r) }));
    if (rec) items.push({ separator: true }, { label: "Clear", onSelect: () => (setRec(null), setWhere(null)) });
    if (items.length === 0) items.push({ label: "No records yet", disabled: true } as MenuEntry);
    show(items, x, y, "context", { label: "Where is a record" });
  };
  const runTest = async (on: Rec | null = rec): Promise<void> => {
    if (test.phase === "starting") return;
    send({ type: "start", ...(on ? { recordName: on.name } : {}) });
    try {
      const out = (await data.call("journeys.test_path", { journeyId: j.id, ...(on ? { recordId: on.id } : {}) })) as {
        runs: Parameters<typeof pathTest>[1] extends infer E ? (E extends { type: "started"; runs: infer R } ? R : never) : never;
      };
      send({ type: "started", runs: out.runs });
    } catch (e) {
      send({ type: "failed", message: (e as { error?: { message?: string } } | null)?.error?.message ?? "The test did not start." });
    }
  };
  useEffect(() => {
    if (!start) return;
    void (async () => {
      await choose({ id: start.recordId, name: start.name });
      if (start.test) await runTest({ id: start.recordId, name: start.name });
    })();
    // once, when the page opens on a record
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The menu under a column's plus: an Automation that exists and is not in the stage yet, and the stage's time limit. */
  const addMenu = (c: Column, x: number, y: number): void => {
    if (!design) return;
    const stage = j.stages.find((s) => s.key === c.key);
    const taken = new Set(stage?.automations ?? []);
    const items: MenuEntry[] = [{ head: `Add to ${c.title}` }];
    const free = autos.filter((a) => !taken.has(a.id)).slice(0, 12);
    for (const a of free)
      items.push({ label: a.name, onSelect: () => void design.design(addAutomation(j.stages, c.key, a.id), `Added ${a.name} to ${c.title}`) });
    if (free.length === 0) items.push({ label: "Every Automation is here already", disabled: true } as MenuEntry);
    items.push({ separator: true }, { head: "Time limit" });
    for (const h of LIMIT_CHOICES) {
      const l = { hours: h, ...(stage?.timeLimit?.escalateTo ? { escalateTo: stage.timeLimit.escalateTo } : {}) };
      items.push({
        label: limitWords(l, (id) => id),
        checked: stage?.timeLimit?.hours === h,
        onSelect: () => void design.design(setTimeLimit(j.stages, c.key, l), `${c.title}: ${limitWords(l, (id) => id)}`),
      });
    }
    if (stage?.timeLimit)
      items.push({ label: "No limit", onSelect: () => void design.design(setTimeLimit(j.stages, c.key, null), `${c.title}: no limit`) });
    show(items, x, y, "context", { label: `Add to ${c.title}` });
  };
  const here = where && where !== "none" ? where.stage : null;
  const col = (c: Column): ReactElement => (
    <ColumnView
      key={c.key}
      col={c}
      here={here === c.key}
      test={test}
      onOpen={(id) => data.nav.openAutomation(id)}
      {...(canDesign && design && !c.final ? { onAdd: (e: unknown) => addMenu(c, at(e).x, at(e).y) } : {})}
    />
  );

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
          onPress={(e) => void pick(at(e).x, at(e).y)}
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
        {open.map(col)}
        {done.length > 0 ? (
          <View style={s.finish} testID="path-finish">
            <Text style={s.finishCap}>Finish lines</Text>
            {/* ui-rows-lint: not a list (finish lines) */}
            {done.map(col)}
            <Text style={s.quiet}>A record that reaches a finish line has finished the Journey.</Text>
          </View>
        ) : null}
      </ScrollView>
      {element}
    </View>
  );
}

function ColumnView({
  col,
  here,
  test,
  onOpen,
  onAdd,
}: {
  col: Column;
  here: boolean;
  test: Parameters<typeof runOf>[0];
  onOpen(id: string): void;
  onAdd?: (e: unknown) => void;
}): ReactElement {
  return (
    <View style={s.col} testID={`path-col-${col.key}`}>
      <View style={s.colHead}>
        <Text style={s.colTitle} numberOfLines={1}>
          {col.title}
        </Text>
        <Text style={s.colCount}>{col.count}</Text>
        {here ? <View style={s.here} testID={`path-here-${col.key}`} /> : null}
      </View>
      {col.limit ? <Text style={[s.quiet, col.over > 0 ? s.late : null]}>{col.over > 0 ? `${col.limit}. ${col.over} late` : col.limit}</Text> : null}
      {/* ui-rows-lint: not a list (Automation cards) */}
      {col.cards.map((a) => {
        const r = runOf(test, a.id, col.key);
        return (
          <Pressable key={a.id} accessibilityRole="button" onPress={() => onOpen(a.id)} style={s.card} testID={`path-card-${col.key}-${a.id}`}>
            <View style={s.cardTop}>
              <View style={[s.dot, { backgroundColor: DOT[a.state] as string }]} />
              <Text style={s.cardName} numberOfLines={2}>
                {a.name}
              </Text>
            </View>
            {a.sentence ? (
              <Text style={s.quiet} numberOfLines={3}>
                {a.sentence}
              </Text>
            ) : null}
            {r ? <Text style={[s.quiet, r.error ? s.late : null]}>{r.error ?? "Test started. Nothing is sent."}</Text> : null}
          </Pressable>
        );
      })}
      {onAdd ? (
        <Pressable testID={`path-add-${col.key}`} accessibilityRole="button" onPress={onAdd} style={s.add}>
          <Text style={s.addText}>+  Add an Automation</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: 12 },
  strip: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fact: { flexGrow: 1, flexBasis: 180, padding: 12, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  factKey: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase", color: "var(--ink-3)" as string },
  factVal: { marginTop: 2, fontSize: 13, color: "var(--ink)" as string },
  bar: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 36 },
  pick: { height: 32, paddingHorizontal: 12, borderRadius: 12, justifyContent: "center", borderWidth: 1, borderColor: "var(--line-2)" as string },
  pickText: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  testBar: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: 12, backgroundColor: "var(--accent-wash)" as string },
  testText: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
  quiet: { fontSize: 12.5, lineHeight: 17, color: "var(--ink-3)" as string },
  late: { color: "var(--warn)" as string },
  cols: { gap: 12, paddingBottom: 12, alignItems: "flex-start" },
  col: { width: 240, gap: 8 },
  colHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
  colTitle: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  colCount: { fontSize: 12, color: "var(--ink-3)" as string },
  here: { width: 8, height: 8, borderRadius: 4, backgroundColor: "var(--accent)" as string },
  card: { padding: 12, gap: 6, borderRadius: 12, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-1), inset 0 0 0 1px var(--line)" } as object,
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardName: { flex: 1, fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  dot: { width: 8, height: 8, borderRadius: 4 },
  add: { height: 32, borderRadius: 12, justifyContent: "center", paddingHorizontal: 10 },
  addText: { fontSize: 13, fontWeight: "500", color: "var(--ink-3)" as string },
  finish: { gap: 8, paddingLeft: 12, marginLeft: 4, borderLeftWidth: 1, borderLeftColor: "var(--line-2)" as string, borderStyle: "dashed" },
  finishCap: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase", color: "var(--ink-3)" as string },
  finishLine: { flexDirection: "row", alignItems: "center", gap: 8, height: 40, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  finishName: { flex: 1, fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
});
