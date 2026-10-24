// Test harness for the terminal module: a real in-memory SQLite behind the host's ctx.db guard (terminal_* tables only), a recording ctx, a scripted TerminalHost, and checks against the
// frozen contract.
import { ProjectionHost } from "../../../kernel/src/store/projection.ts";
import { registry } from "../../../generated/registry.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import type { RawDb } from "../../../host/src/ctx/db.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { bindHost, bindTeam, bindValues } from "../projections.ts";
import type { TermCtx, TerminalHost, TermState } from "../projections.ts";
import type { Lookup, ValueSource } from "../../../agent/src/vault-use/run.ts";

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";
export const SPACE = "spc_termtest";

export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }
export interface Logged { msg: string; attrs?: Record<string, unknown> | undefined }

export function openRaw(): RawDb {
  const host = ProjectionHost.open({ path: ":memory:", space: SPACE, projections: [] });
  return {
    all: (sql, ...args) => host.tx.all(sql, ...args),
    run: (sql, ...args) => ({ changes: host.tx.run(sql, ...args).changes }),
  };
}

export interface HarnessOptions {
  raw?: RawDb;
  principal?: TermCtx["principal"];
  actingFor?: string;
  allow?: (action: { perm: string | null; level: string }, resource: { type: string; id: string | null }) => boolean;
  clock?: { t: number };
  run?: string;
}

export function harness(o: HarnessOptions = {}) {
  const raw = o.raw ?? openRaw();
  const clock = o.clock ?? { t: NOW };
  const emitted: Emitted[] = [];
  const logged: Logged[] = [];
  let allow = o.allow ?? (() => true);
  const db = scopedDb("terminal", raw, TRACE);
  const ctx: TermCtx = {
    space: SPACE,
    principal: o.principal ?? { kind: "person", id: "usr_dana" },
    ...(o.actingFor === undefined ? {} : { actingFor: o.actingFor }),
    ...(o.run === undefined ? {} : { run: o.run }),
    trace: { traceId: TRACE },
    now: () => clock.t,
    db,
    emit(name, subject, payload) { emitted.push({ name, subject, payload: payload as Record<string, unknown> }); return null; },
    authorize: (action, resource) => ({ effect: allow(action, resource) ? "allow" : "deny" }),
    log: { warn(msg, attrs) { logged.push({ msg, attrs }); } },
  };
  return {
    ctx, raw, db, emitted, logged, clock,
    advance(ms: number) { clock.t += ms; },
    allowOnly(f: NonNullable<HarnessOptions["allow"]>) { allow = f; },
    rows(sql: string, ...args: unknown[]): Record<string, unknown>[] { return db.all(sql, ...args) as Record<string, unknown>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    as(principal: TermCtx["principal"], actingFor?: string, run?: string): TermCtx { return { ...ctx, principal, ...(actingFor === undefined ? {} : { actingFor }), ...(run === undefined ? {} : { run }) }; },
  };
}
export type Harness = ReturnType<typeof harness>;

// ---- a scripted machine ----------------------------------------------------------------------------------------------------------------------------------

export interface RunResult { exitCode: number | null; output: string; truncated?: boolean; durationMs?: number }
export type RunScript = RunResult | ((command: string, env: Readonly<Record<string, string>>) => RunResult | Promise<RunResult>);

/** Keeps a screen per session like tmux would, runs commands from `scripts`, and records what it was asked. */
export function fakeHost(scripts: Record<string, RunScript> = {}) {
  const screens = new Map<string, string[]>();
  const states = new Map<string, TermState>();
  const calls: Array<{ op: string; terminalId?: string; args?: unknown }> = [];
  const frames = new Map<string, Array<(t: string) => void>>();
  let installed = true;
  let failOpen = false;
  let failRun: Error | null = null;
  const screen = (id: string): string[] => { let s = screens.get(id); if (!s) { s = []; screens.set(id, s); } return s; };
  const host: TerminalHost = {
    async open(a) {
      calls.push({ op: "open", terminalId: a.terminalId, args: { target: a.target, name: a.name, cwd: a.cwd, cols: a.cols, rows: a.rows, folders: a.folders } });
      if (failOpen) throw new Error("agentd did not answer");
      screens.set(a.terminalId, []);
      states.set(a.terminalId, "idle");
      return { cwd: a.cwd ?? "/home/agent", ...(a.target.agentId ? { title: `${a.target.agentId}'s computer` } : {}) };
    },
    async input(id, data) { calls.push({ op: "input", terminalId: id, args: data }); screen(id).push(data); },
    async interrupt(id) { calls.push({ op: "interrupt", terminalId: id }); screen(id).push("^C"); },
    async resize(id, cols, rows) { calls.push({ op: "resize", terminalId: id, args: { cols, rows } }); },
    async read(id, r) {
      calls.push({ op: "read", terminalId: id, args: r });
      const all = screen(id);
      return { text: (r.since === undefined ? all.slice(-r.lines) : all.slice(r.since)).join("\n"), next: all.length };
    },
    async run(id, r) {
      calls.push({ op: "run", terminalId: id, args: { command: r.command, env: r.env, cwd: r.cwd, timeoutMs: r.timeoutMs } });
      if (failRun) throw failRun;
      states.set(id, "running");
      const sc = scripts[r.command];
      const res: RunResult = sc === undefined ? { exitCode: 127, output: `${r.command}: command not found` } : typeof sc === "function" ? await sc(r.command, r.env) : sc;
      screen(id).push(`$ ${r.command}`, ...(res.output === "" ? [] : res.output.split("\n")));
      states.set(id, "idle");
      return { exitCode: res.exitCode, output: res.output, truncated: res.truncated ?? false, durationMs: res.durationMs ?? 12 };
    },
    async status(ids) { calls.push({ op: "status", args: ids }); return ids.map((terminalId) => ({ terminalId, state: states.get(terminalId) ?? "exited", exitCode: null, ...(screen(terminalId).length ? { lastLine: screen(terminalId).at(-1) as string } : {}) })); },
    async close(id) { calls.push({ op: "close", terminalId: id }); states.set(id, "exited"); },
    async health() { return installed ? { ok: true, detail: "tmux 3.4", sessions: [...states.values()].filter((s) => s !== "exited").length } : { ok: false, detail: "tmux is not installed on this host", sessions: 0 }; },
    stream(id, onFrame) {
      const list = frames.get(id) ?? [];
      list.push(onFrame);
      frames.set(id, list);
      return () => { frames.set(id, (frames.get(id) ?? []).filter((f) => f !== onFrame)); };
    },
  };
  return {
    host, calls, screens, scripts,
    count(op: string): number { return calls.filter((c) => c.op === op).length; },
    emitFrame(id: string, text: string) { for (const f of frames.get(id) ?? []) f(text); },
    listeners(id: string): number { return (frames.get(id) ?? []).length; },
    setInstalled(v: boolean) { installed = v; },
    failOpenWith(v: boolean) { failOpen = v; },
    failRunWith(e: Error | null) { failRun = e; },
  };
}
export type FakeHost = ReturnType<typeof fakeHost>;

/** A Vault that answers a fixed table of handle to value, for any asker. */
export function fakeValues(table: Record<string, string>, deny: ReadonlySet<string> = new Set()): ValueSource {
  return {
    async lookup(handle): Promise<Lookup> {
      if (deny.has(handle)) return { kind: "denied", reason: "no_access" };
      const v = table[handle];
      return v === undefined ? { kind: "unknown" } : { kind: "value", itemId: `vit_${handle.replace(/\W/g, "")}`, value: v, spaceOnly: false, injectIntoDeployments: false };
    },
  };
}

export function reset(): void { bindHost(null); bindValues(null); bindTeam(null); }

export function eventErrors(name: string, payload: unknown): string[] {
  const def = registry.events.find((e) => e.name === name);
  if (!def) return [`${name} is not in the registry`];
  return validate(def.payload, payload, "", registry.$defs);
}
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!def) return [`${cap} is not in the registry`];
  return validate(side === "in" ? def.input : def.output, value, "", registry.$defs);
}
export function assertEventsConform(h: Harness): string[] {
  return h.emitted.flatMap((e) => eventErrors(e.name, e.payload).map((m) => `${e.name}: ${m}`));
}
export function codeOf(err: unknown): string {
  const shaped = err as { error?: { code?: string } } | null;
  return shaped?.error?.code ?? "";
}
