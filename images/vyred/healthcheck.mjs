// Container healthcheck for the vyred image. It runs `vyre-server doctor --offline --json` (the same checks the terminal shows) and asks the daemon's /healthz.
// Healthy means: vyred answers, its process is alive, and nothing the container can judge is down. The container cannot judge three things, so they never fail it:
//   host.disk_encrypted  the volume belongs to the host, which the installer checks (ARCH 7.13)
//   host.docker          the image does not carry Docker; sites and agent computers are the host's
//   host.caddy           only counted when VYRE_HEALTH_REQUIRE_CADDY=1 (the server compose unit sets it; the Caddy container shares this network namespace)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "../../host/src/cli/index.ts");

/** The verdict on a doctor report: { ok, why }. Pure, so the smoke test can feed it recorded reports. */
export function verdict(report, env = {}) {
  const blind = new Set(["host.disk_encrypted", "host.docker"]);
  if (env.VYRE_HEALTH_REQUIRE_CADDY !== "1") blind.add("host.caddy");
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const process = findings.find((f) => f.key === "daemon.process");
  if (!process) return { ok: false, why: "the doctor report has no daemon.process finding" };
  if (process.state !== "healthy") return { ok: false, why: process.detail || "vyred is not running" };
  const down = findings.filter((f) => f.state === "down" && !blind.has(f.key));
  if (down.length) return { ok: false, why: down.map((f) => `${f.key}: ${f.detail}`).join("; ") };
  return { ok: true, why: "ok" };
}

/** The role the doctor should check: space when VYRE_ROLE names it (or says nothing), else device. */
export function doctorRole(env) {
  const roles = String(env.VYRE_ROLE ?? "space").split(",").map((s) => s.trim());
  return roles.includes("space") ? "space" : "device";
}

function localUrl(dataDir) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, "vyred.json"), "utf8")).url; } catch { return null; }
}

export async function check(env = process.env) {
  const dataDir = env.VYRE_DATA_DIR || "/data";
  const url = localUrl(dataDir);
  if (!url) return { ok: false, why: `no vyred.json in ${dataDir}: vyred has not started` };
  try {
    const r = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(5000) });
    const body = await r.json();
    if (!r.ok || body?.ok === false) return { ok: false, why: `/healthz answered ${r.status}` };
  } catch (e) { return { ok: false, why: `/healthz did not answer: ${e instanceof Error ? e.message : String(e)}` }; }
  const run = spawnSync(process.execPath, [CLI, "doctor", "--offline", "--json", "--role", doctorRole(env), "--data-dir", dataDir], { encoding: "utf8", env: { ...env, VYRE_PROGRAM: "vyre-server" }, timeout: 8000 });
  let report;
  try { report = JSON.parse(run.stdout); } catch { return { ok: false, why: `the doctor printed no report${run.stderr ? `: ${run.stderr.trim().slice(0, 200)}` : ""}` }; }
  return verdict(report, env);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const r = await check();
  if (!r.ok) process.stderr.write(`unhealthy: ${r.why}\n`);
  process.exitCode = r.ok ? 0 : 1;
}
