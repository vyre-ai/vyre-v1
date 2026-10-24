// google.dwd.*, google.health, google.receive_push and the Calendar, Drive, Sheets, Docs and Meet calls (spec 2.18, ARCH 8 and 8.1).
// Delegation setup maps Workspace users to Space members by email and, with auto-connect on (the default), creates a Pending mail
// connection and one notice for each mapped member through mail.auto_connect_members. Every call acts as a member, is logged per person
// and never reaches an excluded member.
import { fail } from "../../../host/src/routes/errors.ts";
import {
  ADMIN_CONSOLE_URL, api, apiRaw, bad, bearer, CALENDAR, CONFIG_ID, config, DOCS, DRIVE, EMAIL, enc, ensure, EVENTS, first, forgetTokens, int, list, MEET,
  needHost, newId, normalizeEmail, num, obj, refusal, rowsOf, SCOPES, SHEETS, str, strOrNull, text, codeOf,
} from "../projections.ts";
import type { Call, GoogleCtx } from "../projections.ts";
import { ensureMailbox, pollInterval, pullMailbox } from "./gmail.ts";
import type { Act } from "./gmail.ts";

const g = (ctx: GoogleCtx, a: Act, cap: string, scope: string, c: Omit<Call, "cap" | "connectionId" | "as" | "scope">): Promise<Record<string, unknown>> =>
  api(ctx, { cap, connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}), scope, ...c });

const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;

// ---- delegation (Console > Integrations)

export async function dwdStatus(ctx: GoogleCtx) {
  ensure(ctx);
  const cfg = config(ctx);
  const members = rowsOf(ctx.db.all(`SELECT email, mapped, excluded FROM google_member`));
  const out: {
    configured: boolean; adminEmail?: string; domain?: string; lastProbeAt?: number; lastProbeOk?: boolean; autoConnect: boolean; mappedMembers: number; excluded: string[];
  } = {
    configured: num(cfg, "configured") === 1,
    autoConnect: cfg ? num(cfg, "autoConnect") === 1 : true,
    mappedMembers: members.filter((m) => num(m, "mapped") === 1 && num(m, "excluded") === 0).length,
    excluded: members.filter((m) => num(m, "excluded") === 1).map((m) => str(m, "email")).sort(),
  };
  if (strOrNull(cfg, "adminEmail")) out.adminEmail = str(cfg, "adminEmail");
  if (strOrNull(cfg, "domain")) out.domain = str(cfg, "domain");
  if (typeof cfg?.lastProbeAt === "number") out.lastProbeAt = cfg.lastProbeAt;
  if (typeof cfg?.lastProbeOk === "number") out.lastProbeOk = cfg.lastProbeOk === 1;
  return out;
}

export async function dwdScopes(ctx: GoogleCtx) {
  ensure(ctx);
  const out: { scopes: string[]; clientId?: string; adminConsoleUrl: string } = { scopes: [...SCOPES], adminConsoleUrl: ADMIN_CONSOLE_URL };
  const clientId = strOrNull(config(ctx), "clientId");
  if (clientId) out.clientId = clientId;
  return out;
}

async function autoConnectPolicy(ctx: GoogleCtx): Promise<boolean> {
  try {
    const row = obj(obj(await ctx.call("settings.get", { key: "google.auto_connect" })).row);
    return row.value === false ? false : true;
  } catch {
    return true;   // the policy defaults on
  }
}

/** A delegated sign-in for one address, proved with users.getProfile. Runs before the member map exists, so it is open. */
async function probeProfile(ctx: GoogleCtx, connectionId: string, email: string, cap: string): Promise<{ status: number; email?: string }> {
  const r = await apiRaw(ctx, { cap, connectionId, as: email, scope: "gmail.modify", open: true, url: "https://gmail.googleapis.com/gmail/v1/users/me/profile" });
  const out: { status: number; email?: string } = { status: r.status };
  if (text(r.json.emailAddress)) out.email = text(r.json.emailAddress)!;
  return out;
}

export async function dwdSetup(ctx: GoogleCtx, input: { vaultItem: string; adminEmail: string; domain?: string; idempotencyKey: string }) {
  ensure(ctx);
  if (!HANDLE.test(input.vaultItem ?? "")) bad(ctx, "The Vault item is not a valid handle.");
  const admin = normalizeEmail(input.adminEmail ?? "");
  if (!EMAIL.test(admin)) bad(ctx, "The admin address is not an email.");
  const domain = (input.domain ?? admin.slice(admin.indexOf("@") + 1)).trim().toLowerCase();
  if (!domain || /\s/.test(domain)) bad(ctx, "The domain is not valid.");
  const host = needHost(ctx);
  const account = await host.serviceAccount(ctx, input.vaultItem);

  const cfg = config(ctx);
  let connectionId = strOrNull(cfg, "connectionId");
  if (!connectionId) {
    const made = obj(obj(await ctx.call("connections.create", {
      connector: "google", title: "Google Workspace", ownerKind: "space", secrets: { Google_DWD: input.vaultItem }, scopes: [...SCOPES],
      idempotencyKey: `${input.idempotencyKey}:connection`,
    })).connection);
    connectionId = text(made.connectionId) ?? null;
    if (!connectionId) throw fail("internal.unexpected", ctx.trace.traceId, { message: "The connection was not created." });
  }
  const now = ctx.now();
  const autoConnect = await autoConnectPolicy(ctx);
  if (cfg) {
    ctx.db.run(
      `UPDATE google_config SET "connectionId" = ?, "vaultItem" = ?, "adminEmail" = ?, domain = ?, "clientId" = ?, "clientEmail" = ?, configured = ?, "autoConnect" = ?, updated_at = ? WHERE id = ?`,
      connectionId, input.vaultItem, admin, domain, account.clientId, account.clientEmail, 0, autoConnect ? 1 : 0, now, CONFIG_ID,
    );
  } else {
    ctx.db.run(
      `INSERT INTO google_config (id, "connectionId", "vaultItem", "adminEmail", domain, "clientId", "clientEmail", configured, "autoConnect", "lastProbeAt", "lastProbeOk", updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      CONFIG_ID, connectionId, input.vaultItem, admin, domain, account.clientId, account.clientEmail, 0, autoConnect ? 1 : 0, null, null, now,
    );
  }
  forgetTokens();

  // The probe proves the key, the delegation and the scopes before anyone is connected.
  const probe = await probeProfile(ctx, connectionId, admin, "google.dwd.setup").catch((e) => {
    ctx.db.run(`UPDATE google_config SET "lastProbeAt" = ?, "lastProbeOk" = ? WHERE id = ?`, now, 0, CONFIG_ID);
    throw e;
  });
  ctx.db.run(`UPDATE google_config SET "lastProbeAt" = ?, "lastProbeOk" = ? WHERE id = ?`, now, probe.status < 300 ? 1 : 0, CONFIG_ID);
  if (probe.status >= 300) {
    throw fail("provider.auth_failed", ctx.trace.traceId, { message: "Google did not accept the delegated sign-in for the admin. Check the scopes in the Admin console.", details: { status: probe.status } });
  }

  // Members by email. An address already excluded stays excluded.
  const mapped: { userId: string; email: string }[] = [];
  for (const m of await host.memberEmails(ctx)) {
    const email = normalizeEmail(m.email);
    if (!EMAIL.test(email) || !email.endsWith(`@${domain}`)) continue;   // only this Workspace's addresses can be delegated
    const prior = first(ctx.db.all(`SELECT excluded FROM google_member WHERE email = ?`, email));
    if (prior) ctx.db.run(`UPDATE google_member SET "userId" = ?, mapped = ?, updated_at = ? WHERE email = ?`, m.userId, 1, now, email);
    else ctx.db.run(`INSERT INTO google_member (email, "userId", mapped, excluded, "mailboxState", updated_at) VALUES (?, ?, ?, ?, ?, ?)`, email, m.userId, 1, 0, null, now);
    if (!prior || num(prior, "excluded") === 0) mapped.push({ userId: m.userId, email });
  }

  let connected = 0;
  if (autoConnect && mapped.length > 0) {
    const out = obj(await ctx.call("mail.auto_connect_members", { provider: "google", members: mapped, idempotencyKey: `${input.idempotencyKey}:members` }));
    connected = int(out.created) ?? 0;
    for (const m of mapped) ctx.db.run(`UPDATE google_member SET "mailboxState" = ? WHERE email = ?`, "pending", m.email);
  }
  ctx.db.run(`UPDATE google_config SET configured = ?, updated_at = ? WHERE id = ?`, 1, now, CONFIG_ID);
  ctx.emit("google.dwd_configured", "connector/google", { connector: "google", adminEmail: admin, mappedMembers: mapped.length, autoConnect });
  return { configured: true, scopes: [...SCOPES], mappedMembers: mapped.length, connected };
}

export async function dwdProbe(ctx: GoogleCtx, input: { as?: string }) {
  ensure(ctx);
  const cfg = config(ctx);
  const connectionId = strOrNull(cfg, "connectionId");
  const admin = strOrNull(cfg, "adminEmail");
  if (!cfg || !connectionId || !admin) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "Google delegation is not set up." });
  const who = input.as ? normalizeEmail(input.as) : admin;
  if (!EMAIL.test(who)) bad(ctx, "The address is not an email.");
  const host = needHost(ctx);
  const missing: string[] = [];
  for (const scope of SCOPES) {
    try {
      await host.mintToken(ctx, { connectionId, sub: who, scopes: [scope] });
    } catch (e) {
      if (codeOf(e) !== "provider.auth_failed") throw e;
      missing.push(scope);
    }
  }
  let email: string | undefined;
  let detail: string | undefined;
  if (missing.length === 0) {
    const p = await probeProfile(ctx, connectionId, who, "google.dwd.probe");
    if (p.status < 300) email = p.email;
    else detail = `Gmail answered ${p.status} for ${who}.`;
  } else {
    detail = "Add the missing scopes for the client id in the Google Admin console.";
  }
  const ok = missing.length === 0 && email !== undefined;
  ctx.db.run(`UPDATE google_config SET "lastProbeAt" = ?, "lastProbeOk" = ? WHERE id = ?`, ctx.now(), ok ? 1 : 0, CONFIG_ID);
  const payload: { connector: "google"; ok: boolean; email?: string; scopesMissing: string[] } = { connector: "google", ok, scopesMissing: missing };
  if (email) payload.email = email;
  ctx.emit("google.dwd_probed", "connector/google", payload);
  const out: { ok: boolean; email?: string; scopesMissing: string[]; detail?: string } = { ok, scopesMissing: missing };
  if (email) out.email = email;
  if (detail) out.detail = detail;
  return out;
}

export async function dwdMembers(ctx: GoogleCtx, input: { cursor?: string; limit?: number }) {
  ensure(ctx);
  const limit = input.limit ?? 100;
  const offset = input.cursor === undefined ? 0 : Number(input.cursor);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) bad(ctx, "Limit must be from 1 to 500.");
  if (!Number.isSafeInteger(offset) || offset < 0) bad(ctx, "Cursor is not valid.");
  const rows = rowsOf(ctx.db.all(`SELECT * FROM google_member ORDER BY email ASC`));
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

export async function dwdSetExcluded(ctx: GoogleCtx, input: { email: string; excluded: boolean }) {
  ensure(ctx);
  const email = normalizeEmail(input.email ?? "");
  if (!EMAIL.test(email)) bad(ctx, "The address is not an email.");
  if (typeof input.excluded !== "boolean") bad(ctx, "Excluded must be true or false.");
  const now = ctx.now();
  if (first(ctx.db.all(`SELECT email FROM google_member WHERE email = ?`, email))) {
    ctx.db.run(`UPDATE google_member SET excluded = ?, updated_at = ? WHERE email = ?`, input.excluded ? 1 : 0, now, email);
  } else {
    ctx.db.run(`INSERT INTO google_member (email, "userId", mapped, excluded, "mailboxState", updated_at) VALUES (?, ?, ?, ?, ?, ?)`, email, null, 0, input.excluded ? 1 : 0, null, now);
  }
  forgetTokens();
  return { excluded: rowsOf(ctx.db.all(`SELECT email FROM google_member WHERE excluded = ?`, 1)).map((r) => str(r, "email")).sort() };
}

export async function dwdDisable(ctx: GoogleCtx) {
  ensure(ctx);
  ctx.db.run(`UPDATE google_config SET configured = ?, updated_at = ? WHERE id = ?`, 0, ctx.now(), CONFIG_ID);
  ctx.db.run(`UPDATE google_member SET "mailboxState" = ?, updated_at = ? WHERE mapped = ?`, "paused", ctx.now(), 1);
  ctx.db.run(`UPDATE google_mailbox SET "nextPollAt" = ?`, null);
  forgetTokens();
  ctx.emit("google.dwd_revoked", "connector/google", { connector: "google", by: ctx.principal.id });
  return { disabled: true };
}

export async function health(ctx: GoogleCtx, input: { as?: string }) {
  ensure(ctx);
  const cfg = config(ctx);
  const connectionId = strOrNull(cfg, "connectionId");
  const admin = strOrNull(cfg, "adminEmail");
  if (!cfg || num(cfg, "configured") !== 1 || !connectionId || !admin) return { state: "down" as const, detail: "Google delegation is not set up." };
  const started = ctx.now();
  try {
    const p = await probeProfile(ctx, connectionId, input.as ? normalizeEmail(input.as) : admin, "google.health");
    const latencyMs = Math.max(0, ctx.now() - started);
    if (p.status < 300) return { state: "healthy" as const, latencyMs };
    if (p.status === 429 || p.status >= 500) return { state: "degraded" as const, detail: `Google answered ${p.status}.`, latencyMs };
    return { state: "down" as const, detail: "Google refused the delegated sign-in. Check the key and the scopes.", latencyMs };
  } catch (e) {
    if (codeOf(e) === "provider.auth_failed") return { state: "down" as const, detail: "Google refused the delegated sign-in. Check the key and the scopes." };
    if (codeOf(e) === "provider.network" || codeOf(e) === "provider.unavailable") return { state: "degraded" as const, detail: "Google could not be reached." };
    throw e;
  }
}

// ---- push

export async function receivePush(
  ctx: GoogleCtx,
  input: { kind: "gmail" | "calendar" | "drive" | "meet"; messageId: string; mailbox?: string; historyId?: string; channelId?: string; resourceState?: string; resourceId?: string },
) {
  ensure(ctx);
  if (typeof input.messageId !== "string" || input.messageId.length === 0) bad(ctx, "A push notice needs its message id.");
  if (first(ctx.db.all(`SELECT "messageId" FROM google_push_seen WHERE "messageId" = ?`, input.messageId))) return { accepted: false };
  ctx.db.run(`INSERT INTO google_push_seen ("messageId", kind, at) VALUES (?, ?, ?)`, input.messageId, input.kind, ctx.now());
  const payload: Record<string, unknown> = { connector: "google", kind: input.kind, messageId: input.messageId };
  for (const k of ["mailbox", "historyId", "channelId", "resourceState", "resourceId"] as const) if (input[k] !== undefined) payload[k] = input[k];
  ctx.emit("google.push_received", "connector/google", payload);
  if (input.kind === "gmail" && input.mailbox) await pullAndSchedule(ctx, normalizeEmail(input.mailbox), input.messageId);
  return { accepted: true };
}

/** Pull one mailbox for a push notice or a poll, then keep exactly one future poll queued for it. A failed pull never fails the notice. */
async function pullAndSchedule(ctx: GoogleCtx, email: string, cause: string): Promise<void> {
  const cfg = config(ctx);
  const connectionId = strOrNull(cfg, "connectionId");
  if (!cfg || num(cfg, "configured") !== 1 || !connectionId) return;
  const member = first(ctx.db.all(`SELECT mapped, excluded FROM google_member WHERE email = ?`, email));
  if (!member || num(member, "mapped") !== 1 || num(member, "excluded") === 1) return;
  const now = ctx.now();
  let delay: number;
  try {
    const pull = await pullMailbox(ctx, { connectionId, mailbox: email });
    delay = pull.complete ? pull.nextPollMs : pollInterval(now, null, false);
    ctx.log.info("google pull", { mailbox: email, ingested: pull.ingested, deduped: pull.deduped, skipped: pull.skipped, complete: pull.complete, cause });
  } catch (e) {
    ctx.log.warn("google pull failed", { mailbox: email, code: codeOf(e), cause });
    delay = pollInterval(now, null, false);
  }
  const box = first(ctx.db.all(`SELECT "nextPollAt" FROM google_mailbox WHERE email = ?`, email));
  const queued = box && typeof box.nextPollAt === "number" ? box.nextPollAt : 0;
  if (queued > now) return;   // a poll is already waiting; a push or a manual sync does not start a second chain
  const at = now + delay;
  ensureMailbox(ctx, email, connectionId);
  ctx.db.run(`UPDATE google_mailbox SET "nextPollAt" = ? WHERE email = ?`, at, email);
  await ctx.schedule(at, "google.receive_push", { kind: "gmail", messageId: `poll:${email}:${at}`, mailbox: email });
}

// ---- Calendar

const mapEvent = (e: Record<string, unknown>) => {
  const out: Record<string, unknown> = { id: text(e.id) ?? "", start: obj(e.start), end: obj(e.end) };
  for (const k of ["status", "summary", "location", "hangoutLink", "updated"] as const) if (text(e[k]) !== undefined) out[k] = text(e[k]);
  if (e.organizer && typeof e.organizer === "object") out.organizer = obj(e.organizer);
  if (Array.isArray(e.attendees)) {
    out.attendees = e.attendees.map((x) => {
      const o = obj(x);
      const att: Record<string, unknown> = { email: text(o.email) ?? "" };
      if (text(o.responseStatus) !== undefined) att.responseStatus = text(o.responseStatus);
      if (typeof o.optional === "boolean") att.optional = o.optional;
      return att;
    });
  }
  return out;
};
const cal = (c: string): string => `${CALENDAR}/calendars/${enc(c)}`;

export async function calendarList(ctx: GoogleCtx, a: Act) {
  const r = await g(ctx, a, "google.calendar.list_calendars", "calendar", { url: `${CALENDAR}/users/me/calendarList`, bulk: true });
  return {
    calendars: list(r.items).map((x) => {
      const o = obj(x);
      const c: Record<string, unknown> = { id: text(o.id) ?? "", summary: text(o.summary) ?? "" };
      if (typeof o.primary === "boolean") c.primary = o.primary;
      if (text(o.backgroundColor)) c.backgroundColor = text(o.backgroundColor);
      if (text(o.accessRole)) c.accessRole = text(o.accessRole);
      return c;
    }),
  };
}

export async function eventsList(ctx: GoogleCtx, a: Act & { calendarId: string; timeMin?: string; timeMax?: string; q?: string; syncToken?: string; pageToken?: string }) {
  // With a sync token Google refuses every other filter.
  const q = a.syncToken
    ? { syncToken: a.syncToken, pageToken: a.pageToken }
    : { timeMin: a.timeMin, timeMax: a.timeMax, q: a.q, pageToken: a.pageToken, singleEvents: true, orderBy: "startTime", maxResults: 250 };
  const r = await g(ctx, a, "google.calendar.list_events", "calendar", { url: `${cal(a.calendarId)}/events`, query: q, bulk: true });
  const out: Record<string, unknown> = { events: list(r.items).map((x) => mapEvent(obj(x))) };
  if (text(r.nextPageToken)) out.nextPageToken = text(r.nextPageToken);
  if (text(r.nextSyncToken)) out.nextSyncToken = text(r.nextSyncToken);
  return out;
}

export async function eventGet(ctx: GoogleCtx, a: Act & { calendarId: string; eventId: string }) {
  return { event: mapEvent(await g(ctx, a, "google.calendar.get_event", "calendar", { url: `${cal(a.calendarId)}/events/${enc(a.eventId)}` })) };
}

interface EventWrite { calendarId: string; summary?: string; description?: string; location?: string; start?: Record<string, unknown>; end?: Record<string, unknown>; attendees?: { email: string; optional?: boolean }[]; conference?: boolean; sendUpdates?: "all" | "externalOnly" | "none" }
function eventBody(ctx: GoogleCtx, a: EventWrite): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const k of ["summary", "description", "location", "start", "end"] as const) if (a[k] !== undefined) body[k] = a[k];
  if (a.attendees) {
    for (const x of a.attendees) if (!EMAIL.test(x.email)) bad(ctx, "An attendee address is not an email.");
    body.attendees = a.attendees.map((x) => ({ email: normalizeEmail(x.email), ...(x.optional !== undefined ? { optional: x.optional } : {}) }));
  }
  if (a.conference) body.conferenceData = { createRequest: { requestId: newId("cnf", ctx.now()), conferenceSolutionKey: { type: "hangoutsMeet" } } };
  return body;
}

export async function eventCreate(ctx: GoogleCtx, a: Act & EventWrite) {
  const r = await g(ctx, a, "google.calendar.create_event", "calendar", {
    method: "POST", url: `${cal(a.calendarId)}/events`, query: { sendUpdates: a.sendUpdates ?? "all", ...(a.conference ? { conferenceDataVersion: 1 } : {}) }, body: eventBody(ctx, a),
  });
  return { event: mapEvent(r) };
}

export async function eventUpdate(ctx: GoogleCtx, a: Act & EventWrite & { eventId: string }) {
  const r = await g(ctx, a, "google.calendar.update_event", "calendar", {
    method: "PATCH", url: `${cal(a.calendarId)}/events/${enc(a.eventId)}`, query: { sendUpdates: a.sendUpdates ?? "all", ...(a.conference ? { conferenceDataVersion: 1 } : {}) }, body: eventBody(ctx, a),
  });
  return { event: mapEvent(r) };
}

export async function eventDelete(ctx: GoogleCtx, a: Act & { calendarId: string; eventId: string; sendUpdates?: "all" | "externalOnly" | "none" }) {
  await g(ctx, a, "google.calendar.delete_event", "calendar", { method: "DELETE", url: `${cal(a.calendarId)}/events/${enc(a.eventId)}`, query: { sendUpdates: a.sendUpdates ?? "all" } });
  return { deleted: true };
}

export async function eventRespond(ctx: GoogleCtx, a: Act & { calendarId: string; eventId: string; response: "accepted" | "declined" | "tentative" }) {
  const url = `${cal(a.calendarId)}/events/${enc(a.eventId)}`;
  const got = await apiRaw(ctx, { cap: "google.calendar.respond", connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}), scope: "calendar", url });
  if (got.status >= 300) throw refusal(ctx, got.status, got.json);
  let found = false;
  const attendees = list(got.json.attendees).map((x) => {
    const o = obj(x);
    if (o.self === true || normalizeEmail(text(o.email) ?? "") === got.sub) { found = true; return { ...o, responseStatus: a.response }; }
    return o;
  });
  if (!found) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "You are not on that event's guest list." });
  const r = await g(ctx, a, "google.calendar.respond", "calendar", { method: "PATCH", url, query: { sendUpdates: "all" }, body: { attendees } });
  return { event: mapEvent(r) };
}

export async function freeBusy(ctx: GoogleCtx, a: Act & { emails: string[]; timeMin: string; timeMax: string }) {
  for (const e of a.emails) if (!EMAIL.test(e)) bad(ctx, "An address is not an email.");
  const r = await g(ctx, a, "google.calendar.free_busy", "calendar", {
    method: "POST", url: `${CALENDAR}/freeBusy`, body: { timeMin: a.timeMin, timeMax: a.timeMax, items: a.emails.map((id) => ({ id: normalizeEmail(id) })) },
  });
  const busy: { email: string; start: string; end: string }[] = [];
  for (const [email, v] of Object.entries(obj(r.calendars))) {
    for (const b of list(obj(v).busy)) busy.push({ email, start: text(obj(b).start) ?? "", end: text(obj(b).end) ?? "" });
  }
  return { busy };
}

async function watchReply(r: Record<string, unknown>) {
  return { resourceId: text(r.resourceId) ?? "", expiration: int(r.expiration) ?? 0 };
}

export async function calendarWatch(ctx: GoogleCtx, a: Act & { calendarId: string; channelId: string; address: string }) {
  return watchReply(await g(ctx, a, "google.calendar.watch", "calendar", {
    method: "POST", url: `${cal(a.calendarId)}/events/watch`, body: { id: a.channelId, type: "web_hook", address: a.address },
  }));
}

export async function calendarStopWatch(ctx: GoogleCtx, a: Act & { channelId: string; resourceId: string }) {
  await g(ctx, a, "google.calendar.stop_watch", "calendar", { method: "POST", url: `${CALENDAR}/channels/stop`, body: { id: a.channelId, resourceId: a.resourceId } });
  return { stopped: true };
}

// ---- Drive

const FILE_FIELDS = "id,name,mimeType,parents,modifiedTime,size,webViewLink,driveId";
const mapFile = (f: Record<string, unknown>) => {
  const out: Record<string, unknown> = { id: text(f.id) ?? "", name: text(f.name) ?? "", mimeType: text(f.mimeType) ?? "" };
  if (Array.isArray(f.parents)) out.parents = f.parents.filter((x): x is string => typeof x === "string");
  for (const k of ["modifiedTime", "webViewLink", "driveId"] as const) if (text(f[k]) !== undefined) out[k] = text(f[k]);
  const size = int(f.size);
  if (size !== undefined) out.size = size;
  return out;
};
const shared = { supportsAllDrives: true } as const;
const quote = (s: string): string => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export async function driveList(ctx: GoogleCtx, a: Act & { q?: string; driveId?: string; parentId?: string; pageToken?: string; pageSize?: number }) {
  const terms = [a.q, a.parentId ? `'${quote(a.parentId)}' in parents` : undefined].filter((x): x is string => !!x);
  if (!terms.some((t) => /\btrashed\b/.test(t))) terms.push("trashed = false");
  const r = await g(ctx, a, "google.drive.list_files", "drive", {
    url: `${DRIVE}/files`, bulk: true,
    query: {
      q: terms.join(" and "), pageSize: a.pageSize, pageToken: a.pageToken, fields: `nextPageToken,files(${FILE_FIELDS})`, ...shared, includeItemsFromAllDrives: true,
      ...(a.driveId ? { corpora: "drive", driveId: a.driveId } : {}),
    },
  });
  const out: Record<string, unknown> = { files: list(r.files).map((f) => mapFile(obj(f))) };
  if (text(r.nextPageToken)) out.nextPageToken = text(r.nextPageToken);
  return out;
}

export async function driveGet(ctx: GoogleCtx, a: Act & { fileId: string }) {
  return { file: mapFile(await g(ctx, a, "google.drive.get_file", "drive", { url: `${DRIVE}/files/${enc(a.fileId)}`, query: { fields: FILE_FIELDS, ...shared } })) };
}

export async function driveDownload(ctx: GoogleCtx, a: Act & { fileId: string }) {
  const { token } = await bearer(ctx, { cap: "google.drive.download_file", connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}), scope: "drive" });
  const got = await needHost(ctx).download(ctx, { url: `${DRIVE}/files/${enc(a.fileId)}?alt=media&supportsAllDrives=true`, token });
  return { blobId: got.blobId, size: got.size, mimeType: got.mime };
}

export async function driveExport(ctx: GoogleCtx, a: Act & { fileId: string; mimeType: string }) {
  const { token } = await bearer(ctx, { cap: "google.drive.export_file", connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}), scope: "drive" });
  const got = await needHost(ctx).download(ctx, { url: `${DRIVE}/files/${enc(a.fileId)}/export?mimeType=${enc(a.mimeType)}`, token, mime: a.mimeType });
  return { blobId: got.blobId, size: got.size };
}

export async function drivePermissions(ctx: GoogleCtx, a: Act & { fileId: string }) {
  const r = await g(ctx, a, "google.drive.get_permissions", "drive", {
    url: `${DRIVE}/files/${enc(a.fileId)}/permissions`, query: { fields: "permissions(id,role,type,emailAddress)", ...shared },
  });
  return {
    permissions: list(r.permissions).map((x) => {
      const o = obj(x);
      const p: Record<string, unknown> = { id: text(o.id) ?? "", role: text(o.role) ?? "", type: text(o.type) ?? "" };
      if (text(o.emailAddress)) p.emailAddress = text(o.emailAddress);
      return p;
    }),
  };
}

export async function driveUpload(ctx: GoogleCtx, a: Act & { name: string; parentId?: string; fileId: string }) {
  const { token } = await bearer(ctx, { cap: "google.drive.upload_file", connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}), scope: "drive" });
  const answered = await needHost(ctx).upload(ctx, {
    url: `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=${enc(FILE_FIELDS)}`, token, fileId: a.fileId,
    metadata: { name: a.name, ...(a.parentId ? { parents: [a.parentId] } : {}) },
  });
  return { file: mapFile(obj(answered)) };
}

export async function driveCreateFolder(ctx: GoogleCtx, a: Act & { name: string; parentId?: string }) {
  const r = await g(ctx, a, "google.drive.create_folder", "drive", {
    method: "POST", url: `${DRIVE}/files`, query: { fields: FILE_FIELDS, ...shared },
    body: { name: a.name, mimeType: "application/vnd.google-apps.folder", ...(a.parentId ? { parents: [a.parentId] } : {}) },
  });
  return { file: mapFile(r) };
}

export async function driveCopy(ctx: GoogleCtx, a: Act & { fileId: string; name?: string; parentId?: string }) {
  const r = await g(ctx, a, "google.drive.copy_file", "drive", {
    method: "POST", url: `${DRIVE}/files/${enc(a.fileId)}/copy`, query: { fields: FILE_FIELDS, ...shared },
    body: { ...(a.name ? { name: a.name } : {}), ...(a.parentId ? { parents: [a.parentId] } : {}) },
  });
  return { file: mapFile(r) };
}

export async function driveShare(ctx: GoogleCtx, a: Act & { fileId: string; emails: string[]; role: "reader" | "commenter" | "writer"; notify?: boolean }) {
  for (const e of a.emails) if (!EMAIL.test(e)) bad(ctx, "An address is not an email.");
  for (const e of a.emails) {
    await g(ctx, a, "google.drive.share_file", "drive", {
      method: "POST", url: `${DRIVE}/files/${enc(a.fileId)}/permissions`, query: { sendNotificationEmail: a.notify ?? true, ...shared },
      body: { type: "user", role: a.role, emailAddress: normalizeEmail(e) },
    });
  }
  return { shared: true };
}

export async function driveTrash(ctx: GoogleCtx, a: Act & { fileId: string }) {
  await g(ctx, a, "google.drive.trash_file", "drive", { method: "PATCH", url: `${DRIVE}/files/${enc(a.fileId)}`, query: { ...shared }, body: { trashed: true } });
  return { trashed: true };
}

export async function driveChanges(ctx: GoogleCtx, a: Act & { pageToken: string; driveId?: string }) {
  const r = await g(ctx, a, "google.drive.list_changes", "drive", {
    url: `${DRIVE}/changes`, bulk: true,
    query: {
      pageToken: a.pageToken, ...(a.driveId ? { driveId: a.driveId } : {}), includeItemsFromAllDrives: true, ...shared,
      fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
    },
  });
  const out: Record<string, unknown> = {
    changes: list(r.changes).map((c) => {
      const o = obj(c);
      const ch: Record<string, unknown> = { fileId: text(o.fileId) ?? "", removed: o.removed === true };
      if (o.file && typeof o.file === "object") ch.file = mapFile(obj(o.file));
      return ch;
    }),
  };
  if (text(r.newStartPageToken)) out.newStartPageToken = text(r.newStartPageToken);
  if (text(r.nextPageToken)) out.nextPageToken = text(r.nextPageToken);
  return out;
}

export async function driveWatch(ctx: GoogleCtx, a: Act & { pageToken: string; channelId: string; address: string; driveId?: string }) {
  return watchReply(await g(ctx, a, "google.drive.watch_changes", "drive", {
    method: "POST", url: `${DRIVE}/changes/watch`, query: { pageToken: a.pageToken, ...(a.driveId ? { driveId: a.driveId } : {}), includeItemsFromAllDrives: true, ...shared },
    body: { id: a.channelId, type: "web_hook", address: a.address },
  }));
}

export async function driveStopWatch(ctx: GoogleCtx, a: Act & { channelId: string; resourceId: string }) {
  await g(ctx, a, "google.drive.stop_watch", "drive", { method: "POST", url: `${DRIVE}/channels/stop`, body: { id: a.channelId, resourceId: a.resourceId } });
  return { stopped: true };
}

/** Move a new Sheets or Docs file into a Drive folder: Google creates it in My Drive. */
async function moveInto(ctx: GoogleCtx, a: Act, cap: string, fileId: string, parentId: string): Promise<void> {
  const cur = await g(ctx, a, cap, "drive", { url: `${DRIVE}/files/${enc(fileId)}`, query: { fields: "parents", ...shared } });
  const from = list(cur.parents).filter((x): x is string => typeof x === "string").join(",");
  await g(ctx, a, cap, "drive", { method: "PATCH", url: `${DRIVE}/files/${enc(fileId)}`, query: { addParents: parentId, ...(from ? { removeParents: from } : {}), ...shared }, body: {} });
}

// ---- Sheets

export async function sheetGet(ctx: GoogleCtx, a: Act & { spreadsheetId: string }) {
  const r = await g(ctx, a, "google.sheets.get_spreadsheet", "spreadsheets", { url: `${SHEETS}/${enc(a.spreadsheetId)}`, query: { fields: "properties.title,sheets.properties" } });
  return {
    title: text(obj(r.properties).title) ?? "",
    sheets: list(r.sheets).map((s) => {
      const p = obj(obj(s).properties);
      const grid = obj(p.gridProperties);
      const out: Record<string, unknown> = { sheetId: int(p.sheetId) ?? 0, title: text(p.title) ?? "" };
      if (int(grid.rowCount) !== undefined) out.rows = int(grid.rowCount);
      if (int(grid.columnCount) !== undefined) out.columns = int(grid.columnCount);
      return out;
    }),
  };
}

export async function sheetValues(ctx: GoogleCtx, a: Act & { spreadsheetId: string; range: string }) {
  const r = await g(ctx, a, "google.sheets.get_values", "spreadsheets", { url: `${SHEETS}/${enc(a.spreadsheetId)}/values/${enc(a.range)}`, bulk: true });
  return { values: list(r.values).map((row) => list(row).map((c) => String(c))) };
}

export async function sheetUpdate(ctx: GoogleCtx, a: Act & { spreadsheetId: string; range: string; values: string[][]; valueInputOption?: "RAW" | "USER_ENTERED" }) {
  const r = await g(ctx, a, "google.sheets.update_values", "spreadsheets", {
    method: "PUT", url: `${SHEETS}/${enc(a.spreadsheetId)}/values/${enc(a.range)}`, query: { valueInputOption: a.valueInputOption ?? "USER_ENTERED" },
    body: { range: a.range, majorDimension: "ROWS", values: a.values },
  });
  return { updatedCells: int(r.updatedCells) ?? 0 };
}

export async function sheetAppend(ctx: GoogleCtx, a: Act & { spreadsheetId: string; range: string; values: string[][] }) {
  const r = await g(ctx, a, "google.sheets.append_values", "spreadsheets", {
    method: "POST", url: `${SHEETS}/${enc(a.spreadsheetId)}/values/${enc(a.range)}:append`, query: { valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" },
    body: { majorDimension: "ROWS", values: a.values },
  });
  return { updatedRows: int(obj(r.updates).updatedRows) ?? 0 };
}

export async function sheetCreate(ctx: GoogleCtx, a: Act & { title: string; parentId?: string }) {
  const r = await g(ctx, a, "google.sheets.create_spreadsheet", "spreadsheets", { method: "POST", url: SHEETS, body: { properties: { title: a.title } } });
  const spreadsheetId = text(r.spreadsheetId) ?? "";
  if (a.parentId) await moveInto(ctx, a, "google.sheets.create_spreadsheet", spreadsheetId, a.parentId);
  return { spreadsheetId, url: text(r.spreadsheetUrl) ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` };
}

export async function sheetBatch(ctx: GoogleCtx, a: Act & { spreadsheetId: string; requests: Record<string, unknown>[] }) {
  const r = await g(ctx, a, "google.sheets.batch_update", "spreadsheets", { method: "POST", url: `${SHEETS}/${enc(a.spreadsheetId)}:batchUpdate`, body: { requests: a.requests } });
  return { applied: list(r.replies).length || a.requests.length };
}

// ---- Docs

export async function docGet(ctx: GoogleCtx, a: Act & { documentId: string }) {
  const r = await g(ctx, a, "google.docs.get_document", "documents", { url: `${DOCS}/${enc(a.documentId)}` });
  return { title: text(r.title) ?? "", body: obj(r.body) };
}

export async function docCreate(ctx: GoogleCtx, a: Act & { title: string; parentId?: string }) {
  const r = await g(ctx, a, "google.docs.create_document", "documents", { method: "POST", url: DOCS, body: { title: a.title } });
  const documentId = text(r.documentId) ?? "";
  if (a.parentId) await moveInto(ctx, a, "google.docs.create_document", documentId, a.parentId);
  return { documentId, url: `https://docs.google.com/document/d/${documentId}/edit` };
}

export async function docBatch(ctx: GoogleCtx, a: Act & { documentId: string; requests: Record<string, unknown>[] }) {
  const r = await g(ctx, a, "google.docs.batch_update", "documents", { method: "POST", url: `${DOCS}/${enc(a.documentId)}:batchUpdate`, body: { requests: a.requests } });
  return { applied: list(r.replies).length || a.requests.length };
}

// ---- Meet

const RECORD = /^conferenceRecords\/[A-Za-z0-9_-]+$/;
const TRANSCRIPT = /^conferenceRecords\/[A-Za-z0-9_-]+\/transcripts\/[A-Za-z0-9_-]+$/;
const TIME = /^[0-9T:.+\-Z]+$/;
const MEET_SCOPE = "meetings.space.readonly";

export async function meetRecords(ctx: GoogleCtx, a: Act & { from?: string; to?: string; pageToken?: string }) {
  const terms: string[] = [];
  for (const [op, v] of [[">=", a.from], ["<=", a.to]] as const) {
    if (v === undefined) continue;
    if (!TIME.test(v)) bad(ctx, "A time must be an ISO timestamp.");
    terms.push(`start_time${op}"${v}"`);
  }
  const r = await g(ctx, a, "google.meet.list_conference_records", MEET_SCOPE, { url: `${MEET}/conferenceRecords`, bulk: true, query: { filter: terms.join(" AND ") || undefined, pageToken: a.pageToken } });
  const out: Record<string, unknown> = {
    records: list(r.conferenceRecords).map((x) => {
      const o = obj(x);
      const rec: Record<string, unknown> = { name: text(o.name) ?? "", startTime: text(o.startTime) ?? "" };
      if (text(o.endTime)) rec.endTime = text(o.endTime);
      if (text(o.space)) rec.space = text(o.space);
      return rec;
    }),
  };
  if (text(r.nextPageToken)) out.nextPageToken = text(r.nextPageToken);
  return out;
}

export async function meetRecordings(ctx: GoogleCtx, a: Act & { conferenceRecord: string }) {
  if (!RECORD.test(a.conferenceRecord)) bad(ctx, "The conference record name is not valid.");
  const r = await g(ctx, a, "google.meet.list_recordings", MEET_SCOPE, { url: `${MEET}/${a.conferenceRecord}/recordings` });
  return {
    recordings: list(r.recordings).map((x) => {
      const o = obj(x);
      const rec: Record<string, unknown> = { name: text(o.name) ?? "", state: text(o.state) ?? "" };
      const file = text(obj(o.driveDestination).file);
      if (file) rec.driveFileId = file.replace(/^files\//, "");
      return rec;
    }),
  };
}

export async function meetTranscripts(ctx: GoogleCtx, a: Act & { conferenceRecord: string }) {
  if (!RECORD.test(a.conferenceRecord)) bad(ctx, "The conference record name is not valid.");
  const r = await g(ctx, a, "google.meet.list_transcripts", MEET_SCOPE, { url: `${MEET}/${a.conferenceRecord}/transcripts` });
  return {
    transcripts: list(r.transcripts).map((x) => {
      const o = obj(x);
      const t: Record<string, unknown> = { name: text(o.name) ?? "", state: text(o.state) ?? "" };
      if (text(obj(o.docsDestination).document)) t.docsDocumentId = text(obj(o.docsDestination).document);
      return t;
    }),
  };
}

export async function meetEntries(ctx: GoogleCtx, a: Act & { transcript: string; pageToken?: string }) {
  if (!TRANSCRIPT.test(a.transcript)) bad(ctx, "The transcript name is not valid.");
  const r = await g(ctx, a, "google.meet.get_transcript_entries", MEET_SCOPE, { url: `${MEET}/${a.transcript}/entries`, bulk: true, query: { pageToken: a.pageToken } });
  const out: Record<string, unknown> = {
    entries: list(r.transcriptEntries).map((x) => {
      const o = obj(x);
      const e: Record<string, unknown> = { text: text(o.text) ?? "" };
      if (text(o.participant)) e.participant = text(o.participant);
      if (text(o.startTime)) e.startTime = text(o.startTime);
      return e;
    }),
  };
  if (text(r.nextPageToken)) out.nextPageToken = text(r.nextPageToken);
  return out;
}

export async function meetSubscribe(ctx: GoogleCtx, a: Act & { target: string; eventTypes: string[] }) {
  ensure(ctx);
  const topic = strOrNull(first(ctx.db.all(`SELECT "pubsubTopic" FROM google_mailbox WHERE "pubsubTopic" IS NOT NULL`)), "pubsubTopic");
  if (!topic) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "Start Gmail push first: Meet notices need its Pub/Sub topic." });
  const r = await g(ctx, a, "google.meet.subscribe", MEET_SCOPE, {
    method: "POST", url: `${EVENTS}/subscriptions`,
    body: { targetResource: a.target, eventTypes: a.eventTypes, payloadOptions: { includeResource: false }, notificationEndpoint: { pubsubTopic: topic } },
  });
  const done = obj(r.response);
  const out: { subscription: string; expiration?: number } = { subscription: text(done.name) ?? text(r.name) ?? "" };
  const exp = Date.parse(text(done.expireTime) ?? "");
  if (Number.isFinite(exp)) out.expiration = exp;
  return out;
}

