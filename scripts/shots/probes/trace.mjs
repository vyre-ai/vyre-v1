// Scroll diagnosis (P-L9d_01b): re-runs the scroll on a fresh page under a Chrome trace with the V8 sampling profiler on, then prints where the main thread's time went:
// by trace event (script, style, layout, paint, GC) and by function (self time). The measured pass stays untraced; this pass only explains it. The raw trace is kept for the CI artifact.
import fs from "node:fs";
import path from "node:path";
import { measureScroll } from "./scroll.mjs";

const CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8.execute", "blink.user_timing", "disabled-by-default-v8.cpu_profiler", "cc", "gpu"];
const PHASES = ["RunTask", "FireAnimationFrame", "FunctionCall", "EvaluateScript", "RunMicrotasks", "UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize", "Commit", "UpdateLayerTree", "HitTest", "MinorGC", "MajorGC", "ParseHTML"];

/** Total and count of each phase on the renderer main thread, and the sampled self time per function, from a parsed trace. */
export function summarizeTrace(events) {
  const mains = new Set(events.filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`));
  const phases = new Map();
  for (const e of events) {
    if (e.ph !== "X" || !mains.has(`${e.pid}:${e.tid}`) || !PHASES.includes(e.name)) continue;
    const p = phases.get(e.name) || { ms: 0, n: 0 };
    p.ms += (e.dur || 0) / 1000; p.n++;
    phases.set(e.name, p);
  }
  const nodes = new Map(), self = new Map();
  for (const e of events) {
    if (e.name !== "ProfileChunk") continue;
    const prof = e.args?.data?.cpuProfile;
    if (!prof) continue;
    for (const n of prof.nodes || []) nodes.set(`${e.id}:${n.id}`, n.callFrame);
    const deltas = e.args.data.timeDeltas || [];
    (prof.samples || []).forEach((id, i) => { self.set(`${e.id}:${id}`, (self.get(`${e.id}:${id}`) || 0) + (deltas[i] || 0)); });
  }
  const byFn = new Map();
  for (const [k, us] of self) {
    const f = nodes.get(k);
    if (!f) continue;
    const name = `${f.functionName || "(anonymous)"} ${String(f.url || "").split("/").pop()}:${f.lineNumber}`;
    byFn.set(name, (byFn.get(name) || 0) + us / 1000);
  }
  return { phases: [...phases].map(([name, v]) => ({ name, ms: +v.ms.toFixed(1), n: v.n })).sort((a, b) => b.ms - a.ms), functions: [...byFn].map(([name, ms]) => ({ name, ms: +ms.toFixed(1) })).sort((a, b) => b.ms - a.ms).slice(0, 30) };
}

/** Scrolls `page` (already on the route) under a trace, prints the breakdown, writes `<outDir>/<id>-scroll-trace.json`. */
export async function traceScroll(browser, page, id, scroll, outDir) {
  await browser.startTracing(page, { categories: CATEGORIES });
  const r = await measureScroll(page, scroll);
  const buf = await browser.stopTracing();
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${id}-scroll-trace.json`), buf);
  const s = summarizeTrace(JSON.parse(buf.toString("utf8")).traceEvents || []);
  console.log(`TRACE ${JSON.stringify({ target: id, frames: r.frames, p95_ms: +r.p95.toFixed(2), max_ms: +r.max.toFixed(2), phases: s.phases })}`);
  for (const f of s.functions) console.log(`TRACE-FN ${f.ms.toFixed(1)} ms ${f.name}`);
}
