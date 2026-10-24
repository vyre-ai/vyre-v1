// microsoft module entry (lane L5). The host serves the generated stubs while manifests/microsoft.ts says `status: 'stub'`; the last microsoft
// packet flips it to live once the generated contract tests pass against these handlers and the tenant proof (S11 part B) is recorded.
// The host registers its half once at boot with setMsHost (application token from the Vault app registration, member emails, blobs): see projections.ts.
import type { Handler } from "../../host/src/invoke.ts";
import * as h from "./handlers/index.ts";
import { codecs, consumers, inline } from "./projections.ts";

export { setMsHost } from "./projections.ts";
export type { MsHost } from "./projections.ts";

export const handlers: Record<string, Handler> = {
  "ms.consent.status": (ctx) => h.consentStatus(ctx),
  "ms.consent.link": (ctx, i) => h.consentLink(ctx, i),
  "ms.consent.policy_snippet": (ctx) => h.consentSnippet(ctx),
  "ms.consent.setup": (ctx, i) => h.consentSetup(ctx, i),
  "ms.consent.verify": (ctx, i) => h.consentVerify(ctx, i),
  "ms.consent.members": (ctx, i) => h.consentMembers(ctx, i),
  "ms.consent.set_excluded": (ctx, i) => h.consentExclude(ctx, i),
  "ms.consent.disable": (ctx) => h.consentDisable(ctx),
  "ms.health": (ctx) => h.health(ctx),
  "ms.receive_notification": (ctx, i) => h.receiveNotification(ctx, i),
  "ms.subscriptions.renew": (ctx) => h.renew(ctx),
  "ms.mail.list_folders": (ctx, i) => h.mailFolders(ctx, i),
  "ms.mail.list_messages": (ctx, i) => h.mailMessages(ctx, i),
  "ms.mail.get_message": (ctx, i) => h.mailGet(ctx, i),
  "ms.mail.delta": (ctx, i) => h.mailDelta(ctx, i),
  "ms.mail.get_attachment": (ctx, i) => h.mailAttachment(ctx, i),
  "ms.mail.update_message": (ctx, i) => h.mailUpdate(ctx, i),
  "ms.mail.move_message": (ctx, i) => h.mailMove(ctx, i),
  "ms.mail.create_draft": (ctx, i) => h.mailDraft(ctx, i),
  "ms.mail.send_message": (ctx, i) => h.mailSend(ctx, i),
  "ms.mail.delete_message": (ctx, i) => h.mailDelete(ctx, i),
  "ms.mail.subscribe": (ctx, i) => h.mailSubscribe(ctx, i),
  "ms.mail.unsubscribe": (ctx, i) => h.mailUnsubscribe(ctx, i),
  "ms.calendar.list_calendars": (ctx, i) => h.calendars(ctx, i),
  "ms.calendar.list_events": (ctx, i) => h.events(ctx, i),
  "ms.calendar.get_event": (ctx, i) => h.eventGet(ctx, i),
  "ms.calendar.delta": (ctx, i) => h.calendarDelta(ctx, i),
  "ms.calendar.create_event": (ctx, i) => h.eventCreate(ctx, i),
  "ms.calendar.update_event": (ctx, i) => h.eventUpdate(ctx, i),
  "ms.calendar.delete_event": (ctx, i) => h.eventDelete(ctx, i),
  "ms.calendar.respond": (ctx, i) => h.eventRespond(ctx, i),
  "ms.calendar.get_schedule": (ctx, i) => h.schedule(ctx, i),
  "ms.calendar.find_meeting_times": (ctx, i) => h.meetingTimes(ctx, i),
  "ms.calendar.subscribe": (ctx, i) => h.calendarSubscribe(ctx, i),
  "ms.calendar.unsubscribe": (ctx, i) => h.calendarUnsubscribe(ctx, i),
  "ms.drive.list_items": (ctx, i) => h.driveItems(ctx, i),
  "ms.drive.get_item": (ctx, i) => h.driveItem(ctx, i),
  "ms.drive.download_item": (ctx, i) => h.driveDownload(ctx, i),
  "ms.drive.delta": (ctx, i) => h.driveDelta(ctx, i),
  "ms.drive.upload_item": (ctx, i) => h.driveUpload(ctx, i),
  "ms.drive.create_folder": (ctx, i) => h.driveFolder(ctx, i),
  "ms.drive.share_item": (ctx, i) => h.driveShare(ctx, i),
  "ms.drive.delete_item": (ctx, i) => h.driveDelete(ctx, i),
  "ms.teams.recordings.list_recordings": (ctx, i) => h.recordings(ctx, i),
  "ms.teams.recordings.get_recording": (ctx, i) => h.recordingGet(ctx, i),
  "ms.teams.recordings.list_transcripts": (ctx, i) => h.transcripts(ctx, i),
  "ms.teams.recordings.get_transcript": (ctx, i) => h.transcriptGet(ctx, i),
  "ms.teams.recordings.subscribe": (ctx, i) => h.teamsSubscribe(ctx, i),
};

export const projections = { inline, consumers };
export { codecs, inline, consumers };
