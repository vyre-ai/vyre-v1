// Mount for P-L9d_01b: the Records table with the view-kind switch in its header, over the Northwind sample Space (or Harbor Studio with ?space=harbor).
// ?type=projects|clients  ?kind=table|board|gallery|list  ?rows=100000 (the long table the scroll and layout shift probes run over)  ?menu=kind opens the kind menu on load
// ?hide=owner,status hides those columns of the table (to find which cells cost frames in the scroll probe).
// ?ls=1 draws the layout shifts the page has had (when, how much, which element, from where to where) over the corner, so the cause of a shift can be read from a screenshot.
// The page reads its query after it is live (the static export keeps the markup it was rendered with).
import { Profiler, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { RecordsDataProvider, RecordsSidebar, RecordsStateProvider } from "../../../apps/app/src/places/records/sidebar/index.ts";
import { TableView } from "../../../apps/app/src/places/records/table/index.ts";
import { RecordViews } from "../../../apps/app/src/places/records/views-a/index.ts";
import { createViewsSample, harbor, northwind } from "../../../apps/app/src/places/records/views-a/sample.ts";

export const title = "Records: the table with the kind switch";

// layout shifts from the first moment the module runs, so the ones before the table is drawn are in the list too
const shifts: string[] = [];
interface ShiftEntry { startTime: number; value: number; hadRecentInput?: boolean; sources?: { node?: { getAttribute?(n: string): string | null; nodeName?: string }; previousRect: { y: number; height: number }; currentRect: { y: number; height: number } }[] }
const g = globalThis as { PerformanceObserver?: new (cb: (l: { getEntries(): unknown[] }) => void) => { observe(o: object): void } };
if (typeof g.PerformanceObserver === "function") {
  try {
    new g.PerformanceObserver((list) => {
      for (const raw of list.getEntries()) {
        const e = raw as ShiftEntry;
        const who = (e.sources ?? []).slice(0, 3).map((s) => `${s.node?.getAttribute?.("data-testid") ?? s.node?.nodeName ?? "?"} y ${Math.round(s.previousRect.y)}>${Math.round(s.currentRect.y)} h ${Math.round(s.previousRect.height)}>${Math.round(s.currentRect.height)}`).join(" | ");
        shifts.push(`${Math.round(e.startTime)}ms ${e.value.toFixed(3)} ${who}`);
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch { /* not supported */ }
}

function Shifts(): ReactNode {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 300); return () => clearInterval(t); }, []);
  const total = shifts.reduce((n, l) => n + Number(l.split(" ")[1] ?? 0), 0);
  return (
    <View style={{ position: "absolute", left: 8, bottom: 8, right: 8, padding: 6, backgroundColor: "rgba(255,255,255,0.92)" as string, zIndex: 99999 }} pointerEvents="none">
      <Text style={{ fontSize: 10, color: "#000" }}>{`layout shift total ${total.toFixed(3)} in ${shifts.length} shifts`}</Text>
      {shifts.slice(0, 9).map((l, i) => <Text key={i} style={{ fontSize: 10, color: "#000" }}>{l}</Text>)}
    </View>
  );
}

// ?prof=1 scrolls the table itself for 300 frames and writes where the time went in the corner: React commit times (JS), and the long animation frames the browser reports (script, style and
// layout, render). The result is in the screenshot, because a console line does not reach the job log.
function Prof({ children }: { children: ReactNode }): ReactNode {
  const commits = useRef<number[]>([]);
  const [text, setText] = useState<string[] | null>(null);
  useEffect(() => {
    const d = globalThis as unknown as { document: { querySelector(s: string): { scrollTop: number; scrollHeight: number; clientHeight: number } | null }; requestAnimationFrame(cb: (t: number) => void): void; performance: { now(): number }; PerformanceObserver?: new (cb: (l: { getEntries(): unknown[] }) => void) => { observe(o: object): void; disconnect(): void } };
    const loaf: { d: number; s: number; r: number; l: number }[] = [];
    let po: { disconnect(): void } | null = null;
    try { const o = new (d.PerformanceObserver as NonNullable<typeof d.PerformanceObserver>)((l) => { for (const e of l.getEntries() as { duration: number; renderStart: number; styleAndLayoutStart: number; startTime: number; scripts: { duration: number }[] }[]) loaf.push({ d: e.duration, s: e.scripts.reduce((n, x) => n + x.duration, 0), r: e.styleAndLayoutStart > 0 ? e.startTime + e.duration - e.styleAndLayoutStart : 0, l: e.renderStart > 0 ? e.styleAndLayoutStart - e.renderStart : 0 }); }); o.observe({ type: "long-animation-frame", buffered: false }); po = o; } catch { /* not supported */ }
    const t = setTimeout(() => {
      const el = d.document.querySelector('[data-testid="records-scroll"]');
      if (!el) return;
      commits.current = [];
      const gaps: number[] = [];
      let n = 0, last = d.performance.now();
      const tick = (now: number): void => {
        gaps.push(now - last); last = now;
        el.scrollTop += 120;
        if (++n < 300) d.requestAnimationFrame(tick);
        else setTimeout(() => {
          po?.disconnect();
          const med = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
          const p95 = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.95))] ?? 0;
          const c = commits.current;
          setText([
            `frames ${gaps.length - 1}: median ${med(gaps.slice(1)).toFixed(1)} ms, p95 ${p95(gaps.slice(1)).toFixed(1)} ms, max ${Math.max(...gaps.slice(1)).toFixed(1)} ms`,
            `react commits ${c.length}: median ${med(c).toFixed(2)} ms, p95 ${p95(c).toFixed(2)} ms, total ${c.reduce((a, b) => a + b, 0).toFixed(0)} ms`,
            `long frames ${loaf.length}: duration ${loaf.reduce((a, b) => a + b.d, 0).toFixed(0)} ms, script ${loaf.reduce((a, b) => a + b.s, 0).toFixed(0)} ms, style+layout ${loaf.reduce((a, b) => a + b.l, 0).toFixed(0)} ms, after-layout (paint) ${loaf.reduce((a, b) => a + b.r, 0).toFixed(0)} ms`,
          ]);
        }, 300);
      };
      d.requestAnimationFrame(tick);
    }, 2500);
    return () => { clearTimeout(t); po?.disconnect(); };
  }, []);
  return (
    <>
      <Profiler id="table" onRender={(_id, _phase, actual) => { commits.current.push(actual); }}>{children}</Profiler>
      {text ? <View testID="prof-done" style={{ position: "absolute", left: 8, bottom: 8, right: 8, padding: 6, backgroundColor: "rgba(255,255,255,0.95)" as string, zIndex: 99999 }} pointerEvents="none">{text.map((l, i) => <Text key={i} style={{ fontSize: 11, color: "#000" }}>{l}</Text>)}</View> : null}
    </>
  );
}

function Page({ q }: { q: URLSearchParams }): ReactNode {
  const bulk = Math.min(200_000, Number(q.get("rows") ?? 0) || 0);
  const space = q.get("space") === "harbor" ? harbor : northwind;
  const sample = useMemo(() => createViewsSample(space, { bulk }), [space, bulk]);
  const initial = useMemo(() => ({ type: q.get("type") ?? "clients" }), [q]);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720; // 0 is "not measured yet" (the static page)
  useEffect(() => {
    const menu = q.get("menu");
    if (!menu) return;
    const d = globalThis as { document?: { querySelector(s: string): { click?: () => void } | null } };
    const t = setTimeout(() => d.document?.querySelector(`[data-testid="records-${menu}"]`)?.click?.(), 500);
    return () => clearTimeout(t);
  }, [q]);
  const Wrap = q.get("prof") === "1" ? Prof : ({ children }: { children: ReactNode }): ReactNode => <>{children}</>;
  return (
    <RecordsDataProvider value={sample.data}>
      <RecordsStateProvider initial={initial}>
        <Wrap>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          {phone ? null : <View style={{ width: 240 }}><RecordsSidebar /></View>}
          {q.get("hide") !== null ? <TableView view={{ hidden: (q.get("hide") as string).split(",").filter(Boolean) }} /> : <RecordViews kind={q.get("kind") ?? "table"} />}
        </View>
        </Wrap>
        {q.get("ls") === "1" ? <Shifts /> : null}
      </RecordsStateProvider>
    </RecordsDataProvider>
  );
}

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page q={q} /> : null;
}
