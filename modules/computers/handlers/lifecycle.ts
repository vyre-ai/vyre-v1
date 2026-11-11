// agent computer lifecycle (spec 2.7; ARCH 6.6, 7.2): provision, get, list, configure, wake, sleep, take over, give back, remove, health, and the signed-in sessions on the profile disk.
// A computer is asleep until something needs it, never sleeps mid-task, and has one person at the controls at a time. The container is the host's (ComputerHost); these rows are what it
// last reported and who holds the controls. Events are the manifest's, with the caller as `by`.
// DECISION: "Working" is the awake state; an awake computer with nothing to do is Working without a caption. Idle sleep is the job sleepIdle (the host schedules it), not a capability.
// DECISION: Take over wakes a sleeping computer first, then pauses the agent's tools and hands the desktop to the person; a person must act (an agent cannot take over).
import {
  actorOf, addStep, boundFill, computerBy, computerOut, computerOf, DEFAULT_IDLE_MINUTES, DEFAULT_TAB_LIMIT, dropFill, ensure, holdFill, hostFor, hostOf, boundHost, isTeam, mintId, nodeOf, mintTicket, needComputer, needTeam, raise, rowsOf, setComputer, setStepCaption,
} from "../projections.ts";
import type { CompCtx, ComputerHost, ComputerRow, Probe, SessionInfo } from "../projections.ts";
import { finishRecording } from "./record.ts";
import { migrateComputers } from "../migrate.ts";
import { bindStarter, checkRoom, claimRoom, drainWaiting, isWaiting, LIMITS, releaseRoom, waitingNote } from "../capacity.ts";

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
  const host = hostFor(ctx, c.computerId);
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
  // a Space that has no agent computer does not depend on the container runtime: its absence is a fact to show, not a failure to raise
  const idle = rows.length === 0;
  const NO_RUNTIME = "No agent computers yet, and no container runtime on this host. Install Docker to start one.";
  if (!host) return idle ? { state: "healthy" as const, detail: NO_RUNTIME, runtime: "missing" as const, awake, asleep } : { state: "down" as const, detail: "Agent computers are not running on this host.", runtime: "missing" as const, awake, asleep };
  const t0 = Date.now();
  let h: { ok: boolean; detail?: string; latencyMs?: number };
  try { h = await host.health(); } catch (e) { h = { ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : "The host did not answer." }; }
  if (!h.ok && idle) return { state: "healthy" as const, detail: NO_RUNTIME, runtime: "missing" as const, latencyMs: h.latencyMs ?? Math.max(0, Date.now() - t0), awake, asleep };
  const broken = rows.filter((s) => s === "error").length;
  const state = !h.ok ? ("down" as const) : broken > 0 ? ("degraded" as const) : ("healthy" as const);
  const detail = !h.ok ? h.detail : broken > 0 ? `${broken} ${broken === 1 ? "computer is" : "computers are"} in an error state` : h.detail;
  return { state, ...(detail ? { detail } : {}), runtime: h.ok ? ("ready" as const) : ("missing" as const), latencyMs: h.latencyMs ?? Math.max(0, Date.now() - t0), awake, asleep };
}

// ---- where agent computers can run

export interface HostRow { hostId: string; kind: "this" | "space" | "server"; name: string; online: boolean; canRun: boolean; runs: number; reason?: string; detail?: string; room?: { fits: number; freeMb: number; totalMb: number } }

const COMPUTER_MB = LIMITS.desktop.reserveMb;
const OS_WORDS: Record<string, string> = { linux: "Linux", darwin: "macOS", win32: "Windows" };
const gb = (mb: number): string => `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`;
/** The machine in a line and how many more computers its free memory holds. */
export function roomOf(c: { totalMb: number; freeMb: number; cpus: number; os: string }): { detail: string; room: { fits: number; freeMb: number; totalMb: number } } {
  return { detail: `${OS_WORDS[c.os] ?? c.os}, ${gb(c.totalMb)}, ${gb(c.freeMb)} free`, room: { fits: Math.max(0, Math.floor(c.freeMb / COMPUTER_MB)), freeMb: c.freeMb, totalMb: c.totalMb } };
}

/**
 * The machines an agent computer can live on, for the person asking: this computer (a Personal Space) or the Space server (a Team Space) when the container runtime answers, and every server they
 * added that has joined and has Docker. `available` is whether any of them can run one: nothing about agent computers is shown or offered until it is true.
 */
export async function hosts(ctx: CompCtx, _input: Record<string, never>) {
  ensure(ctx.db);
  const placed = rowsOf(ctx.db, "SELECT node_id FROM computers_computers").map((r) => (r["node_id"] === null || r["node_id"] === undefined ? null : String(r["node_id"])));
  // the Space says what it is; a harness that binds the answer stands in for it
  let team = isTeam(ctx.space);
  try { const k = ((await ctx.call("spaces.matrix", {})) as { kind?: string }).kind; if (k === "personal") team = false; else if (k === "team") team = true; } catch { /* the bound answer stands */ }
  const out: HostRow[] = [];
  const bound = boundHost();
  let ready = false;
  let why = "";
  if (!bound) why = team ? "This Space's server has no container runner, so it cannot run agent computers. Run the server from its compose file (it starts the runner), or add a server that has Docker." : "Agent computers are not set up on this computer. Install Docker, or add a server that has it.";
  else { try { const h = await bound.health(); ready = h.ok; if (!ready) why = h.detail ?? "The container runtime did not answer."; } catch (e) { why = e instanceof Error ? `The container runtime failed: ${e.message.slice(0, 160)}` : "The container runtime did not answer."; } }
  let cap: ReturnType<typeof roomOf> | null = null;
  if (bound?.capacity && ready) { try { cap = roomOf(await bound.capacity()); } catch { cap = null; } }
  out.push({ hostId: team ? "space" : "this", kind: team ? "space" : "this", name: team ? "The Space" : "This computer", online: true, canRun: ready, runs: placed.filter((n) => n === null).length, ...(ready ? {} : { reason: why }), ...(cap ?? {}) });
  let mine: Array<{ serverId: string; name: string; state: string; enrollment: string; facts?: { docker?: boolean } }> = [];
  try { mine = ((await ctx.call("network.my_computers", {})) as { computers?: typeof mine }).computers ?? []; } catch { /* the network module is not running: no servers */ }
  for (const m of mine) {
    if (m.enrollment !== "approved") continue;
    const online = m.state !== "down";
    const docker = m.facts?.docker === true;
    out.push({ hostId: m.serverId, kind: "server", name: m.name, online, canRun: online && docker, runs: placed.filter((n) => n === m.serverId).length, ...(!docker ? { reason: `${m.name} has no Docker. Install and start Docker on it.` } : !online ? { reason: `${m.name} is offline. Start it and let it reconnect.` } : {}) });
  }
  return { available: out.some((h) => h.canRun), hosts: out };
}

// ---- provision, configure, remove

async function nodeIsListed(ctx: CompCtx, nodeId: string): Promise<boolean> {
  try { return (((await ctx.call("network.servers", {})) as { servers?: Array<{ serverId: string }> }).servers ?? []).some((r) => r.serverId === nodeId); } catch { return true; }
}

/** The node a computer may be placed on: a computer that joined, was approved, and (when it is a person's own) belongs to the agent's owner. */
async function placeable(ctx: CompCtx, nodeId: string, agentId: string): Promise<void> {
  let rows: Array<{ serverId: string; role?: string; enrollment?: string; owner?: string }> = [];
  try { rows = ((await ctx.call("network.servers", {})) as { servers?: typeof rows }).servers ?? []; } catch { /* no list, no placement */ }
  const node = rows.find((r) => r.serverId === nodeId);
  if (!node || node.role !== "compute" || (node.enrollment !== undefined && node.enrollment !== "approved")) raise(ctx, "validation.bad_input", "That computer has not joined this Space.", { nodeId });
  if (node.owner) {
    let owner: string | undefined;
    try { owner = ((await ctx.call("agents.get", { agentId })) as { agent?: { ownerId?: string } }).agent?.ownerId; } catch { /* unknown owner */ }
    if (owner !== node.owner) raise(ctx, "permission.no_grant", "That is someone's own computer. It runs only that person's agents.", { nodeId });
  }
}

/** What an agent that asks for a desktop is told (the agent tool computers_provision lands here). */
export const NO_NEW_DESKTOP = "Agents no longer get a desktop computer. You already have a terminal in your own workspace (terminal_run, terminal_open) and a browser in the Space browser (chrome_open, chrome_snapshot, chrome_act). Use those. Use the person's own Chrome only if they ask for it.";

export async function provision(ctx: CompCtx, input: { agentId: string; tabLimit?: number; nodeId?: string; idempotencyKey: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  // 6 Nov decision: a workspace and the Space browser replace one desktop container per agent. No agent makes itself an old desktop; the people who still hold one keep it until it has moved.
  if (ctx.principal.kind === "agent") raise(ctx, "validation.precondition_failed", NO_NEW_DESKTOP, { agentId: input.agentId });
  const host = input.nodeId === undefined ? hostOf(ctx) : null;
  // say why before anything is made: a host that cannot run containers refuses with its own reason, in words, not a row that is made and unmade
  if (host) {
    let h: { ok: boolean; detail?: string } = { ok: true };
    try { h = await host.health(); } catch (e) { h = { ok: false, detail: e instanceof Error ? e.message.slice(0, 160) : "The container runtime did not answer." }; }
    if (!h.ok) raise(ctx, "provider.unavailable", h.detail ?? "The container runtime did not answer.", { reason: h.detail ?? "no runtime" });
  }
  try {
    await ctx.call("agents.get", { agentId: input.agentId });
  } catch {
    raise(ctx, "validation.bad_input", "There is no such agent.", { agentId: input.agentId });
  }
  if (rowsOf(ctx.db, "SELECT computer_id FROM computers_computers WHERE agent_id = ?", input.agentId)[0]) raise(ctx, "validation.duplicate", "This agent already has a computer.", { agentId: input.agentId });
  if (input.nodeId !== undefined) await placeable(ctx, input.nodeId, input.agentId);
  // a computer made here is stopped and holds no memory, but its image, profile and Files grow on the disk: a full disk refuses before anything is made
  const room = await checkRoom(ctx, { kind: "desktop", nodeId: input.nodeId ?? null });
  if (!room.verdict.ok && room.verdict.reason === "disk") raise(ctx, "provider.unavailable", `${room.verdict.detail}. Free some space on it, or add a compute server in Console > Computers.`, { reason: room.verdict.detail });
  const computerId = mintId("cmt", ctx.now());
  const tabLimit = input.tabLimit ?? DEFAULT_TAB_LIMIT;
  ctx.log.info("computer: provisioning", { computerId, agentId: input.agentId, node: input.nodeId ?? null });
  ctx.db.run(
    "INSERT INTO computers_computers (computer_id, agent_id, state, tabs, tab_limit, idle_sleep_minutes, host, node_id, created_at) VALUES (?, ?, 'provisioning', 0, ?, ?, ?, ?, ?)",
    computerId, input.agentId, tabLimit, DEFAULT_IDLE_MINUTES, "server", input.nodeId ?? null, ctx.now(),
  );
  try {
    const made = await (host ?? hostOf(ctx, computerId)).create({ computerId, agentId: input.agentId, tabLimit, idleSleepMinutes: DEFAULT_IDLE_MINUTES });
    setComputer(ctx.db, computerId, { state: "asleep", ...(made.diskBytes !== undefined ? { disk_bytes: made.diskBytes } : {}) });
    ctx.log.info("computer: created", { computerId });
  } catch (e) {
    ctx.log.warn("computer: create failed", { computerId, reason: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
    ctx.db.run("DELETE FROM computers_computers WHERE computer_id = ?", computerId);
    const reason = e instanceof Error ? e.message.slice(0, 1000) : "unknown";   // long enough for the Details a host adds after its first line
    raise(ctx, "provider.unavailable", `The computer could not be created: ${reason}`, { reason });
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
  const host = hostFor(ctx, c.computerId);
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
  const host = hostOf(ctx, c.computerId);
  if (c.state === "takeover") raise(ctx, "validation.bad_input", "A person has the controls; they give it back first.");
  if (c.recordingId) raise(ctx, "validation.bad_input", "A recording is running; stop it first.");
  if (AWAKE.has(c.state)) {
    try { await host.stop({ computerId: c.computerId, reason: "remove" }); } catch { /* the container is removed next */ }
  }
  dropFill(c.computerId);
  try { await host.remove(c.computerId); } catch (e) {
    // a computer whose node was removed from the Space has nothing left to answer: its row goes, and what was on that machine went with the machine's own wipe
    if (c.nodeId === undefined || (await nodeIsListed(ctx, c.nodeId))) throw e;
  }
  for (const t of ["computers_sessions", "computers_tickets", "computers_timeline", "computers_computers"]) ctx.db.run(`DELETE FROM ${t} WHERE computer_id = ?`, c.computerId);
  releaseRoom(ctx, c.computerId);
  ctx.emit("computer.removed", c.computerId, { computerId: c.computerId, agentId: c.agentId });
  await startWaiting(ctx);
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
  // A computer on a server of the person's reaches the Space over a network link: it gets a Vault channel only when that link is private (the fill endpoint refuses a plain link too).
  const node = nodeOf(ctx.db, c.computerId);
  if (node !== null && binding.nodeSecure?.(node) !== true) { ctx.log.warn("the computer has no Vault channel: its server's link to the Space is not private", { computerId: c.computerId }); return; }
  let grant: { fillToken: string; revoke(): void } | null = null;
  try {
    const out = (await ctx.call("agents.get", { agentId: c.agentId })) as { agent?: { ownerId?: string } };
    const asker = out.agent?.ownerId;
    if (!asker) return;
    grant = await binding.issue({ computerId: c.computerId, agentId: c.agentId, asker, ...(node !== null ? { nodeId: node } : {}) });
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
  // a computer waiting for room is asked again each time something needs it; one that is really starting is left to finish
  if (c.state === "waking" && !isWaiting(ctx.db, c.computerId)) return c;
  const host = hostOf(ctx, c.computerId);
  const room = await claimRoom(ctx, { kind: "desktop", key: c.computerId, nodeId: c.nodeId ?? null });
  if (room.state === "waiting") {
    // queued, not failed: Waking with the plain line, and it starts by itself when a computer sleeps or is removed (drainWaiting)
    setComputer(ctx.db, c.computerId, { state: "waking", error: null, caption: room.line ?? null });
    return needComputer(ctx, c.computerId);
  }
  setComputer(ctx.db, c.computerId, { state: "waking", error: null, caption: null });
  ctx.log.info("computer: starting", { computerId: c.computerId, by });
  try {
    await host.start({ computerId: c.computerId, tabLimit: c.tabLimit, agentId: c.agentId });
  } catch (e) {
    const reason = e instanceof Error ? e.message.slice(0, 1000) : "The computer did not start.";
    ctx.log.warn("computer: start failed", { computerId: c.computerId, reason });
    setComputer(ctx.db, c.computerId, { state: "error", error: reason, caption: null });
    raise(ctx, "internal.unexpected", `The computer did not start: ${reason}`, { reason });
  }
  await connectFill(ctx, host, c);
  setComputer(ctx.db, c.computerId, { state: "working", last_active_at: ctx.now() });
  ctx.log.info("computer: ready", { computerId: c.computerId });
  ctx.emit("computer.started", c.computerId, { computerId: c.computerId, agentId: c.agentId, by });
  return refresh(ctx, needComputer(ctx, c.computerId));
}

/** Wake it, and say so when it is only waiting for room: a caller that is about to use the screen must not go on with a computer that has not started. */
async function awakened(ctx: CompCtx, c: ComputerRow, by: string): Promise<ComputerRow> {
  const out = await awaken(ctx, c, by);
  const line = waitingNote(ctx.db, out.computerId);
  if (line !== null) raise(ctx, "validation.precondition_failed", line, { waiting: true });
  return out;
}

export async function wake(ctx: CompCtx, input: { computerId: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const c = await awaken(ctx, needComputer(ctx, input.computerId), actorOf(ctx));
  return { computer: computerOut(c) };
}

async function putToSleep(ctx: CompCtx, c: ComputerRow, reason: "idle" | "requested"): Promise<void> {
  const host = hostOf(ctx, c.computerId);
  let out: { sessions?: SessionInfo[]; diskBytes?: number };
  try {
    out = await host.stop({ computerId: c.computerId, reason, agentId: c.agentId });
  } catch (e) {
    setComputer(ctx.db, c.computerId, { state: "error", error: e instanceof Error ? e.message.slice(0, 200) : "The computer did not stop." });
    raise(ctx, "internal.unexpected", `The computer did not go to sleep: ${e instanceof Error ? e.message.slice(0, 200) : "no reason given"}`);
  }
  dropFill(c.computerId);
  if (out.sessions) storeSessions(ctx, c.computerId, out.sessions);
  setComputer(ctx.db, c.computerId, { state: "asleep", caption: null, tabs: 0, error: null, ...(out.diskBytes !== undefined ? { disk_bytes: out.diskBytes } : {}) });
  ctx.emit("computer.slept", c.computerId, { computerId: c.computerId, agentId: c.agentId, reason });
  await startWaiting(ctx);
}

/** Room may have opened: start what waits, oldest first. A failure here never fails the call that freed the room. */
async function startWaiting(ctx: CompCtx): Promise<void> {
  try { await drainWaiting(ctx); } catch { ctx.log.warn("capacity: the waiting line could not be checked"); }
}
bindStarter("desktop", async (ctx, computerId) => {
  const c = needComputer(ctx, computerId);
  if (c.state !== "waking") return;
  // its waiting line is gone; back to asleep so awaken starts it for real
  setComputer(ctx.db, computerId, { state: "asleep", caption: null });
  await awaken(ctx, { ...c, state: "asleep" as const }, "queue");
});

export async function sleep(ctx: CompCtx, input: { computerId: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const c0 = needComputer(ctx, input.computerId);
  if (c0.state === "asleep") return { computer: computerOut(c0) };
  if (c0.state === "takeover") raise(ctx, "validation.precondition_failed", "A person has the controls. They give it back first.", { takeoverBy: c0.takeoverBy });
  if (c0.state === "waking" && isWaiting(ctx.db, c0.computerId)) {
    // asked to stop while it waits for room: the wait is cancelled
    releaseRoom(ctx, c0.computerId);
    setComputer(ctx.db, c0.computerId, { state: "asleep", caption: null, error: null });
    return { computer: computerOut(needComputer(ctx, c0.computerId)) };
  }
  if (c0.state === "waking" || c0.state === "provisioning") raise(ctx, "validation.precondition_failed", "This computer is still starting.");
  if (c0.recordingId) raise(ctx, "validation.precondition_failed", "A recording is running.");
  const c = await refresh(ctx, c0);
  const probe = await hostOf(ctx, c.computerId).probe(c.computerId).catch(() => null);
  if (probe?.busy) raise(ctx, "validation.precondition_failed", "A task is running on this computer. It sleeps when the task ends.", { caption: probe.caption });
  await putToSleep(ctx, c, "requested");
  return { computer: computerOut(needComputer(ctx, c.computerId)) };
}

/** The idle job: every awake computer with nothing running that has been quiet for its idle time goes to sleep. Never mid-task, never with a person at the controls or a recording running. */
export async function sleepIdle(ctx: CompCtx): Promise<number> {
  ensure(ctx.db);
  if (!boundHost() && rowsOf(ctx.db, "SELECT 1 FROM computers_computers WHERE node_id IS NOT NULL LIMIT 1").length === 0) return 0;
  let slept = 0;
  for (const c of rowsOf(ctx.db, "SELECT * FROM computers_computers WHERE state = 'working' AND recording_id IS NULL").map(computerOf)) {
    const host = hostFor(ctx, c.computerId);
    if (!host) continue;
    let p: Probe;
    try { p = await host.probe(c.computerId); } catch { continue; }
    if (!p.running) { setComputer(ctx.db, c.computerId, { state: "error", error: "The computer stopped on its own." }); continue; }
    if (p.busy) { setComputer(ctx.db, c.computerId, { last_active_at: ctx.now() }); continue; }
    const quietSince = Math.max(c.lastActiveAt ?? c.createdAt, p.lastFrameAt ?? 0);
    // 0 keeps it awake: it serves a site
    if (c.idleSleepMinutes === 0 || ctx.now() - quietSince < c.idleSleepMinutes * 60_000) continue;
    try { await putToSleep(ctx, c, "idle"); slept++; } catch { /* marked as an error; the next pass leaves it alone */ }
  }
  // room also opens without a sleep (a person raised the limit, a site build ended): the job looks at the waiting line each pass
  await startWaiting(ctx);
  // the one-time move of a computer that is asleep to a workspace and a browser profile; a computer that just slept above is picked up in this same pass
  try { await migrateComputers(ctx); } catch { ctx.log.warn("computers: the move to workspaces could not be checked"); }
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
  c = await awakened(ctx, c, person);
  const host = hostOf(ctx, c.computerId);
  try {
    await host.takeover({ computerId: c.computerId, personId: person });
  } catch (e) {
    const reason = e instanceof Error ? e.message.slice(0, 200) : "no reason given";
    raise(ctx, "internal.unexpected", `The computer did not hand over the controls: ${reason}`, { reason });
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
    await hostOf(ctx, c.computerId).giveBack(c.computerId);
  } catch (e) {
    const reason = e instanceof Error ? e.message.slice(0, 200) : "no reason given";
    raise(ctx, "internal.unexpected", `The computer did not take the controls back: ${reason}`, { reason });
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
  const host = hostFor(ctx, c.computerId);
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
  const c = await awakened(ctx, needComputer(ctx, input.computerId), actorOf(ctx));
  let ok: boolean;
  try { ok = await hostOf(ctx, c.computerId).signOut({ computerId: c.computerId, site }); } catch (e) { raise(ctx, "internal.unexpected", `The computer did not sign out: ${e instanceof Error ? e.message.slice(0, 200) : "no reason given"}`); }
  if (!ok) return { ok: false };
  ctx.db.run("DELETE FROM computers_sessions WHERE computer_id = ? AND site = ?", c.computerId, site);
  ctx.emit("computer.session_signed_out", c.computerId, { computerId: c.computerId, site, by: actorOf(ctx) });
  return { ok: true };
}
