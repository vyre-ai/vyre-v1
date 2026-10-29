// Teams transcripts into Meetings. After a member's mailbox is pulled, the Teams meetings on their calendar from the last three days are looked at (at most every ten minutes). A meeting
// that has ended, whose organizer is a mapped and included member, and that has a transcript, is landed as a Meeting through meetings.ingest (it merges with the calendar event on the
// join link) and its transcript goes to meetings.attach_recording with the speakers kept. The online meeting id is read from the join link, so no lookup permission beyond the transcript
// one is needed. A meeting with no transcript yet is looked at again on the next pass. An excluded organizer's meetings are never read.
import { api, first, list, normalizeEmail, num, obj, text, userUrl } from "../projections.ts";
import type { MsCtx } from "../projections.ts";
import { transcriptGet, transcripts } from "./graph.ts";

export const TEAMS_EVERY_MS = 10 * 60_000;
export const TEAMS_LOOKBACK_MS = 3 * 24 * 3_600_000;

export interface TeamsPull { meetings: number; attached: number; waiting: number }

/**
 * The online meeting id Graph uses, from a Teams join link: base64 of `1*<organizer object id>*0**<thread id>`. The thread id is the link's path segment, the organizer the Oid in its
 * context. Null for a link that is not a Teams meeting-join link.
 */
export function onlineMeetingId(joinUrl: string): { id: string; organizerOid: string } | null {
  let u: URL;
  try { u = new URL(joinUrl); } catch { return null; }
  if (u.protocol !== "https:" || !/(^|\.)teams\.microsoft\.com$|(^|\.)teams\.live\.com$/.test(u.hostname)) return null;
  const m = /\/meetup-join\/([^/]+)/.exec(u.pathname);
  if (!m) return null;
  let thread: string;
  try { thread = decodeURIComponent(m[1]!); } catch { return null; }
  if (!/^19:meeting_[A-Za-z0-9_-]+@thread\.(v2|skype)$/.test(thread)) return null;
  let oid = "";
  try { oid = String((JSON.parse(u.searchParams.get("context") ?? "{}") as { Oid?: unknown }).Oid ?? ""); } catch { /* no context */ }
  if (!/^[0-9a-fA-F-]{36}$/.test(oid)) return null;
  return { id: Buffer.from(`1*${oid}*0**${thread}`, "utf8").toString("base64"), organizerOid: oid };
}

/** Teams writes `<v Maya Rivera>words</v>`; Meetings reads `Maya Rivera: words`. */
export function speakers(vtt: string): string {
  return vtt.replace(/<v\s+([^>]*)>([\s\S]*?)<\/v>/g, (_m, who: string, words: string) => `${who.trim().replace(/:/g, " ")}: ${words.trim()}`);
}

const included = (ctx: MsCtx, email: string): boolean => {
  const row = first(ctx.db.all(`SELECT mapped, excluded FROM microsoft_member WHERE email = ?`, email));
  return row !== null && num(row, "mapped") === 1 && num(row, "excluded") === 0;
};

/** Look at one member's recent Teams meetings and hand every transcript that is ready to Meetings. */
export async function pullTeams(ctx: MsCtx, a: { connectionId: string; mailbox: string }): Promise<TeamsPull> {
  const out: TeamsPull = { meetings: 0, attached: 0, waiting: 0 };
  const now = ctx.now();
  const last = num(first(ctx.db.all(`SELECT "lastAt" FROM microsoft_teams_pull WHERE mailbox = ?`, a.mailbox)), "lastAt");
  if (last && now - last < TEAMS_EVERY_MS) return out;
  if (last) ctx.db.run(`UPDATE microsoft_teams_pull SET "lastAt" = ? WHERE mailbox = ?`, now, a.mailbox);
  else ctx.db.run(`INSERT INTO microsoft_teams_pull (mailbox, "lastAt") VALUES (?, ?)`, a.mailbox, now);
  const view = await api(ctx, {
    cap: "ms.calendar.list_events", connectionId: a.connectionId, as: a.mailbox, bulk: true, url: `${userUrl(a.mailbox, "/calendar")}/calendarView`,
    query: { startDateTime: new Date(now - TEAMS_LOOKBACK_MS).toISOString(), endDateTime: new Date(now).toISOString(), $top: 100, $select: "id,subject,start,end,isCancelled,organizer,attendees,onlineMeeting" },
  });
  for (const raw of list(view.value)) {
    const e = obj(raw);
    if (e.isCancelled === true) continue;
    const joinUrl = text(obj(e.onlineMeeting).joinUrl);
    const parsed = joinUrl ? onlineMeetingId(joinUrl) : null;
    const organizer = normalizeEmail(text(obj(obj(e.organizer).emailAddress).address) ?? "");
    const start = Date.parse(text(obj(e.start).dateTime) ? `${text(obj(e.start).dateTime)}Z` : "");
    const end = Date.parse(text(obj(e.end).dateTime) ? `${text(obj(e.end).dateTime)}Z` : "");
    if (!joinUrl || !parsed || !organizer || !Number.isFinite(start) || !Number.isFinite(end) || end > now) continue;
    // Only a mapped, included organizer's meetings are read: an excluded or outside organizer's never are.
    if (!included(ctx, organizer)) continue;
    out.meetings += 1;
    try {
      const done = await handOver(ctx, a, { organizer, joinUrl, meetingId: parsed.id, subject: text(e.subject), start, end, attendees: list(e.attendees) });
      if (done) out.attached += 1; else out.waiting += 1;
    } catch (err) {
      ctx.log.warn("microsoft teams transcript failed", { mailbox: a.mailbox, error: err instanceof Error ? err.name : "unknown" });
      out.waiting += 1;
    }
  }
  return out;
}

async function handOver(
  ctx: MsCtx, a: { connectionId: string; mailbox: string },
  m: { organizer: string; joinUrl: string; meetingId: string; subject: string | undefined; start: number; end: number; attendees: unknown[] },
): Promise<boolean> {
  const act = { connectionId: a.connectionId, as: m.organizer, onlineMeetingId: m.meetingId };
  const found = await transcripts(ctx, act).catch((e: unknown) => {
    const code = (e as { error?: { code?: string } } | null)?.error?.code;
    if (code === "validation.not_found" || code === "permission.no_grant") return { transcripts: [] };   // no online meeting under this organizer, or no policy for them
    throw e;
  });
  const ids = found.transcripts.map((t) => text((t as Record<string, unknown>).id)).filter((id): id is string => Boolean(id));
  const fresh = ids.filter((id) => !first(ctx.db.all(`SELECT key FROM microsoft_teams_seen WHERE key = ?`, `${m.meetingId}:${id}`)));
  if (ids.length === 0 || fresh.length === 0) return ids.length > 0;   // nothing yet: look again; everything handed over before: done
  const parts: string[] = [];
  for (const id of fresh) {
    const one = await transcriptGet(ctx, { ...act, transcriptId: id });
    const vtt = speakers(one.vtt);
    if (/-->/.test(vtt)) parts.push(vtt);
  }
  if (parts.length === 0) return false;
  const attendees = m.attendees.flatMap((x) => {
    const o = obj(obj(x).emailAddress);
    const email = normalizeEmail(text(o.address) ?? "");
    return /^[^\s@]+@[^\s@]+$/.test(email) ? [{ email, ...(text(o.name) ? { name: text(o.name)! } : {}) }] : [];
  });
  const landed = obj(await ctx.call("meetings.ingest", {
    source: "teams", providerRef: m.meetingId, title: m.subject?.trim() || "Teams meeting", startsAt: m.start, endsAt: m.end, joinUrl: m.joinUrl, attendees,
  }));
  const meetingId = text(landed.meetingId);
  if (!meetingId) return false;
  await ctx.call("meetings.attach_recording", { meetingId, source: "teams", providerRef: m.meetingId, transcriptText: parts.join("\n\n").replace(/\n\nWEBVTT\n+/g, "\n\n") });
  for (const id of fresh) ctx.db.run(`INSERT INTO microsoft_teams_seen (key, mailbox, "meetingId", at) VALUES (?, ?, ?, ?)`, `${m.meetingId}:${id}`, a.mailbox, meetingId, ctx.now());
  return true;
}

