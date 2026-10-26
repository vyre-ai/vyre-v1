// Navigate diagnosis (P-L9d_04): with VYRE_TRACE_MOUNT=1 the browser probe traces each fresh mount and prints where the main thread spent the time between the mount's nav-start and
// nav-end marks (the window the navigate budget judges): by trace phase and by function (V8 sampling self time). Off by default; the measured number is the untraced-equivalent run of the same page.
const CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8.execute", "blink.user_timing", "disabled-by-default-v8.cpu_profiler"];
const PHASES = ["RunTask", "FireAnimationFrame", "FunctionCall", "EvaluateScript", "RunMicrotasks", "UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize", "Commit", "MinorGC", "MajorGC"];

export const traceEnabled = () => process.env.VYRE_TRACE_MOUNT === "1";
export const startMountTrace = (browser, page) => browser.startTracing(page, { categories: CATEGORIES });

/** Phases (ms) and top functions (self ms) inside [nav-start, nav-end] of a parsed trace. */
export function summarizeWindow(events) {
  const mark = (n) => events.find((e) => e.name === n && (e.ph === "R" || e.ph === "I" || e.ph === "i" || e.ph === "b"));
  const a = mark("nav-start"), b = mark("nav-end");
  if (!a || !b) return { window_ms: null, phases: [], functions: [] };
  const mains = new Set(events.filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`));
  const phases = new Map();
  for (const e of events) {
    if (e.ph !== "X" || !mains.has(`${e.pid}:${e.tid}`) || !PHASES.includes(e.name) || e.ts < a.ts || e.ts > b.ts) continue;
    const p = phases.get(e.name) || { ms: 0, n: 0 };
    p.ms += (e.dur || 0) / 1000; p.n++; phases.set(e.name, p);
  }
  const starts = new Map(), clock = new Map(), nodes = new Map(), self = new Map();
  for (const e of events) if (e.name === "Profile") starts.set(e.id, e.args?.data?.startTime ?? e.ts);
  for (const e of events) {
    if (e.name !== "ProfileChunk") continue;
    const prof = e.args?.data?.cpuProfile;
    if (!prof) continue;
    for (const n of prof.nodes || []) nodes.set(`${e.id}:${n.id}`, n.callFrame);
    let t = clock.get(e.id) ?? starts.get(e.id) ?? e.ts;
    const deltas = e.args.data.timeDeltas || [];
    (prof.samples || []).forEach((id, i) => {
      t += deltas[i] || 0;
      if (t >= a.ts && t <= b.ts) self.set(`${e.id}:${id}`, (self.get(`${e.id}:${id}`) || 0) + (deltas[i] || 0));
    });
    clock.set(e.id, t);
  }
  const byFn = new Map();
  for (const [k, us] of self) {
    const f = nodes.get(k);
    if (!f) continue;
    const name = `${f.functionName || "(anonymous)"} ${String(f.url || "").split("/").pop()}:${f.lineNumber}`;
    byFn.set(name, (byFn.get(name) || 0) + us / 1000);
  }
  return {
    window_ms: +((b.ts - a.ts) / 1000).toFixed(1),
    phases: [...phases].map(([name, v]) => ({ name, ms: +v.ms.toFixed(1), n: v.n })).sort((x, y) => y.ms - x.ms),
    functions: [...byFn].map(([name, ms]) => ({ name, ms: +ms.toFixed(1) })).sort((x, y) => y.ms - x.ms).slice(0, 25),
  };
}

export async function finishMountTrace(browser, url) {
  const buf = await browser.stopTracing();
  const s = summarizeWindow(JSON.parse(buf.toString("utf8")).traceEvents || []);
  console.log(`NAVTRACE ${JSON.stringify({ url, window_ms: s.window_ms, phases: s.phases })}`);
  for (const f of s.functions) console.log(`NAVTRACE-FN ${f.ms.toFixed(1)} ms ${f.name}`);
}
