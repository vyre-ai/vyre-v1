// Change-notification subscriptions, the renewal Run, notification intake, and the tenant-level capabilities: consent setup, verify, members,
// exclusions, the access policy snippet and health (spec 2.18, ARCH 8 and 8.1). Kept together because they share the tenant-level Graph calls
// and the subscription table; the per-member Graph calls are in graph.ts.
//
// Graph subscriptions last about three days at most (4230 minutes for mail and calendar), so the renewal Run cannot wait three days: it runs
// every twelve hours and extends anything that would expire within a day. A notification only says that something changed; the mailbox pull
// reads the change from the delta query, so a missed notification costs a poll interval, not a message.
import { isTrustedService } from "../../../lib/trust.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import {
  api, apiRaw, bad, CONFIG_ID, config, dataOf, EMAIL, enc, ensure, first, forgetTokens, GRAPH, int, needHost, newId, normalizeEmail, num, obj, permissionsFor, refusal, resolveSubject, rolesFor, rowsOf, UNSCOPED,
  str, strOrNull, text, codeOf, userAccountByEmail, userUrl,
} from "../projections.ts";
import type { DataChoice, MsCtx } from "../projections.ts";
import { ensureMailbox, pollInterval, pullMailbox } from "./graph.ts";
import { userSigninLost } from "./personal.ts";
import { pullTeams } from "./teams.ts";
import { connectCalendar, syncCalendar } from "./calendar.ts";
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
  ctx: MsCtx, a: Act, cap: string, o: { kind: "mail" | "calendar" | "teams" | "drive"; resource: string; mailbox: string | null; notificationUrl: string; changeType: string; maxMinutes: number },
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

/** Watch a drive (`driveId`) or the member's own OneDrive: Graph says "something changed" and a mount pass reads the delta. */
export async function driveSubscribe(ctx: MsCtx, a: Act & { driveId?: string; notificationUrl: string }) {
  ensure(ctx);
  const sub = resolveSubject(ctx, { connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}) });
  // a SharePoint drive id looks like b!AbC-d_E: base64url after a bang
  if (a.driveId !== undefined && !/^[A-Za-z0-9!_=+.-]+$/.test(a.driveId)) bad(ctx, "The id has characters Microsoft does not allow in a resource.");
  const resource = a.driveId ? `drives/${a.driveId}/root` : `users/${sub}/drive/root`;
  return create(ctx, a, "ms.drive.subscribe", { kind: "drive", resource, mailbox: sub, notificationUrl: a.notificationUrl, changeType: "updated", maxMinutes: MAIL_MAX_MINUTES });
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
  // a subscription is the tenant's, not a mailbox's content: removing one reaches no one, so an admin may, without acting as the person it watches
  const person = isTrustedService(ctx.principal) ? null : (ctx.actingFor ?? ctx.principal.id);
  const sub = person ? strOrNull(first(ctx.db.all(`SELECT email FROM microsoft_member WHERE "userId" = ? AND mapped = ?`, person, 1)), "email") : null;
  if ((owner === null || owner !== sub) && !isTrustedService(ctx.principal) &&
    ctx.authorize({ perm: "connectors.manage", level: "manage" }, { type: "connection", id: a.connectionId }).effect !== "allow") {
    throw fail("permission.no_grant", ctx.trace.traceId, { message: "Only the member it watches or an admin can remove this subscription." });
  }
  const r = await apiRaw(ctx, { cap, connectionId: a.connectionId, tenant: true, method: "DELETE", url: `${GRAPH}/subscriptions/${enc(a.subscriptionId)}` });
  if (r.status >= 300 && r.status !== 404) throw refusal(ctx, r.status, r.json);
  ctx.db.run(`DELETE FROM microsoft_subscription WHERE id = ?`, a.subscriptionId);
  return { removed: true };
}

async function dropSubscription(ctx: MsCtx, connectionId: string, id: string): Promise<void> {
  try { await apiRaw(ctx, { cap: "ms.subscriptions.renew", connectionId, tenant: true, method: "DELETE", url: `${GRAPH}/subscriptions/${enc(id)}` }); }
  catch (e) { ctx.log.warn("microsoft subscription was not removed", { code: codeOf(e) }); }
  ctx.db.run(`DELETE FROM microsoft_subscription WHERE id = ?`, id);
}

export const mailUnsubscribe = (ctx: MsCtx, a: Act & { subscriptionId: string }) => unsubscribe(ctx, a, "ms.mail.unsubscribe");
export const driveUnsubscribe = (ctx: MsCtx, a: Act & { subscriptionId: string }) => unsubscribe(ctx, a, "ms.drive.unsubscribe");
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
    // a watch on someone excluded or gone is not renewed: it is taken down
    const watched = strOrNull(row, "mailbox");
    const member = watched ? first(ctx.db.all(`SELECT mapped, excluded FROM microsoft_member WHERE email = ?`, watched)) : null;
    if (member && (num(member, "excluded") === 1 || num(member, "mapped") !== 1)) { await dropSubscription(ctx, str(row, "connectionId"), id); continue; }
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
  if (str(row, "kind") === "drive") await ctx.call("mounts.nudge", { source: "microsoft", subscriptionId: str(row, "id"), replacedBy: id }).catch(() => undefined);
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
  const sub = first(ctx.db.all(`SELECT mailbox, kind FROM microsoft_subscription WHERE id = ?`, input.subscriptionId));
  const own = input.subscriptionId === "manual" || input.subscriptionId === "poll";
  if (!input.clientStateOk || (!sub && !own)) return { accepted: false };
  const payload: Record<string, unknown> = {
    connector: "microsoft", notificationId: input.notificationId, subscriptionId: input.subscriptionId, resource: input.resource, changeType: input.changeType,
  };
  if (input.tenantId) payload.tenantId = input.tenantId;
  ctx.emit("microsoft.notification_received", "connector/microsoft", payload);
  const mailbox = strOrNull(sub, "mailbox") ?? mailboxOf(input.resource);
  if (mailbox && /(^|\/)(messages|mailFolders)/i.test(input.resource)) await pullAndSchedule(ctx, mailbox, input.notificationId);
  // a drive notice wakes the mounts that hold this subscription
  if (strOrNull(sub, "kind") === "drive") await ctx.call("mounts.nudge", { source: "microsoft", subscriptionId: input.subscriptionId }).catch((e: unknown) => ctx.log.warn("microsoft drive nudge failed", { code: codeOf(e) }));
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
  const tenantId = strOrNull(cfg, "connectionId");
  const member = first(ctx.db.all(`SELECT mapped, excluded FROM microsoft_member WHERE email = ?`, email));
  const delegated = !!cfg && num(cfg, "configured") === 1 && !!tenantId && !!member && num(member, "mapped") === 1 && num(member, "excluded") !== 1;
  // an address the tenant's consent covers is read through it; any other is a person's own sign-in (ms.user.*), if there is one
  const own = delegated ? null : userAccountByEmail(ctx, email);
  const connectionId = delegated ? tenantId! : own?.accountId;
  if (!connectionId) return;
  const now = ctx.now();
  if (delegated && !pullsItself(ctx, email)) {
    // a poll a person queued for someone else's mailbox: the host takes the chain over, unless a newer poll is already waiting
    if (!(num(first(ctx.db.all(`SELECT "nextPollAt" FROM microsoft_mailbox WHERE email = ?`, email)), "nextPollAt") > now)) ctx.db.run(`UPDATE microsoft_mailbox SET "nextPollAt" = ? WHERE email = ?`, HANDED_OFF, email);
    return;
  }
  let delay: number;
  try {
    const pull = await pullMailbox(ctx, { connectionId, mailbox: email });
    delay = pull.complete ? pull.nextPollMs : pollInterval(now, null, false);
    ctx.log.info("microsoft pull", { mailbox: email, ingested: pull.ingested, deduped: pull.deduped, skipped: pull.skipped, complete: pull.complete, cause });
  } catch (e) {
    ctx.log.warn("microsoft pull failed", { mailbox: email, code: codeOf(e), cause });
    // a person's own sign-in that the provider no longer accepts: say so once and stop polling (signing in again starts the chain)
    if (own && !delegated && codeOf(e) === "provider.auth_failed") {
      await userSigninLost(ctx, own);
      ctx.db.run(`UPDATE microsoft_mailbox SET "nextPollAt" = ? WHERE email = ?`, null, email);
      return;
    }
    delay = pollInterval(now, null, false);
  }
  // Teams transcripts ride on the same pass; a Teams failure never fails the mailbox pull. A person's own sign-in carries mail only.
  if (delegated) {
    await syncCalendar(ctx, { connectionId, email });
    await pullTeams(ctx, { connectionId, mailbox: email }).catch((e: unknown) => ctx.log.warn("microsoft teams pull failed", { mailbox: email, code: codeOf(e) }));
  }
  const box = first(ctx.db.all(`SELECT "nextPollAt" FROM microsoft_mailbox WHERE email = ?`, email));
  const queued = box && typeof box.nextPollAt === "number" ? box.nextPollAt : 0;
  if (queued > now) return;   // a poll is already waiting; a notice or a manual sync does not start a second chain
  const at = now + delay;
  ensureMailbox(ctx, email, connectionId);
  ctx.db.run(`UPDATE microsoft_mailbox SET "nextPollAt" = ? WHERE email = ?`, at, email);
  await ctx.schedule(at, "ms.receive_notification", pollInput(email, `poll:${email}:${at}`));
}

// ---- consent (Console > Integrations)

export async function consentStatus(ctx: MsCtx) {
  ensure(ctx);
  const cfg = config(ctx);
  const members = rowsOf(ctx.db.all(`SELECT email, mapped, excluded FROM microsoft_member`));
  const out: {
    configured: boolean; tenantId?: string; consentGiven: boolean; policyConfirmed: boolean; lastVerifyAt?: number; autoConnect: boolean; mappedMembers: number; excluded: string[]; data: DataChoice; appStored: boolean; clientId?: string; permissions: string[]; exchangeRoles: string[];
  } = {
    configured: num(cfg, "configured") === 1,
    data: dataOf(cfg),
    appStored: !!strOrNull(cfg, "vaultItem"),
    permissions: permissionsFor(dataOf(cfg)),
    exchangeRoles: rolesFor(dataOf(cfg)),
    consentGiven: num(cfg, "consentGiven") === 1,
    policyConfirmed: num(cfg, "policyConfirmed") === 1,
    autoConnect: cfg ? num(cfg, "autoConnect") === 1 : true,
    mappedMembers: members.filter((m) => num(m, "mapped") === 1 && num(m, "excluded") === 0).length,
    excluded: members.filter((m) => num(m, "excluded") === 1).map((m) => str(m, "email")).sort(),
  };
  if (strOrNull(cfg, "tenantId")) out.tenantId = str(cfg, "tenantId");
  if (typeof cfg?.lastVerifyAt === "number") out.lastVerifyAt = cfg.lastVerifyAt;
  if (strOrNull(cfg, "clientId")) out.clientId = str(cfg, "clientId");
  return out;
}

export async function consentCheckApp(ctx: MsCtx, input: { vaultItem: string }) {
  ensure(ctx);
  return needHost(ctx).checkApp(ctx, input.vaultItem);
}

export async function consentLink(ctx: MsCtx, input: { tenantId?: string }) {
  ensure(ctx);
  const cfg = config(ctx);
  const clientId = strOrNull(cfg, "clientId");
  if (!clientId) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "Store the app registration first; the consent link needs its client id." });
  const tenant = input.tenantId ?? strOrNull(cfg, "tenantId") ?? "organizations";
  if (!TENANT.test(tenant)) bad(ctx, "The tenant is not valid.");
  return { url: `https://login.microsoftonline.com/${tenant}/adminconsent?client_id=${encodeURIComponent(clientId)}`, permissions: permissionsFor(dataOf(cfg)) };
}

export async function consentSnippet(ctx: MsCtx) {
  ensure(ctx);
  const cfg = config(ctx);
  const clientId = strOrNull(cfg, "clientId") ?? "<application client id>";
  const mapped = rowsOf(ctx.db.all(`SELECT email FROM microsoft_member WHERE mapped = ? AND excluded = ?`, 1, 0)).map((r) => str(r, "email")).filter((e) => EMAIL.test(e) && !/['"`$]/.test(e)).sort();
  const domain = strOrNull(cfg, "domain") ?? "yourcompany.com";
  const group = `${GROUP_NAME.toLowerCase()}@${domain}`;
  const members = mapped.length ? mapped.map((e) => `"${e}"`).join(",") : `"first.member@${domain}"`;
  const objectId = strOrNull(cfg, "servicePrincipalId") ?? "<Object ID from Entra, Enterprise applications>";
  const data = dataOf(cfg);
  const one = mapped[0] ? `"${mapped[0]}"` : `"first.member@${domain}"`;
  const snippet = [
    ...(data.mail || data.calendar ? [
      "# Run in Exchange Online PowerShell as an Exchange administrator: Connect-ExchangeOnline -Device",
      "# It limits Vyre's app to the mailboxes of the included members; every other mailbox stays out of its reach, at Microsoft.",
      `New-DistributionGroup -Name "${GROUP_NAME}" -Alias "${GROUP_NAME.toLowerCase()}" -Type Security -PrimarySmtpAddress "${group}" -Members ${members}`,
      `New-ServicePrincipal -AppId "${clientId}" -ObjectId "${objectId}" -DisplayName "Vyre"`,
      `$group = (Get-DistributionGroup "${GROUP_NAME}").DistinguishedName`,
      `New-ManagementScope -Name "${GROUP_NAME}" -RecipientRestrictionFilter "MemberOfGroup -eq '$group'"`,
      ...rolesFor(data).map((role) => `New-ManagementRoleAssignment -App "${clientId}" -Role "${role}" -CustomResourceScope "${GROUP_NAME}"`),
      "# Check one included member (InScope should say True) and one who is not (False):",
      `Test-ServicePrincipalAuthorization -Identity "${clientId}" -Resource ${one}`,
      `Test-ServicePrincipalAuthorization -Identity "${clientId}" -Resource "someone.else@${domain}"`,
      "# Microsoft takes 30 minutes to 2 hours to apply this to a running app. The test above shows the result at once.",
    ] : []),
    ...(data.calendar ? [
      "",
      "# Run in Microsoft Teams PowerShell (Install-Module MicrosoftTeams; Connect-MicrosoftTeams) as a tenant administrator.",
      "# Teams transcripts need their own policy, granted to each included member one by one, so a meeting organized by anyone else stays out of reach.",
      `New-CsApplicationAccessPolicy -Identity "${GROUP_NAME}" -AppIds "${clientId}" -Description "Vyre: transcripts of the included members' meetings"`,
      ...(mapped.length ? mapped : [`first.member@${domain}`]).map((e) => `Grant-CsApplicationAccessPolicy -PolicyName "${GROUP_NAME}" -Identity "${e}"`),
    ] : []),
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

/** Everyone included comes in, now that a person chose who that is. Repeating it adds nobody twice. */
export async function consentConnectAll(ctx: MsCtx, input: { idempotencyKey: string }) {
  ensure(ctx);
  const cfg = config(ctx);
  const connectionId = strOrNull(cfg, "connectionId");
  if (!cfg || num(cfg, "configured") !== 1 || !connectionId) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "Microsoft 365 is not set up." });
  const people = rowsOf(ctx.db.all(`SELECT email, "userId" FROM microsoft_member WHERE mapped = ? AND excluded = ? AND "userId" IS NOT NULL ORDER BY email ASC`, 1, 0));
  let connected = 0;
  for (const [i, m] of people.entries()) {
    if (await connectMember(ctx, { connectionId, userId: str(m, "userId"), email: str(m, "email"), key: `${input.idempotencyKey}:${str(m, "email")}`, wait: i })) connected += 1;
  }
  return { connected, included: people.length };
}

export async function consentSetup(ctx: MsCtx, input: { vaultItem: string; tenantId: string; domain?: string; data?: DataChoice; hold?: boolean; idempotencyKey: string }) {
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
  // The host finds the Vault handle of a connection in this row, so it is written before the token is asked for; it stays as configured as it was until the credentials are proved.
  const wasConfigured = cfg ? num(cfg, "configured") : 0;
  if (cfg) {
    ctx.db.run(
      `UPDATE microsoft_config SET "connectionId" = ?, "vaultItem" = ?, "tenantId" = ?, domain = ?, "clientId" = ?, configured = ?, "autoConnect" = ?, updated_at = ? WHERE id = ?`,
      connectionId, input.vaultItem, input.tenantId, domain, app.clientId, wasConfigured, autoConnect ? 1 : 0, now, CONFIG_ID,
    );
  } else {
    ctx.db.run(
      `INSERT INTO microsoft_config (id, "connectionId", "vaultItem", "tenantId", domain, "clientId", configured, "consentGiven", "policyConfirmed", "autoConnect", "lastVerifyAt", "nextRenewAt", updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      CONFIG_ID, connectionId, input.vaultItem, input.tenantId, domain, app.clientId, 0, 0, 0, autoConnect ? 1 : 0, null, null, now,
    );
  }
  const data = input.data ?? dataOf(cfg);
  ctx.db.run(`UPDATE microsoft_config SET "dataMail" = ?, "dataCalendar" = ?, "dataFiles" = ? WHERE id = ?`, data.mail ? 1 : 0, data.calendar ? 1 : 0, data.files ? 1 : 0, CONFIG_ID);
  try {
    await host.mintToken(ctx, { connectionId });   // proves the client id and secret before anything is mapped; consent itself is checked by verify
  } catch (e) {
    // a registration Microsoft will not sign in with configures nothing: the row goes back to what it was (or away, when there was none)
    if (!cfg) ctx.db.run(`DELETE FROM microsoft_config WHERE id = ?`, CONFIG_ID);
    else {
      ctx.db.run(
        `UPDATE microsoft_config SET "vaultItem" = ?, "tenantId" = ?, domain = ?, "clientId" = ?, "autoConnect" = ?, updated_at = ? WHERE id = ?`,
        strOrNull(cfg, "vaultItem"), strOrNull(cfg, "tenantId"), strOrNull(cfg, "domain"), strOrNull(cfg, "clientId"), num(cfg, "autoConnect"), num(cfg, "updated_at"), CONFIG_ID,
      );
    }
    forgetTokens();
    throw e;
  }
  ctx.db.run(`UPDATE microsoft_config SET configured = ?, updated_at = ? WHERE id = ?`, 1, now, CONFIG_ID);

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
  if (autoConnect && mapped.length > 0 && input.hold !== true) {
    if (data.mail) {
      const out = obj(await ctx.call("mail.auto_connect_members", { provider: "microsoft", members: mapped, idempotencyKey: `${input.idempotencyKey}:members` }));
      connected = int(out.created) ?? 0;
      for (const [i, m] of mapped.entries()) {
        ctx.db.run(`UPDATE microsoft_member SET "mailboxState" = ? WHERE email = ?`, "pending", m.email);
        await queueFirstPull(ctx, connectionId, m.email, i);
      }
    }
    if (data.calendar) for (const m of mapped) await connectCalendar(ctx, { connectionId, userId: m.userId, email: m.email });   // their calendars come in with their mail
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

/** A queued call runs as whoever queued it, and only the host reads a mailbox for a named member (subjectFor). So a pull a person queued for someone else's mailbox (the admin pressing Connect) is left due, with no job: the host takes it over within a minute (adoptPolls). */
const ADOPT_AFTER = 2 * 60_000;
const HANDED_OFF = 0;

/** Whether this caller can run the pull of this mailbox itself: the host, or the mailbox's own person (a member's own Sync now). */
function pullsItself(ctx: MsCtx, email: string): boolean {
  if (isTrustedService(ctx.principal)) return true;
  const own = strOrNull(first(ctx.db.all(`SELECT email FROM microsoft_member WHERE "userId" = ? AND mapped = ?`, ctx.actingFor ?? ctx.principal.id, 1)), "email");
  return own === email;
}

const pollInput = (email: string, id: string) => ({ notificationId: id, subscriptionId: "poll", resource: `users/${email}/messages`, changeType: "updated" as const, clientStateOk: true });

/** Nothing else starts a member's mail: a notification needs a subscription, and a poll needs a pass before it. People are spaced out so a big company does not arrive at Microsoft at once. */
async function queueFirstPull(ctx: MsCtx, connectionId: string, email: string, wait: number): Promise<void> {
  const at = ctx.now() + 1000 + wait * 2000;
  ensureMailbox(ctx, email, connectionId);
  if (num(first(ctx.db.all(`SELECT "nextPollAt" FROM microsoft_mailbox WHERE email = ?`, email)), "nextPollAt") > ctx.now()) return;   // one chain per mailbox
  if (!pullsItself(ctx, email)) { ctx.db.run(`UPDATE microsoft_mailbox SET "nextPollAt" = ? WHERE email = ?`, HANDED_OFF, email); return; }
  ctx.db.run(`UPDATE microsoft_mailbox SET "nextPollAt" = ? WHERE email = ?`, at, email);
  await ctx.schedule(at, "ms.receive_notification", pollInput(email, `first:${email}:${at}`));
}

/**
 * Runs as the host every minute: every included member's mailbox whose poll is due and that no queued job will pull (handed off by a person, or a chain that died) gets a pull queued as the host, spaced out.
 * A chain the host runs moves its own time forward on every pass, so it is never taken over twice.
 */
export async function adoptPolls(ctx: MsCtx): Promise<{ adopted: number }> {
  ensure(ctx);
  const cfg = config(ctx);
  if (!cfg || num(cfg, "configured") !== 1 || !strOrNull(cfg, "connectionId") || !isTrustedService(ctx.principal)) return { adopted: 0 };
  const now = ctx.now();
  const included = new Set(rowsOf(ctx.db.all(`SELECT email FROM microsoft_member WHERE mapped = ? AND excluded = ?`, 1, 0)).map((r) => str(r, "email")));
  const due = rowsOf(ctx.db.all(`SELECT email, "nextPollAt" FROM microsoft_mailbox ORDER BY email ASC`))
    .filter((r) => typeof r.nextPollAt === "number" && r.nextPollAt <= now - ADOPT_AFTER && included.has(str(r, "email")));
  for (const [i, r] of due.entries()) {
    const email = str(r, "email"), at = now + 1000 + i * 2000;
    ctx.db.run(`UPDATE microsoft_mailbox SET "nextPollAt" = ? WHERE email = ?`, at, email);
    await ctx.schedule(at, "ms.receive_notification", pollInput(email, `adopt:${email}:${at}`));
  }
  return { adopted: due.length };
}

/** One person comes in: their mailbox, their calendar and the first pull, for what the company chose. Their Files come in the first time they open Files, as themselves (mounts.company_drive). */
async function connectMember(ctx: MsCtx, a: { connectionId: string; userId: string; email: string; key: string; wait: number }): Promise<boolean> {
  const d = dataOf(config(ctx));
  let connected = false;
  if (d.mail) {
    const out = obj(await ctx.call("mail.auto_connect_members", { provider: "microsoft", members: [{ userId: a.userId, email: a.email }], idempotencyKey: a.key }));
    connected = (int(out.created) ?? 0) > 0 || (int(out.skipped) ?? 0) > 0;
    ctx.db.run(`UPDATE microsoft_member SET "mailboxState" = ? WHERE email = ?`, "pending", a.email);
    await queueFirstPull(ctx, a.connectionId, a.email, a.wait);
  }
  if (d.calendar) await connectCalendar(ctx, { connectionId: a.connectionId, userId: a.userId, email: a.email });
  return connected;
}

/** A person stops: excluded, gone from the directory, or removed from the Space. What is already in Vyre stays theirs; nothing new comes in. Each stop is best effort, because the exclusion row is what every call checks. */
export async function stopMember(ctx: MsCtx, a: { email: string; userId: string | null; connectionId: string | null }): Promise<void> {
  ctx.db.run(`UPDATE microsoft_mailbox SET "nextPollAt" = ? WHERE email = ?`, null, a.email);
  ctx.db.run(`UPDATE microsoft_member SET "mailboxState" = ?, updated_at = ? WHERE email = ?`, "paused", ctx.now(), a.email);
  forgetTokens();
  if (a.connectionId) for (const row of rowsOf(ctx.db.all(`SELECT id FROM microsoft_subscription WHERE mailbox = ?`, a.email))) await dropSubscription(ctx, a.connectionId, str(row, "id"));
  await ctx.call("mail.member_pause", { provider: "microsoft", address: a.email, paused: true }).catch((e: unknown) => ctx.log.warn("microsoft member mailbox was not paused", { code: codeOf(e) }));
  await ctx.call("mounts.account_pause", { account: a.email, paused: true }).catch((e: unknown) => ctx.log.warn("microsoft member mounts were not paused", { code: codeOf(e) }));
  if (a.connectionId && a.userId) await connectCalendar(ctx, { connectionId: a.connectionId, userId: a.userId, email: a.email, connected: false });
}

/** The application permissions a token carries (its roles claim). The payload is read, not verified: Microsoft issued it to us a moment ago. */
/** The app's object id in the tenant, from the oid claim of its own token. */
export function objectIdOf(token: string): string | null {
  try { const oid = (JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { oid?: unknown }).oid; return typeof oid === "string" && /^[0-9a-f-]{36}$/i.test(oid) ? oid : null; } catch { return null; }
}

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
  forgetTokens();   // the permissions a token carries are fixed when it is issued: asking again is how a consent given a minute ago shows up
  const org = await apiRaw(ctx, { cap: "ms.consent.verify", connectionId, tenant: true, url: `${GRAPH}/organization`, query: { $select: "id" } });
  const token = org.token;
  const roles = rolesOf(token);
  const data = dataOf(cfg);
  const missing = roles === null ? [] : permissionsFor(data).filter((p) => !roles.includes(p));
  const unscoped = roles === null ? [] : UNSCOPED.filter((p) => roles.includes(p));
  const objectId = objectIdOf(token);
  const details: string[] = [];
  const orgOk = org.status < 300;
  if (!orgOk) details.push("Microsoft refused the organization check. Open the consent link as a tenant admin.");
  if (roles === null) details.push("The token could not be read, so the permission list was not checked.");
  if (missing.length) details.push(`Grant admin consent for: ${missing.join(", ")}.`);
  if (unscoped.length) details.push(`Remove ${unscoped.join(", ")} from the app in Entra. Consented there, it reaches every mailbox and the Exchange limit does nothing.`);

  // the mailbox folder list says yes or no and reads nothing; the caller's own mailbox when they have one
  const person = ctx.actingFor ?? ctx.principal.id;
  const included = rowsOf(ctx.db.all(`SELECT email, "userId" FROM microsoft_member WHERE mapped = ? AND excluded = ?`, 1, 0));
  const probe = !data.mail && !data.calendar ? null : input.as ? normalizeEmail(input.as) : strOrNull(included.find((m) => strOrNull(m, "userId") === person) ?? included[0] ?? null, "email");
  let probeOk = true;
  if (probe) {
    if (!EMAIL.test(probe)) bad(ctx, "The address is not an email.");
    if (!included.some((m) => str(m, "email") === probe)) throw fail("permission.no_grant", ctx.trace.traceId, { message: "That address is not an included member." });
    const p = await apiRaw(ctx, { cap: "ms.consent.verify", connectionId, as: probe, open: true, url: userUrl(probe, "/mailFolders/inbox"), query: { $select: "id" } });
    probeOk = p.status < 300;
    if (!probeOk) details.push(`The app cannot reach ${probe}. Run the Exchange snippet, then verify again. Microsoft can take up to 2 hours to apply it.`);
  }
  if (objectId) ctx.db.run(`UPDATE microsoft_config SET "servicePrincipalId" = ? WHERE id = ?`, objectId, CONFIG_ID);
  const consentGiven = orgOk && missing.length === 0;
  const ok = consentGiven && probeOk;
  const policy = input.policyConfirmed === true || (probe !== null && probeOk);
  ctx.db.run(`UPDATE microsoft_config SET "consentGiven" = ?, "policyConfirmed" = ?, "lastVerifyAt" = ?, updated_at = ? WHERE id = ?`, consentGiven ? 1 : 0, policy ? 1 : 0, ctx.now(), ctx.now(), CONFIG_ID);
  ctx.emit("microsoft.consent_verified", "connector/microsoft", { connector: "microsoft", ok, missingPermissions: missing });
  const out: { ok: boolean; missingPermissions: string[]; unscoped: string[]; detail?: string } = { ok, missingPermissions: missing, unscoped };
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
  // An excluded member stops at once; including them again brings them back in.
  const member = first(ctx.db.all(`SELECT "userId", mapped FROM microsoft_member WHERE email = ?`, email));
  const cfg = config(ctx);
  const connectionId = strOrNull(cfg, "connectionId");
  const userId = strOrNull(member, "userId");
  if (input.excluded) await stopMember(ctx, { email, userId: num(member, "mapped") === 1 ? userId : null, connectionId });
  else if (connectionId && userId && num(member, "mapped") === 1 && num(cfg, "autoConnect") === 1) {
    await ctx.call("mail.member_pause", { provider: "microsoft", address: email, paused: false }).catch((e: unknown) => ctx.log.warn("microsoft member mailbox was not resumed", { code: codeOf(e) }));
    await ctx.call("mounts.account_pause", { account: email, paused: false }).catch((e: unknown) => ctx.log.warn("microsoft member mounts were not resumed", { code: codeOf(e) }));
    await connectMember(ctx, { connectionId, userId, email, key: `include:${email}:${ctx.now()}`, wait: 0 });
  }
  return { excluded: rowsOf(ctx.db.all(`SELECT email FROM microsoft_member WHERE excluded = ?`, 1)).map((r) => str(r, "email")).sort() };
}

/**
 * Match a Microsoft address to a person in the Space, or take the match away (no person). Setup matches people by the email their invitation went to; this is for the rest: the owner, someone
 * whose work address differs from their invitation. An address belongs to one person and a person to one address, so a clash is refused until the first match is taken away.
 */
export async function consentMapMember(ctx: MicrosoftCtx, input: { email: string; userId?: string; idempotencyKey: string }) {
  ensure(ctx);
  const email = normalizeEmail(input.email ?? "");
  if (!EMAIL.test(email)) bad(ctx, "The address is not an email.");
  const cfg = config(ctx);
  const connectionId = strOrNull(cfg, "connectionId");
  const domain = strOrNull(cfg, "domain");
  if (!cfg || num(cfg, "configured") !== 1 || !connectionId) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "Microsoft delegation is not set up." });
  if (domain && !email.endsWith(`@${domain}`)) bad(ctx, `Only addresses at ${domain} can be matched.`);
  const now = ctx.now();
  const have = first(ctx.db.all(`SELECT "userId", mapped, excluded FROM microsoft_member WHERE email = ?`, email));
  if (input.userId === undefined) {
    const was = strOrNull(have, "userId");
    if (have) ctx.db.run(`UPDATE microsoft_member SET "userId" = ?, mapped = ?, "mailboxState" = ?, updated_at = ? WHERE email = ?`, null, 0, null, now, email);
    if (was) await connectCalendar(ctx, { connectionId, userId: was, email, connected: false });
    return { email, mapped: false, connected: false };
  }
  if (!/^usr_[a-z0-9]+$/.test(input.userId)) bad(ctx, "The person is a member id.");
  const holder = strOrNull(have, "userId");
  if (holder && holder !== input.userId && num(have, "mapped") === 1) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "That address is already matched to someone else. Take that match away first." });
  const other = rowsOf(ctx.db.all(`SELECT email FROM microsoft_member WHERE "userId" = ? AND mapped = ?`, input.userId, 1)).find((r) => str(r, "email") !== email);
  if (other) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: `That person is already matched to ${str(other, "email")}. Take that match away first.` });
  if (have) ctx.db.run(`UPDATE microsoft_member SET "userId" = ?, mapped = ?, updated_at = ? WHERE email = ?`, input.userId, 1, now, email);
  else ctx.db.run(`INSERT INTO microsoft_member (email, "userId", mapped, excluded, "mailboxState", updated_at) VALUES (?, ?, ?, ?, ?, ?)`, email, input.userId, 1, 0, null, now);
  const excluded = num(have, "excluded") === 1;
  let connected = false;
  if (!excluded && num(cfg, "autoConnect") === 1) connected = await connectMember(ctx, { connectionId, userId: input.userId, email, key: `map:${email}:${input.userId}`, wait: 0 });
  return { email, userId: input.userId, mapped: true, connected };
}

/** Choose Mail, Calendar and Files separately, after setup too. What is turned off stops for everyone at once; what is turned on comes in for everyone included. A wider choice needs its permission added at Microsoft, and the next check says so. */
export async function consentSetData(ctx: MsCtx, input: { data: DataChoice; idempotencyKey: string }) {
  ensure(ctx);
  const cfg = config(ctx);
  const connectionId = strOrNull(cfg, "connectionId");
  if (!cfg || num(cfg, "configured") !== 1 || !connectionId) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "Microsoft 365 is not set up." });
  const before = dataOf(cfg), next = input.data;
  ctx.db.run(`UPDATE microsoft_config SET "dataMail" = ?, "dataCalendar" = ?, "dataFiles" = ?, updated_at = ? WHERE id = ?`, next.mail ? 1 : 0, next.calendar ? 1 : 0, next.files ? 1 : 0, ctx.now(), CONFIG_ID);
  forgetTokens();
  const people = rowsOf(ctx.db.all(`SELECT email, "userId" FROM microsoft_member WHERE mapped = ? AND excluded = ? AND "userId" IS NOT NULL`, 1, 0));
  for (const [i, m] of people.entries()) {
    const email = str(m, "email"), userId = str(m, "userId");
    if (before.mail !== next.mail) {
      await ctx.call("mail.member_pause", { provider: "microsoft", address: email, paused: !next.mail }).catch((e: unknown) => ctx.log.warn("microsoft mailbox change failed", { code: codeOf(e) }));
      if (next.mail) {
        await ctx.call("mail.auto_connect_members", { provider: "microsoft", members: [{ userId, email }], idempotencyKey: `${input.idempotencyKey}:${email}` });
        await queueFirstPull(ctx, connectionId, email, i);
      } else ctx.db.run(`UPDATE microsoft_mailbox SET "nextPollAt" = ? WHERE email = ?`, null, email);
    }
    if (before.calendar !== next.calendar) await connectCalendar(ctx, { connectionId, userId, email, connected: next.calendar });
    if (before.files !== next.files) await ctx.call("mounts.account_pause", { account: email, paused: !next.files }).catch((e: unknown) => ctx.log.warn("microsoft mount change failed", { code: codeOf(e) }));
  }
  return { data: next, permissions: permissionsFor(next), exchangeRoles: rolesFor(next) };
}

/** The removal wizard ended this person: nothing of theirs is read any more. */
export async function personLeft(ctx: MsCtx, event: { payload: { personId?: string } }): Promise<string[]> {
  const gone = event.payload.personId;
  if (typeof gone !== "string" || !/^usr_[a-z0-9]+$/.test(gone)) return [];
  ensure(ctx);
  const rows = rowsOf(ctx.db.all(`SELECT email FROM microsoft_member WHERE "userId" = ? AND mapped = ?`, gone, 1)).map((r) => str(r, "email"));
  for (const email of rows) {
    ctx.db.run(`UPDATE microsoft_member SET mapped = ?, "mailboxState" = ?, updated_at = ? WHERE email = ?`, 0, "paused", ctx.now(), email);
    ctx.db.run(`UPDATE microsoft_mailbox SET "nextPollAt" = ? WHERE email = ?`, null, email);
  }
  if (rows.length) forgetTokens();
  return [];
}

/** Who reached whose Microsoft data: newest first, a page at a time. `onBehalf` is the person an agent worked for. */
export async function accessLog(ctx: MsCtx, input: { cursor?: string; limit?: number; mailbox?: string }) {
  ensure(ctx);
  const limit = input.limit ?? 100;
  const offset = input.cursor === undefined ? 0 : Number(input.cursor);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) bad(ctx, "Limit must be from 1 to 500.");
  if (!Number.isSafeInteger(offset) || offset < 0) bad(ctx, "Cursor is not valid.");
  const mailbox = input.mailbox === undefined ? undefined : normalizeEmail(input.mailbox);
  const rows = rowsOf(mailbox ? ctx.db.all(`SELECT * FROM microsoft_read_log WHERE subject = ? ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`, mailbox, limit + 1, offset) : ctx.db.all(`SELECT * FROM microsoft_read_log ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`, limit + 1, offset));
  const entries = rows.slice(0, limit).map((r) => ({ who: str(r, "actor"), ...(strOrNull(r, "onBehalf") ? { onBehalf: str(r, "onBehalf") } : {}), mailbox: str(r, "subject"), cap: str(r, "cap"), at: num(r, "at") }));
  return { entries, ...(rows.length > limit ? { next: String(offset + limit) } : {}) };
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
  if (!cfg || num(cfg, "configured") !== 1 || !connectionId) return { state: "healthy" as const, detail: "Microsoft 365 is not set up yet." };
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



/** The address the caller is matched to, if they are matched and not excluded. A mount names it so it syncs as the person who made it. */
export async function consentMyAccount(ctx: MsCtx) {
  const person = ctx.actingFor ?? ctx.principal.id;
  const row = first(ctx.db.all(`SELECT email, excluded FROM microsoft_member WHERE "userId" = ? AND mapped = ?`, person, 1));
  const out: { email?: string; connectionId?: string; files?: boolean } = {};
  if (row && num(row, "excluded") !== 1) {
    out.email = str(row, "email");
    const cfg = config(ctx);
    const connectionId = strOrNull(cfg, "connectionId");
    if (connectionId && num(cfg, "configured") === 1) { out.connectionId = connectionId; out.files = dataOf(cfg).files; }
  }
  return out;
}
