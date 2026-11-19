// The ConnectorDef runtime and the connector framework capabilities (spec 2.10, 4.18, ARCH 8).
// executeAction is the one path every call to an app takes: the connection must be usable (not paused, not pending, not waiting for a sign-in), the secrets are read from the Vault by
// name at call time, the request is built from the action template, egress is checked against the connector's declared domains before ctx.http is touched, the rate limit is applied,
// the answer becomes an output through a JSON pointer, and EVERY string that leaves (output, error, log, dry-run preview) has the secret values scrubbed out of it.
// The replay harness runs the same path against recorded responses, so a connector that passes its tests behaves the same live.
import { objectsOf } from "./get.ts";
import type { ObjectActions } from "./get.ts";
import { canonical } from "../../../lib/canonical.ts";
import { buildDef, generateMain } from "./source.ts";
import { shapeCreated, shapeList, ShapeError } from "./shape.ts";
import { unflatten } from "../syncspec.ts";
import { oauthOf, refreshSlot } from "./oauth.ts";
import { forgetGrantOf, grantKeyOf, grantPortFor } from "./grant-port.ts";
import { accessToken, forgetAccess, GrantError } from "../refresh-grant.ts";
import {
  ensureTables,
  mintShort,
  nowOf,
  pointerGet,
  refuse,
  scrubber,
  secretsIn,
  seedBuiltins,
  takeToken,
  holdMsOf,
  tokenWaitMs,
  parseRetryAfter,
  noteRateLimited,
  noteServed,
  SLOW_DOWN_FIRST_MS,
  PACE_LONGEST_MS,
  PACE_TOTAL_MS,
  checkEgress,
  originKey,
  recordHosts,
  fillString,
  withoutSecretValues,
  maskSealed,
  SYNC_PASS_TOKEN,
  SEALED_HELD,
  fillValue,
  clone,
  PAGE,
} from "../projections.ts";
import type {
  ActionDef,
  ConnectionDb,
  ConnectorDef,
  ConnectorState,
  ConnectorsCtx,
  ConnectorsDeps,
  Mode,
  Scope,
  TestCase,
} from "../projections.ts";

export interface ConnectorRow {
  key: string;
  title: string;
  mode: Mode;
  scope: Scope;
  builtin: boolean;
  version: string;
  state: ConnectorState;
  domains: string[];
  secrets: { name: string; description: string }[];
  connections: number;
  syncedTypes: string[];
  actions: string[];
  sources: string[];
  /** The canonical editable source folder in Shared knowledge, when this connector has one. */
  sourceFolderId?: string;
  objects?: Record<string, ObjectActions>;
}
export interface TestResult {
  passed: number;
  failed: number;
  cases: { name: string; ok: boolean; message?: string }[];
}

/** What an agent or a person says a connector is, in one call: the hosts it may reach, how it signs in, and its actions. The same rules as a source folder apply (buildDef). */
export interface DefineInput {
  key: string;
  title?: string;
  domains: string[];
  auth: { type: "none" | "api_key" | "bearer"; secret?: string; header?: string; prefix?: string };
  secrets?: { name: string; description: string }[];
  actions: {
    name: string;
    method?: string;
    url: string;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    output?: string;
    write?: boolean;
  }[];
}

export interface RuntimeHandlers {
  "connectors.list"(
    ctx: ConnectorsCtx,
    input: { state?: ConnectorState; cursor?: string; limit?: number },
  ): Promise<{ connectors: ConnectorRow[]; next?: string; total?: number }>;
  "connectors.get"(ctx: ConnectorsCtx, input: { key: string }): Promise<{ connector: ConnectorRow }>;
  "connectors.init"(
    ctx: ConnectorsCtx,
    input: { key: string; title: string; mode: Mode; docsUrl?: string; source?: boolean },
  ): Promise<{ key: string; folderId?: string }>;
  "connectors.define"(
    ctx: ConnectorsCtx,
    input: DefineInput,
  ): Promise<{ key: string; draftId: string; actions: string[]; domains: string[] }>;
  "connectors.build"(
    ctx: ConnectorsCtx,
    input: { key: string; docsUrl?: string; notes?: string },
  ): Promise<{ runId: string; draftId: string }>;
  "connectors.test"(ctx: ConnectorsCtx, input: { key: string; draftId?: string }): Promise<{ result: TestResult }>;
  "connectors.read"(
    ctx: ConnectorsCtx,
    input: { key: string; action: string; connectionId: string; input: unknown },
  ): Promise<{ output: unknown }>;
  "connectors.run"(
    ctx: ConnectorsCtx,
    input: { key: string; action: string; connectionId: string; input: unknown; dryRun?: boolean },
  ): Promise<{ output: unknown; dryRun: boolean }>;
  "connectors.diff"(
    ctx: ConnectorsCtx,
    input: { key: string; draftId?: string },
  ): Promise<{ files: { path: string; added: number; removed: number }[]; breaking: boolean }>;
  "connectors.publish"(
    ctx: ConnectorsCtx,
    input: { key: string; draftId?: string; note?: string },
  ): Promise<{ published: boolean; version?: string; result: TestResult }>;
  "connectors.versions"(
    ctx: ConnectorsCtx,
    input: { key: string },
  ): Promise<{ versions: { version: string; at: number; by: string; note?: string; tests: number }[] }>;
  "connectors.rollback"(ctx: ConnectorsCtx, input: { key: string; version: string }): Promise<{ ok: boolean }>;
  "connectors.export"(ctx: ConnectorsCtx, input: { key: string }): Promise<{ folderId: string }>;
  "connectors.remove"(ctx: ConnectorsCtx, input: { key: string }): Promise<{ removed: boolean }>;
  "connectors.health"(
    ctx: ConnectorsCtx,
    input: Record<string, never>,
  ): Promise<{ state: "healthy" | "degraded" | "down"; detail?: string; latencyMs?: number; failing: string[] }>;
}

type Http = ConnectorsCtx["http"];
export interface ExecOpts {
  connection?: ConnectionDb;
  input?: unknown;
  dryRun?: boolean;
  /** Secret values by declared name (the harness and tests); otherwise they are resolved from the connection. */
  secrets?: Record<string, string>;
  http?: Http;
  persist?: boolean;
  actor?: string;
  /** Set on the one retry after a refresh, so a token the app still rejects ends in a reconnect instead of a loop. */
  refreshed?: boolean;
  /** Asked again after a key the process had kept was rejected: nothing kept is used. */
  fresh?: boolean;
  /** The id of the sync pass this call belongs to (said with the process's own token): what the pass reads from the Vault is kept for the pass. Nobody else's call keeps anything. */
  keep?: string;
  /** Called with the answer's status and text before the status is turned into an error, so a check can read a verdict from it. It must keep nothing of the text but its own verdict. */
  verdict?: (status: number, text: string) => void;
  /** Set by the runtime itself for the token call that stands before another action: only then does the token action's answer (the short-lived token) come back out of it. */
  tokenChain?: boolean;
  /** The sync engine's own pass: it is given the real values of sealed fields. */
  unmask?: boolean;
  /** With unmask: where the pass keeps the real values it was given (never in the answer). */
  passNonce?: string;
}
export interface ExecResult {
  output: unknown;
  dryRun: boolean;
  status?: number;
  ms?: number;
}

const KEY = /^[a-z][a-z0-9_-]{0,40}$/;
const MODES: readonly Mode[] = ["api", "mcp", "dwd", "oauth_app", "webhook_only"];
const connectionSecrets = (c: ConnectionDb | undefined): Record<string, string> =>
  c ? (JSON.parse(c.secrets) as Record<string, string>) : {};

async function markReconnect(deps: ConnectorsDeps, ctx: ConnectorsCtx, c: ConnectionDb): Promise<void> {
  const cur = deps.tx.get<{ state: string }>(
    "SELECT state FROM cn_connections WHERE connection_id = ?",
    c.connection_id,
  );
  if (!cur || cur.state === "needs_reconnect") return;
  deps.tx.run("UPDATE cn_connections SET state = 'needs_reconnect' WHERE connection_id = ?", c.connection_id);
  await needsYouTask(deps, ctx, c);
  // the call that rejected the sign-in throws right after this (connectors.run, sync_types.discover), which drops what it buffered; the state change above is already written, so the event is too
  ctx.emit(
    "connection.needs_reconnect",
    `connection/${c.connection_id}`,
    { connectionId: c.connection_id, connector: c.connector },
    { afterFailure: true },
  );
}

/** Is this person a current member of the Space? "no" only when the directory says they are not (gone, removed, suspended, not invited yet); "unknown" when the lookup cannot be made. */
async function memberState(ctx: ConnectorsCtx, id: string): Promise<"yes" | "no" | "unknown"> {
  try {
    const got = (await ctx.call("access.principals.get", { principal: { kind: "person", id } })) as {
      principal?: { status?: string };
    } | null;
    const status = got?.principal?.status;
    return status === undefined ? "unknown" : status === "active" ? "yes" : "no";
  } catch (e) {
    return (e as { error?: { code?: string } } | null)?.error?.code === "validation.not_found" ? "no" : "unknown";
  }
}

/**
 * Who is told when nobody in the chain can be: the Space's admins; but in a Personal Space, or a Space where no one holds the admin role, that is nobody, so it is the Space's owner. When the Space cannot be read the admins
 * are asked, as before.
 */
async function lastResort(ctx: ConnectorsCtx): Promise<{ kind: "person" | "role"; id: string }> {
  const admins = { kind: "role" as const, id: "admin" };
  try {
    const space = ((await ctx.call("spaces.get", {})) as { space?: { kind?: string; owner?: string } } | null)?.space;
    const owner = typeof space?.owner === "string" && space.owner !== "" ? space.owner : undefined;
    if (!owner) return admins;
    if (space?.kind === "personal") return { kind: "person", id: owner };
    const roles = (await ctx.call("access.roles.list", {})) as { roles?: { id?: string; holders?: number }[] } | null;
    const admin = roles?.roles?.find((x) => x.id === "admin");
    return admin && admin.holders === 0 ? { kind: "person", id: owner } : admins;
  } catch {
    return admins;
  }
}

/**
 * One item on Home for whoever connected the app, not one per failed call: "Your <app> key stopped working". The person who connected a sync spec is its owner; a person's own connection is theirs.
 * It closes by itself when a probe of the connection answers well again (clearReconnectTask). Nothing is lost meanwhile: the outbox keeps every edit and syncing resumes.
 */
async function needsYouTask(deps: ConnectorsDeps, ctx: ConnectorsCtx, c: ConnectionDb): Promise<void> {
  const by = deps.tx.get<{ applied_by: string | null }>(
    "SELECT applied_by FROM cn_sync_specs WHERE connection_id = ?",
    c.connection_id,
  )?.applied_by;
  // whoever owns it, else whoever applied its sync spec, else whoever made it; when none of them can be told (nobody is recorded, or they are gone), the Space's admins are: it is never left to fail without a word
  const created = deps.tx.get<{ created_by: string }>(
    "SELECT created_by FROM cn_connection_creators WHERE connection_id = ?",
    c.connection_id,
  )?.created_by;
  // the first of them who is a current member of the Space; one who left, was removed or is suspended is skipped (a task made for them would reach nobody)
  const candidates = [
    c.owner_kind === "person" ? c.owner_id : undefined,
    by && by !== "system" ? by : undefined,
    created && created !== "system" ? created : undefined,
  ].filter((x): x is string => typeof x === "string" && x !== "");
  let who: string | undefined;
  for (const id of candidates) {
    // fails closed: someone the directory does not vouch for (gone, or the lookup could not be made) is skipped to the next in the chain
    if ((await memberState(ctx, id)) !== "yes") continue;
    who = id;
    break;
  }
  const title =
    deps.tx.get<{ title: string }>("SELECT title FROM cn_connectors WHERE key = ?", c.connector)?.title ?? c.title;
  const make = (assigned: { kind: "person" | "role"; id: string }) =>
    ctx.call("tasks.create", {
      kind: "unblock",
      title: `Your ${title} key stopped working`,
      summary: `${title} refused the key, so nothing syncs from it. Replace the key in the Vault; syncing resumes by itself and nothing was lost.`,
      why: "The app refused the key or sign-in.",
      assigned,
      source: { kind: "manual", id: c.connection_id },
      blocks: [{ type: "connection_fix", v: 1, data: { connectionId: c.connection_id, title } }],
      // no bare resolve: the task closes when the connection works again (Reconnect, or a replaced key and Check again), never by pressing Done
      actions: [{ key: "cannot", label: "Dismiss", note: "optional" }],
      idempotencyKey: `needs_reconnect:${c.connection_id}:${assigned.kind}:${nowOf(deps)}`,
    }) as Promise<{ task?: { id?: string } } | undefined>;
  try {
    let made: { task?: { id?: string } } | undefined;
    // told only when a task exists: the tasks module answers a replayed key with the same task, so an answer without one made none
    let told = false;
    if (who) {
      try {
        made = await make({ kind: "person", id: who });
        told = typeof made?.task?.id === "string";
      } catch {
        told = false; // the person cannot be given a task
      }
    }
    if (!told) made = await make(await lastResort(ctx));
    const taskId = made?.task?.id;
    if (taskId)
      deps.tx.run(
        "INSERT OR REPLACE INTO cn_reconnect_tasks (connection_id, task_id) VALUES (?, ?)",
        c.connection_id,
        taskId,
      );
  } catch {
    /* the connection state and the event already say it; a task that could not be made is not worth failing the call over */
  }
}

/** The key works again: the Home item closes. */
export async function clearReconnectTask(
  deps: ConnectorsDeps,
  ctx: ConnectorsCtx,
  connectionId: string,
): Promise<void> {
  const row = deps.tx.get<{ task_id: string }>(
    "SELECT task_id FROM cn_reconnect_tasks WHERE connection_id = ?",
    connectionId,
  );
  if (!row) return;
  deps.tx.run("DELETE FROM cn_reconnect_tasks WHERE connection_id = ?", connectionId);
  try {
    await ctx.call("tasks.transition", {
      taskId: row.task_id,
      to: "done",
      idempotencyKey: `needs_reconnect_done:${row.task_id}`,
    });
  } catch {
    /* already closed */
  }
}

/** Run one action of a connector. Throws the catalogue error for anything that goes wrong; the message and details never hold a secret. */
/** The sync engine's pass says so with the process's own token inside the action's input; the token is taken out before the input is used. Anyone else's input is left as it is. */
function passOf(input: unknown): { input: unknown; unmask: boolean; nonce?: string; keep?: string } {
  if (
    input !== null &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    ("__unmask" in input || "__keep" in input)
  ) {
    const { __unmask, __keep, ...rest } = input as Record<string, unknown>;
    const [token, nonce] = typeof __unmask === "string" ? __unmask.split(":") : [];
    const [ktoken, knonce] = typeof __keep === "string" ? __keep.split(":") : [];
    return {
      input: rest,
      unmask: token === SYNC_PASS_TOKEN && !!nonce,
      ...(nonce ? { nonce } : {}),
      ...(ktoken === SYNC_PASS_TOKEN && knonce ? { keep: knonce } : {}),
    };
  }
  return { input, unmask: false };
}

/** An error body with sealed values masked (JSON read and written back; text that is not JSON is cut to nothing when the connector has sealed fields). */
function maskedText(text: string, paths: readonly string[]): string {
  try {
    return JSON.stringify(maskSealed(JSON.parse(text) as unknown, paths));
  } catch {
    return "";
  }
}

/** Values a pass has just read from the Vault, kept in this process only (never written anywhere) for a few seconds, per person, connection, slot and item: every page of every type of a pass asks for the same keys, and each ask was an access check and a Vault read (30 in one burst). A rejected key forgets them (see 401 below). */
const KEPT = new Map<string, { value: string; at: number }>();
export const SECRET_KEEP_MS = 60_000;
export const forgetKept = (connectionId: string): void => {
  for (const k of KEPT.keys()) if (k.split("|")[1] === connectionId) KEPT.delete(k);
};
export const resetKept = (): void => KEPT.clear();
/** What may have changed who can use a key, or the key itself: nothing kept is used after it. */
export const forgetAllKept = (): void => KEPT.clear();
async function secretOf(
  deps: ConnectorsDeps,
  actor: string,
  connector: string,
  connectionId: string,
  slot: string,
  handle: string,
  keep: string | undefined,
  onKept: () => void,
): Promise<string | undefined> {
  if (keep === undefined) return deps.resolveSecret!(handle, { connector, connectionId, slot });
  const key = `${actor}|${connectionId}|${slot}|${handle}|${keep}`;
  const at = nowOf(deps);
  const had = KEPT.get(key);
  if (had && at - had.at >= 0 && at - had.at < SECRET_KEEP_MS) {
    // what is kept is the value only: the person's access to the connection and to the Vault item is asked again for this very call, so a share taken away stops the next call (false: the host cannot say, read it again)
    if ((await deps.recheckSecret?.(handle, { connector, connectionId, slot })) !== false) {
      onKept();
      return had.value;
    }
  }
  const value = await deps.resolveSecret!(handle, { connector, connectionId, slot });
  if (typeof value === "string") {
    if (KEPT.size > 512) KEPT.clear();
    KEPT.set(key, { value, at });
  }
  return value;
}

export async function executeAction(
  deps: ConnectorsDeps,
  ctx: ConnectorsCtx,
  def: ConnectorDef,
  actionName: string,
  o: ExecOpts = {},
): Promise<ExecResult> {
  ensureTables(deps.tx);
  const action = def.actions.find((a) => a.name === actionName);
  if (!action) refuse(ctx, "validation.bad_input", `${def.key} has no action ${actionName}.`);
  const a = action!;
  if (!a.url)
    refuse(
      ctx,
      "validation.unsupported",
      `${def.key}.${actionName} is not run by the connector runtime: its module provides it.`,
    );
  const conn = o.connection;
  const persist = o.persist !== false;
  const actor = o.actor ?? ctx.actor ?? "system";
  if (conn) {
    if (conn.connector !== def.key)
      refuse(ctx, "validation.bad_input", "That connection belongs to another connector.");
    if (conn.state === "paused")
      refuse(
        ctx,
        "validation.precondition_failed",
        `The connection is paused${conn.paused_by ? ` by ${conn.paused_by}` : ""}: resume it first.`,
      );
    if (conn.state === "pending")
      refuse(ctx, "validation.precondition_failed", "The connection is still pending: finish connecting it first.");
    if (conn.state === "needs_reconnect")
      refuse(ctx, "provider.auth_failed", "The app rejected the sign-in: reconnect the connection.");
    if (conn.owner_kind === "person" && conn.owner_id !== actor)
      refuse(ctx, "permission.no_grant", "This connection belongs to someone else.");
  }
  if (secretsIn(a.url).size || secretsIn(a.query).size)
    refuse(ctx, "validation.bad_input", "A secret cannot be part of the address.");
  // an access token that ends within a minute is refreshed before the call that would use it (calls for one connection share one refresh)
  if (conn && def.auth.type === "oauth2" && o.persist !== false && oauthOf(deps).dueSoon(conn, def))
    (await oauthOf(deps).refresh(ctx, def, conn), forgetKept(conn.connection_id));

  // secrets, by name, at call time
  const basic = a.basic ?? (def.auth.type === "api_key" || def.auth.type === "bearer" ? def.auth.basic : undefined);
  const needed = new Set<string>([
    ...secretsIn(a.headers),
    ...secretsIn(a.body),
    ...secretsIn(a.form),
    ...secretsIn(basic),
  ]);
  if (def.auth.type !== "none" && def.auth.type !== "client_credentials" && def.auth.secret)
    needed.add(def.auth.secret);
  const values: Record<string, string> = {};
  let keptUsed = false;
  for (const name of needed) {
    if (!def.secrets.some((s) => s.name === name))
      refuse(
        ctx,
        "validation.bad_input",
        `${def.key}.${actionName} reads ${name}, which the connector does not declare.`,
      );
    let v = o.secrets?.[name];
    if (v === undefined && conn) {
      const handle = connectionSecrets(conn)[name];
      if (!handle) refuse(ctx, "validation.precondition_failed", `The connection has no Vault item for ${name}.`);
      v = deps.resolveSecret
        ? await secretOf(
            deps,
            actor,
            def.key,
            conn.connection_id,
            name,
            handle!,
            o.fresh === true || o.keep === undefined ? undefined : o.keep,
            () => (keptUsed = true),
          )
        : undefined;
      if (v === undefined) refuse(ctx, "validation.precondition_failed", `The Vault item for ${name} has no value.`);
    }
    if (v === undefined) refuse(ctx, "validation.precondition_failed", `No value for ${name}.`);
    values[name] = v!;
  }
  // Scrub every secret value the connection holds, not just the ones this action reads: an app may echo any of them.
  const everySecret = [...Object.values(values), ...Object.values(o.secrets ?? {})];
  if (conn && deps.resolveSecret) {
    for (const [name, handle] of Object.entries(connectionSecrets(conn))) {
      if (name in values) continue;
      try {
        const v = await secretOf(
          deps,
          actor,
          def.key,
          conn.connection_id,
          name,
          handle,
          o.fresh === true || o.keep === undefined ? undefined : o.keep,
          () => (keptUsed = true),
        );
        if (v) everySecret.push(v);
      } catch {
        /* an unreadable item has nothing to scrub */
      }
    }
  }
  // HTTP Basic: the joined credential and its encodings are scrubbed as secrets are, since an app may echo the header it was sent
  let basicHeader: string | undefined;
  if (basic) {
    try {
      const own = { input: {}, secret: values, connection: { id: "" } };
      const cred = `${fillString(basic.user, own)}:${fillString(basic.pass ?? "", own)}`;
      const enc = Buffer.from(cred).toString("base64");
      basicHeader = `Basic ${enc}`;
      everySecret.push(cred, enc, basicHeader);
    } catch (e) {
      return refuse(ctx, "validation.bad_input", `The sign-in for ${actionName} could not be built.`);
    }
  }
  // a server-to-server token: the connection's own secrets are traded for a short-lived token by the connector's token action; it is held for this call only and is never kept
  let tokenValue: string | undefined;
  if (def.auth.type === "client_credentials") {
    const ta = def.auth.tokenAction;
    if (!ta) refuse(ctx, "validation.bad_input", `${def.key} names no token action.`);
    if (actionName !== ta && !o.dryRun) {
      const got = await executeAction(deps, ctx, def, ta!, {
        ...(conn ? { connection: conn } : {}),
        ...(o.secrets ? { secrets: o.secrets } : {}),
        ...(o.http ? { http: o.http } : {}),
        persist: false,
        input: {},
        actor,
        tokenChain: true,
      });
      if (typeof got.output !== "string" || got.output === "")
        refuse(ctx, "provider.bad_response", `${def.title} gave no token.`);
      tokenValue = got.output as string;
      everySecret.push(tokenValue, `Bearer ${tokenValue}`);
    }
  }
  // an app that issues its own OAuth client: the connection's Vault item is traded for an access token that is held in memory and renewed a minute before it ends
  if (def.auth.type === "oauth_refresh" && !o.dryRun) {
    const port = conn ? grantPortFor(deps, ctx, def, conn) : undefined;
    if (!port || !def.auth.tokenUrl)
      refuse(ctx, "validation.precondition_failed", `${def.title} has no connection to sign in with.`);
    try {
      tokenValue = await accessToken(grantKeyOf(deps, def, conn!), def.auth.tokenUrl!, port!, o.refreshed === true);
    } catch (e) {
      if (e instanceof GrantError) {
        if (e.kind === "refused") {
          if (persist) await markReconnect(deps, ctx, conn!);
          return refuse(ctx, "provider.auth_failed", e.message, { status: e.status });
        }
        return refuse(
          ctx,
          e.kind === "unreachable"
            ? "provider.network"
            : e.kind === "busy"
              ? "provider.rate_limited"
              : e.kind === "unavailable" || e.kind === "not_saved"
                ? "provider.unavailable"
                : "provider.bad_response",
          e.message,
        );
      }
      throw e;
    }
    everySecret.push(tokenValue, `Bearer ${tokenValue}`);
  }
  const scrub = scrubber(everySecret);

  // the request
  let input: unknown = o.input ?? {};
  if (
    a.shape?.unflatten &&
    typeof input === "object" &&
    input !== null &&
    typeof (input as Record<string, unknown>)["properties"] === "object"
  ) {
    input = {
      ...(input as Record<string, unknown>),
      properties: unflatten((input as { properties: Record<string, unknown> }).properties),
    };
  }
  const scope = { input, secret: values, connection: { id: conn?.connection_id ?? "con_test" } };
  // the next page of a list: a link is the whole address (still checked against the domains below), any other cursor is one query parameter
  const after =
    a.shape?.cursor && typeof (input as Record<string, unknown>)["after"] === "string"
      ? String((input as Record<string, unknown>)["after"])
      : undefined;
  const linked = a.shape?.cursor?.kind === "link" && after !== undefined;
  let method: string;
  let url: URL;
  let headers: Record<string, string>;
  let body: string | undefined;
  try {
    method = a.method ?? "GET";
    const u = new URL(linked ? after! : fillString(a.url, scope, true));
    if (!linked) for (const [k, v] of Object.entries(a.query ?? {})) u.searchParams.set(k, fillString(v, scope));
    if (!linked && after !== undefined && a.shape?.cursor?.param) u.searchParams.set(a.shape.cursor.param, after);
    // what changed since a time: the app's own filter, on every page (a link page already carries it)
    const since = (input as Record<string, unknown>)["since"];
    if (!linked && a.shape?.since && typeof since === "number" && Number.isFinite(since)) {
      const f = a.shape.since.format;
      u.searchParams.set(
        a.shape.since.param,
        f === "epoch_ms"
          ? String(Math.floor(since))
          : f === "epoch_s"
            ? String(Math.floor(since / 1000))
            : new Date(since).toISOString(),
      );
    }
    const egress = checkEgress(u.toString(), def.domains);
    if (!egress.ok)
      refuse(ctx, "permission.no_grant", `Egress refused: ${egress.reason}.`, {
        connector: def.key,
        action: actionName,
      });
    url = (egress as { ok: true; url: URL }).url;
    // a connection's key goes only to the hosts its own record lists (written when it was made), checked here before anything is filled or sent
    if (conn) {
      const rec = deps.tx.get<{ hosts: string }>(
        "SELECT hosts FROM cn_connection_hosts WHERE connection_id = ?",
        conn.connection_id,
      );
      if (rec && !(JSON.parse(rec.hosts) as string[]).includes(originKey(url))) {
        // a connector that gained a host since the person approved: the key does not go there on its own, and the person is told how to allow it
        const gained = recordHosts(def).includes(originKey(url));
        refuse(
          ctx,
          "permission.no_grant",
          gained
            ? `${def.title} now also sends to ${url.hostname}. Allow it from the connection to send the key there.`
            : "This connection may not send its key to that address.",
          { connector: def.key, action: actionName },
        );
      }
    }
    headers = {};
    if (basicHeader) headers["Authorization"] = basicHeader;
    else if (tokenValue) headers["Authorization"] = `Bearer ${tokenValue}`;
    else if (def.auth.type === "api_key" && def.auth.secret)
      headers[def.auth.header ?? "Authorization"] = `${def.auth.prefix ?? ""}${values[def.auth.secret]}`;
    else if ((def.auth.type === "bearer" || def.auth.type === "oauth2") && def.auth.secret)
      headers["Authorization"] = `Bearer ${values[def.auth.secret]}`;
    for (const [k, v] of Object.entries(a.headers ?? {})) headers[k] = fillString(v, scope);
    if (a.form !== undefined && method !== "GET") {
      body = new URLSearchParams(Object.entries(a.form).map(([k, v]) => [k, fillString(v, scope)])).toString();
      if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type"))
        headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (a.body !== undefined && method !== "GET") {
      body = JSON.stringify(fillValue(a.body, scope));
      if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type"))
        headers["Content-Type"] = "application/json";
    }
  } catch (e) {
    if ((e as { error?: unknown }).error) throw e;
    return refuse(
      ctx,
      "validation.bad_input",
      scrub.text(`The request for ${actionName} could not be built: ${e instanceof Error ? e.message : String(e)}.`),
    );
  }

  if (o.dryRun)
    return {
      output: {
        request: scrub.value({
          method,
          url: url.toString(),
          headers,
          ...(body !== undefined
            ? {
                body:
                  a.form !== undefined ? Object.fromEntries(new URLSearchParams(body)) : (JSON.parse(body) as unknown),
              }
            : {}),
        }),
      },
      dryRun: true,
    };

  // the connection's budget: a sync pass (it says so with its own token) waits here for its turn, for 30 s at most, instead of being refused and asked again. A person's own read never queues: it is refused
  // at once with the wait it needs, as before. A short wait is served here (in this process, in line) instead of being refused and asked again, which cost a refusal, an access check and a Vault read for every try
  if (conn && !o.dryRun) {
    let waited = 0;
    while (!takeToken(conn.connection_id, def.rate, nowOf(deps))) {
      const wait = Math.max(50, tokenWaitMs(conn.connection_id, def.rate, nowOf(deps)));
      const held = holdMsOf(conn.connection_id, nowOf(deps));
      if (!deps.pace || o.keep === undefined || held > 0 || wait > PACE_LONGEST_MS || waited + wait > PACE_TOTAL_MS)
        refuse(
          ctx,
          "rate_limit.exceeded",
          `The connection is at its rate limit (${def.rate ? Math.round(def.rate.rps * 60) : 0} a minute).`,
          { retryAfterMs: wait },
        );
      await deps.pace(wait);
      waited += wait;
    }
  }

  const http = o.http ?? ctx.http;
  const started = nowOf(deps);
  const logRow = (status: number | null, error: string | null): void => {
    if (!persist) return;
    deps.tx.run(
      "INSERT INTO cn_log (at, connection_id, connector, action, method, host, path, status, ms, error, actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      started,
      conn?.connection_id ?? null,
      def.key,
      actionName,
      method,
      url.hostname,
      url.pathname,
      status,
      nowOf(deps) - started,
      error === null ? null : scrub.text(error).slice(0, 300),
      actor,
    );
  };
  let res: { status: number; text(): Promise<string>; link?: string; retryAfter?: string };
  try {
    res = await http(url.toString(), { method, headers, ...(body !== undefined ? { body } : {}) });
  } catch (e) {
    const changed = (e as { error?: { code?: string } })?.error?.code;
    // the host's own line (a key that may not go to this host, Vault access that changed) is what the person reads
    if (changed === "permission.no_grant")
      return refuse(
        ctx,
        "permission.no_grant",
        (e as { error?: { message?: string } })?.error?.message || "Access changed before this connector request.",
      );
    if (changed === "validation.precondition_failed")
      return refuse(ctx, "validation.precondition_failed", "The connection changed before this request. Try again.");
    const msg = scrub.text(e instanceof Error ? e.message : String(e));
    logRow(null, msg);
    return refuse(ctx, "provider.network", `The app could not be reached: ${msg}`);
  }
  const text = await res.text();
  const ms = nowOf(deps) - started;
  o.verdict?.(res.status, text);
  if (res.status === 401 || res.status === 403) {
    logRow(res.status, "rejected the sign-in");
    // a key kept for a few seconds may be one that was just changed: forget what is kept and ask once more with the Vault's own value
    if (conn && persist && !o.fresh && keptUsed) {
      forgetKept(conn.connection_id);
      return executeAction(deps, ctx, def, actionName, { ...o, fresh: true });
    }
    // an OAuth token the app rejects is refreshed once and the call repeated; only a refresh that fails (or a repeat that is rejected again) asks the person to reconnect
    if (
      conn &&
      persist &&
      !o.refreshed &&
      def.auth.type === "oauth2" &&
      refreshSlot(def) &&
      (await oauthOf(deps).refresh(ctx, def, conn))
    ) {
      forgetKept(conn.connection_id);
      return executeAction(deps, ctx, def, actionName, { ...o, refreshed: true });
    }
    // the same for an app that issues its own OAuth client: the kept access token is dropped, a new one is asked for, and the call is repeated once
    if (conn && persist && !o.refreshed && def.auth.type === "oauth_refresh") {
      forgetAccess(grantKeyOf(deps, def, conn));
      forgetKept(conn.connection_id);
      return executeAction(deps, ctx, def, actionName, { ...o, refreshed: true });
    }
    if (conn && persist) await markReconnect(deps, ctx, conn);
    return refuse(ctx, "provider.auth_failed", "The app rejected the key or sign-in.", { status: res.status });
  }
  if (res.status === 429) {
    logRow(res.status, "rate limited");
    // the whole connection waits (every object of it), for what the app asked, or 30 s doubling when it said nothing
    const asked = parseRetryAfter(res.retryAfter, nowOf(deps));
    const wait = conn ? noteRateLimited(conn.connection_id, nowOf(deps), asked) : (asked ?? SLOW_DOWN_FIRST_MS);
    return refuse(ctx, "provider.rate_limited", "The app asked Vyre to slow down.", {
      status: res.status,
      retryAfterMs: wait,
    });
  }
  if (conn) noteServed(conn.connection_id);
  if (res.status >= 500) {
    logRow(res.status, "server error");
    return refuse(ctx, "provider.unavailable", `The app answered ${res.status}.`, { status: res.status });
  }
  if (res.status >= 400) {
    logRow(res.status, "refused the request");
    return refuse(ctx, "provider.bad_response", `The app refused the request (${res.status}).`, {
      status: res.status,
      // the service's own words for the refusal, guarded like an answer: a refusal that carries someone's token (an account list in an error) never shows it
      body: scrub.text(withoutSecretValues(def.sealed?.length ? maskedText(text, def.sealed) : text)).slice(0, 200),
    });
  }
  let parsed: unknown = text;
  try {
    parsed = text === "" ? null : (JSON.parse(text) as unknown);
  } catch {
    /* the output is the text */
  }
  let output: unknown;
  try {
    output =
      a.shape?.items !== undefined
        ? shapeList(parsed, res.link, a.shape, after)
        : a.shape?.idAt !== undefined
          ? (shapeCreated(parsed, a.shape) ?? parsed)
          : a.output !== undefined
            ? (pointerGet(parsed, a.output) ?? null)
            : parsed;
  } catch (e) {
    if (!(e instanceof ShapeError)) throw e;
    logRow(res.status, e.message);
    return refuse(ctx, "provider.bad_response", scrub.text(`${actionName}: ${e.message}`));
  }
  // the token a server-to-server service hands out is the runtime's own: run on its own (by an agent, a person's test or a check) the token call answers nothing of it
  if (def.auth.type === "client_credentials" && actionName === def.auth.tokenAction && o.tokenChain !== true)
    output = null;
  // no action hands a secret back, whatever the app put in its answer (an auth token of another account, a client secret): values under secret-named keys are never part of an output. The runtime's own token call is the one exception.
  if (o.tokenChain !== true) output = withoutSecretValues(output);
  // a sealed field's value (and the other values of its item) is "[sealed]" for every caller but the sync engine's own pass
  if (def.sealed?.length && o.unmask === true && o.passNonce !== undefined) {
    // the sync engine's pass: the real values stay in this process for the engine to seal; the answer carries the mask like everyone's
    const rows = (output as { rows?: unknown } | null)?.rows;
    if (Array.isArray(rows))
      for (const r of rows as { id?: unknown; data?: Record<string, unknown> }[])
        if (r && typeof r.id === "string" && r.data) {
          const held: Record<string, unknown> = {};
          for (const p of def.sealed) if (p in r.data) held[p] = r.data[p];
          SEALED_HELD.put(o.passNonce, r.id, held);
        }
  }
  // (a recorded case of the harness holds made-up values and is compared as it is)
  if (def.sealed?.length && !(o.unmask === true && o.passNonce === undefined)) output = maskSealed(output, def.sealed);
  output = scrub.value(output);
  logRow(res.status, null);
  return { output, dryRun: false, status: res.status, ms };
}

// ---- the replay harness ----

/** Static checks and recorded-response cases of a definition. Nothing is sent anywhere. */
export async function runCases(deps: ConnectorsDeps, ctx: ConnectorsCtx, def: ConnectorDef): Promise<TestResult> {
  const cases: TestResult["cases"] = [];
  const add = (name: string, ok: boolean, message?: string): void => {
    cases.push({ name, ok, ...(ok || !message ? {} : { message }) });
  };

  // static
  const declared = new Set(def.secrets.map((s) => s.name));
  const used = new Set<string>(def.auth.secret ? [def.auth.secret] : []);
  secretsIn(def.auth.basic, used);
  const bad: string[] = [];
  for (const a of def.actions) {
    if (!a.url) continue;
    secretsIn(a.headers, used);
    secretsIn(a.body, used);
    secretsIn(a.form, used);
    secretsIn(a.basic, used);
    if (secretsIn(a.url).size || secretsIn(a.query).size) bad.push(`${a.name}: a secret in the address`);
    const probe = a.url.replace(/\{(input|connection)\.[A-Za-z0-9_.]+\}/g, "x");
    const eg = checkEgress(probe, def.domains);
    if (!eg.ok) bad.push(`${a.name}: ${eg.reason}`);
  }
  add("egress: every action stays inside the declared domains", bad.length === 0, bad.join("; "));
  const undeclared = [...used].filter((n) => !declared.has(n));
  add(
    "secrets: every secret an action reads is declared",
    undeclared.length === 0,
    `undeclared: ${undeclared.join(", ")}`,
  );
  add(
    "health: the health action exists",
    def.health === undefined || def.actions.some((a) => a.name === def.health),
    `no action ${def.health}`,
  );
  if (def.auth.type === "oauth2") {
    const eg = [def.auth.authUrl, def.auth.tokenUrl].map((u) =>
      u ? checkEgress(u, def.domains) : { ok: false as const, reason: "missing" },
    );
    add(
      "auth: sign-in and token addresses are declared domains",
      eg.every((e) => e.ok),
      eg
        .filter((e) => !e.ok)
        .map((e) => (e as { reason: string }).reason)
        .join("; "),
    );
  }

  // recorded responses
  const synthetic = Object.fromEntries(def.secrets.map((s) => [s.name, `test-secret-${s.name}-0000`]));
  for (const t of def.tests ?? []) {
    let requests = 0;
    const fill = (v: unknown): unknown =>
      fillValue(v, { input: t.input ?? {}, secret: synthetic, connection: { id: "con_test" } });
    const http: Http = async (url, init) => {
      requests++;
      const method = (init?.method ?? "GET").toUpperCase();
      const bare = url.split("?")[0]!;
      const hit = t.responses.find(
        (r) => (r.method ?? "GET").toUpperCase() === method && (r.url === url || r.url === bare),
      );
      if (!hit) throw new Error(`no recorded response for ${method} ${bare}`);
      const text =
        hit.body === undefined
          ? ""
          : typeof hit.body === "string"
            ? (fill(hit.body) as string)
            : JSON.stringify(fill(hit.body));
      return { status: hit.status ?? 200, text: async () => text, ...(hit.link ? { link: hit.link } : {}) };
    };
    try {
      const out = await executeAction(deps, ctx, def, t.action, {
        input: t.input ?? {},
        secrets: synthetic,
        http,
        persist: false,
        actor: "harness",
        unmask: true, // a recorded case holds made-up values, and what it expects is compared as it is
      });
      if (t.expect?.error) {
        add(t.name, false, `expected the error ${t.expect.error}, got an output`);
        continue;
      }
      if (t.expect?.output !== undefined && canonical(out.output) !== canonical(t.expect.output)) {
        add(t.name, false, `output differs: got ${JSON.stringify(out.output).slice(0, 200)}`);
        continue;
      }
      if (t.expect?.requests !== undefined && requests !== t.expect.requests) {
        add(t.name, false, `expected ${t.expect.requests} requests, made ${requests}`);
        continue;
      }
      add(t.name, true);
    } catch (e) {
      const code = (e as { error?: { code?: string; message?: string } }).error?.code;
      if (t.expect?.error && code === t.expect.error) add(t.name, true);
      else
        add(
          t.name,
          false,
          `${code ?? "error"}: ${(e as { error?: { message?: string } }).error?.message ?? (e instanceof Error ? e.message : String(e))}`,
        );
    }
  }
  const failed = cases.filter((c) => !c.ok).length;
  return { passed: cases.length - failed, failed, cases };
}

// ---- diff ----

const lines = (v: unknown): string[] => JSON.stringify(v, null, 2).split("\n");
function lineDiff(a: unknown, b: unknown): { added: number; removed: number } {
  const x = lines(a);
  const y = lines(b);
  const count = new Map<string, number>();
  for (const l of x) count.set(l, (count.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of y) {
    const n = count.get(l) ?? 0;
    if (n > 0) count.set(l, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of count.values()) removed += n;
  return { added, removed };
}

function splitFiles(d: ConnectorDef | undefined): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!d) return out;
  const { actions, tests, version: _version, ...main } = d;
  void _version;
  out.set("connector.toml", main);
  for (const a of actions) out.set(`actions/${a.name}.json`, a);
  for (const t of tests ?? []) out.set(`tests/${t.name}.json`, t);
  return out;
}

export function diffDefs(
  live: ConnectorDef | undefined,
  draft: ConnectorDef,
): { files: { path: string; added: number; removed: number }[]; breaking: boolean } {
  const a = splitFiles(live);
  const b = splitFiles(draft);
  const files: { path: string; added: number; removed: number }[] = [];
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(path);
    const y = b.get(path);
    if (x !== undefined && y !== undefined && canonical(x) === canonical(y)) continue;
    const d = lineDiff(x ?? null, y ?? null);
    files.push({
      path,
      added: x === undefined ? lines(y).length : d.added,
      removed: y === undefined ? lines(x).length : d.removed,
    });
  }
  let breaking = false;
  if (live) {
    for (const act of live.actions) {
      const next = draft.actions.find((n) => n.name === act.name);
      if (!next || (act.method ?? "GET") !== (next.method ?? "GET") || act.url !== next.url) breaking = true;
    }
    if (live.secrets.some((s) => !draft.secrets.some((n) => n.name === s.name))) breaking = true;
    if (canonical(live.auth) !== canonical(draft.auth) || live.mode !== draft.mode || live.scope !== draft.scope)
      breaking = true;
    if (live.domains.some((dom) => !draft.domains.includes(dom))) breaking = true;
  }
  return { files, breaking };
}

const bump = (v: string, breaking: boolean): string => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m || v === "0.0.0") return "1.0.0";
  return breaking ? `${Number(m[1]) + 1}.0.0` : `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
};

// ---- handlers ----

interface ConnectorDb {
  key: string;
  title: string;
  mode: Mode;
  scope: Scope;
  builtin: number;
  version: string;
  state: ConnectorState;
  def: string;
  created_at: number;
  updated_at: number;
}
interface DraftDb {
  draft_id: string;
  key: string;
  def: string;
  note: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export function createRuntimeHandlers(deps: ConnectorsDeps): RuntimeHandlers {
  const { tx } = deps;
  const ready = (): void => {
    ensureTables(tx);
    seedBuiltins(deps);
  };
  const need = (ctx: ConnectorsCtx, key: string): ConnectorDb => {
    ready();
    return (
      tx.get<ConnectorDb>("SELECT * FROM cn_connectors WHERE key = ?", key) ??
      refuse(ctx, "validation.not_found", `There is no connector ${key}.`)
    );
  };
  const rowOf = (r: ConnectorDb): ConnectorRow => {
    const def = JSON.parse(r.def) as ConnectorDef;
    return {
      key: r.key,
      title: r.title,
      mode: r.mode,
      scope: r.scope,
      builtin: r.builtin === 1,
      version: r.version,
      state: r.state,
      domains: def.domains,
      secrets: def.secrets,
      connections: tx.get<{ n: number }>("SELECT count(*) AS n FROM cn_connections WHERE connector = ?", r.key)?.n ?? 0,
      syncedTypes: def.syncedTypes ?? [],
      actions: def.actions.map((a) => a.name),
      sources: def.sources ?? [],
      ...(sourceOf(r.key) ? { sourceFolderId: sourceOf(r.key)! } : {}),
      ...(objectsOf(def) ? { objects: objectsOf(def)! } : {}),
    };
  };
  const sourceOf = (key: string): string | undefined =>
    tx.get<{ folder_id: string }>("SELECT folder_id FROM cn_source_folders WHERE key = ?", key)?.folder_id;
  const draftOf = async (
    ctx: ConnectorsCtx,
    key: string,
    draftId?: string,
  ): Promise<{ row: DraftDb; def: ConnectorDef }> => {
    let row =
      draftId !== undefined
        ? tx.get<DraftDb>("SELECT * FROM cn_drafts WHERE draft_id = ? AND key = ?", draftId, key)
        : tx.get<DraftDb>("SELECT * FROM cn_drafts WHERE key = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", key);
    // A connector with an editable source never needs a Build just to be tested or published again: its draft is whatever the source says now.
    if (!row && draftId === undefined && sourceOf(key) && deps.loadFolderDef) {
      const at = nowOf(deps),
        id = mintShort("cdr", at),
        live = tx.get<{ def: string }>("SELECT def FROM cn_connectors WHERE key = ?", key);
      tx.run(
        "INSERT INTO cn_drafts (draft_id, key, def, note, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        id,
        key,
        live?.def ?? "{}",
        null,
        ctx.actor ?? null,
        at,
        at,
      );
      row = tx.get<DraftDb>("SELECT * FROM cn_drafts WHERE draft_id = ?", id);
    }
    if (!row)
      return refuse(
        ctx,
        "validation.not_found",
        draftId ? `There is no draft ${draftId} of ${key}.` : `${key} has no draft: build one first.`,
      );
    let def = JSON.parse(row.def) as ConnectorDef;
    const fromFolder = deps.loadFolderDef ? await deps.loadFolderDef(key) : undefined;
    if (fromFolder) {
      def = { ...fromFolder, key };
      tx.run(
        "UPDATE cn_drafts SET def = ?, updated_at = ? WHERE draft_id = ?",
        JSON.stringify(def),
        nowOf(deps),
        row.draft_id,
      );
    }
    return { row, def };
  };
  /** Create the canonical source and register its mapping before the first file is written; a failure leaves no mapping behind. */
  const writeSource = async (ctx: ConnectorsCtx, key: string, def: ConnectorDef): Promise<string> => {
    try {
      return await deps.writeSource!(key, folderFiles(def), (folderId) => {
        tx.run(
          "INSERT INTO cn_source_folders (key, folder_id, created_by, created_at) VALUES (?, ?, ?, ?)",
          key,
          folderId,
          ctx.actor ?? "system",
          nowOf(deps),
        );
      });
    } catch (e) {
      tx.run("DELETE FROM cn_source_folders WHERE key = ?", key);
      throw e;
    }
  };
  const folderFiles = (def: ConnectorDef): { path: string; content: string }[] => {
    const { actions, tests } = def;
    return [
      { path: "connector.toml", content: generateMain(def) },
      ...actions.map((a) => ({ path: `actions/${a.name}.json`, content: JSON.stringify(a, null, 2) })),
      ...(tests ?? []).map((t) => ({ path: `tests/${t.name}.json`, content: JSON.stringify(t, null, 2) })),
      {
        path: "README.md",
        content: `# ${def.title}\n\nConnector ${def.key} (${def.mode}). Domains: ${def.domains.join(", ") || "none yet"}.\n`,
      },
    ];
  };

  return {
    "connectors.list": async (_ctx, input) => {
      ready();
      const rows = tx
        .all<ConnectorDb>(
          `SELECT * FROM cn_connectors ${input.state !== undefined ? "WHERE state = ?" : ""} ORDER BY builtin DESC, key`,
          ...(input.state !== undefined ? [input.state] : []),
        )
        .map(rowOf);
      const { start, limit } = PAGE(input);
      return {
        connectors: rows.slice(start, start + limit),
        ...(start + limit < rows.length ? { next: String(start + limit) } : {}),
        total: rows.length,
      };
    },

    "connectors.get": async (ctx, input) => ({ connector: rowOf(need(ctx, input.key)) }),

    "connectors.init": async (ctx, input) => {
      ready();
      if (!KEY.test(input.key))
        refuse(
          ctx,
          "validation.bad_input",
          `${input.key} is not a connector key: lowercase letters, digits, dashes and underscores.`,
        );
      if (!MODES.includes(input.mode))
        refuse(ctx, "validation.bad_input", `${String(input.mode)} is not a connector mode.`);
      if (!input.title.trim()) refuse(ctx, "validation.bad_input", "A connector needs a title.");
      if (tx.get("SELECT 1 AS x FROM cn_connectors WHERE key = ?", input.key))
        refuse(ctx, "validation.duplicate", `There is already a connector ${input.key}.`);
      const now = nowOf(deps);
      const def: ConnectorDef = {
        key: input.key,
        title: input.title,
        mode: input.mode,
        scope: input.mode === "webhook_only" || input.mode === "api" ? "space" : "person",
        version: "0.0.0",
        auth: {
          type: input.mode === "webhook_only" ? "none" : "api_key",
          ...(input.mode === "webhook_only" ? {} : { secret: `${input.title.replace(/[^A-Za-z0-9]+/g, "_")}_Key` }),
        },
        domains: [],
        secrets:
          input.mode === "webhook_only"
            ? []
            : [
                {
                  name: `${input.title.replace(/[^A-Za-z0-9]+/g, "_")}_Key`,
                  description: `API key for ${input.title}`,
                },
              ],
        actions: [],
        tests: [],
      };
      // source: false keeps the draft in the module (an agent defines it with connectors.define); the default writes the editable folder in Files
      const withSource = input.source !== false;
      if (withSource && !deps.writeSource)
        refuse(ctx, "internal.unavailable", "Files is not available to write the connector source.");
      const folderId = withSource ? await writeSource(ctx, input.key, def) : undefined;
      tx.run(
        "INSERT INTO cn_connectors (key, title, mode, scope, builtin, version, state, def, created_at, updated_at) VALUES (?, ?, ?, ?, 0, '0.0.0', 'draft', ?, ?, ?)",
        input.key,
        input.title,
        def.mode,
        def.scope,
        JSON.stringify(def),
        now,
        now,
      );
      const draftId = mintShort("cdr", now);
      tx.run(
        "INSERT INTO cn_drafts (draft_id, key, def, note, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        draftId,
        input.key,
        JSON.stringify(def),
        input.docsUrl ?? null,
        ctx.actor ?? null,
        now,
        now,
      );
      ctx.emit("connector.created", `connector/${input.key}`, { key: input.key });
      return { key: input.key, ...(folderId !== undefined ? { folderId } : {}) };
    },

    "connectors.define": async (ctx, input) => {
      const c = need(ctx, input.key);
      if (c.builtin === 1)
        refuse(ctx, "validation.precondition_failed", `${c.key} is built in: it changes with a release.`);
      if (sourceOf(c.key))
        refuse(
          ctx,
          "validation.precondition_failed",
          `${c.key} is edited in its Files folder. Change the files there.`,
        );
      const live = JSON.parse(c.def) as ConnectorDef;
      const slot = input.auth.secret ?? input.secrets?.[0]?.name;
      const secrets =
        input.auth.type === "none"
          ? []
          : input.secrets && input.secrets.length > 0
            ? input.secrets
            : [{ name: slot ?? "Key", description: `API key for ${input.title ?? live.title}` }];
      const main: Record<string, unknown> = {
        title: input.title ?? live.title,
        mode: live.mode,
        scope: live.scope,
        domains: input.domains,
        auth: {
          type: input.auth.type,
          ...(input.auth.type === "none" ? {} : { secret: input.auth.secret ?? secrets[0]!.name }),
          ...(input.auth.header ? { header: input.auth.header } : {}),
          ...(input.auth.prefix !== undefined ? { prefix: input.auth.prefix } : {}),
        },
        secrets,
      };
      const docs = input.actions.map((a) => ({
        path: `actions/${a.name}.json`,
        doc: {
          ...a,
          method: (a.method ?? "GET").toUpperCase(),
          ...(a.write === undefined && (a.method ?? "GET").toUpperCase() !== "GET" ? { write: true } : {}),
        },
      }));
      const def = buildDef(ctx, c.key, main, docs, []);
      // an action that is not a GET changes something in the app; it must say so, so a dry run never sends it and the Gate holds it
      for (const a of def.actions)
        if ((a.method ?? "GET") !== "GET" && a.write !== true)
          refuse(ctx, "validation.bad_input", `${a.name} is a ${a.method}: mark it write.`);
      for (const a of def.actions)
        if (a.url && !checkEgress(a.url, def.domains).ok)
          refuse(ctx, "validation.bad_input", `${a.name} reaches a host that is not in domains.`);
      const now = nowOf(deps);
      let row = tx.get<DraftDb>(
        "SELECT * FROM cn_drafts WHERE key = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
        c.key,
      );
      if (!row) {
        const id = mintShort("cdr", now);
        tx.run(
          "INSERT INTO cn_drafts (draft_id, key, def, note, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          id,
          c.key,
          JSON.stringify(def),
          null,
          ctx.actor ?? null,
          now,
          now,
        );
        row = tx.get<DraftDb>("SELECT * FROM cn_drafts WHERE draft_id = ?", id)!;
      } else
        tx.run(
          "UPDATE cn_drafts SET def = ?, updated_at = ? WHERE draft_id = ?",
          JSON.stringify(def),
          now,
          row.draft_id,
        );
      ctx.emit("connector.built", `connector/${c.key}`, { key: c.key, draftId: row.draft_id });
      return { key: c.key, draftId: row.draft_id, actions: def.actions.map((a) => a.name), domains: def.domains };
    },

    "connectors.build": async (ctx, input) => {
      const c = need(ctx, input.key);
      const now = nowOf(deps);
      const draftId = mintShort("cdr", now);
      const base = (await draftOf(ctx, c.key).catch(() => undefined))?.def ?? (JSON.parse(c.def) as ConnectorDef);
      // A connector made before sources were canonical has no mapped folder. An explicit Build writes one from its stored definition; a private export is never searched for or moved.
      if (!c.builtin && !sourceOf(c.key) && deps.writeSource) await writeSource(ctx, c.key, base);
      tx.run(
        "INSERT INTO cn_drafts (draft_id, key, def, note, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        draftId,
        c.key,
        JSON.stringify(base),
        [input.docsUrl, input.notes].filter(Boolean).join("\n") || null,
        ctx.actor ?? null,
        now,
        now,
      );
      const started = (await ctx.call("runs.start", {
        kind: "connector_build",
        owner: ctx.actor ?? "system",
        idempotencyKey: `connector_build:${c.key}:${draftId}`,
        name: `Build the ${c.title} connector`,
      })) as { runId: string };
      ctx.emit("connector.built", `connector/${c.key}`, { key: c.key, draftId });
      return { runId: started.runId, draftId };
    },

    "connectors.test": async (ctx, input) => {
      const c = need(ctx, input.key);
      const useDraft =
        input.draftId !== undefined ||
        sourceOf(c.key) !== undefined ||
        (c.state === "draft" && tx.get("SELECT 1 AS x FROM cn_drafts WHERE key = ?", c.key) !== undefined);
      const def = useDraft ? (await draftOf(ctx, c.key, input.draftId)).def : (JSON.parse(c.def) as ConnectorDef);
      return { result: await runCases(deps, ctx, def) };
    },

    "connectors.read": async (ctx, input) => {
      const c = need(ctx, input.key);
      const def = JSON.parse(c.def) as ConnectorDef;
      const action = def.actions.find((a) => a.name === input.action);
      if (!action) return refuse(ctx, "validation.bad_input", `${c.key} has no action ${input.action}.`);
      if (action.write === true || (action.method ?? "GET") !== "GET")
        return refuse(
          ctx,
          "validation.bad_input",
          `${input.action} writes to the app: it goes through connectors.run.`,
        );
      const conn =
        tx.get<ConnectionDb>("SELECT * FROM cn_connections WHERE connection_id = ?", input.connectionId) ??
        refuse(ctx, "validation.not_found", "There is no such connection.");
      if (conn.owner_kind === "person" && conn.owner_id !== (ctx.actor ?? "system"))
        refuse(ctx, "validation.not_found", "There is no such connection.");
      const pass = passOf(input.input);
      const out = await executeAction(deps, ctx, def, input.action, {
        connection: conn,
        input: pass.input,
        ...(pass.unmask ? { unmask: true, passNonce: pass.nonce! } : {}),
        ...(pass.keep ? { keep: pass.keep } : {}),
      });
      tx.run("UPDATE cn_connections SET last_sync_at = ? WHERE connection_id = ?", nowOf(deps), conn.connection_id);
      return { output: out.output };
    },

    "connectors.run": async (ctx, input) => {
      const c = need(ctx, input.key);
      if (c.state === "draft")
        refuse(
          ctx,
          "validation.precondition_failed",
          `${c.key} is a draft: publish it before running it against the app.`,
        );
      const conn =
        tx.get<ConnectionDb>("SELECT * FROM cn_connections WHERE connection_id = ?", input.connectionId) ??
        refuse(ctx, "validation.not_found", "There is no such connection.");
      if (conn.owner_kind === "person" && conn.owner_id !== (ctx.actor ?? "system"))
        refuse(ctx, "validation.not_found", "There is no such connection.");
      const pass = passOf(input.input);
      const out = await executeAction(deps, ctx, JSON.parse(c.def) as ConnectorDef, input.action, {
        connection: conn,
        input: pass.input,
        dryRun: input.dryRun === true,
        ...(pass.unmask ? { unmask: true, passNonce: pass.nonce! } : {}),
        ...(pass.keep ? { keep: pass.keep } : {}),
      });
      if (!out.dryRun)
        tx.run("UPDATE cn_connections SET last_sync_at = ? WHERE connection_id = ?", nowOf(deps), conn.connection_id);
      return { output: out.output, dryRun: out.dryRun };
    },

    "connectors.diff": async (ctx, input) => {
      const c = need(ctx, input.key);
      const { def } = await draftOf(ctx, c.key, input.draftId);
      return diffDefs(
        c.state === "draft" && c.version === "0.0.0" ? undefined : (JSON.parse(c.def) as ConnectorDef),
        def,
      );
    },

    "connectors.publish": async (ctx, input) => {
      const c = need(ctx, input.key);
      if (c.builtin === 1)
        refuse(
          ctx,
          "validation.precondition_failed",
          `${c.key} is built in: it changes with a release, not a publish.`,
        );
      const { row, def } = await draftOf(ctx, c.key, input.draftId);
      const result = await runCases(deps, ctx, def);
      if (result.failed === 0 && sourceOf(c.key)) {
        // The tests ran over awaited calls. Before anything is published, the caller's authority is asked again and the source is read again: what is published is exactly what was tested, and
        // if either changed the last good version stays live.
        await deps.assertCanPublish?.(c.key);
        const again = deps.loadFolderDef ? await deps.loadFolderDef(c.key) : undefined;
        if (again && canonical({ ...again, key: c.key }) !== canonical({ ...def, key: c.key }))
          refuse(
            ctx,
            "validation.precondition_failed",
            "The source changed while it was being tested. Nothing was published; test it again.",
          );
      }
      if (result.failed > 0) {
        ctx.emit("connector.publish_failed", `connector/${c.key}`, { key: c.key, failed: result.failed });
        return { published: false, result };
      }
      const live = c.version === "0.0.0" ? undefined : (JSON.parse(c.def) as ConnectorDef);
      const version = bump(c.version, live ? diffDefs(live, def).breaking : false);
      const now = nowOf(deps);
      const next: ConnectorDef = { ...clone(def), key: c.key, version };
      tx.run(
        "INSERT INTO cn_versions (key, version, def, at, by, note, tests) VALUES (?, ?, ?, ?, ?, ?, ?)",
        c.key,
        version,
        JSON.stringify(next),
        now,
        ctx.actor ?? "system",
        input.note ?? null,
        result.passed,
      );
      tx.run(
        "UPDATE cn_connectors SET title = ?, mode = ?, scope = ?, version = ?, state = 'live', def = ?, updated_at = ? WHERE key = ?",
        next.title,
        next.mode,
        next.scope,
        version,
        JSON.stringify(next),
        now,
        c.key,
      );
      tx.run("DELETE FROM cn_drafts WHERE draft_id = ?", row.draft_id);
      ctx.emit("connector.published", `connector/${c.key}`, { key: c.key, version, tests: result.passed });
      return { published: true, version, result };
    },

    "connectors.versions": async (ctx, input) => {
      need(ctx, input.key);
      const rows = tx.all<{ version: string; at: number; by: string; note: string | null; tests: number }>(
        "SELECT version, at, by, note, tests FROM cn_versions WHERE key = ? ORDER BY at DESC, rowid DESC",
        input.key,
      );
      return {
        versions: rows.map((r) => ({
          version: r.version,
          at: r.at,
          by: r.by,
          ...(r.note !== null ? { note: r.note } : {}),
          tests: r.tests,
        })),
      };
    },

    "connectors.rollback": async (ctx, input) => {
      const c = need(ctx, input.key);
      const v =
        tx.get<{ def: string }>(
          "SELECT def FROM cn_versions WHERE key = ? AND version = ?",
          input.key,
          input.version,
        ) ?? refuse(ctx, "validation.not_found", `${c.key} has no version ${input.version}.`);
      const def = JSON.parse(v.def) as ConnectorDef;
      tx.run(
        "UPDATE cn_connectors SET title = ?, mode = ?, scope = ?, version = ?, state = 'live', def = ?, updated_at = ? WHERE key = ?",
        def.title,
        def.mode,
        def.scope,
        input.version,
        v.def,
        nowOf(deps),
        c.key,
      );
      ctx.emit("connector.rolled_back", `connector/${c.key}`, { key: c.key, version: input.version });
      return { ok: true };
    },

    "connectors.export": async (ctx, input) => {
      const c = need(ctx, input.key);
      if (!deps.writeFolder)
        refuse(ctx, "internal.unavailable", "Files is not available to write the connector folder.");
      return { folderId: await deps.writeFolder!(c.key, folderFiles(JSON.parse(c.def) as ConnectorDef)) };
    },

    "connectors.remove": async (ctx, input) => {
      const c = need(ctx, input.key);
      if (c.builtin === 1) refuse(ctx, "validation.precondition_failed", `${c.key} is built in and cannot be removed.`);
      const bound = deps.boundSyncedTypes ? await deps.boundSyncedTypes(c.key) : [];
      if (bound.length)
        refuse(
          ctx,
          "validation.precondition_failed",
          `${bound.join(", ")} still sync through ${c.key}: detach them first.`,
          { syncedTypes: bound },
        );
      for (const conn of tx.all<{ connection_id: string }>(
        "SELECT connection_id FROM cn_connections WHERE connector = ?",
        c.key,
      )) {
        await oauthOf(deps).revoke(
          ctx,
          JSON.parse(c.def) as ConnectorDef,
          tx.get<ConnectionDb>("SELECT * FROM cn_connections WHERE connection_id = ?", conn.connection_id)!,
        );
        tx.run(
          "DELETE FROM cn_oauth_flow WHERE state IN (SELECT state FROM cn_oauth WHERE connection_id = ?)",
          conn.connection_id,
        );
        tx.run("DELETE FROM cn_oauth WHERE connection_id = ?", conn.connection_id);
        {
          const full = tx.get<ConnectionDb>("SELECT * FROM cn_connections WHERE connection_id = ?", conn.connection_id);
          if (full) await forgetGrantOf(deps, ctx, full);
        }
        tx.run("DELETE FROM cn_connections WHERE connection_id = ?", conn.connection_id);
        ctx.emit("connection.deleted", `connection/${conn.connection_id}`, {
          connectionId: conn.connection_id,
          connector: c.key,
        });
      }
      tx.run("DELETE FROM cn_drafts WHERE key = ?", c.key);
      tx.run("DELETE FROM cn_versions WHERE key = ?", c.key);
      tx.run("DELETE FROM cn_source_folders WHERE key = ?", c.key); // the folder stays in Files as an ordinary folder; only the connector's claim on it ends
      tx.run("DELETE FROM cn_connectors WHERE key = ?", c.key);
      ctx.emit("connector.removed", `connector/${c.key}`, { key: c.key });
      return { removed: true };
    },

    "connectors.health": async () => {
      ready();
      const rows = tx.all<{ connection_id: string; state: string; title: string }>(
        "SELECT connection_id, state, title FROM cn_connections WHERE state != 'paused'",
      );
      const bad = rows.filter((r) => r.state === "failing" || r.state === "needs_reconnect");
      if (!bad.length) return { state: "healthy" as const, failing: [] };
      const down = bad.length === rows.length;
      return {
        state: down ? ("down" as const) : ("degraded" as const),
        detail: `${bad.length} of ${rows.length} connection${rows.length === 1 ? "" : "s"} ${bad.length === 1 ? "needs" : "need"} attention: ${bad.map((b) => b.title).join(", ")}`,
        failing: bad.map((b) => b.connection_id),
      };
    },
  };
}

export type { TestCase };
