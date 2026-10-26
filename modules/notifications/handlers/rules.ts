// Notification rules (spec 2.24): the levels, collapse, the agent interrupt cap, working hours, mutes, away and delegates, the lists and counts, and the digest collector.
// notifications.send is the one door: it decides the level a notification lands at (kind default, then away, hours, the 3 an hour agent cap), collapses repeats into one row, and
// asks push.ts to deliver an Interrupt. Everything is per person; a caller reads and changes only their own settings.
import { makeId } from "../../../packages/contracts/src/ids.ts";
import {
  AGENT_INTERRUPTS_PER_HOUR, COLLAPSE_WINDOW_MS, DIRECT_KINDS, HOUR, KINDS, NEEDS_YOU_KINDS, UNMUTABLE_KINDS, activeMutes, clean, isMuted, isService, kindOf, meOf, outRow,
  raise, readAway, readChain, readRules, render, rowOf, sourcesOf, withinHours, writeRules,
} from "../projections.ts";
import type { Delegate, Hours, KindDef, Level, NotifCtx, ResourceRef, Row, Target } from "../projections.ts";
import { deliverPush, pushPort } from "./push.ts";
import { levelOverride, readChoice } from "./kinds.ts";
import { alertLevel, heldByQuiet, readSettings, scheduleQuietSummary } from "./deliver.ts";

const RANK: Record<Level, number> = { digest: 0, badge: 1, interrupt: 2 };
/** In the contract's kind enum: a kind outside it can be neither sent nor listed. */
const LISTED = KINDS.filter((k) => k.key !== "vault.rotation_due");

interface SendIn {
  to: string; kind: string; subject?: ResourceRef; data?: Record<string, unknown>; title?: string; body?: string; collapseKey?: string; runId?: string;
}
type Outcome = "interrupt" | "badge" | "digest" | "dropped_muted" | "capped";

/** The level a notification lands at: the kind's own, raised by Alerts, lowered by away, working hours and quiet hours. `quietEnd` is set when quiet hours held it. */
function levelFor(ctx: NotifCtx, def: KindDef, person: string, urgent: boolean): { level: Level; quietEnd?: number } {
  const settings = readSettings(ctx.db, person);
  let level = alertLevel(def, levelOverride(ctx.db, person, def), settings, readChoice(ctx.db, person, def.key) !== undefined);   // my own choice for the kind (kind.set_level) wins over the Alerts setting
  if (level !== "interrupt") return { level };
  if (readAway(ctx.db, person, ctx.now()) && def.key !== "call.incoming") return { level: "digest" };   // while away only calls interrupt
  const rules = readRules(ctx.db, person);
  if (def.respectHours && !urgent && !withinHours(rules.workingHours, ctx.now())) return { level: "badge" };
  const quietEnd = heldByQuiet(def, level, settings, rules.workingHours?.tz ?? "UTC", ctx.now(), NEEDS_YOU_KINDS.has(def.key));
  if (quietEnd !== undefined) return { level: "digest", quietEnd };
  return { level };
}

export async function send(ctx: NotifCtx, input: SendIn, handed = false): Promise<{ outcome: Outcome; notificationId?: string }> {
  const def = kindOf(input.kind);
  if (!def || !LISTED.includes(def)) raise(ctx, "validation.bad_input", "That kind of notification does not exist.", { errors: ["/kind: unknown"] });
  let person = input.to;
  const now = ctx.now();
  // While away, Needs you goes to the person named in While you are away (an away delegate set with notifications.away.set keeps its own way: tasks route it)
  if (!handed && NEEDS_YOU_KINDS.has(def.key)) {
    const away = readAway(ctx.db, person, now);
    const hand = readSettings(ctx.db, person).handTo;
    if (away && away.delegate.kind === "none" && hand && hand !== person) {
      return send(ctx, { ...input, to: hand, data: { ...(input.data ?? {}), handedFrom: person } }, true);
    }
  }
  const rules = readRules(ctx.db, person);
  const sources = sourcesOf(input.data, input.subject, ctx.principal);
  if (!UNMUTABLE_KINDS.has(def.key) && isMuted(ctx.db, rules, person, sources, now)) return { outcome: "dropped_muted" };

  // an approval reminder for something that is done or withdrawn has nothing left to say
  if (def.key === "approval.backstop" && input.subject?.type === "task" && ctx.call) {
    const t = (await ctx.call("tasks.get", { taskId: input.subject.id }).catch(() => undefined)) as { task?: { state?: string } } | undefined;
    if (t?.task?.state === "done" || t?.task?.state === "canceled") return { outcome: "dropped_muted" };
  }

  const landed = levelFor(ctx, def, person, input.data?.urgent === true);
  let level = landed.level;
  if (landed.quietEnd !== undefined) await scheduleQuietSummary(ctx, person, landed.quietEnd);
  const vars: Record<string, unknown> = { space: ctx.space, ...(input.data ?? {}), ...(input.title !== undefined ? { title: input.title } : {}) };
  const title = render(def.title, vars) || def.title.replace(/\{\{\w+\}\}/g, "").trim() || def.key;
  const collapseKey = input.collapseKey ?? (input.subject ? `${def.key}:${input.subject.id}` : undefined);
  const agent = sources.find((s) => s.kind === "agent");

  // same key, still unseen: one row with a count, not another banner
  const existing = collapseKey
    ? (ctx.db.all("SELECT * FROM notifications_items WHERE person = ? AND collapse_key = ? AND seen_at IS NULL AND deleted_at IS NULL AND at > ? ORDER BY at DESC, id DESC LIMIT 1", person, collapseKey, now - COLLAPSE_WINDOW_MS)[0] as Record<string, unknown> | undefined)
    : undefined;
  const prior = existing ? rowOf(existing) : undefined;
  const alreadyLoud = prior?.level === "interrupt";   // the row already interrupted: a repeat is the same banner, not another push or another use of the cap

  // an agent can interrupt a person 3 times an hour; the rest go to the digest and the agent is told
  let capped = false;
  if (level === "interrupt" && def.agentRateKey && agent && !alreadyLoud) {
    const used = Number((ctx.db.all("SELECT COUNT(*) AS n FROM notifications_agent_interrupts WHERE person = ? AND agent = ? AND at > ?", person, agent.id, now - HOUR)[0] as { n: number }).n);
    if (used >= AGENT_INTERRUPTS_PER_HOUR) { capped = true; level = "digest"; }
    else ctx.db.run("INSERT INTO notifications_agent_interrupts (person, agent, at) VALUES (?, ?, ?)", person, agent.id, now);
  }
  if (!capped && prior && RANK[prior.level] > RANK[level]) level = prior.level;   // a repeat never lowers a row that was louder

  let row: Row;
  let collapsed = false;
  if (prior) {
    collapsed = true;
    row = { ...prior, level, title, count: prior.count + 1, at: now, ...(input.body !== undefined ? { body: input.body } : {}) };
    ctx.db.run("UPDATE notifications_items SET level = ?, title = ?, body = ?, count = ?, at = ?, updated_at = ?, version = version + 1 WHERE id = ?",
      row.level, row.title, row.body ?? null, row.count, now, now, row.id);
  } else {
    row = clean({
      id: makeId("ntf", globalThis.crypto.getRandomValues(new Uint8Array(14))), person, kind: def.key, level, place: def.place, title, body: input.body, subject: input.subject, count: 1, at: now, actions: def.actions,
      collapseKey, runId: input.runId ?? ctx.run, traceId: ctx.trace.traceId,
    }) as Row;
    ctx.db.run(
      `INSERT INTO notifications_items (id, person, kind, level, place, title, body, subject_type, subject_id, collapse_key, count, at, seen_at, actions, run_id, trace_id, version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, ?)`,
      row.id, person, row.kind, row.level, row.place, row.title, row.body ?? null, row.subject?.type ?? null, row.subject?.id ?? null, collapseKey ?? null, 1, now,
      JSON.stringify(row.actions), row.runId ?? null, row.traceId ?? null, now,
    );
  }

  const push = row.level === "interrupt" && !alreadyLoud ? await deliverPush(ctx, person, row, def) : { pushed: false as const };
  if (capped) ctx.emit("notification.capped", `entity/${person}`, { person, agentId: agent!.id, kind: def.key, perHour: AGENT_INTERRUPTS_PER_HOUR }, { vis: "owner" });
  ctx.emit("notification.delivered", `entity/${row.id}`, clean({
    notificationId: row.id, person, kind: def.key, level: row.level, place: row.place, subject: row.subject, collapsed, pushed: push.pushed, device: (push as { device?: string }).device,
  }), { vis: "owner" });

  if (def.key === "approval.requested" && !collapsed) await scheduleBackstop(ctx, def, person, rules.emailBackstop, input, title);
  if (def.key === "approval.backstop" && rules.emailBackstop) await sendBackstopEmail(ctx, person, row, collapseKey ?? row.id);
  return { outcome: capped ? "capped" : row.level, notificationId: row.id };
}

/** One reminder, four hours after an approval starts waiting (the Gate schedules its own for held calls, with the same collapse key, so they land on one row). */
async function scheduleBackstop(ctx: NotifCtx, def: KindDef, person: string, wanted: boolean, input: SendIn, title: string): Promise<void> {
  if (!wanted || !def.backstopEmailAfterHours || !input.subject || !ctx.schedule) return;
  try {
    await ctx.schedule(ctx.now() + def.backstopEmailAfterHours * HOUR, "notifications.send", {
      to: person, kind: "approval.backstop", subject: input.subject, title: input.title ?? title, collapseKey: `approval.backstop:${input.subject.id}`,
    });
  } catch (e) { ctx.log?.warn("backstop not scheduled", (e as Error).message); }
}
async function sendBackstopEmail(ctx: NotifCtx, person: string, row: Row, key: string): Promise<void> {
  const p = pushPort();
  if (!p?.email) return;
  const fresh = ctx.db.run("INSERT OR IGNORE INTO notifications_backstops (key, at) VALUES (?, ?)", key, ctx.now()).changes > 0;
  if (!fresh) return;   // once per approval
  try { await p.email({ to: person, subject: "Something is waiting on you", deepLink: row.subject ? `vyre://${row.subject.type}/${row.subject.id}` : `vyre://${row.place}` }); }
  catch (e) { ctx.log?.warn("backstop email failed", (e as Error).message); }
}

// ---- lists and counts ----

export async function list(ctx: NotifCtx, input: { place?: string; level?: string; unseenOnly?: boolean; cursor?: string; limit?: number }): Promise<Record<string, unknown>> {
  const me = meOf(ctx);
  const where = ["person = ?", "deleted_at IS NULL"]; const args: unknown[] = [me];
  if (input.place) { where.push("place = ?"); args.push(input.place); }
  if (input.level) { where.push("level = ?"); args.push(input.level); }
  if (input.unseenOnly) where.push("seen_at IS NULL");
  const total = Number((ctx.db.all(`SELECT COUNT(*) AS n FROM notifications_items WHERE ${where.join(" AND ")}`, ...args)[0] as { n: number }).n);
  if (input.cursor) {
    const m = /^(\d+):(.+)$/.exec(input.cursor);
    if (!m) raise(ctx, "validation.bad_input", "That page marker is not valid.", { errors: ["/cursor: not from this list"] });
    where.push("(at < ? OR (at = ? AND id < ?))"); args.push(Number(m[1]), Number(m[1]), m[2]);
  }
  const limit = input.limit ?? 50;
  const rows = (ctx.db.all(`SELECT * FROM notifications_items WHERE ${where.join(" AND ")} ORDER BY at DESC, id DESC LIMIT ?`, ...args, limit + 1) as Record<string, unknown>[]).map(rowOf);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return clean({ notifications: page.map((r) => outRow(r, ctx.space)), next: rows.length > limit && last ? `${last.at}:${last.id}` : undefined, total });
}

/** The rail counts only Needs you and direct conversations; every other place gets a quiet dot (its unseen badge-or-louder rows). Digest rows never count. */
export async function counts(ctx: NotifCtx): Promise<{ rail: { needsYou: number; directConversations: number }; dots: Record<string, number>; otherSpaces: { spaceId: string; needsYou: number }[] }> {
  const rows = (ctx.db.all("SELECT kind, place, count FROM notifications_items WHERE person = ? AND seen_at IS NULL AND deleted_at IS NULL AND level != 'digest'", meOf(ctx)) as { kind: string; place: string; count: number }[]);
  let needsYou = 0, direct = 0;
  const dots: Record<string, number> = {};
  for (const r of rows) {
    const n = Math.max(1, Number(r.count));
    if (NEEDS_YOU_KINDS.has(r.kind)) needsYou += n;
    else if (DIRECT_KINDS.has(r.kind)) direct += n;
    else dots[r.place] = (dots[r.place] ?? 0) + n;
  }
  // one server is one Space (v1): another Space that needs this person arrives through its own server, not through this table
  return { rail: { needsYou, directConversations: direct }, dots, otherSpaces: [] };
}

export async function markSeen(ctx: NotifCtx, input: { notificationIds?: string[]; place?: string }): Promise<{ marked: number }> {
  const me = meOf(ctx);
  const where = ["person = ?", "seen_at IS NULL", "deleted_at IS NULL"]; const args: unknown[] = [me];
  if (input.notificationIds) {
    if (input.notificationIds.length === 0) return { marked: 0 };
    where.push(`id IN (${input.notificationIds.map(() => "?").join(", ")})`); args.push(...input.notificationIds);
  }
  if (input.place) { where.push("place = ?"); args.push(input.place); }
  const ids = (ctx.db.all(`SELECT id FROM notifications_items WHERE ${where.join(" AND ")} ORDER BY at, id`, ...args) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return { marked: 0 };
  ctx.db.run(`UPDATE notifications_items SET seen_at = ?, updated_at = ?, version = version + 1 WHERE ${where.join(" AND ")}`, ctx.now(), ctx.now(), ...args);
  ctx.emit("notification.seen", `entity/${me}`, clean({ person: me, notificationIds: ids.slice(0, 500), place: input.place }), { vis: "owner" });
  return { marked: ids.length };
}

export async function kindsList(ctx: NotifCtx): Promise<{ kinds: Record<string, unknown>[] }> {
  const me = meOf(ctx);
  return {
    kinds: LISTED.map((k) => {
      const mine = readChoice(ctx.db, me, k.key);
      return { key: k.key, level: k.level, place: k.place, title: k.title, respectHours: k.respectHours, ...(mine ? { mine } : {}) };
    }),
  };
}

export async function digestCollect(ctx: NotifCtx, input: { person: string; since: number; until?: number }): Promise<{ items: Record<string, unknown>[] }> {
  if (input.person !== meOf(ctx) && !isService(ctx)) raise(ctx, "permission.no_grant", "You can only gather your own digest.");
  const until = input.until ?? ctx.now();
  const rows = (ctx.db.all("SELECT * FROM notifications_items WHERE person = ? AND level = 'digest' AND deleted_at IS NULL AND at > ? AND at <= ? ORDER BY at, id", input.person, input.since, until) as Record<string, unknown>[]).map(rowOf);
  return { items: rows.map((r) => clean({ kind: r.kind, title: r.title, at: r.at, subject: r.subject, count: r.count })) };
}

// ---- settings ----

const validHours = (ctx: NotifCtx, h: Hours): Hours => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: h.tz }); } catch { raise(ctx, "validation.bad_input", "That time zone is not known.", { errors: ["/workingHours/tz: unknown zone"] }); }
  if (new Set(h.days).size !== h.days.length) raise(ctx, "validation.bad_input", "A day is listed twice.", { errors: ["/workingHours/days: duplicate"] });
  return { days: [...h.days].sort((a, b) => a - b), from: h.from, to: h.to, tz: h.tz };
};

export async function rulesGet(ctx: NotifCtx): Promise<{ rules: Record<string, unknown> }> {
  return { rules: readRules(ctx.db, meOf(ctx)) as unknown as Record<string, unknown> };
}
export async function rulesSet(ctx: NotifCtx, input: { workingHours?: Hours | null; emailBackstop?: boolean; mutedAgents?: string[]; mutedChannels?: string[]; mutedRecords?: string[] }): Promise<{ rules: Record<string, unknown> }> {
  const me = meOf(ctx);
  const was = readRules(ctx.db, me);
  const next = { ...was };
  const fields: string[] = [];
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  if (input.workingHours !== undefined) {
    const h = input.workingHours === null ? undefined : validHours(ctx, input.workingHours);
    if (!same(h, was.workingHours)) { fields.push("workingHours"); if (h) next.workingHours = h; else delete next.workingHours; }
  }
  if (input.emailBackstop !== undefined && input.emailBackstop !== was.emailBackstop) { fields.push("emailBackstop"); next.emailBackstop = input.emailBackstop; }
  for (const k of ["mutedAgents", "mutedChannels", "mutedRecords"] as const) {
    const v = input[k];
    if (v !== undefined) { const u = [...new Set(v)]; if (!same(u, was[k])) { fields.push(k); next[k] = u; } }
  }
  if (fields.length) {
    writeRules(ctx.db, me, next);
    ctx.emit("notification.rules_changed", `entity/${me}`, { person: me, fields }, { vis: "owner" });
  }
  return { rules: next as unknown as Record<string, unknown> };
}

// ---- mutes ----

export async function muteSet(ctx: NotifCtx, input: { target: Target; minutes?: number }): Promise<{ until: number }> {
  const me = meOf(ctx);
  const until = ctx.now() + (input.minutes ?? 60) * 60_000;
  ctx.db.run(
    `INSERT INTO notifications_mutes (person, target_kind, target_id, until) VALUES (?, ?, ?, ?)
     ON CONFLICT(person, target_kind, target_id) DO UPDATE SET until = excluded.until`, me, input.target.kind, input.target.id, until,
  );
  ctx.emit("notification.muted", `entity/${me}`, { person: me, target: input.target, until }, { vis: "owner" });
  return { until };
}
export async function muteClear(ctx: NotifCtx, input: { target: Target }): Promise<{ cleared: boolean }> {
  const me = meOf(ctx);
  const cleared = ctx.db.run("DELETE FROM notifications_mutes WHERE person = ? AND target_kind = ? AND target_id = ?", me, input.target.kind, input.target.id).changes > 0;
  if (cleared) ctx.emit("notification.unmuted", `entity/${me}`, { person: me, target: input.target }, { vis: "owner" });
  return { cleared };
}
export async function muteList(ctx: NotifCtx): Promise<{ mutes: { target: Target; until: number }[] }> {
  return { mutes: activeMutes(ctx.db, meOf(ctx), ctx.now()) };
}

// ---- away and delegates ----

function cleanChain(ctx: NotifCtx, me: string, chain: Delegate[]): Delegate[] {
  const out: Delegate[] = [];
  for (const [i, d] of chain.entries()) {
    if (d.kind === "none") { out.push({ kind: "none" }); continue; }
    if (!d.id) raise(ctx, "validation.bad_input", "Say who.", { errors: [`/chain/${i}/id: required for ${d.kind}`] });
    if (d.kind === "person" && d.id === me) raise(ctx, "validation.precondition_failed", "You cannot be your own delegate.", { reason: "self_delegate" });
    if (out.some((o) => o.kind === d.kind && o.id === d.id)) raise(ctx, "validation.bad_input", "Someone is listed twice.", { errors: [`/chain/${i}: duplicate`] });
    out.push({ kind: d.kind, id: d.id });
  }
  return out;
}

export async function awaySet(ctx: NotifCtx, input: { until: number; delegate: Delegate }): Promise<{ until: number }> {
  const me = meOf(ctx);
  if (input.until <= ctx.now()) raise(ctx, "validation.bad_input", "Pick a time in the future.", { errors: ["/until: must be in the future"] });
  const delegate = cleanChain(ctx, me, [input.delegate])[0]!;
  const since = readAway(ctx.db, me, ctx.now())?.since ?? ctx.now();
  ctx.db.run(
    `INSERT INTO notifications_away (person, until, delegate, since) VALUES (?, ?, ?, ?)
     ON CONFLICT(person) DO UPDATE SET until = excluded.until, delegate = excluded.delegate`, me, input.until, JSON.stringify(delegate), since,
  );
  ctx.emit("away.set", `entity/${me}`, { person: me, until: input.until, delegate });
  return { until: input.until };
}
export async function awayClear(ctx: NotifCtx): Promise<{ waitedApprovals: number; waitedDigest: number }> {
  const me = meOf(ctx);
  const r = ctx.db.all("SELECT since FROM notifications_away WHERE person = ?", me)[0] as { since: number } | undefined;
  if (!r) return { waitedApprovals: 0, waitedDigest: 0 };
  const since = Number(r.since);
  const n = (sql: string): number => Number((ctx.db.all(sql, me, since)[0] as { n: number }).n);
  const waitedApprovals = n("SELECT COUNT(*) AS n FROM notifications_items WHERE person = ? AND at >= ? AND seen_at IS NULL AND deleted_at IS NULL AND kind IN ('approval.requested', 'approval.backstop')");
  const waitedDigest = n("SELECT COUNT(*) AS n FROM notifications_items WHERE person = ? AND at >= ? AND level = 'digest' AND deleted_at IS NULL");
  ctx.db.run("DELETE FROM notifications_away WHERE person = ?", me);
  ctx.emit("away.cleared", `entity/${me}`, { person: me, waitedApprovals, waitedDigest });
  return { waitedApprovals, waitedDigest };
}
export async function awayGet(ctx: NotifCtx): Promise<Record<string, unknown>> {
  const a = readAway(ctx.db, meOf(ctx), ctx.now());
  return a ? { away: true, until: a.until, delegate: a.delegate } : { away: false };
}

export async function delegateGet(ctx: NotifCtx): Promise<{ chain: Delegate[] }> {
  return { chain: readChain(ctx.db, meOf(ctx)) };
}
export async function delegateSet(ctx: NotifCtx, input: { chain: Delegate[] }): Promise<{ chain: Delegate[] }> {
  const me = meOf(ctx);
  const chain = cleanChain(ctx, me, input.chain);
  ctx.db.run(`INSERT INTO notifications_delegates (person, chain) VALUES (?, ?) ON CONFLICT(person) DO UPDATE SET chain = excluded.chain`, me, JSON.stringify(chain));
  ctx.emit("notification.delegate_changed", `entity/${me}`, { person: me, chain }, { vis: "owner" });
  return { chain };
}
/** Walk the person's away delegate, then the standing chain, and return the first holder who can act on the item. A person is checked with the access checker (a delegate never
 * gains access); a role is returned as is (each holder is checked when they act). With no way to check, a person is skipped. */
export async function delegateResolve(ctx: NotifCtx, input: { person: string; resource: ResourceRef }): Promise<{ delegate?: { kind: "person" | "role"; id: string }; walked: number }> {
  const away = readAway(ctx.db, input.person, ctx.now());
  const chain = [...(away ? [away.delegate] : []), ...readChain(ctx.db, input.person)];
  let walked = 0;
  for (const d of chain) {
    if (d.kind === "none") break;
    walked++;
    if (!d.id || d.id === input.person) continue;
    if (d.kind === "role") return { delegate: { kind: "role", id: d.id }, walked };
    if (!ctx.call) continue;
    try {
      const r = (await ctx.call("access.check", { principal: { kind: "person", id: d.id }, action: { level: "use" }, resource: input.resource })) as { decision?: { effect?: string } };
      if (r.decision?.effect === "allow") return { delegate: { kind: "person", id: d.id }, walked };
    } catch { /* a delegate we cannot check is not a delegate */ }
  }
  return { walked };
}
