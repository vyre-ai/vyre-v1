// terminal: tmux sessions on an agent computer, the Space server or a person's computer (spec 2.7, 2.23; ARCH 6.7, 6.11, 7.2).
//   open / open_server / close / rename / list / get / status     the sessions, and what Home shows for starred ones
//   input / interrupt / resize / read / attach                     a person typing in the tab; the same session an agent used, so "Open terminal" shows its commands
//   run                                                            the terminal_run tool: one command, run in a session, output scrubbed of every Vault value filled into it
//   rules.get / rules.set / health
// The machine does the work through the TerminalHost port (projections.ts); this module keeps what Vyre knows about a session and enforces who may do what in it.
import { runWithVault } from "../../../agent/src/vault-use/run.ts";
import type { Lookup, ValueSource, Where } from "../../../agent/src/vault-use/run.ts";
import type { Secret } from "../../../agent/src/vault-use/scrub.ts";
import {
  MAX_RULES, MAX_RULE_CHARS, TICKET_MS, actorOf, boundHost, boundValues, clean, commandsOf, ensure, forgetSecrets, hostOf, insertSession, isTeam, judge, mintId, raise, rememberSecrets,
  rulesOf, sessionBy, sessionOf, sha256, ticketSecret, touch,
} from "../projections.ts";
import type { HostKind, Rules, SessionRow, Target, TermCtx, TermState } from "../projections.ts";

type Row = Record<string, unknown>;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const DEFAULT_TIMEOUT_SEC = 120;
const MAX_COMMAND_CHARS = 20_000;
const REPLAY_LINES = 200;
const AGENT_SESSION = "agent";

const TITLE: Readonly<Record<HostKind, string>> = { agent_computer: "Agent computer", space_server: "Space server", device: "This computer" };

export function terminalRow(x: SessionRow) {
  return {
    terminalId: x.terminalId, name: x.name, host: x.host, hostTitle: x.hostTitle,
    ...(x.agentId === undefined ? {} : { agentId: x.agentId }), ...(x.computerId === undefined ? {} : { computerId: x.computerId }), ...(x.deviceId === undefined ? {} : { deviceId: x.deviceId }),
    cwd: x.cwd, state: x.state, exitCode: x.exitCode, named: x.named, cols: x.cols, rows: x.rows, createdAt: x.createdAt, lastActiveAt: x.lastActiveAt, ...(x.runId === undefined ? {} : { runId: x.runId }),
  };
}

/** A session that is still there. A closed one is gone for every action but `get`. */
function live(ctx: TermCtx, id: string): SessionRow {
  const x = sessionBy(ctx.db, id);
  if (!x || x.closedAt !== undefined) raise(ctx, "validation.not_found", "There is no such terminal.", { terminalId: id });
  return x;
}

const unexpected = (ctx: TermCtx, what: string, e: unknown): never => {
  ctx.log.warn(`terminal: ${what} failed`, { reason: e instanceof Error ? e.message.slice(0, 120) : "unknown" });
  return raise(ctx, "internal.unexpected", `The terminal could not ${what}.`);
};

// ---- opening ------------------------------------------------------------------------------------------------------------------------------------------------

interface OpenInput { host: HostKind; agentId?: string; computerId?: string; deviceId?: string; name?: string; cwd?: string; cols?: number; rows?: number; named?: boolean }

async function openSession(ctx: TermCtx, a: OpenInput, mapHostError: (e: unknown) => never): Promise<SessionRow> {
  ensure(ctx.db);
  if (a.host === "agent_computer") {
    if (!isTeam(ctx.space)) raise(ctx, "permission.needs_team", "Agent computers are part of a Team Space.");
    if (a.agentId === undefined && a.computerId === undefined) raise(ctx, "validation.bad_input", "Say which agent computer to open the terminal on.");
  }
  if (a.host === "device" && a.deviceId === undefined) raise(ctx, "validation.bad_input", "Say which computer to open the terminal on.");
  const now = ctx.now();
  const owner = actorOf(ctx);
  const cols = a.cols ?? DEFAULT_COLS;
  const rows = a.rows ?? DEFAULT_ROWS;
  const terminalId = mintId("trm", now);
  const n = Number((ctx.db.all("SELECT COUNT(*) AS n FROM terminal_sessions WHERE owner = ? AND closed_at IS NULL", owner) as Row[])[0]?.["n"] ?? 0);
  const name = (a.name ?? "").trim().slice(0, 80) || `Terminal ${n + 1}`;
  const target: Target = { host: a.host, ...(a.agentId === undefined ? {} : { agentId: a.agentId }), ...(a.computerId === undefined ? {} : { computerId: a.computerId }), ...(a.deviceId === undefined ? {} : { deviceId: a.deviceId }) };
  let started: { cwd: string; title?: string };
  try {
    started = await hostOf(ctx).open({ terminalId, target, name, ...(a.cwd === undefined ? {} : { cwd: a.cwd }), cols, rows, folders: rulesOf(ctx.db, owner).folders });
  } catch (e) { return mapHostError(e); }
  const row: SessionRow = {
    terminalId, name, named: a.named ?? (a.name !== undefined && a.name.trim() !== ""), host: a.host, hostTitle: started.title ?? TITLE[a.host],
    ...(a.agentId === undefined ? {} : { agentId: a.agentId }), ...(a.computerId === undefined ? {} : { computerId: a.computerId }), ...(a.deviceId === undefined ? {} : { deviceId: a.deviceId }),
    cwd: started.cwd, state: "idle", exitCode: null, cols, rows, owner, ...(ctx.run === undefined ? {} : { runId: ctx.run }), createdAt: now, lastActiveAt: now,
  };
  insertSession(ctx.db, row);
  ctx.emit("terminal.opened", terminalId, { terminalId, host: a.host, ...(a.agentId === undefined ? {} : { agentId: a.agentId }), by: owner });
  return row;
}

const unavailable = (ctx: TermCtx) => (e: unknown): never => {
  if (e && typeof e === "object" && "error" in e) throw e;   // already a shaped error (no host bound)
  ctx.log.warn("terminal: open failed", { reason: e instanceof Error ? e.message.slice(0, 120) : "unknown" });
  return raise(ctx, "provider.unavailable", "That computer did not start a terminal. Check that it is on and try again.");
};

export async function open(ctx: TermCtx, input: OpenInput) {
  const host: HostKind = input.host;
  return { terminal: terminalRow(await openSession(ctx, { ...input, host }, unavailable(ctx))) };
}

export async function openServer(ctx: TermCtx, input: { name?: string; cwd?: string; cols?: number; rows?: number }) {
  return { terminal: terminalRow(await openSession(ctx, { ...input, host: "space_server" }, (e) => unexpected(ctx, "open", e))) };
}

// ---- reading ------------------------------------------------------------------------------------------------------------------------------------------------

export function list(ctx: TermCtx, input: { section?: "personal" | "shared" | "space"; folderId?: string; host?: HostKind; state?: TermState[]; cursor?: string; limit?: number }) {
  ensure(ctx.db);
  const me = actorOf(ctx);
  const all = (ctx.db.all("SELECT * FROM terminal_sessions WHERE closed_at IS NULL ORDER BY last_active_at DESC, terminal_id DESC") as Row[]).map(sessionOf);
  const mine = all.filter((x) => {
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
  live(ctx, input.terminalId);
  try {
    const r = await hostOf(ctx).read(input.terminalId, { lines: input.lines ?? REPLAY_LINES, ...(input.since === undefined ? {} : { since: input.since }) });
    return { text: clean(input.terminalId, r.text), next: r.next };
  } catch (e) { return unexpected(ctx, "read the screen", e); }
}

export async function attach(ctx: TermCtx, input: { terminalId: string }) {
  ensure(ctx.db);
  live(ctx, input.terminalId);
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
  live(ctx, a.terminalId);
  if (a.data === "") raise(ctx, "validation.bad_input", "There is nothing to send.");
  try { await hostOf(ctx).input(a.terminalId, a.data); } catch (e) { return unexpected(ctx, "take that input", e); }
  touch(ctx.db, a.terminalId, ctx.now());
  return { ok: true };
}

export async function interrupt(ctx: TermCtx, a: { terminalId: string }) {
  ensure(ctx.db);
  live(ctx, a.terminalId);
  try { await hostOf(ctx).interrupt(a.terminalId); } catch (e) { return unexpected(ctx, "interrupt", e); }
  touch(ctx.db, a.terminalId, ctx.now());
  return { ok: true };
}

export async function resize(ctx: TermCtx, a: { terminalId: string; cols: number; rows: number }) {
  ensure(ctx.db);
  live(ctx, a.terminalId);
  try { await hostOf(ctx).resize(a.terminalId, a.cols, a.rows); } catch (e) { return unexpected(ctx, "resize", e); }
  ctx.db.run("UPDATE terminal_sessions SET cols = ?, rows = ? WHERE terminal_id = ?", a.cols, a.rows, a.terminalId);
  return { ok: true };
}

// ---- run ------------------------------------------------------------------------------------------------------------------------------------------------

const WHERE: Readonly<Record<HostKind, Where>> = { agent_computer: "computer", space_server: "host", device: "device" };

interface RunInput {
  command: string; terminalId?: string; host?: "agent_computer" | "device"; agentId?: string; cwd?: string; timeoutSec?: number; env?: Record<string, string>;
}

/** The session an agent's commands go to when it names none: one per agent, person and host, kept so "Open terminal" shows the same screen. */
async function sessionForRun(ctx: TermCtx, a: RunInput): Promise<SessionRow> {
  if (a.terminalId !== undefined) return live(ctx, a.terminalId);
  const owner = actorOf(ctx);
  const host: HostKind = a.host ?? (a.agentId !== undefined || ctx.principal.kind === "agent" ? "agent_computer" : "device");
  const agentId = a.agentId ?? (ctx.principal.kind === "agent" ? ctx.principal.id : undefined);
  const found = ctx.db.all(
    "SELECT * FROM terminal_sessions WHERE owner = ? AND host = ? AND name = ? AND closed_at IS NULL AND (agent_id IS ? OR agent_id = ?) ORDER BY created_at DESC LIMIT 1",
    owner, host, AGENT_SESSION, agentId ?? null, agentId ?? "",
  ) as Row[];
  const hit = found[0];
  if (hit) return sessionOf(hit);
  return openSession(ctx, { host, ...(agentId === undefined ? {} : { agentId }), name: AGENT_SESSION, named: false, ...(a.cwd === undefined ? {} : { cwd: a.cwd }) }, unavailable(ctx));
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
  const out = await runWithVault(
    { source, reportMiss: (m) => { ctx.log.warn("vault.scrub_miss", { itemId: m.itemId, place: m.place }); } },
    { tool: "terminal_run", args: { command, ...(a.env ? { env: a.env } : {}) }, traceId: ctx.trace.traceId, agentId: ctx.principal.id, asker: owner, where: WHERE[s.host] },
    async (filled) => {
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
    },
  );
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
  if (!host) return { state: "down" as const, detail: "Terminals are not running on this host.", latencyMs: Date.now() - t0, sessions };
  try {
    const h = await host.health();
    return { state: h.ok ? ("healthy" as const) : ("degraded" as const), ...(h.detail === undefined ? {} : { detail: h.detail }), latencyMs: Date.now() - t0, sessions };
  } catch (e) {
    return { state: "down" as const, detail: e instanceof Error ? e.message.slice(0, 120) : "tmux did not answer", latencyMs: Date.now() - t0, sessions };
  }
}

export { commandsOf, judge, rulesOf };
