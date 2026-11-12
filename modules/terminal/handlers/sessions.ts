// terminal: tmux sessions in an agent's workspace, on the Space server or on a person's computer (spec 2.7, 2.23; ARCH 6.7, 6.11, 7.2).
//   open / open_server / close / rename / list / get / status     the sessions, and what Home shows for starred ones
//   input / interrupt / resize / read / attach                     a person typing in the tab; the same session an agent used, so "Open terminal" shows its commands
//   run                                                            the terminal_run tool: one command, run in a session, output scrubbed of every Vault value filled into it
//   rules.get / rules.set / health
// The machine does the work through the TerminalHost port (projections.ts); this module keeps what Vyre knows about a session and enforces who may do what in it.
import {
  MAX_RULES, MAX_RULE_CHARS, TICKET_MS, actorOf, boundHost, boundKit, boundPlace, boundValues, clean, commandsOf, ensure, forgetAgentSecrets, forgetSecrets, hostOf, insertSession, isTeam, judge, mintId, raise, rememberSecrets,
  rulesOf, sessionBy, sessionOf, sha256, ticketSecret, touch, workspacesFor, boundWorkspaceStatus, SESSION_SELECT, insertTab, scopeOf,
} from "../projections.ts";
import { classify, QuotedHereDoc, referHandles, UnsurePlace } from "../fill.ts";
import type { HandleRef } from "../fill.ts";
import { HANDLE, SEALED } from "../../../lib/vault-use/index.ts";
import { judged, isDangerous } from "../risk.ts";
import { isTrustedService } from "../../../lib/trust.ts";
import type { HostKind, Lookup, Rules, SessionRow, TabBy, Target, TermCtx, TerminalHost, TermState, TurnPlace, ValueSource, VaultRun, Where } from "../projections.ts";

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
  return (await entry(ctx, agentId)) === "yes";
}

/** What agents.get said of an agent, asked once per call however many sessions it has (a status poll of many tabs). */
type Facts = Map<string, Promise<{ agent?: AgentFacts; failed?: "not_found" | "error" }>>;
const lookup = (ctx: TermCtx, agentId: string, facts?: Facts): Promise<{ agent?: AgentFacts; failed?: "not_found" | "error" }> => {
  const have = facts?.get(agentId);
  if (have) return have;
  const p = (async () => {
    try {
      const agent = ((await ctx.call?.("agents.get", { agentId })) as { agent?: AgentFacts } | undefined)?.agent;
      return agent === undefined ? { failed: "not_found" as const } : { agent };
    } catch (e) {
      return { failed: (e as { error?: { code?: unknown } } | null)?.error?.code === "validation.not_found" ? ("not_found" as const) : ("error" as const) };
    }
  })();
  facts?.set(agentId, p);
  return p;
};

/** May the caller enter this agent's workspace: yes, no, or unknown (agents.get failed for another reason than not found: try again, never a refusal that is not true). */
async function entry(ctx: TermCtx, agentId: string, facts?: Facts): Promise<"yes" | "no" | "unknown"> {
  if (ctx.principal.kind === "agent") return ctx.principal.id === agentId || (await workScope(ctx, ctx.principal.id)).agentId === agentId ? "yes" : "no";
  // the host and the services it runs; never a service a tenant made (an Automation, a public form, a site), which holds only the grants it was given
  if (isTrustedService(ctx.principal)) return "yes";
  const me = actorOf(ctx);
  const got = ctx.call === undefined ? {} : await lookup(ctx, agentId, facts);
  // an agent this caller cannot even read is not one it may enter: another person's Assistant or outside agent reads as not found to everyone else, admins included, and Manage held over agents
  // in general must not open it (12 Nov, audit item 16). Any other failure is not an answer: unknown. Only where nothing can be asked (no ctx.call) does the role decide alone.
  if (got.failed === "not_found") return "no";
  if (got.failed === "error") return "unknown";
  const agent = got.agent;
  if (agent?.ownerId === me) return "yes";
  if (agent !== undefined && (agent.kind === "assistant" || agent.runtime === "outside")) return "no";
  return ctx.authorize({ perm: null, level: "manage" }, { type: "agent", id: agentId }).effect === "allow" ? "yes" : "no";
}

async function needWorkspace(ctx: TermCtx, agentId: string, facts?: Facts): Promise<void> {
  const e = await entry(ctx, agentId, facts);
  if (e === "unknown") raise(ctx, "internal.unavailable", "Vyre could not check who may open this workspace just now. Try again in a moment.", { reason: "agent_unreadable" });
  if (e === "no") raise(ctx, "permission.role_lacks_permission", "That workspace is not yours to open. A person opens their own Assistant's; an owner or admin opens a team agent's.", { reason: "workspace_private" });
}

/** A session in a workspace is entered only by who may enter that workspace. */
async function needAccess(ctx: TermCtx, x: SessionRow, facts?: Facts): Promise<SessionRow> {
  if (x.host === "agent_computer" && x.agentId !== undefined) {
    await needWorkspace(ctx, x.agentId, facts);
    // a helper from another agent works in the parent's workspace in its own tab: it does not type in the parent's or a sibling's
    if (ctx.principal.kind === "agent" && ctx.principal.id !== x.agentId && x.actor !== undefined && x.actor !== ctx.principal.id) raise(ctx, "permission.role_lacks_permission", "That tab belongs to another agent in this workspace.", { reason: "tab_not_yours" });
  }
  return x;
}

/** What terminal.get and terminal.list let a caller see of a session (its own, or one it may view), and needAccess for one in a workspace, as a yes or no: for a call about many sessions at once. */
async function mayRead(ctx: TermCtx, x: SessionRow, facts?: Facts): Promise<"yes" | "no" | "unknown"> {
  if (x.owner !== actorOf(ctx) && ctx.authorize({ perm: null, level: "view" }, { type: "terminal", id: x.terminalId }).effect !== "allow") return "no";
  try { await needAccess(ctx, x, facts); return "yes"; } catch (e) { return (e as { error?: { code?: unknown } } | null)?.error?.code === "internal.unavailable" ? "unknown" : "no"; }
}

const unexpected = (ctx: TermCtx, what: string, e: unknown): never => {
  ctx.log.warn(`terminal: ${what} failed`, { reason: e instanceof Error ? e.message.slice(0, 120) : "unknown" });
  return raise(ctx, "internal.unexpected", `The terminal could not ${what}.`);
};

/** The machine's host for a session Vyre knows, told where the session lives first: after a restart, a sleep or a lost tmux the host finds it again and remakes it on use. */
async function hostFor(ctx: TermCtx, x: SessionRow): Promise<TerminalHost> {
  const h = hostOf(ctx);
  await adoptOn(h, x).catch((e: unknown) => { ctx.log.warn("terminal: could not find the session again", { reason: e instanceof Error ? e.message.slice(0, 120) : "unknown" }); });
  return h;
}
const adoptOn = async (h: TerminalHost, x: SessionRow): Promise<void> => {
  if (!h.adopt) return;
  const target: Target = { host: x.host, ...(x.host === "agent_computer" && x.agentId !== undefined ? { agentId: x.agentId } : {}), ...(x.computerId === undefined ? {} : { computerId: x.computerId }), ...(x.deviceId === undefined ? {} : { deviceId: x.deviceId }) };
  await h.adopt({ terminalId: x.terminalId, target, cols: x.cols, rows: x.rows, ...(x.cwd === "" ? {} : { cwd: x.cwd }) });
};

// ---- one command at a time in a session ------------------------------------------------------------------------------------------------------------------------
// Two turns of the same agent (two chats at once, two helpers on one tab) would type into one shell: the second line becomes the first program's input, or their output mixes. Runs in one session wait
// for each other, in order, in this process (the daemon is the one process that types into its sessions). The wait counts against the command's own time limit; a command that waited it all out is not
// typed and nothing is interrupted, since what runs is another command.
const queues = new Map<string, Promise<unknown>>();
export const CLOSED_LINE = "That tab was closed before this command's turn came, so it did not run.";
export const VALUES_BUSY_LINE = "This tab is still running something, so no Vault value is handed to it. Wait for it to finish, or run the command in another tab.";
export const BUSY_LINE = "That terminal was busy with another command the whole time, so this one did not run. Name a session of your own (session) to run beside it.";
async function oneAtATime<T>(terminalId: string, timeoutMs: number, f: (leftMs: number) => Promise<T>): Promise<T> {
  const ahead = queues.get(terminalId);
  const before = ahead ?? Promise.resolve();
  let free!: () => void;
  const mine = new Promise<void>((r) => { free = r; });
  const tail = before.then(() => mine);
  queues.set(terminalId, tail);
  const t0 = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // nothing ahead: the command has its whole time
    if (ahead === undefined) return await f(timeoutMs);
    const turn = await Promise.race([before.then(() => true, () => true), new Promise<false>((r) => { timer = setTimeout(() => r(false), timeoutMs); })]);
    if (!turn) throw Object.assign(new Error(BUSY_LINE), { code: "queue_busy" });
    return await f(Math.max(1000, timeoutMs - (Date.now() - t0)));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    free();
    if (queues.get(terminalId) === tail) void tail.then(() => { if (queues.get(terminalId) === tail) queues.delete(terminalId); });
  }
}

// ---- opening ------------------------------------------------------------------------------------------------------------------------------------------------

interface OpenInput { by?: TabBy; threadId?: string; host: HostKind; agentId?: string; computerId?: string; deviceId?: string; name?: string; cwd?: string; cols?: number; rows?: number; named?: boolean }

async function openSession(ctx: TermCtx, a: OpenInput, mapHostError: (e: unknown) => never): Promise<SessionRow> {
  ensure(ctx.db);
  if (a.host === "agent_computer") {
    // a workspace is every Space's (a Personal Space has one when the person's computer has a container runtime); the desktop computer an agent can be given is a Team Space's
    // in a Personal Space with nothing to run it on now, say why and what would fix it (12 Nov, f-wire binds the real Space kind): a Team Space is not the answer
    if (!isTeam(ctx.space) && !(a.agentId !== undefined && (await workspacesFor(a.agentId)))) raise(ctx, "provider.unavailable", NO_WORKSPACE_NOW_PERSONAL, { reason: "no_workspace_computer" });
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
    if (ctx.principal.kind !== "agent" || !(await workspacesFor(ctx.principal.id))) raise(ctx, "validation.bad_input", "Say which computer to open the terminal on.");
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
  const rows0 = input.terminalIds.map((id) => sessionBy(ctx.db, id)).filter((x): x is SessionRow => x !== null);
  // a session in a workspace is read only by who may enter that workspace, like every other call on it; one the caller may not enter is answered as if there were no such terminal
  // agents.get is asked once per agent for the whole poll; an agent that could not be read just now keeps its row as last recorded rather than vanishing for one poll
  const facts: Facts = new Map();
  const known: SessionRow[] = [];
  const kept: SessionRow[] = [];
  for (const x of rows0) { const may = await mayRead(ctx, x, facts); if (may === "yes") known.push(x); else if (may === "unknown") kept.push(x); }
  const host = boundHost();
  let seen = new Map<string, { state: TermState; lastLine?: string; exitCode: number | null }>();
  if (host && known.length > 0) {
    for (const x of known) if (x.closedAt === undefined) await adoptOn(host, x).catch(() => undefined);
    try { seen = new Map((await host.status(known.filter((x) => x.closedAt === undefined).map((x) => x.terminalId))).map((r) => [r.terminalId, r])); }
    catch (e) { ctx.log.warn("terminal: status failed", { reason: e instanceof Error ? e.message.slice(0, 120) : "unknown" }); }
  }
  return {
    rows: known.map((x) => {
      const h = seen.get(x.terminalId);
      const state: TermState = x.closedAt !== undefined ? "exited" : h?.state ?? x.state;
      // tmux does not know an exit code; a host that does says it, and one that does not leaves the last one Vyre recorded.
      const exitCode = h && h.exitCode !== null ? h.exitCode : x.exitCode;
      // a run of this process is queued or running in the tab: its row is that run's to set, not a poll's (tmux reads a builtin loop as the idle shell) (review S3)
      if (h && !queues.has(x.terminalId) && (h.state !== x.state || exitCode !== x.exitCode)) ctx.db.run("UPDATE terminal_sessions SET state = ?, exit_code = ? WHERE terminal_id = ?", h.state, exitCode, x.terminalId);
      const last = h?.lastLine === undefined ? undefined : clean(scopeOf(x), h.lastLine);
      return { terminalId: x.terminalId, state, ...(last === undefined ? {} : { lastLine: last }), exitCode };
    }).concat(kept.map((x) => ({ terminalId: x.terminalId, state: x.closedAt !== undefined ? ("exited" as TermState) : x.state, exitCode: x.exitCode })))
      .sort((p, q) => input.terminalIds.indexOf(p.terminalId) - input.terminalIds.indexOf(q.terminalId)),
  };
}

export async function read(ctx: TermCtx, input: { terminalId: string; lines?: number; since?: number }) {
  ensure(ctx.db);
  const x = await needAccess(ctx, live(ctx, input.terminalId));
  try {
    const r = await (await hostFor(ctx, x)).read(input.terminalId, { lines: input.lines ?? REPLAY_LINES, ...(input.since === undefined ? {} : { since: input.since }) });
    return { text: clean(scopeOf(x), r.text), next: r.next };
  } catch (e) { return unexpected(ctx, "read the screen", e); }
}

export async function attach(ctx: TermCtx, input: { terminalId: string }) {
  ensure(ctx.db);
  const x = await needAccess(ctx, live(ctx, input.terminalId));
  let replay: string;
  try { replay = clean(scopeOf(x), (await (await hostFor(ctx, x)).read(input.terminalId, { lines: REPLAY_LINES })).text); }
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
  if (host) { try { await adoptOn(host, x); await host.close(x.terminalId); } catch (e) { ctx.log.warn("terminal: could not kill the session", { reason: e instanceof Error ? e.message.slice(0, 120) : "unknown" }); } }
  ctx.db.run("UPDATE terminal_sessions SET closed_at = ?, state = 'exited' WHERE terminal_id = ?", ctx.now(), x.terminalId);
  forgetSecrets(scopeOf(x));
  ctx.emit("terminal.closed", x.terminalId, { terminalId: x.terminalId, by: actorOf(ctx) });
  return { closed: true };
}

export async function input(ctx: TermCtx, a: { terminalId: string; data: string }) {
  ensure(ctx.db);
  const x = await needAccess(ctx, live(ctx, a.terminalId));
  if (a.data === "") raise(ctx, "validation.bad_input", "There is nothing to send.");
  try { await (await hostFor(ctx, x)).input(a.terminalId, a.data); } catch (e) { return unexpected(ctx, "take that input", e); }
  touch(ctx.db, a.terminalId, ctx.now());
  return { ok: true };
}

export async function interrupt(ctx: TermCtx, a: { terminalId: string }) {
  ensure(ctx.db);
  const x = await needAccess(ctx, live(ctx, a.terminalId));
  try { await (await hostFor(ctx, x)).interrupt(a.terminalId); } catch (e) { return unexpected(ctx, "interrupt", e); }
  touch(ctx.db, a.terminalId, ctx.now());
  return { ok: true };
}

export async function resize(ctx: TermCtx, a: { terminalId: string; cols: number; rows: number }) {
  ensure(ctx.db);
  const x = await needAccess(ctx, live(ctx, a.terminalId));
  try { await (await hostFor(ctx, x)).resize(a.terminalId, a.cols, a.rows); } catch (e) { return unexpected(ctx, "resize", e); }
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
  if (a.host !== "device" && agentId !== undefined && (await workspacesFor(agentId))) return { host: "agent_computer" };
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

// What is true for each kind of Space (12 Nov, the browser's voice, lane f-desktop): a Personal Space runs on the person's own computer; a Team Space on its server, which is not the computer the person is on.
export const NO_WORKSPACE_PERSONAL = "Your Assistant runs commands on this computer for now. A workspace of its own needs Docker on this computer, or a server with Docker added in Console > Computers.";
export const NO_WORKSPACE_NOW_PERSONAL = "This workspace can't run right now: Docker is not running on this computer, and no server with Docker is online for it. Start Docker, or add a server with Docker in Console > Computers.";
export const NO_WORKSPACE_TEAM = "This Space can't run agent workspaces yet. That needs Docker on the Space's server, or another server with Docker added in Console > Computers.";

/**
 * An agent's workspace as the Terminal tab shows it: asleep, running, waiting for room (with the line) or not made yet; where it is; the projects it has folders for; whether this person may attach, and why not
 * in a sentence. A Space with no machine for it says so in one plain line, and the agent's commands go where its turn runs.
 */
export async function workspace(ctx: TermCtx, input: { agentId: string }) {
  ensure(ctx.db);
  const may = await mayEnterWorkspace(ctx, input.agentId);
  const cannot = "That workspace is not yours to open. A person opens their own Assistant's; an owner or admin opens a team agent's.";
  if (!may) return { state: "none" as const, canAttach: false, cannotAttach: cannot };
  const probe = boundWorkspaceStatus();
  const available = probe !== null && (await workspacesFor(input.agentId));
  if (!available) return { state: "unavailable" as const, canAttach: false, line: isTeam(ctx.space) ? NO_WORKSPACE_TEAM : NO_WORKSPACE_PERSONAL, cannotAttach: "There is no workspace to attach to." };
  const st = await (probe as NonNullable<typeof probe>)(input.agentId).catch(() => ({ state: "none" as const }));
  return { ...st, canAttach: st.state === "running" || st.state === "asleep" || st.state === "none" };
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
  // A helper's tab is its own, so two helpers with one name never share a shell: a crew member (another agent) has one tab for itself across its helper chats, found by who it is, so a second
  // agent with the same name gets its own; a helper chat of the agent itself has one per helper chat, found by the chat, so two with the same title get two.
  const crew = scope?.helper !== undefined && scope.agentId !== ctx.principal.id;
  const own = scope?.helper === undefined ? "" : crew ? " AND t.kind = 'helper' AND t.actor = ?" : " AND t.kind = 'helper' AND t.actor = ? AND (t.thread_id IS ? OR t.thread_id = ?)";
  const ownArgs: unknown[] = scope?.helper === undefined ? [] : crew ? [ctx.principal.id] : [ctx.principal.id, ctx.thread ?? null, ctx.thread ?? ""];
  const found = ctx.db.all(
    `${SESSION_SELECT} WHERE s.owner = ? AND s.host = ? AND s.name = ? AND s.closed_at IS NULL AND (s.agent_id IS ? OR s.agent_id = ?) AND (s.device_id IS ? OR s.device_id = ?)${own} ORDER BY s.created_at DESC LIMIT 1`,
    owner, host, tab, agentId ?? null, agentId ?? "", deviceId ?? null, deviceId ?? "", ...ownArgs,
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
  const host = await hostFor(ctx, s);
  const timeoutMs = (a.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000;

  const scope = scopeOf(s);
  const base: ValueSource | null = boundValues();
  // Each handle is asked for once per call, however many places name it (the Vault use is checked and recorded once). A value is remembered for the scope the moment it is known, so a person reading the
  // screen while the command runs never sees it.
  const asked = new Map<string, Promise<Lookup>>();
  const source: ValueSource = {
    lookup(handle, who): Promise<Lookup> {
      if (!base) return Promise.resolve({ kind: "unknown" });
      let p = asked.get(handle);
      if (!p) {
        p = base.lookup(handle, who).then((r) => { if (r.kind === "value") rememberSecrets(scope, [{ handle, itemId: r.itemId, value: r.value }]); return r; });
        asked.set(handle, p);
      }
      return p;
    },
  };
  const where = WHERE[s.host];
  const who = { agentId: ctx.principal.id, asker: owner, where };
  // A handle in the command line never becomes its value in the line (W6): the line names a variable, quoted for where it stands, and the value goes in that variable's environment for this one
  // command. A handle the Vault does not know is left as the text it is (a hashtag, an issue number).
  const env: Record<string, string> = { ...(a.env ?? {}) };
  const refs: HandleRef[] = [];
  let line = command;
  if (base) {
    const names = new Map<string, string>();
    const found = [...command.matchAll(new RegExp(HANDLE.source, "g")), ...command.matchAll(new RegExp(SEALED.source, "g"))].sort((x, y) => (x.index ?? 0) - (y.index ?? 0));
    const spots: Array<{ at: number; length: number; handle: string }> = [];
    for (const m of found) { const at = m.index ?? 0; const last = spots[spots.length - 1]; if (!last || at >= last.at + last.length) spots.push({ at, length: m[0].length, handle: m[0] }); }
    // Each spot is asked about in order, and only where the shell would read it: a handle in a # comment is never looked up (nor audited). Text the Vault does not know at the start of a word is a
    // comment for the shell, and so is the rest of its line, so the place of every later spot is read again after each answer.
    const isHandle = new Map<number, boolean>();
    let modes = classify(command, spots, (at) => isHandle.get(at) !== false);
    for (;;) {
      const next = spots.find((x) => !isHandle.has(x.at) && modes.get(x.at) !== "comment");
      if (!next) break;
      isHandle.set(next.at, (await source.lookup(next.handle, who)).kind !== "unknown");
      modes = classify(command, spots, (at) => isHandle.get(at) !== false);
    }
    for (const x of spots) {
      if (isHandle.get(x.at) !== true || modes.get(x.at) === "comment") continue;
      let name = names.get(x.handle);
      if (name === undefined) {
        let n = names.size + 1;
        while (`VYRE_H_${n}` in env) n++;
        name = `VYRE_H_${n}`;
        names.set(x.handle, name);
        env[name] = x.handle;
      }
      refs.push({ at: x.at, length: x.length, name });
    }
    try { line = referHandles(command, refs); }
    catch (e) { raise(ctx, "validation.bad_input", e instanceof Error ? e.message : "That command cannot take a Vault value.", e instanceof QuotedHereDoc || e instanceof UnsurePlace ? { handle: e.handle } : undefined); }
  }
  // The command is recorded when the machine is actually asked to run it: a command refused before that (a handle the person may not use) is not a step.
  let started: { at: number; rowId: number } | null = null;
  let result: { exitCode: number | null; truncated: boolean; durationMs: number } | null = null;
  let timedOut = false;
  let waitedOut = false;
  const exec = (filled: unknown): Promise<string> => oneAtATime(s.terminalId, timeoutMs, (leftMs) => execNow(filled, leftMs)).catch((e: unknown) => {
    if (e && typeof e === "object" && (e as { code?: unknown }).code === "queue_busy") waitedOut = true;
    throw e;
  });
  const execNow = async (filled: unknown, leftMs: number): Promise<string> => {
    const f = filled as { env?: Record<string, string> };
    // A command that carries values is not typed into a tab Vyre knows is still running one (review 12 Nov, 3a): the host checks the shell owns its terminal, and this catches what that check
    // cannot see (a builtin such as read, or a loop of builtins, typed at the prompt by the agent's last command). Read in this command's turn, so one only queued behind another run is not refused.
    const nowRow = sessionBy(ctx.db, s.terminalId);
    // its tab was closed while it waited its turn: it is not typed anywhere (review 12 Nov, 7)
    if (nowRow === null || nowRow.closedAt !== undefined) throw Object.assign(new Error(CLOSED_LINE), { code: "closed" });
    if (Object.keys(f.env ?? {}).length > 0 && nowRow.state === "running") throw Object.assign(new Error(VALUES_BUSY_LINE), { code: "busy" });
    const at = ctx.now();
    // The record keeps the command as the model wrote it (handles, not values).
    ctx.db.run("INSERT INTO terminal_commands (terminal_id, command, exit_code, started_at, duration_ms, by_principal) VALUES (?, ?, NULL, ?, NULL, ?)", s.terminalId, command, at, ctx.principal.id);
    started = { at, rowId: Number((ctx.db.all("SELECT MAX(seq) AS m FROM terminal_commands WHERE terminal_id = ?", s.terminalId) as Row[])[0]?.["m"]) };
    ctx.db.run("UPDATE terminal_sessions SET state = 'running', last_active_at = ? WHERE terminal_id = ?", at, s.terminalId);
    try {
      const r = await host.run(s.terminalId, { command: line, ...(a.cwd === undefined ? {} : { cwd: a.cwd }), env: f.env ?? {}, timeoutMs: leftMs });
      result = { exitCode: r.exitCode, truncated: r.truncated, durationMs: r.durationMs };
      return r.output;
    } catch (e) {
      if (e && typeof e === "object" && (e as { code?: unknown }).code === "timeout") timedOut = true;
      throw e;
    } finally {
      // the tab is free again before the queue lets the next command in, so a command right behind this one does not read it as running (review S3)
      ctx.db.run("UPDATE terminal_sessions SET state = 'idle', exit_code = ? WHERE terminal_id = ?", result?.exitCode ?? null, s.terminalId);
    }
  };
  // Only the environment is filled: the command line holds references, never a handle the filler would put a value in place of.
  const args = Object.keys(env).length > 0 ? { env } : {};
  const kit = boundKit();
  let out: VaultRun;
  if (base) {
    out = await kit.run(
      { source, reportMiss: (m) => { ctx.log.warn("vault.scrub_miss", { itemId: m.itemId, place: m.place }); } },
      { tool: "terminal_run", args, traceId: ctx.trace.traceId, agentId: ctx.principal.id, asker: owner, where },
      exec,
    );
  } else {
    // Nothing can be filled here, so a #Handle stays the text it is and nothing needs scrubbing.
    try { out = { ok: true, display: args, output: await exec(args), used: [], scrubMiss: false }; }
    catch (e) { out = { ok: false, display: args, used: [], error: { code: "provider.unavailable", message: e instanceof Error ? e.message : "The terminal failed." } }; }
  }

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
    if (waitedOut) raise(ctx, "timeout.deadline", BUSY_LINE, { timeoutSec: a.timeoutSec ?? DEFAULT_TIMEOUT_SEC, reason: "busy" });
    const code = out.error.code === "permission.provider_label" ? "permission.no_grant" : out.error.code;
    return raise(ctx, code, clean(scope, out.error.message), out.error.handle === undefined ? undefined : { handle: out.error.handle });
  }
  const r = result as { exitCode: number | null; truncated: boolean; durationMs: number } | null;
  if (r === null) { finish(null, begun === null ? 0 : ctx.now() - begun.at); return raise(ctx, "internal.unexpected", "The terminal did not report a result."); }
  finish(r.exitCode, r.durationMs);
  // what this call filled is already out; what other commands of the workspace filled (another person's, through the same agent) is taken out too
  const output = clean(scope, typeof out.output === "string" ? out.output : "");
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

export const AGENT_LOOSENS_LINE = "An agent can only make your terminal rules stricter. To allow a command, remove a rule or add a folder, change it yourself in Terminal rules.";

/**
 * What in `next` is looser than `cur`, or null when nothing is: a new allow entry, an ask or deny entry gone (an ask entry that moved to deny is stricter), or a new folder. Stricter is a new ask or deny
 * entry, an allow entry gone, a folder gone.
 */
export function loosens(cur: Rules, next: Rules): string | null {
  for (const e of next.allow) if (!cur.allow.includes(e)) return e;
  for (const e of cur.deny) if (!next.deny.includes(e)) return e;
  for (const e of cur.ask) if (!next.ask.includes(e) && !next.deny.includes(e)) return e;
  for (const e of next.folders) if (!cur.folders.includes(e)) return e;
  return null;
}

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
  // an agent may make the person's rules stricter by itself, never looser (12 Nov, lead's decision): looser needs the person, in Terminal rules
  // every caller that is not a person (an agent, an Automation or another service acting for someone) may only tighten them (review S4)
  if (ctx.principal.kind !== "person") {
    const loose = loosens(rulesOf(ctx.db, me), rules);
    if (loose !== null) raise(ctx, "permission.role_lacks_permission", AGENT_LOOSENS_LINE, { reason: "loosens_rules", entry: loose });
  }
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

/**
 * An agent went to Trash (deleted, or the Assistant of a person who left the Space): its workspace stops for good. Its open sessions close, its container and network go and the room it held on the
 * host is given back; its home and Files volumes stay, since an agent in Trash can be restored and they hold what it made (the next command after a restore makes the workspace again over them).
 * Safe to run twice. `remove` is the machine's (the workspace fleet), absent where this host has no workspaces.
 */
export async function onAgentGone(ctx: TermCtx, event: { payload: { agentId?: unknown } }, remove: ((agentId: string) => Promise<void>) | null): Promise<string[]> {
  ensure(ctx.db);
  const agentId = event.payload.agentId;
  if (typeof agentId !== "string" || !/^agt_[A-Za-z0-9_-]+$/.test(agentId)) return [];
  const open = (ctx.db.all("SELECT terminal_id FROM terminal_sessions WHERE host = 'agent_computer' AND agent_id = ? AND closed_at IS NULL", agentId) as Row[]).map((r) => String(r["terminal_id"]));
  const at = ctx.now();
  for (const id of open) {
    ctx.db.run("UPDATE terminal_sessions SET closed_at = ?, state = 'exited' WHERE terminal_id = ?", at, id);
    forgetSecrets(scopeOf({ terminalId: id, host: "agent_computer", agentId }));
    ctx.emit("terminal.closed", id, { terminalId: id, by: "svc_host" });
  }
  // what its workspace remembered of Vault values goes from memory with it (review S2)
  forgetAgentSecrets(agentId);
  // the clock for its volumes starts now (removed after the Space's Trash retention, unless it is restored first)
  ctx.db.run("INSERT INTO terminal_workspace_gone (agent_id, deleted_at) VALUES (?, ?) ON CONFLICT (agent_id) DO NOTHING", agentId, ctx.now());
  if (remove) await remove(agentId);
  return open;
}

/** agent.restored: back from Trash, so its volumes stay. */
export function onAgentRestored(ctx: TermCtx, agentId: unknown): boolean {
  if (typeof agentId !== "string") return false;
  ensure(ctx.db);
  return ctx.db.run("DELETE FROM terminal_workspace_gone WHERE agent_id = ?", agentId).changes > 0;
}

/**
 * How long Trash keeps things when governance cannot be read: governance's default trash retention ('30d', manifests/governance.ts). The Space browser keeps the same constant (modules/computers/sbrowser/
 * forget.ts TRASH_KEEP_MS); test/trash-retention.workspace.test.ts holds this one to governance's default.
 */
export const TRASH_KEEP_MS = 30 * 86_400_000;

/** A retention value as governance writes it ("30d", "12w", "6m", "2y", "forever") in ms; null for forever; undefined when it is not one of those. */
export function retentionMs(v: string): number | null | undefined {
  if (v === "forever") return null;
  const m = /^(\d{1,5})([dwmy])$/.exec(v.trim());
  if (!m) return undefined;
  return Number(m[1]) * { d: 1, w: 7, m: 30, y: 365 }[m[2] as "d" | "w" | "m" | "y"] * 86_400_000;
}

/** The Space's Trash retention in force, read from governance now; its default when that cannot be read; null when Trash is kept forever. */
export async function trashKeepMs(ctx: TermCtx): Promise<number | null> {
  try {
    const out = (await ctx.call?.("governance.retention.get", {})) as { kinds?: Array<{ key?: string; value?: string }> } | undefined;
    const v = out?.kinds?.find((k) => k.key === "trash")?.value;
    const ms = typeof v === "string" ? retentionMs(v) : undefined;
    if (ms !== undefined) return ms;
  } catch { /* governance is not running here (a Personal Space has no retention settings): its default */ }
  return TRASH_KEEP_MS;
}

/** The periodic pass: the home and Files volumes of agents in Trash longer than Trash keeps things are removed. Returns the agents whose volumes went. */
export async function forgetExpiredWorkspaces(ctx: TermCtx, remove: ((agentId: string) => Promise<void>) | null): Promise<string[]> {
  ensure(ctx.db);
  if (!remove || (ctx.db.all("SELECT 1 FROM terminal_workspace_gone LIMIT 1") as Row[]).length === 0) return [];
  const keep = await trashKeepMs(ctx);
  if (keep === null) return [];
  const due = (ctx.db.all("SELECT agent_id FROM terminal_workspace_gone WHERE deleted_at <= ?", ctx.now() - keep) as Row[]).map((r) => String(r["agent_id"]));
  const done: string[] = [];
  for (const id of due) {
    try { await remove(id); ctx.db.run("DELETE FROM terminal_workspace_gone WHERE agent_id = ?", id); done.push(id); }
    catch (e) { ctx.log.warn("terminal: the workspace volumes of an agent in Trash could not be removed; tried again later", { agentId: id, reason: e instanceof Error ? e.message.slice(0, 160) : "unknown" }); }
  }
  return done;
}

export { commandsOf, judge, rulesOf };
