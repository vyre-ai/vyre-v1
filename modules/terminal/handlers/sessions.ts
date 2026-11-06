// terminal: tmux sessions in an agent's workspace, on the Space server or on a person's computer (spec 2.7, 2.23; ARCH 6.7, 6.11, 7.2).
//   open / open_server / close / rename / list / get / status     the sessions, and what Home shows for starred ones
//   input / interrupt / resize / read / attach                     a person typing in the tab; the same session an agent used, so "Open terminal" shows its commands
//   run                                                            the terminal_run tool: one command, run in a session, output scrubbed of every Vault value filled into it
//   rules.get / rules.set / health
// The machine does the work through the TerminalHost port (projections.ts); this module keeps what Vyre knows about a session and enforces who may do what in it.
import {
  MAX_RULES, MAX_RULE_CHARS, TICKET_MS, actorOf, boundHost, boundKit, boundPlace, boundValues, clean, commandsOf, ensure, forgetSecrets, hostOf, insertSession, isTeam, judge, mintId, raise, rememberSecrets,
  rulesOf, sessionBy, sessionOf, sha256, ticketSecret, touch, workspacesReady, SESSION_SELECT, insertTab,
} from "../projections.ts";
import { judged, isDangerous } from "../risk.ts";
import type { HostKind, Lookup, Rules, Secret, SessionRow, TabBy, Target, TermCtx, TermState, TurnPlace, ValueSource, VaultRun, Where } from "../projections.ts";

type Row = Record<string, unknown>;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const DEFAULT_TIMEOUT_SEC = 120;
const MAX_COMMAND_CHARS = 20_000;
const REPLAY_LINES = 200;
const AGENT_SESSION = "agent";

const TITLE: Readonly<Record<HostKind, string>> = { agent_computer: "Workspace", space_server: "Space server", device: "This computer" };

export function terminalRow(x: SessionRow) {
  return {
    terminalId: x.terminalId, name: x.name, host: x.host, hostTitle: x.hostTitle,
    ...(x.agentId === undefined ? {} : { agentId: x.agentId }), ...(x.computerId === undefined ? {} : { computerId: x.computerId }), ...(x.deviceId === undefined ? {} : { deviceId: x.deviceId }),
    cwd: x.cwd, state: x.state, exitCode: x.exitCode, named: x.named, cols: x.cols, rows: x.rows, createdAt: x.createdAt, lastActiveAt: x.lastActiveAt, ...(x.runId === undefined ? {} : { runId: x.runId }),
    ...(x.by === undefined ? {} : { by: x.by }),
  };
}

/** A session that is still there. A closed one is gone for every action but `get`. */
function live(ctx: TermCtx, id: string): SessionRow {
  const x = sessionBy(ctx.db, id);
  if (!x || x.closedAt !== undefined) raise(ctx, "validation.not_found", "There is no such terminal.", { terminalId: id });
  return x;
}

// ---- who may be in a workspace ---------------------------------------------------------------------------------------------------------------------------

interface AgentFacts { ownerId?: string; kind?: string; runtime?: string }

// ---- the workspace a call works in, and who it is there ----------------------------------------------------------------------------------------------------

export interface WorkScope {
  /** The agent whose workspace it is. */
  agentId: string;
  /** Set when the caller is a helper, subagent or crew member working under that agent: its own tab in the parent's workspace, labelled with its name. */
  helper?: { name: string };
}

const MAX_HOPS = 4;

/**
 * The workspace an agent's terminal call works in (owner, 6 Nov: helpers, subagents and crew an agent starts get a terminal in the parent's workspace, each in a tab of its own). A call from a helper
 * thread climbs to the chat the helper was started under, and the workspace is the agent of that chat: the helper itself when it is the same agent, else the chat's first agent. Anything the climb cannot
 * read leaves the caller in its own workspace. Only the helper's own chain is ever read, so a helper never reaches another person's workspace.
 */
export async function workScope(ctx: TermCtx, agentId: string): Promise<WorkScope> {
  if (ctx.thread === undefined || !ctx.call) return { agentId };
  type Th = { kind?: string; title?: string; parentThreadId?: string; agents?: Array<{ agentId: string }> };
  const get = async (threadId: string): Promise<Th | undefined> => { try { return ((await ctx.call!("threads.get", { threadId })) as { thread?: Th } | undefined)?.thread; } catch { return undefined; } };
  const first = await get(ctx.thread);
  if (first?.kind !== "helper" || first.parentThreadId === undefined) return { agentId };
  let top: Th | undefined = first;
  for (let i = 0; i < MAX_HOPS && top?.kind === "helper" && top.parentThreadId !== undefined; i++) top = await get(top.parentThreadId);
  const lead = top?.agents?.map((a) => a.agentId) ?? [];
  const ws = lead.includes(agentId) ? agentId : lead[0];
  if (ws === undefined) return { agentId };
  let name = (first.title ?? "").trim();
  if (ws !== agentId) { try { const n = ((await ctx.call("agents.get", { agentId })) as { agent?: { name?: string } } | undefined)?.agent?.name; if (n) name = n; } catch { /* the title stands */ } }
  return { agentId: ws, helper: { name: (name || "helper").slice(0, 60) } };
}

/** Who a session is a tab of, for the call that opens it. */
async function tabFor(ctx: TermCtx, scope: WorkScope | undefined): Promise<TabBy> {
  if (ctx.principal.kind === "agent") return scope?.helper ? { kind: "helper", name: scope.helper.name } : { kind: "agent" };
  return { kind: "person" };
}

/**
 * Whose workspace this is to enter (owner, 6 Nov): an agent in its own; a person in their own Assistant's (or any agent of theirs); owners and admins (the ones who hold Manage) in a team agent's;
 * nobody else, and never in another person's Assistant or outside agent, whatever their role, since that is private to its person.
 */
export async function mayEnterWorkspace(ctx: TermCtx, agentId: string): Promise<boolean> {
  if (ctx.principal.kind === "agent") return ctx.principal.id === agentId || (await workScope(ctx, ctx.principal.id)).agentId === agentId;
  if (ctx.principal.kind === "service") return true;
  const me = actorOf(ctx);
  let agent: AgentFacts | undefined;
  try { agent = ((await ctx.call?.("agents.get", { agentId })) as { agent?: AgentFacts } | undefined)?.agent; } catch { agent = undefined; }
  if (agent?.ownerId === me) return true;
  if (agent !== undefined && (agent.kind === "assistant" || agent.runtime === "outside")) return false;
  return ctx.authorize({ perm: null, level: "manage" }, { type: "agent", id: agentId }).effect === "allow";
}

async function needWorkspace(ctx: TermCtx, agentId: string): Promise<void> {
  if (!(await mayEnterWorkspace(ctx, agentId))) raise(ctx, "permission.role_lacks_permission", "That workspace is not yours to open. A person opens their own Assistant's; an owner or admin opens a team agent's.", { reason: "workspace_private" });
}

/** A session in a workspace is entered only by who may enter that workspace. */
async function needAccess(ctx: TermCtx, x: SessionRow): Promise<SessionRow> {
  if (x.host === "agent_computer" && x.agentId !== undefined) {
    await needWorkspace(ctx, x.agentId);
    // a helper from another agent works in the parent's workspace in its own tab: it does not type in the parent's or a sibling's
    if (ctx.principal.kind === "agent" && ctx.principal.id !== x.agentId && x.actor !== undefined && x.actor !== ctx.principal.id) raise(ctx, "permission.role_lacks_permission", "That tab belongs to another agent in this workspace.", { reason: "tab_not_yours" });
  }
  return x;
}

const unexpected = (ctx: TermCtx, what: string, e: unknown): never => {
  ctx.log.warn(`terminal: ${what} failed`, { reason: e instanceof Error ? e.message.slice(0, 120) : "unknown" });
  return raise(ctx, "internal.unexpected", `The terminal could not ${what}.`);
};

// ---- opening ------------------------------------------------------------------------------------------------------------------------------------------------

interface OpenInput { by?: TabBy; threadId?: string; host: HostKind; agentId?: string; computerId?: string; deviceId?: string; name?: string; cwd?: string; cols?: number; rows?: number; named?: boolean }

async function openSession(ctx: TermCtx, a: OpenInput, mapHostError: (e: unknown) => never): Promise<SessionRow> {
  ensure(ctx.db);
  if (a.host === "agent_computer") {
    if (!isTeam(ctx.space)) raise(ctx, "permission.needs_team", "Agent computers are part of a Team Space.");
    if (a.agentId === undefined) raise(ctx, "validation.bad_input", "Say which agent's workspace to open the terminal in.");
    await needWorkspace(ctx, a.agentId);
  }
  if (a.host === "device" && a.deviceId === undefined) raise(ctx, "validation.bad_input", "Say which computer to open the terminal on.");
  const now = ctx.now();
  const owner = actorOf(ctx);
  const cols = a.cols ?? DEFAULT_COLS;
  const rows = a.rows ?? DEFAULT_ROWS;
  const terminalId = mintId("trm", now);
  const n = Number((ctx.db.all("SELECT COUNT(*) AS n FROM terminal_sessions WHERE owner = ? AND closed_at IS NULL", owner) as Row[])[0]?.["n"] ?? 0);
  const name = (a.name ?? "").trim().slice(0, 80) || `Terminal ${n + 1}`;
  // the agent's id names a machine only for its own computer; an agent's session on a person's computer is that computer's
  const target: Target = { host: a.host, ...(a.agentId === undefined || a.host !== "agent_computer" ? {} : { agentId: a.agentId }), ...(a.computerId === undefined ? {} : { computerId: a.computerId }), ...(a.deviceId === undefined ? {} : { deviceId: a.deviceId }) };
  let started: { cwd: string; title?: string };
  try {
    started = await hostOf(ctx).open({ terminalId, target, name, ...(a.cwd === undefined ? {} : { cwd: a.cwd }), cols, rows, folders: rulesOf(ctx.db, owner).folders });
  } catch (e) { return mapHostError(e); }
  const row: SessionRow = {
    terminalId, name, named: a.named ?? (a.name !== undefined && a.name.trim() !== ""), host: a.host, hostTitle: started.title ?? TITLE[a.host],
    ...(a.agentId === undefined ? {} : { agentId: a.agentId }), ...(a.computerId === undefined ? {} : { computerId: a.computerId }), ...(a.deviceId === undefined ? {} : { deviceId: a.deviceId }),
    ...(a.by === undefined ? {} : { by: a.by, actor: ctx.principal.id }),
    cwd: started.cwd, state: "idle", exitCode: null, cols, rows, owner, ...(ctx.run === undefined ? {} : { runId: ctx.run }), createdAt: now, lastActiveAt: now,
  };
  insertSession(ctx.db, row);
  if (a.by !== undefined) insertTab(ctx.db, terminalId, a.by, ctx.principal.id, ctx.thread);
  ctx.emit("terminal.opened", terminalId, { terminalId, host: a.host, ...(a.agentId === undefined ? {} : { agentId: a.agentId }), by: owner });
  return row;
}

const unavailable = (ctx: TermCtx) => (e: unknown): never => {
  if (e && typeof e === "object" && "error" in e) throw e;   // already a shaped error (no host bound)
  // a workspace that would not start says why in its own plain words (no image on the server, no room, Docker not answering); the lines after the first are for Copy details
  if (e instanceof Error && (e as { workspace?: unknown }).workspace === true) {
    ctx.log.warn("terminal: workspace did not start", { reason: e.message.slice(0, 160) });
    const [first = "The workspace did not start.", ...rest] = e.message.split("\n");
    return raise(ctx, "provider.unavailable", first.slice(0, 300), rest.length > 0 ? { detail: rest.join("\n").slice(0, 600) } : undefined);
  }
  ctx.log.warn("terminal: open failed", { reason: e instanceof Error ? e.message.slice(0, 120) : "unknown" });
  return raise(ctx, "provider.unavailable", "That computer did not start a terminal. Check that it is on and try again.");
};

export async function open(ctx: TermCtx, input: Omit<OpenInput, "host"> & { host?: HostKind }) {
  // an agent that names no host opens a tab in its workspace: its own, or its parent's when it is a helper
  let host = input.host;
  let agentId = input.agentId;
  let scope: WorkScope | undefined;
  if (host === undefined) {
    if (ctx.principal.kind !== "agent" || !workspacesReady() || !isTeam(ctx.space)) raise(ctx, "validation.bad_input", "Say which computer to open the terminal on.");
    host = "agent_computer";
  }
  if (host === "agent_computer" && ctx.principal.kind === "agent") {
    scope = await workScope(ctx, agentId ?? ctx.principal.id);
    agentId = agentId === undefined || agentId === ctx.principal.id ? scope.agentId : agentId;
  }
  const by = await tabFor(ctx, scope);
  const name = input.name ?? (scope?.helper ? `helper: ${scope.helper.name}` : undefined);
  return { terminal: terminalRow(await openSession(ctx, { ...input, host, ...(agentId === undefined ? {} : { agentId }), ...(name === undefined ? {} : { name }), by }, unavailable(ctx))) };
}

export async function openServer(ctx: TermCtx, input: { name?: string; cwd?: string; cols?: number; rows?: number }) {
  return { terminal: terminalRow(await openSession(ctx, { ...input, host: "space_server" }, (e) => unexpected(ctx, "open", e))) };
}

// ---- reading ------------------------------------------------------------------------------------------------------------------------------------------------

export function list(ctx: TermCtx, input: { section?: "personal" | "shared" | "space"; folderId?: string; host?: HostKind; state?: TermState[]; cursor?: string; limit?: number }) {
  ensure(ctx.db);
  const me = actorOf(ctx);
  const all = (ctx.db.all(`${SESSION_SELECT} WHERE s.closed_at IS NULL ORDER BY s.last_active_at DESC, s.terminal_id DESC`) as Row[]).map(sessionOf);
  const asAgent = ctx.principal.kind === "agent" ? ctx.principal.id : undefined;
  const mine = all.filter((x) => {
    // an agent lists the tabs of its own workspace, and a helper those it opened itself; never the person's other terminals
    if (asAgent !== undefined && !(x.host === "agent_computer" && (x.agentId === asAgent || x.actor === asAgent))) return false;
    if (input.host !== undefined && x.host !== input.host) return false;
    if (input.state !== undefined && !input.state.includes(x.state)) return false;
    if (input.folderId !== undefined && x.folderId !== input.folderId) return false;
    if (input.section === "personal" && x.owner !== me) return false;
    if (input.section === "shared" && (x.owner === me || x.host === "space_server")) return false;
    if (input.section === "space" && x.host !== "space_server") return false;
    return x.owner === me || ctx.authorize({ perm: null, level: "view" }, { type: "terminal", id: x.terminalId }).effect === "allow";
  });
  const limit = Math.min(500, Math.max(1, input.limit ?? 100));
  const offset = input.cursor !== undefined && /^\d+$/.test(input.cursor) ? Number(input.cursor) : 0;
  const page = mine.slice(offset, offset + limit);
  const next = offset + page.length < mine.length ? String(offset + page.length) : undefined;
  return { terminals: page.map(terminalRow), ...(next === undefined ? {} : { next }), total: mine.length };
}

export function get(ctx: TermCtx, input: { terminalId: string }) {
  ensure(ctx.db);
  const x = sessionBy(ctx.db, input.terminalId);
  if (!x) raise(ctx, "validation.not_found", "There is no such terminal.", { terminalId: input.terminalId });
  return { terminal: terminalRow(x) };
}

export async function status(ctx: TermCtx, input: { terminalIds: string[] }) {
  ensure(ctx.db);
  const known = input.terminalIds.map((id) => sessionBy(ctx.db, id)).filter((x): x is SessionRow => x !== null);
  const host = boundHost();
  let seen = new Map<string, { state: TermState; lastLine?: string; exitCode: number | null }>();
  if (host && known.length > 0) {
    try { seen = new Map((await host.status(known.filter((x) => x.closedAt === undefined).map((x) => x.terminalId))).map((r) => [r.terminalId, r])); }
    catch (e) { ctx.log.warn("terminal: status failed", { reason: e instanceof Error ? e.message.slice(0, 120) : "unknown" }); }
  }
  return {
    rows: known.map((x) => {
      const h = seen.get(x.terminalId);
      const state: TermState = x.closedAt !== undefined ? "exited" : h?.state ?? x.state;
      // tmux does not know an exit code; a host that does says it, and one that does not leaves the last one Vyre recorded.
      const exitCode = h && h.exitCode !== null ? h.exitCode : x.exitCode;
      if (h && (h.state !== x.state || exitCode !== x.exitCode)) ctx.db.run("UPDATE terminal_sessions SET state = ?, exit_code = ? WHERE terminal_id = ?", h.state, exitCode, x.terminalId);
      const last = h?.lastLine === undefined ? undefined : clean(x.terminalId, h.lastLine);
      return { terminalId: x.terminalId, state, ...(last === undefined ? {} : { lastLine: last }), exitCode };
    }),
  };
}

export async function read(ctx: TermCtx, input: { terminalId: string; lines?: number; since?: number }) {
  ensure(ctx.db);
  await needAccess(ctx, live(ctx, input.terminalId));
  try {
    const r = await hostOf(ctx).read(input.terminalId, { lines: input.lines ?? REPLAY_LINES, ...(input.since === undefined ? {} : { since: input.since }) });
    return { text: clean(input.terminalId, r.text), next: r.next };
  } catch (e) { return unexpected(ctx, "read the screen", e); }
}

export async function attach(ctx: TermCtx, input: { terminalId: string }) {
  ensure(ctx.db);
  await needAccess(ctx, live(ctx, input.terminalId));
  let replay: string;
  try { replay = clean(input.terminalId, (await hostOf(ctx).read(input.terminalId, { lines: REPLAY_LINES })).text); }
  catch (e) { return unexpected(ctx, "attach", e); }
  const now = ctx.now();
  const ticket = ticketSecret();
  const expiresAt = now + TICKET_MS;
  ctx.db.run("INSERT INTO terminal_tickets (ticket_hash, terminal_id, person_id, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)", await sha256(ticket), input.terminalId, actorOf(ctx), expiresAt);
  touch(ctx.db, input.terminalId, now);
  return { ticket, expiresAt, replay };
}

// ---- acting in a session ------------------------------------------------------------------------------------------------------------------------------

export function rename(ctx: TermCtx, input: { terminalId: string; name: string }) {
  ensure(ctx.db);
  const x = live(ctx, input.terminalId);
  const name = input.name.trim();
  if (name === "" || name.length > 80) raise(ctx, "validation.bad_input", "Give the session a name of up to 80 characters.");
  ctx.db.run("UPDATE terminal_sessions SET name = ?, named = 1 WHERE terminal_id = ?", name, x.terminalId);
  ctx.emit("terminal.renamed", x.terminalId, { terminalId: x.terminalId, name });
  return { terminal: terminalRow({ ...x, name, named: true }) };
}

export async function close(ctx: TermCtx, input: { terminalId: string }) {
  ensure(ctx.db);
  const x = sessionBy(ctx.db, input.terminalId);
  if (!x) raise(ctx, "validation.not_found", "There is no such terminal.", { terminalId: input.terminalId });
  if (x.closedAt !== undefined) return { closed: true };
  await needAccess(ctx, x);
  // The tmux session is killed when the machine can be reached; if it cannot, the row is still closed so the person is not stuck with a session they cannot see.
  const host = boundHost();
  if (host) { try { await host.close(x.terminalId); } catch (e) { ctx.log.warn("terminal: could not kill the session", { reason: e instanceof Error ? e.message.slice(0, 120) : "unknown" }); } }
  ctx.db.run("UPDATE terminal_sessions SET closed_at = ?, state = 'exited' WHERE terminal_id = ?", ctx.now(), x.terminalId);
  forgetSecrets(x.terminalId);
  ctx.emit("terminal.closed", x.terminalId, { terminalId: x.terminalId, by: actorOf(ctx) });
  return { closed: true };
}

export async function input(ctx: TermCtx, a: { terminalId: string; data: string }) {
  ensure(ctx.db);
  await needAccess(ctx, live(ctx, a.terminalId));
  if (a.data === "") raise(ctx, "validation.bad_input", "There is nothing to send.");
  try { await hostOf(ctx).input(a.terminalId, a.data); } catch (e) { return unexpected(ctx, "take that input", e); }
  touch(ctx.db, a.terminalId, ctx.now());
  return { ok: true };
}

export async function interrupt(ctx: TermCtx, a: { terminalId: string }) {
  ensure(ctx.db);
  await needAccess(ctx, live(ctx, a.terminalId));
  try { await hostOf(ctx).interrupt(a.terminalId); } catch (e) { return unexpected(ctx, "interrupt", e); }
  touch(ctx.db, a.terminalId, ctx.now());
  return { ok: true };
}

export async function resize(ctx: TermCtx, a: { terminalId: string; cols: number; rows: number }) {
  ensure(ctx.db);
  await needAccess(ctx, live(ctx, a.terminalId));
  try { await hostOf(ctx).resize(a.terminalId, a.cols, a.rows); } catch (e) { return unexpected(ctx, "resize", e); }
  ctx.db.run("UPDATE terminal_sessions SET cols = ?, rows = ? WHERE terminal_id = ?", a.cols, a.rows, a.terminalId);
  return { ok: true };
}

// ---- run ------------------------------------------------------------------------------------------------------------------------------------------------

const WHERE: Readonly<Record<HostKind, Where>> = { agent_computer: "computer", space_server: "host", device: "device" };

interface RunInput {
  command: string; terminalId?: string; session?: string; host?: "agent_computer" | "device"; agentId?: string; cwd?: string; timeoutSec?: number; env?: Record<string, string>;
}

interface RunTarget { host: HostKind; deviceId?: string }

const NO_COMPUTER = "There is no computer for this chat to run commands on here. Use your own shell in your work folder, or ask the person to run it with terminal_request.";

const OWN_COMPUTER = "This chat runs on the person's own computer, where Vyre has no terminal open yet. Use your own shell in your work folder there, or ask the person to run it with terminal_request.";

async function placeFor(ctx: TermCtx, person: string, agentId: string | undefined): Promise<TurnPlace | null> {
  const place = boundPlace();
  if (!place || agentId === undefined) return null;
  try { return await place({ space: ctx.space, ...(ctx.thread === undefined ? {} : { threadId: ctx.thread }), agentId, person }); }
  catch (e) { ctx.log.warn("terminal: could not read where the turn runs", { reason: e instanceof Error ? e.message.slice(0, 120) : "unknown" }); return null; }
}

/**
 * Where a command goes when the call names no terminal. An agent's commands go to its workspace, on the Space, whichever computer its turn runs on (owner, 6 Nov: every agent has a terminal, and a
 * person's attached Terminal tab sees the same tmux sessions). A host with no workspaces keeps the older rule (owner, 31 Oct): where the turn runs. In a Personal Space that is the person's computer the chat runs on, or the agent's own computer when the
 * turn runs there. A Team Space keeps the agent's computer first. The model is never asked for a device id, and a Space with no agent computer never falls back to one.
 */
async function targetForRun(ctx: TermCtx, a: RunInput, person: string, agentId: string | undefined): Promise<RunTarget> {
  if (a.host === "agent_computer") return { host: "agent_computer" };
  if (a.host !== "device" && agentId !== undefined && workspacesReady() && isTeam(ctx.space)) return { host: "agent_computer" };
  const p = await placeFor(ctx, person, agentId);
  // a chat that runs on the person's own computer has a computer to run commands on: the agent's own shell there. Vyre has no terminal open on it, and the answer says that, not that there is no computer
  const device = (): RunTarget => (p?.deviceId === undefined ? raise(ctx, "provider.unavailable", OWN_COMPUTER, { reason: "own_computer" }) : { host: "device", deviceId: p.deviceId });
  // a person's own command, or an agent that said the person's computer: the computer the chat runs on
  if (a.host === "device" || agentId === undefined) return p?.deviceId === undefined ? { host: "device" } : { host: "device", deviceId: p.deviceId };
  if (p === null) {
    if (isTeam(ctx.space)) return { host: "agent_computer" };   // nothing says where the turn runs: a Team Space keeps its agent computer
    return raise(ctx, "provider.unavailable", NO_COMPUTER, { reason: "no_computer" });
  }
  if (p.team) {
    if (p.agentComputer) return { host: "agent_computer" };
    if (p.runsOn === "device") return device();
    return raise(ctx, "provider.unavailable", "You have no computer of your own in this Space. Use your own shell in your work folder, or ask the person to run it with terminal_request.", { reason: "no_computer" });
  }
  if (p.agentComputer && (p.runsOn === "agent_computer" || p.runsOn === "server" || p.runsOn === "space")) return { host: "agent_computer" };
  if (p.runsOn === "server") return raise(ctx, "provider.unavailable", "This chat runs on one of the person's servers, where Vyre terminals are not open yet. Your own shell runs there: use it in your work folder.", { reason: "server" });
  return device();
}

/** The session an agent's commands go to when it names none: one per agent, person, host and computer, kept so "Open terminal" shows the same screen. */
async function sessionForRun(ctx: TermCtx, a: RunInput): Promise<SessionRow> {
  if (a.terminalId !== undefined) {
    // the capability is bound to the Space so that it can open the agent's own session; a session it names is checked here at Use, as the caller (an agent with the person it acts for)
    const x = live(ctx, a.terminalId);
    if (x.owner !== actorOf(ctx) && ctx.authorize({ perm: "terminal.use", level: "use" }, { type: "terminal", id: x.terminalId }).effect !== "allow") {
      raise(ctx, "validation.not_found", "There is no such terminal.", { terminalId: a.terminalId });
    }
    return needAccess(ctx, x);
  }
  const owner = actorOf(ctx);
  let agentId = a.agentId ?? (ctx.principal.kind === "agent" ? ctx.principal.id : undefined);
  const { host, deviceId } = await targetForRun(ctx, a, owner, agentId);
  // a helper or crew member works in its parent's workspace, in a tab of its own labelled with its name
  let scope: WorkScope | undefined;
  if (host === "agent_computer" && ctx.principal.kind === "agent" && agentId === ctx.principal.id) { scope = await workScope(ctx, agentId); agentId = scope.agentId; }
  const tab = (a.session ?? "").trim().slice(0, 80) || (scope?.helper ? `helper: ${scope.helper.name}` : AGENT_SESSION);
  const found = ctx.db.all(
    `${SESSION_SELECT} WHERE s.owner = ? AND s.host = ? AND s.name = ? AND s.closed_at IS NULL AND (s.agent_id IS ? OR s.agent_id = ?) AND (s.device_id IS ? OR s.device_id = ?) ORDER BY s.created_at DESC LIMIT 1`,
    owner, host, tab, agentId ?? null, agentId ?? "", deviceId ?? null, deviceId ?? "",
  ) as Row[];
  const hit = found[0];
  if (hit) return needAccess(ctx, sessionOf(hit));
  return openSession(ctx, { host, ...(agentId === undefined ? {} : { agentId }), ...(deviceId === undefined ? {} : { deviceId }), name: tab, named: a.session !== undefined && a.session.trim() !== "", by: await tabFor(ctx, scope), ...(a.cwd === undefined ? {} : { cwd: a.cwd }) }, unavailable(ctx));
}

export async function run(ctx: TermCtx, a: RunInput) {
  ensure(ctx.db);
  const command = a.command.trim();
  if (command === "") raise(ctx, "validation.bad_input", "There is no command to run.");
  if (command.length > MAX_COMMAND_CHARS) raise(ctx, "validation.bad_input", "That command is too long.");
  const owner = actorOf(ctx);
  const rules = rulesOf(ctx.db, owner);
  const v = judge(rules, command);
  // Deny is a wall in every mode. Ask and Allow entries are read by the local prompt (the tool session's localPolicy, through judge()) before the call reaches here, so a command
  // that got this far was either allowed or answered yes by the person; running it again through a second prompt here would ask twice.
  if (v.verdict === "deny") raise(ctx, "permission.role_lacks_permission", "A rule of yours stops that command.", { reason: "deny_rule", rule: v.entry });

  const s = await sessionForRun(ctx, a);
  const host = hostOf(ctx);
  const timeoutMs = (a.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000;

  const captured: Secret[] = [];
  const base: ValueSource | null = boundValues();
  const source: ValueSource = {
    async lookup(handle, who): Promise<Lookup> {
      if (!base) return { kind: "unknown" };
      const r = await base.lookup(handle, who);
      if (r.kind === "value") captured.push({ handle, itemId: r.itemId, value: r.value });
      return r;
    },
  };
  // The command is recorded when the machine is actually asked to run it: a command refused before that (a handle the person may not use) is not a step.
  let started: { at: number; rowId: number } | null = null;
  let result: { exitCode: number | null; truncated: boolean; durationMs: number } | null = null;
  let timedOut = false;
  const exec = async (filled: unknown): Promise<string> => {
    const f = filled as { command: string; env?: Record<string, string> };
    const at = ctx.now();
    // The record keeps the command as the model wrote it (handles, not values).
    ctx.db.run("INSERT INTO terminal_commands (terminal_id, command, exit_code, started_at, duration_ms, by_principal) VALUES (?, ?, NULL, ?, NULL, ?)", s.terminalId, command, at, ctx.principal.id);
    started = { at, rowId: Number((ctx.db.all("SELECT MAX(seq) AS m FROM terminal_commands WHERE terminal_id = ?", s.terminalId) as Row[])[0]?.["m"]) };
    ctx.db.run("UPDATE terminal_sessions SET state = 'running', last_active_at = ? WHERE terminal_id = ?", at, s.terminalId);
    try {
      const r = await host.run(s.terminalId, { command: f.command, ...(a.cwd === undefined ? {} : { cwd: a.cwd }), env: f.env ?? {}, timeoutMs });
      result = { exitCode: r.exitCode, truncated: r.truncated, durationMs: r.durationMs };
      return r.output;
    } catch (e) {
      if (e && typeof e === "object" && (e as { code?: unknown }).code === "timeout") timedOut = true;
      throw e;
    }
  };
  const args = { command, ...(a.env ? { env: a.env } : {}) };
  const kit = boundKit();
  let out: VaultRun;
  if (kit && base) {
    out = await kit.run(
      { source, reportMiss: (m) => { ctx.log.warn("vault.scrub_miss", { itemId: m.itemId, place: m.place }); } },
      { tool: "terminal_run", args, traceId: ctx.trace.traceId, agentId: ctx.principal.id, asker: owner, where: WHERE[s.host] },
      exec,
    );
  } else {
    // Nothing can be filled here, so a #Handle stays the text it is and nothing needs scrubbing.
    try { out = { ok: true, display: args, output: await exec(args), used: [], scrubMiss: false }; }
    catch (e) { out = { ok: false, display: args, used: [], error: { code: "provider.unavailable", message: e instanceof Error ? e.message : "The terminal failed." } }; }
  }
  rememberSecrets(s.terminalId, captured);

  const begun = started as { at: number; rowId: number } | null;
  const finish = (exitCode: number | null, durationMs: number): void => {
    if (begun === null) return;
    ctx.db.run("UPDATE terminal_commands SET exit_code = ?, duration_ms = ? WHERE seq = ?", exitCode, durationMs, begun.rowId);
    ctx.db.run("UPDATE terminal_sessions SET state = 'idle', exit_code = ?, last_active_at = ? WHERE terminal_id = ?", exitCode, ctx.now(), s.terminalId);
    ctx.emit("terminal.command_finished", s.terminalId, { terminalId: s.terminalId, exitCode, durationMs, by: owner, ...(ctx.run === undefined ? {} : { runId: ctx.run }) });
  };

  if (!out.ok) {
    finish(null, begun === null ? 0 : ctx.now() - begun.at);
    if (timedOut) raise(ctx, "timeout.deadline", "The command did not finish in time. It was interrupted.", { timeoutSec: a.timeoutSec ?? DEFAULT_TIMEOUT_SEC });
    const code = out.error.code === "permission.provider_label" ? "permission.no_grant" : out.error.code;
    return raise(ctx, code, out.error.message, out.error.handle === undefined ? undefined : { handle: out.error.handle });
  }
  const r = result as { exitCode: number | null; truncated: boolean; durationMs: number } | null;
  if (r === null) { finish(null, begun === null ? 0 : ctx.now() - begun.at); return raise(ctx, "internal.unexpected", "The terminal did not report a result."); }
  finish(r.exitCode, r.durationMs);
  const output = typeof out.output === "string" ? out.output : "";
  return { terminalId: s.terminalId, exitCode: r.exitCode, output, truncated: r.truncated, durationMs: r.durationMs };
}

// ---- rules and health ---------------------------------------------------------------------------------------------------------------------------------------

export function rulesGet(ctx: TermCtx, _input: Record<string, never>) {
  ensure(ctx.db);
  return { rules: rulesOf(ctx.db, actorOf(ctx)) };
}

const tidy = (ctx: TermCtx, what: string, list: readonly string[]): string[] => {
  const out: string[] = [];
  for (const raw of list) {
    const e = raw.trim();
    if (e === "") continue;
    if (e.length > MAX_RULE_CHARS) raise(ctx, "validation.bad_input", `A ${what} rule is longer than ${MAX_RULE_CHARS} characters.`);
    if (!out.includes(e)) out.push(e);
  }
  return out;
};

export function rulesSet(ctx: TermCtx, input: { rules: Rules }) {
  ensure(ctx.db);
  const rules: Rules = {
    allow: tidy(ctx, "allow", input.rules.allow), ask: tidy(ctx, "ask", input.rules.ask), deny: tidy(ctx, "deny", input.rules.deny), folders: tidy(ctx, "folder", input.rules.folders),
  };
  if (rules.allow.length + rules.ask.length + rules.deny.length + rules.folders.length > MAX_RULES) raise(ctx, "validation.bad_input", `A person can have up to ${MAX_RULES} rules.`);
  // The same entry on two lists would make the outcome depend on which is read first; deny and ask win, so it leaves the weaker list.
  rules.allow = rules.allow.filter((e) => !rules.deny.includes(e) && !rules.ask.includes(e));
  rules.ask = rules.ask.filter((e) => !rules.deny.includes(e));
  const me = actorOf(ctx);
  ctx.db.run(
    "INSERT OR REPLACE INTO terminal_rules (person_id, allow, ask, deny, folders, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    me, JSON.stringify(rules.allow), JSON.stringify(rules.ask), JSON.stringify(rules.deny), JSON.stringify(rules.folders), ctx.now(),
  );
  ctx.emit("terminal.rules_changed", me, { personId: me });
  return { rules };
}

export async function health(ctx: TermCtx, _input: Record<string, never>) {
  ensure(ctx.db);
  const t0 = Date.now();
  const sessions = Number((ctx.db.all("SELECT COUNT(*) AS n FROM terminal_sessions WHERE closed_at IS NULL") as Row[])[0]?.["n"] ?? 0);
  const host = boundHost();
  if (!host) return { state: "healthy" as const, detail: "Terminals are not running on this host. Install tmux to use them.", latencyMs: Date.now() - t0, sessions };
  try {
    const h = await host.health();
    return { state: h.ok ? ("healthy" as const) : ("degraded" as const), ...(h.detail === undefined ? {} : { detail: h.detail }), latencyMs: Date.now() - t0, sessions };
  } catch (e) {
    return { state: "down" as const, detail: e instanceof Error ? e.message.slice(0, 120) : "tmux did not answer", latencyMs: Date.now() - t0, sessions };
  }
}

/** What a command can do and what the person's rules say about it, before it runs (the dot beside a command). */
export function risk(ctx: TermCtx, input: { command: string }) {
  ensure(ctx.db);
  const command = input.command.trim();
  if (command === "") raise(ctx, "validation.bad_input", "There is no command.");
  if (command.length > MAX_COMMAND_CHARS) raise(ctx, "validation.bad_input", "That command is too long.");
  const j = judged(rulesOf(ctx.db, actorOf(ctx)), command);
  return { risk: j.risk, verdict: j.verdict, why: j.why, ...(j.entry === undefined ? {} : { entry: j.entry }) };
}

/**
 * An agent asks the person to run a command: the chat gets a question card (the command, why, its risk) with three answers. A command the person's own rules deny is not even offered.
 * What the person ran comes back as the answer, so the parked turn carries on with the output.
 */
export async function request(ctx: TermCtx, input: { threadId: string; command: string; why: string; host?: HostKind; idempotencyKey?: string }) {
  ensure(ctx.db);
  const command = input.command.trim();
  const why = input.why.trim();
  if (command === "" || command.length > MAX_COMMAND_CHARS) raise(ctx, "validation.bad_input", "Give the command to run, up to 20,000 characters.");
  if (why === "") raise(ctx, "validation.bad_input", "Say why the person should run it.");
  const j = judged(rulesOf(ctx.db, actorOf(ctx)), command);
  if (j.verdict === "deny") raise(ctx, "permission.role_lacks_permission", "A rule of the person's stops that command.", { reason: "deny_rule", rule: j.entry });
  if (!ctx.call) raise(ctx, "internal.unavailable", "The chat is not reachable from here.");
  const asked = (await ctx.call("chat.question.ask", {
    threadId: input.threadId, prompt: why.slice(0, 500), mode: "single", allowOther: true,
    options: [{ key: "run", label: "Run in my terminal" }, { key: "copy", label: "Copy" }, { key: "decline", label: "Deny" }],
    card: { kind: "terminal", command, ...(input.host === undefined ? {} : { host: input.host }), risk: j.risk },
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: `${input.idempotencyKey}:q` }),
  })) as { blockId: string; messageId: string };
  return { blockId: asked.blockId, messageId: asked.messageId, risk: j.risk };
}

/** The Gate's condition on terminal.run (`terminal.is_danger(input.command)`): red commands are held for a yes. Anything unreadable counts as red. */
export async function isDangerCall(_ctx: unknown, input: unknown): Promise<boolean> {
  const c = (input as { command?: unknown } | null)?.command;
  return typeof c !== "string" || isDangerous(c);
}

export { commandsOf, judge, rulesOf };
