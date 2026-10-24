// campaigns: building a campaign (spec 2.19, 3.6; ARCH 7.6, 8.2): the definition, the audience from a record view, steps, A/B variants, send windows, preview and the link builder.
// The audience adds contacts and never removes any: every new add goes through Do-not-contact screening (contacts.dnd_screen) and the suppression list.
// Steps form a small graph (email, wait, branch on open/click, SMS, task, call task); a loop is refused because it would send forever.
// Running the campaign is send.ts.
// @reads ../migrations/0001_campaigns.sql

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { Row, StepOut, StepType } from "../projections.ts";
import {
  DEFAULT_WINDOWS, bucket, campaignOut, fail, flag, isNull, isRec, many, membersOf, mustCampaign, nid, num, one, optInt, optStr, pageOf, parseJson, rec, render,
  reqStr, stepsOf, str, validZone,
} from "../projections.ts";

const KINDS = ["one_time", "sequence", "triggered"];
const STEP_TYPES: StepType[] = ["email", "wait", "branch", "sms", "task", "call_task"];
const KEY = /^[a-z][a-z0-9_-]{0,39}$/;
const NAME_MAX = 120;
const MAX_STEPS = 50;
const MAX_AUDIENCE = 5000;
const PAGE = 500;
const SETTINGS_MAX = 20_000;
const SECTIONS = ["personal", "shared", "space"];
const EDITABLE = ["draft", "scheduled", "paused"];

export interface FieldNames {
  email: string;
  phone: string;
  tz: string;
}

export function fieldNames(row: Row): FieldNames {
  const s = parseJson(row.settings);
  const pick = (k: string, d: string): string => (isRec(s) && typeof s[k] === "string" && (s[k] as string).length > 0 ? (s[k] as string) : d);
  return { email: pick("emailField", "email"), phone: pick("phoneField", "phone"), tz: pick("tzField", "timezone") };
}

export function variantsOf(ctx: Ctx, campaignId: string): { key: string; weight: number; stepKey: string; config: Record<string, unknown> }[] {
  return many(ctx, "SELECT * FROM campaigns_variant WHERE campaign_id = ?", campaignId)
    .sort((a, b) => str(a.key).localeCompare(str(b.key)))
    .map((v) => {
      const c = parseJson(v.config);
      return { key: str(v.key), weight: num(v.weight), stepKey: str(v.step_key), config: isRec(c) ? c : {} };
    });
}

/** A stable weighted pick: the same contact in the same campaign always lands on the same variant. */
export function pickVariant(variants: { key: string; weight: number }[], campaignId: string, recordId: string): string | null {
  const total = variants.reduce((a, v) => a + v.weight, 0);
  if (variants.length === 0 || total <= 0) return null;
  let n = bucket(`${campaignId}|${recordId}`, total);
  for (const v of variants) {
    if (n < v.weight) return v.key;
    n -= v.weight;
  }
  return variants[variants.length - 1]?.key ?? null;
}

// ---- definition -------------------------------------------------------------------------------------------------

async function create(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const name = reqStr(ctx, o, "name").trim();
  const kind = reqStr(ctx, o, "kind");
  if (name.length === 0 || name.length > NAME_MAX) fail(ctx, "validation.bad_input", "Give the campaign a name.", { field: "name" });
  if (!KINDS.includes(kind)) fail(ctx, "validation.bad_input", "A campaign is one_time, sequence or triggered.", { field: "kind" });
  const id = nid(ctx, "cmp");
  const now = ctx.now();
  ctx.db.run(
    "INSERT INTO campaigns_campaign (id, name, kind, state, owner, section, folder_id, audience_type, audience_view_id, audience_filter, excluded, settings, windows, throttle_per_hour, stop_on_reply, run_id, pause_reason, created_at, updated_at, launched_at, completed_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, name, kind, "draft", ctx.principal.id, "space", null, null, null, null, 0, "{}", null, null, 1, null, null, now, now, null, null, null,
  );
  return { campaign: campaignOut(ctx, mustCampaign(ctx, id)) };
}

async function get(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const row = mustCampaign(ctx, reqStr(ctx, o, "campaignId"));
  const out: Record<string, unknown> = { campaign: campaignOut(ctx, row), steps: stepsOf(ctx, str(row.id)) };
  if (!isNull(row.audience_view_id)) out.audienceViewId = str(row.audience_view_id);
  const w = parseJson(row.windows);
  if (w !== undefined) out.windows = w;
  if (!isNull(row.throttle_per_hour)) out.throttle = { perHour: num(row.throttle_per_hour), stopOnReply: flag(row.stop_on_reply) };
  else out.throttle = { stopOnReply: flag(row.stop_on_reply) };
  const variants = variantsOf(ctx, str(row.id));
  if (variants.length > 0) out.variants = variants;
  return out;
}

async function list(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const section = optStr(ctx, o, "section");
  const folderId = optStr(ctx, o, "folderId");
  if (section !== undefined && !SECTIONS.includes(section)) fail(ctx, "validation.bad_input", "That section is not known.", { field: "section" });
  const { offset, limit } = pageOf(ctx, o);
  const rows = many(ctx, "SELECT * FROM campaigns_campaign")
    .filter((r) => isNull(r.deleted_at) && (section === undefined || r.section === section) && (folderId === undefined || r.folder_id === folderId))
    .sort((a, b) => num(b.created_at) - num(a.created_at) || str(b.id).localeCompare(str(a.id)));
  const out: { campaigns: ReturnType<typeof campaignOut>[]; next?: string; total: number } = { campaigns: rows.slice(offset, offset + limit).map((r) => campaignOut(ctx, r)), total: rows.length };
  if (offset + limit < rows.length) out.next = String(offset + limit);
  return out;
}

function checkTrigger(ctx: Ctx, t: unknown): void {
  if (!isRec(t)) fail(ctx, "validation.bad_input", "The trigger needs a record type.", { field: "settings.trigger" });
  if (typeof t.type !== "string" || !/^[a-z][a-z0-9_]*$/.test(t.type)) fail(ctx, "validation.bad_input", "The trigger needs a record type.", { field: "settings.trigger.type" });
  if (t.event !== undefined && t.event !== "record.created" && t.event !== "record.updated") fail(ctx, "validation.bad_input", "A trigger is record.created or record.updated.", { field: "settings.trigger.event" });
}

async function update(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const row = mustCampaign(ctx, reqStr(ctx, o, "campaignId"));
  const sets: [string, unknown][] = [];
  const name = optStr(ctx, o, "name");
  if (name !== undefined) {
    if (name.trim().length === 0 || name.length > NAME_MAX) fail(ctx, "validation.bad_input", "Give the campaign a name.", { field: "name" });
    sets.push(["name", name.trim()]);
  }
  if (o.settings !== undefined && o.settings !== null) {
    if (!isRec(o.settings)) fail(ctx, "validation.bad_input", "The settings are not valid.", { field: "settings" });
    for (const k of ["emailField", "phoneField", "tzField"]) {
      const v = o.settings[k];
      if (v !== undefined && (typeof v !== "string" || !/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(v))) fail(ctx, "validation.bad_input", "That is not a field name.", { field: `settings.${k}` });
    }
    if (o.settings.trigger !== undefined) {
      if (row.kind !== "triggered") fail(ctx, "validation.bad_input", "Only a triggered campaign has a trigger.", { field: "settings.trigger" });
      checkTrigger(ctx, o.settings.trigger);
    }
    if (o.settings.startAt !== undefined && (typeof o.settings.startAt !== "number" || !Number.isInteger(o.settings.startAt) || o.settings.startAt < 0)) {
      fail(ctx, "validation.bad_input", "startAt is a time.", { field: "settings.startAt" });
    }
    const cur = parseJson(row.settings);
    const merged = { ...(isRec(cur) ? cur : {}), ...o.settings };
    const text = JSON.stringify(merged);
    if (text.length > SETTINGS_MAX) fail(ctx, "validation.too_large", "The settings are too large.", { field: "settings" });
    sets.push(["settings", text]);
  }
  if (sets.length > 0) {
    sets.push(["updated_at", ctx.now()]);
    ctx.db.run(`UPDATE campaigns_campaign SET ${sets.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`, ...sets.map(([, v]) => v), str(row.id));
  }
  return { campaign: campaignOut(ctx, mustCampaign(ctx, str(row.id))) };
}

async function remove(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const row = mustCampaign(ctx, reqStr(ctx, o, "campaignId"));
  if (row.state !== "draft") fail(ctx, "validation.precondition_failed", "Only a draft can be deleted. Stop a running campaign instead.");
  ctx.db.run("UPDATE campaigns_campaign SET deleted_at = ?, updated_at = ? WHERE id = ?", ctx.now(), ctx.now(), str(row.id));
  return { deleted: true };
}

function mustEditable(ctx: Ctx, row: Row): void {
  if (!EDITABLE.includes(str(row.state))) fail(ctx, "validation.precondition_failed", "A running, stopped or finished campaign cannot be changed. Pause it first.");
}

// ---- audience ---------------------------------------------------------------------------------------------------

interface Candidate {
  recordId: string;
  email?: string;
  phone?: string;
  tz?: string;
}

async function readRows(ctx: Ctx, type: string, filter: unknown): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = (await ctx.call("records.query", { type, ...(filter !== undefined ? { filter } : {}), offset, limit: PAGE })) as { rows?: unknown };
    const got = Array.isArray(res.rows) ? res.rows.filter(isRec) : [];
    rows.push(...got);
    if (rows.length > MAX_AUDIENCE) fail(ctx, "validation.too_large", `The audience is over ${MAX_AUDIENCE} contacts. Narrow the view.`);
    if (got.length < PAGE) return rows;
  }
}

/**
 * Screen new candidates and enrol the ones that pass. Used by audience_set and by the engine for contacts a trigger enrolled. Returns the refused count.
 * Do-not-contact and the suppression list can refuse; nobody already enrolled is touched.
 */
export async function screenAndEnrol(ctx: Ctx, campaign: Row, candidates: Candidate[], firstStep: string | null, now: number): Promise<{ added: number; refused: number }> {
  if (candidates.length === 0) return { added: 0, refused: 0 };
  const allowed = new Set<string>();
  for (let i = 0; i < candidates.length; i += PAGE) {
    const batch = candidates.slice(i, i + PAGE);
    const res = (await ctx.call("contacts.dnd_screen", {
      context: "campaign", contextId: str(campaign.id),
      candidates: batch.map((c) => ({ ref: c.recordId, contactId: c.recordId, ...(c.email ? { email: c.email } : {}), ...(c.phone ? { phone: c.phone } : {}) })),
    })) as { allowed?: unknown };
    for (const a of Array.isArray(res.allowed) ? res.allowed : []) if (typeof a === "string") allowed.add(a);
  }
  const pass = candidates.filter((c) => allowed.has(c.recordId));
  const emails = pass.map((c) => c.email).filter((e): e is string => !!e);
  const blocked = new Set<string>();
  if (emails.length > 0) {
    const res = (await ctx.call("contacts.suppression.check", { channel: "email", addresses: emails })) as { suppressed?: unknown };
    for (const s of Array.isArray(res.suppressed) ? res.suppressed : []) if (isRec(s) && typeof s.address === "string") blocked.add(s.address.toLowerCase());
  }
  const variants = variantsOf(ctx, str(campaign.id));
  let added = 0;
  for (const c of pass) {
    if (c.email && blocked.has(c.email.toLowerCase())) continue;
    if (one(ctx, "SELECT * FROM campaigns_member WHERE campaign_id = ? AND record_id = ?", str(campaign.id), c.recordId)) continue;
    ctx.db.run(
      "INSERT INTO campaigns_member (id, campaign_id, record_id, address, phone, tz, variant, state, step_key, due_at, opened, clicked, replied_at, reply_announced, sent_count, last_sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      nid(ctx, "mem"), str(campaign.id), c.recordId, c.email ?? null, c.phone ?? null, c.tz ?? null, pickVariant(variants, str(campaign.id), c.recordId), "active",
      campaign.state === "running" ? firstStep : null, campaign.state === "running" ? now : null, 0, 0, null, 0, 0, null, now,
    );
    added += 1;
  }
  return { added, refused: candidates.length - added };
}

async function audienceSet(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const row = mustCampaign(ctx, reqStr(ctx, o, "campaignId"));
  if (row.state === "stopped" || row.state === "completed") fail(ctx, "validation.precondition_failed", "A finished campaign takes no more contacts.");
  const type = reqStr(ctx, o, "type");
  if (!/^[a-z][a-z0-9_]*$/.test(type)) fail(ctx, "validation.bad_input", "That record type is not valid.", { field: "type" });
  const viewId = optStr(ctx, o, "viewId");
  let filter: unknown = o.filter === null ? undefined : o.filter;
  if (viewId !== undefined) {
    const got = (await ctx.call("views.get", { viewId })) as { view?: { type?: unknown; filter?: unknown } };
    if (!got.view) fail(ctx, "validation.not_found", "That view does not exist.", { field: "viewId" });
    if (got.view.type !== undefined && got.view.type !== type) fail(ctx, "validation.bad_input", "That view is of another record type.", { field: "viewId" });
    const vf = got.view.filter;
    filter = vf !== undefined && vf !== null && filter !== undefined ? { and: [vf, filter] } : (vf ?? filter);
    if (filter === null) filter = undefined;
  }
  const names = fieldNames(row);
  const rows = await readRows(ctx, type, filter);
  const seen = new Set(membersOf(ctx, str(row.id)).map((m) => str(m.record_id)));
  const fresh: Candidate[] = [];
  let noAddress = 0;
  for (const r of rows) {
    const id = typeof r.id === "string" ? r.id : "";
    if (id === "" || seen.has(id)) continue;
    const fields = isRec(r.fields) ? r.fields : {};
    const email = typeof fields[names.email] === "string" ? (fields[names.email] as string).trim().toLowerCase() : "";
    const phone = typeof fields[names.phone] === "string" ? (fields[names.phone] as string).trim() : "";
    if (!email && !phone) {
      noAddress += 1;
      continue;
    }
    const c: Candidate = { recordId: id };
    if (email) c.email = email;
    if (phone) c.phone = phone;
    if (typeof fields[names.tz] === "string" && validZone(fields[names.tz] as string)) c.tz = fields[names.tz] as string;
    fresh.push(c);
  }
  const first = stepsOf(ctx, str(row.id))[0]?.key ?? null;
  const res = await screenAndEnrol(ctx, row, fresh, first, ctx.now());
  const excluded = num(row.excluded) + res.refused + noAddress;
  ctx.db.run(
    "UPDATE campaigns_campaign SET audience_type = ?, audience_view_id = ?, audience_filter = ?, excluded = ?, updated_at = ? WHERE id = ?",
    type, viewId ?? null, filter === undefined ? null : JSON.stringify(filter), excluded, ctx.now(), str(row.id),
  );
  return { count: membersOf(ctx, str(row.id)).length, excluded };
}

// ---- steps, variants, schedule ------------------------------------------------------------------------------------

function textField(ctx: Ctx, c: Record<string, unknown>, k: string, at: string, max: number, required: boolean): void {
  const v = c[k];
  if (v === undefined || v === null || v === "") {
    if (required) fail(ctx, "validation.bad_input", `${k} is needed.`, { field: `${at}.${k}` });
    return;
  }
  if (typeof v !== "string" || v.length > max) fail(ctx, "validation.bad_input", `${k} is not valid.`, { field: `${at}.${k}` });
}

function checkStep(ctx: Ctx, s: unknown, i: number): StepOut {
  const at = `steps.${i}`;
  if (!isRec(s)) fail(ctx, "validation.bad_input", "A step is an object.", { field: at });
  const key = typeof s.key === "string" ? s.key : "";
  const type = s.type as StepType;
  if (!KEY.test(key)) fail(ctx, "validation.bad_input", "A step key is lower case letters, digits, - and _.", { field: `${at}.key` });
  if (!STEP_TYPES.includes(type)) fail(ctx, "validation.bad_input", "That step type is not known.", { field: `${at}.type` });
  const config = isRec(s.config) ? s.config : {};
  if (type === "email") {
    textField(ctx, config, "mailboxId", `${at}.config`, 100, true);
    textField(ctx, config, "subject", `${at}.config`, 300, true);
    if ((config.text === undefined || config.text === "") && (config.html === undefined || config.html === "")) fail(ctx, "validation.bad_input", "An email needs text or html.", { field: `${at}.config.text` });
    textField(ctx, config, "text", `${at}.config`, 100_000, false);
    textField(ctx, config, "html", `${at}.config`, 200_000, false);
  } else if (type === "sms") {
    textField(ctx, config, "numberId", `${at}.config`, 100, true);
    textField(ctx, config, "body", `${at}.config`, 1600, true);
  } else if (type === "wait") {
    const units = ["minutes", "hours", "days"].filter((u) => config[u] !== undefined);
    const unit = units[0];
    const n = unit === undefined ? undefined : config[unit];
    if (units.length !== 1 || typeof n !== "number" || !Number.isInteger(n) || n < 1 || (unit === "days" && n > 365) || (unit === "hours" && n > 24 * 365) || (unit === "minutes" && n > 60 * 24 * 365)) {
      fail(ctx, "validation.bad_input", "A wait is one of minutes, hours or days: a whole number from 1.", { field: `${at}.config` });
    }
  } else if (type === "branch") {
    if (config.on !== "open" && config.on !== "click" && config.on !== "reply") fail(ctx, "validation.bad_input", "A branch looks at open, click or reply.", { field: `${at}.config.on` });
    if (!Array.isArray(s.next) || s.next.length !== 2) fail(ctx, "validation.bad_input", "A branch needs two next steps: yes, then no.", { field: `${at}.next` });
  } else {
    textField(ctx, config, "title", `${at}.config`, 300, true);
  }
  const out: StepOut = { key, type, config };
  if (s.next !== undefined && s.next !== null) {
    if (!Array.isArray(s.next) || !s.next.every((n) => typeof n === "string")) fail(ctx, "validation.bad_input", "next is a list of step keys.", { field: `${at}.next` });
    out.next = s.next as string[];
  }
  return out;
}

/** Where a member goes after step `i`: the branch's yes/no, an explicit next, or the following step; null ends the path. */
export function nextKey(steps: StepOut[], i: number, yes = true): string | null {
  const s = steps[i];
  if (!s) return null;
  if (s.type === "branch") return (yes ? s.next?.[0] : s.next?.[1]) ?? null;
  if (s.next !== undefined) return s.next[0] ?? null;
  return steps[i + 1]?.key ?? null;
}

async function stepsSet(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const row = mustCampaign(ctx, reqStr(ctx, o, "campaignId"));
  mustEditable(ctx, row);
  if (!Array.isArray(o.steps) || o.steps.length === 0 || o.steps.length > MAX_STEPS) fail(ctx, "validation.bad_input", `A campaign has 1 to ${MAX_STEPS} steps.`, { field: "steps" });
  const steps = o.steps.map((s, i) => checkStep(ctx, s, i));
  const keys = new Set<string>();
  for (const s of steps) {
    if (keys.has(s.key)) fail(ctx, "validation.bad_input", "Each step needs its own key.", { field: "steps" });
    keys.add(s.key);
  }
  steps.forEach((s, i) => {
    for (const n of s.next ?? []) if (!keys.has(n)) fail(ctx, "validation.bad_input", `Step ${s.key} points at ${n}, which is not a step.`, { field: `steps.${i}.next` });
  });
  // a loop would send forever
  const edges = (i: number): number[] => {
    const s = steps[i];
    if (!s) return [];
    const targets = s.type === "branch" ? (s.next ?? []) : s.next !== undefined ? s.next.slice(0, 1) : steps[i + 1] ? [steps[i + 1]!.key] : [];
    return targets.map((k) => steps.findIndex((x) => x.key === k)).filter((x) => x >= 0);
  };
  const state = new Map<number, 1 | 2>();
  const visit = (i: number): void => {
    if (state.get(i) === 2) return;
    if (state.get(i) === 1) fail(ctx, "validation.bad_input", "The steps loop back on themselves.", { field: "steps" });
    state.set(i, 1);
    for (const n of edges(i)) visit(n);
    state.set(i, 2);
  };
  steps.forEach((_s, i) => visit(i));
  ctx.db.run("DELETE FROM campaigns_step WHERE campaign_id = ?", str(row.id));
  steps.forEach((s, i) => {
    ctx.db.run("INSERT INTO campaigns_step (campaign_id, key, position, type, config, next) VALUES (?, ?, ?, ?, ?, ?)", str(row.id), s.key, i, s.type, JSON.stringify(s.config), s.next ? JSON.stringify(s.next) : null);
  });
  // variants must still point at a message step that exists
  for (const v of variantsOf(ctx, str(row.id))) {
    const t = steps.find((s) => s.key === v.stepKey);
    if (!t || (t.type !== "email" && t.type !== "sms")) ctx.db.run("DELETE FROM campaigns_variant WHERE campaign_id = ? AND key = ?", str(row.id), v.key);
  }
  ctx.db.run("UPDATE campaigns_campaign SET updated_at = ? WHERE id = ?", ctx.now(), str(row.id));
  return { ok: true };
}

async function variantsSet(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const row = mustCampaign(ctx, reqStr(ctx, o, "campaignId"));
  mustEditable(ctx, row);
  if (!Array.isArray(o.variants) || o.variants.length > 10) fail(ctx, "validation.bad_input", "A campaign has up to 10 variants.", { field: "variants" });
  const steps = stepsOf(ctx, str(row.id));
  const seen = new Set<string>();
  const rows = o.variants.map((v, i) => {
    const at = `variants.${i}`;
    if (!isRec(v)) fail(ctx, "validation.bad_input", "A variant is an object.", { field: at });
    const key = typeof v.key === "string" ? v.key : "";
    if (!KEY.test(key) || seen.has(key)) fail(ctx, "validation.bad_input", "Each variant needs its own key.", { field: `${at}.key` });
    seen.add(key);
    if (typeof v.weight !== "number" || !Number.isInteger(v.weight) || v.weight < 1 || v.weight > 1000) fail(ctx, "validation.bad_input", "A weight is a whole number from 1.", { field: `${at}.weight` });
    const step = steps.find((s) => s.key === v.stepKey);
    if (!step || (step.type !== "email" && step.type !== "sms")) fail(ctx, "validation.bad_input", "A variant changes an email or SMS step.", { field: `${at}.stepKey` });
    if (!isRec(v.config)) fail(ctx, "validation.bad_input", "A variant has a config.", { field: `${at}.config` });
    return { key, weight: v.weight, stepKey: step.key, config: v.config };
  });
  const stepKeys = new Set(rows.map((r) => r.stepKey));
  if (stepKeys.size > 1) fail(ctx, "validation.bad_input", "All variants of a test change the same step.", { field: "variants" });
  ctx.db.run("DELETE FROM campaigns_variant WHERE campaign_id = ?", str(row.id));
  for (const r of rows) ctx.db.run("INSERT INTO campaigns_variant (campaign_id, key, weight, step_key, config) VALUES (?, ?, ?, ?, ?)", str(row.id), r.key, r.weight, r.stepKey, JSON.stringify(r.config));
  // contacts already in the audience get their variant again, from the new weights
  const list = rows.map((r) => ({ key: r.key, weight: r.weight }));
  for (const m of membersOf(ctx, str(row.id))) {
    if (num(m.sent_count) > 0) continue;
    ctx.db.run("UPDATE campaigns_member SET variant = ? WHERE id = ?", pickVariant(list, str(row.id), str(m.record_id)), str(m.id));
  }
  ctx.db.run("UPDATE campaigns_campaign SET updated_at = ? WHERE id = ?", ctx.now(), str(row.id));
  return { ok: true };
}

async function scheduleSet(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const row = mustCampaign(ctx, reqStr(ctx, o, "campaignId"));
  if (row.state === "stopped" || row.state === "completed") fail(ctx, "validation.precondition_failed", "A finished campaign cannot be rescheduled.");
  const w = o.windows;
  if (!isRec(w)) fail(ctx, "validation.bad_input", "windows is an object with days, from and to.", { field: "windows" });
  const days = w.days;
  if (!Array.isArray(days) || days.length === 0 || !days.every((d) => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6)) {
    fail(ctx, "validation.bad_input", "days are numbers from 0 (Sunday) to 6.", { field: "windows.days" });
  }
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (typeof w.from !== "string" || typeof w.to !== "string" || !time.test(w.from) || !time.test(w.to) || w.from >= w.to) {
    fail(ctx, "validation.bad_input", "from and to are HH:MM, from before to.", { field: "windows" });
  }
  const tz = w.tz === undefined ? DEFAULT_WINDOWS.tz : w.tz;
  if (typeof tz !== "string" || !validZone(tz)) fail(ctx, "validation.bad_input", "That time zone is not known.", { field: "windows.tz" });
  const throttle = optInt(ctx, o, "throttlePerHour", 1, 10_000);
  if (typeof o.stopOnReply !== "boolean") fail(ctx, "validation.bad_input", "stopOnReply is true or false.", { field: "stopOnReply" });
  ctx.db.run(
    "UPDATE campaigns_campaign SET windows = ?, throttle_per_hour = ?, stop_on_reply = ?, updated_at = ? WHERE id = ?",
    JSON.stringify({ days: [...new Set(days as number[])].sort(), from: w.from, to: w.to, tz }), throttle ?? null, o.stopOnReply ? 1 : 0, ctx.now(), str(row.id),
  );
  return { ok: true };
}

// ---- preview and link builder ---------------------------------------------------------------------------------------

async function preview(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const row = mustCampaign(ctx, reqStr(ctx, o, "campaignId"));
  const steps = stepsOf(ctx, str(row.id));
  const msg = steps.find((s) => s.type === "email" || s.type === "sms");
  if (!msg) fail(ctx, "validation.precondition_failed", "Add an email or SMS step to preview.");
  const members = membersOf(ctx, str(row.id));
  let fields: Record<string, unknown> = { name: "Alex Sample", first_name: "Alex", email: "alex@example.com" };
  const first = members[0];
  if (first) {
    try {
      const got = (await ctx.call("records.get", { type: str(row.audience_type), recordId: str(first.record_id) })) as { record?: { fields?: unknown } };
      if (isRec(got.record?.fields)) fields = got.record.fields;
    } catch (e) {
      ctx.log.warn("campaigns: preview could not read a contact", { campaign: str(row.id), error: e instanceof Error ? e.message : String(e) });
    }
  }
  const variant = variantsOf(ctx, str(row.id)).find((v) => v.stepKey === msg.key);
  const cfg = { ...msg.config, ...(variant ? variant.config : {}) };
  const sample: { subject?: string; body: string } = { body: render(str(cfg.text ?? cfg.body ?? cfg.html ?? ""), fields) };
  if (msg.type === "email") sample.subject = render(str(cfg.subject), fields);
  let suppressed = 0;
  const addresses = members.map((m) => str(m.address)).filter((a) => a.length > 0);
  if (addresses.length > 0) {
    const res = (await ctx.call("contacts.suppression.check", { channel: "email", addresses })) as { suppressed?: unknown };
    suppressed = Array.isArray(res.suppressed) ? res.suppressed.length : 0;
  }
  return { sample, counts: { audience: members.length, excluded: num(row.excluded), suppressed } };
}

async function linkBuild(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const raw = reqStr(ctx, o, "url").trim();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return fail(ctx, "validation.bad_input", "That is not a web address.", { field: "url" });
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") fail(ctx, "validation.bad_input", "A campaign link is an http or https address.", { field: "url" });
  const tag = (k: string): string => {
    const v = reqStr(ctx, o, k).trim().toLowerCase();
    if (v.length === 0 || v.length > 100) fail(ctx, "validation.bad_input", `${k} is not valid.`, { field: k });
    return v;
  };
  u.searchParams.set("utm_source", tag("source"));
  u.searchParams.set("utm_medium", tag("medium"));
  u.searchParams.set("utm_campaign", tag("campaign"));
  return { url: u.toString() };
}

export const buildHandlers = {
  "campaigns.create": (ctx: Ctx, input: unknown) => create(ctx, input),
  "campaigns.get": (ctx: Ctx, input: unknown) => get(ctx, input),
  "campaigns.list": (ctx: Ctx, input: unknown) => list(ctx, input),
  "campaigns.update": (ctx: Ctx, input: unknown) => update(ctx, input),
  "campaigns.delete": (ctx: Ctx, input: unknown) => remove(ctx, input),
  "campaigns.audience_set": (ctx: Ctx, input: unknown) => audienceSet(ctx, input),
  "campaigns.steps_set": (ctx: Ctx, input: unknown) => stepsSet(ctx, input),
  "campaigns.variants_set": (ctx: Ctx, input: unknown) => variantsSet(ctx, input),
  "campaigns.schedule_set": (ctx: Ctx, input: unknown) => scheduleSet(ctx, input),
  "campaigns.preview": (ctx: Ctx, input: unknown) => preview(ctx, input),
  "campaigns.link_build": (ctx: Ctx, input: unknown) => linkBuild(ctx, input),
};
