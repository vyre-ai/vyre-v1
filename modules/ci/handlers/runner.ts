// The runner's life (lane l-ci-runners): a job is waiting -> a just-in-time runner and a cloud machine; the job ended -> the machine is deleted; every 2 minutes the sweeper deletes what should not exist.
// A machine runs one job and is deleted afterwards. Nothing here touches a person's computer or the Space server. The cloud key is read by the host for each call (CiHost.cloud); this file never sees it.
import { costOf, PRICE_HOURLY } from "../cost.ts";
import { ensure, metaGet, metaSet, monthOf, needHost, patchRun, readSettings, round4, runBy, RUN_COLS, runOf, runsIn } from "../projections.ts";
import type { CiCtx, Row, Run, Settings } from "../projections.ts";
import { projectOfRepo } from "./link.ts";

/** The actions/runner release every machine downloads, pinned with its checksum (a machine whose download does not match powers itself off). Re-check both when bumping. */
export const RUNNER_VERSION = "2.338.2";
export const RUNNER_SHA256 = "baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40";
export const SWEEP_GRACE_MIN = 10;
/** A machine the cloud does not list is given this long to appear before the run is called lost. */
const LOST_AFTER_MS = 5 * 60_000;
const money = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(2));
const code = (e: unknown): string => (e as { error?: { code?: string } } | null)?.error?.code ?? "error";

// ---- the cloud

async function cloud(ctx: CiCtx, s: Settings, req: Parameters<ReturnType<typeof needHost>["cloud"]>[2]): Promise<{ status: number; json: Row }> {
  if (!s.vaultKeyRef) throw Object.assign(new Error("no key"), { error: { code: "provider.auth_failed" } });
  const r = await needHost(ctx).cloud(ctx, s.vaultKeyRef, req);
  let json: Row = {};
  try { const p = r.text ? (JSON.parse(r.text) as unknown) : {}; if (p && typeof p === "object" && !Array.isArray(p)) json = p as Row; } catch { /* a body that is not JSON */ }
  return { status: r.status, json };
}

/** cloud-init user data: download the pinned runner, check it, run one job with the just-in-time config as an ordinary user, and power off when it ends or at the time limit. */
export function userData(jitConfig: string, maxMinutes: number): string {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(jitConfig)) throw new Error("the runner config is not what GitHub sends");
  return [
    "#!/bin/bash", "set -u",
    `( sleep ${Math.max(5, Math.floor(maxMinutes)) * 60}; poweroff ) &`,
    "trap poweroff EXIT",
    "useradd -m -s /bin/bash runner",
    "cd /home/runner",
    `curl -fsSL -o runner.tgz https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz || exit 1`,
    `echo "${RUNNER_SHA256}  runner.tgz" | sha256sum -c - || exit 1`,
    "tar xzf runner.tgz && rm runner.tgz",
    "for i in 1 2 3 4 5 6; do ./bin/installdependencies.sh > /dev/null 2>&1 && break; sleep 15; done",   // a first boot can hold the package lock for a minute
    "chown -R runner:runner /home/runner",
    `sudo -u runner ./run.sh --jitconfig ${jitConfig}`,
    "",
  ].join("\n");
}

/** The runner's download name for the pin. */
export const RUNNER_FILE = `actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz`;
const VERIFIED_MS = 6 * 3_600_000;

/**
 * Before any machine starts, the pinned checksum is compared with the one GitHub itself lists for that release file. They must be equal; a mismatch, a missing checksum or a GitHub that cannot be asked all refuse
 * (a download that was swapped must never run a job). A pass is remembered for six hours. The machine checks the downloaded file against the same pin again before it runs it.
 */
export async function runnerVerified(ctx: CiCtx): Promise<{ ok: true } | { ok: false; why: string }> {
  const at = Number(metaGet(ctx, "runner_verified") ?? 0);
  if (at && ctx.now() - at < VERIFIED_MS) return { ok: true };
  let digest: string | null = null;
  try {
    const rel = (await ctx.call("github.runner_release", { version: RUNNER_VERSION })) as { assets?: Array<{ name: string; digest: string | null }> };
    digest = rel.assets?.find((a) => a.name === RUNNER_FILE)?.digest ?? null;
  } catch (e) {
    ctx.log.warn("ci: the runner release could not be read", { code: code(e) });
    return { ok: false, why: "Vyre could not check the runner download with GitHub, so no machine was started. It tries again on the next job." };
  }
  if (digest === null) return { ok: false, why: "GitHub lists no checksum for the runner download, so Vyre cannot check it and started no machine." };
  if (digest.toLowerCase() !== `sha256:${RUNNER_SHA256}`) return { ok: false, why: "The runner download is not the one this version of Vyre trusts (its checksum differs), so no machine was started. Update Vyre." };
  metaSet(ctx, "runner_verified", String(ctx.now()));
  return { ok: true };
}

const newRunId = (): string => `cir_${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
const monthStart = (ms: number): number => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };

/** Cost so far this month: what ended runs cost, plus what the machines still alive have cost up to now. */
export function spentThisMonth(ctx: CiCtx): number {
  ensure(ctx);
  const rows = (ctx.db.all(`SELECT ${RUN_COLS} FROM ci_run WHERE COALESCE("ended_at", "started_at", "queued_at") >= ?`, monthStart(ctx.now())) as Row[]).map(runOf);
  let sum = 0;
  for (const r of rows) sum += r.state === "starting" || r.state === "running" ? costOf(r.priceHourly ?? PRICE_HOURLY[r.size ?? ""] ?? 0, (ctx.now() - (r.startedAt ?? ctx.now())) / 1000) : r.state === "queued" || r.state === "refused" ? 0 : r.costUsd;
  return round4(sum);
}
const liveCount = (ctx: CiCtx): number => runsIn(ctx, ["starting", "running"]).length;

// ---- the project's Linked tab

/** Show a run on its project's Linked tab: kind "ci.run", the run id as ref, a state of Running, Passed or Failed, a label with the job and how long it took, and the job's address on GitHub. Best effort and repeatable. */
export async function linkRun(ctx: CiCtx, runId: string): Promise<void> {
  const r = runBy(ctx, "run_id", runId);
  if (!r || !r.projectId || r.state === "queued" || r.state === "refused") return;
  const state = r.state === "starting" || r.state === "running" ? "Running" : r.state === "finished" && /^success$/.test(r.conclusion ?? "") ? "Passed" : "Failed";
  const minutes = r.startedAt === null ? 0 : Math.max(1, Math.round(((r.endedAt ?? ctx.now()) - r.startedAt) / 60_000));
  const label = `${r.jobName} · ${r.repo} · ${state === "Running" ? `running ${minutes} min` : `${minutes} min`}`;
  try { await ctx.call("projects.links.link", { projectId: r.projectId, kind: "ci.run", ref: r.runId, state, label, url: `https://github.com/${r.repo}/actions/runs/${r.workflowRunId}/job/${r.jobId}` }); }
  catch (e) { ctx.log.warn("ci: a run could not be linked to its project", { code: code(e) }); }
}

// ---- intake

export interface JobIn { action: "queued" | "completed"; repo: string; jobId: number; runId: number; name?: string | undefined; labels: string[]; fork?: "no" | "yes" | "unknown" | undefined; conclusion?: string | undefined }
export type Handled = "started" | "queued" | "refused" | "ignored" | "finished" | "failed";

export async function intake(ctx: CiCtx, a: JobIn): Promise<{ handled: Handled }> {
  ensure(ctx);
  const s = readSettings(ctx);
  if (a.action === "completed") return finish(ctx, s, a);
  if (!s.enabled) return { handled: "ignored" };
  if (!s.labels.every((l) => a.labels.includes(l))) return { handled: "ignored" };   // not a job for this Space's runners
  if (runBy(ctx, "job_id", a.jobId)) return { handled: "ignored" };                  // delivered twice
  const projectId = await projectOfRepo(ctx, a.repo);
  if (!projectId) return { handled: "ignored" };                                      // a repository no project of this Space is linked to
  const runId = newRunId();
  const insert = (state: string, note: string | null): void => {
    ctx.db.run(`INSERT INTO ci_run ("run_id", "job_id", "workflow_run_id", "repo", "job_name", "project_id", "state", "queued_at", "note") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      runId, a.jobId, a.runId, a.repo, (a.name ?? "job").slice(0, 120), projectId, state, ctx.now(), note);
  };
  const refuse = (codeName: "fork_with_secrets" | "no_key", reason: string): { handled: Handled } => { insert("refused", reason); ctx.emit("ci.job_refused", `entity/${a.repo}`, { repo: a.repo, jobId: a.jobId, reason, code: codeName }); return { handled: "refused" }; };
  if (!s.vaultKeyRef) return refuse("no_key", "Runners are on but no cloud key is chosen.");
  if (a.fork !== "no") {
    let secrets: number | null = null;
    try { secrets = ((await ctx.call("github.actions.secrets", { repo: a.repo })) as { count: number | null }).count; } catch { secrets = null; }
    if (secrets !== 0) {
      return refuse("fork_with_secrets", a.fork === "yes" ? "A pull request from a fork never runs on a cloud machine while the repository holds secrets." : "Vyre could not tell whether this pull request is from a fork or whether the repository holds secrets, so it was not run on a cloud machine.");
    }
  }
  insert("queued", null);
  return { handled: await begin(ctx, s, runBy(ctx, "run_id", runId)!) };
}

/** Start a queued run if there is room and money; otherwise leave it waiting (no room) or refuse it (cap). */
async function begin(ctx: CiCtx, s: Settings, run: Run): Promise<Handled> {
  const live = liveCount(ctx);
  if (live >= s.maxConcurrent) { patchRun(ctx, run.runId, { note: `Waiting for a free machine: ${live} of ${s.maxConcurrent} are busy.` }); return "queued"; }
  const pin = await runnerVerified(ctx);
  if (!pin.ok) {
    const day = new Date(ctx.now()).toISOString().slice(0, 10);
    patchRun(ctx, run.runId, { state: "refused", ended_at: ctx.now(), note: pin.why });
    ctx.emit("ci.job_refused", `entity/${run.repo}`, { repo: run.repo, jobId: run.jobId, reason: pin.why, code: "runner_unverified" });
    if (metaGet(ctx, `blocked:${day}`) === null) { metaSet(ctx, `blocked:${day}`, String(ctx.now())); ctx.emit("ci.blocked", `entity/${day}`, { title: `CI is waiting on you: ${pin.why}`, why: "runner_unverified", day }); }
    return "refused";
  }
  const price = PRICE_HOURLY[s.size] ?? 0, estimate = costOf(price, s.maxJobMinutes * 60), spent = spentThisMonth(ctx);
  if (spent + estimate > s.monthlyCapUsd) {
    const month = monthOf(ctx.now()), title = `CI paused: this month's cap of $${money(s.monthlyCapUsd)} is reached`;
    patchRun(ctx, run.runId, { state: "refused", ended_at: ctx.now(), note: title });
    ctx.emit("ci.job_refused", `entity/${run.repo}`, { repo: run.repo, jobId: run.jobId, reason: title, code: "cap_reached" });
    if (metaGet(ctx, `paused:${month}`) === null) { metaSet(ctx, `paused:${month}`, String(ctx.now())); ctx.emit("ci.paused", `entity/${month}`, { title, capUsd: s.monthlyCapUsd, month }); }
    return "refused";
  }
  return start(ctx, s, run, price);
}

async function start(ctx: CiCtx, s: Settings, run: Run, price: number): Promise<Handled> {
  patchRun(ctx, run.runId, { state: "starting", size: s.size, price_hourly: price, note: null });
  const name = `vyre-ci-${run.runId.slice(4)}`;
  let runnerId: number | null = null, dropletId: string | null = null;
  try {
    const jit = (await ctx.call("github.runners.jit_config", { repo: run.repo, name, labels: s.labels, idempotencyKey: `jit-${run.runId}` })) as { runnerId: number; jitConfig: string };
    runnerId = jit.runnerId;
    const made = await cloud(ctx, s, {
      method: "POST", path: "/v2/droplets",
      body: { name, region: s.region, size: s.size, image: s.image, tags: ["vyre-ci", `vyre-space-${ctx.space}`], user_data: userData(jit.jitConfig, s.maxJobMinutes), monitoring: false, ipv6: false },
    });
    const id = (made.json["droplet"] as Row | undefined)?.["id"];
    if (made.status >= 300 || (typeof id !== "number" && typeof id !== "string")) throw Object.assign(new Error("the cloud refused"), { said: made.status < 500 && typeof made.json["message"] === "string" ? (made.json["message"] as string).replace(/[\u0000-\u001f]/g, " ").slice(0, 200) : "", error: { code: made.status === 401 ? "provider.auth_failed" : made.status === 403 ? "provider.refused" : made.status === 422 ? "validation.bad_input" : "provider.unavailable" } });
    dropletId = String(id);
    patchRun(ctx, run.runId, { state: "running", droplet_id: dropletId, runner_id: runnerId, started_at: ctx.now() });
    ctx.emit("ci.run_started", `entity/${run.runId}`, { runId: run.runId, repo: run.repo, jobId: run.jobId, dropletId, size: s.size });
    await linkRun(ctx, run.runId);
    return "started";
  } catch (e) {
    const said = (e as { said?: string }).said;
    const why = code(e) === "provider.refused" ? `The cloud refused to make a machine${said ? `: ${said}` : "."}` : code(e) === "provider.auth_failed" ? "The cloud did not accept the key. Check the Vault item chosen in the CI settings." : code(e) === "validation.bad_input" ? "The cloud refused the machine settings (region, size or image)." : "A machine could not be made.";
    ctx.log.warn("ci: a runner could not start", { code: code(e) });
    if (runnerId !== null) await ctx.call("github.runners.remove", { repo: run.repo, runnerId }).catch(() => undefined);
    patchRun(ctx, run.runId, { state: "failed", ended_at: ctx.now(), cost_usd: 0, note: why });
    ctx.emit("ci.run_failed", `entity/${run.runId}`, { runId: run.runId, repo: run.repo, jobId: run.jobId, reason: why });
    await linkRun(ctx, run.runId);
    return "failed";
  }
}

// ---- teardown

async function destroy(ctx: CiCtx, s: Settings, dropletId: string): Promise<boolean> {
  try { const r = await cloud(ctx, s, { method: "DELETE", path: `/v2/droplets/${encodeURIComponent(dropletId)}` }); return r.status < 300 || r.status === 404; }
  catch (e) { ctx.log.warn("ci: a machine could not be deleted", { code: code(e) }); return false; }
}

async function finish(ctx: CiCtx, s: Settings, a: JobIn): Promise<{ handled: Handled }> {
  const run = runBy(ctx, "job_id", a.jobId);
  if (!run || (run.state !== "running" && run.state !== "starting" && run.state !== "queued")) return { handled: "ignored" };
  if (run.dropletId) {
    if (!(await destroy(ctx, s, run.dropletId))) patchRun(ctx, run.runId, { note: "The machine could not be deleted yet; the sweeper will delete it." });
  }
  const seconds = run.startedAt === null ? 0 : (ctx.now() - run.startedAt) / 1000;
  const cost = run.dropletId ? costOf(run.priceHourly ?? PRICE_HOURLY[run.size ?? ""] ?? 0, seconds) : 0;
  patchRun(ctx, run.runId, { state: "finished", ended_at: ctx.now(), conclusion: a.conclusion ?? "unknown", cost_usd: cost, ...(run.dropletId ? {} : { note: "Ended before a machine was made." }) });
  ctx.emit("ci.run_finished", `entity/${run.runId}`, { runId: run.runId, repo: run.repo, jobId: run.jobId, conclusion: a.conclusion ?? "unknown", costUsd: cost, minutes: Math.ceil(seconds / 60) });
  await linkRun(ctx, run.runId);
  await drain(ctx, s);
  return { handled: "finished" };
}

/** Start waiting jobs, oldest first, while there is room. */
export async function drain(ctx: CiCtx, s: Settings): Promise<number> {
  let started = 0;
  if (!s.enabled || !s.vaultKeyRef) return 0;
  for (const run of runsIn(ctx, ["queued"])) {
    if (liveCount(ctx) >= s.maxConcurrent) break;
    if ((await begin(ctx, s, run)) === "started") started++;
  }
  return started;
}

// ---- the sweeper

interface Droplet { id: string; createdAt: number; tags: string[] }

async function listTagged(ctx: CiCtx, s: Settings): Promise<Droplet[]> {
  const out: Droplet[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await cloud(ctx, s, { method: "GET", path: "/v2/droplets", query: { tag_name: "vyre-ci", per_page: 200, page } });
    if (r.status >= 300) throw Object.assign(new Error("list"), { error: { code: "provider.unavailable" } });
    const items = Array.isArray(r.json["droplets"]) ? (r.json["droplets"] as Row[]) : [];
    for (const d of items) out.push({ id: String(d["id"]), createdAt: Date.parse(String(d["created_at"])) || 0, tags: Array.isArray(d["tags"]) ? (d["tags"] as unknown[]).map(String) : [] });
    if (items.length < 200) break;
  }
  return out;
}

/** Every 2 minutes: delete any machine of this Space tagged vyre-ci that is past the time limit plus 10 minutes or has no live run; call a live run lost when its machine is gone; start waiting jobs that now fit. */
export async function sweep(ctx: CiCtx): Promise<{ deleted: number; started: number }> {
  ensure(ctx);
  const s = readSettings(ctx);
  if (!s.vaultKeyRef) return { deleted: 0, started: 0 };
  let droplets: Droplet[];
  try { droplets = (await listTagged(ctx, s)).filter((d) => d.tags.includes(`vyre-space-${ctx.space}`)); }
  catch (e) { ctx.log.warn("ci: the sweeper could not list machines", { code: code(e) }); return { deleted: 0, started: 0 }; }   // never delete on a guess
  const live = runsIn(ctx, ["starting", "running"]);
  const limitMs = (s.maxJobMinutes + SWEEP_GRACE_MIN) * 60_000;
  let deleted = 0;
  for (const d of droplets) {
    const run = live.find((r) => r.dropletId === d.id) ?? null;
    const age = ctx.now() - d.createdAt;
    const reason = !run ? "no_run" : age > limitMs ? "too_long" : null;
    if (!reason) continue;
    if (!(await destroy(ctx, s, d.id))) continue;
    deleted++;
    const known = run ?? runBy(ctx, "droplet_id", d.id);
    const price = known?.priceHourly ?? PRICE_HOURLY[known?.size ?? s.size] ?? PRICE_HOURLY[s.size] ?? 0;
    const cost = costOf(price, age / 1000);
    if (run) patchRun(ctx, run.runId, { state: "swept", ended_at: ctx.now(), cost_usd: cost, note: `Deleted after more than ${s.maxJobMinutes + SWEEP_GRACE_MIN} minutes.` });
    ctx.emit("ci.run_swept", `entity/${d.id}`, { runId: run?.runId ?? known?.runId ?? null, dropletId: d.id, reason, costUsd: cost });
    if (run) await linkRun(ctx, run.runId);
  }
  const alive = new Set(droplets.map((d) => d.id));
  for (const r of live) {   // a run whose machine is gone: the cloud lost it, or it was deleted by hand
    if (r.dropletId && !alive.has(r.dropletId) && ctx.now() - (r.startedAt ?? 0) > LOST_AFTER_MS && runBy(ctx, "run_id", r.runId)?.state === "running") {
      const cost = costOf(r.priceHourly ?? 0, (ctx.now() - (r.startedAt ?? ctx.now())) / 1000);
      patchRun(ctx, r.runId, { state: "failed", ended_at: ctx.now(), cost_usd: cost, note: "The machine was lost before the job ended." });
      ctx.emit("ci.run_failed", `entity/${r.runId}`, { runId: r.runId, repo: r.repo, jobId: r.jobId, reason: "The machine was lost before the job ended." });
      await linkRun(ctx, r.runId);
    }
  }
  return { deleted, started: await drain(ctx, s) };
}
