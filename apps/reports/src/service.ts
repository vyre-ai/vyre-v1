// The reports service (spec 4.18, ARCH 7.14): a Space posts a problem report signed with its host's Ed25519 key; the service checks the signature and the
// rate limit, keeps the bundle in object storage, opens a GitHub issue labelled bug, files a record in the Vyre team's own Space through that Space's API
// with a service token, and, when the issue closes, tells the reporter Space through its registered webhook. Every outward step is retryable and the report
// id makes the whole thing idempotent: a Space that never heard the answer posts the same report again and gets the same issue back.

import { base64url, fromBase64url, hmacHex, registerMessage, reportMessage, resolvedMessage, safeEqual, sha256hex, sign, utf8, verify } from "./crypto.ts";
import type { SigningKey } from "./crypto.ts";
import { MAX_BODY, MAX_SCREENSHOT, parseReport } from "./bundle.ts";
import type { Bundle } from "./bundle.ts";
import { closedIssue, issueBody, issueTitle, openIssue } from "./github.ts";
import type { HttpLike } from "./github.ts";
import { RateLimit } from "./ratelimit.ts";
import type { ObjectStore, ReportDb, ReportRow, SpaceRow } from "./store.ts";

export interface Config {
  /** where Spaces and GitHub reach this service, no trailing slash; the screenshot and bundle links in an issue start with it */
  publicUrl: string;
  github: { repo: string; token: string; webhookSecret: string };
  /** the Vyre team's own Space: its API base and a service token; null files no record */
  team: { baseUrl: string; token: string; recordType: string } | null;
  limits: { perSpace: number; perSpaceWindowMs: number; perIp: number; perIpWindowMs: number; registerPerIp: number; skewMs: number };
  /** tests and a private network: allow http and private-address webhooks */
  allowInsecureWebhooks?: boolean;
}

export interface Deps { db: ReportDb; objects: ObjectStore; outbound: HttpLike; now: () => number; random: (n: number) => Uint8Array; key: SigningKey }
export interface Req { method: string; path: string; query?: Record<string, string>; headers: Record<string, string>; body: Uint8Array; ip: string }
export interface Res { status: number; headers: Record<string, string>; body: Uint8Array | string }

export const DEFAULT_LIMITS: Config["limits"] = { perSpace: 20, perSpaceWindowMs: 3_600_000, perIp: 120, perIpWindowMs: 3_600_000, registerPerIp: 10, skewMs: 5 * 60_000 };

const SPACE_ID = /^spc_[a-z0-9]{4,64}$/;
const JSON_HEAD = { "content-type": "application/json" };

const ok = (status: number, data: unknown, extra: Record<string, string> = {}): Res => ({ status, headers: { ...JSON_HEAD, ...extra }, body: JSON.stringify({ data }) });
const err = (status: number, code: string, message: string, extra: Record<string, string> = {}, details?: Record<string, unknown>): Res =>
  ({ status, headers: { ...JSON_HEAD, ...extra }, body: JSON.stringify({ error: { code, message, ...(details ? { details } : {}) } }) });

/** A webhook address a Space may register: https (http when allowed), no credentials, no private or loopback host, the path /hooks/reports. */
export function webhookAllowed(raw: string, allowInsecure: boolean): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/hooks/reports") return false;
  if (allowInsecure) return u.protocol === "https:" || u.protocol === "http:";
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a = 0, b = 0] = h.split(".").map(Number);
    return !(a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224);
  }
  if (h.includes(":")) return false;   // an IPv6 literal: no Space registers one
  return h.includes(".");
}

export function createService(config: Config, deps: Deps) {
  const perIp = new RateLimit(config.limits.perIp, config.limits.perIpWindowMs, deps.now);
  const perSpace = new RateLimit(config.limits.perSpace, config.limits.perSpaceWindowMs, deps.now);
  const registerIp = new RateLimit(config.limits.registerPerIp, 3_600_000, deps.now);
  const header = (req: Req, name: string): string => req.headers[name] ?? "";

  /** The timestamp header, within the allowed skew of now. */
  const freshTs = (ts: string): boolean => /^\d{10,16}$/.test(ts) && Math.abs(deps.now() - Number(ts)) <= config.limits.skewMs;

  const randomToken = (): string => base64url(deps.random(16));

  async function putObjects(row: ReportRow, bundle: Bundle, png: Uint8Array | null): Promise<void> {
    await deps.objects.put(`reports/${row.reportId}/bundle.json`, utf8(JSON.stringify({ reportId: row.reportId, spaceId: row.spaceId, bundle })), "application/json");
    if (png) await deps.objects.put(`reports/${row.reportId}/screenshot.png`, png, "image/png");
  }

  async function ensureIssue(row: ReportRow, bundle: Bundle, hasShot: boolean): Promise<ReportRow> {
    if (row.issueNumber !== null) return row;
    const base = `${config.publicUrl}/v1/reports/${row.reportId}`;
    const issue = await openIssue(
      { repo: config.github.repo, token: config.github.token, outbound: deps.outbound },
      issueTitle(bundle, row.reportId),
      issueBody(bundle, { reportId: row.reportId, spaceId: row.spaceId, screenshotUrl: hasShot ? `${base}/screenshot?t=${row.viewToken}` : null, bundleUrl: `${base}/bundle?t=${row.viewToken}` }),
    );
    const next: ReportRow = { ...row, issueNumber: issue.number, issueUrl: issue.url, status: row.status === "resolved" ? "resolved" : "sent" };
    await deps.db.putReport(next);
    return next;
  }

  async function ensureRecord(row: ReportRow): Promise<ReportRow> {
    if (row.teamRecordId !== null || !config.team || row.issueNumber === null) return row;   // the record carries the issue number, so it waits for the issue
    const res = await deps.outbound(`${config.team.baseUrl.replace(/\/+$/, "")}/v1/records/create`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.team.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        type: config.team.recordType, idempotencyKey: `report-${row.reportId}`,
        fields: { title: row.title, status: "sent", traceIds: row.traceIds.join(","), issueNumber: row.issueNumber },
      }),
    });
    const text = await res.text();
    if (res.status < 200 || res.status > 299) throw new Error(`the team Space answered ${res.status}`);
    let id: unknown = null;
    try { id = (JSON.parse(text) as { data?: { record?: { id?: unknown } } }).data?.record?.id; } catch { /* no id */ }
    if (typeof id !== "string" || !id) throw new Error("the team Space's answer has no record id");
    const next = { ...row, teamRecordId: id };
    await deps.db.putReport(next);
    return next;
  }

  async function loadBundle(reportId: string): Promise<{ bundle: Bundle; shot: boolean } | null> {
    const o = await deps.objects.get(`reports/${reportId}/bundle.json`);
    if (!o) return null;
    try {
      const j = JSON.parse(new TextDecoder().decode(o.bytes)) as { bundle?: Bundle };
      if (!j.bundle) return null;
      return { bundle: j.bundle, shot: (await deps.objects.get(`reports/${reportId}/screenshot.png`)) !== null };
    } catch { return null; }
  }

  /** Tell the reporter Space its issue closed: a signed POST to the webhook it registered. */
  async function notifySpace(row: ReportRow): Promise<ReportRow> {
    if (row.status !== "resolved" || row.notified || row.issueNumber === null) return row;
    const space = await deps.db.getSpace(row.spaceId);
    if (!space) return row;
    const body = JSON.stringify({ reportId: row.reportId, issueNumber: row.issueNumber, ...(row.fixedIn ? { fixedIn: row.fixedIn } : {}) });
    const ts = String(deps.now());
    const sig = await sign(deps.key.key, resolvedMessage(ts, await sha256hex(utf8(body))));
    const res = await deps.outbound(space.webhook, { method: "POST", headers: { "content-type": "application/json", "x-vyre-reports-ts": ts, "x-vyre-reports-sig": sig }, body });
    await res.text();
    if (res.status < 200 || res.status > 299) throw new Error(`the Space's webhook answered ${res.status}`);
    const next = { ...row, notified: true };
    await deps.db.putReport(next);
    return next;
  }

  async function finish(row: ReportRow, bundle: Bundle, hasShot: boolean): Promise<ReportRow> {
    let r = row;
    for (const step of [() => ensureIssue(r, bundle, hasShot), () => ensureRecord(r), () => notifySpace(r)]) {
      try { r = await step(); } catch (e) { console.error(`reports: ${row.reportId}: ${(e as Error).message}`); }
    }
    return r;
  }

  // ---- routes -------------------------------------------------------------------------------------------------------

  async function register(req: Req): Promise<Res> {
    const hit = registerIp.take(req.ip);
    if (!hit.ok) return err(429, "rate_limit.exceeded", "Too many registrations from this address.", { "retry-after": String(hit.retryAfterSec) });
    if (req.body.length > 4096) return err(413, "validation.too_large", "The registration is too large.");
    let j: unknown;
    try { j = JSON.parse(new TextDecoder().decode(req.body)); } catch { return err(400, "validation.bad_input", "The body is not JSON."); }
    const o = (typeof j === "object" && j !== null ? j : {}) as Record<string, unknown>;
    if (typeof o.spaceId !== "string" || !SPACE_ID.test(o.spaceId)) return err(422, "validation.bad_input", "spaceId is not valid.", {}, { field: "spaceId" });
    let pub: Uint8Array;
    try { pub = fromBase64url(String(o.publicKey)); } catch { pub = new Uint8Array(0); }
    if (pub.length !== 32) return err(422, "validation.bad_input", "publicKey is a 32-byte Ed25519 key, base64url.", {}, { field: "publicKey" });
    if (typeof o.webhook !== "string" || !webhookAllowed(o.webhook, config.allowInsecureWebhooks === true)) {
      return err(422, "validation.bad_input", "webhook must be an https address on a public host with the path /hooks/reports.", {}, { field: "webhook" });
    }
    const ts = header(req, "x-vyre-ts");
    if (!freshTs(ts)) return err(401, "auth.expired", "The request time is not within five minutes of now.");
    const msg = registerMessage(ts, await sha256hex(req.body));
    if (!(await verify(pub, msg, header(req, "x-vyre-sig")))) return err(401, "auth.unauthenticated", "The registration is not signed by the key it names.");
    const existing = await deps.db.getSpace(o.spaceId);
    const newKey = base64url(pub);
    if (existing && existing.publicKey !== newKey) {
      const current = await verify(fromBase64url(existing.publicKey), msg, header(req, "x-vyre-sig-current"));
      if (!current) return err(409, "validation.duplicate", "That Space is registered with another key. Sign with the current key to replace it.");
    }
    const row: SpaceRow = { spaceId: o.spaceId, publicKey: newKey, webhook: o.webhook, registeredAt: existing ? existing.registeredAt : deps.now() };
    await deps.db.putSpace(row);
    return ok(existing ? 200 : 201, { spaceId: row.spaceId, registered: true });
  }

  async function submit(req: Req): Promise<Res> {
    const ip = perIp.take(req.ip);
    if (!ip.ok) return err(429, "rate_limit.exceeded", "Too many requests from this address.", { "retry-after": String(ip.retryAfterSec) });
    if (req.body.length > MAX_BODY) return err(413, "validation.too_large", "The report is over 4 MB.");
    const spaceId = header(req, "x-vyre-space"), ts = header(req, "x-vyre-ts"), sig = header(req, "x-vyre-sig");
    const unauthorized = (): Res => err(401, "auth.unauthenticated", "The request is not signed by a registered Space.");
    if (!SPACE_ID.test(spaceId) || !sig) return unauthorized();
    if (!freshTs(ts)) return err(401, "auth.expired", "The request time is not within five minutes of now.");
    const space = await deps.db.getSpace(spaceId);
    if (!space) return unauthorized();
    if (!(await verify(fromBase64url(space.publicKey), reportMessage(ts, await sha256hex(req.body)), sig))) return unauthorized();
    if (!(await deps.db.firstSight(sig, deps.now() + config.limits.skewMs * 2, deps.now()))) return err(401, "auth.unauthenticated", "That signed request was already used.");
    const lim = perSpace.take(spaceId);
    if (!lim.ok) return err(429, "rate_limit.exceeded", "This Space has sent its reports for the hour.", { "retry-after": String(lim.retryAfterSec) });

    let j: unknown;
    try { j = JSON.parse(new TextDecoder().decode(req.body)); } catch { return err(400, "validation.bad_input", "The body is not JSON."); }
    const parsed = parseReport(j);
    if (!parsed.ok) return err(422, "validation.bad_input", `The report is not valid: ${parsed.field}.`, {}, { field: parsed.field });
    const { reportId, bundle, screenshotPng } = parsed.body;

    let png: Uint8Array | null = null;
    if (screenshotPng !== undefined) {
      try { png = fromBase64url(screenshotPng); } catch { png = null; }
      const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      if (!png || png.length > MAX_SCREENSHOT || !magic.every((b, i) => png?.[i] === b)) return err(422, "validation.bad_input", "The screenshot is not a PNG of at most 2 MB.", {}, { field: "screenshotPng" });
    }

    let row = await deps.db.getReport(reportId);
    if (row && row.spaceId !== spaceId) return err(409, "validation.duplicate", "That report id belongs to another Space.");
    let shot = png !== null;
    if (!row) {
      const note = (bundle.note ?? "").split(/\r?\n/)[0]?.trim() ?? "";
      row = {
        reportId, spaceId, status: "stored", title: (note || `Problem in ${bundle.context.place}`).slice(0, 120), traceIds: bundle.traceIds, issueNumber: null, issueUrl: null,
        teamRecordId: null, viewToken: randomToken(), createdAt: deps.now(), resolvedAt: null, fixedIn: null, notified: false,
      };
      await putObjects(row, bundle, png);
      await deps.db.putReport(row);
    } else {
      shot = (await deps.objects.get(`reports/${reportId}/screenshot.png`)) !== null;
    }
    row = await finish(row, bundle, shot);
    return ok(row.issueNumber === null ? 202 : 201, { reportId, stored: true, issueNumber: row.issueNumber, ...(row.issueUrl ? { issueUrl: row.issueUrl } : {}) });
  }

  async function view(req: Req, reportId: string, what: "screenshot" | "bundle"): Promise<Res> {
    const row = await deps.db.getReport(reportId);
    const token = req.query?.t ?? "";
    if (!row || !token || !safeEqual(row.viewToken, token)) return err(404, "validation.not_found", "There is no such report.");
    const o = await deps.objects.get(`reports/${reportId}/${what === "screenshot" ? "screenshot.png" : "bundle.json"}`);
    if (!o) return err(404, "validation.not_found", "There is no such report.");
    return { status: 200, headers: { "content-type": o.contentType, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" }, body: o.bytes };
  }

  async function githubHook(req: Req): Promise<Res> {
    const want = `sha256=${await hmacHex(config.github.webhookSecret, req.body)}`;
    if (!config.github.webhookSecret || !safeEqual(want, header(req, "x-hub-signature-256"))) return err(401, "auth.unauthenticated", "The webhook signature does not match.");
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder().decode(req.body)); } catch { return err(400, "validation.bad_input", "The body is not JSON."); }
    const closed = closedIssue(header(req, "x-github-event"), payload);
    if (!closed) return ok(200, { ignored: true });
    const row = await deps.db.byIssue(closed.number);
    if (!row) return ok(200, { ignored: true });
    let next: ReportRow = row.status === "resolved" ? row : { ...row, status: "resolved", resolvedAt: deps.now(), fixedIn: closed.fixedIn };
    if (next !== row) await deps.db.putReport(next);
    try { next = await notifySpace(next); } catch (e) { console.error(`reports: ${row.reportId}: ${(e as Error).message}`); }
    return ok(200, { reportId: row.reportId, resolved: true, notified: next.notified });
  }

  async function handle(req: Req): Promise<Res> {
    try {
      const m = req.method.toUpperCase();
      if (m === "GET" && req.path === "/healthz") return ok(200, { ok: true });
      if (m === "GET" && req.path === "/v1/key") return ok(200, { publicKey: base64url(deps.key.publicKey) });
      if (m === "POST" && req.path === "/v1/spaces") return await register(req);
      if (m === "POST" && req.path === "/v1/reports") return await submit(req);
      if (m === "POST" && req.path === "/v1/github/webhook") return await githubHook(req);
      const v = m === "GET" ? /^\/v1\/reports\/(rpt_[a-z0-9]{8,64})\/(screenshot|bundle)$/.exec(req.path) : null;
      if (v?.[1] && (v[2] === "screenshot" || v[2] === "bundle")) return await view(req, v[1], v[2]);
      return err(404, "validation.not_found", "No such route.");
    } catch (e) {
      console.error(`reports: ${(e as Error).message}`);
      return err(500, "internal.unexpected", "The service hit an unexpected error.");
    }
  }

  /** Finish what earlier requests could not: issues not yet opened, records not yet filed, resolved notices not yet delivered. Returns how many reports it touched. */
  async function retryPending(): Promise<number> {
    let touched = 0;
    for (const row of await deps.db.pending()) {
      const b = await loadBundle(row.reportId);
      if (!b) continue;
      const after = await finish(row, b.bundle, b.shot);
      if (after.issueNumber !== row.issueNumber || after.teamRecordId !== row.teamRecordId || after.notified !== row.notified) touched += 1;
    }
    perIp.sweep(); perSpace.sweep(); registerIp.sweep();
    return touched;
  }

  return { handle, retryPending };
}
