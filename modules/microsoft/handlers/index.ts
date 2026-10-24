// The microsoft capabilities, by file: graph.ts holds the per-member Graph calls and the mailbox pull; subscriptions.ts holds change
// subscriptions, the renewal Run, notification intake, consent and health.
export {
  calendarDelta, calendars, driveDelete, driveDelta, driveDownload, driveFolder, driveItem, driveItems, driveShare, driveUpload, eventCreate, eventDelete, eventGet, eventRespond,
  events, eventUpdate, mailAttachment, mailDelete, mailDelta, mailDraft, mailFolders, mailGet, mailMessages, mailMove, mailSend, mailUpdate, meetingTimes, pullMailbox,
  recordingGet, recordings, schedule, transcriptGet, transcripts,
} from "./graph.ts";
export {
  calendarSubscribe, calendarUnsubscribe, consentDisable, consentExclude, consentLink, consentMembers, consentSetup, consentSnippet, consentStatus, consentVerify, health,
  mailSubscribe, mailUnsubscribe, receiveNotification, renew, teamsSubscribe,
} from "./subscriptions.ts";
