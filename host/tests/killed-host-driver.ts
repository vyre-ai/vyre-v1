// Child process for crash resume. The parent test SIGKILLs this process and starts another on the same files.
// Databases stay under /tmp/vyre-killed-host-<pid>/. This file does not open a path in the repo.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scopedDb } from "../src/ctx/db.ts";
import { createRunsHost } from "../src/seams/runs.ts";
import type { HostCall } from "../src/seams/runs.ts";
import { deliverScheduleNeedsYou, loadOpenScheduleKeys, startScheduledTicks } from "../src/seams/automation-schedule.ts";
import type { TickClaimStore } from "../src/seams/automation-schedule.ts";
import { mintId } from "../../lib/ids.ts";
import { registry } from "../../generated/registry.ts";
import { validateEvent, validateInput, validateOutput } from "../../generated/validators.ts";
import { handlers as runHandlers } from "../../modules/runs/impl.ts";
import { drive, interrupted, sweepWaits } from "../../modules/runs/handlers/engine.ts";
import { findRun } from "../../modules/runs/projections.ts";
import type { RunsCtx } from "../../modules/runs/projections.ts";
import { handlers as autoHandlers, hostCalls as autoHost } from "../../modules/automations/impl.ts";
import { findAutomation } from "../../modules/automations/projections.ts";
import type { AutoCtx, Definition } from "../../modules/automations/projections.ts";
import { startRun } from "../../modules/automations/handlers/triggers.ts";
import { hostCalls as stepHost } from "../../modules/steps-core/impl.ts";
import { alice, engine, HOUR, node, NOW } from "../../modules/automations/fixtures/seed.ts";
import type { Caller } from "../../modules/automations/fixtures/seed.ts";
import { applyScheduleChoice, planSchedule } from "../../modules/automations/schedule/index.ts";
import type { AutomationSchedule, NeedsYouRequest, PlanContext, TickPlan } from "../../modules/automations/schedule/index.ts";

interface SqlStmt {
  all(...args: unknown[]): Record<string, unknown>[];
  get(...args: unknown[]): Record<string, unknown> | undefined;
  run(...args: unknown[]): { changes: number | bigint };
}
interface Sql {
  exec(source: string): void;
  prepare(source: string): SqlStmt;
  close(): void;
}
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as { DatabaseSync: new (file: string, opts?: { readOnly?: boolean }) => Sql };

const TRACE = "0123456789abcdef0123456789abcdef";
const DAY = 24 * HOUR;
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
type Scenario = "wait" | "loop" | "schedule" | "graph";
type Phase = "boot" | "recover";
interface Args { dir: string; scenario: Scenario; phase: Phase; stall: string; advance: number; again: boolean }
interface Db { all(sql: string, ...args: unknown[]): unknown[]; run(sql: string, ...args: unknown[]): { changes: number } }

const norm = (a: unknown): unknown => (a === undefined ? null : a);
function wrap(sql: Sql): Db {
  return {
    all: (source, ...args) => sql.prepare(source).all(...(args.map(norm) as unknown[])),
    run: (source, ...args) => ({ changes: Number(sql.prepare(source).run(...(args.map(norm) as unknown[])).changes) }),
  };
}

function assertSafeDir(dir: string): string {
  const resolved = path.resolve(dir);
  const root = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (resolved === ROOT || resolved.startsWith(root)) throw new Error(`refusing a database path inside the repo: ${resolved}`);
  if (!/^\/tmp\/vyre-killed-host-\d+(?:\/|$)/.test(resolved)) throw new Error(`refusing database path ${resolved}`);
  return resolved;
}

function openDb(file: string, init: string | null): Sql {
  const fresh = !existsSync(file);
  const sql = new DatabaseSync(file);
  sql.exec("PRAGMA journal_mode = DELETE");
  sql.exec("PRAGMA synchronous = FULL");
  if (fresh && init) sql.exec(init);
  return sql;
}

function readSql(url: URL): string {
  return readFileSync(url, "utf8");
}

function runsInit(): string {
  const schema = readSql(new URL("../../generated/modules/runs/schema.sql", import.meta.url));
  const migration = ["0001_runs_engine.sql", "0003_run_trigger.sql"]
    .map((name) => readSql(new URL(`../../modules/runs/migrations/${name}`, import.meta.url))).join("\n");
  return `${schema}\n${migration}`;
}

function autoInit(): string {
  const dir = new URL("../../modules/automations/migrations/", import.meta.url);
  return readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()
    .map((name) => readSql(new URL(name, dir))).join("\n");
}

const META_INIT = `
CREATE TABLE clock (id INTEGER PRIMARY KEY, now INTEGER NOT NULL);
CREATE TABLE effects (id INTEGER PRIMARY KEY AUTOINCREMENT, cap TEXT NOT NULL, input TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE claims (tick_id TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE tasks (id TEXT PRIMARY KEY, state TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT, idem TEXT, body TEXT NOT NULL);
CREATE TABLE case_state (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

function parseArgs(argv: string[]): Args {
  const out: Args = { dir: "", scenario: "wait", phase: "boot", stall: "", advance: 0, again: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dir") out.dir = argv[++i] ?? "";
    else if (arg === "--scenario") out.scenario = argv[++i] as Scenario;
    else if (arg === "--phase") out.phase = argv[++i] as Phase;
    else if (arg === "--stall") out.stall = argv[++i] ?? "";
    else if (arg === "--advance") out.advance = Number(argv[++i] ?? "0");
    else if (arg === "--again") out.again = true;
    else throw new Error(`unknown arg ${arg}`);
  }
  if (!out.dir) throw new Error("missing --dir");
  if (!Number.isFinite(out.advance)) throw new Error("bad --advance");
  return out;
}

const manual = [{ key: "manual" }];
const contact = (fields: Record<string, unknown>) => ({ type: "contact", fields });

function waitDef(): Definition {
  return {
    triggers: manual,
    start: ["pause"],
    nodes: [
      node("pause", "wait", { forDuration: "1h" }, { next: ["mail"] }),
      node("mail", "send_email", { mailboxId: "mbx_1", to: ["a@b.c"], subject: "After", body: "After" }),
    ],
  };
}

function loopDef(): Definition {
  return {
    triggers: manual,
    start: ["each"],
    nodes: [
      node("each", "loop", {
        items: [{ id: "a", name: "Ada" }, { id: "b", name: "Bea" }, { id: "c", name: "Cy" }],
        concurrency: 1,
        maxIterations: 10,
      }, { branches: [{ label: "body", to: "make" }], next: ["after"] }),
      node("make", "records.create", contact({ name: "{{ item.name }}" }), { next: ["hold"] }),
      node("hold", "wait", { forDuration: "1h" }),
      node("after", "records.update", { type: "contact", recordId: "rec_after", patch: { step: "after" } }),
    ],
  };
}

function graphDef(): Definition {
  return {
    triggers: manual,
    start: ["work"],
    nodes: [
      node("work", "records.update", { type: "contact", recordId: "rec_1", patch: { step: "work" } }, { next: ["pause"] }),
      node("pause", "wait", { forDuration: "1h" }, { next: ["par"] }),
      node("par", "parallel", { waitFor: "all" }, {
        branches: [{ label: "Lane", to: "lane" }, { label: "Other", to: "other" }],
        next: ["each"],
      }),
      node("lane", "records.update", { type: "contact", recordId: "rec_lane", patch: { step: "lane" } }),
      node("other", "records.update", { type: "contact", recordId: "rec_other", patch: { step: "other" } }),
      node("each", "loop", {
        items: [{ id: "a", name: "Ada" }],
        concurrency: 1,
        maxIterations: 10,
      }, { branches: [{ label: "body", to: "iter" }] }),
      node("iter", "records.update", { type: "contact", recordId: "rec_iter", patch: { step: "iter", name: "{{ item.name }}" } }),
    ],
  };
}

function mainDef(scenario: Scenario): Definition {
  if (scenario === "wait") return waitDef();
  if (scenario === "loop") return loopDef();
  return graphDef();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dir = assertSafeDir(args.dir);
  mkdirSync(dir, { recursive: true });
  const runsSql = openDb(path.join(dir, "runs.sqlite"), runsInit());
  const autoSql = openDb(path.join(dir, "automations.sqlite"), autoInit());
  const metaFresh = !existsSync(path.join(dir, "meta.sqlite"));
  const meta = openDb(path.join(dir, "meta.sqlite"), null);
  if (metaFresh) {
    meta.exec(META_INIT);
    meta.prepare("INSERT INTO clock (id, now) VALUES (1, ?)").run(NOW);
  }
  const now = (): number => Number(meta.prepare("SELECT now FROM clock WHERE id = 1").get()?.now);
  const setNow = (n: number): void => { meta.prepare("UPDATE clock SET now = ? WHERE id = 1").run(n); };
  const runsDb = wrap(runsSql);
  const autoDb = wrap(autoSql);
  const runsScoped = scopedDb("runs", runsDb, TRACE);
  const autoScoped = scopedDb("automations", autoDb, TRACE);

  function logEffect(cap: string, input: unknown): void {
    meta.prepare("INSERT INTO effects (cap, input, at) VALUES (?, ?, ?)").run(cap, JSON.stringify(input ?? null), now());
  }
  function tasksCreate(input: Record<string, unknown>): { task: { id: string } } {
    logEffect("tasks.create", input);
    const idem = typeof input.idempotencyKey === "string" ? input.idempotencyKey : "";
    if (idem) {
      const have = meta.prepare("SELECT id FROM tasks WHERE idem = ?").get(idem);
      if (have) return { task: { id: String(have.id) } };
    }
    const n = Number(meta.prepare("SELECT COUNT(*) AS n FROM tasks").get()?.n ?? 0) + 1;
    const source = input.source as { id?: unknown } | undefined;
    const sourceId = source && typeof source.id === "string" ? source.id : null;
    const id = `tsk_${n}`;
    meta.prepare("INSERT INTO tasks (id, state, kind, source_id, idem, body) VALUES (?, 'todo', ?, ?, ?, ?)").run(
      id, String(input.kind ?? ""), sourceId, idem || null, JSON.stringify(input),
    );
    return { task: { id } };
  }
  function tasksList(input: Record<string, unknown>): { tasks: { id: string; state: string; kind: string; source: { id: string } | null }[] } {
    const states = new Set(Array.isArray(input.states) ? input.states.filter((s): s is string => typeof s === "string") : []);
    const kinds = new Set(Array.isArray(input.kinds) ? input.kinds.filter((s): s is string => typeof s === "string") : []);
    const rows = meta.prepare("SELECT id, state, kind, source_id FROM tasks").all();
    const tasks = rows.filter((row) => (states.size === 0 || states.has(String(row.state))) && (kinds.size === 0 || kinds.has(String(row.kind))))
      .map((row) => ({
        id: String(row.id),
        state: String(row.state),
        kind: String(row.kind),
        source: typeof row.source_id === "string" && row.source_id ? { id: row.source_id } : null,
      }));
    return { tasks };
  }
  function externalCap(cap: string, input: unknown): unknown {
    const body = (input ?? {}) as Record<string, unknown>;
    if (cap === "tasks.create") return tasksCreate(body);
    if (cap === "tasks.list") return tasksList(body);
    if (cap === "tasks.followers.add" || cap === "notifications.send" || cap === "tasks.act") {
      logEffect(cap, body);
      if (cap === "tasks.act" && typeof body.taskId === "string") meta.prepare("UPDATE tasks SET state = 'done' WHERE id = ?").run(body.taskId);
      return cap === "notifications.send" ? { outcome: "badge" } : { ok: true };
    }
    if (cap === "records.create" || cap === "records.update") {
      logEffect(cap, body);
      return { record: { id: "rec_made", version: 1 } };
    }
    if (cap === "mail.send" || cap === "mail.draft") {
      logEffect(cap, body);
      return { messageId: "msg_1" };
    }
    throw new Error(`unexpected step call ${cap}`);
  }

  const runEmits = (cap: string | null): Set<string> => (cap === null
    ? new Set(registry.events.filter((e) => e.name.startsWith("run.")).map((e) => e.name))
    : new Set(registry.capabilities.find((c) => c.name === cap)?.emits ?? []));
  const autoEmits = (cap: string | null): Set<string> => (cap === null
    ? new Set(registry.events.filter((e) => e.name.startsWith("automation.")).map((e) => e.name))
    : new Set(registry.capabilities.find((c) => c.name === cap)?.emits ?? []));

  function runsCtx(cap: string | null, who: Caller): RunsCtx {
    const allowed = runEmits(cap);
    return {
      space: "spc_test", principal: { kind: who.kind ?? "person", id: who.id }, ...(who.actingFor ? { actingFor: who.actingFor } : {}),
      trace: { traceId: TRACE }, depth: who.depth ?? 1,
      now,
      db: runsScoped,
      emit(name, subject, payload) {
        if (!allowed.has(name)) throw new Error(`${cap ?? "the engine"} emitted ${name}, which it does not declare`);
        const bad = validateEvent(name, payload);
        if (bad.length) throw new Error(`${name} payload is invalid: ${bad.join("; ")}`);
        return { id: mintId("evt", now()) };
      },
      async call(next, input) { return externalCap(next, input); },
      authorize: () => ({ effect: "deny" }),
    };
  }
  let runKeys = 0;
  async function runsCall(cap: string, raw0: unknown, who: Caller): Promise<unknown> {
    const input = cap === "runs.start" && !(raw0 as { idempotencyKey?: unknown }).idempotencyKey ? { ...(raw0 as object), idempotencyKey: `key_${++runKeys}` } : raw0;
    const bad = validateInput(cap, 1, input);
    if (bad.length) throw new Error(`${cap} input is invalid: ${bad.join("; ")}`);
    const handler = (runHandlers as Record<string, (ctx: RunsCtx, input: unknown) => Promise<unknown>>)[cap];
    if (!handler) throw new Error(`no handler for ${cap}`);
    const result = await handler(runsCtx(cap, who), input);
    const badOut = validateOutput(cap, 1, result);
    if (badOut.length) throw new Error(`${cap} output is invalid: ${badOut.join("; ")}`);
    return result;
  }

  function autoCtx(cap: string | null, who: Caller): AutoCtx {
    const allowed = autoEmits(cap);
    return {
      space: "spc_test", principal: { kind: who.kind ?? "person", id: who.id }, ...(who.actingFor ? { actingFor: who.actingFor } : {}),
      trace: { traceId: TRACE }, now, db: autoScoped, baseUrl: "https://acme.example.com",
      emit(name, subject, payload) {
        if (!allowed.has(name)) throw new Error(`${cap ?? "the consumer"} emitted ${name}, which it does not declare`);
        const bad = validateEvent(name, payload);
        if (bad.length) throw new Error(`${name} payload is invalid: ${bad.join("; ")}`);
        return { id: mintId("evt", now()) };
      },
      async call(next, input) {
        if (next.startsWith("runs.")) return runsCall(next, input, engine);
        return externalCap(next, input);
      },
      authorize: () => ({ effect: "deny" }),
    };
  }
  const AUTO_IDEM = new Set(["automations.create", "automations.make_personal_copy", "automations.run", "automations.fire", "automations.groups.create"]);
  let autoKeys = 0;
  async function autoCall(cap: string, raw0: unknown, who: Caller): Promise<unknown> {
    const input = AUTO_IDEM.has(cap) && !(raw0 as { idempotencyKey?: unknown }).idempotencyKey ? { ...(raw0 as object), idempotencyKey: `key_${++autoKeys}` } : raw0;
    const bad = validateInput(cap, 1, input);
    if (bad.length) throw new Error(`${cap} input is invalid: ${bad.join("; ")}`);
    const handler = (autoHandlers as Record<string, (ctx: AutoCtx, input: unknown) => Promise<unknown>>)[cap];
    if (!handler) throw new Error(`no handler for ${cap}`);
    const result = await handler(autoCtx(cap, who), input);
    const badOut = validateOutput(cap, 1, result);
    if (badOut.length) throw new Error(`${cap} output is invalid: ${badOut.join("; ")}`);
    return result;
  }

  function writeReady(step: string): void {
    const file = path.join(dir, "ready.json");
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ pid: process.pid, step }));
    const fd = openSync(tmp, "r");
    fsyncSync(fd);
    closeSync(fd);
    renameSync(tmp, file);
    console.error(`ready ${process.pid} ${step}`);
  }
  function heldOpen(): Promise<never> {
    setInterval(() => {}, 1000);
    return new Promise(() => {});
  }
  async function stallAt(stepId: string): Promise<never> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const running = runsSql.prepare("SELECT id FROM runs_items WHERE status = 'running' AND deleted_at IS NULL").all().map((row) => String(row.id));
      const owners = runsSql.prepare("SELECT run_id FROM runs_steps WHERE step = ? AND state = 'running'").all(stepId).map((row) => String(row.run_id));
      const children = Number(autoSql.prepare("SELECT COUNT(*) AS n FROM automations_runs WHERE parent_run IS NOT NULL").get()?.n ?? 0);
      const only = running.length === 1 && owners.length === 1 && running[0] === owners[0];
      const kidsOk = args.scenario !== "loop" || stepId !== "hold" || children >= 3;
      if (only && kidsOk) break;
      if (Date.now() > deadline) {
        console.error(JSON.stringify({ stepId, running, owners, children }));
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 15));
    }
    writeReady(stepId);
    return heldOpen();
  }

  const errors: string[] = [];
  let driveCount = 0;
  let openDrives = 0;
  let host!: ReturnType<typeof createRunsHost>;
  const call: HostCall = async (name, input, as) => {
    if (name === "runs.drive_run") {
      driveCount += 1;
      openDrives += 1;
      const runId = (input as { runId: string }).runId;
      try {
        const before = findRun(runsScoped, runId);
        if (!before) return "gone";
        const resolved = await host.resolve({ id: runId });
        if (!resolved) return "not_ours";
        const status = (await drive(runsCtx(null, engine), runId, resolved.plan, resolved.exec)).status;
        if (before.parentRun) {
          const parent = findRun(runsScoped, before.parentRun);
          if (parent && (parent.status === "queued" || parent.status === "running")) host.enqueue(parent.id);
        }
        return status;
      } catch (e) {
        errors.push(e instanceof Error ? e.stack ?? e.message : String(e));
        throw e;
      } finally {
        openDrives -= 1;
      }
    }
    if (name === "runs.interrupted") return interrupted(runsScoped);
    if (name.startsWith("automations.")) {
      const hostFn = (autoHost as Record<string, (ctx: AutoCtx, input: unknown) => unknown>)[name];
      if (hostFn) return hostFn(autoCtx(null, engine), input);
      return autoCall(name, input, engine);
    }
    if (name.startsWith("runs.")) return runsCall(name, input, engine);
    if (name === "steps-core.run_step") {
      const body = input as { node: { id: string } };
      if (args.stall && body.node.id === args.stall) await stallAt(body.node.id);
      const principal = as?.principal ?? { kind: "person" as const, id: alice.id };
      return stepHost["steps-core.run_step"]({
        space: "spc_test", principal, trace: { traceId: TRACE }, now,
        db: { all: () => [], run: () => ({ changes: 0 }) },
        emit: () => ({ id: "evt_step" }),
        async call(cap: string, capInput: unknown) { return externalCap(cap, capInput); },
      } as never, input as never);
    }
    throw new Error(`unexpected host call ${name}`);
  };
  host = createRunsHost({ call, log: (msg, attrs) => errors.push(`${msg} ${JSON.stringify(attrs)}`) });

  async function drain(): Promise<void> {
    let prev = -1;
    const started = Date.now();
    let lastLog = 0;
    for (;;) {
      const mark = driveCount;
      await host.settle(200);
      await new Promise((r) => setTimeout(r, 20));
      if (errors.length) throw new Error(errors.join("\n"));
      if (openDrives === 0 && driveCount === mark && driveCount === prev) return;
      prev = driveCount;
      if (Date.now() - lastLog > 2000) {
        lastLog = Date.now();
        console.error(`draining drives=${openDrives} count=${driveCount}`);
      }
      if (!args.stall && Date.now() - started > 20_000) {
        throw new Error(`drain did not settle ${JSON.stringify(runsSql.prepare("SELECT id, status, summary FROM runs_items").all())}`);
      }
    }
  }

  async function boot(definition: Definition, name: string): Promise<string> {
    const made = await autoCall("automations.create", { name, definition }, alice) as { automation: { id: string } };
    const automation = findAutomation(autoScoped, made.automation.id);
    if (!automation) throw new Error("missing automation");
    return startRun(autoCtx(null, engine), automation, {
      trigger: "manual", payload: { startedBy: alice.id }, test: false, depth: 0,
      key: `parent:${automation.id}`, principal: { kind: "person", id: alice.id },
    });
  }

  function saveState(key: string, value: unknown): void {
    meta.prepare("INSERT OR REPLACE INTO case_state (k, v) VALUES (?, ?)").run(key, JSON.stringify(value));
  }
  function loadState<T>(key: string): T {
    const row = meta.prepare("SELECT v FROM case_state WHERE k = ?").get(key);
    if (!row) throw new Error(`missing state ${key}`);
    return JSON.parse(String(row.v)) as T;
  }
  function claimStore(): TickClaimStore {
    return {
      claim(id: string): boolean {
        return Number(meta.prepare("INSERT OR IGNORE INTO claims (tick_id, at) VALUES (?, ?)").run(id, now()).changes) === 1;
      },
      release(id: string): void { meta.prepare("DELETE FROM claims WHERE tick_id = ?").run(id); },
    };
  }
  function writeReport(extra: Record<string, unknown> = {}): void {
    const body = {
      pid: process.pid,
      ...extra,
      runs: runsSql.prepare("SELECT id, status, parent_run, summary FROM runs_items").all(),
      steps: runsSql.prepare("SELECT run_id, step, attempt, state FROM runs_steps ORDER BY run_id, ord, attempt").all(),
      effects: meta.prepare("SELECT cap, input FROM effects ORDER BY id").all(),
      links: autoSql.prepare("SELECT run_id, parent_run, scope FROM automations_runs").all(),
      claims: meta.prepare("SELECT tick_id FROM claims").all(),
      tasks: meta.prepare("SELECT id, state, source_id FROM tasks").all(),
    };
    writeFileSync(path.join(dir, "report.json"), JSON.stringify(body));
  }

  if (args.scenario === "schedule") {
    await runSchedule();
    return;
  }
  if (args.phase === "boot") {
    const parentId = await boot(mainDef(args.scenario), args.scenario);
    host.enqueue(parentId);
    await drain();
    if (args.stall) throw new Error(`stall ${args.stall} was not reached`);
    writeReport();
    process.exit(0);
  }
  if (args.advance) setNow(now() + args.advance);
  await host.recover();
  await drain();
  if (args.advance) {
    const woken = await sweepWaits(runsCtx(null, engine));
    for (const id of woken) host.enqueue(id);
    await drain();
  }
  if (args.again) {
    await host.recover();
    await drain();
  }
  if (args.stall) throw new Error(`stall ${args.stall} was not reached`);
  writeReport();
  process.exit(0);

  async function runSchedule(): Promise<void> {
    const schedCall = async (cap: string, input: Record<string, unknown>): Promise<unknown> => {
      if (cap === "automations.fire") {
        logEffect(cap, input);
        const out = await autoCall(cap, input, engine) as { runId?: string; dropped?: string };
        if (out.dropped) throw new Error(`tick dropped ${out.dropped}`);
        if (args.stall === "fire" && input.idempotencyKey === loadState<string>("lastTick")) await hangFire();
        return out;
      }
      return externalCap(cap, input);
    };
    async function hangFire(): Promise<never> {
      writeReady("fire");
      return heldOpen();
    }
    if (args.phase === "boot") {
      const definition: Definition = {
        triggers: [{ key: "schedule", config: { cron: "0 * * * *", timezone: "UTC", missed: "backfill_each_tick", lookbackMs: 30 * DAY, cap: 10, spacingMs: 0, overlap: "queue" } }],
        start: ["work"],
        nodes: [node("work", "records.update", { type: "contact", recordId: "rec_1", patch: { step: "tick" } })],
      };
      const made = await autoCall("automations.create", { name: "Missed ticks", definition }, alice) as { automation: { id: string } };
      const automationId = made.automation.id;
      await autoCall("automations.set_enabled", { automationId, enabled: true }, alice);
      const spec: AutomationSchedule = {
        automationId, cron: "0 * * * *", timezone: "UTC", missed: "backfill_each_tick",
        lookbackMs: 30 * DAY, cap: 10, spacingMs: 0, overlap: "queue",
      };
      const planCtx: PlanContext = {
        now: Date.UTC(2026, 0, 4, 1, 30), cursor: Date.UTC(2026, 0, 1, 0, 0),
        ownerId: alice.id, sharedRecipientIds: ["usr_shared"], onTimeMs: 60_000,
      };
      const planned = planSchedule(spec, planCtx);
      if (!planned.ok || !planned.plan.request || !planned.plan.paused || planned.plan.ticks.length !== 0) {
        throw new Error(`schedule did not trip the cap ${JSON.stringify(planned)}`);
      }
      await deliverScheduleNeedsYou(schedCall, planned.plan.request, new Set());
      const choice = applyScheduleChoice(spec, planned.plan.backlog, new Set(), "run_latest_n", { n: 5, now: planCtx.now, cursor: planCtx.cursor });
      if (!choice.ok || choice.ticks.length !== 5) throw new Error(`expected 5 ticks ${JSON.stringify(choice)}`);
      const last = choice.ticks.reduce((a, b) => (a.fireAt >= b.fireAt ? a : b));
      saveState("ticks", choice.ticks);
      saveState("request", planned.plan.request);
      saveState("now", planCtx.now);
      saveState("cron", spec.cron);
      saveState("lastTick", last.tickId);
      await startScheduledTicks(schedCall, choice.ticks, { now: planCtx.now, cron: spec.cron, claim: claimStore() });
      throw new Error("stall fire was not reached");
    }
    const ticks = loadState<TickPlan[]>("ticks");
    const request = loadState<NeedsYouRequest>("request");
    const at = loadState<number>("now");
    const cron = loadState<string>("cron");
    const claim = claimStore();
    const open = await loadOpenScheduleKeys(schedCall);
    const first = await deliverScheduleNeedsYou(schedCall, request, open);
    const started = await startScheduledTicks(schedCall, ticks, { now: at, cron, claim });
    const openAgain = await loadOpenScheduleKeys(schedCall);
    const second = await deliverScheduleNeedsYou(schedCall, request, openAgain);
    const startedAgain = await startScheduledTicks(schedCall, ticks, { now: at, cron, claim });
    writeReport({
      firstCreated: first.created,
      firstStarted: started.started.length,
      firstIgnored: started.ignored.length,
      secondCreated: second.created,
      secondStarted: startedAgain.started.length,
      secondIgnored: startedAgain.ignored.length,
    });
    process.exit(0);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
