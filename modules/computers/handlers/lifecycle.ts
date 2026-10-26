// agent computer lifecycle (spec 2.7; ARCH 6.6, 7.2): provision, get, list, configure, wake, sleep, take over, give back, remove, health, and the signed-in sessions on the profile disk.
// A computer is asleep until something needs it, never sleeps mid-task, and has one person at the controls at a time. The container is the host's (ComputerHost); these rows are what it
// last reported and who holds the controls. Events are the manifest's, with the caller as `by`.
// DECISION: "Working" is the awake state; an awake computer with nothing to do is Working without a caption. Idle sleep is the job sleepIdle (the host schedules it), not a capability.
// DECISION: Take over wakes a sleeping computer first, then pauses the agent's tools and hands the desktop to the person; a person must act (an agent cannot take over).
import {
  actorOf, addStep, boundFill, computerBy, computerOut, computerOf, DEFAULT_IDLE_MINUTES, DEFAULT_TAB_LIMIT, dropFill, ensure, holdFill, hostOf, boundHost, mintId, mintTicket, needComputer, needTeam, raise, rowsOf, setComputer, setStepCaption,
} from "../projections.ts";
import type { CompCtx, ComputerHost, ComputerRow, Probe, SessionInfo } from "../projections.ts";
import { finishRecording } from "./record.ts";

type Row = Record<string, unknown>;
const pageOf = <T>(items: readonly T[], cursor: string | undefined, limit: number | undefined): { page: T[]; next?: string; total: number } => {
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const size = limit ?? 100;
  return { page: items.slice(start, start + size), ...(start + size < items.length ? { next: String(start + size) } : {}), total: items.length };
};

const AWAKE = new Set(["waking", "working", "takeover"]);

/** The person at the keyboard: an agent cannot take the desktop from itself. */
function personOf(ctx: CompCtx): string {
  const who = ctx.actingFor ?? (ctx.principal.kind === "person" ? ctx.principal.id : undefined);
  if (!who) raise(ctx, "permission.no_grant", "Only a person can take over a computer.");
  return who;
}

/** Read what the running container reports (tabs, caption, last frame) into the row. A computer whose container is gone is marked as an error, not left looking awake. */
async function refresh(ctx: CompCtx, c: ComputerRow): Promise<ComputerRow> {
  const host = boundHost();
  if (!host || (c.state !== "working" && c.state !== "takeover")) return c;
  try {
    const p = await host.probe(c.computerId);
    if (!p.running) {
      setComputer(ctx.db, c.computerId, { state: "error", error: "The computer stopped on its own.", tabs: 0, caption: null });
    } else {
      setComputer(ctx.db, c.computerId, {
        tabs: p.tabs, caption: p.busy ? (p.caption ?? c.caption ?? null) : null, ...(p.lastFrameAt !== undefined ? { last_frame_at: p.lastFrameAt } : {}),
        ...(p.diskBytes !== undefined ? { disk_bytes: p.diskBytes } : {}),
      });
    }
  } catch {
    // The host did not answer; what was stored stays.
  }
  return computerBy(ctx.db, c.computerId) ?? c;
}

// ---- read

export async function get(ctx: CompCtx, input: { computerId: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  return { computer: computerOut(await refresh(ctx, needComputer(ctx, input.computerId))) };
}

export async function list(ctx: CompCtx, input: { state?: string[]; cursor?: string; limit?: number }) {
  ensure(ctx.db);
  needTeam(ctx);
  const states = input.state && input.state.length > 0 ? input.state : null;
  const rows = rowsOf(ctx.db, "SELECT * FROM computers_computers ORDER BY agent_id").map(computerOf);
  const fresh = await Promise.all(rows.map((c) => refresh(ctx, c)));
  const kept = states ? fresh.filter((c) => states.includes(c.state)) : fresh;
  const p = pageOf(kept, input.cursor, input.limit);
  return { computers: p.page.map(computerOut), ...(p.next ? { next: p.next } : {}), total: p.total };
}

export async function health(ctx: CompCtx, _input: Record<string, never>) {
  ensure(ctx.db);
  needTeam(ctx);
  const rows = rowsOf(ctx.db, "SELECT state FROM computers_computers").map((r) => String(r["state"]));
  const awake = rows.filter((s) => AWAKE.has(s)).length;
  const asleep = rows.filter((s) => s === "asleep").length;
  const host = boundHost();
  if (!host) return { state: "down" as const, detail: "Agent computers are not running on this host.", awake, asleep };
  const t0 = Date.now();
  let h: { ok: boolean; detail?: string; latencyMs?: number };
  try { h = await host.health(); } catch (e) { h = { ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : "The host did not answer." }; }
  const broken = rows.filter((s) => s === "error").length;
  const state = !h.ok ? ("down" as const) : broken > 0 ? ("degraded" as const) : ("healthy" as const);
  const detail = !h.ok ? h.detail : broken > 0 ? `${broken} ${broken === 1 ? "computer is" : "computers are"} in an error state` : h.detail;
  return { state, ...(detail ? { detail } : {}), latencyMs: h.latencyMs ?? Math.max(0, Date.now() - t0), awake, asleep };
}

// ---- provision, configure, remove

export async function provision(ctx: CompCtx, input: { agentId: string; tabLimit?: number; idempotencyKey: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const host = hostOf(ctx);
  try {
    await ctx.call("agents.get", { agentId: input.agentId });
  } catch {
    raise(ctx, "validation.bad_input", "There is no such agent.", { agentId: input.agentId });
  }
  if (rowsOf(ctx.db, "SELECT computer_id FROM computers_computers WHERE agent_id = ?", input.agentId)[0]) raise(ctx, "validation.duplicate", "This agent already has a computer.", { agentId: input.agentId });
  const computerId = mintId("cmt", ctx.now());
  const tabLimit = input.tabLimit ?? DEFAULT_TAB_LIMIT;
  ctx.db.run(
    "INSERT INTO computers_computers (computer_id, agent_id, state, tabs, tab_limit, idle_sleep_minutes, host, created_at) VALUES (?, ?, 'provisioning', 0, ?, ?, ?, ?)",
    computerId, input.agentId, tabLimit, DEFAULT_IDLE_MINUTES, host.kind, ctx.now(),
  );
  try {
    const made = await host.create({ computerId, agentId: input.agentId, tabLimit, idleSleepMinutes: DEFAULT_IDLE_MINUTES });
    setComputer(ctx.db, computerId, { state: "asleep", ...(made.diskBytes !== undefined ? { disk_bytes: made.diskBytes } : {}) });
  } catch (e) {
    ctx.db.run("DELETE FROM computers_computers WHERE computer_id = ?", computerId);
    raise(ctx, "provider.unavailable", "The computer could not be created on this host.", { reason: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
  }
  ctx.emit("computer.provisioned", computerId, { computerId, agentId: input.agentId });
  return { computer: computerOut(needComputer(ctx, computerId)) };
}

export async function configure(ctx: CompCtx, input: { computerId: string; tabLimit?: number; idleSleepMinutes?: number }) {
  ensure(ctx.db);
  needTeam(ctx);
  const c = needComputer(ctx, input.computerId);
  const fields: string[] = [];
  const cols: Record<string, number> = {};
  if (input.tabLimit !== undefined) { fields.push("tabLimit"); cols["tab_limit"] = input.tabLimit; }
  if (input.idleSleepMinutes !== undefined) { fields.push("idleSleepMinutes"); cols["idle_sleep_minutes"] = input.idleSleepMinutes; }
  if (fields.length === 0) raise(ctx, "validation.bad_input", "Name the tab limit or the idle sleep to change.");
  setComputer(ctx.db, c.computerId, cols);
  const host = boundHost();
  if (host && input.tabLimit !== undefined && AWAKE.has(c.state)) {
    try { await host.configure({ computerId: c.computerId, tabLimit: input.tabLimit }); } catch { ctx.log.warn("the running computer did not take the new tab limit", { computerId: c.computerId }); }
  }
  ctx.emit("computer.configured", c.computerId, { computerId: c.computerId, fields });
  return { computer: computerOut(needComputer(ctx, c.computerId)) };
}

export async function remove(ctx: CompCtx, input: { computerId: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const c = needComputer(ctx, input.computerId);
  const host = hostOf(ctx);
  if (c.state === "takeover") raise(ctx, "validation.bad_input", "A person has the controls; they give it back first.");
  if (c.recordingId) raise(ctx, "validation.bad_input", "A recording is running; stop it first.");
  if (AWAKE.has(c.state)) {
    try { await host.stop({ computerId: c.computerId, reason: "remove" }); } catch { /* the container is removed next */ }
  }
  dropFill(c.computerId);
  await host.remove(c.computerId);
  for (const t of ["computers_sessions", "computers_tickets", "computers_timeline", "computers_computers"]) ctx.db.run(`DELETE FROM ${t} WHERE computer_id = ?`, c.computerId);
  ctx.emit("computer.removed", c.computerId, { computerId: c.computerId, agentId: c.agentId });
  return { removed: true };
}

// ---- wake, sleep, idle

function storeSessions(ctx: CompCtx, computerId: string, sessions: readonly SessionInfo[]): void {
  ctx.db.run("DELETE FROM computers_sessions WHERE computer_id = ?", computerId);
  for (const s of sessions) {
    ctx.db.run("INSERT INTO computers_sessions (computer_id, site, signed_in_as, since, last_seen) VALUES (?, ?, ?, ?, ?)", computerId, s.site, s.signedInAs ?? null, s.since, s.lastSeen);
  }
}

/** Start a sleeping computer. The row says Waking while the host works, then Working; a host that fails leaves an error the person can read, and the next wake tries again. */
/**
 * Give a running computer its Vault channel (P-L2_21): a token for this computer, the agent that lives on it and the person that agent acts for (its owner), and the address to post to.
 * A computer that cannot take it still works, it just refuses a #Handle ("no channel to the Vault"); nothing is typed and the token is ended.
 */
async function connectFill(ctx: CompCtx, host: ComputerHost, c: ComputerRow): Promise<void> {
  const binding = boundFill();
  if (!binding) return;
  let grant: { fillToken: string; revoke(): void } | null = null;
  try {
    const out = (await ctx.call("agents.get", { agentId: c.agentId })) as { agent?: { ownerId?: string } };
    const asker = out.agent?.ownerId;
    if (!asker) return;
    grant = await binding.issue({ computerId: c.computerId, agentId: c.agentId, asker });
    await host.configure({ computerId: c.computerId, tabLimit: c.tabLimit, fillUrl: binding.url(), fillToken: grant.fillToken });
    holdFill(c.computerId, grant);
  } catch {
    grant?.revoke();
    ctx.log.warn("the computer did not take its Vault channel", { computerId: c.computerId });
  }
}

export async function awaken(ctx: CompCtx, c: ComputerRow, by: string): Promise<ComputerRow> {
  if (c.state === "working" || c.state === "takeover") return c;
  if (c.state === "provisioning") raise(ctx, "validation.bad_input", "This computer is still being set up.");
  if (c.state === "waking") return c;
  const host = hostOf(ctx);
  setComputer(ctx.db, c.computerId, { state: "waking", error: null });
  try {
    await host.start({ computerId: c.computerId, tabLimit: c.tabLimit, agentId: c.agentId });
  } catch (e) {
    setComputer(ctx.db, c.computerId, { state: "error", error: e instanceof Error ? e.message.slice(0, 200) : "The computer did not start." });
    raise(ctx, "internal.unexpected", "The computer did not start. Try again.");
  }
  await connectFill(ctx, host, c);
  setComputer(ctx.db, c.computerId, { state: "working", last_active_at: ctx.now() });
  ctx.emit("computer.started", c.computerId, { computerId: c.computerId, agentId: c.agentId, by });
  return refresh(ctx, needComputer(ctx, c.computerId));
}

export async function wake(ctx: CompCtx, input: { computerId: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const c = await awaken(ctx, needComputer(ctx, input.computerId), actorOf(ctx));
  return { computer: computerOut(c) };
}

async function putToSleep(ctx: CompCtx, c: ComputerRow, reason: "idle" | "requested"): Promise<void> {
  const host = hostOf(ctx);
  let out: { sessions?: SessionInfo[]; diskBytes?: number };
  try {
    out = await host.stop({ computerId: c.computerId, reason, agentId: c.agentId });
  } catch (e) {
    setComputer(ctx.db, c.computerId, { state: "error", error: e instanceof Error ? e.message.slice(0, 200) : "The computer did not stop." });
    raise(ctx, "internal.unexpected", "The computer did not go to sleep. Try again.");
  }
  dropFill(c.computerId);
  if (out.sessions) storeSessions(ctx, c.computerId, out.sessions);
  setComputer(ctx.db, c.computerId, { state: "asleep", caption: null, tabs: 0, error: null, ...(out.diskBytes !== undefined ? { disk_bytes: out.diskBytes } : {}) });
  ctx.emit("computer.slept", c.computerId, { computerId: c.computerId, agentId: c.agentId, reason });
}

export async function sleep(ctx: CompCtx, input: { computerId: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const c0 = needComputer(ctx, input.computerId);
  if (c0.state === "asleep") return { computer: computerOut(c0) };
  if (c0.state === "takeover") raise(ctx, "validation.precondition_failed", "A person has the controls. They give it back first.", { takeoverBy: c0.takeoverBy });
  if (c0.state === "waking" || c0.state === "provisioning") raise(ctx, "validation.precondition_failed", "This computer is still starting.");
  if (c0.recordingId) raise(ctx, "validation.precondition_failed", "A recording is running.");
  const c = await refresh(ctx, c0);
  const probe = await hostOf(ctx).probe(c.computerId).catch(() => null);
  if (probe?.busy) raise(ctx, "validation.precondition_failed", "A task is running on this computer. It sleeps when the task ends.", { caption: probe.caption });
  await putToSleep(ctx, c, "requested");
  return { computer: computerOut(needComputer(ctx, c.computerId)) };
}

/** The idle job: every awake computer with nothing running that has been quiet for its idle time goes to sleep. Never mid-task, never with a person at the controls or a recording running. */
export async function sleepIdle(ctx: CompCtx): Promise<number> {
  ensure(ctx.db);
  const host = boundHost();
  if (!host) return 0;
  let slept = 0;
  for (const c of rowsOf(ctx.db, "SELECT * FROM computers_computers WHERE state = 'working' AND recording_id IS NULL").map(computerOf)) {
    let p: Probe;
    try { p = await host.probe(c.computerId); } catch { continue; }
    if (!p.running) { setComputer(ctx.db, c.computerId, { state: "error", error: "The computer stopped on its own." }); continue; }
    if (p.busy) { setComputer(ctx.db, c.computerId, { last_active_at: ctx.now() }); continue; }
    const quietSince = Math.max(c.lastActiveAt ?? c.createdAt, p.lastFrameAt ?? 0);
    if (ctx.now() - quietSince < c.idleSleepMinutes * 60_000) continue;
    try { await putToSleep(ctx, c, "idle"); slept++; } catch { /* marked as an error; the next pass leaves it alone */ }
  }
  return slept;
}

// ---- take over, give back

const minutesOf = (ms: number): string => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return `${m} ${m === 1 ? "minute" : "minutes"}`;
};

export async function takeOver(ctx: CompCtx, input: { computerId: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const person = personOf(ctx);
  let c = needComputer(ctx, input.computerId);
  if (c.state === "takeover") {
    // The same person asking again gets a fresh ticket for the connection, nothing else changes.
    if (c.takeoverBy !== person) raise(ctx, "validation.precondition_failed", "Someone else has the controls.", { takeoverBy: c.takeoverBy });
    const t = await mintTicket(ctx.db, "takeover", c.computerId, person, ctx.now());
    return { computer: computerOut(c), ticket: t.ticket };
  }
  if (c.state === "provisioning" || c.state === "waking") raise(ctx, "validation.precondition_failed", "This computer is still starting.");
  c = await awaken(ctx, c, person);
  const host = hostOf(ctx);
  try {
    await host.takeover({ computerId: c.computerId, personId: person });
  } catch {
    raise(ctx, "internal.unexpected", "The computer did not hand over the controls. Try again.");
  }
  const step = addStep(ctx.db, c.computerId, ctx.now(), { by: "person", caption: "You took over", tool: "take_over" });
  setComputer(ctx.db, c.computerId, { state: "takeover", takeover_by: person, takeover_at: ctx.now(), takeover_step: step.stepId, last_active_at: ctx.now(), caption: null });
  const t = await mintTicket(ctx.db, "takeover", c.computerId, person, ctx.now());
  ctx.emit("computer.takeover", c.computerId, { computerId: c.computerId, agentId: c.agentId, personId: person });
  return { computer: computerOut(needComputer(ctx, c.computerId)), ticket: t.ticket };
}

export async function giveBack(ctx: CompCtx, input: { computerId: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const c = needComputer(ctx, input.computerId);
  if (c.state !== "takeover") return { computer: computerOut(c) };
  const me = actorOf(ctx);
  // The person at the controls gives it back; someone who manages computers can take it back from them.
  if (c.takeoverBy !== me && ctx.authorize({ perm: "computers.use", level: "manage" }, { type: "computer", id: c.computerId }).effect !== "allow") {
    raise(ctx, "permission.no_grant", "Only the person at the controls, or someone who manages computers, can give it back.");
  }
  if (c.recordingId) await finishRecording(ctx, c);
  try {
    await hostOf(ctx).giveBack(c.computerId);
  } catch {
    raise(ctx, "internal.unexpected", "The computer did not take the controls back. Try again.");
  }
  if (c.takeoverStep) setStepCaption(ctx.db, c.takeoverStep, `You took over for ${minutesOf(ctx.now() - (c.takeoverAt ?? ctx.now()))}`);
  setComputer(ctx.db, c.computerId, { state: "working", takeover_by: null, takeover_at: null, takeover_step: null, last_active_at: ctx.now() });
  ctx.emit("computer.given_back", c.computerId, { computerId: c.computerId, agentId: c.agentId, personId: c.takeoverBy ?? me });
  return { computer: computerOut(needComputer(ctx, c.computerId)) };
}

// ---- signed-in sessions

export async function sessionsList(ctx: CompCtx, input: { computerId: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const c = needComputer(ctx, input.computerId);
  const host = boundHost();
  if (host && (c.state === "working" || c.state === "takeover")) {
    try { storeSessions(ctx, c.computerId, await host.sessions(c.computerId)); } catch { /* the last list stays */ }
  }
  const rows = rowsOf(ctx.db, "SELECT * FROM computers_sessions WHERE computer_id = ? ORDER BY site", c.computerId);
  return {
    sessions: rows.map((r: Row) => ({
      site: String(r["site"]), ...(r["signed_in_as"] !== null && r["signed_in_as"] !== undefined ? { signedInAs: String(r["signed_in_as"]) } : {}), since: Number(r["since"]), lastSeen: Number(r["last_seen"]),
    })),
  };
}

export async function sessionSignOut(ctx: CompCtx, input: { computerId: string; site: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const site = input.site.trim();
  if (site === "") raise(ctx, "validation.bad_input", "Name the site to sign out of.");
  const c = await awaken(ctx, needComputer(ctx, input.computerId), actorOf(ctx));
  let ok: boolean;
  try { ok = await hostOf(ctx).signOut({ computerId: c.computerId, site }); } catch { raise(ctx, "internal.unexpected", "The computer did not sign out. Try again."); }
  if (!ok) return { ok: false };
  ctx.db.run("DELETE FROM computers_sessions WHERE computer_id = ? AND site = ?", c.computerId, site);
  ctx.emit("computer.session_signed_out", c.computerId, { computerId: c.computerId, site, by: actorOf(ctx) });
  return { ok: true };
}
