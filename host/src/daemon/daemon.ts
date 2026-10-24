// vyred (ARCH 1.2): the one binary. `startDaemon` boots a host in one or both roles.
//   space   events.db (kernel, single writer) -> access snapshot -> module loader (modules.json + registry) -> invoke pipeline -> gateway and live socket on one HTTP server,
//           modules.db for every module's tables, the log sink, the supervisor and scheduler, host probes and the two command queues the Console writes.
//   device  the person's computer: supervisor, scheduler, the disk and clock probes, and the local HTTP face (/healthz) the desktop shell and the CLI reach. Local turns, the vault filler and
//           the Chrome bridge register as supervised services (`options.services`) when their lanes land.
// Nothing here knows a module's internals: module code only ever sees the ctx the loader builds.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authorize } from "../../../kernel/src/authorize/index.ts";
import { LogClient } from "../../../kernel/src/log/index.ts";
import { registry } from "../../../generated/registry.ts";
import { routes } from "../../../generated/routes.ts";
import { validateEvent, validateInput } from "../../../generated/validators.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import type { CapabilityDef } from "../../../packages/contracts/src/types.ts";
import { createCtxSeal } from "../ctx/seal.ts";
import { ScheduleQueue } from "../ctx/schedule.ts";
import type { ScheduledCall } from "../ctx/schedule.ts";
import { hostServices, invokeRunner } from "../ctx/services.ts";
import { createGateway, indexRoutes } from "../gateway.ts";
import { withEventIds } from "../ids.ts";
import type { GatewayDeps, RouteRec } from "../gateway.ts";
import { createInvoke, createRateLimiter, fail, indexCapabilities, makeError } from "../invoke.ts";
import type { AuditRow, Handler } from "../invoke.ts";
import { fileImporter, loadHost, readModuleList } from "../loader.ts";
import type { RegistryLike } from "../loader.ts";
import { LogSink } from "../logsink/index.ts";
import { nodePlatform } from "../platform/index.ts";
import type { Platform } from "../platform/index.ts";
import * as probes from "../platform/probes.ts";
import type { FetchFn, ProbeName, ProbeResult } from "../platform/probes.ts";
import { Scheduler } from "../scheduler/index.ts";
import { Supervisor } from "../supervisor/index.ts";
import type { RunningUnit, ServiceSpec, UnitExit } from "../supervisor/index.ts";
import { wireSeams } from "../seams/index.ts";
import type { SeamDeps, SeamSetters, VaultPort, WiredSeams } from "../seams/index.ts";
import { createLiveHub } from "../ws.ts";
import type { LiveHub } from "../ws.ts";
import { createAccess } from "./access.ts";
import { fromStored, toNew } from "./commit.ts";
import { defaultNetworkPort, pollCommands } from "./commands.ts";
import type { NetworkPort } from "./commands.ts";
import { alive, clearInfo, ensureAdminToken, ensureDirs, pathsFor, readInfo, writeInfo } from "./config.ts";
import type { DaemonConfig, DaemonPaths, Role } from "./config.ts";
import { migrate } from "./hosttables.ts";
import { requestListener } from "./http.ts";
import { coerceQuery } from "./query.ts";
import type { PropSchema } from "./query.ts";
import { openDb, readLogMeta } from "./sqlite.ts";
import type { HostDb } from "./sqlite.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The repo (or install) root that holds generated/, modules/ and host/modules.json. */
export const CODE_ROOT = path.resolve(HERE, "../../..");
const ZERO_TRACE = "0".repeat(32);
const RING = 5000;

const refusingVault: VaultPort = {
  secret: () => Promise.reject(new Error("The Vault is not live on this server.")),
  signRs256: () => Promise.reject(new Error("The Vault is not live on this server.")),
};

/** The seal key lives beside the event log, readable by this user only; it is created at the first start and never printed or logged. */
function sealKeyFile(file: string): string {
  try {
    const t = fs.readFileSync(file, "utf8").trim();
    if (t.length >= 32) return t;
  } catch { /* first start */ }
  const t = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, `${t}\n`, { mode: 0o600 });
  return t;
}

export interface DaemonOptions {
  config: DaemonConfig;
  codeRoot?: string;
  platform?: Platform;
  fetch?: FetchFn;
  network?: NetworkPort;
  /** replace a probe (P-L7b_04 supplies the recorded-output disk check) */
  probes?: { diskEncrypted?: () => Promise<ProbeResult>; indexLag?: () => number | null };
  /** more supervised services: Caddy, the vault filler, the Chrome bridge, local turns */
  services?: ServiceSpec[];
  /** capabilities, routes, handlers and event names beyond the generated registry (tests register example.echo; later lanes register host-only calls) */
  extra?: { caps?: CapabilityDef[]; routes?: RouteRec[]; handlers?: Record<string, Handler>; events?: string[] };
  /** The Vault, as the connector seams use it. Without one the seams that need a secret refuse, which is right until the Vault module is live. */
  vault?: VaultPort;
  /** Where the Google, Microsoft and IMAP seams register (the module files' setters) and the Space ports they read. Omitted: no seam is wired. */
  seams?: { setters: SeamSetters } & Omit<SeamDeps, "vault">;
  /** The key behind ctx.seal. Omitted: a random 32-byte key kept in <data dir>/seal.key (0600). */
  sealKey?: { key: Uint8Array | string; keyId: string };
  /** replace the default session (the local admin token) */
  session?: GatewayDeps["session"];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** intervals in ms; tests shorten them */
  intervals?: { tick?: number; commands?: number; fast?: number; slow?: number; encryption?: number };
}

export interface Daemon {
  url: string;
  port: number;
  token: string;
  roles: Role[];
  space: string | null;
  paths: DaemonPaths;
  supervisor: Supervisor;
  scheduler: Scheduler;
  /** modules.db, space role only */
  db: HostDb | null;
  /** ctx.schedule jobs (Gate timeouts, escalations, retry-later), space role only; the daemon ticks it every second */
  schedule: ScheduleQueue | null;
  /** which connector seams were wired at boot, space role only */
  seams: WiredSeams | null;
  sink: LogSink;
  log: LogClient | null;
  /** run probes now (all by default), write them, and return the results */
  runProbes(names?: readonly ProbeName[]): Promise<Partial<Record<ProbeName, ProbeResult>>>;
  /** do every open restart and network command now */
  pollCommands(): Promise<number>;
  stop(): Promise<void>;
}

/** Equal strings in time that does not depend on where they differ. */
function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const bearer = (h: string | undefined): string | null => {
  const m = /^Bearer\s+(\S+)$/i.exec(h ?? "");
  return m ? m[1]! : null;
};

export async function startDaemon(o: DaemonOptions): Promise<Daemon> {
  const cfg = o.config;
  const now = o.now ?? Date.now;
  const codeRoot = o.codeRoot ?? CODE_ROOT;
  const platform = o.platform ?? nodePlatform();
  const hasSpace = cfg.roles.includes("space");
  const paths = pathsFor(cfg.dataDir);
  ensureDirs(paths);

  const existing = readInfo(paths);
  if (existing && existing.pid !== process.pid && alive(existing.pid)) throw new Error(`vyred is already running for ${paths.root} (pid ${existing.pid})`);

  const token = ensureAdminToken(paths);
  const sink = new LogSink({ path: paths.logs, now, secrets: () => [token] });
  const closers: (() => Promise<void> | void)[] = [() => sink.close()];
  const fetchFn: FetchFn | null = o.fetch ?? (typeof fetch === "function" ? (fetch as unknown as FetchFn) : null);

  let space: string | null = cfg.space ?? (hasSpace ? readLogMeta(paths.events, "space") : null);
  let db: HostDb | null = null;
  let queue: ScheduleQueue | null = null;
  let seams: WiredSeams | null = null;
  let log: LogClient | null = null;
  const probeState = new Map<ProbeName, ProbeResult>();
  const recent: EventEnvelope[] = [];
  let chainBroken = false;
  let verified = { seq: 0, hash: "" };
  let hub: LiveHub | null = null;
  let hubFactory: (() => LiveHub) | null = null;
  let routeIndex: ((method: string, path: string) => RouteRec | undefined) | null = null;
  let capIndex: ReturnType<typeof indexCapabilities> | null = null;
  let boundPort = cfg.port;
  let gateway: ReturnType<typeof createGateway> | null = null;
  let headSeq = 0;
  const access = createAccess();

  const writeProbe = (name: ProbeName, r: ProbeResult): void => {
    probeState.set(name, r);
    db?.run(
      "INSERT INTO health_probe (name, state, detail, latency_ms, values_json, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET state = excluded.state, detail = excluded.detail, latency_ms = excluded.latency_ms, values_json = excluded.values_json, at = excluded.at",
      name, r.state, r.detail ?? null, r.latencyMs ?? null, r.values ? JSON.stringify(r.values) : null, now(),
    );
  };

  const supervisor = new Supervisor({
    now,
    ...(o.sleep ? { sleep: o.sleep } : {}),
    log: sink.logger({ space: space ?? "-", place: "supervisor" }),
    report: (s) => {
      db?.run(
        "INSERT INTO health_service (name, state, started_at, restarts) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET state = excluded.state, started_at = excluded.started_at, restarts = excluded.restarts",
        s.name, s.state, s.startedAt, s.restarts,
      );
      sink.log({ space: space ?? "-", level: s.state === "down" ? 30 : 20, msg: "service.state", place: "supervisor", entity: "service", entity_id: s.name, attrs: { state: s.state, phase: s.phase, restarts: s.restarts } });
    },
  });
  const scheduler = new Scheduler({
    now, tickMs: o.intervals?.tick ?? 1000, log: sink.logger({ space: space ?? "-", place: "scheduler" }),
    onRun: (r) => sink.log({ space: space ?? "-", level: r.ok ? 10 : 40, msg: "job.ran", place: "scheduler", entity: "job", entity_id: r.job, dur_ms: r.ms, result: r.ok ? "ok" : "error", ...(r.error ? { attrs: { error: r.error } } : {}) }),
  });

  try {
    if (hasSpace) {
      // ---- the Space: modules.db, events.db, access, handlers, invoke, gateway
      db = openDb(paths.modules);
      closers.push(() => db?.close());
      migrate(db, codeRoot, now);
      if (!space) throw new Error("this data directory has no Space yet: pass --space <id> to create one");
      log = await LogClient.open({ path: paths.events, space });
      closers.push(() => log?.close());
      const first = await log.verify();
      if (first.ok) verified = { seq: first.seq, hash: first.head }; else chainBroken = true;
      sink.log({ space, level: first.ok ? 20 : 40, msg: "events.verified", place: "boot", result: first.ok ? "ok" : "broken", attrs: first.ok ? { seq: first.seq } : { at: first.at, why: first.why } });
      for (let after = 0; ;) {
        const page = await log.read({ after, limit: 5000 });
        for (const e of page) access.fold(e);
        if (page.length < 5000) break;
        after = page[page.length - 1]!.seq;
      }
      headSeq = (await log.currentHead()).seq;

      const reg = registry as unknown as RegistryLike;
      const loaded = await loadHost({ registry: reg, modulesJson: readModuleList(path.join(codeRoot, "host/modules.json")), routes, importer: fileImporter(codeRoot), db });
      const caps = [...(registry.capabilities as unknown as CapabilityDef[]), ...(o.extra?.caps ?? [])];
      const extraCaps = new Set((o.extra?.caps ?? []).map((c) => c.name));
      const extraEvents = new Set([...(o.extra?.events ?? []), ...(o.extra?.caps ?? []).flatMap((c) => c.emits as string[])]);
      const idem = log.idempotency();
      const sinkLog = sink.invokeLogger(space);
      const spaceId = space;
      // The audit trail proper (hash chain, signed checkpoints) is the audit module's (L7a); until it lands every allow, deny and hold row also goes to logs.db as `audit`.
      const recordAudit = (r: AuditRow): void => {
        sink.log({ space: spaceId, level: 20, msg: "audit", trace_id: r.traceId, span_id: r.spanId, cap: r.cap, actor: r.principal, ...(r.actingFor ? { on_behalf: r.actingFor } : {}), result: r.class, attrs: { decisionId: r.decisionId, reason: r.reason } });
      };

      // ctx.schedule: jobs live in modules.db, so a restart keeps them; each runs through the invoke pipeline as the principal that scheduled it (invokeRunner)
      let runScheduled: (call: ScheduledCall) => Promise<void> = () => Promise.reject(new Error("the invoke pipeline is not ready"));
      const scheduleQueue = new ScheduleQueue({
        db, now, run: (c) => runScheduled(c),
        onError: (c, e, final) => sinkLog.warn("schedule.failed", { cap: c.cap, id: c.id, tries: c.tries + 1, final, error: e instanceof Error ? e.message : String(e) }),
      });
      queue = scheduleQueue;
      const seal = createCtxSeal(o.sealKey ?? { key: sealKeyFile(path.join(paths.root, "seal.key")), keyId: "k1" });

      const invoke = createInvoke({
        caps: indexCapabilities(caps),
        validateInput: (cap, v, input) => (extraCaps.has(cap) ? [] : validateInput(cap, v, input)),
        validateEvent: (name, payload) => (extraEvents.has(name) ? [] : validateEvent(name, payload)),
        authorize: (r) => authorize(access.snap, r),
        handler: (cap, v) => o.extra?.handlers?.[cap] ?? loaded.handler(cap, v),
        services: hostServices({ base: loaded.services, seal, queue: scheduleQueue }),
        idem, rate: createRateLimiter(), now, log: sinkLog,
        commit: withEventIds(async (b) => {
          const trace = b.events[0]?.traceId ?? ZERO_TRACE;
          if (chainBroken) throw fail("internal.unavailable", trace, { message: "The event log failed verification, so this server is not accepting changes. Run vyre-server doctor." });
          const stored = await Promise.all(b.events.map((e) => log!.append(toNew(e))));
          const out = stored.map((s, i) => fromStored(s, b.events[i]!));
          for (const s of stored) access.fold(s);
          headSeq = Math.max(headSeq, ...out.map((e) => e.seq));
          if (b.audit) recordAudit(b.audit);
          return out;
        }),
        audit: (r) => recordAudit(r),
        publish: (events) => {
          recent.push(...events);
          if (recent.length > RING) recent.splice(0, recent.length - RING);
          hub?.publish(spaceId, events);
        },
        onSpan: (s) => sink.span({ trace_id: s.traceId, span_id: s.spanId, parent: s.parent ?? null, name: s.name, at: s.startedAt, dur_us: s.ms * 1000, attrs: { cap: s.cap, status: s.status } }),
      });

      runScheduled = invokeRunner(invoke);
      if (o.seams) {
        const { setters, ...ports } = o.seams;
        seams = wireSeams(setters, { vault: o.vault ?? refusingVault, ...ports });
        closers.push(() => seams?.unwire());
      }

      const owner = (): string => cfg.owner ?? access.owner() ?? "usr_owner";
      const session: GatewayDeps["session"] = o.session ?? ((headers) => {
        const t = bearer(headers["authorization"]);
        if (!t || !sameToken(t, token)) return null;
        return { space: spaceId, principal: { kind: "person", id: owner() }, device: headers["x-vyre-device"] ?? "local-admin" };
      });
      gateway = createGateway({ invoke, caps: indexCapabilities(caps), routes: [...routes, ...(o.extra?.routes ?? [])], session });
      routeIndex = indexRoutes([...routes, ...(o.extra?.routes ?? [])]);   // a duplicate route is a boot error, not a first-request error
      capIndex = indexCapabilities(caps);

      const mkHub = (): LiveHub => createLiveHub({
        session: (h, url) => {
          const t = bearer(h["authorization"]) ?? url.searchParams.get("token");
          if (!t || !sameToken(t, token)) return null;
          return { space: spaceId, principal: { kind: "person", id: owner() }, device: url.searchParams.get("device") ?? "local-admin" };
        },
        invoke, sink,
        eventsSince: (_s, cursor) => (recent.length && recent[0]!.seq <= cursor + 1 ? recent.filter((e) => e.seq > cursor) : []),
        head: () => headSeq,
      });
      hubFactory = mkHub;
    } else {
      sink.log({ space: "-", level: 20, msg: "boot.device", place: "boot" });
    }
  } catch (e) {
    for (const c of closers.reverse()) await Promise.resolve(c()).catch(() => {});
    throw e;
  }

  // ---- probes
  const events = async (): Promise<ProbeResult> => {
    if (!log) return { state: "healthy", detail: "No event log in this role." };
    const t0 = now();
    const v = await log.verify(verified.seq > 0 ? { from: verified.seq, prev: verified.hash } : {});
    if (v.ok) { verified = { seq: v.seq, hash: v.head }; chainBroken = false; return probes.eventsDb({ ok: true, seq: v.seq, latencyMs: now() - t0 }); }
    chainBroken = true;
    return probes.eventsDb({ ok: false, seq: verified.seq, why: `${v.why} at event ${v.at}`, latencyMs: now() - t0 });
  };
  const probeFns: Record<ProbeName, () => Promise<ProbeResult> | ProbeResult> = {
    disk_encrypted: () => (o.probes?.diskEncrypted ? o.probes.diskEncrypted() : probes.diskEncrypted(platform, paths.root)),
    events_db: events,
    index_db: () => probes.indexLag(o.probes?.indexLag ? o.probes.indexLag() : null),
    scheduler: () => probes.schedulerTick(scheduler.lastTickAt, now()),
    docker: () => probes.docker(platform),
    caddy: () => (fetchFn ? probes.caddy(fetchFn, cfg.caddyAdmin, now) : { state: "down", detail: "No HTTP client to reach the Caddy admin API." }),
    disk_space: () => probes.diskSpace(platform, paths.root),
    time_skew: () => probes.timeSkew(fetchFn, cfg.relayUrl, now),
  };
  const relevant: readonly ProbeName[] = hasSpace ? probes.PROBE_NAMES : ["disk_encrypted", "scheduler", "disk_space", "time_skew"];
  const runProbes = async (names: readonly ProbeName[] = relevant): Promise<Partial<Record<ProbeName, ProbeResult>>> => {
    const out: Partial<Record<ProbeName, ProbeResult>> = {};
    for (const name of names) {
      let r: ProbeResult;
      try { r = await probeFns[name](); } catch (e) { r = { state: "down", detail: `The probe failed: ${e instanceof Error ? e.message : String(e)}` }; }
      writeProbe(name, r);
      out[name] = r;
    }
    return out;
  };

  // What the host knows about itself goes into the network module's tables so Console, Infrastructure, Network has something true to show: the address, this server, the direct endpoint.
  const reportNetwork = (): void => {
    if (!db) return;
    const t = now();
    const url = `http://${cfg.host}:${boundPort}`;
    const relayHost = cfg.relayUrl ? new URL(cfg.relayUrl).host : null;
    const address = cfg.address ?? url;
    db.run(
      "INSERT INTO network_config (id, address, mode, domain, relay_address, public_ingress, ingress_detail, reported_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET reported_at = excluded.reported_at, relay_address = COALESCE(excluded.relay_address, network_config.relay_address)",
      address, cfg.relayUrl && !cfg.address ? "relay" : "own_domain", cfg.address, relayHost, cfg.address || cfg.relayUrl ? 1 : 0, cfg.address || cfg.relayUrl ? null : "Forms and webhooks need a public address.", t,
    );
    db.run(
      "INSERT INTO network_server (server_id, name, role, state, heartbeat_at) VALUES ('srv_local', ?, 'space', ?, ?) ON CONFLICT(server_id) DO UPDATE SET state = excluded.state, heartbeat_at = excluded.heartbeat_at, name = excluded.name",
      platform.hostname, chainBroken ? "degraded" : "healthy", t,
    );
    db.run(
      "INSERT INTO network_endpoint (kind, url, state, rtt_ms, heartbeat_at) VALUES ('direct', ?, 'healthy', NULL, ?) ON CONFLICT(kind, url) DO UPDATE SET state = excluded.state, heartbeat_at = excluded.heartbeat_at",
      /^https?:\/\//.test(address) ? address : `https://${address}`, t,
    );
  };

  const network = o.network ?? defaultNetworkPort();
  const runCommands = (): Promise<number> => (db ? pollCommands({ db, supervisor, network, now, log: sink.logger({ space: space ?? "-", place: "commands" }) }) : Promise.resolve(0));

  const fast = o.intervals?.fast ?? 15_000, slow = o.intervals?.slow ?? 60_000;
  const group = (names: ProbeName[]): ProbeName[] => names.filter((n) => relevant.includes(n));
  scheduler.add({ name: "probes.fast", schedule: { everyMs: fast }, run: async () => { await runProbes(group(["events_db", "index_db", "scheduler", "disk_space"])); } });
  scheduler.add({ name: "probes.slow", schedule: { everyMs: slow }, run: async () => { await runProbes(group(["docker", "caddy", "time_skew"])); reportNetwork(); } });
  scheduler.add({ name: "probes.encryption", schedule: { everyMs: o.intervals?.encryption ?? 300_000 }, run: async () => { await runProbes(group(["disk_encrypted"])); } });
  if (hasSpace) {
    scheduler.add({ name: "commands.poll", schedule: { everyMs: o.intervals?.commands ?? 1000 }, run: async () => { await runCommands(); } });
    scheduler.add({ name: "schedule.tick", schedule: { everyMs: o.intervals?.tick ?? 1000 }, run: async () => { await queue?.tick(); } });
    scheduler.add({ name: "idempotency.purge", schedule: { daily: { hour: 4, minute: 0 } }, run: async () => { await log?.purgeIdempotency(); } });
  }

  // ---- services
  const startedAt = now();
  const health = (): unknown => ({
    ok: !chainBroken,
    version: cfg.version, roles: cfg.roles, space, head: headSeq, startedAt,
    services: supervisor.status().map((s) => ({ name: s.name, state: s.state, restarts: s.restarts })),
    probes: Object.fromEntries([...probeState].map(([k, v]) => [k, v.state])),
  });

  const coerce = (method: string, p: string, query: Record<string, string>): Record<string, unknown> => {
    const route = routeIndex?.(method, p);
    const cap = route ? capIndex?.get(route.cap, route.v) : undefined;
    return coerceQuery(query, (cap as unknown as { input?: { properties?: Record<string, PropSchema> } } | undefined)?.input?.properties);
  };

  const gatewayUnit = async (): Promise<RunningUnit> => {
    const h = hubFactory ? hubFactory() : createLiveHub({ session: () => null });
    hub = h;
    const server = h.server;
    server.removeAllListeners("request");
    server.on("request", requestListener({
      health, coerce,
      gateway: gateway ?? (() => Promise.resolve({ status: 404, headers: {}, body: { error: makeError("validation.unknown_capability", ZERO_TRACE, { message: "This daemon runs the device role only; it has no Space API." }) } })),
    }));
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => reject(err);
      server.once("error", onError);
      server.listen(boundPort, cfg.host, () => { server.off("error", onError); resolve(); });
    });
    boundPort = (server.address() as { port: number }).port;
    const exited = new Promise<UnitExit>((resolve) => {
      server.once("close", () => resolve({ code: 0 }));
      server.on("error", (err) => resolve({ error: err.message }));
    });
    return { exited, stop: () => h.close() };
  };
  const schedulerUnit = (): Promise<RunningUnit> => {
    scheduler.start();
    return Promise.resolve({ exited: new Promise<UnitExit>(() => {}), stop: () => scheduler.stop() });
  };

  supervisor.add({ name: "gateway", start: gatewayUnit });
  supervisor.add({ name: "scheduler", start: schedulerUnit });
  for (const s of o.services ?? []) supervisor.add(s);
  closers.push(() => supervisor.stopAll());

  try {
    await supervisor.startAll();
    if (supervisor.status("gateway")[0]?.phase !== "running") throw new Error(`the gateway did not start on ${cfg.host}:${cfg.port}`);
    await runProbes();
    reportNetwork();
    writeInfo(paths, { pid: process.pid, url: `http://${cfg.host}:${boundPort}`, port: boundPort, roles: cfg.roles, space, version: cfg.version, startedAt });
    sink.log({ space: space ?? "-", level: 20, msg: "daemon.started", place: "boot", attrs: { roles: cfg.roles, port: boundPort, version: cfg.version } });
  } catch (e) {
    for (const c of closers.reverse()) await Promise.resolve(c()).catch(() => {});
    clearInfo(paths);
    throw e;
  }

  let stopped = false;
  return {
    url: `http://${cfg.host}:${boundPort}`, port: boundPort, token, roles: cfg.roles, space, paths, supervisor, scheduler, db, schedule: queue, seams, sink, log,
    runProbes, pollCommands: runCommands,
    async stop() {
      if (stopped) return;
      stopped = true;
      sink.log({ space: space ?? "-", level: 20, msg: "daemon.stopping", place: "boot" });
      for (const c of closers.reverse()) await Promise.resolve(c()).catch(() => {});
      clearInfo(paths);
    },
  };
}

