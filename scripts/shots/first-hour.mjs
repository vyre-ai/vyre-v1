// The first-hour walk (lead, 4 Nov): what a person does in their first hour, driven through the real shell of a real booted install, one paper shot per step, with every refused /v1 call and every console
// error collected and charged to the step that caused it. The daemon, the engine and the model driver are real; only the model vendor is a local stand-in (fixtures/model-vendor.ts).
// A failing step is recorded with its owner lane and the walk goes on, so one run reports every failure; the exit code is non-zero when any step failed.
//   node scripts/shots/first-hour.mjs <out-dir> [--skip-export] [--only=personal|team] [--dist=apps/app/dist]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const REPO = process.cwd();
const args = process.argv.slice(2);
const out = path.resolve(args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-l-backup/first-hour");
const only = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7);
const dist = path.resolve(REPO, (args.find((a) => a.startsWith("--dist=")) ?? "").slice(7) || "apps/app/dist");
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
if (!args.includes("--skip-export")) {
  fs.rmSync(dist, { recursive: true, force: true });
  execSync((await import(path.join(process.cwd(), "scripts/shots/expo-cmd.mjs"))).exportCmd(process.cwd()), { cwd: path.join(REPO, "apps/app"), stdio: "inherit", env: exportEnv() });
  execSync(`node scripts/shots/registry-hash-in-bundle.mjs ${dist}`, { cwd: REPO, stdio: "inherit" });
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
// the model vendor stand-in must be in the daemon's environment before it is spawned
const { vendor } = await import(path.join(REPO, "fixtures/model-vendor.ts"));
const PRELOAD = path.join(REPO, "fixtures/model-vendor-preload.mjs");
const { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } = await import(path.join(REPO, "apps/app/tests/real-app-harness.test.ts"));
const { makeBundle } = await import(path.join(REPO, "client/src/crypto/keys.ts"));
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");

export const PW = "first hour password 9";
const results = [];

/** One Space's walk: boots a fresh install, claims it in a browser, and runs steps against it. */
async function walk(kind, steps, provision = null) {
  const v = await vendor();
  const prior = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = `${prior ?? ""} --import ${PRELOAD}`.trim();
  process.env.VYRE_TEST_VENDOR = v.base;
  // a provisioner boots its own daemon (the scripted walk: a daemon in this process whose model calls tools) and answers { space, session? }; the default is a spawned daemon claimed in the browser
  const given = provision ? await provision(dist) : null;
  const space = given ? given.space : await bootFreshSpace(kind === "personal" ? "personal" : undefined, true);
  if (prior === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = prior;
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce" });
  if (given?.session) await context.addInitScript((s) => { try { localStorage.setItem("vyre.session.v1", JSON.stringify({ sessions: { [s.baseUrl]: s } })); } catch { /* blocked */ } }, { ...given.session, baseUrl: web.origin, def: { ...given.session.def, address: web.origin } });
  const page = await context.newPage();
  const noise = [];   // refused calls and console errors, in order, each stamped with the step that was running
  let current = "setup";
  page.on("pageerror", (e) => noise.push({ step: current, what: `page error: ${String(e).slice(0, 300)}` }));
  page.on("console", (m) => { if (m.type() === "error") noise.push({ step: current, what: `console: ${m.text().slice(0, 300)}` }); });
  page.on("response", async (r) => { const u = new URL(r.url()); if (r.status() >= 400 && (u.pathname.startsWith("/v1/") || u.pathname.startsWith("/sync/"))) noise.push({ step: current, what: `HTTP ${r.status()} ${u.pathname} ${(await r.text().catch(() => "")).slice(0, 420)} req=${(r.request().postData() ?? "").slice(0, 240)}`, refused: true }); });
  const S = { kind, space, web, page, context, vendor: v, out, PW, state: { ...(given?.state ?? {}) }, makeBundle, claimOnEdge, dismissOnboarding, daemon: given?.daemon, token0: given?.session?.token };
  let n = 0;
  S.token = () => S.token0 ? Promise.resolve(S.token0) : page.evaluate(() => { const s = JSON.parse(localStorage.getItem("vyre.session.v1")); return s.sessions[location.origin].token; });
  S.api = async (cap, data = {}, token) => {
    const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token ?? await S.token()}` }, data: { idempotencyKey: `fh-${++n}`, ...data } });
    const b = await r.json().catch(() => ({}));
    if (r.status() !== 200) throw new Error(`${cap}: ${r.status()} ${JSON.stringify(b).slice(0, 240)}`);
    return b.data ?? b;
  };
  S.shot = (name) => page.screenshot({ path: path.join(out, `${kind}-${name}.png`) });
  try {
    const pick = (process.env.FH_STEPS ?? "").split(",").filter(Boolean);
    for (const st of steps) {
      if (pick.length && !st.critical && !pick.includes(st.id)) continue;
      current = `${kind}/${st.id}`;
      const before = noise.length;
      let failure = null;
      try { await st.run(S); } catch (e) { const lines = String(e instanceof Error ? e.message : e).split("\n"); failure = [lines[0], lines.find((l) => /waiting for/.test(l))?.trim()].filter(Boolean).join(" ").slice(0, 1200); }
      await page.waitForTimeout(400);
      await S.shot(`${String(results.filter((r) => r.kind === kind).length + 1).padStart(2, "0")}-${st.id}`).catch(() => {});
      const mine = noise.slice(before);
      const refused = mine.filter((x) => x.refused).map((x) => x.what);
      const errs = mine.filter((x) => !x.refused).map((x) => x.what);
      results.push({ kind, id: st.id, owner: st.owner, failure, refused, errs });
      console.log(`${failure || refused.length || errs.length ? "FAIL" : "ok  "} ${current}${failure ? `: ${failure}` : ""}${refused.length ? ` | refused: ${[...new Set(refused)].join(" ; ")}` : ""}${errs.length ? ` | errors: ${[...new Set(errs)].join(" ; ")}` : ""}`);
      if (failure && st.critical) break;
    }
  } finally {
    await browser.close(); web.close(); await space.stop(); v.close();
    fs.rmSync(space.dir, { recursive: true, force: true });
  }
}

const { personalSteps } = await import(path.join(REPO, "scripts/shots/first-hour-steps.mjs"));
const { teamSteps } = await import(path.join(REPO, "scripts/shots/first-hour-team.mjs"));
if (only === "" || only === "personal") await walk("personal", personalSteps);
if (only === "" || only === "team") await walk("team", teamSteps);
if (only === "" || only === "scripted") {
  const { scriptedSteps, provisionScripted } = await import(path.join(REPO, "scripts/shots/first-hour-scripted.mjs"));
  await walk("scripted", scriptedSteps, provisionScripted);
}
const bad = results.filter((r) => r.failure || r.refused.length || r.errs.length);
const md = `# First-hour walk\n\n${results.length} steps, ${bad.length} with failures.\n\n| step | owner | result |\n|---|---|---|\n${results.map((r) => `| ${r.kind}/${r.id} | ${r.owner} | ${r.failure || r.refused.length || r.errs.length ? `FAIL ${[r.failure, ...r.refused.map((x) => `refused ${x}`), ...r.errs].filter(Boolean).join(" ; ").replace(/\|/g, "/")}` : "ok"} |`).join("\n")}\n`;
fs.writeFileSync(path.join(out, "report.md"), md);
console.log(`\n${results.length} steps, ${bad.length} failed. Report: ${path.join(out, "report.md")}`);
process.exit(bad.length ? 1 : 0);
