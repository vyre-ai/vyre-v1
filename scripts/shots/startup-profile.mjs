// One cold phone load (4x CPU) under the V8 sampling profiler: where the main thread spends the time before app.usable, by script and by function.
// Printed in the perf job log so a startup cut aims at what costs, not at what is big.
export async function coldProfile(browser, origin, route, { cpu = 4, top = 18 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
  await cdp.send("Profiler.start");
  await page.goto(origin + route, { waitUntil: "load" });
  await page.waitForFunction(() => performance.getEntriesByName("app.usable").length > 0, null, { timeout: 30000 }).catch(() => {});
  const { profile } = await cdp.send("Profiler.stop");
  const timing = await page.evaluate(() => {
    const m = Object.fromEntries(performance.getEntriesByType("mark").map((e) => [e.name, e.startTime]));
    const nav = performance.getEntriesByType("navigation")[0];
    const res = performance.getEntriesByType("resource").filter((r) => /\.js/.test(r.name)).map((r) => ({ f: r.name.split("/").pop().slice(0, 40), start: Math.round(r.startTime), end: Math.round(r.responseEnd) }));
    return { marks: m, dcl: nav && Math.round(nav.domContentLoadedEventEnd), load: nav && Math.round(nav.loadEventEnd), res };
  });
  await ctx.close();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) || 0) + (profile.timeDeltas[i] || 0)));
  const byUrl = new Map(), byFn = new Map();
  let total = 0;
  for (const [id, us] of self) {
    const cf = byId.get(id).callFrame;
    const url = (cf.url || "(native)").split("/").pop().slice(0, 48) || "(page)";
    byUrl.set(url, (byUrl.get(url) || 0) + us);
    const fn = `${cf.functionName || "(anon)"} ${url}:${cf.lineNumber}`;
    byFn.set(fn, (byFn.get(fn) || 0) + us);
    total += us;
  }
  const rows = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, us]) => `| ${k} | ${(us / 1000).toFixed(0)} |`).join("\n");
  console.log(`\nCold phone profile (4x CPU, sampled self time, ${(total / 1000).toFixed(0)} ms total, marks ${JSON.stringify(timing.marks)}, domContentLoaded ${timing.dcl}, load ${timing.load})`);
  console.log("| script | self ms |\n|---|---:|\n" + rows(byUrl));
  console.log("\n| function | self ms |\n|---|---:|\n" + rows(byFn));
  // inclusive time: a node's own samples plus its children's; the heaviest path from the root and the heaviest functions (a function counts once per call stack, so recursion is not added twice)
  const tot = new Map();
  const sumOf = (id) => { if (tot.has(id)) return tot.get(id); const n = byId.get(id); let t = self.get(id) || 0; for (const c of n.children || []) t += sumOf(c); tot.set(id, t); return t; };
  const root = profile.nodes[0];
  sumOf(root.id);
  const label = (n) => { const cf = n.callFrame; return `${cf.functionName || "(anon)"} ${(cf.url || "").split("/").pop().slice(0, 40)}:${cf.lineNumber + 1}`; };
  const path = [];
  for (let n = root, d = 0; n && d < 45; d++) {
    path.push(`${"  ".repeat(Math.min(d, 12))}${label(n)}  total ${(tot.get(n.id) / 1000).toFixed(0)} ms, self ${((self.get(n.id) || 0) / 1000).toFixed(0)} ms`);
    n = (n.children || []).map((c) => byId.get(c)).sort((a, b) => tot.get(b.id) - tot.get(a.id))[0];
  }
  console.log("\nHeaviest call path:\n" + path.join("\n"));
  const incl = new Map();
  const walk = (id, seen) => { const n = byId.get(id), k = label(n); const fresh = !seen.has(k); if (fresh) incl.set(k, (incl.get(k) || 0) + tot.get(id)); const next = fresh ? new Set(seen).add(k) : seen; for (const c of n.children || []) walk(c, next); };
  walk(root.id, new Set());
  console.log("\n| function (inclusive) | ms |\n|---|---:|\n" + [...incl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 45).map(([k, us]) => `| ${k} | ${(us / 1000).toFixed(0)} |`).join("\n"));
  console.log("\nscript fetch (start-end ms): " + timing.res.map((r) => `${r.f} ${r.start}-${r.end}`).join("; "));
}
