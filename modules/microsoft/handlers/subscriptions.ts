// Change-notification subscriptions, the renewal Run, notification intake, and the tenant-level capabilities: consent setup, verify, members,
// exclusions, the access policy snippet and health (spec 2.18, ARCH 8 and 8.1). Kept together because they share the tenant-level Graph calls
// and the subscription table; the per-member Graph calls are in graph.ts.
//
// Graph subscriptions last about three days at most (4230 minutes for mail and calendar), so the renewal Run cannot wait three days: it runs
// every twelve hours and extends anything that would expire within a day. A notification only says that something changed; the mailbox pull
// reads the change from the delta query, so a missed notification costs a poll interval, not a message.
import { fail } from "../../../host/src/routes/errors.ts";
import {
  api, apiRaw, bad, CONFIG_ID, config, EMAIL, enc, ensure, first, forgetTokens, GRAPH, int, needHost, newId, normalizeEmail, num, obj, PERMISSIONS, refusal, resolveSubject, rowsOf,
  str, strOrNull, text, codeOf, userUrl,
} from "../projections.ts";
import type { MsCtx } from "../projections.ts";
import { ensureMailbox, pollInterval, pullMailbox } from "./graph.ts";
import type { Act } from "./graph.ts";
import { mintUuid } from "../../../lib/ids.ts";

const MINUTE = 60_000;
const MAIL_MAX_MINUTES = 4230;
const TEAMS_MAX_MINUTES = 60;
const RENEW_EVERY_MS = 12 * 60 * MINUTE;
const RENEW_WITHIN_MS = 24 * 60 * MINUTE;
const MARGIN_MS = 5 * MINUTE;
const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;
const TENANT = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
const GROUP_NAME = "VyreMappedMembers";

// ---- subscriptions

interface Made { subscriptionId: string; expiresAt: number }

function clientState(now: number): string {
  return `${mintUuid(now)}${mintUuid(now)}`.replaceAll("-", "");
}

function checkUrl(ctx: MsCtx, url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return bad(ctx, "The notification address is not an address."); }
  if (u.protocol !== "https:" || u.username || u.password) bad(ctx, "The notification address must be https with no sign-in in it.");
  return u.toString();
}

async function create(
  ctx: MsCtx, a: Act, cap: string, o: { kind: "mail" | "calendar" | "teams"; resource: string; mailbox: string | null; notificationUrl: string; changeType: string; maxMinutes: number },
): Promise<Made> {
  const notificationUrl = checkUrl(ctx, o.notificationUrl);
  const state = clientState(ctx.now());
  const expires = ctx.now() + o.maxMinutes * MINUTE - MARGIN_MS;
  const r = await api(ctx, {
    cap, connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}), tenant: o.mailbox === null, method: "POST", url: `${GRAPH}/subscriptions`,
    body: { changeType: o.changeType, notificationUrl, resource: o.resource, expirationDateTime: new Date(expires).toISOString(), clientState: state },
  });
  const id = text(r.id);
  if (!id) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Microsoft did not name the subscription." });
  const given = Date.parse(text(r.expirationDateTime) ?? "");
  const expiresAt = Number.isFinite(given) ? given : expires;
  ctx.db.run(
    `INSERT INTO microsoft_subscription (id, kind, resource, mailbox, "connectionId", "notificationUrl", "clientState", "expiresAt", "maxMinutes", "changeType") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, o.kind, o.resource, o.mailbox, a.connectionId, notificationUrl, state, expiresAt, o.maxMinutes, o.changeType,
  );
  return { subscriptionId: id, expiresAt };
}

const odataString = (ctx: MsCtx, s: string): string => {
  if (!/^[A-Za-z0-9_=+\-./]+$/.test(s)) bad(ctx, "The id has characters Microsoft does not allow in a resource.");
  return s;
};

export async function mailSubscribe(ctx: MsCtx, a: Act & { folderId: string; notificationUrl: string }) {
  ensure(ctx);
  const sub = resolveSubject(ctx, { connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}) });
  ensureMailbox(ctx, sub, a.connectionId);
  return create(ctx, a, "ms.mail.subscribe", {
    kind: "mail", resource: `users/${sub}/mailFolders('${odataString(ctx, a.folderId)}')/messages`, mailbox: sub, notificationUrl: a.notificationUrl, changeType: "created,updated", maxMinutes: MAIL_MAX_MINUTES,
  });
}

export async function calendarSubscribe(ctx: MsCtx, a: Act & { calendarId?: string; notificationUrl: string }) {
  ensure(ctx);
  const sub = resolveSubject(ctx, { connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}) });
  const resource = a.calendarId ? `users/${sub}/calendars/${odataString(ctx, a.calendarId)}/events` : `users/${sub}/events`;
  return create(ctx, a, "ms.calendar.subscribe", { kind: "calendar", resource, mailbox: sub, notificationUrl: a.notificationUrl, changeType: "created,updated,deleted", maxMinutes: MAIL_MAX_MINUTES });
}

export async function teamsSubscribe(ctx: MsCtx, a: Act & { resource: string; notificationUrl: string }) {
  ensure(ctx);
  const sub = resolveSubject(ctx, { connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}) });
  const ok = /^communications\/onlineMeetings\/[A-Za-z0-9_()',=.-]+$/.test(a.resource) || a.resource.startsWith(`users/${sub}/onlineMeetings/`);
  if (!ok || /\s|\.\./.test(a.resource)) bad(ctx, "That resource is not one the connector subscribes to.");
  return create(ctx, a, "ms.teams.recordings.subscribe", { kind: "teams", resource: a.resource, mailbox: null, notificationUrl: a.notificationUrl, changeType: "created", maxMinutes: TEAMS_MAX_MINUTES });
}

/** Remove a subscription. Only the member whose mailbox it watches, or an admin, may; a Microsoft 404 means it is already gone. */
export async function unsubscribe(ctx: MsCtx, a: Act & { subscriptionId: string }, cap: string) {
  ensure(ctx);
  const row = first(ctx.db.all(`SELECT * FROM microsoft_subscription WHERE id = ?`, a.subscriptionId));
  if (!row) throw fail("validation.not_found", ctx.trace.traceId, { message: "No such subscription." });
  const owner = strOrNull(row, "mailbox");
  const sub = resolveSubject(ctx, { connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}) });
  if ((owner === null || owner !== sub) && ctx.principal.kind !== "service" &&
    ctx.authorize({ perm: "connectors.manage", level: "manage" }, { type: "connection", id: a.connectionId }).effect !== "allow") {
    throw fail("permission.no_grant", ctx.trace.traceId, { message: "Only the member it watches or an admin can remove this subscription." });
  }
  const r = await apiRaw(ctx, { cap, connectionId: a.connectionId, tenant: true, method: "DELETE", url: `${GRAPH}/subscriptions/${enc(a.subscriptionId)}` });
  if (r.status >= 300 && r.status !== 404) throw refusal(ctx, r.status, r.json);
  ctx.db.run(`DELETE FROM microsoft_subscription WHERE id = ?`, a.subscriptionId);
  return { removed: true };
}

export const mailUnsubscribe = (ctx: MsCtx, a: Act & { subscriptionId: string }) => unsubscribe(ctx, a, "ms.mail.unsubscribe");
export const calendarUnsubscribe = (ctx: MsCtx, a: Act & { subscriptionId: string }) => unsubscribe(ctx, a, "ms.calendar.unsubscribe");

/** The renewal Run: extend every subscription that would expire within a day, recreate one Graph lost, queue the next Run. */
export async function renew(ctx: MsCtx): Promise<{ runId: string }> {
  ensure(ctx);
  const runId = ctx.run && /^run_[a-z0-9]+$/.test(ctx.run) ? ctx.run : newId("run", ctx.now());
  const cfg = config(ctx);
  const connectionId = strOrNull(cfg, "connectionId");
  const now = ctx.now();
  if (!cfg || num(cfg, "configured") !== 1 || !connectionId) return { runId };   // switched off: nothing to keep alive and nothing to queue

  for (const row of rowsOf(ctx.db.all(`SELECT * FROM microsoft_subscription ORDER BY "expiresAt" ASC`))) {
    const id = str(row, "id");
    const expiresAt = num(row, "expiresAt");
    if (expiresAt - now > Math.min(RENEW_WITHIN_MS, (num(row, "maxMinutes") * MINUTE) / 2)) continue;
    const next = now + num(row, "maxMinutes") * MINUTE - MARGIN_MS;
    try {
      const r = await apiRaw(ctx, {
        cap: "ms.subscriptions.renew", connectionId: str(row, "connectionId"), tenant: true, method: "PATCH", url: `${GRAPH}/subscriptions/${enc(id)}`,
        body: { expirationDateTime: new Date(next).toISOString() },
      });
      if (r.status < 300) {
        const given = Date.parse(text(r.json.expirationDateTime) ?? "");
        ctx.db.run(`UPDATE microsoft_subscription SET "expiresAt" = ? WHERE id = ?`, Number.isFinite(given) ? given : next, id);
      } else if (r.status === 404) {
        await recreate(ctx, row, next);
      } else {
        ctx.log.warn("microsoft renewal refused", { subscriptionId: id, status: r.status });
      }
    } catch (e) {
      ctx.log.warn("microsoft renewal failed", { subscriptionId: id, code: codeOf(e) });
    }
  }

  const due = num(cfg, "nextRenewAt");
  if (due <= now) {
    const at = now + RENEW_EVERY_MS;
    ctx.db.run(`UPDATE microsoft_config SET "nextRenewAt" = ? WHERE id = ?`, at, CONFIG_ID);
    await ctx.schedule(at, "ms.subscriptions.renew", {});
  }
  return { runId };
}

/** Graph forgot a subscription (it expired while the Run was down): make a new one for the same resource and drop the old row. */
async function recreate(ctx: MsCtx, row: Record<string, string | number | null>, expires: number): Promise<void> {
  const state = clientState(ctx.now());
  const r = await api(ctx, {
    cap: "ms.subscriptions.renew", connectionId: str(row, "connectionId"), tenant: true, method: "POST", url: `${GRAPH}/subscriptions`,
    body: { changeType: str(row, "changeType"), notificationUrl: str(row, "notificationUrl"), resource: str(row, "resource"), expirationDateTime: new Date(expires).toISOString(), clientState: state },
  });
  const id = text(r.id);
  if (!id) return;
  ctx.db.run(`DELETE FROM microsoft_subscription WHERE id = ?`, str(row, "id"));
  ctx.db.run(
    `INSERT INTO microsoft_subscription (id, kind, resource, mailbox, "connectionId", "notificationUrl", "clientState", "expiresAt", "maxMinutes", "changeType") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, str(row, "kind"), str(row, "resource"), strOrNull(row, "mailbox"), str(row, "connectionId"), str(row, "notificationUrl"), state, expires, num(row, "maxMinutes"), str(row, "changeType"),
  );
}

// ---- notification intake

export async function receiveNotification(
  ctx: MsCtx,
  input: { notificationId: string; subscriptionId: string; resource: string; changeType: "created" | "updated" | "deleted"; clientStateOk: boolean; tenantId?: string },
) {
  ensure(ctx);
  if (typeof input.notificationId !== "string" || input.notificationId.length === 0) bad(ctx, "A notification needs its id.");
  if (first(ctx.db.all(`SELECT "notificationId" FROM microsoft_notification_seen WHERE "notificationId" = ?`, input.notificationId))) return { accepted: false };
  ctx.db.run(`INSERT INTO microsoft_notification_seen ("notificationId", at) VALUES (?, ?)`, input.notificationId, ctx.now());
  // The hook layer compares clientState; a notification that failed it, or names no subscription of ours, is dropped. "manual" and "poll"
  // are this connector's own nudges (a manual sync, the queued poll) and carry no Graph subscription.
  const sub = first(ctx.db.all(`SELECT mailbox FROM microsoft_subscription WHERE id = ?`, input.subscriptionId));
  const own = input.subscriptionId === "manual" || input.subscriptionId === "poll";
  if (!input.clientStateOk || (!sub && !own)) return { accepted: false };
  const payload: Record<string, unknown> = {
    connector: "microsoft", notificationId: input.notificationId, subscriptionId: input.subscriptionId, resource: input.resource, changeType: input.changeType,
  };
  if (input.tenantId) payload.tenantId = input.tenantId;
  ctx.emit("microsoft.notification_received", "connector/microsoft", payload);
  const mailbox = strOrNull(sub, "mailbox") ?? mailboxOf(input.resource);
  if (mailbox && /(^|\/)(messages|mailFolders)/i.test(input.resource)) await pullAndSchedule(ctx, mailbox, input.notificationId);
  return { accepted: true };
}

/** `users/{address}/...` names the mailbox when the notice is our own; a Graph notice names it through its subscription. */
function mailboxOf(resource: string): string | null {
  const m = /^\/?users(?:\/|\(')([^/')]+)/i.exec(resource);
  const email = m ? normalizeEmail(decodeURIComponent(m[1]!)) : "";
  return EMAIL.test(email) ? email : null;
}

/** Pull one mailbox for a notice or a poll, then keep exactly one future poll queued for it. A failed pull never fails the notice. */
async function pullAndSchedule(ctx: MsCtx, email: string, cause: string): Promise<void> {
  const cfg = config(ctx);
  const connectionId = strOrNull(cfg, "connectionId");
  if (!cfg || num(cfg, "configured") !== 1 || !connectionId) return;
  const member = first(ctx.db.all(`SELECT mapped, excluded FROM microsoft_member WHERE email = ?`, email));
  if (!member || num(member, "mapped") !== 1 || num(member, "excluded") === 1) return;
  const now = ctx.now();
  let delay: number;
  try {
    const pull = await pullMailbox(ctx, { connectionId, mailbox: email });
    delay = pull.complete ? pull.nextPollMs : pollInterval(now, null, false);
    ctx.log.info("microsoft pull", { mailbox: email, ingested: pull.ingested, deduped: pull.deduped, skipped: pull.skipped, complete: pull.complete, cause });
  } catch (e) {
    ctx.log.warn("microsoft pull failed", { mailbox: email, code: codeOf(e), cause });
    delay = pollInterval(now, null, false);
  }
  const box = first(ctx.db.all(`SELECT "nextPollAt" FROM microsoft_mailbox WHERE email = ?`, email));
  const queued = box && typeof box.nextPollAt === "number" ? box.nextPollAt : 0;
  if (queued > now) return;   // a poll is already waiting; a notice or a manual sync does not start a second chain
  const at = now + delay;
  ensureMailbox(ctx, email, connectionId);
  ctx.db.run(`UPDATE microsoft_mailbox SET "nextPollAt" = ? WHERE email = ?`, at, email);
  await ctx.schedule(at, "ms.receive_notification", {
    notificationId: `poll:${email}:${at}`, subscriptionId: "poll", resource: `users/${email}/messages`, changeType: "updated", clientStateOk: true,
  });
}

// ---- consent (Console > Integrations)

export async function consentStatus(ctx: MsCtx) {
  ensure(ctx);
  const cfg = config(ctx);
  const members = rowsOf(ctx.db.all(`SELECT email, mapped, excluded FROM microsoft_member`));
  const out: {
    configured: boolean; tenantId?: string; consentGiven: boolean; policyConfirmed: boolean; lastVerifyAt?: number; autoConnect: boolean; mappedMembers: number; excluded: string[];
  } = {
    configured: num(cfg, "configured") === 1,
    consentGiven: num(cfg, "consentGiven") === 1,
    policyConfirmed: num(cfg, "policyConfirmed") === 1,
    autoConnect: cfg ? num(cfg, "autoConnect") === 1 : true,
    mappedMembers: members.filter((m) => num(m, "mapped") === 1 && num(m, "excluded") === 0).length,
    excluded: members.filter((m) => num(m, "excluded") === 1).map((m) => str(m, "email")).sort(),
  };
  if (strOrNull(cfg, "tenantId")) out.tenantId = str(cfg, "tenantId");
  if (typeof cfg?.lastVerifyAt === "number") out.lastVerifyAt = cfg.lastVerifyAt;
  return out;
}

export async function consentLink(ctx: MsCtx, input: { tenantId?: string }) {
  ensure(ctx);
  const cfg = config(ctx);
  const clientId = strOrNull(cfg, "clientId");
  if (!clientId) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "Store the app registration first; the consent link needs its client id." });
  const tenant = input.tenantId ?? strOrNull(cfg, "tenantId") ?? "organizations";
  if (!TENANT.test(tenant)) bad(ctx, "The tenant is not valid.");
  return { url: `https://login.microsoftonline.com/${tenant}/adminconsent?client_id=${encodeURIComponent(clientId)}`, permissions: [...PERMISSIONS] };
}

export async function consentSnippet(ctx: MsCtx) {
  ensure(ctx);
  const cfg = config(ctx);
  const clientId = strOrNull(cfg, "clientId") ?? "<application client id>";
  const mapped = rowsOf(ctx.db.all(`SELECT email FROM microsoft_member WHERE mapped = ? AND excluded = ?`, 1, 0)).map((r) => str(r, "email")).filter((e) => EMAIL.test(e) && !/['"`$]/.test(e)).sort();
  const domain = strOrNull(cfg, "domain") ?? "yourcompany.com";
  const group = `${GROUP_NAME.toLowerCase()}@${domain}`;
  const members = mapped.length ? mapped.map((e) => `"${e}"`).join(",") : `"first.member@${domain}"`;
  const snippet = [
    "# Run in Exchange Online PowerShell as a tenant administrator.",
    "# It limits Vyre's app to the mailboxes of the members mapped in Vyre; every other mailbox stays out of its reach.",
    `New-DistributionGroup -Name "${GROUP_NAME}" -Alias "${GROUP_NAME.toLowerCase()}" -Type Security -PrimarySmtpAddress "${group}" -Members ${members}`,
    `New-ApplicationAccessPolicy -AppId "${clientId}" -PolicyScopeGroupId "${group}" -AccessRight RestrictAccess -Description "Vyre: only the mapped members"`,
    `# Check one mapped member (should say Granted) and one who is not mapped (should say Denied):`,
    `Test-ApplicationAccessPolicy -AppId "${clientId}" -Identity ${mapped[0] ? `"${mapped[0]}"` : `"first.member@${domain}"`}`,
    `Test-ApplicationAccessPolicy -AppId "${clientId}" -Identity "someone.else@${domain}"`,
  ].join("\n");
  return { language: "powershell" as const, snippet, groupName: GROUP_NAME };
}

async function autoConnectPolicy(ctx: MsCtx): Promise<boolean> {
  try {
    const row = obj(obj(await ctx.call("settings.get", { key: "microsoft.auto_connect" })).row);
    return row.value === false ? false : true;
  } catch {
    return true;   // the policy defaults on
  }
}

export async function consentSetup(ctx: MsCtx, input: { vaultItem: string; tenantId: string; domain?: string; idempotencyKey: string }) {
  ensure(ctx);
  if (!HANDLE.test(input.vaultItem ?? "")) bad(ctx, "The Vault item is not a valid handle.");
  if (!TENANT.test(input.tenantId ?? "")) bad(ctx, "The tenant is not valid.");
  const domain = input.domain === undefined ? null : input.domain.trim().toLowerCase();
  if (domain !== null && (!domain || /\s|@/.test(domain))) bad(ctx, "The domain is not valid.");
  const host = needHost(ctx);
  const app = await host.appRegistration(ctx, input.vaultItem);
  if (app.tenantId && input.tenantId.toLowerCase() !== app.tenantId.toLowerCase() && !input.tenantId.includes(".")) bad(ctx, "That app registration belongs to another tenant.");

  const cfg = config(ctx);
  let connectionId = strOrNull(cfg, "connectionId");
  if (!connectionId) {
    const made = obj(obj(await ctx.call("connections.create", {
      connector: "microsoft", title: "Microsoft 365", ownerKind: "space", secrets: { Microsoft_App: input.vaultItem }, scopes: ["https://graph.microsoft.com/.default"],
      idempotencyKey: `${input.idempotencyKey}:connection`,
    })).connection);
    connectionId = text(made.connectionId) ?? null;
    if (!connectionId) throw fail("internal.unexpected", ctx.trace.traceId, { message: "The connection was not created." });
  }
  const now = ctx.now();
  const autoConnect = await autoConnectPolicy(ctx);
  forgetTokens();
  await host.mintToken(ctx, { connectionId });   // proves the client id and secret before anything is mapped; consent itself is checked by verify
  if (cfg) {
    ctx.db.run(
      `UPDATE microsoft_config SET "connectionId" = ?, "vaultItem" = ?, "tenantId" = ?, domain = ?, "clientId" = ?, configured = ?, "autoConnect" = ?, updated_at = ? WHERE id = ?`,
      connectionId, input.vaultItem, input.tenantId, domain, app.clientId, 1, autoConnect ? 1 : 0, now, CONFIG_ID,
    );
  } else {
    ctx.db.run(
      `INSERT INTO microsoft_config (id, "connectionId", "vaultItem", "tenantId", domain, "clientId", configured, "consentGiven", "policyConfirmed", "autoConnect", "lastVerifyAt", "nextRenewAt", updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      CONFIG_ID, connectionId, input.vaultItem, input.tenantId, domain, app.clientId, 1, 0, 0, autoConnect ? 1 : 0, null, null, now,
    );
  }

  const mapped: { userId: string; email: string }[] = [];
  for (const m of await host.memberEmails(ctx)) {
    const email = normalizeEmail(m.email);
    if (!EMAIL.test(email) || (domain !== null && !email.endsWith(`@${domain}`))) continue;
    const prior = first(ctx.db.all(`SELECT excluded FROM microsoft_member WHERE email = ?`, email));
    if (prior) ctx.db.run(`UPDATE microsoft_member SET "userId" = ?, mapped = ?, updated_at = ? WHERE email = ?`, m.userId, 1, now, email);
    else ctx.db.run(`INSERT INTO microsoft_member (email, "userId", mapped, excluded, "mailboxState", updated_at) VALUES (?, ?, ?, ?, ?, ?)`, email, m.userId, 1, 0, null, now);
    if (!prior || num(prior, "excluded") === 0) mapped.push({ userId: m.userId, email });
  }
  let connected = 0;
  if (autoConnect && mapped.length > 0) {
    const out = obj(await ctx.call("mail.auto_connect_members", { provider: "microsoft", members: mapped, idempotencyKey: `${input.idempotencyKey}:members` }));
    connected = int(out.created) ?? 0;
    for (const m of mapped) ctx.db.run(`UPDATE microsoft_member SET "mailboxState" = ? WHERE email = ?`, "pending", m.email);
  }
  ctx.emit("microsoft.consent_configured", "connector/microsoft", { connector: "microsoft", tenantId: input.tenantId, mappedMembers: mapped.length, autoConnect });
  // Subscriptions live about three days: queue the first renewal Run now.
  if (num(first(ctx.db.all(`SELECT "nextRenewAt" FROM microsoft_config WHERE id = ?`, CONFIG_ID)), "nextRenewAt") <= now) {
    const at = now + RENEW_EVERY_MS;
    ctx.db.run(`UPDATE microsoft_config SET "nextRenewAt" = ? WHERE id = ?`, at, CONFIG_ID);
    await ctx.schedule(at, "ms.subscriptions.renew", {});
  }
  return { configured: true, mappedMembers: mapped.length, connected };
}

/** The application permissions a token carries (its roles claim). The payload is read, not verified: Microsoft issued it to us a moment ago. */
export function rolesOf(token: string): string[] | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const roles = (JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { roles?: unknown }).roles;
    return Array.isArray(roles) ? roles.filter((r): r is string => typeof r === "string") : [];
  } catch {
    return null;
  }
}

export async function consentVerify(ctx: MsCtx, input: { as?: string; policyConfirmed?: boolean }) {
  ensure(ctx);
  const cfg = config(ctx);
  const connectionId = strOrNull(cfg, "connectionId");
  if (!cfg || !connectionId) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "Microsoft 365 is not set up." });
  const org = await apiRaw(ctx, { cap: "ms.consent.verify", connectionId, tenant: true, url: `${GRAPH}/organization`, query: { $select: "id" } });
  const token = org.token;
  const roles = rolesOf(token);
  const missing = roles === null ? [] : PERMISSIONS.filter((p) => !roles.includes(p));
  const details: string[] = [];
  const orgOk = org.status < 300;
  if (!orgOk) details.push("Microsoft refused the organization check. Open the consent link as a tenant admin.");
  if (roles === null) details.push("The token could not be read, so the permission list was not checked.");
  if (missing.length) details.push(`Grant admin consent for: ${missing.join(", ")}.`);

  const probe = input.as ? normalizeEmail(input.as) : strOrNull(first(ctx.db.all(`SELECT email FROM microsoft_member WHERE mapped = ? AND excluded = ?`, 1, 0)), "email");
  let probeOk = true;
  if (probe) {
    if (!EMAIL.test(probe)) bad(ctx, "The address is not an email.");
    const p = await apiRaw(ctx, { cap: "ms.consent.verify", connectionId, as: probe, open: true, url: userUrl(probe, "/mailFolders/inbox"), query: { $select: "id" } });
    probeOk = p.status < 300;
    if (!probeOk) details.push(`The app cannot reach ${probe}. Run the access policy snippet, then verify again.`);
  }
  const consentGiven = orgOk && missing.length === 0;
  const ok = consentGiven && probeOk;
  const policy = input.policyConfirmed === true || (probe !== null && probeOk);
  ctx.db.run(`UPDATE microsoft_config SET "consentGiven" = ?, "policyConfirmed" = ?, "lastVerifyAt" = ?, updated_at = ? WHERE id = ?`, consentGiven ? 1 : 0, policy ? 1 : 0, ctx.now(), ctx.now(), CONFIG_ID);
  ctx.emit("microsoft.consent_verified", "connector/microsoft", { connector: "microsoft", ok, missingPermissions: missing });
  const out: { ok: boolean; missingPermissions: string[]; detail?: string } = { ok, missingPermissions: missing };
  if (details.length) out.detail = details.join(" ");
  return out;
}

export async function consentMembers(ctx: MsCtx, input: { cursor?: string; limit?: number }) {
  ensure(ctx);
  const limit = input.limit ?? 100;
  const offset = input.cursor === undefined ? 0 : Number(input.cursor);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) bad(ctx, "Limit must be from 1 to 500.");
  if (!Number.isSafeInteger(offset) || offset < 0) bad(ctx, "Cursor is not valid.");
  const rows = rowsOf(ctx.db.all(`SELECT * FROM microsoft_member ORDER BY email ASC`));
  const page = rows.slice(offset, offset + limit).map((r) => {
    const m: { email: string; userId?: string; mapped: boolean; excluded: boolean; mailboxState?: string } = { email: str(r, "email"), mapped: num(r, "mapped") === 1, excluded: num(r, "excluded") === 1 };
    if (strOrNull(r, "userId")) m.userId = str(r, "userId");
    if (strOrNull(r, "mailboxState")) m.mailboxState = str(r, "mailboxState");
    return m;
  });
  const out: { members: typeof page; next?: string; total: number } = { members: page, total: rows.length };
  if (offset + limit < rows.length) out.next = String(offset + limit);
  return out;
}

export async function consentExclude(ctx: MsCtx, input: { email: string; excluded: boolean }) {
  ensure(ctx);
  const email = normalizeEmail(input.email ?? "");
  if (!EMAIL.test(email)) bad(ctx, "The address is not an email.");
  if (typeof input.excluded !== "boolean") bad(ctx, "Excluded must be true or false.");
  const now = ctx.now();
  if (first(ctx.db.all(`SELECT email FROM microsoft_member WHERE email = ?`, email))) {
    ctx.db.run(`UPDATE microsoft_member SET excluded = ?, updated_at = ? WHERE email = ?`, input.excluded ? 1 : 0, now, email);
  } else {
    ctx.db.run(`INSERT INTO microsoft_member (email, "userId", mapped, excluded, "mailboxState", updated_at) VALUES (?, ?, ?, ?, ?, ?)`, email, null, 0, input.excluded ? 1 : 0, null, now);
  }
  return { excluded: rowsOf(ctx.db.all(`SELECT email FROM microsoft_member WHERE excluded = ?`, 1)).map((r) => str(r, "email")).sort() };
}

export async function consentDisable(ctx: MsCtx) {
  ensure(ctx);
  ctx.db.run(`UPDATE microsoft_config SET configured = ?, updated_at = ? WHERE id = ?`, 0, ctx.now(), CONFIG_ID);
  ctx.db.run(`UPDATE microsoft_member SET "mailboxState" = ?, updated_at = ? WHERE mapped = ?`, "paused", ctx.now(), 1);
  ctx.db.run(`UPDATE microsoft_mailbox SET "nextPollAt" = ? WHERE "nextPollAt" IS NOT NULL`, null);
  forgetTokens();
  ctx.emit("microsoft.consent_revoked", "connector/microsoft", { connector: "microsoft", by: ctx.principal.id });
  return { disabled: true };
}

export async function health(ctx: MsCtx) {
  ensure(ctx);
  const cfg = config(ctx);
  const connectionId = strOrNull(cfg, "connectionId");
  if (!cfg || num(cfg, "configured") !== 1 || !connectionId) return { state: "down" as const, detail: "Microsoft 365 is not set up." };
  const started = ctx.now();
  try {
    const r = await apiRaw(ctx, { cap: "ms.health", connectionId, tenant: true, url: `${GRAPH}/organization`, query: { $select: "id" } });
    const latencyMs = Math.max(0, ctx.now() - started);
    if (r.status < 300) return { state: "healthy" as const, latencyMs };
    if (r.status === 429 || r.status >= 500) return { state: "degraded" as const, detail: `Microsoft answered ${r.status}.`, latencyMs };
    return { state: "down" as const, detail: "Microsoft refused the app sign-in. Check the consent and the app permissions.", latencyMs };
  } catch (e) {
    if (codeOf(e) === "provider.auth_failed") return { state: "down" as const, detail: "Microsoft refused the app sign-in. Check the consent and the app permissions." };
    if (codeOf(e) === "provider.network" || codeOf(e) === "provider.unavailable") return { state: "degraded" as const, detail: "Microsoft could not be reached." };
    throw e;
  }
}


