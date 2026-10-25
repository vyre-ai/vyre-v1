// google module entry (lane L5). The host serves the generated stubs while manifests/google.ts says `status: 'stub'`; the last google packet
// flips it to live once the generated contract tests pass against these handlers and the Workspace proof (S11 part A) is recorded.
// The host registers its half once at boot with setGoogleHost (token mint from the Vault key, member emails, blobs): see projections.ts.
import type { Handler } from "../../host/src/invoke.ts";
import * as h from "./handlers/index.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";
import { codecs, consumers, inline, setGoogleHost } from "./projections.ts";

export { setGoogleHost } from "./projections.ts";
export type { GoogleHost } from "./projections.ts";

export const handlers: Record<string, Handler> = {
  "google.dwd.status": (ctx) => h.dwdStatus(ctx),
  "google.dwd.scopes": (ctx) => h.dwdScopes(ctx),
  "google.dwd.setup": (ctx, i) => h.dwdSetup(ctx, i),
  "google.dwd.probe": (ctx, i) => h.dwdProbe(ctx, i),
  "google.dwd.members": (ctx, i) => h.dwdMembers(ctx, i),
  "google.dwd.set_excluded": (ctx, i) => h.dwdSetExcluded(ctx, i),
  "google.dwd.disable": (ctx) => h.dwdDisable(ctx),
  "google.health": (ctx, i) => h.health(ctx, i),
  "google.receive_push": (ctx, i) => h.receivePush(ctx, i),
  "google.gmail.get_profile": (ctx, i) => h.getProfile(ctx, i),
  "google.gmail.list_labels": (ctx, i) => h.listLabels(ctx, i),
  "google.gmail.list_messages": (ctx, i) => h.listMessages(ctx, i),
  "google.gmail.get_message": (ctx, i) => h.getMessage(ctx, i),
  "google.gmail.get_thread": (ctx, i) => h.getThread(ctx, i),
  "google.gmail.list_history": (ctx, i) => h.listHistory(ctx, i),
  "google.gmail.get_attachment": (ctx, i) => h.getAttachment(ctx, i),
  "google.gmail.modify_labels": (ctx, i) => h.modifyLabels(ctx, i),
  "google.gmail.create_draft": (ctx, i) => h.createDraft(ctx, i),
  "google.gmail.send_message": (ctx, i) => h.sendMessage(ctx, i),
  "google.gmail.trash_message": (ctx, i) => h.trashMessage(ctx, i),
  "google.gmail.watch": (ctx, i) => h.watch(ctx, i),
  "google.gmail.stop_watch": (ctx, i) => h.stopWatch(ctx, i),
  "google.calendar.list_calendars": (ctx, i) => h.calendarList(ctx, i),
  "google.calendar.list_events": (ctx, i) => h.eventsList(ctx, i),
  "google.calendar.get_event": (ctx, i) => h.eventGet(ctx, i),
  "google.calendar.create_event": (ctx, i) => h.eventCreate(ctx, i),
  "google.calendar.update_event": (ctx, i) => h.eventUpdate(ctx, i),
  "google.calendar.delete_event": (ctx, i) => h.eventDelete(ctx, i),
  "google.calendar.respond": (ctx, i) => h.eventRespond(ctx, i),
  "google.calendar.free_busy": (ctx, i) => h.freeBusy(ctx, i),
  "google.calendar.watch": (ctx, i) => h.calendarWatch(ctx, i),
  "google.calendar.stop_watch": (ctx, i) => h.calendarStopWatch(ctx, i),
  "google.drive.list_files": (ctx, i) => h.driveList(ctx, i),
  "google.drive.get_file": (ctx, i) => h.driveGet(ctx, i),
  "google.drive.download_file": (ctx, i) => h.driveDownload(ctx, i),
  "google.drive.export_file": (ctx, i) => h.driveExport(ctx, i),
  "google.drive.get_permissions": (ctx, i) => h.drivePermissions(ctx, i),
  "google.drive.upload_file": (ctx, i) => h.driveUpload(ctx, i),
  "google.drive.create_folder": (ctx, i) => h.driveCreateFolder(ctx, i),
  "google.drive.copy_file": (ctx, i) => h.driveCopy(ctx, i),
  "google.drive.share_file": (ctx, i) => h.driveShare(ctx, i),
  "google.drive.trash_file": (ctx, i) => h.driveTrash(ctx, i),
  "google.drive.changes_start_token": (ctx, i) => h.driveStartToken(ctx, i),
  "google.drive.list_changes": (ctx, i) => h.driveChanges(ctx, i),
  "google.drive.watch_changes": (ctx, i) => h.driveWatch(ctx, i),
  "google.drive.stop_watch": (ctx, i) => h.driveStopWatch(ctx, i),
  "google.sheets.get_spreadsheet": (ctx, i) => h.sheetGet(ctx, i),
  "google.sheets.get_values": (ctx, i) => h.sheetValues(ctx, i),
  "google.sheets.update_values": (ctx, i) => h.sheetUpdate(ctx, i),
  "google.sheets.append_values": (ctx, i) => h.sheetAppend(ctx, i),
  "google.sheets.create_spreadsheet": (ctx, i) => h.sheetCreate(ctx, i),
  "google.sheets.batch_update": (ctx, i) => h.sheetBatch(ctx, i),
  "google.docs.get_document": (ctx, i) => h.docGet(ctx, i),
  "google.docs.create_document": (ctx, i) => h.docCreate(ctx, i),
  "google.docs.batch_update": (ctx, i) => h.docBatch(ctx, i),
  "google.meet.list_conference_records": (ctx, i) => h.meetRecords(ctx, i),
  "google.meet.list_recordings": (ctx, i) => h.meetRecordings(ctx, i),
  "google.meet.list_transcripts": (ctx, i) => h.meetTranscripts(ctx, i),
  "google.meet.get_transcript_entries": (ctx, i) => h.meetEntries(ctx, i),
  "google.meet.subscribe": (ctx, i) => h.meetSubscribe(ctx, i),
};

export const projections = { inline, consumers };
export { codecs, inline, consumers };

/** Where the host registers its Google seam at boot (ruling 31): the loader reads this export. */
export const hostSeams: SeamSetters = { setGoogleHost };
