// meetings (lane L5). The host serves the generated stubs while host/modules.json says `status: 'stub'`; the flip to live is P-L5_LIVE's (ruling 25). A Meeting is a record; calendar and the provider
// connectors (zoom, google, microsoft) hand events and recordings over through meetings.ingest and meetings.attach_recording. No meeting bot in v1.
import type { Handler } from "../../host/src/invoke.ts";
import * as h from "./handlers/index.ts";

export { parseTranscript } from "./handlers/index.ts";

export const handlers: Record<string, Handler> = {
  "meetings.get": (ctx, i) => h.get(ctx, i),
  "meetings.list": (ctx, i) => h.listMeetings(ctx, i),
  "meetings.schedule": (ctx, i) => h.schedule(ctx, i),
  "meetings.cancel": (ctx, i) => h.cancel(ctx, i),
  "meetings.ingest": (ctx, i) => h.ingest(ctx, i),
  "meetings.set_state": (ctx, i) => h.setMeetingState(ctx, i),
  "meetings.merge": (ctx, i) => h.merge(ctx, i),
  "meetings.unmerge": (ctx, i) => h.unmerge(ctx, i),
  "meetings.match_attendees": (ctx, i) => h.matchAttendees(ctx, i),
  "meetings.attach_recording": (ctx, i) => h.attachRecording(ctx, i),
  "meetings.transcript.get": (ctx, i) => h.transcriptGet(ctx, i),
  "meetings.summarize": (ctx, i) => h.summarize(ctx, i),
  "meetings.set_summary": (ctx, i) => h.setSummary(ctx, i),
};

export const projections = { inline: {}, consumers: {} };
