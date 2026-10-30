// Connectors an agent or a person writes: save a definition, read it back with its levels, remove it, publish it, allow a host for a key, and read or rotate a webhook address.
// A saved connector is always at a draft level. A read earns tested (try_read). A person with connectors.manage moves tested to published.
import { actionStepKey, normalizeConnector, triggerLevelKey } from "../connector-def.ts";
import type { ConnectorDef } from "../connector-def.ts";
import { proven, storedLevel } from "../connector-level.ts";
import { connectorLevel, getConnector, getHook, getPoll, hostTrusted, levelOfAction, levelOfTrigger, listConnectors, publishTested, removeConnector, saveConnector, setHook, trustHost } from "../connector-store.ts";
import type { ConnectorRow } from "../connector-store.ts";
import { isAuthor, publishedPart } from "../connector-audience.ts";
import { allAutomations, me, newSecret, raise } from "../projections.ts";
import type { AutoCtx } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

const HANDLE = /^#[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** The address a webhook trigger is posted to. The path carries the secret, as an Automation's does. */
export function appHookUrl(ctx: Pick<AutoCtx, "baseUrl">, app: string, trigger: string, secret: string): string {
  const path = `/hooks/app/${app}/${trigger}/${secret}`;
  return ctx.baseUrl ? `${ctx.baseUrl.replace(/\/+$/, "")}${path}` : path;
}

function handleOf(raise_: (m: string) => never, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return raise_("vaultHandle is the name of a Vault item, such as #Stripe.");
  const base = value.trim().replace(/\.[A-Za-z0-9_]+$/, "");
  if (!HANDLE.test(base)) return raise_("vaultHandle is the name of a Vault item, such as #Stripe. Never the key itself.");
  return base;
}

export function view(ctx: Pick<AutoCtx, "db" | "baseUrl">, row: ConnectorRow, o: { webhookUrls?: boolean; def?: ConnectorDef } = {}): Record<string, unknown> {
  const def = o.def ?? row.def;
  const level = connectorLevel(ctx.db, def);
  return {
    app: def.app,
    title: def.title,
    ...(def.docsUrl ? { docsUrl: def.docsUrl } : {}),
    level,
    domains: def.domains,
    auth: def.auth,
    ...(row.vaultHandle ? { vaultHandle: row.vaultHandle } : {}),
    owner: row.owner,
    actions: def.actions.map((a) => ({
      key: a.key, title: a.title, ...(a.description ? { description: a.description } : {}), method: a.method, path: a.path, effect: a.effect, params: a.params,
      ...(a.output !== undefined ? { output: a.output } : {}), level: levelOfAction(ctx.db, def.app, a.key), stepKey: actionStepKey(def.app, a.key),
    })),
    triggers: def.triggers.map((t) => {
      const poll = t.kind === "poll" ? getPoll(ctx.db, def.app, t.key) : undefined;
      const hook = t.kind === "webhook" ? getHook(ctx.db, def.app, t.key) : undefined;
      return {
        key: t.key, title: t.title, kind: t.kind, level: levelOfTrigger(ctx.db, def.app, t.key),
        ...(t.kind === "poll" ? { action: t.action, intervalSec: t.intervalSec } : {}),
        ...(poll ? { polling: { primed: poll.primed, fired: poll.fired, ...(poll.lastAt !== null ? { lastAt: poll.lastAt } : {}), ...(poll.lastStatus !== null ? { lastStatus: poll.lastStatus } : {}), ...(poll.lastError ? { lastError: poll.lastError } : {}), failures: poll.fails } } : {}),
        ...(t.kind === "webhook" ? { webhook: { exists: hook !== undefined, ...(hook?.lastDeliveryAt != null ? { lastDeliveryAt: hook.lastDeliveryAt } : {}), ...(o.webhookUrls && hook ? { url: appHookUrl(ctx, def.app, t.key, hook.secret) } : {}) } } : {}),
      };
    }),
    updatedAt: row.updatedAt,
    ...(row.publishedAt !== null ? { publishedAt: row.publishedAt } : {}),
  };
}

function canEdit(ctx: AutoCtx, row: ConnectorRow): boolean {
  if (row.owner.id === me(ctx)) return true;
  return !!ctx.authorize && ctx.authorize({ perm: "connectors.manage", level: "manage" }, { type: "space", id: ctx.space }).effect === "allow";
}

export async function connectorSave(ctx: AutoCtx, input: In): Promise<unknown> {
  const normal = normalizeConnector(input.definition);
  if (!normal.ok) raise(ctx, "validation.bad_input", normal.problems[0], { problems: normal.problems });
  const def: ConnectorDef = normal.def;
  const handle = handleOf((m) => raise(ctx, "validation.bad_input", m), input.vaultHandle);
  const before = getConnector(ctx.db, def.app);
  if (before && !canEdit(ctx, before)) raise(ctx, "permission.not_found", "That connector is not available.");
  const owner = before?.owner ?? { kind: ctx.actingFor ? "person" : ctx.principal.kind, id: me(ctx) };
  const row = saveConnector(ctx.db, def, { vaultHandle: handle ?? before?.vaultHandle ?? null, owner, now: ctx.now() });
  return { connector: view(ctx, row) };
}

export async function connectorGet(ctx: AutoCtx, input: In): Promise<unknown> {
  const row = getConnector(ctx.db, String(input.app));
  if (!row) raise(ctx, "validation.not_found", "There is no connector with that name.", { reason: "no_connector" });
  if (isAuthor(ctx, row)) return { connector: view(ctx, row), definition: row.def };
  const shown = publishedPart(ctx.db, row.def);
  if (!shown) raise(ctx, "validation.not_found", "There is no connector with that name.", { reason: "no_connector" });
  return { connector: view(ctx, row, { def: shown }), definition: shown };
}

export async function connectorsList(ctx: AutoCtx): Promise<unknown> {
  const out: Record<string, unknown>[] = [];
  for (const row of listConnectors(ctx.db)) {
    if (isAuthor(ctx, row)) { out.push(view(ctx, row)); continue; }
    const shown = publishedPart(ctx.db, row.def);
    if (shown) out.push(view(ctx, row, { def: shown }));
  }
  return { connectors: out };
}

function usedBy(ctx: AutoCtx, app: string): string[] {
  const prefix = `${app}-`;
  return allAutomations(ctx.db).filter((a) => a.definition.nodes.some((n) => n.key.startsWith(prefix)) || a.definition.triggers.some((t) => t.key === "app_event" && (t.config as { app?: unknown } | undefined)?.app === app)).map((a) => a.name);
}

export async function connectorRemove(ctx: AutoCtx, input: In): Promise<unknown> {
  const row = getConnector(ctx.db, String(input.app));
  if (!row) raise(ctx, "validation.not_found", "There is no connector with that name.", { reason: "no_connector" });
  if (!canEdit(ctx, row)) raise(ctx, "permission.not_found", "That connector is not available.");
  const users = usedBy(ctx, row.def.app);
  if (users.length > 0) raise(ctx, "validation.precondition_failed", `${users.length === 1 ? users[0] : `${users.length} automations`} uses this connector. Change ${users.length === 1 ? "it" : "them"} first.`, { reason: "in_use", automations: users.slice(0, 10) });
  removeConnector(ctx.db, row, ctx.now());
  return { removed: true };
}

export async function connectorPublish(ctx: AutoCtx, input: In): Promise<unknown> {
  const row = getConnector(ctx.db, String(input.app));
  if (!row) raise(ctx, "validation.not_found", "There is no connector with that name.", { reason: "no_connector" });
  const keys = Object.keys(row.fingerprints);
  if (!keys.some((k) => proven(storedLevel(ctx.db, k)))) raise(ctx, "validation.precondition_failed", "Nothing is tested yet. Run a safe read first with automations.try_read.", { reason: "not_tested" });
  const moved = publishTested(ctx.db, row, me(ctx), ctx.now());
  const after = getConnector(ctx.db, row.def.app)!;
  return { connector: view(ctx, after), published: moved.length };
}

/** Allow the key in a Vault item to be sent to one host. An agent asks and a person approves at the Gate. */
export async function connectorTrustHost(ctx: AutoCtx, input: In): Promise<unknown> {
  const app = String(input.app);
  const row = getConnector(ctx.db, app);
  if (!row) raise(ctx, "validation.not_found", "There is no connector with that name.", { reason: "no_connector" });
  if (!isAuthor(ctx, row)) raise(ctx, "permission.not_found", "That connector is not available.");
  const host = String(input.host ?? "").toLowerCase();
  const all = [...row.def.domains];
  if (!all.includes(host)) raise(ctx, "validation.bad_input", "That host is not one of this connector's domains.", { domains: all });
  if (!row.vaultHandle) raise(ctx, "validation.precondition_failed", "This connector has no Vault item.", { reason: "no_vault_item" });
  trustHost(ctx.db, row.vaultHandle, host, me(ctx), ctx.now());
  return { app, host, allowed: true };
}

export { hostTrusted };

// ---- webhook triggers of a connector

function webhookTrigger(ctx: AutoCtx, app: string, key: string): ConnectorRow {
  const row = getConnector(ctx.db, app);
  if (!row) raise(ctx, "validation.not_found", "There is no connector with that name.", { reason: "no_connector" });
  if (!isAuthor(ctx, row)) raise(ctx, "permission.not_found", "That connector is not available.");
  const t = row.def.triggers.find((x) => x.key === key);
  if (!t || t.kind !== "webhook") raise(ctx, "validation.not_found", "That connector has no webhook trigger with that name.", { reason: "no_webhook" });
  return row;
}

export async function connectorHookGet(ctx: AutoCtx, input: In): Promise<unknown> {
  webhookTrigger(ctx, String(input.app), String(input.trigger));
  const app = String(input.app), key = String(input.trigger);
  let have = getHook(ctx.db, app, key);
  if (!have) { setHook(ctx.db, app, key, newSecret(), ctx.now()); have = getHook(ctx.db, app, key)!; }
  return { url: appHookUrl(ctx, app, key, have.secret), method: "POST", ...(have.lastDeliveryAt !== null ? { lastDeliveryAt: have.lastDeliveryAt } : {}) };
}

export async function connectorHookRotate(ctx: AutoCtx, input: In): Promise<unknown> {
  webhookTrigger(ctx, String(input.app), String(input.trigger));
  const app = String(input.app), key = String(input.trigger);
  setHook(ctx.db, app, key, newSecret(), ctx.now());
  const have = getHook(ctx.db, app, key)!;
  return { url: appHookUrl(ctx, app, key, have.secret), method: "POST" };
}

export { triggerLevelKey };
