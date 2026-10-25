// The google capabilities built so far, by file: gmail.ts holds the Gmail calls and the mailbox pull, workspace.ts everything else.
export {
  createDraft, getAttachment, getMessage, getProfile, getThread, listHistory, listLabels, listMessages, modifyLabels, pullMailbox, sendMessage, stopWatch, trashMessage, watch,
} from "./gmail.ts";
export {
  calendarList, calendarStopWatch, calendarWatch, docBatch, docCreate, docGet, driveChanges, driveCopy, driveCreateFolder, driveDownload, driveExport, driveGet, driveList,
  drivePermissions, driveShare, driveStopWatch, driveTrash, driveUpload, driveWatch, dwdDisable, dwdMembers, dwdProbe, dwdScopes, dwdSetExcluded, dwdSetup, dwdStatus,
  eventCreate, eventDelete, eventGet, eventRespond, eventsList, eventUpdate, freeBusy, health, meetEntries, meetRecordings, meetRecords, meetSubscribe, meetTranscripts,
  receivePush, sheetAppend, sheetBatch, sheetCreate, sheetGet, sheetUpdate, sheetValues,
} from "./workspace.ts";
