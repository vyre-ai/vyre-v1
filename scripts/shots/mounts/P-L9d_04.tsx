// Mount for P-L9d_04: a record page over the Northwind sample Space (or Harbor Studio with ?space=harbor). Elena Rivera (cl_0) opens by default.
// ?type=clients|projects  ?id=cl_0  ?map=1 (the relationship map)  ?tab=activity|comments|chat|files|memory|history (the right pane's tab)  ?pane=0 shuts the pane  ?all=1 shows empty fields
// ?probe=navigate opens the page seven times in the browser and draws the median (ruling 43).  ?edit=phone starts that field open with ?text=...  The page reads its query after it is live (the static export keeps the markup it was rendered with).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { RecordPage, RecordPageDataProvider } from "../../../apps/app/src/places/records/recordpage/index.ts";
import type { PaneKey, RecordPageStart } from "../../../apps/app/src/places/records/recordpage/index.ts";
import { createSamplePage, harbor, northwind } from "../../../apps/app/src/places/records/recordpage/sample.ts";

export const title = "Records: the record page";

const BUDGET_MS = 50;

/**
 * The navigate probe (ruling 43), in the browser: the record page is opened seven times, each time a fresh mount of the page from the moment it is asked for to the frame after it is on screen
 * (two animation frames). The first is thrown away as the warm-up; the median of the other five is the number against the 50 ms budget, and the worst is printed. The result is drawn on the
 * page, so the screenshot carries it, and written to the console as a METRIC line.
 */
function Navigate({ type, id }: { type: string; id: string }): ReactNode {
  const [run, setRun] = useState(0);
  const [times, setTimes] = useState<number[]>([]);
  const t0 = useMemo(() => ({ at: 0 }), []);
  useMemo(() => { t0.at = performance.now(); }, [run, t0]);
  useEffect(() => {
    let a = 0, b = 0;
    a = requestAnimationFrame(() => { b = requestAnimationFrame(() => {
      const ms = performance.now() - t0.at;
      setTimes((cur) => [...cur, ms]);
      if (run < 6) setRun((n) => n + 1);
    }); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, [run, t0]);
  const sample = useMemo(() => createSamplePage(northwind), []);
  const done = times.length >= 7;
  const rest = times.slice(1).sort((x, y) => x - y);
  const median = rest[Math.floor(rest.length / 2)] ?? 0;
  const worst = rest[rest.length - 1] ?? 0;
  useEffect(() => {
    if (done) console.log(`METRIC ${JSON.stringify({ name: "navigate", screen: "records.page", where: "browser", warmup_ms: +times[0]!.toFixed(1), median_ms: +median.toFixed(1), worst_ms: +worst.toFixed(1), budget_ms: BUDGET_MS, ok: median < BUDGET_MS })}`);
  }, [done, median, worst, times]);
  return (
    <RecordPageDataProvider value={sample.data}>
      <View style={{ flex: 1, minHeight: 0 }}>
        <RecordPage key={run} type={type} recordId={id} />
        {done ? (
          <View testID="navigate-probe" style={{ position: "absolute", left: 12, bottom: 12, padding: 8, backgroundColor: "rgba(255,255,255,0.94)" as string, zIndex: 99999 }}>
            <Text style={{ fontSize: 12, color: "#000" }}>{`navigate: median ${median.toFixed(1)} ms of 5 (warm-up ${times[0]!.toFixed(1)} ms discarded), worst ${worst.toFixed(1)} ms, budget ${BUDGET_MS} ms, ${median < BUDGET_MS ? "inside" : "OVER"}`}</Text>
          </View>
        ) : null}
      </View>
    </RecordPageDataProvider>
  );
}

function Page({ q }: { q: URLSearchParams }): ReactNode {
  const space = q.get("space") === "harbor" ? harbor : northwind;
  const sample = useMemo(() => createSamplePage(space), [space]);
  const start = useMemo<RecordPageStart>(() => ({
    ...(q.get("map") === "1" ? { map: true } : {}), ...(q.get("pane") === "0" ? { pane: false } : q.get("pane") === "1" ? { pane: true } : {}), ...(q.get("tab") ? { tab: q.get("tab") as PaneKey } : {}),
    ...(q.get("all") === "1" ? { all: true } : {}), ...(q.get("edit") ? { edit: { key: q.get("edit") as string, text: q.get("text") ?? "" } } : {}),
  }), [q]);
  if (q.get("probe") === "navigate") return <Navigate type={q.get("type") ?? "clients"} id={q.get("id") ?? "cl_0"} />;
  return (
    <RecordPageDataProvider value={sample.data}>
      <View style={{ flex: 1, minHeight: 0 }}><RecordPage type={q.get("type") ?? "clients"} recordId={q.get("id") ?? "cl_0"} start={start} /></View>
    </RecordPageDataProvider>
  );
}

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page q={q} /> : null;
}
