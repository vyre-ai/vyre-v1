// campaigns: running a campaign (spec 2.19, 3.6; ARCH 7.6, 8.2): launch, the engine pass, pause, resume, stop, stats, replies, unsubscribe and warmup.
// The engine is Journey-style: each contact walks the step graph and keeps its own due time. A pass (advance) handles the contacts that are due, at most one send each,
// and schedules the next pass through campaigns.resume, so a campaign needs no process of its own. Sends go through mail.send and telephony.send_sms (the single send API),
// which apply suppression, consent and the Gate; this module adds the campaign rules on top: send windows in the recipient's zone, a per-domain hourly throttle,
// per-mailbox warmup caps, stop on reply, the bounce guard, and the unsubscribe link in every email.
// @reads ../migrations/0001_campaigns.sql

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Row, StepOut } from "../projections.ts";
import {
  asMessageId, campaignConfig, campaignOut, domainOf, fail, flag, inWindow, isNull, isRec, many, membersOf, mustCampaign, nextOpen, nid, num, one, optStr, pageOf, parseJson,
  randomToken, rec, render, reqStr, sendsOf, sha256hex, stepsOf, str, windowsOf,
} from "../projections.ts";
import { fieldNames, nextKey, pickVariant, variantsOf } from "./build.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const BATCH = 200;
const MAX_HOPS = 60;
const TICK_IDLE_MS = 15 * MINUTE;
const GUARD_MIN_SENDS = 20;
const GUARD_RATE_BP = 500;
const RAMP = [5, 10, 15, 25, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220];
const READY_CAP = 250;
const READY_AFTER_DAYS = 14;
const BOUNCE_LIMIT_BP = 500;
const SPAM_LIMIT_BP = 30;
const BUMP_STATES = ["sent", "queued", "held", "delivered", "bounced", "complained"];

// ---- warmup --------------------------------------------------------------------------------------------------------

function warmupStage(w: Row, now: number): "new" | "warming" | "ready" | "slowed" {
  if (w.stage === "slowed") return "slowed";
  const days = Math.floor((now - num(w.started_at)) / DAY);
  if (days >= READY_AFTER_DAYS) return "ready";
  return days < 1 ? "new" : "warming";
}

/** The most one mailbox may send per day while it warms up. A ready mailbox has no warmup cap in this module. */
export function warmupCap(w: Row, now: number): number {
  const days = Math.max(0, Math.floor((now - num(w.started_at)) / DAY));
  const ramp = RAMP[Math.min(days, RAMP.length - 1)] ?? READY_CAP;
  if (w.stage === "slowed") return Math.max(2, Math.floor(ramp / 2));
  return days >= READY_AFTER_DAYS ? READY_CAP : ramp;
}

async function warmupStatus(ctx: Ctx) {
  const now = ctx.now();
  const rows = many(ctx, "SELECT * FROM campaigns_warmup").sort((a, b) => str(a.mailbox_id).localeCompare(str(b.mailbox_id)));
  return {
    mailboxes: rows.map((w) => ({
      mailboxId: str(w.mailbox_id), stage: warmupStage(w, now), dailyCap: warmupCap(w, now), bounceRate: num(w.bounce_bp) / 10000, replyRate: num(w.reply_bp) / 10000,
    })),
  };
}

async function warmupStart(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const mailboxId = reqStr(ctx, o, "mailboxId");
  if (!one(ctx, "SELECT * FROM campaigns_warmup WHERE mailbox_id = ?", mailboxId)) {
    await ctx.call("mail.mailbox.get", { mailboxId });
    ctx.db.run("INSERT INTO campaigns_warmup (mailbox_id, stage, started_at, bounce_bp, reply_bp, spam_bp, slowed_reason, slowed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", mailboxId, "new", ctx.now(), 0, 0, 0, null, null);
  }
  return { ok: true };
}

/**
 * The warmup client reports a mailbox's health. Bounces or spam placement above the limit slow the mailbox (half the ramp) and announce it once;
 * rates back under half the limits release it. Rates are fractions from 0 to 1.
 */
export function recordWarmupHealth(ctx: Ctx, mailboxId: string, h: { bounceRate: number; replyRate: number; spamRate: number }): "slowed" | "released" | "unchanged" {
  const w = one(ctx, "SELECT * FROM campaigns_warmup WHERE mailbox_id = ?", mailboxId);
  if (!w) return "unchanged";
  const bp = (x: number): number => Math.max(0, Math.min(10000, Math.round(x * 10000)));
  const bounce = bp(h.bounceRate);
  const spam = bp(h.spamRate);
  ctx.db.run("UPDATE campaigns_warmup SET bounce_bp = ?, reply_bp = ?, spam_bp = ? WHERE mailbox_id = ?", bounce, bp(h.replyRate), spam, mailboxId);
  if (w.stage !== "slowed" && (bounce > BOUNCE_LIMIT_BP || spam > SPAM_LIMIT_BP)) {
    const reason = bounce > BOUNCE_LIMIT_BP ? `bounce rate ${(bounce / 100).toFixed(1)} percent` : `spam placement ${(spam / 100).toFixed(1)} percent`;
    ctx.db.run("UPDATE campaigns_warmup SET stage = ?, slowed_reason = ?, slowed_at = ? WHERE mailbox_id = ?", "slowed", reason, ctx.now(), mailboxId);
    ctx.emit("warmup.slowed", `mailbox/${mailboxId}`, { mailboxId, reason });
    return "slowed";
  }
  if (w.stage === "slowed" && bounce <= BOUNCE_LIMIT_BP / 2 && spam <= SPAM_LIMIT_BP / 2) {
    ctx.db.run("UPDATE campaigns_warmup SET stage = ?, slowed_reason = ?, slowed_at = ? WHERE mailbox_id = ?", "warming", null, null, mailboxId);
    return "released";
  }
  return "unchanged";
}

async function poolOptinSet(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  if (typeof o.optIn !== "boolean") fail(ctx, "validation.bad_input", "optIn is true or false.", { field: "optIn" });
  if (one(ctx, "SELECT * FROM campaigns_setting WHERE key = ?", "warmup_pool_optin")) ctx.db.run("UPDATE campaigns_setting SET value = ? WHERE key = ?", o.optIn ? "1" : "0", "warmup_pool_optin");
  else ctx.db.run("INSERT INTO campaigns_setting (key, value) VALUES (?, ?)", "warmup_pool_optin", o.optIn ? "1" : "0");
  return { optIn: o.optIn };
}

/** Whether the Space shares the warmup pool. Off until someone opts in. */
export function poolOptedIn(ctx: Ctx): boolean {
  return one(ctx, "SELECT * FROM campaigns_setting WHERE key = ?", "warmup_pool_optin")?.value === "1";
}

// ---- the engine -----------------------------------------------------------------------------------------------------

export interface PassResult {
  sent: number;
  /** earliest time something is due, or null when nothing is */
  nextAt: number | null;
}

interface Pass {
  ctx: Ctx;
  row: Row;
  steps: StepOut[];
  now: number;
  mailboxes: Map<string, string>;
  sends: Row[];
  sent: number;
}

async function mailboxAddress(p: Pass, mailboxId: string): Promise<string> {
  const have = p.mailboxes.get(mailboxId);
  if (have !== undefined) return have;
  const res = (await p.ctx.call("mail.mailbox.get", { mailboxId })) as { mailbox?: { address?: unknown } };
  const address = typeof res.mailbox?.address === "string" ? res.mailbox.address : "";
  p.mailboxes.set(mailboxId, address);
  return address;
}

/** The record type of the audience: chosen with the audience, else the type a trigger names. */
function recordTypeOf(row: Row): string {
  if (!isNull(row.audience_type)) return str(row.audience_type);
  const s = parseJson(row.settings);
  return isRec(s) && isRec(s.trigger) ? str(s.trigger.type) : "";
}

function setMember(ctx: Ctx, id: string, cols: Record<string, unknown>): void {
  const keys = Object.keys(cols);
  ctx.db.run(`UPDATE campaigns_member SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => cols[k]), id);
}

/** A plain-text version of an HTML body: tags out, a few entities back, whitespace tidied. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/li)\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function unsubscribeLine(ctx: Ctx, url: string): { text: string; html: string } {
  void ctx;
  return { text: `\n\nTo stop these emails: ${url}`, html: `<p style="font-size:12px;color:#666"><a href="${url}">Unsubscribe</a></p>` };
}

async function sendEmail(p: Pass, m: Row, cfg: Record<string, unknown>, fields: Record<string, unknown>): Promise<{ status: string; ref: string | null; domain: string }> {
  const { ctx } = p;
  const mailboxId = str(cfg.mailboxId);
  const token = randomToken();
  const base = (campaignConfig().publicBase ?? "").replace(/\/+$/, "");
  const url = `${base}/u/${token}`;
  const foot = unsubscribeLine(ctx, url);
  const body: Record<string, unknown> = {
    mailboxId, to: [{ address: str(m.address), ...(typeof fields.name === "string" && fields.name ? { name: fields.name } : {}), contactId: str(m.record_id) }],
    subject: render(str(cfg.subject), fields), contactId: str(m.record_id), campaignId: str(p.row.id),
  };
  // Every email has a plain-text part: the author's text, or the HTML with its tags removed.
  const html = str(cfg.html) !== "" ? render(str(cfg.html), fields) : "";
  const text = str(cfg.text) !== "" ? render(str(cfg.text), fields) : htmlToText(html);
  body.text = text + foot.text;
  if (html !== "") body.html = html + foot.html;
  // the token is stored before the send so a link in a delivered email always resolves
  ctx.db.run("INSERT INTO campaigns_unsub (token_hash, campaign_id, member_id, address, used_at) VALUES (?, ?, ?, ?, ?)", await sha256hex(token), str(p.row.id), str(m.id), str(m.address), null);
  const res = (await ctx.call("mail.send", body)) as { status?: unknown; messageId?: unknown };
  return { status: str(res.status) || "sent", ref: typeof res.messageId === "string" ? res.messageId : null, domain: domainOf(await mailboxAddress(p, mailboxId)) };
}

async function sendSms(p: Pass, m: Row, cfg: Record<string, unknown>, fields: Record<string, unknown>): Promise<{ status: string; ref: string | null }> {
  let text = render(str(cfg.body), fields);
  if (!/\bSTOP\b/i.test(text)) text += " Reply STOP to opt out.";
  const res = (await p.ctx.call("telephony.send_sms", { numberId: str(cfg.numberId), to: str(m.phone), body: text, contactId: str(m.record_id), campaignId: str(p.row.id) })) as { status?: unknown; smsId?: unknown };
  return { status: str(res.status) || "sent", ref: typeof res.smsId === "string" ? res.smsId : null };
}

function recentSends(p: Pass, since: number, domain?: string, mailboxId?: string): Row[] {
  return p.sends.filter((s) => num(s.at) > since && BUMP_STATES.includes(str(s.status)) && (domain === undefined || s.domain === domain) && (mailboxId === undefined || s.mailbox_id === mailboxId));
}

/** Handle one contact: walk quiet steps (wait, branch, task) and stop at the first send, wait or block. */
async function walk(p: Pass, m: Row): Promise<void> {
  const { ctx, row } = p;
  const windows = windowsOf(row);
  const stopOnReply = flag(row.stop_on_reply);
  const variants = variantsOf(ctx, str(row.id));
  let key = isNull(m.step_key) ? (p.steps[0]?.key ?? null) : str(m.step_key);
  let fields: Record<string, unknown> | null = null;
  const load = async (): Promise<Record<string, unknown>> => {
    if (fields) return fields;
    const type = recordTypeOf(row);
    try {
      const got = (await ctx.call("records.get", { type, recordId: str(m.record_id) })) as { record?: { fields?: unknown } };
      fields = isRec(got.record?.fields) ? got.record.fields : {};
    } catch (e) {
      ctx.log.warn("campaigns: could not read a contact", { campaign: str(row.id), record: str(m.record_id), error: e instanceof Error ? e.message : String(e) });
      fields = {};
    }
    return fields;
  };

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const i = p.steps.findIndex((s) => s.key === key);
    const step = p.steps[i];
    if (!step) {
      setMember(ctx, str(m.id), { state: "completed", step_key: null, due_at: null });
      return;
    }
    const replied = !isNull(m.replied_at);
    if (step.type === "wait") {
      const c = step.config;
      const ms = typeof c.minutes === "number" ? c.minutes * MINUTE : typeof c.hours === "number" ? c.hours * HOUR : num(c.days) * DAY;
      const to = nextKey(p.steps, i);
      setMember(ctx, str(m.id), to === null ? { state: "completed", step_key: null, due_at: null } : { step_key: to, due_at: p.now + ms });
      return;
    }
    if (step.type === "branch") {
      const on = str(step.config.on);
      const yes = on === "open" ? flag(m.opened) : on === "click" ? flag(m.clicked) : replied;
      key = nextKey(p.steps, i, yes);
      setMember(ctx, str(m.id), { step_key: key });
      if (key === null) {
        setMember(ctx, str(m.id), { state: "completed", due_at: null });
        return;
      }
      continue;
    }
    if (step.type === "task" || step.type === "call_task") {
      const f = await load();
      const assigned = isRec(step.config.assigned) ? step.config.assigned : { kind: "person", id: str(row.owner) };
      await ctx.call("tasks.create", {
        title: `${step.type === "call_task" ? "Call: " : ""}${render(str(step.config.title), f)}`, assigned, recordId: str(m.record_id), source: { kind: "manual", id: str(row.id) },
      });
      key = nextKey(p.steps, i);
      setMember(ctx, str(m.id), key === null ? { state: "completed", step_key: null, due_at: null } : { step_key: key });
      if (key === null) return;
      continue;
    }

    // email or sms
    if (replied && stopOnReply) {
      setMember(ctx, str(m.id), { state: "replied", due_at: null });
      return;
    }
    const tz = str(m.tz) || windows.tz;
    if (!inWindow(p.now, windows, tz)) {
      setMember(ctx, str(m.id), { step_key: step.key, due_at: nextOpen(p.now, windows, tz) });
      return;
    }
    const channel = step.type === "email" ? "email" : "sms";
    if (channel === "email" ? str(m.address) === "" : str(m.phone) === "") {
      setMember(ctx, str(m.id), { state: "failed", due_at: null });
      return;
    }
    let domain = "";
    const mailboxId = channel === "email" ? str(step.config.mailboxId) : "";
    if (channel === "email") {
      const w = one(ctx, "SELECT * FROM campaigns_warmup WHERE mailbox_id = ?", mailboxId);
      if (w && warmupStage(w, p.now) !== "ready") {
        const today = recentSends(p, p.now - DAY, undefined, mailboxId);
        if (today.length >= warmupCap(w, p.now)) {
          const oldest = Math.min(...today.map((s) => num(s.at)));
          setMember(ctx, str(m.id), { step_key: step.key, due_at: oldest + DAY });
          return;
        }
      }
      domain = domainOf(await mailboxAddress(p, mailboxId));
      const cap = row.throttle_per_hour === null || row.throttle_per_hour === undefined ? 0 : num(row.throttle_per_hour);
      if (cap > 0 && domain !== "") {
        const hour = recentSends(p, p.now - HOUR, domain);
        if (hour.length >= cap) {
          const oldest = Math.min(...hour.map((s) => num(s.at)));
          setMember(ctx, str(m.id), { step_key: step.key, due_at: oldest + HOUR });
          return;
        }
      }
    }
    const f = await load();
    const variant = variants.find((v) => v.stepKey === step.key && v.key === str(m.variant));
    const cfg = { ...step.config, ...(variant ? variant.config : {}) };
    let status: string;
    let ref: string | null;
    try {
      if (channel === "email") {
        const r = await sendEmail(p, m, cfg, f);
        status = r.status;
        ref = r.ref;
        domain = r.domain || domain;
      } else {
        const r = await sendSms(p, m, cfg, f);
        status = r.status;
        ref = r.ref;
      }
    } catch (e) {
      if (e instanceof VyreErr && e.error.retryable) {
        ctx.log.warn("campaigns: a send will be retried", { campaign: str(row.id), code: e.error.code });
        setMember(ctx, str(m.id), { step_key: step.key, due_at: p.now + 15 * MINUTE });
        return;
      }
      ctx.log.warn("campaigns: a send failed for good", { campaign: str(row.id), error: e instanceof Error ? e.message : String(e) });
      setMember(ctx, str(m.id), { state: "failed", due_at: null });
      return;
    }
    const sendRow = { id: nid(ctx, "snd"), campaign_id: str(row.id), member_id: str(m.id), step_key: step.key, channel, mailbox_id: mailboxId || null, domain: domain || null, message_ref: ref, status, at: p.now };
    ctx.db.run(
      "INSERT INTO campaigns_send (id, campaign_id, member_id, step_key, channel, mailbox_id, domain, message_ref, status, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      sendRow.id, sendRow.campaign_id, sendRow.member_id, sendRow.step_key, sendRow.channel, sendRow.mailbox_id, sendRow.domain, sendRow.message_ref, sendRow.status, sendRow.at,
    );
    p.sends.push(sendRow);
    if (status === "suppressed") {
      setMember(ctx, str(m.id), { state: "suppressed", due_at: null });
      return;
    }
    p.sent += 1;
    const to = nextKey(p.steps, i);
    setMember(ctx, str(m.id), {
      sent_count: num(m.sent_count) + 1, last_sent_at: p.now, ...(to === null ? { state: "completed", step_key: null, due_at: null } : { step_key: to, due_at: p.now }),
    });
    return;
  }
  setMember(ctx, str(m.id), { state: "failed", due_at: null });
  ctx.log.warn("campaigns: a contact hit the step limit", { campaign: str(row.id), record: str(m.record_id) });
}

/** Screen contacts a trigger enrolled: resolve their address, apply Do-not-contact (adds only) and the suppression list, and start the ones that pass. */
async function screenTriggered(p: Pass): Promise<void> {
  const { ctx, row } = p;
  const pending = membersOf(ctx, str(row.id)).filter((m) => m.state === "screening").slice(0, BATCH);
  if (pending.length === 0) return;
  const settings = parseJson(row.settings);
  const trigger = isRec(settings) && isRec(settings.trigger) ? settings.trigger : {};
  const type = str(trigger.type);
  const names = fieldNames(row);
  const found: { m: Row; email: string; phone: string; tz: string }[] = [];
  for (const m of pending) {
    let fields: Record<string, unknown> = {};
    try {
      const got = (await ctx.call("records.get", { type, recordId: str(m.record_id) })) as { record?: { fields?: unknown } };
      if (isRec(got.record?.fields)) fields = got.record.fields;
    } catch {
      setMember(ctx, str(m.id), { state: "failed", due_at: null });
      continue;
    }
    const email = typeof fields[names.email] === "string" ? (fields[names.email] as string).trim().toLowerCase() : "";
    const phone = typeof fields[names.phone] === "string" ? (fields[names.phone] as string).trim() : "";
    if (!email && !phone) {
      setMember(ctx, str(m.id), { state: "failed", due_at: null });
      continue;
    }
    found.push({ m, email, phone, tz: typeof fields[names.tz] === "string" ? (fields[names.tz] as string) : "" });
  }
  if (found.length === 0) return;
  const res = (await ctx.call("contacts.dnd_screen", {
    context: "campaign", contextId: str(row.id),
    candidates: found.map((f) => ({ ref: str(f.m.record_id), contactId: str(f.m.record_id), ...(f.email ? { email: f.email } : {}), ...(f.phone ? { phone: f.phone } : {}) })),
  })) as { allowed?: unknown };
  const allowed = new Set(Array.isArray(res.allowed) ? res.allowed.filter((a): a is string => typeof a === "string") : []);
  const blocked = new Set<string>();
  const emails = found.filter((f) => allowed.has(str(f.m.record_id)) && f.email).map((f) => f.email);
  if (emails.length > 0) {
    const sup = (await ctx.call("contacts.suppression.check", { channel: "email", addresses: emails })) as { suppressed?: unknown };
    for (const s of Array.isArray(sup.suppressed) ? sup.suppressed : []) if (isRec(s) && typeof s.address === "string") blocked.add(s.address.toLowerCase());
  }
  const variants = variantsOf(ctx, str(row.id));
  for (const f of found) {
    if (!allowed.has(str(f.m.record_id)) || (f.email && blocked.has(f.email))) {
      setMember(ctx, str(f.m.id), { state: "suppressed", due_at: null });
      continue;
    }
    setMember(ctx, str(f.m.id), {
      address: f.email || null, phone: f.phone || null, tz: f.tz && f.tz.length > 0 ? f.tz : null, variant: pickVariant(variants, str(row.id), str(f.m.record_id)),
      state: "active", step_key: p.steps[0]?.key ?? null, due_at: p.now,
    });
  }
}

/**
 * One engine pass over a running campaign. Safe to call at any time and as often as wanted: a contact is touched only when it is due.
 * The host's scheduler calls it through campaigns.resume; launch, resume and the tests call it directly.
 */
export async function advance(ctx: Ctx, campaignId: string): Promise<PassResult> {
  let row = mustCampaign(ctx, campaignId);
  if (row.state === "scheduled") {
    const s = parseJson(row.settings);
    const startAt = isRec(s) && typeof s.startAt === "number" ? s.startAt : 0;
    if (ctx.now() < startAt) return { sent: 0, nextAt: startAt };
    ctx.db.run("UPDATE campaigns_campaign SET state = ?, updated_at = ? WHERE id = ?", "running", ctx.now(), campaignId);
    row = mustCampaign(ctx, campaignId);
  }
  if (row.state !== "running") return { sent: 0, nextAt: null };
  const now = ctx.now();
  const p: Pass = { ctx, row, steps: stepsOf(ctx, campaignId), now, mailboxes: new Map(), sends: many(ctx, "SELECT * FROM campaigns_send"), sent: 0 };
  const stopOnReply = flag(row.stop_on_reply);

  // replies: announce once; stop on reply ends the contact's path
  for (const m of membersOf(ctx, campaignId)) {
    if (isNull(m.replied_at)) continue;
    if (!flag(m.reply_announced)) {
      const r = many(ctx, "SELECT * FROM campaigns_reply WHERE campaign_id = ?", campaignId).filter((x) => x.record_id === m.record_id).sort((a, b) => num(a.at) - num(b.at))[0];
      if (r) ctx.emit("campaign.replied", `campaign/${campaignId}`, { campaignId, recordId: str(m.record_id), messageId: asMessageId(str(r.message_ref)) });
      setMember(ctx, str(m.id), { reply_announced: 1 });
    }
    if (stopOnReply && (m.state === "active" || m.state === "screening")) setMember(ctx, str(m.id), { state: "replied", due_at: null });
  }

  // bounce guard: a campaign that bounces or draws complaints pauses itself
  const mine = sendsOf(ctx, campaignId).filter((s) => BUMP_STATES.includes(str(s.status)));
  const bad = mine.filter((s) => s.status === "bounced" || s.status === "complained").length;
  if (mine.length >= GUARD_MIN_SENDS && (bad * 10000) / mine.length > GUARD_RATE_BP) {
    const reason = `${bad} of ${mine.length} sends bounced or drew complaints`;
    ctx.db.run("UPDATE campaigns_campaign SET state = ?, pause_reason = ?, updated_at = ? WHERE id = ?", "paused", reason, now, campaignId);
    ctx.emit("campaign.paused", `campaign/${campaignId}`, { campaignId, reason });
    return { sent: 0, nextAt: null };
  }

  if (row.kind === "triggered") await screenTriggered(p);

  const due = membersOf(ctx, campaignId)
    .filter((m) => m.state === "active" && !isNull(m.due_at) && num(m.due_at) <= now)
    .sort((a, b) => num(a.due_at) - num(b.due_at) || str(a.id).localeCompare(str(b.id)))
    .slice(0, campaignConfig().batch ?? BATCH);
  for (const m of due) {
    const fresh = one(ctx, "SELECT * FROM campaigns_member WHERE id = ?", str(m.id));
    if (fresh && fresh.state === "active") await walk(p, fresh);
  }

  const left = membersOf(ctx, campaignId).filter((m) => m.state === "active" || m.state === "screening");
  if (left.length === 0 && row.kind !== "triggered") {
    ctx.db.run("UPDATE campaigns_campaign SET state = ?, completed_at = ?, updated_at = ? WHERE id = ?", "completed", now, now, campaignId);
    ctx.emit("campaign.completed", `campaign/${campaignId}`, { campaignId });
    return { sent: p.sent, nextAt: null };
  }
  const times = left.map((m) => (m.state === "screening" ? now : num(m.due_at))).filter((t) => t > 0);
  const nextAt = times.length > 0 ? Math.min(...times) : null;
  return { sent: p.sent, nextAt: row.kind === "triggered" ? Math.min(nextAt ?? now + TICK_IDLE_MS, now + TICK_IDLE_MS) : nextAt };
}

async function schedulePass(ctx: Ctx, campaignId: string, at: number | null): Promise<void> {
  if (at === null) return;
  // never sooner than a minute from now: a pass that finds work due right away has already done it
  await ctx.schedule(Math.max(at, ctx.now() + MINUTE), "campaigns.resume", { campaignId });
}

// ---- capabilities -----------------------------------------------------------------------------------------------------

async function launch(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const row = mustCampaign(ctx, reqStr(ctx, o, "campaignId"));
  if (row.state !== "draft") fail(ctx, "validation.precondition_failed", "Only a draft campaign can be launched.");
  const steps = stepsOf(ctx, str(row.id));
  if (steps.length === 0) fail(ctx, "validation.precondition_failed", "Add steps before launching.");
  if (!steps.some((s) => s.type === "email" || s.type === "sms")) fail(ctx, "validation.precondition_failed", "A campaign needs an email or SMS step.");
  const members = membersOf(ctx, str(row.id)).filter((m) => m.state === "active");
  if (members.length === 0 && row.kind !== "triggered") fail(ctx, "validation.precondition_failed", "Choose an audience before launching.");
  const settings = parseJson(row.settings);
  if (row.kind === "triggered" && !(isRec(settings) && isRec(settings.trigger))) fail(ctx, "validation.precondition_failed", "A triggered campaign needs a trigger: a record event and a record type.");
  const now = ctx.now();
  const startAt = isRec(settings) && typeof settings.startAt === "number" && settings.startAt > now ? settings.startAt : now;
  const variants = variantsOf(ctx, str(row.id));
  for (const m of members) {
    setMember(ctx, str(m.id), { step_key: steps[0]?.key ?? null, due_at: startAt, variant: isNull(m.variant) ? pickVariant(variants, str(row.id), str(m.record_id)) : m.variant });
  }
  const runId = nid(ctx, "run");
  const state = startAt > now ? "scheduled" : "running";
  ctx.db.run("UPDATE campaigns_campaign SET state = ?, run_id = ?, launched_at = ?, pause_reason = ?, updated_at = ? WHERE id = ?", state, runId, now, null, now, str(row.id));
  ctx.emit("campaign.launched", `campaign/${str(row.id)}`, { campaignId: str(row.id), audienceCount: members.length });
  const res = await advance(ctx, str(row.id));
  await schedulePass(ctx, str(row.id), state === "scheduled" ? startAt : res.nextAt);
  return { runId };
}

async function pause(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const row = mustCampaign(ctx, reqStr(ctx, o, "campaignId"));
  if (row.state !== "running" && row.state !== "scheduled") fail(ctx, "validation.precondition_failed", "Only a running campaign can be paused.");
  const reason = optStr(ctx, o, "reason")?.trim() || "Paused by a person";
  ctx.db.run("UPDATE campaigns_campaign SET state = ?, pause_reason = ?, updated_at = ? WHERE id = ?", "paused", reason, ctx.now(), str(row.id));
  ctx.emit("campaign.paused", `campaign/${str(row.id)}`, { campaignId: str(row.id), reason });
  return { campaign: campaignOut(ctx, mustCampaign(ctx, str(row.id))) };
}

/** Resume a paused campaign. The scheduler also calls this as the tick of a running one, which then just runs a pass. */
async function resume(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const row = mustCampaign(ctx, reqStr(ctx, o, "campaignId"));
  if (row.state === "draft") fail(ctx, "validation.precondition_failed", "Launch the campaign first.");
  if (row.state === "stopped" || row.state === "completed") return { campaign: campaignOut(ctx, row) };
  if (row.state === "paused") {
    ctx.db.run("UPDATE campaigns_campaign SET state = ?, pause_reason = ?, updated_at = ? WHERE id = ?", "running", null, ctx.now(), str(row.id));
    // contacts that came due while paused go on from now, not in a burst of overdue sends beyond the window and throttle rules
  }
  const res = await advance(ctx, str(row.id));
  await schedulePass(ctx, str(row.id), res.nextAt);
  return { campaign: campaignOut(ctx, mustCampaign(ctx, str(row.id))) };
}

async function stop(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const row = mustCampaign(ctx, reqStr(ctx, o, "campaignId"));
  if (row.state === "draft") fail(ctx, "validation.precondition_failed", "A draft has nothing to stop. Delete it instead.");
  if (row.state !== "stopped" && row.state !== "completed") {
    for (const m of membersOf(ctx, str(row.id))) if (m.state === "active" || m.state === "screening") setMember(ctx, str(m.id), { state: "stopped", due_at: null });
    ctx.db.run("UPDATE campaigns_campaign SET state = ?, completed_at = ?, updated_at = ? WHERE id = ?", "stopped", ctx.now(), ctx.now(), str(row.id));
  }
  return { campaign: campaignOut(ctx, mustCampaign(ctx, str(row.id))) };
}

async function stats(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const row = mustCampaign(ctx, reqStr(ctx, o, "campaignId"));
  const sends = sendsOf(ctx, str(row.id)).filter((s) => BUMP_STATES.includes(str(s.status)));
  const members = membersOf(ctx, str(row.id));
  const count = (...st: string[]): number => sends.filter((s) => st.includes(str(s.status))).length;
  return {
    sent: sends.length, delivered: count("delivered", "complained"), bounced: count("bounced"), complained: count("complained"),
    replied: members.filter((m) => !isNull(m.replied_at)).length, unsubscribed: members.filter((m) => m.state === "unsubscribed").length,
  };
}

async function replies(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const row = mustCampaign(ctx, reqStr(ctx, o, "campaignId"));
  const { offset, limit } = pageOf(ctx, o);
  const all = many(ctx, "SELECT * FROM campaigns_reply WHERE campaign_id = ?", str(row.id)).sort((a, b) => num(b.at) - num(a.at) || str(b.id).localeCompare(str(a.id)));
  const out: { replies: { recordId: string; messageId: string; at: number }[]; next?: string; total: number } = {
    replies: all.slice(offset, offset + limit).map((r) => ({ recordId: str(r.record_id), messageId: asMessageId(str(r.message_ref)), at: num(r.at) })), total: all.length,
  };
  if (offset + limit < all.length) out.next = String(offset + limit);
  return out;
}

/** An unsubscribe link: the contact leaves every running campaign, the address goes on the suppression list, and the campaign announces it once. */
async function unsubscribe(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const token = reqStr(ctx, o, "token");
  if (token.length > 200) fail(ctx, "auth.invalid_code", "That link is not valid.");
  const t = one(ctx, "SELECT * FROM campaigns_unsub WHERE token_hash = ?", await sha256hex(token));
  if (!t) fail(ctx, "auth.invalid_code", "That link is not valid.");
  if (!isNull(t.used_at)) return { ok: true };
  const now = ctx.now();
  ctx.db.run("UPDATE campaigns_unsub SET used_at = ? WHERE token_hash = ?", now, str(t.token_hash));
  const address = str(t.address);
  await ctx.call("contacts.apply_optout", { channel: "email", address, keyword: "UNSUBSCRIBE", source: "link", at: now });
  const mine = one(ctx, "SELECT * FROM campaigns_member WHERE id = ?", str(t.member_id));
  for (const m of many(ctx, "SELECT * FROM campaigns_member").filter((x) => str(x.address).toLowerCase() === address.toLowerCase())) {
    if (m.state === "active" || m.state === "screening" || m.id === t.member_id) setMember(ctx, str(m.id), { state: "unsubscribed", due_at: null });
  }
  ctx.emit("campaign.unsubscribed", `campaign/${str(t.campaign_id)}`, { campaignId: str(t.campaign_id), recordId: mine ? str(mine.record_id) : "" });
  return { ok: true };
}

export const sendHandlers = {
  "campaigns.launch": (ctx: Ctx, input: unknown) => launch(ctx, input),
  "campaigns.pause": (ctx: Ctx, input: unknown) => pause(ctx, input),
  "campaigns.resume": (ctx: Ctx, input: unknown) => resume(ctx, input),
  "campaigns.stop": (ctx: Ctx, input: unknown) => stop(ctx, input),
  "campaigns.stats": (ctx: Ctx, input: unknown) => stats(ctx, input),
  "campaigns.replies": (ctx: Ctx, input: unknown) => replies(ctx, input),
  "campaigns.unsubscribe": (ctx: Ctx, input: unknown) => unsubscribe(ctx, input),
  "warmup.status": (ctx: Ctx, _input: unknown) => warmupStatus(ctx),
  "warmup.start": (ctx: Ctx, input: unknown) => warmupStart(ctx, input),
  "warmup.pool_optin_set": (ctx: Ctx, input: unknown) => poolOptinSet(ctx, input),
};
