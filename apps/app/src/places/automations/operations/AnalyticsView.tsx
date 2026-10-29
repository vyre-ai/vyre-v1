// Analytics from real runs. The Space view covers every automation this person can see; the tab on one automation covers that automation.
// The server counts. This file only draws what came back, and says what to do when nothing has run.
import { useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import { ANALYTICS_LINE, EMPTY_COMPLETED_NEXT, SPACE_ANALYTICS_LINE, SPACE_ANALYTICS_TITLE } from "../chrome.ts";
import { TextButton } from "../canvas/parts.tsx";
import { analyticsOf, durationWords, rateWords } from "./read.ts";
import type { Analytics } from "./read.ts";
import { choiceMenu } from "./menus.ts";
import { Empty, Frame, MenuButton, Row, Status, Tile, useCall, useRowMenu, v } from "./parts.tsx";

export const RANGES = [{ value: 7, label: "Last 7 days" }, { value: 30, label: "Last 30 days" }, { value: 90, label: "Last 90 days" }] as const;

const money = (micros: number): string => (micros === 0 ? "None" : `$${(micros / 1_000_000).toFixed(micros < 10_000 ? 4 : 2)}`);
const dayWords = (day: string): string => new Date(`${day}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

export function Bars({ daily }: { daily: Analytics["daily"] }): ReactElement {
  const top = Math.max(1, ...daily.map((d) => d.succeeded + d.failed + d.other));
  const total = daily.reduce((n, d) => n + d.succeeded + d.failed + d.other, 0);
  return (
    <View testID="analytics-bars" accessible accessibilityRole="image" accessibilityLabel={`Runs per day. ${total} runs in ${daily.length} days.`} style={v.bars}>
      {/* ui-rows-lint: not a list (one bar per day of a chart) */}
      {daily.map((d) => {
        const all = d.succeeded + d.failed + d.other;
        const high = (n: number): number => Math.round((n / top) * 80);
        return (
          <View key={d.day} testID={`bar-${d.day}`} style={v.barCol} {...({ title: `${dayWords(d.day)}: ${d.succeeded} succeeded, ${d.failed} failed, ${d.other} other` } as object)}>
            {all === 0 ? <View style={{ height: 2, backgroundColor: "var(--line)" as string }} /> : (
              <>
                {d.other > 0 ? <View style={{ height: high(d.other), backgroundColor: "var(--ink-4)" as string }} /> : null}
                {d.failed > 0 ? <View style={{ height: high(d.failed), backgroundColor: "var(--danger)" as string }} /> : null}
                {d.succeeded > 0 ? <View style={{ height: high(d.succeeded), backgroundColor: "var(--ok)" as string }} /> : null}
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}

export function busyMenu(id: string, name: string, failed: number, on: { onOpen(id: string): void; onFailed(): void; onAsk(id: string, message: string): void }): MenuEntry[] {
  return [
    { label: "Open", onSelect: () => on.onOpen(id) },
    ...(failed > 0 ? [{ label: "Open failed runs", onSelect: on.onFailed } as MenuEntry] : []),
    { label: "Ask Vyre about this", onSelect: () => on.onAsk(id, `Why do runs of ${name} fail?`) },
  ];
}

/** The report, given the numbers. Nothing here loads. */
export function AnalyticsReport({ report, scope, onOpen, onFailed, onAsk }: {
  report: Analytics; scope: "space" | "automation"; onOpen(id: string): void; onFailed(): void; onAsk(id: string, message: string): void;
}): ReactElement {
  const t = report.totals;
  const rm = useRowMenu();
  const names = new Map(report.automations.map((a) => [a.automationId, a.name]));
  return (
    <View testID="analytics-report" style={v.stack}>
      {rm.element}
      <View style={v.tiles}>
        <Tile testID="tile-runs" label="Runs" value={String(t.runs)} note={t.active > 0 ? `${t.active} still going` : undefined} />
        <Tile testID="tile-succeeded" label="Succeeded" value={String(t.succeeded)} />
        <Tile testID="tile-failed" label="Failed" value={String(t.failed)} {...(t.failed > 0 ? { tone: "danger" as const } : {})} />
        <Tile testID="tile-rate" label="Success rate" value={rateWords(t.successRate)} note={t.successRate === null ? "Needs one finished run" : undefined} />
        <Tile testID="tile-median" label="Typical time" value={durationWords(t.medianMs)} />
        <Tile testID="tile-cost" label="AI cost" value={money(t.costMicros)} />
      </View>
      <Text style={v.section}>Runs per day</Text>
      <Bars daily={report.daily} />
      {scope === "space" ? (
        <>
          <Text style={v.section}>Busiest automations</Text>
          <View style={v.list}>
            {report.automations.map((a) => (
              <Row
                key={a.automationId} id={`busy-${a.automationId}`} title={a.name} onPress={() => onOpen(a.automationId)}
                trailing={<View style={v.actions}>{a.failed > 0 ? <Text style={v.tag}>{`${a.failed} failed`}</Text> : null}<Text style={v.right}>{`${a.runs} runs`}</Text></View>}
                domProps={{ "aria-label": `${a.name}, ${a.runs} runs, ${a.failed} failed. Open`, ...rm.rowDom(a.name, () => busyMenu(a.automationId, a.name, a.failed, { onOpen, onFailed, onAsk })) }}
              />
            ))}
          </View>
        </>
      ) : null}
      <Text style={v.section}>Where failures stop</Text>
      {report.failures.length === 0 ? <Text style={v.dim}>{t.failed === 0 ? "No run failed in this period." : "The failed runs have no step log to read."}</Text> : (
        <View style={v.list}>
          {report.failures.map((f) => {
            const owner = f.automationId ? names.get(f.automationId) ?? f.automationId : null;
            return (
              <Row
                key={`${f.automationId}-${f.step}-${f.code}`} id={`stop-${f.step}`} title={`Step ${f.step}${owner ? ` in ${owner}` : ""}`} note={f.code}
                trailing={<Text style={v.right}>{`${f.count}×`}</Text>}
                {...(f.automationId ? { onPress: () => onOpen(f.automationId!) } : {})}
                domProps={{ "aria-label": `Step ${f.step} failed ${f.count} times with ${f.code}${owner ? ` in ${owner}` : ""}` }}
              />
            );
          })}
        </View>
      )}
    </View>
  );
}

function RangeMenu({ days, onDays }: { days: number; onDays(n: number): void }): ReactElement {
  return <MenuButton testID="analytics-range" label={RANGES.find((r) => r.value === days)?.label ?? `Last ${days} days`} entries={choiceMenu(RANGES, days as 7 | 30 | 90, onDays)} />;
}

function useReport(automationId: string | undefined, days: number, again: number) {
  return useCall("automations.analytics", { days, ...(automationId ? { automationId } : {}) }, analyticsOf, again);
}

/** Space home. The shell's Analytics view. */
export function SpaceAnalytics(): ReactElement {
  const data = useAutomationsData();
  const [days, setDays] = useState(30);
  const [again, setAgain] = useState(0);
  const state = useReport(undefined, days, again);
  const empty = state.phase === "ready" && state.value.totals.runs === 0;
  return (
    <Frame testID="space-analytics" title={SPACE_ANALYTICS_TITLE} line={SPACE_ANALYTICS_LINE}
      actions={<><RangeMenu days={days} onDays={setDays} /><TextButton label="Refresh" icon="loop" onPress={() => setAgain((n) => n + 1)} testID="analytics-refresh" /></>}>
      <Status state={state} />
      {empty ? <Empty testID="analytics-empty" title={`No runs in the last ${days} days`} next={EMPTY_COMPLETED_NEXT} {...(days < 90 ? { action: "Look at 90 days", onAction: () => setDays(90) } : {})} /> : null}
      {state.phase === "ready" && !empty ? (
        <AnalyticsReport report={state.value} scope="space" onOpen={data.nav.openAutomation} onFailed={data.nav.openFailedRuns} onAsk={(id, message) => data.nav.ask(id, { resource: id, message })} />
      ) : null}
    </Frame>
  );
}

/** The Analytics tab on one automation. */
export function AnalyticsPanel({ automationId }: { automationId: string }): ReactElement {
  const data = useAutomationsData();
  const [days, setDays] = useState(30);
  const [again, setAgain] = useState(0);
  const state = useReport(automationId, days, again);
  const empty = state.phase === "ready" && state.value.totals.runs === 0;
  return (
    <Frame testID="analytics" title="Analytics" line={ANALYTICS_LINE}
      actions={<><RangeMenu days={days} onDays={setDays} /><TextButton label="Refresh" icon="loop" onPress={() => setAgain((n) => n + 1)} testID="analytics-refresh" /></>}>
      <Status state={state} />
      {empty ? <Empty testID="analytics-empty" title={`No runs of this automation in the last ${days} days`} next={EMPTY_COMPLETED_NEXT} {...(days < 90 ? { action: "Look at 90 days", onAction: () => setDays(90) } : {})} /> : null}
      {state.phase === "ready" && !empty ? (
        <AnalyticsReport report={state.value} scope="automation" onOpen={data.nav.openAutomation} onFailed={data.nav.openFailedRuns} onAsk={(id, message) => data.nav.ask(id, { resource: id, message })} />
      ) : null}
    </Frame>
  );
}
