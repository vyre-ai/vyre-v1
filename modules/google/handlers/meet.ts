// Meet transcripts into Meetings. After a member's mailbox is pulled, their recent Meet conferences are looked at (at most every ten minutes): a conference that has a transcript is landed
// as a Meeting through meetings.ingest (it merges with the calendar event on the Meet join link) and the transcript is handed to meetings.attach_recording as WebVTT, so speakers and times
// survive. It runs only for mapped, included members (the caller checks), as that member, with the same Meet scope the capabilities use. A conference without a transcript yet is looked at again
// on the next pass until it is three days old.
import { api } from "../projections.ts";
import type { GoogleCtx } from "../projections.ts";
import { first, list, MEET, num, obj, text } from "../projections.ts";

export const MEET_EVERY_MS = 10 * 60_000;
export const MEET_LOOKBACK_MS = 3 * 24 * 3_600_000;
const SCOPE = "meetings.space.readonly";
const MAX_PAGES = 40;

export interface MeetPull { records: number; attached: number; waiting: number }

const call = (ctx: GoogleCtx, connectionId: string, mailbox: string, cap: string, url: string, query?: Record<string, string | number | undefined>) =>
  api(ctx, { cap, connectionId, as: mailbox, scope: SCOPE, url, bulk: true, ...(query ? { query } : {}) });

const pad = (n: number, w = 2): string => String(Math.max(0, Math.floor(n))).padStart(w, "0");
/** hh:mm:ss.mmm, the form WebVTT cues use. */
export function cueTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  return `${pad(t / 3_600_000)}:${pad((t / 60_000) % 60)}:${pad((t / 1000) % 60)}.${pad(t % 1000, 3)}`;
}

export interface Entry { text: string; participant?: string | undefined; startTime?: string | undefined }

/** WebVTT from Meet's entries: a cue per entry, spoken by the participant's display name, ending when the next one starts. */
export function toVtt(entries: readonly Entry[], names: ReadonlyMap<string, string>, startedAt: number): string {
  const cues: string[] = ["WEBVTT", ""];
  const at = entries.map((e, i) => {
    const t = Date.parse(e.startTime ?? "");
    return Number.isFinite(t) ? t - startedAt : i * 3000;
  });
  entries.forEach((e, i) => {
    const words = e.text.replace(/\s+/g, " ").trim();
    if (!words) return;
    const start = at[i]!;
    const end = at[i + 1] !== undefined && at[i + 1]! > start ? at[i + 1]! : start + 3000;
    const who = e.participant ? names.get(e.participant) : undefined;
    cues.push(`${cueTime(start)} --> ${cueTime(end)}`, who ? `${who.replace(/:/g, " ")}: ${words}` : words, "");
  });
  return cues.join("\n");
}

async function participants(ctx: GoogleCtx, connectionId: string, mailbox: string, record: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const r = await call(ctx, connectionId, mailbox, "google.meet.list_conference_records", `${MEET}/${record}/participants`, { pageToken });
    for (const p of list(r.participants)) {
      const o = obj(p);
      const name = text(o.name);
      const display = text(obj(o.signedinUser).displayName) ?? text(obj(o.anonymousUser).displayName) ?? text(obj(o.phoneUser).displayName);
      if (name && display) names.set(name, display);
    }
    pageToken = text(r.nextPageToken);
    if (!pageToken) break;
  }
  return names;
}

async function entriesOf(ctx: GoogleCtx, connectionId: string, mailbox: string, transcript: string): Promise<Entry[]> {
  const out: Entry[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await call(ctx, connectionId, mailbox, "google.meet.get_transcript_entries", `${MEET}/${transcript}/entries`, { pageToken });
    for (const e of list(r.transcriptEntries)) {
      const o = obj(e);
      out.push({ text: text(o.text) ?? "", participant: text(o.participant), startTime: text(o.startTime) });
    }
    pageToken = text(r.nextPageToken);
    if (!pageToken) break;
  }
  return out;
}

/** Look at one member's recent conferences and hand every transcript that is ready to Meetings. Never throws for a Meet failure: the next pass looks again. */
export async function pullMeet(ctx: GoogleCtx, a: { connectionId: string; mailbox: string }): Promise<MeetPull> {
  const out: MeetPull = { records: 0, attached: 0, waiting: 0 };
  const now = ctx.now();
  const last = num(first(ctx.db.all(`SELECT "lastAt" FROM google_meet_pull WHERE mailbox = ?`, a.mailbox)), "lastAt");
  if (last && now - last < MEET_EVERY_MS) return out;
  if (last) ctx.db.run(`UPDATE google_meet_pull SET "lastAt" = ? WHERE mailbox = ?`, now, a.mailbox);
  else ctx.db.run(`INSERT INTO google_meet_pull (mailbox, "lastAt") VALUES (?, ?)`, a.mailbox, now);
  const from = new Date(now - MEET_LOOKBACK_MS).toISOString();
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const r = await call(ctx, a.connectionId, a.mailbox, "google.meet.list_conference_records", `${MEET}/conferenceRecords`, { filter: `start_time>="${from}"`, pageToken });
    for (const rec of list(r.conferenceRecords)) {
      const o = obj(rec);
      const name = text(o.name);
      const ended = Date.parse(text(o.endTime) ?? "");
      const started = Date.parse(text(o.startTime) ?? "");
      if (!name || !Number.isFinite(ended) || !Number.isFinite(started)) continue;   // still running, or not a record we can place
      out.records += 1;
      if (first(ctx.db.all(`SELECT record FROM google_meet_seen WHERE record = ?`, name))) continue;
      try {
        if (await handOver(ctx, a, { name, started, ended, space: text(o.space) })) out.attached += 1; else out.waiting += 1;
      } catch (e) {
        ctx.log.warn("google meet transcript failed", { mailbox: a.mailbox, record: name, error: e instanceof Error ? e.name : "unknown" });
        out.waiting += 1;
      }
    }
    pageToken = text(r.nextPageToken);
    if (!pageToken) break;
  }
  return out;
}

async function handOver(ctx: GoogleCtx, a: { connectionId: string; mailbox: string }, rec: { name: string; started: number; ended: number; space: string | undefined }): Promise<boolean> {
  const ts = await call(ctx, a.connectionId, a.mailbox, "google.meet.list_transcripts", `${MEET}/${rec.name}/transcripts`);
  const ready = list(ts.transcripts).map(obj).filter((t) => ["ENDED", "FILE_GENERATED"].includes(text(t.state) ?? "") && text(t.name));
  if (ready.length === 0) return false;   // no transcript (yet): looked at again next pass
  let joinUrl: string | undefined;
  if (rec.space) {
    const sp = await call(ctx, a.connectionId, a.mailbox, "google.meet.list_conference_records", `${MEET}/${rec.space}`);
    const uri = text(sp.meetingUri);
    if (uri && /^https:\/\/meet\.google\.com\/[a-z0-9-]+$/.test(uri)) joinUrl = uri;
  }
  const names = await participants(ctx, a.connectionId, a.mailbox, rec.name);
  const entries: Entry[] = [];
  for (const t of ready) entries.push(...await entriesOf(ctx, a.connectionId, a.mailbox, text(t.name)!));
  const vtt = toVtt(entries, names, rec.started);
  if (!/-->/.test(vtt)) return false;   // a transcript with no words is not handed over
  const landed = obj(await ctx.call("meetings.ingest", {
    source: "meet", providerRef: rec.name, title: "Google Meet", startsAt: rec.started, endsAt: rec.ended, attendees: [], ...(joinUrl ? { joinUrl } : {}),
  }));
  const meetingId = text(landed.meetingId);
  if (!meetingId) return false;
  await ctx.call("meetings.attach_recording", { meetingId, source: "meet", providerRef: rec.name, transcriptText: vtt });
  ctx.db.run(`INSERT INTO google_meet_seen (record, mailbox, "meetingId", at) VALUES (?, ?, ?, ?)`, rec.name, a.mailbox, meetingId, ctx.now());
  ctx.log.info("google meet transcript attached", { mailbox: a.mailbox, record: rec.name });
  return true;
}

