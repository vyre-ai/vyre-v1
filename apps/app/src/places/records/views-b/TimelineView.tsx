// Records > timeline (spec 3.4, 2.9): records with a start and an end as bars on a row of days, grouped in bands by their status. A line marks today. Drag a bar to move it, drag its edges to
// resize it; the dates are written when the pointer lets go. Without a pointer, Alt and an arrow move the focused bar a day, Alt and Shift with an arrow move its end, Enter opens it. When a
// task of a project slips, the plan answers with the later tasks that would move and the bar above the timeline offers Apply or Keep dates. The Projects Plan reuses this timeline.
import { createElement, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { useRecordsData } from "../sidebar/data.tsx";
import { HeadButton } from "../sidebar/parts.tsx";
import { cellText } from "../table/model.ts";
import { badgeFieldOf, each, laneFieldOf } from "../views-a/model.ts";
import { ViewHead, useViewState } from "../views-a/view.tsx";
import type { ViewCtx } from "../views-a/view.tsx";
import { decideCascade, moveBar, moveError } from "./actions.ts";
import { useViewRows } from "./data.ts";
import { BAR_H, DAY, DAY_W, HEAD_H, ROW_H, bandsOf, barsOf, cascadeLine, dateFields, dragBar, hueOfRow, rangeOf, shortDay, spanOf, startOfDay, xOf } from "./model.ts";
import type { Bar, Cascade, DragMode, Range } from "./model.ts";
import { useToday } from "./today.tsx";

const BAND_H = 26;

interface Proposal { cascade: Cascade; projectId: string }

function BarEl({ bar, from, y, label, hue, onOpen, onCommit }: {
  bar: Bar; from: number; y: number; label: string; hue: number; onOpen: () => void; onCommit: (b: Bar, next: { start: number; end: number }) => void;
}): ReactElement {
  const [live, setLive] = useState<{ start: number; end: number } | null>(null);
  const grab = useRef<{ x: number; mode: DragMode; moved: boolean } | null>(null);
  const shown = live ?? bar;
  const x = xOf(shown.start, from), w = Math.max(DAY_W, xOf(shown.end, from) - x + DAY_W);
  const hold = (mode: DragMode) => (e: { clientX: number; preventDefault(): void; stopPropagation(): void }): void => {
    e.preventDefault();
    e.stopPropagation();
    grab.current = { x: e.clientX, mode, moved: false };
    const g = globalThis as unknown as { addEventListener(t: string, f: (ev: { clientX: number }) => void): void; removeEventListener(t: string, f: (ev: { clientX: number }) => void): void };
    const move = (ev: { clientX: number }): void => {
      const s = grab.current;
      if (!s) return;
      if (Math.abs(ev.clientX - s.x) > 3) s.moved = true;
      setLive(dragBar(bar, ev.clientX - s.x, s.mode));
    };
    const up = (ev: { clientX: number }): void => {
      g.removeEventListener("pointermove", move);
      g.removeEventListener("pointerup", up);
      const s = grab.current;
      grab.current = null;
      if (!s) return;
      const next = dragBar(bar, ev.clientX - s.x, s.mode);
      setLive(null);
      if (!s.moved) onOpen();
      else if (next.start !== bar.start || next.end !== bar.end) onCommit(bar, next);
    };
    g.addEventListener("pointermove", move);
    g.addEventListener("pointerup", up);
  };
  const key = (e: { key?: string; altKey?: boolean; shiftKey?: boolean; preventDefault(): void }): void => {
    if (e.key === "Enter") { e.preventDefault(); onOpen(); return; }
    if (e.altKey !== true || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    onCommit(bar, dragBar(bar, (e.key === "ArrowRight" ? 1 : -1) * DAY_W, e.shiftKey === true ? "end" : "move"));
  };
  useEffect(() => () => { grab.current = null; }, []);
  const inside = w >= 120;
  if (Platform.OS !== "web") {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={label} testID={`bar-${bar.id}`} onPress={onOpen} style={[c.bar, { left: x, top: y, width: w, backgroundColor: `hsl(${hue}, 60%, 52%)` }]}>
        {inside ? <Text numberOfLines={1} style={c.barText}>{label}</Text> : null}
      </Pressable>
    );
  }
  return createElement(
    "div",
    {
      key: bar.id, role: "button", tabIndex: 0, "aria-label": label, "data-testid": `bar-${bar.id}`, onKeyDown: key,
      style: { position: "absolute", left: x, top: y, height: BAR_H, width: w, cursor: "grab", touchAction: "none" },
    },
    createElement("div", { "data-testid": `bar-body-${bar.id}`, onPointerDown: hold("move"), style: { position: "absolute", inset: 0, borderRadius: 7, background: `hsl(${hue}, 60%, 52%)`, boxShadow: "var(--sh-1)", overflow: "hidden", display: "flex", alignItems: "center", paddingLeft: 8 } },
      inside ? createElement("span", { style: { fontFamily: "inherit", color: "#fff", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" } }, label) : null),
    createElement("div", { "data-testid": `bar-start-${bar.id}`, onPointerDown: hold("start"), style: { position: "absolute", left: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize" } }),
    createElement("div", { "data-testid": `bar-end-${bar.id}`, onPointerDown: hold("end"), style: { position: "absolute", right: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize" } }),
    inside ? null : createElement("span", { style: { fontFamily: "inherit", position: "absolute", left: w + 6, top: 4, fontSize: 12, color: "var(--ink-2)", whiteSpace: "nowrap", pointerEvents: "none" } }, label),
  );
}

export function TimelineView({ ctx }: { ctx: ViewCtx }): ReactElement {
  const data = useRecordsData();
  const st = useViewState(ctx);
  const menu = useMenu();
  const today = useToday();
  const [picked, setPicked] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { def } = ctx;
  const range: Range | undefined = rangeOf(def, ctx.saved, picked);
  const { rows, count } = useViewRows(ctx.type, st.v, def.titleField);
  const names = data.nameOf;
  const tf = def.fields.find((f) => f.key === def.titleField);
  const badge = badgeFieldOf(def);

  const dateButton = range ? (
    <HeadButton icon="calendar" label="Dates" detail={range.end ? `${range.start.title} to ${range.end.title}` : range.start.title} testID="records-dates" onPress={(x, y) => menu.show([
      { head: "Start the bars at" },
      ...each(dateFields(def), (f) => ({ label: f.title, checked: f.key === range.start.key, onSelect: () => setPicked(f.key) })),
    ], x, y)} />
  ) : null;
  const head = <ViewHead ctx={ctx} st={st} fields={false} extra={dateButton} />;
  if (!range) return <View style={c.main} testID="records-timeline">{head}<States kind="empty" title={`${def.plural} have no date field to draw bars from.`} icon="records" /></View>;

  const bars = barsOf(rows, range, def.titleField);
  const { from, days } = spanOf(bars, today);
  const bands = bandsOf(bars, laneFieldOf(def, ctx.saved));
  const width = days * DAY_W;
  const label = (b: Bar): string => (tf ? cellText(tf, b.row.fields[tf.key], names) : "") || "Untitled";

  const commit = (b: Bar, next: { start: number; end: number }): void => {
    setError(null);
    setProposal(null);
    moveBar(data, def, range, b.row, next).then((m) => { if (m.cascade && m.projectId) setProposal({ cascade: m.cascade, projectId: m.projectId }); }).catch((e: unknown) => setError(moveError(e)));
  };
  const decide = (decision: "apply" | "keep"): void => {
    if (!proposal) return;
    const p = proposal;
    setProposal(null);
    decideCascade(data, p.projectId, p.cascade, decision).catch((e: unknown) => setError(moveError(e)));
  };

  let y = HEAD_H + 6;
  const body: ReactElement[] = [];
  for (const band of bands) {
    if (band.title) {
      body.push(<View key={`band-${band.key}`} testID={`band-${band.key || "none"}`} style={[c.band, { top: y, width }]}><Text style={c.bandText}>{`${band.title}  ${band.bars.length}`}</Text></View>);
      y += BAND_H;
    }
    for (const b of band.bars) {
      body.push(<BarEl key={b.id} bar={b} from={from} y={y} label={label(b)} hue={hueOfRow(badge, b.row)} onOpen={() => data.nav.openRecord(b.id)} onCommit={commit} />);
      y += ROW_H;
    }
  }
  const height = y + 12;
  const ticks: ReactElement[] = [];
  for (let i = 0; i < days; i++) {
    const ms = from + i * DAY;
    const d = new Date(ms);
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    if (weekend) ticks.push(<View key={`w${i}`} style={[c.weekend, { left: i * DAY_W, height }]} />);
    ticks.push(<Text key={`d${i}`} style={[c.tick, { left: i * DAY_W }]}>{d.getUTCDate()}</Text>);
    if (d.getUTCDate() === 1 || i === 0) ticks.push(<Text key={`m${i}`} style={[c.month, { left: i * DAY_W + 4 }]}>{`${shortDay(ms).split(" ")[0]} ${d.getUTCFullYear()}`}</Text>);
    if (d.getUTCDay() === 1) ticks.push(<View key={`l${i}`} style={[c.weekLine, { left: i * DAY_W, height }]} />);
  }
  const todayX = xOf(startOfDay(today), from);

  return (
    <View style={c.main} testID="records-timeline" accessibilityLabel={`${def.plural} timeline`}>
      {head}
      {proposal ? (
        <View style={c.cascade} testID="cascade" accessibilityRole="alert">
          <Text style={c.cascadeText} testID="cascade-line">{cascadeLine(proposal.cascade)}</Text>
          <Pressable accessibilityRole="button" testID="cascade-apply" onPress={() => decide("apply")} style={c.apply}><Text style={c.applyText}>Apply</Text></Pressable>
          <Pressable accessibilityRole="button" testID="cascade-keep" onPress={() => decide("keep")} style={({ hovered }: { hovered?: boolean }) => [c.keep, hovered === true && c.keepOver]}><Text style={c.keepText}>Keep dates</Text></Pressable>
        </View>
      ) : null}
      {error ? <Text style={c.error} accessibilityRole="alert" testID="timeline-error">{error}</Text> : null}
      {bars.length === 0 ? (
        <States kind="empty" title={st.v.clauses.length > 0 || st.v.find ? "Nothing matches these filters." : `No ${def.plural.toLowerCase()} with a ${range.start.title.toLowerCase()} yet.`} icon="records" />
      ) : (
        <ScrollView style={c.scroll} testID="timeline-scroll">
          <ScrollView horizontal contentContainerStyle={{ width, height }}>
            <View style={{ width, height }} testID="timeline-canvas" accessibilityLabel={`${bars.length} bars, ${days} days`}>
              {ticks}
              <View style={[c.headLine, { top: HEAD_H, width }]} />
              {body}
              <View testID="today-line" style={[c.today, { left: todayX + Math.floor(DAY_W / 2), height }]} />
            </View>
          </ScrollView>
        </ScrollView>
      )}
      <Text style={c.foot} testID="records-count">{`${count.toLocaleString("en-US")} ${count === 1 ? def.title.toLowerCase() : def.plural.toLowerCase()}`}</Text>
      {menu.element}
    </View>
  );
}

const c = StyleSheet.create({
  main: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  scroll: { flex: 1 },
  bar: { position: "absolute", height: BAR_H, borderRadius: 7, justifyContent: "center", paddingHorizontal: 8 },
  barText: { color: "#fff", fontSize: 12, fontWeight: "500" },
  band: { position: "absolute", left: 0, height: BAND_H, justifyContent: "center", paddingLeft: 12, backgroundColor: "var(--sunk)" as string },
  bandText: { fontSize: 12, fontWeight: "600", color: "var(--ink-2)" as string, position: "absolute", left: 12 },
  weekend: { position: "absolute", top: 0, width: DAY_W, backgroundColor: "var(--sunk)" as string, opacity: 0.6 },
  weekLine: { position: "absolute", top: 0, width: 1, backgroundColor: "var(--line)" as string },
  tick: { position: "absolute", top: 24, width: DAY_W, textAlign: "center", fontSize: 11, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  month: { position: "absolute", top: 6, fontSize: 12, fontWeight: "600", color: "var(--ink-2)" as string },
  headLine: { position: "absolute", left: 0, height: 1, backgroundColor: "var(--line)" as string },
  today: { position: "absolute", top: 0, width: 2, backgroundColor: "var(--accent)" as string },
  cascade: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingVertical: 8, backgroundColor: "var(--accent-wash)" as string },
  cascadeText: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
  apply: { height: 26, paddingHorizontal: 12, borderRadius: 7, justifyContent: "center", backgroundColor: "var(--accent)" as string },
  applyText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent-ink)" as string },
  keep: { height: 26, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center" },
  keepOver: { backgroundColor: "var(--hover)" as string },
  keepText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string, paddingHorizontal: 18, paddingVertical: 6 },
  foot: { fontSize: 12, color: "var(--ink-3)" as string, textAlign: "center", paddingVertical: 8, fontVariant: ["tabular-nums"] },
});
