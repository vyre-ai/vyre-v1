// vyred (ARCH 1.2): the one binary. `startDaemon` boots a host in one or both roles.
//   space   events.db (kernel, single writer) -> access snapshot -> module loader (modules.json + registry) -> invoke pipeline -> gateway and live socket on one HTTP server,
//           modules.db for every module's tables, the log sink, the supervisor and scheduler, host probes and the two command queues the Console writes.
//   device  the person's computer: supervisor, scheduler, the disk and clock probes, and the local HTTP face (/healthz) the desktop shell and the CLI reach. Local turns, the vault filler and
//           the Chrome bridge register as supervised services (`options.services`) when their lanes land.
// Nothing here knows a module's internals: module code only ever sees the ctx the loader builds.
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authorize } from "../../../kernel/src/authorize/index.ts";
import type { AccessSnapshot } from "../../../kernel/src/authorize/index.ts";
import { LogClient } from "../../../kernel/src/log/index.ts";
import { registry } from "../../../generated/registry.ts";
import { routes } from "../../../generated/routes.ts";
import { validateEvent, validateInput } from "../../../generated/validators.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import type { CapabilityDef } from "../../../packages/contracts/src/types.ts";
import { createCtxSeal } from "../ctx/seal.ts";
import { ScheduleQueue } from "../ctx/schedule.ts";
import type { ScheduledCall } from "../ctx/schedule.ts";
import { createBlobStore } from "../ctx/blobs.ts";
import { scopedDb } from "../ctx/db.ts";
import { createBlobRoute } from "../routes/blobs.ts";
import { createPortalLinkRoute } from "../routes/portal-link.ts";
import { createShareRoute } from "../routes/share.ts";
import type { SharedView } from "../routes/share.ts";
import { createFormsPageRoute } from "../routes/forms-page.ts";
import type { PublicFormView } from "../routes/forms-page.ts";
import { deferredCaps, deferredModules } from "../routes/deferred.ts";
import { hostServices, invokeRunner } from "../ctx/services.ts";
import { createGateway, indexRoutes } from "../gateway.ts";
import { withEventIds } from "../ids.ts";
import type { GatewayDeps, RouteRec } from "../gateway.ts";
import { createInvoke, createRateLimiter, fail, indexCapabilities, makeError, personalMatrix } from "../invoke.ts";
import type { AuditRow, Handler, Invoke, InvokeDeps } from "../invoke.ts";
import { fileExportsImporter, fileImporter, fileSeamImporter, loadHost, readModuleList } from "../loader.ts";
import type { RegistryLike } from "../loader.ts";
import { LogSink } from "../logsink/index.ts";
import { nodePlatform } from "../platform/index.ts";
import type { FetchLike } from "../ctx/http.ts";
import type { Platform } from "../platform/index.ts";
import * as probes from "../platform/probes.ts";
import type { FetchFn, ProbeName, ProbeResult } from "../platform/probes.ts";
import { Scheduler } from "../scheduler/index.ts";
import { Supervisor } from "../supervisor/index.ts";
import type { RunningUnit, ServiceSpec, UnitExit } from "../supervisor/index.ts";
import { createGateHook, moduleWhens } from "./gate-hook.ts";
import { withGateNesting } from "./gate-nesting.ts";
import { createComputersFillHost, createFillRoute } from "../seams/computers.ts";
import { createComputersHost } from "../seams/computers-host.ts";
import { createEngineHost } from "../seams/engine.ts";
import { createEventsHost } from "../seams/events-ports.ts";
import { applyPendingRestore, clearRestoredTombstones, createBackupHost, readRestoredTombstones } from "../seams/backup.ts";
import { createKitsHost } from "../seams/kits.ts";
import { startRelayBox } from "../seams/relay.ts";
import { createSyncSeam } from "../seams/sync.ts";
import { createVaultExportRoute } from "../routes/vault-export.ts";
import { createWebhookRoute } from "../routes/webhooks.ts";
import { createRunsHost } from "../seams/runs.ts";
import type { WebhookAccept } from "../routes/webhooks.ts";
import { sha256b64 } from "../../../kernel/src/seal/index.ts";
import { createLocalKeyRoute } from "../routes/local-key.ts";
import { createKeyring } from "../seams/keyring.ts";
import { createPeopleExtras, githubOAuthFromEnv } from "../seams/people.ts";
import type { GithubOAuth } from "../seams/people.ts";
import { createSpaceAdmin } from "../seams/spaceadmin.ts";
import { preAuthSession } from "./preauth.ts";
import { createProviderProbe, createVaultService, resolveVaultItem } from "../seams/vault.ts";
import type { PostFetch } from "../seams/events-ports.ts";
import { createPushPort, wireSeams } from "../seams/index.ts";
import { createPortalHost } from "../seams/comms.ts";
import { createUpdatesHost } from "../seams/updates.ts";
import type { PushTransportDeps, SeamDeps, SeamDriver, SeamSetters, VaultPort, WiredSeams } from "../seams/index.ts";
import { createLiveHub } from "../ws.ts";
import type { LiveHub, SyncHubPort } from "../ws.ts";
import { bootstrapSpace, mintOwner } from "./bootstrap.ts";
import { createAccess, isAccessEvent, isMemberOrGuest, toAccessEvent, touchesAccess } from "./access.ts";
import { ADMIN_DEVICE, createSessionResolver, issueSessionToken, sessionLive } from "./session.ts";
import { createResourceRegistrar } from "../gateway/resources.ts";
import { createPrincipalRegistrar } from "../gateway/principals.ts";
import { fromStored, toNew } from "./commit.ts";
import { collectHooks, createHookRunner, SYSTEM_PRINCIPAL } from "./consumers.ts";
import type { HookRunner, ModuleHooks } from "./consumers.ts";
import { createSpaceStore, spaceStoreDrivers, spaceStorePath } from "./store.ts";
import { coreOf, createSyncEngine } from "./syncengine.ts";
import { collectProjections, createProjectionRunner } from "./projections.ts";
import type { ProjectionRunner } from "./projections.ts";
import { defaultNetworkPort, pollCommands } from "./commands.ts";
import type { NetworkPort } from "./commands.ts";
import { alive, clearInfo, ensureAdminToken, ensureDirs, pathsFor, readInfo, writeInfo } from "./config.ts";
import type { DaemonConfig, DaemonPaths, Role } from "./config.ts";
import { migrate } from "./hosttables.ts";
import { requestListener } from "./http.ts";
import { createChromeBridge } from "../bridge/chrome.ts";
import type { ChromeBridge } from "../bridge/chrome.ts";
import { coerceQuery } from "./query.ts";
import type { PropSchema } from "./query.ts";
import { openDb, readLogMeta } from "./sqlite.ts";
import type { HostDb } from "./sqlite.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The repo (or install) root that holds generated/, modules/ and host/modules.json. */
export const CODE_ROOT = path.resolve(HERE, "../../..");
/** What a device compares its registry with at hello (sync): the hash of registry.json, which the generated module no longer exports (ci: no global hash). */
const registryHash = sha256b64(fs.readFileSync(new URL("../../../generated/registry.json", import.meta.url)));
const ZERO_TRACE = "0".repeat(32);
const RING = 5000;

const refusingVault: VaultPort = {
  secret: () => Promise.reject(new Error("The Vault is not live on this server.")),
  signRs256: () => Promise.reject(new Error("The Vault is not live on this server.")),
};

/** The seal key lives beside the event log, readable by this user only; it is created at the first start and never printed or logged. */
/** identity.whoami also lists the capabilities this server defers (ruling 60): the one bootstrap a signed-in client already makes, so the app can hide a deferred place. */
function whoamiWithDeferred(cap: string, h: Handler | undefined): Handler | undefined {
  if (!h || cap !== "identity.whoami") return h;
  return (async (ctx, input) => ({ ...((await h(ctx, input)) as object), deferred: deferredCaps(), deferredModules: deferredModules(registry.capabilities) })) as Handler;
}

function sealKeyFile(file: string): string {
  try {
    const t = fs.readFileSync(file, "utf8").trim();
    if (t.length >= 32) return t;
  } catch { /* first start */ }
  const t = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  fs.writeFileSync(file, `${t}\n`, { mode: 0o600 });
  return t;
}

export interface DaemonOptions {
  /** GitHub sign-in (default: VYRE_GH_OAUTH_CLIENT_ID and VYRE_GH_OAUTH_CLIENT_SECRET from the environment; null: not set up) */
  githubOAuth?: GithubOAuth | null;
  config: DaemonConfig;
  codeRoot?: string;
  platform?: Platform;
  fetch?: FetchFn;
  network?: NetworkPort;
  /** replace a probe (P-L7b_04 supplies the recorded-output disk check) */
  probes?: { diskEncrypted?: () => Promise<ProbeResult>; indexLag?: () => number | null };
  /** The Personal Space gate (the sync module's createPersonalHost(...).gate) asked first for every capability; omitted on a Team Space. */
  personal?: InvokeDeps["personal"];
  /** more supervised services: Caddy, the vault filler, the Chrome bridge, local turns */
  services?: ServiceSpec[];
  /** capabilities, routes, handlers and event names beyond the generated registry (tests register example.echo; later lanes register host-only calls) */
  extra?: { caps?: CapabilityDef[]; routes?: RouteRec[]; handlers?: Record<string, Handler>; events?: string[] };
  /** the network under ctx.http (each module still reaches only its connector's domains); tests answer provider calls with it. Omitted: the global fetch. */
  http?: FetchLike;
  /** The Vault, as the connector seams use it. Without one the seams that need a secret refuse, which is right until the Vault module is live. */
  vault?: VaultPort;
  /** The Space ports the Google, Microsoft and IMAP seams read, and (for tests) setters that replace the ones the modules export as `hostSeams`. Omitted ports refuse. */
  seams?: {
    setters?: SeamSetters;
    /** more drivers by setter name (a module's own `configureX`), added to the built-in and daemon ones */
    drivers?: Record<string, SeamDriver>;
    /** the APNs/FCM transport behind the notifications push port; omitted: pushes are recorded as not pushed */
    push?: PushTransportDeps;
    /** the domains a signed webhook may reach; omitted: none */
    webhookAllow?: () => readonly string[];
    postFetch?: PostFetch;
    /** where a vault value may be filled, by kind (git_credential, container_env, env...): each receives the value for one call and must not keep or log it */
    vaultSinks?: Record<string, (f: { value: string; ref: string; handle: string; field: string; itemId: string }) => Promise<void> | void>;
  } & Partial<Omit<SeamDeps, "vault" | "drivers" | "owners">>;
  /** The address an agent computer reaches this daemon at (its container is not on localhost). Default http://host.docker.internal:<port>. */
  computersBaseUrl?: string;
  /** Where CLI engines run sandboxed (modules/engine/sandbox.ts SandboxPlan). Omitted: a CLI engine refuses to start. */
  engineSandbox?: unknown;
  /** Tests: swap a CLI engine's program for a command, and expose extra read-only folders in its sandbox (modules/engine runtime `cli`). */
  engineCli?: unknown;
  /** replace the consumers and periodic jobs read from the live modules' exports (tests) */
  hooks?: ModuleHooks[];
  /** The key behind ctx.seal. Omitted: a random 32-byte key kept in <data dir>/seal.key (0600). */
  sealKey?: { key: Uint8Array | string; keyId: string };
  /** replace the default session (the local admin token) */
  session?: GatewayDeps["session"];
  /** Sync's live hub (createSyncLiveHub) for the live socket: sockets then speak the sync protocol (full hello_ok, filtered ev batches). `onHub` receives the host hub, which is the port for sync's setLiveHub (purge, purgeDevice). */
  liveSync?: { hub: SyncHubPort; onHub?(hub: LiveHub): void };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** intervals in ms; tests shorten them */
  intervals?: { tick?: number; commands?: number; fast?: number; slow?: number; encryption?: number; hooks?: number; sweep?: number };
}

export interface Daemon {
  url: string;
  /** the one-time link the owner of a fresh Space opens to claim it (ruling 71); null once claimed or when this host did not make the Space */
  claim: { url: string; expiresAt: number } | null;
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
  /** which host drivers were wired at boot and which setters had none, space role only */
  seams: WiredSeams | null;
  /** the module consumers and periodic jobs, space role only */
  hooks: HookRunner | null;
  /** the module projections (events.webhooks_out), space role only */
  projections: ProjectionRunner | null;
  sink: LogSink;
  log: LogClient | null;
  /** run probes now (all by default), write them, and return the results */
  runProbes(names?: readonly ProbeName[]): Promise<Partial<Record<ProbeName, ProbeResult>>>;
  /** do every open restart and network command now */
  pollCommands(): Promise<number>;
  /** The Chrome bridge behind /chrome-bridge/v1/*: agent tool calls to the extension, and the extension's requests (apps/chrome native host) */
  chromeBridge: ChromeBridge;
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

  applyPendingRestore(paths.root);   // a restore staged by backup.restore is moved into place before any database is opened
  const existing = readInfo(paths);
  if (existing && existing.pid !== process.pid && alive(existing.pid)) throw new Error(`vyred is already running for ${paths.root} (pid ${existing.pid})`);

  const token = ensureAdminToken(paths);
  const sink = new LogSink({ path: paths.logs, now, secrets: () => [token] });
  const closers: (() => Promise<void> | void)[] = [() => sink.close()];
  const chromeBridge = createChromeBridge({ token, onEvent: (e) => sink.log({ space: "-", level: 20, msg: "chrome.agent_event", place: "chrome-bridge", attrs: { event: e.event, agent: typeof e["agent"] === "string" ? e["agent"] : "" } }) });
  closers.push(() => { chromeBridge.failAll(); chromeBridge.closeStreams(); });
  const fetchFn: FetchFn | null = o.fetch ?? (typeof fetch === "function" ? (fetch as unknown as FetchFn) : null);

  let space: string | null = cfg.space ?? (hasSpace ? readLogMeta(paths.events, "space") : null);
  let db: HostDb | null = null;
  let queue: ScheduleQueue | null = null;
  let seams: WiredSeams | null = null;
  let hooks: HookRunner | null = null;
  let projections: ProjectionRunner | null = null;
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
  let claim: { url: string; expiresAt: number } | null = null;
  let gateway: ReturnType<typeof createGateway> | null = null;
  let blobRoute: ReturnType<typeof createBlobRoute> | null = null;
  let portalLinkRoute: ReturnType<typeof createPortalLinkRoute> | null = null;
  let shareRoute: ReturnType<typeof createShareRoute> | null = null;
  let formsPageRoute: ReturnType<typeof createFormsPageRoute> | null = null;
  // GET /exports/<id>?token= (P-L7_16): the vault module checks the token; until it is configured every pull is refused
  let pullVaultExport: (exportId: string, token: string) => string = () => { throw new Error("the Vault is not live on this server"); };
  const exportRoute = createVaultExportRoute({ pull: (id, t) => pullVaultExport(id, t) });
  // POST /hooks/<connector> (P-L5_17): a provider's signed webhook; the connector module's host call `<connector>.accept_webhook` verifies the signature and records the event once
  let webhooks: { has(c: string): boolean; accept(c: string, a: WebhookAccept): Promise<unknown> } = { has: () => false, accept: () => Promise.reject(new Error("webhooks are not ready")) };
  const webhookRoute = createWebhookRoute({ has: (c) => webhooks.has(c), accept: (c, a) => webhooks.accept(c, a), publicBase: () => { const a = cfg.address ?? `http://${cfg.host}:${boundPort}`; return /^https?:\/\//.test(a) ? a : `https://${a}`; } });
  // Ruling 62: the person's own key, handed over by their client on their own node (POST /local/vault/key/unlock, loopback only), held in memory only. A device-role daemon is the computer of whoever signs in on it;
  // a Space server holds the key of its owner alone.
  let ownerOfSpace: () => string | null = () => cfg.owner;
  let callerOf: (h: http.IncomingHttpHeaders) => Promise<{ person: string; sessionId?: string } | null> = () => Promise.resolve(null);
  const ownNode = (p: string): boolean => cfg.roles.includes("device") || p === ownerOfSpace();
  const keyring = createKeyring({ allowed: ownNode, live: (id) => (db ? sessionLive(db, id) : false) });
  closers.push(() => keyring.clearAll());
  const fillRoute = createFillRoute();
  const localKeyRoute = createLocalKeyRoute({ caller: (h) => callerOf(h), keyring, allowed: ownNode });
  let headSeq = 0;
  let sawSpace = false, hostMadeSpace = false;
  let claimIssue: () => Promise<{ code: string; expiresAt: number } | null> = async () => null;
  const access = createAccess();
  // Ruling 70: authorize answers from the access module's snapshot. The log's access events wait here until the module has folded them; `syncAccess` (set once the hooks run)
  // hands them over, adopts the snapshot it answers and runs after every commit that may have changed access, so the next call already sees a join, a role change, a share or a removal.
  let accessPending: { seq: number; type: string; payload: unknown }[] = [];
  let syncAccess: (force?: boolean) => Promise<void> = async () => {};
  let accessStale = false, kicking = false, noAccessModule = false;
  /** While the snapshot is stale only the owner is answered, and each refused call tries the sync again, so the Space heals itself as soon as the module can take the events. */
  const staleFor = (principal: string): boolean => {
    if (!accessStale || principal === (cfg.owner ?? access.owner())) return false;
    if (!kicking) { kicking = true; void syncAccess(true).catch(() => {}).finally(() => { kicking = false; }); }
    return true;
  };

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
        for (const e of page) {
          access.fold(e);
          if (isAccessEvent(e.type)) accessPending.push(toAccessEvent(e));
          if (e.type === "space.created") { sawSpace = true; if (e.id.startsWith("evt_boot_")) hostMadeSpace = true; }
        }
        if (page.length < 5000) break;
        after = page[page.length - 1]!.seq;
      }
      // Ruling 71: an empty log is a fresh install. The host makes the Space once, with an owner who claims it through a one-time link.
      if (!sawSpace) {
        const made = await bootstrapSpace(log, { space, name: cfg.spaceName ?? space, owner: mintOwner(cfg.owner) });
        if (made) { hostMadeSpace = true; for (const e of made.events) { access.fold(e); accessPending.push(toAccessEvent(e)); } }
      }
      headSeq = (await log.currentHead()).seq;

      const reg = registry as unknown as RegistryLike;
      const loaded = await loadHost({ registry: reg, modulesJson: readModuleList(path.join(codeRoot, "host/modules.json")), routes, importer: fileImporter(codeRoot), seamImporter: fileSeamImporter(codeRoot), exportsImporter: fileExportsImporter(codeRoot), db, ...(o.http ? { fetch: o.http } : {}) });
      const registryCaps = registry.capabilities as unknown as CapabilityDef[];
      // consumers and periodic jobs the live modules export (ruling 32): each runs through the invoke pipeline as a host-only capability that may emit what its module's capabilities emit
      // the Vault the connector seams read from: the vault module's own port once it is live and configured, else a refusal
      let vaultImpl: (VaultPort & { pullExport?(exportId: string, token: string): string }) | null = null;
      const vaultPort: VaultPort = { secret: (h, sp) => (vaultImpl ?? refusingVault).secret(h, sp), signRs256: (h, sp, d) => (vaultImpl ?? refusingVault).signRs256(h, sp, d) };
      let peopleExtras: ReturnType<typeof createPeopleExtras> | null = null;   // set once the hook runner exists
      let invokeRef: Invoke = () => Promise.reject(new Error("the invoke pipeline is not ready"));
      const hookRunner = createHookRunner({
        space, now, db,
        // a hooks override stands in for the module hooks, except the access module's: authorize reads its snapshot (ruling 70), so its host calls are never replaced
        hooks: o.hooks ? [...o.hooks, ...[...loaded.moduleExports].filter(([id]) => id === "access").map(([id, ns]) => collectHooks(id, ns))] : [...loaded.moduleExports].map(([id, ns]) => collectHooks(id, ns)),
        log: { read: (q) => log!.read(q), currentHead: () => log!.currentHead() },
        invoke: (cap, input, seed) => invokeRef(cap, input, seed),
        emitsOf: (m) => [...new Set(registryCaps.filter((c) => (c as { module?: string }).module === m).flatMap((c) => c.emits as string[]))],
        capOf: (m) => registryCaps.find((c) => (c as { module?: string }).module === m),
        warn: (msg, attrs) => sink.log({ space: space!, level: 30, msg, place: "hooks", ...(attrs ? { attrs } : {}) }),
      });
      hooks = hookRunner;
      const runsHost = createRunsHost({ call: (n, i, as) => hookRunner.call(n, i, as), log: (msg, attrs) => sink.log({ space: spaceId, level: 40, msg, place: "runs", attrs }) });
      closers.push(() => runsHost.settle(5_000));
      const acceptors = new Set([...loaded.moduleExports].flatMap(([id, ns]) => (ns["hostCalls"] && typeof ns["hostCalls"] === "object" && `${id}.accept_webhook` in (ns["hostCalls"] as object) ? [id] : [])));
      webhooks = { has: (c) => acceptors.has(c), accept: (c, a) => hookRunner.call(`${c}.accept_webhook`, a) };
      // the async projections the live modules export (P-H_07): the events module's webhooks_out turns subscribed events into signed deliveries
      // crash recovery: a webhook delivery row inserted but never dispatched (the daemon died between the two) is sent again; the send is idempotent per attempt
      let dispatchSystem: ((cap: string, input: unknown) => Promise<unknown>) | null = null;
      const dueDeliveries = loaded.moduleExports.get("events")?.["dueDeliveries"] as ((ctx: { db: unknown }, now: number, limit?: number) => { webhook_id: string; event_id: string; attempts: number; state: string; at: number }[]) | undefined;
      const WEBHOOK_RECOVER_MS = 30_000;
      const projectionRunner = createProjectionRunner({
        now, db,
        ...(dueDeliveries ? { recover: [{
          name: "events.webhooks_out", windowMs: WEBHOOK_RECOVER_MS,
          run: async (t: number) => {
            if (!dispatchSystem) return 0;
            let n = 0;
            for (const r of dueDeliveries({ db: db! }, t, 100)) {
              if (r.state !== "pending" || r.attempts !== 0 || r.at > t - WEBHOOK_RECOVER_MS) continue;
              await dispatchSystem("webhooks.send_delivery", { webhookId: r.webhook_id, eventId: r.event_id, attempt: 1, idempotencyKey: `${r.webhook_id}:${r.event_id}:1` });
              n++;
            }
            return n;
          },
        }] } : {}), log: { read: (q) => log!.read(q), currentHead: () => log!.currentHead() },
        projections: [...loaded.moduleExports.values()].flatMap((ns) => collectProjections(ns)),
        warn: (msg, attrs) => sink.log({ space: space!, level: 30, msg, place: "projections", ...(attrs ? { attrs } : {}) }),
      });
      projections = projectionRunner;
      const caps = [...registryCaps, ...(o.extra?.caps ?? []), ...hookRunner.caps];
      const extraCaps = new Set([...(o.extra?.caps ?? []), ...hookRunner.caps].map((c) => c.name));
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
      const sealKey = o.sealKey ?? { key: sealKeyFile(path.join(paths.root, "seal.key")), keyId: "k1" };
      const seal = createCtxSeal(sealKey);
      const blobs = createBlobStore({ dir: path.join(paths.root, "blobs", "ctx"), key: sealKey.key, now });

      // The Gate hook, only once the Gate module is live (a stub answers with examples, which must never decide a send). Its questions and parked calls run as the Space itself.
      const gate = loaded.serving.get("gate") === "live"
        ? withGateNesting(createGateHook({
          call: async (cap, input, trace) => {
            const r = await invoke(cap, input, { space: spaceId, principal: { kind: "person", id: owner() }, origin: "gate", ...(trace ? { trace } : {}) });
            if (r.status === "held") throw fail("internal.unavailable", r.traceId, { message: "Approvals are not available right now." });
            return r.output;
          },
          unseal: (s) => seal.unseal(s), now,
          evaluators: moduleWhens(loaded.moduleExports, () => db, (cap, input) => system(cap, input)),
          hold: (id) => {
            const r = db?.all("SELECT state, principal_kind, principal_id, acting_for, run_id, thread_id, payload_hash FROM gate_holds WHERE id = ?", id)[0] as
              { state: string; principal_kind: string; principal_id: string; acting_for: string | null; run_id: string | null; thread_id: string | null; payload_hash: string } | undefined;
            return r ? { state: r.state, principalKind: r.principal_kind, principalId: r.principal_id, actingFor: r.acting_for ?? undefined, run: r.run_id ?? undefined, thread: r.thread_id ?? undefined, payloadHash: r.payload_hash } : null;
          },
        }))
        : undefined;

      // the Personal Space gate (P-H_19): a test or boot may pass one; otherwise the matrix over the registry's teamOnly rows, which refuses while cfg.spaceKind is "personal"
      const personal = o.personal ?? personalMatrix({ kind: () => cfg.spaceKind ?? "team", caps: registryCaps as unknown as Array<{ name: string; teamOnly?: boolean }> });
      const invoke = createInvoke({
        caps: indexCapabilities(caps),
        validateInput: (cap, v, input) => (extraCaps.has(cap) ? [] : validateInput(cap, v, input)),
        validateEvent: (name, payload) => (extraEvents.has(name) ? [] : validateEvent(name, payload)),
        authorize: (r) => {
          if (staleFor(r.principal)) throw fail("internal.unavailable", ZERO_TRACE, { message: "Access is being re-checked on this server. Try again in a moment." });
          return authorize(access.snap, r);
        },
        membership: (principal, actingFor) => isMemberOrGuest(access.snap, principal) && (actingFor === undefined || isMemberOrGuest(access.snap, actingFor)),
        resolveItem: (type, kind, value) => resolveVaultItem(db!, type, kind, value),
        handler: (cap, v) => whoamiWithDeferred(cap, (() => {
          const h = o.extra?.handlers?.[cap] ?? hookRunner.handlers[cap] ?? loaded.handler(cap, v);
          // The one internal call a module may make with the host's own authority: devices -> sync.epoch.bump (a device was revoked, its replica must purge). The person revoking their own
          // device holds no sync grant, and a revoke that cannot purge would leave the copy on the device. Nothing else is widened: every other ctx.call keeps the caller's authority.
          const mod = h ? (capIndex?.get(cap)?.module ?? "") : "";
          // identity opens a device session at sign-in by calling devices.register, which only the server itself may do (P-SEC_08): that one call, from identity, runs as the host. Nothing else is widened.
          if (h && mod === "identity") return ((ctx, input) => h({ ...ctx, ...peopleExtras?.(mod, ctx), call: (name: string, callInput: unknown, opts?: unknown) => (name === "devices.register" ? system(name, callInput, ctx.trace) : (ctx.call as (n: string, i: unknown, o?: unknown) => Promise<unknown>)(name, callInput, opts)) } as typeof ctx, input)) as Handler;
          // accepting an invite: the person proved the code, and the invite's role, groups and starting places were the inviter's to give. Those join effects run as the host, not as the signed-out caller.
          if (h && cap === "members.accept") return ((ctx, input) => h({ ...ctx, ...peopleExtras?.(mod, ctx), call: (name: string, callInput: unknown) => system(name, callInput, ctx.trace) } as typeof ctx, input)) as Handler;
          if (h && peopleExtras?.(mod, {})) return ((ctx, input) => h({ ...ctx, ...peopleExtras!(mod, ctx) } as typeof ctx, input)) as Handler;
          if (!h || !cap.startsWith("devices.")) return h;
          const wrapped: Handler = (ctx, input) => h({ ...ctx, call: (name, callInput, opts) => (name === "sync.epoch.bump" ? system(name, callInput, ctx.trace) : ctx.call(name, callInput, opts)) } as typeof ctx, input);
          return wrapped;
        })()),
        services: hostServices({ base: (seed, cap) => loaded.services(seed, hookRunner.serviceCap(cap)), seal, queue: scheduleQueue, blobs, vault: (seed) => createVaultService((c, i, sd) => invokeRef(c, i, sd), spaceId, seed) }),
        idem, rate: createRateLimiter(), now, log: sinkLog,
        ...(gate ? { gate } : {}),
        personal,
        // P-H_16: an object a call creates is a resource in the same commit, so it is authorizable at once
        resources: createResourceRegistrar({ events: registry.events, exists: (id) => access.snap.resource(id) !== undefined }),
        principals: createPrincipalRegistrar({
          exists: (id) => access.snap.info(id) !== null,
          levelOf: (person, space) => {
            const may = (level: "edit" | "view"): boolean => authorize(access.snap, { principal: person, action: { perm: null, level }, resource: { type: "space", id: space } }).effect === "allow";
            return may("edit") ? "edit" : may("view") ? "view" : "none";
          },
        }),
        commit: withEventIds(async (b) => {
          const trace = b.events[0]?.traceId ?? ZERO_TRACE;
          if (chainBroken) throw fail("internal.unavailable", trace, { message: "The event log failed verification, so this server is not accepting changes. Run vyre-server doctor." });
          const stored = await Promise.all(b.events.map((e) => log!.append(toNew(e))));
          const out = stored.map((s, i) => fromStored(s, b.events[i]!));
          for (const s of stored) { access.fold(s); if (isAccessEvent(s.type)) accessPending.push(toAccessEvent(s)); }
          headSeq = Math.max(headSeq, ...out.map((e) => e.seq));
          if (stored.some((s) => touchesAccess(s.type))) await syncAccess(true);
          if (b.audit) recordAudit(b.audit);
          return out;
        }),
        audit: (r) => recordAudit(r),
        publish: (events) => {
          // the owner claimed the Space (their keys were stored): the link is spent, so the file that held it goes too
          if (claim && events.some((e) => e.type === "keys.stored" && (e.payload as { personId?: string } | undefined)?.personId === access.owner())) {
            claim = null;
            try { fs.rmSync(path.join(paths.logDir, "claim-link.txt"), { force: true }); } catch { /* already gone */ }
          }
          recent.push(...events);
          if (recent.length > RING) recent.splice(0, recent.length - RING);
          hub?.publish(spaceId, events);
          void hookRunner.pump().catch((e: unknown) => sink.log({ space: spaceId, level: 30, msg: "hooks.pump_failed", place: "hooks", attrs: { error: e instanceof Error ? e.message : String(e) } }));
          void projectionRunner.pump().catch((e: unknown) => sink.log({ space: spaceId, level: 30, msg: "projections.pump_failed", place: "projections", attrs: { error: e instanceof Error ? e.message : String(e) } }));
        },
        onSpan: (s) => sink.span({ trace_id: s.traceId, span_id: s.spanId, parent: s.parent ?? null, name: s.name, at: s.startedAt, dur_us: s.ms * 1000, attrs: { cap: s.cap, status: s.status } }),
      });

      // A job the host itself scheduled (a webhook retry from the events consumer) runs as the host service, which authorize does not know: it is pre-authorized like the hook that scheduled it.
      const runAsScheduled = invokeRunner(invoke);
      runScheduled = (call) => (call.principal.id === SYSTEM_PRINCIPAL.id
        ? invoke(call.cap, call.input, { space: call.space, principal: call.principal, preAuth: true, origin: "schedule", ...(call.traceId ? { trace: { traceId: call.traceId, spanId: "0".repeat(16) } } : {}) }).then(() => undefined)
        : runAsScheduled(call));
      invokeRef = invoke;
      closers.push(() => hookRunner.pump().catch(() => {}));   // finish the pass in flight before the databases close
      closers.push(() => projectionRunner.pump().catch(() => {}));
      await hookRunner.start();
      syncAccess = async (force) => {
        if (noAccessModule) return;
        const events = accessPending;
        if (!events.length && !force && access.adopted() && !accessStale) return;
        accessPending = [];
        const attempt = async (): Promise<void> => { access.adopt((await hookRunner.call("access.sync", { events })) as AccessSnapshot); };
        try { await attempt(); } catch (first) {
          // the seed-shaped fold answers only when the access module is not loaded at all; with access live, a missing access.sync is a failure and fails closed below
          if (first instanceof Error && first.message.startsWith("no host call named access.sync") && loaded.serving.get("access") !== "live") { noAccessModule = true; return; }
          try { await attempt(); } catch (e) {
            accessPending = [...events, ...accessPending];   // the module could not take them: keep them for the next pass
            const error = e instanceof Error ? e.message : String(e);
            sink.log({ space: spaceId, level: 50, msg: "access.sync_failed", place: "boot", attrs: { error, stale: access.adopted() } });
            if (!access.adopted()) throw e;   // a Space that never had the module's snapshot cannot answer
            // Fail closed (ruling 70): the last snapshot may still let a revoked or removed person through, so everyone but the owner is refused until a sync succeeds.
            accessStale = true;
            return;
          }
        }
        accessStale = false;
      };
      await syncAccess();
      // the owner of a Space this host made has not claimed it until identity holds an account for them: a fresh one-time link at every start until they do
      claimIssue = async () => {
        const owner = access.owner();
        if (!hostMadeSpace || !owner || loaded.serving.get("identity") !== "live") return null;
        return (await hookRunner.call("identity.claim_issue", { personId: owner })) as { code: string; expiresAt: number } | null;
      };
      // the drivers that need the daemon's own state (the Space log, the access snapshot, the pipeline); the registry in seams/ builds the rest from the Vault
      const spaceLog = log;
      peopleExtras = createPeopleExtras({ access: () => access.snap, stale: (id) => staleFor(id), db: db!, call: (n, i, as) => hookRunner.call(n, i, as), keyring, github: o.githubOAuth !== undefined ? o.githubOAuth : githubOAuthFromEnv(process.env) });
      // `trace`: a call the host makes on behalf of a caller keeps that caller's trace (only the principal changes), so the events it writes stay in the caller's trace
      const system = (cap: string, input: unknown, trace?: { traceId: string; spanId: string }): Promise<unknown> =>
        invoke(cap, input, { space: spaceId, principal: { ...SYSTEM_PRINCIPAL }, preAuth: true, origin: "hook", ...(trace ? { trace } : {}) }).then((r) => (r.status === "ok" ? r.output : Promise.reject(new Error(`${cap} was held for approval`))));
      // the Space record store the L3 data modules share (P-H_08): one file in the data directory, opened by the first module that needs it, closed at shutdown
      const spaceStore = createSpaceStore({ path: spaceStorePath(paths.root), space: spaceId });
      closers.push(() => spaceStore.close());
      dispatchSystem = system;
      const hostDrivers: Record<string, SeamDriver> = {
        setPushPort: () => createPushPort(o.seams?.push),
        // portal invitations and sign-in links go out through mail.send from the service mailbox (P-L8_17)
        configurePortal: (d) => createPortalHost({ invoke: (cap, input, seed) => invoke(cap, input, seed), space: spaceId, publicUrl: d.publicUrl, owner: () => cfg.owner ?? access.owner() ?? null, warn: (msg, attrs) => sink.log({ space: spaceId, level: 40, msg, place: "portal", attrs }) }),
        // the updates module: the compiled-in release key, the GitHub Releases feed and the vyre-server installer (P-L7b_17)
        configureUpdates: () => createUpdatesHost(),
        // A Kit is a resource in the access projection (type "kit") so that the capabilities on it can be authorized. The module cannot create resources, so the host does: one
        // resource.created per Kit, with an id made from the Kit's own, so the same Kit is the same event after a reboot (the log refuses a duplicate id) and the fold is the same.
        setKitsHost: () => createKitsHost({
          root: codeRoot,
          resources: {
            ensure: async (kitId) => {
              const r = await spaceLog.appendResult({
                id: `evt_res_${kitId}`, type: "resource.created", sv: 1, trace_id: "c0".repeat(16), actor: "svc_host", vis: "space", entity: "resource", entity_id: kitId,
                payload: { id: kitId, type: "kit", parent_id: spaceId, label: 0, owner_id: cfg.owner ?? access.owner() ?? "usr_owner", holds: 0 },
              });
              if (!r.ok) throw new Error(`could not register the Kit: ${r.message}`);
              if (!r.duplicate) { access.fold(r.event); accessPending.push(toAccessEvent(r.event)); headSeq = Math.max(headSeq, r.event.seq); await syncAccess(); }
            },
          },
        }),
        // the files module's root folders are folders in the access projection (ruling 65): one resource.created each, with an id made from the folder's own, so a reboot repeats the same event
        setFilesHost: () => ({
          resources: {
            ensure: async (f: { id: string; type: "folder"; parentId: string | null; ownerId?: string }) => {
              const r = await spaceLog.appendResult({
                id: `evt_res_${f.id}`, type: "resource.created", sv: 1, trace_id: "c0".repeat(16), actor: "svc_host", vis: "space", entity: "resource", entity_id: f.id,
                payload: { id: f.id, type: f.type, parent_id: f.parentId ?? spaceId, label: 0, owner_id: f.ownerId ?? cfg.owner ?? access.owner() ?? "usr_owner", holds: 0 },
              });
              if (!r.ok) throw new Error(`could not register the folder: ${r.message}`);
              if (!r.duplicate) { access.fold(r.event); accessPending.push(toAccessEvent(r.event)); headSeq = Math.max(headSeq, r.event.seq); await syncAccess(); }
            },
          },
        }),
        // forms and campaigns build their public links from the address people reach this Space at; unset, the links stay relative
        setFormsHost: () => (cfg.address ? { publicBase: /^https?:\/\//.test(cfg.address) ? cfg.address : `https://${cfg.address}` } : {}),
        setCampaignsHost: () => (cfg.address ? { publicBase: /^https?:\/\//.test(cfg.address) ? cfg.address : `https://${cfg.address}` } : {}),
        // backups: the Space's own files, the owner from the access layer (P-SEC_07: without owner() every export refuses), exports into the blob store, S3 over the seam fetch with keys from the Vault
        setBackupHost: (d) => createBackupHost({
          root: paths.root, space: spaceId, log: spaceLog, owner: () => cfg.owner ?? access.owner() ?? null, system, vault: d.vault, fetch: d.fetch,
          blobs: { put: async (bytes, type) => (await blobs.forModule("backup").put(bytes, type)).id }, secrets: () => [token],
        }),
        // the Run executor: the plan and the step runner for a Run come from the Automation and steps-core through their host calls (P-L6_24)
        setRunsHost: () => runsHost,
        setEventsDispatch: () => system,
        // erase reaches the append-only log (P-CC_41): governance asks the log worker to tombstone payloads, and a restore replays the seqs it kept
        setEventsCompact: () => {
          // the sync tables keep field values of their own (sync_changes, sync_rows): blank them too, keeping the rows so device cursors and deletes still work
          const blank = loaded.moduleExports.get("sync")?.["blankErased"] as ((db: unknown, scope: { ids?: readonly string[]; seqs?: readonly number[] }) => void) | undefined;
          const scrub = (scope: { ids?: readonly string[]; seqs?: readonly number[] }): void => { try { if (db) blank?.(db, scope); } catch { /* sync is not live here, so there are no sync tables */ } };
          return {
            compact: async (subject: Parameters<typeof spaceLog.compact>[0]) => { const out = await spaceLog.compact(subject); scrub({ ids: (subject.entities ?? []).map((e) => e.id), seqs: out.erased }); return out; },
            compactSeqs: async (seqs: readonly number[]) => { const out = await spaceLog.compactSeqs(seqs); scrub({ seqs: out.erased }); return out; },
          };
        },
        // identity opens a device session at sign-in: the token is minted here for that devices session, and ending a session stops it at the gateway (P-SEC_05)
        setSessionTokens: () => ({
          mint: (sessionId: string) => issueSessionToken(db!, sessionId, now),
          end: (sessionId: string) => { db!.run("UPDATE devices_session SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", now(), sessionId); },
        }),
        setComputerHost: () => createComputersHost({ dataDir: paths.root }),
        // the Vault channel of agent computers (P-L2_21): agentd posts one #Handle.field at a time to /computers/fill with its own token; without a Vault the channel is not offered
        setComputersFill: (d) => d.vault ? createComputersFillHost({
          space: spaceId, invoke, vault: d.vault, now,
          baseUrl: () => o.computersBaseUrl ?? `http://host.docker.internal:${boundPort}`,
          mount: (h) => fillRoute.mount(h),
          log: (u) => sink.log({ space: spaceId, level: 30, msg: "computers.fill", place: "computers", attrs: { ...u } }),
        }) : null,
        // the turn engine: capabilities run for a person through this pipeline, the agent speaks into chat as itself, and the session opener's ports come from the Vault (P-L2_23)
        setEngineHost: (d) => createEngineHost({ space: spaceId, invoke, now, log: (msg, attrs) => sink.log({ space: spaceId, level: 30, msg, place: "engine", ...(attrs ? { attrs } : {}) }), ...(d.vault ? { vault: d.vault } : {}), dataDir: paths.root, ...(o.engineCli !== undefined ? { cli: o.engineCli } : {}), ...(o.engineSandbox !== undefined ? { sandbox: o.engineSandbox } : {}) }),
        // the import module reads an Airtable or Notion key from the Vault by handle, for one call
        setImportHost: (d) => ({ secret: (_ctx: unknown, handle: string) => d.vault.secret(handle.startsWith("#") ? handle : `#${handle}`, d.space) }),
        setEventsHost: () => createEventsHost({
          reader: { source: { read: (q) => spaceLog.read(q), head: async () => (await spaceLog.currentHead()).seq }, access: () => access.snap, owner: () => cfg.owner ?? access.owner() ?? null, now },
          post: { allow: o.seams?.webhookAllow ?? (() => []), now, ...(o.seams?.postFetch ? { fetch: o.seams.postFetch } : {}) },
        }),
        // the git module: working trees under the data directory; a GitHub token arrives only through ctx.vault.fill (git_credential), which waits on the Vault module (w12a, P-L7_LIVE)
        setGitHost: () => ({ treesDir: path.join(paths.root, "trees"), takeCredential: () => undefined }),
        ...spaceStoreDrivers(spaceStore),
        configureSpaceAdmin: () => createSpaceAdmin({ access: () => access.snap, owner: () => cfg.owner ?? access.owner() ?? "usr_owner", space: spaceId, db: db!, system, headSeq: () => headSeq }),
        configureSync: () => createSyncSeam({ store: spaceStore, ...(loaded.serving.get("conflicts") === "live" ? { conflicts: { open: (c) => hookRunner.call("conflicts.park", c) as Promise<string>, history: async (e) => { await hookRunner.call("conflicts.record_history", e); } } } : {}), access: () => access.snap, space: spaceId, now, registryHash, invoke: (c, i, seed) => invoke(c, i, seed), keyed: (c, v) => capIndex?.get(c, v)?.idempotency === "key", ...(cfg.address ? { endpoints: () => [{ kind: "direct" as const, url: `wss://${cfg.address}/sync/v1/live` }] } : {}) }),
        setVaultKeyPort: () => ({ personKey: async (personId: string) => keyring.get(personId) }),
        setVaultFillerKey: () => Buffer.from(sealKeyFile(path.join(paths.root, "vault-filler.key")), "hex"),
        configureVault: () => ({ sinks: o.seams?.vaultSinks ?? {}, db: db!, probe: createProviderProbe({ own: ownNode }), origin: () => { const a = cfg.address ?? `http://${cfg.host}:${boundPort}`; return /^https?:\/\//.test(a) ? a : `https://${a}`; }, provide: (p: VaultPort & { pullExport?(exportId: string, token: string): string }) => { vaultImpl = p; if (p.pullExport) pullVaultExport = p.pullExport; } }),
        // the connectors sync engine: modules/sources is the library, the Space store is one side, a connection is the other (P-H_09)
        setSyncEngine: () => createSyncEngine({ core: coreOf(loaded.moduleExports.get("sources")), local: { open: () => spaceStore.open() }, now }),
        ...(o.seams?.drivers ?? {}),
      };
      const setters = o.seams?.setters ?? loaded.hostSeams;
      if (Object.keys(setters).length) {
        const none = (what: string) => () => Promise.reject(new Error(`${what} is not available on this server yet.`));
        seams = wireSeams(setters, {
          vault: o.vault ?? vaultPort, space: spaceId,
          files: o.seams?.files ?? { read: none("Space files") },
          blobs: o.seams?.blobs ?? { put: none("The blob store") },
          members: o.seams?.members ?? { emails: none("The member list") },
          ...(o.seams?.fetch ? { fetch: o.seams.fetch } : {}),
          ...(o.seams?.filler ? { filler: o.seams.filler } : {}),
          // where Mailgun posts inbound mail: the address people reach this Space at, else the local URL (read at call time, the port is known only after listen)
          publicUrl: o.seams?.publicUrl ?? (async () => { const a = cfg.address ?? `http://${cfg.host}:${boundPort}`; return /^https?:\/\//.test(a) ? a : `https://${a}`; }),
          drivers: hostDrivers, owners: loaded.seamOwners,
        });
        closers.push(() => seams?.unwire());
        const gaps = seams.missing;
        for (const m of gaps) sink.log({ space: spaceId, level: 30, msg: "seam.no_driver", place: "boot", attrs: { setter: m.setter, ...(m.module ? { module: m.module } : {}), reason: m.reason } });
        // health lists only what is missing: a Space with every driver set has no row, so the eight host probes stay the eight
        if (gaps.length) {
          const detail = `Not set up: ${gaps.map((m) => `${m.module ?? "a module"} (${m.setter})`).join(", ")}.`;
          db!.run(
            "INSERT INTO health_probe (name, state, detail, latency_ms, values_json, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET state = excluded.state, detail = excluded.detail, latency_ms = excluded.latency_ms, values_json = excluded.values_json, at = excluded.at",
            "module_drivers", "degraded", detail, null, JSON.stringify({ missing: gaps.length, wired: seams.wired.length }), now(),
          );
        } else db!.run("DELETE FROM health_probe WHERE name = ?", "module_drivers");
      }

      // Runs the last server left queued or running are driven again from their step log (P-L6_24). Started, not awaited: boot does not wait for a Run, and shutdown waits for it.
      if (loaded.serving.get("runs") === "live") {
        const recovering = runsHost.recover().catch((e: unknown) => sink.log({ space: spaceId, level: 40, msg: "runs.recover_failed", place: "boot", attrs: { error: e instanceof Error ? e.message : String(e) } }));
        closers.push(() => recovering);
      }

      // the Space\'s profile row, once: its name from the event that made the Space, and where people reach it
      if (loaded.serving.get("identity") === "live") {
        const made = (await spaceLog.read({ after: 0, limit: 200 })).find((e) => e.type === "space.created");
        const name = made ? ((JSON.parse(new TextDecoder().decode(made.payload)) as { name?: string }).name ?? spaceId) : spaceId;
        await hookRunner.call("identity.ensure_space", { name, github: (o.githubOAuth !== undefined ? o.githubOAuth : githubOAuthFromEnv(process.env)) !== null }).catch((e: unknown) => sink.log({ space: spaceId, level: 40, msg: "identity.space_failed", place: "boot", attrs: { error: e instanceof Error ? e.message : String(e) } }));
      }
      if (loaded.serving.get("spaces") === "live") {
        const made = (await spaceLog.read({ after: 0, limit: 200 })).find((e) => e.type === "space.created");
        const name = made ? ((JSON.parse(new TextDecoder().decode(made.payload)) as { name?: string }).name ?? spaceId) : spaceId;
        await hookRunner.call("spaces.ensure_profile", { name, kind: cfg.spaceKind ?? "team", address: cfg.address }).catch((e: unknown) => sink.log({ space: spaceId, level: 40, msg: "spaces.profile_failed", place: "boot", attrs: { error: e instanceof Error ? e.message : String(e) } }));
      }
      await projectionRunner.start();   // after the seams: the events module needs its dispatcher and host ports before the first event reaches webhooks_out

      // The schema module seeds the record types the manifests declare once, as a write of its own, so no read has to (P-L3_17). Each declared type is also a resource in the access
      // projection (type "record_type"), held by the Space owner, because capabilities on a type (schema.layout.set, views, grants) are authorized against it and a seeded type emits no event
      // that would register it. The set comes from the manifests, so it is folded into the snapshot at every start and not written to the log: a new Space still starts with an empty log.
      const startSchema = loaded.moduleExports.get("schema")?.["startSchema"] as (() => Promise<void>) | undefined;
      if (startSchema) {
        // started, not awaited: boot does not wait for the seed (most starts never touch schema), and every schema call waits for it, so none sees a half-seeded Space
        const seeding = startSchema().catch((e: unknown) => { sink.log({ space: spaceId, level: 50, msg: "schema.seed_failed", place: "boot", attrs: { error: e instanceof Error ? e.message : String(e) } }); });
        closers.push(() => seeding);
        for (const rt of registry.recordTypes) {
          const created = { type: "resource.created", payload: { id: rt.key, type: "record_type", parent_id: spaceId, label: 0, owner_id: cfg.owner ?? access.owner() ?? "usr_owner", holds: 0 } };
          access.fold(created);
          accessPending.push({ seq: -1, ...created });   // not a log event: the module applies it at every start
        }
        await syncAccess();
      }

      const owner = (): string => cfg.owner ?? access.owner() ?? "usr_owner";

      // A restore brought an older Space back. What was erased since is erased again, as the host, before any request is served (spec 2.26, ARCH 7.10). If it cannot be done the Space does not open.
      const kept = loaded.serving.get("governance") === "live" ? readRestoredTombstones(paths.root) : null;
      if (kept) {
        const replayed = (await system("governance.tombstones.reapply", { tombstones: kept.tombstones }, kept.traceId ? { traceId: kept.traceId, spanId: "0".repeat(16) } : undefined).catch((e: unknown) => {
          // the Space does not open with an erased person still in it; say why, with the host's own log of the failing call
          const traceId = (e as { error?: { traceId?: string } } | null)?.error?.traceId;
          let why = "";
          try { sink.flush(); why = traceId ? sink.trace(traceId).logs.filter((l) => l.level >= 40).map((l) => JSON.stringify(l.attrs ?? l.msg)).join(" | ").slice(0, 1500) : ""; } catch { /* the log is a help */ }
          throw new Error(`replaying the tombstones after a restore failed: ${e instanceof Error ? e.message : String(e)} ${why}`);
        })) as { count?: number };
        sink.log({ space: spaceId, level: 20, msg: "restore.tombstones_reapplied", place: "boot", attrs: { count: replayed?.count ?? 0 } });
        clearRestoredTombstones(paths.root);
      }
      // Identity comes from the bearer token alone (host/src/daemon/session.ts): a device session row gives the person and the device; the x-vyre-device header and ?device= are ignored.
      // The single admin token is the owner bootstrap path only (ensureAdminToken): it acts as the owner on the fixed device `local-admin`.
      const sessions = createSessionResolver({ db: db!, space: spaceId });
      const identify = (t: string | null): { space: string; principal: { kind: "person"; id: string }; device: string } | null => {
        if (!t) return null;
        if (sameToken(t, token)) return { space: spaceId, principal: { kind: "person", id: owner() }, device: ADMIN_DEVICE };
        const s = sessions.resolve(t);
        // a session is only as good as the membership behind it: a suspended, removed or unknown person's live token stops working at once, and a fresh sign-in is needed after reactivation (suspend ends the person's devices)
        if (!s || access.snap.principal(s.person)?.status !== "active") return null;
        return { space: s.space, principal: { kind: "person", id: s.person }, device: s.device };
      };
      const session: GatewayDeps["session"] = o.session ?? ((headers) => identify(bearer(headers["authorization"])));
      ownerOfSpace = () => cfg.owner ?? access.owner() ?? null;
      callerOf = async (h) => {
        const who = await session(h);
        if (!who) return null;
        const token = bearer(h["authorization"]);
        const device = token ? sessions.resolve(token) : null;
        return { person: who.principal.id, ...(device ? { sessionId: device.sessionId } : {}) };
      };
      // Ruling 73: portal invitations work without Sites. The Space's default portal is the site "sit_default". The host registers it as a resource the first time a portal call names it, not at
      // boot (ruling 71: a new Space starts with exactly six events); the event id is fixed, so the log refuses a second one.
      let defaultPortal: Promise<void> | null = null;
      const ensureDefaultPortal = (): Promise<void> => (defaultPortal ??= (async () => {
        const r = await spaceLog.appendResult({
          id: "evt_res_sit_default", type: "resource.created", sv: 1, trace_id: "c0".repeat(16), actor: "svc_host", vis: "space", entity: "resource", entity_id: "sit_default",
          payload: { id: "sit_default", type: "site", parent_id: spaceId, label: 0, owner_id: cfg.owner ?? access.owner() ?? "usr_owner", holds: 0 },
        });
        if (!r.ok) throw new Error(`could not register the default portal: ${r.message}`);
        if (!r.duplicate) { access.fold(r.event); accessPending.push(toAccessEvent(r.event)); headSeq = Math.max(headSeq, r.event.seq); await syncAccess(); }
      })().catch((e: unknown) => { defaultPortal = null; throw e; }));
      const invokeWithPortal: Invoke = async (cap, input, seed) => {
        if (cap.startsWith("portal.") && (input as { siteId?: unknown } | null)?.siteId === "sit_default" && loaded.moduleExports.has("portal")) await ensureDefaultPortal();
        return invoke(cap, input, seed);
      };
      gateway = createGateway({ invoke: invokeWithPortal, caps: indexCapabilities(caps), routes: [...routes, ...(o.extra?.routes ?? [])], session,
        // callers before sign-in (the anonymous and pending capabilities): a no-one service principal named by source address, so a handler that needs a person (me()) refuses and rate limits are per address
        preAuth: (caller, headers) => preAuthSession(spaceId, caller, headers) });
      // GET /spaces/<space>/blobs/<id> (ruling 50): a blob is served to a caller who may read the resource its module stored it for
      blobRoute = createBlobRoute({
        space: spaceId, store: blobs,
        session: async (h) => { const s = await session(h); return s ? { space: s.space, principal: s.principal, ...(s.actingFor ? { actingFor: s.actingFor } : {}) } : null; },
        allow: (c, r) => !staleFor(c.principal.id) && authorize(access.snap, { principal: c.principal.id, ...(c.actingFor ? { actingFor: c.actingFor } : {}), action: { perm: null, level: "view" }, resource: { type: r.type, id: r.id } }).effect === "allow",
      });
      // the landing page of a portal invitation or sign-in link (P-L8_17): sites is deferred, so the Space host serves it; null while the portal module is not live
      const peekLink = loaded.moduleExports.get("portal")?.["peekLink"] as ((ctx: { db: unknown }, now: number, siteId: string, token: string) => Promise<never>) | undefined;
      if (peekLink) portalLinkRoute = createPortalLinkRoute({
        peek: (siteId, token) => peekLink({ db: db! }, now(), siteId, token) as never,
        // the client is not signed in: the call is made as the host, through the pipeline, and the module's own throttling and one-use token rules decide
        signIn: async (a) => {
          const r = await invoke("portal.sign_in", a, { space: spaceId, principal: { ...SYSTEM_PRINCIPAL }, preAuth: true, origin: "portal" });
          if (r.status !== "ok") throw new Error("held");
          return r.output as { session: string };
        },
      });
      // GET /share/project/<token>: the read-only link a client opens without signing in; the projects module decides whether the token still works (P-SEC_10)
      shareRoute = createShareRoute({
        view: async (token) => {
          if (!dispatchSystem) return null;
          try { return (await dispatchSystem("projects.shared_view", { token })) as SharedView; } catch { return null; }
        },
      });
      // GET /f/<slug> and /book/<slug> (P-L8_19): the public form pages. A visitor is an act_anon actor; the forms module answers for a published form of the right kind, and an upload goes to the form's Files folder
      {
        const formsNs = loaded.moduleExports.get("forms");
        const viewOf = formsNs?.["publicFormView"] as ((ctx: unknown, slug: string, page: "form" | "booking") => PublicFormView) | undefined;
        const linkOf = formsNs?.["linkView"] as ((ctx: unknown, slug: string, token: string) => Promise<{ fields: { field: string; step?: number }[]; partial?: { answers: Record<string, unknown>; step?: number } }>) | undefined;
        const reserveUpload = formsNs?.["reserveUpload"] as ((ctx: unknown, slug: string) => { formId: string; folderId: string }) | undefined;
        const recordUpload = formsNs?.["recordUpload"] as ((ctx: unknown, f: { slug: string; fileId: string; name: string; mime: string; size: number; token?: string | undefined }) => Promise<string>) | undefined;
        const formCtx = (principal: { kind: string; id: string }): unknown => ({
          space: spaceId, principal, origin: "api", depth: 0, now, db: scopedDb("forms", db!, "0".repeat(32)),
          trace: { traceId: "0".repeat(32), spanId: "0".repeat(16) }, log: { debug() {}, info() {}, warn() {}, error() {} },
        });
        if (viewOf) {
          formsPageRoute = createFormsPageRoute({
            // a visitor has no session, so the pipeline could not authorize them: the host runs the three public capabilities as itself and the module is told which visitor (forms.visitorOf)
            call: (cap, input) => invoke(cap, input, { space: spaceId, principal: { ...SYSTEM_PRINCIPAL }, preAuth: true, origin: "hook" }).then((r) => (r.status === "ok" ? r.output : Promise.reject(new Error(`${cap} was held for approval`)))),
            read: async (slug, page, caller) => { try { return viewOf(formCtx(caller), slug, page); } catch { return null; } },
            ...(linkOf ? { link: async (slug, token, caller) => { try { return await linkOf(formCtx(caller), slug, token); } catch { return null; } } } : {}),
            // the file is stored as the host (system), never as the visitor or the forms module; the forms module keeps the binding of the upload to this form and this visitor and issues the id the page gets back
            ...(reserveUpload && recordUpload ? { upload: async (slug: string, file: { name: string; type: string; bytes: Uint8Array; folderId: string }, caller: { kind: string; id: string }, token?: string) => {
              const ctx = formCtx(caller);
              reserveUpload(ctx, slug);
              const out = await system("files.create", { folderId: file.folderId, name: file.name, mime: file.type, content: { base64: Buffer.from(file.bytes).toString("base64") } }) as { file: { fileId: string } };
              return recordUpload(ctx, { slug, fileId: out.file.fileId, name: file.name, mime: file.type, size: file.bytes.length, token });
            } } : {}),
            now,
          });
        }
      }
      routeIndex = indexRoutes([...routes, ...(o.extra?.routes ?? [])]);   // a duplicate route is a boot error, not a first-request error
      capIndex = indexCapabilities(caps);

      const mkHub = (): LiveHub => createLiveHub({
        session: (h, url) => {
          return identify(bearer(h["authorization"]) ?? url.searchParams.get("token"));
        },
        invoke, sink,
        eventsSince: (_s, cursor) => (recent.length && recent[0]!.seq <= cursor + 1 ? recent.filter((e) => e.seq > cursor) : []),
        head: () => headSeq,
        ...(o.liveSync ? { sync: o.liveSync.hub } : {}),
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
  // a signed-out person's key leaves memory within the interval, not whenever someone next reads it
  scheduler.add({ name: "keyring.sweep", schedule: { everyMs: o.intervals?.sweep ?? 30_000 }, run: () => { keyring.sweep(); } });
  scheduler.add({ name: "probes.fast", schedule: { everyMs: fast }, run: async () => { await runProbes(group(["events_db", "index_db", "scheduler", "disk_space"])); } });
  scheduler.add({ name: "probes.slow", schedule: { everyMs: slow }, run: async () => { await runProbes(group(["docker", "caddy", "time_skew"])); reportNetwork(); } });
  scheduler.add({ name: "probes.encryption", schedule: { everyMs: o.intervals?.encryption ?? 300_000 }, run: async () => { await runProbes(group(["disk_encrypted"])); } });
  if (hasSpace) {
    scheduler.add({ name: "commands.poll", schedule: { everyMs: o.intervals?.commands ?? 1000 }, run: async () => { await runCommands(); } });
    scheduler.add({ name: "schedule.tick", schedule: { everyMs: o.intervals?.tick ?? 1000 }, run: async () => { await queue?.tick(); } });
    scheduler.add({ name: "projections.pump", schedule: { everyMs: o.intervals?.hooks ?? 5000 }, run: async () => { await projections?.pump(); } });
    scheduler.add({ name: "hooks.pump", schedule: { everyMs: o.intervals?.hooks ?? 5000 }, run: async () => { await hooks?.pump(); } });   // the backstop for a consumer that failed, and for events committed by another process
    for (const p of hooks?.periodic ?? []) scheduler.add({ name: `hook.${p.name}`, schedule: { everyMs: p.everyMs }, run: async () => { await hooks?.runPeriodic(p.name); } });
    scheduler.add({ name: "idempotency.purge", schedule: { daily: { hour: 4, minute: 0 } }, run: async () => { await log?.purgeIdempotency(); } });
  }

  // ---- services
  const startedAt = now();
  const health = (): unknown => ({
    ok: !chainBroken,
    version: cfg.version, roles: cfg.roles, space, head: headSeq, startedAt,
    services: supervisor.status().map((s) => ({ name: s.name, state: s.state, restarts: s.restarts })),
    probes: Object.fromEntries([...probeState].map(([k, v]) => [k, v.state])),
    drivers: { wired: seams?.wired ?? [], missing: seams?.missing ?? [] },
  });

  const coerce = (method: string, p: string, query: Record<string, string>): Record<string, unknown> => {
    const route = routeIndex?.(method, p);
    const cap = route ? capIndex?.get(route.cap, route.v) : undefined;
    return coerceQuery(query, (cap as unknown as { input?: { properties?: Record<string, PropSchema> } } | undefined)?.input?.properties);
  };

  const gatewayUnit = async (): Promise<RunningUnit> => {
    const h = hubFactory ? hubFactory() : createLiveHub({ session: () => null });
    hub = h;
    o.liveSync?.onHub?.(h);
    const server = h.server;
    server.removeAllListeners("request");
    const listener = requestListener({
      health, coerce,
      gateway: gateway ?? (() => Promise.resolve({ status: 404, headers: {}, body: { error: makeError("validation.unknown_capability", ZERO_TRACE, { message: "This daemon runs the device role only; it has no Space API." }) } })),
    });
    server.on("request", (req, res) => { if (chromeBridge.handle(req, res) || blobRoute?.handle(req, res) || formsPageRoute?.handle(req, res) || shareRoute?.handle(req, res) || portalLinkRoute?.handle(req, res) || exportRoute.handle(req, res) || webhookRoute.handle(req, res) || fillRoute.handle(req, res) || localKeyRoute.handle(req, res)) return; listener(req, res); });
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
    // A relay is configured (--relay or VYRE_RELAY_URL): keep one outbound connection to it so a phone or another computer reaches this Space without a public address. The relay row in
    // network_endpoint follows the link, so network.endpoints lists it after the direct ones and reads it down when the link drops (P-L7b_16).
    if (hasSpace && db && cfg.relayUrl) {
      const relayDb = db;
      const box = startRelayBox({
        relayUrl: cfg.relayUrl, dataDir: paths.root, localPort: () => boundPort,
        log: (m) => sink.log({ space: space ?? "-", level: 30, msg: "relay.link", place: "relay", attrs: { note: m } }),
        onState: (st) => {
          void box.ready.then((r) => {
            try {
              relayDb.run(
                "INSERT INTO network_endpoint (kind, url, state, rtt_ms, heartbeat_at) VALUES ('relay', ?, ?, ?, ?) ON CONFLICT(kind, url) DO UPDATE SET state = excluded.state, rtt_ms = excluded.rtt_ms, heartbeat_at = excluded.heartbeat_at",
                r.deviceUrl, st.state, st.rttMs ?? null, st.at,
              );
            } catch { /* the database closed while the daemon was stopping */ }
          }, () => {});
        },
      });
      closers.push(() => box.stop());
    }
    if (hasSpace) {
      const issued = await claimIssue();
      if (issued) {
        const base = cfg.address ? (/^https?:\/\//.test(cfg.address) ? cfg.address : `https://${cfg.address}`) : `http://${cfg.host}:${boundPort}`;
        const fp = String((db?.all("SELECT fingerprint FROM identity_space WHERE id = ?", space)[0] as { fingerprint?: string } | undefined)?.fingerprint ?? "").replace(/\s/g, "");
        claim = { url: `${base.replace(/\/$/, "")}/claim/${issued.code}#${fp ? `fp=${fp}&` : ""}s=${encodeURIComponent(space ?? "")}`, expiresAt: issued.expiresAt };
        fs.writeFileSync(path.join(paths.logDir, "claim-link.txt"), `${claim.url}\n`, { mode: 0o600 });
        // the link is a credential: it goes to the console and the 0600 file only, never to the shared log stream, the log export or the support bundle
        sink.log({ space: space ?? "-", level: 20, msg: "claim link issued, see logs/claim-link.txt", place: "boot", attrs: { expiresAt: issued.expiresAt } });
      }
    }
    writeInfo(paths, { pid: process.pid, url: `http://${cfg.host}:${boundPort}`, port: boundPort, roles: cfg.roles, space, version: cfg.version, startedAt });
    sink.log({ space: space ?? "-", level: 20, msg: "daemon.started", place: "boot", attrs: { roles: cfg.roles, port: boundPort, version: cfg.version } });
  } catch (e) {
    for (const c of closers.reverse()) await Promise.resolve(c()).catch(() => {});
    clearInfo(paths);
    throw e;
  }

  let stopped = false;
  return {
    url: `http://${cfg.host}:${boundPort}`, claim, port: boundPort, token, roles: cfg.roles, space, paths, supervisor, scheduler, db, schedule: queue, seams, hooks, projections, sink, log, chromeBridge,
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

