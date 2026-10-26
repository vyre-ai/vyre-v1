// The Zoom webhook (spec 2.18; ARCH 8.3): /hooks/zoom. The host checks the signature before this runs (the connector source says `verify: 'hmac'`; signatureMatches below is the check, Zoom's v0 scheme
// HMAC-SHA256 over "v0:<timestamp>:<body>" with the webhook secret token) and dedupes on the event id; zoom.receive_webhook then does what the event means.
//   endpoint.url_validation            answered with the encrypted token (HMAC-SHA256 of the plain token with the secret, hex); no event is recorded for it.
//   meeting.started, meeting.ended     the meeting is landed through meetings.ingest (merging with its calendar event on the host's email and the time) and set live or ended.
//   recording.completed,
//   recording.transcript_completed     the meeting is landed the same way and meetings.attach_recording pulls the recording and the transcript; the second event finds what the first brought.
// DECISION: an event is recorded only after it was handled, so a failure (Zoom down, Files down) is answered with the error and Zoom's retry is handled again; a repeat of a handled event is accepted and does nothing.
// DECISION: Zoom's webhook says little about a meeting, so the topic, start time, duration and host come from GET /meetings/{id}; when Zoom no longer has it (an ended instant meeting), the meeting is
// landed with what the event gave: the time of the event and no attendees.
import { fail } from "../../../host/src/routes/errors.ts";
import { api, bad, codeOf, ensure, first, intOrUndef, meetingIdOf, needHost, obj, strOrUndef, text, HANDLE } from "../projections.ts";
import type { Json, ZoomCtx } from "../projections.ts";

const TYPES = ["meeting.started", "meeting.ended", "recording.completed", "recording.transcript_completed", "endpoint.url_validation"] as const;
type EventType = (typeof TYPES)[number];

const utf8 = (v: string) => new TextEncoder().encode(v);

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, utf8(data)))).toString("hex");
}

/** What Zoom signs: `v0:<timestamp>:<raw body>`, HMAC-SHA256 with the webhook secret token, hex, prefixed `v0=`. */
export async function signatureOf(secret: string, timestamp: string, body: string): Promise<string> {
  return `v0=${await hmacHex(secret, `v0:${timestamp}:${body}`)}`;
}

export async function signatureMatches(secret: string, timestamp: string, body: string, signature: string): Promise<boolean> {
  const want = await signatureOf(secret, timestamp, body);
  if (want.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ signature.charCodeAt(i);   // the whole string is read whatever the first difference
  return diff === 0;
}

/** The answer to Zoom's endpoint validation challenge. */
export async function encryptedTokenOf(secret: string, plainToken: string): Promise<string> {
  return hmacHex(secret, plainToken);
}

interface Landed { meetingId: string; startsAt: number }

async function land(ctx: ZoomCtx, zoomId: string, at: number): Promise<Landed> {
  let m: Json = {};
  try {
    m = obj(await api(ctx, { path: `/meetings/${zoomId}` }));
  } catch (e) {
    if (codeOf(e) !== "validation.not_found") throw e;
  }
  const startsAt = Date.parse(text(m["start_time"])) || at;
  const duration = intOrUndef(m["duration"]);
  const host = text(m["host_email"]).toLowerCase();
  const join = text(m["join_url"]);
  const landed = obj(await ctx.call("meetings.ingest", {
    source: "zoom", providerRef: zoomId, title: strOrUndef(m["topic"]) ?? "Zoom meeting", startsAt, ...(duration !== undefined ? { endsAt: startsAt + duration * 60_000 } : {}),
    ...(/^https:\/\/\S+$/.test(join) ? { joinUrl: join } : {}), attendees: /^[^\s@]+@[^\s@]+$/.test(host) ? [{ email: host }] : [],
  }));
  const meetingId = text(landed["meetingId"]);
  if (!/^rec_[a-z0-9]+$/.test(meetingId)) throw fail("internal.unexpected", ctx.trace.traceId, { message: "The meeting could not be landed." });
  return { meetingId, startsAt };
}

export async function receiveWebhook(ctx: ZoomCtx, input: { eventId: string; type: string; meetingId?: string; uuid?: string; plainToken?: string; at: number }) {
  ensure(ctx);
  if (!TYPES.includes(input.type as EventType)) bad(ctx, "Zoom sends meeting started and ended, recording completed, transcript completed and the URL check.");
  if (typeof input.eventId !== "string" || input.eventId === "") bad(ctx, "An event names its id.");
  if (!Number.isSafeInteger(input.at)) bad(ctx, "An event has the time it happened.");
  if (input.type === "endpoint.url_validation") {
    if (typeof input.plainToken !== "string" || input.plainToken === "") bad(ctx, "The URL check carries a plain token.");
    return { accepted: true, encryptedToken: await encryptedTokenOf(await needHost(ctx).secret(ctx, HANDLE.webhook), input.plainToken) };
  }
  if (first(ctx.db.all(`SELECT * FROM zoom_event WHERE "eventId" = ?`, input.eventId))) return { accepted: true };   // sent twice: handled once
  const zoomId = meetingIdOf(ctx, input.meetingId);
  const { meetingId } = await land(ctx, zoomId, input.at);
  if (input.type === "meeting.started") await ctx.call("meetings.set_state", { meetingId, state: "live" });
  else if (input.type === "meeting.ended") await ctx.call("meetings.set_state", { meetingId, state: "ended" });
  else await ctx.call("meetings.attach_recording", { meetingId, source: "zoom", providerRef: zoomId });
  ctx.db.run(`INSERT OR IGNORE INTO zoom_event ("eventId", "type", "meetingId", "at") VALUES (?, ?, ?, ?)`, input.eventId, input.type, zoomId, ctx.now());
  ctx.emit("zoom.event_received", `entity/${input.eventId}`, { eventId: input.eventId, type: input.type, meetingId: zoomId });
  return { accepted: true };
}
