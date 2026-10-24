// G0 check (ARCH 12.2 and 12.5): one command that says whether the build window may open.
//   node scripts/g0-check.ts [--root DIR] [--packets-json FILE] [--skip-remote]
// Mechanical checks for F1 to F15 read the repo; the gate conditions read the tracker (prep packets), the contract hash, the last main run
// (green, budget job) and the dry-run record. Exit code 0 only when every line is ok. Waivers are written down, not silent:
// P-PR_47b (real phones, ruling 3) and P-PR_64 (test accounts, owner's to supply) do not gate G0, so F14 reports as waived.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type Line = { id: string; ok: boolean; waived?: boolean; detail: string };
export type Packet = { id: string; lane_id?: string; status: string };
export type Run = { conclusion: string; jobs: { name: string; conclusion: string }[] } | null;
export interface Ports {
  root: string;
  packets: () => Promise<Packet[]> | Packet[];
  mainRun: () => Promise<Run> | Run;
  exec: (cmd: string, args: string[], cwd: string) => { ok: boolean; out: string };
}

export const WAIVED_PACKETS = ["P-PR_47b", "P-PR_64"];
export const SPIKES = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S12"];
export const MODULES = 72;

const has = (root: string, rel: string) => fs.existsSync(path.join(root, rel));
const read = (root: string, rel: string) => (has(root, rel) ? fs.readFileSync(path.join(root, rel), "utf8") : "");
const ls = (root: string, rel: string) => (has(root, rel) ? fs.readdirSync(path.join(root, rel)) : []);
const walk = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);
const need = (root: string, rels: string[]) => rels.filter((r) => !has(root, r));
const res = (id: string, missing: string[], okText: string, extra: string[] = []): Line => {
  const bad = [...missing.map((m) => `missing ${m}`), ...extra];
  return { id, ok: bad.length === 0, detail: bad.length ? bad.join("; ") : okText };
};

export async function runChecks(p: Ports): Promise<Line[]> {
  const { root } = p, out: Line[] = [];
  const mods: { id: string; owner?: string; status?: string }[] = (() => { try { return JSON.parse(read(root, "host/modules.json")).modules ?? []; } catch { return []; } })();
  const gen = has(root, "package.json") ? p.exec("npm", ["run", "gen", "--", "--check"], root) : { ok: false, out: "no package.json" };
  out.push(res("F1", need(root, ["manifest", "generated/hash.txt"]), "manifest package and generated output present", gen.ok ? [] : ["gen --check failed"]));
  const todo = walk(path.join(root, "contracts")).filter((f) => /\.ts$/.test(f) && !/tests?[\\/]/.test(f) && /\bTODO\b/.test(fs.readFileSync(f, "utf8")));
  out.push(res("F2", need(root, ["contracts"]), "contracts present, no TODO", todo.map((f) => `TODO in ${path.relative(root, f)}`)));
  out.push(res("F3", need(root, ["kernel", "contracts/tests"]), "kernel and contract freeze tests present (suites run in the main CI run below)"));
  const bad = mods.filter((m) => !m.owner || m.status !== "stub" && m.status !== "ready");
  const lanes = p.exec("node", ["scripts/lanes-check.ts", "lead", "HEAD"], root);
  out.push(res("F4", need(root, ["host/modules.json", "scripts/lanes-check.ts"]), `${mods.length} modules, all owned`, [
    ...(mods.length === MODULES ? [] : [`${mods.length} modules, expected ${MODULES}`]), ...bad.map((m) => `module ${m.id} has no owner or status`), ...(lanes.ok ? [] : ["lanes-check failed"])]));
  out.push(res("F5", need(root, ["host/src"]), "host sources present (echo test runs in the main CI run)"));
  out.push(res("F6", need(root, ["testkit", "fixtures/seed"]), "testkit and seed recipes present"));
  const rep = read(root, "spikes/REPORT.md");
  out.push(res("F7", need(root, ["spikes/REPORT.md"]), "spike report names S0 to S6 and S12", SPIKES.filter((s) => !new RegExp(`\\b${s}\\b`).test(rep)).map((s) => `report has no ${s}`)));
  out.push(res("F8", need(root, ["sync/src/protocol.ts"]), "sync protocol types present"));
  const props = ls(root, "ui/src").filter((d) => has(root, `ui/src/${d}/props.ts`)).length;
  out.push(res("F9", need(root, ["ui/src"]), `${props} components with frozen props`, props >= 20 ? [] : [`only ${props} frozen props files, expected at least 20`]));
  const sk = read(root, "docs/ci/skeleton-run.md"), exec = /Execution[^|]*\|\s*(\d+)\s*s/.exec(sk);
  out.push(res("F10", need(root, ["scripts/ci-select.ts", "scripts/ci-budget.ts", "scripts/workflows.test.ts", "docs/ci/skeleton-run.md"]), `no-op execution ${exec?.[1]} s`,
    exec ? (Number(exec[1]) < 90 ? [] : [`no-op execution ${exec[1]} s, limit 90`]) : has(root, "docs/ci/skeleton-run.md") ? ["skeleton-run.md has no execution row"] : []));
  const manifests = ls(root, "manifests").filter((f) => !f.startsWith("_"));
  out.push(res("F11", need(root, ["manifests", "generated/registry.json"]), `${manifests.length} manifest files, generated registry present`, manifests.length ? [] : ["no manifests"]));
  const imp = ls(root, "docs/import-log");
  out.push(res("F12", need(root, ["scripts/import-0.6.ts", "docs/import-log"]), `${imp.length} import log files`, imp.length ? [] : ["import log empty"]));
  let laneIds: string[] = []; try { laneIds = JSON.parse(read(root, "scripts/lanes.json")).lanes.map((l: { id: string }) => l.id); } catch { /* reported below */ }
  const noBrief = laneIds.filter((l) => !has(root, `docs/lanes/${l}.md`));
  out.push(res("F13", [], `${laneIds.length} lanes, each with docs/lanes/<lane>.md`, [...(laneIds.length ? [] : ["scripts/lanes.json lists no lanes"]), ...noBrief.map((l) => `no lane brief for ${l}`)]));
  const acct = has(root, "fixtures/ACCOUNTS.md");
  out.push(acct ? { id: "F14", ok: true, detail: "fixtures/ACCOUNTS.md present" } : { id: "F14", ok: true, waived: true, detail: "waived: P-PR_64 (test accounts) does not gate G0; owner supplies the accounts" });
  const run = await p.mainRun();
  out.push({ id: "F15", ok: !!run && run.conclusion === "success", detail: run ? `last main run ${run.conclusion}` : "no main run found" });

  // gate conditions
  const pk = await p.packets();
  const open = pk.filter((x) => (x.lane_id ?? "prep") === "prep" && x.status !== "done" && !WAIVED_PACKETS.includes(x.id) && x.id !== "P-PR_75");
  out.push({ id: "packets", ok: pk.length > 0 && open.length === 0, detail: pk.length === 0 ? "no packet list" : open.length ? `not done: ${open.map((x) => `${x.id}(${x.status})`).join(", ")}` : `all prep packets done except ${WAIVED_PACKETS.join(" and ")} (waived) and this one` });
  const hash = read(root, "generated/hash.txt").trim(), frozen = ls(root, "contracts/tests").filter((f) => /^frozen-.*\.test\.ts$/.test(f));
  out.push({ id: "contract-hash", ok: /^[0-9a-f]{64}$/.test(hash) && frozen.length > 0, detail: /^[0-9a-f]{64}$/.test(hash) ? `generated/hash.txt ${hash.slice(0, 12)}, ${frozen.length} frozen tests` : "generated/hash.txt missing or not a sha256" });
  out.push({ id: "main-green", ok: !!run && run.conclusion === "success", detail: run ? `conclusion ${run.conclusion}` : "no main run found" });
  const budget = run?.jobs.find((j) => j.name === "budget");
  out.push({ id: "budgets", ok: budget?.conclusion === "success" && !!exec && Number(exec[1]) < 90, detail: `budget job ${budget?.conclusion ?? "absent"}, no-op ${exec?.[1] ?? "?"} s` });
  const dry = read(root, "docs/dry-run-hour1.md");
  out.push({ id: "dry-run", ok: /median lead review/i.test(dry) && /CI push wall/i.test(dry), detail: has(root, "docs/dry-run-hour1.md") ? (/median lead review/i.test(dry) && /CI push wall/i.test(dry) ? "docs/dry-run-hour1.md has review time and CI wall time" : "dry-run record lacks review time or CI wall time") : "docs/dry-run-hour1.md missing" });
  return out;
}

export const verdict = (lines: Line[]) => ({ ok: lines.every((l) => l.ok), text: lines.map((l) => `${l.ok ? (l.waived ? "waiv" : "ok  ") : "FAIL"} ${l.id}: ${l.detail}`).join("\n") });

function realPorts(root: string, a: { packetsJson?: string; skipRemote: boolean }): Ports {
  const sh = (cmd: string, args: string[], cwd: string) => { const r = spawnSync(cmd, args, { cwd, encoding: "utf8" }); return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` }; };
  return {
    root, exec: sh,
    packets: async () => {
      if (a.packetsJson) return JSON.parse(fs.readFileSync(a.packetsJson, "utf8"));
      if (a.skipRemote) return [];
      const url = (process.env.VYRE_TRACKER_URL ?? "http://127.0.0.1:7790").replace(/\/$/, "");
      const r = await fetch(`${url}/api/packets?lane=prep`, { headers: { "X-Tracker-Token": process.env.VYRE_TRACKER_TOKEN ?? "" } });
      return r.ok ? ((await r.json()) as { data: Packet[] }).data : [];
    },
    mainRun: () => {
      if (a.skipRemote) return null;
      const l = sh("gh", ["run", "list", "--branch", "main", "--limit", "1", "--json", "databaseId,conclusion"], root);
      if (!l.ok) return null;
      const first = (JSON.parse(l.out) as { databaseId: number; conclusion: string }[])[0];
      if (!first) return null;
      const v = sh("gh", ["run", "view", String(first.databaseId), "--json", "jobs"], root);
      return { conclusion: first.conclusion, jobs: v.ok ? (JSON.parse(v.out) as { jobs: { name: string; conclusion: string }[] }).jobs : [] };
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2), val = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const root = path.resolve(val("--root") ?? path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const { ok, text } = verdict(await runChecks(realPorts(root, { packetsJson: val("--packets-json"), skipRemote: argv.includes("--skip-remote") })));
  console.log(text); console.log(ok ? "G0: all conditions true" : "G0: NOT READY");
  process.exit(ok ? 0 : 1);
}
