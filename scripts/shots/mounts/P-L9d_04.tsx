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
 * The navigate probe (ruling 43), in-app navigation and not page load: the page is mounted and settled with a list showing, then performance.mark("nav-start") is put when a row is opened, the
 * record page is rendered, and performance.mark("nav-end") when its content has first painted (two animation frames after the commit). The measure between them is window.__probes.navigate,
 * which scripts/shots/probes/browser.mjs reads on the v1-perf runner for each fresh mount (the first is the warm-up). It is drawn in the corner too, so a screenshot carries it.
 */
function Navigate({ type, id }: { type: string; id: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const [ms, setMs] = useState<number | null>(null);
  const sample = useMemo(() => createSamplePage(northwind), []);
  useEffect(() => {
    // settle first: the shell is up and idle, as it is when a person clicks a row
    let a = 0, b = 0, c = 0;
    a = requestAnimationFrame(() => { b = requestAnimationFrame(() => { c = window.setTimeout(() => { performance.mark("nav-start"); setOpen(true); }, 400); }); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); clearTimeout(c); };
  }, []);
  useEffect(() => {
    if (!open) return;
    let a = 0, b = 0;
    a = requestAnimationFrame(() => { b = requestAnimationFrame(() => {
      performance.mark("nav-end");
      const m = performance.measure("navigate", "nav-start", "nav-end");
      const v = Math.round(m.duration * 10) / 10;
      (globalThis as { __probes?: Record<string, unknown> }).__probes = { navigate: v, ready: true };
      console.log(`METRIC ${JSON.stringify({ name: "navigate", screen: "records.page", where: "in-app", ms: v, budget_ms: BUDGET_MS, ok: v < BUDGET_MS })}`);
      setMs(v);
    }); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, [open]);
  return (
    <RecordPageDataProvider value={sample.data}>
      <View style={{ flex: 1, minHeight: 0 }}>
        {open ? <RecordPage type={type} recordId={id} /> : <View testID="navigate-list" style={{ padding: 24 }}><Text style={{ fontSize: 14, color: "#555" }}>Clients</Text></View>}
        {ms !== null ? (
          <View testID="navigate-probe" style={{ position: "absolute", left: 12, bottom: 12, padding: 8, backgroundColor: "rgba(255,255,255,0.94)" as string, zIndex: 99999 }}>
            <Text style={{ fontSize: 12, color: "#000" }}>{`navigate (in-app): ${ms.toFixed(1)} ms, budget ${BUDGET_MS} ms, ${ms < BUDGET_MS ? "inside" : "OVER"}`}</Text>
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
    ...(q.get("map") === "1" ? { map: true } : {}), ...(q.get("pane") === "0" ? { pane: false } : q.get("pane") === "1" ? { pane: true } : {}), tab: (q.get("tab") ?? "activity") as PaneKey,
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
