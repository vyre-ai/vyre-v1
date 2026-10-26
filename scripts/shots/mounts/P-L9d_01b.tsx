// Mount for P-L9d_01b: the Records table with the view-kind switch in its header, over the Northwind sample Space (or Harbor Studio with ?space=harbor).
// ?type=projects|clients  ?kind=table|board|gallery|list  ?rows=100000 (the long table the scroll and layout shift probes run over)  ?menu=kind opens the kind menu on load
// ?ls=1 draws the layout shifts the page has had (when, how much, which element, from where to where) over the corner, so the cause of a shift can be read from a screenshot.
// The page reads its query after it is live (the static export keeps the markup it was rendered with).
import { createElement, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { RecordsDataProvider, RecordsSidebar, RecordsStateProvider } from "../../../apps/app/src/places/records/sidebar/index.ts";
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

// Control for the scroll probe (ruling 81): the same fling over 100,000 plain one-line rows, drawn the way the table draws its rows (a window of absolutely placed rows that follows the scroll in blocks of 8).
// If this scrolls no faster than the table, the runner's own painting is the floor.
function PlainList(): ReactNode {
  const [top, setTop] = useState(0);
  const ROW = 34, N = 100_000, BLOCK = 8;
  const first = Math.max(0, Math.floor(top / ROW) - 12), last = Math.min(N, Math.ceil((top + 700) / ROW) + 12);
  const rows = [];
  for (let i = first; i < last; i++) rows.push(createElement("div", { key: i, style: { position: "absolute", top: i * ROW, left: 0, right: 0, height: ROW, boxSizing: "border-box", padding: "0 10px", display: "flex", alignItems: "center", borderBottom: "1px solid var(--line)", fontSize: 13, color: "var(--ink)" } }, `Row number ${i + 1}`));
  return createElement("div", { "data-testid": "plain-scroll", style: { flex: 1, overflow: "auto", position: "relative" }, onScroll: (e: { currentTarget: { scrollTop: number } }) => { const t = Math.floor(e.currentTarget.scrollTop / (ROW * BLOCK)) * ROW * BLOCK; setTop((c) => (c === t ? c : t)); } },
    createElement("div", { style: { height: N * ROW, position: "relative" } }, ...rows));
}

function Page({ q }: { q: URLSearchParams }): ReactNode {
  const bulk = Math.min(200_000, Number(q.get("rows") ?? 0) || 0);
  const space = q.get("space") === "harbor" ? harbor : northwind;
  // ?only=name hides every field but the title (the control that draws one column)
  const only = q.get("only") === "name" ? { hidden: (space.types.find((t) => t.key === (q.get("type") ?? "clients"))?.fields ?? []).map((f) => f.key) } : null;
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
  return (
    <RecordsDataProvider value={sample.data}>
      <RecordsStateProvider initial={initial}>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          {phone ? null : <View style={{ width: 240 }}><RecordsSidebar /></View>}
          {q.get("plain") === "1" ? <PlainList /> : <RecordViews kind={q.get("kind") ?? "table"} {...(only ? { view: only } : {})} />}
        </View>
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
