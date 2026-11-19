// The step form's field lists, in the order a person thinks (AUTOMATIONS-BUILD-RC29 round three, item 3). One entry per step kind the server lists: the fields that show, in order, with their
// words; a "+" before a name makes it a long field, a "~" puts it under Details. Anything the schema has that is not listed goes under Details with plain words. A kind with no entry here falls back to the
// schema's own order under plain labels (fallbackKinds() names them so a test and the report can say which). The step form is one component; kinds differ only by this table.
export interface FieldSpec {
  name: string;
  label: string;
  long: boolean;
  details: boolean;
}

const spec = (s: string): FieldSpec => {
  const long = s.startsWith("+");
  const details = s.startsWith("~") || s.startsWith("+~");
  const body = s.replace(/^[+~]+/, "");
  const i = body.indexOf(":");
  return { name: body.slice(0, i), label: body.slice(i + 1), long, details };
};

const T: Readonly<Record<string, readonly string[]>> = {
  send_email: [
    "to:To",
    "subject:Subject",
    "+body:Message",
    "~cc:Cc",
    "~fileIds:Attachments",
    "~draftOnly:Save as a draft only",
  ],
  send_sms: ["to:To", "+body:Message", "~sendAtOnce:Send at once"],
  post_message: ["channelId:Channel", "+text:Message", "~threadId:In the thread"],
  create_task: [
    "title:Title",
    "assigned:For",
    "due:Due",
    "+summary:Details",
    "~approver:Approver",
    "~reviewer:Reviewer",
    "~kind:Kind",
    "~wait:Wait for it to be done",
  ],
  approval: [
    "title:What needs approval",
    "approver:Who approves",
    "+summary:Details",
    "~reviewer:Reviewer",
    "~timeout:Wait at most",
  ],
  ai: [
    "+prompt:What to ask",
    "agentId:Who answers",
    "mode:Answer or task",
    "inputs:Give it",
    "~doneMeans:Done when",
    "~assigned:For",
    "~approver:Approver",
    "~escalateTo:If stuck, tell",
    "~nudgeMinutes:Nudge after (minutes)",
    "~outputSchema:Answer shape",
  ],
  "records.find": ["type:Record type", "filter:Where", "sort:Sorted by", "limit:How many"],
  "records.create": ["type:Record type", "fields:Set"],
  "records.update": ["type:Record type", "recordId:Which record", "patch:Change"],
  "records.relate": [],
  wait: [
    "forDuration:Wait for",
    "until:Wait until",
    "event:Wait for this to happen",
    "~hours:Only during these hours",
    "~timeout:Give up after",
  ],
  wait_stage: ["recordId:Which record", "stage:Stage", "~timeout:Give up after"],
  if: ["condition:If"],
  paths: ["paths:Paths", "~otherwise:Otherwise"],
  parallel: ["branches:Lanes", "~waitFor:Continue when"],
  loop: ["items:For each item in", "~concurrency:At a time", "~maxIterations:At most"],
  collect: ["items:Collect from", "fields:Keep"],
  group_by: ["items:Group", "by:By"],
  transform: ["value:Start from", "mapping:Make"],
  stop: ["outcome:Stop as", "+message:Say"],
  call_automation: ["automationId:Run", "trigger:Start it with", "payload:Give it"],
  code: ["language:Language", "+source:Code", "input:Give it", "~hosts:May reach"],
  http_request: [
    "method:Method",
    "url:Address",
    "auth:Sign in with",
    "json:Send",
    "text:Send as text",
    "query:Query",
    "~headers:Headers",
  ],
  connector_request: ["action:Do", "input:With", "~dryRun:Try without doing it"],
  sign: ["fileId:File to send", "signers:Who signs", "+message:Message", "~recordId:Record"],
  "files.create": ["name:Name", "folderId:Folder", "+content:Content", "~mime:Type"],
  "files.get": ["fileId:File"],
  "files.list": ["folder:Folder", "section:Where", "kind:Kind"],
  "files.copy": [],
  "files.move": [],
  "files.share": [],
  "forms.create": ["name:Name", "kind:Kind", "recordType:Record type"],
  "forms.list": ["folderId:Folder", "section:Where"],
  "forms.publish": ["formId:Form"],
  "calendar.create_event": [
    "title:Title",
    "startsAt:Starts",
    "endsAt:Ends",
    "attendees:Who comes",
    "location:Where",
    "+description:Details",
    "~calendarId:Calendar",
    "~allDay:All day",
    "~joinProvider:Video call",
    "~agenda:Agenda",
  ],
  "calendar.list_events": ["from:From", "to:To", "query:Search", "~calendarIds:Calendars"],
  start_journey: ["journeyId:Journey", "subjectRecordId:Record", "startStage:First stage"],
  "journeys.move_stage": ["journeyId:Journey", "recordId:Record", "toStage:Stage", "~reason:Why it moves"],
  "forms.link_create": [
    "formId:Form",
    "recordId:Record",
    "~singleUse:One use only",
    "~expiresInHours:Expires after (hours)",
  ],
  "sheet.add_rows": ["fileId:Spreadsheet", "sheet:Sheet", "rows:Rows"],
  "sheet.create": ["name:Name", "folderId:Folder", "columns:Columns", "~format:Format", "~sheet:Sheet"],
  "sheet.delete_rows": ["fileId:Spreadsheet", "sheet:Sheet", "rowId:Which row"],
  "sheet.find_rows": ["fileId:Spreadsheet", "sheet:Sheet", "where:Where", "~columns:Columns"],
  "sheet.read_all": ["fileId:Spreadsheet", "sheet:Sheet"],
  "sheet.update_rows": ["fileId:Spreadsheet", "sheet:Sheet", "rowId:Which row", "values:Set", "~key:Match on"],
  "github.issue.create": ["repo:Repository", "title:Title", "+body:Details", "~labels:Labels"],
  "github.issue.comment": ["repo:Repository", "number:Issue number", "+body:Comment"],
  "github.issue.assign_agent": ["recordId:Issue", "agentId:Agent"],
  "github.pull_request.get": [],
  "github.repos.list": ["query:Search", "~installationId:Account"],
  "google.gmail.send_message": [
    "to:To",
    "subject:Subject",
    "+text:Message",
    "~html:Formatted message",
    "~threadId:In the thread",
  ],
  "google.gmail.create_draft": [
    "to:To",
    "subject:Subject",
    "+text:Message",
    "~cc:Cc",
    "~bcc:Bcc",
    "~html:Formatted message",
    "~threadId:In the thread",
    "~as:From",
  ],
  "google.gmail.get_message": [],
  "google.calendar.get_event": ["calendarId:Calendar", "eventId:Event"],
  "google.drive.get_file": [],
  "google.gmail.list_messages": [],
  "google.calendar.create_event": [
    "summary:Title",
    "start:Starts",
    "end:Ends",
    "attendees:Who comes",
    "location:Where",
    "+description:Details",
    "~calendarId:Calendar",
    "~conference:Video call",
    "~sendUpdates:Tell guests",
  ],
  "google.calendar.list_events": ["timeMin:From", "timeMax:To", "q:Search", "~calendarId:Calendar"],
  "google.docs.create_document": ["title:Title", "parentId:Folder"],
  "google.drive.create_folder": ["name:Name", "parentId:Inside"],
  "google.drive.list_files": ["q:Search", "parentId:Inside", "~pageSize:How many"],
  "google.sheets.append_values": ["spreadsheetId:Spreadsheet", "range:Where", "values:Rows"],
  "google.sheets.get_values": [],
  "ms.mail.send_message": [],
  "ms.mail.create_draft": [],
  "ms.mail.get_message": [],
  "ms.mail.list_messages": ["search:Search", "folderId:Folder", "~top:How many"],
  "ms.calendar.create_event": [
    "subject:Title",
    "start:Starts",
    "end:Ends",
    "attendees:Who comes",
    "location:Where",
    "+body:Details",
    "~calendarId:Calendar",
    "~teamsMeeting:Video call",
  ],
  "ms.calendar.list_events": ["start:From", "end:To", "~calendarId:Calendar"],
  "ms.drive.create_folder": ["name:Name", "parentId:Inside", "~driveId:Drive"],
  "ms.drive.list_items": ["folderId:Inside", "~driveId:Drive"],
};
// object keys with dots are written as strings above; the two bare ones are normalised here
const TABLE: Record<string, readonly FieldSpec[]> = Object.fromEntries(
  Object.entries(T).map(([k, v]) => [k, v.map(spec)]),
);

export const hasEntry = (key: string): boolean => TABLE[key] !== undefined;
export const tableKinds = (): string[] => Object.keys(TABLE);

/** The step kinds a list of server kinds has no entry for: they fall back to the schema's order. */
export const fallbackKinds = (serverKinds: readonly string[]): string[] => serverKinds.filter((k) => !hasEntry(k));

/** The field list for a kind, or null when the kind falls back. */
export const fieldsOf = (key: string): readonly FieldSpec[] | null => TABLE[key] ?? null;
