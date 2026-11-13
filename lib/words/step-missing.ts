// What to do when a step is missing something it needs, in the words of the screen (owner, 13 Nov 2026: "Send for signature needs fileId" and a chip that said "error"). One entry per input a step cannot
// run without: what to do (a sentence that starts lower case, so it follows "<step>: ") and one to three words for the step card's chip. A field key such as fileId never reaches a person.
// The server writes the message (modules/automations/handlers/defs.ts) and the app reads the chip from it (chipForIssue); both read this table.
interface Missing {
  do: string;
  chip: string;
}

/** The same input, whichever step asks for it. */
const BY_FIELD: Readonly<Record<string, Missing>> = {
  connectionId: { do: "choose the account to use", chip: "Needs an account" },
  calendarId: { do: "choose the calendar", chip: "Needs a calendar" },
  title: { do: "add a title", chip: "Needs a title" },
  name: { do: "add a name", chip: "Needs a name" },
  startsAt: { do: "set when it starts", chip: "Needs a start" },
  endsAt: { do: "set when it ends", chip: "Needs an end" },
  start: { do: "set when the range starts", chip: "Needs a start" },
  end: { do: "set when the range ends", chip: "Needs an end" },
  from: { do: "set when the range starts", chip: "Needs a start" },
  to: { do: "add who to send it to", chip: "Needs a recipient" },
  subject: { do: "add a subject", chip: "Needs a subject" },
  body: { do: "write the message", chip: "Needs a message" },
  text: { do: "write the message", chip: "Needs a message" },
  prompt: { do: "say what to ask", chip: "Needs a question" },
  source: { do: "write the code to run", chip: "Needs code" },
  items: { do: "choose the list to go through", chip: "Needs a list" },
  by: { do: "choose what to group by", chip: "Needs a group" },
  condition: { do: "add the condition", chip: "Needs a condition" },
  branches: { do: "add at least two lanes", chip: "Needs lanes" },
  paths: { do: "add the paths", chip: "Needs paths" },
  connector: { do: "choose the connector", chip: "Needs a connector" },
  action: { do: "choose the action", chip: "Needs an action" },
  automationId: { do: "choose the automation to run", chip: "Needs an automation" },
  trigger: { do: "say what starts it", chip: "Needs a trigger" },
  assigned: { do: "choose who it is for", chip: "Needs a person" },
  approver: { do: "choose who approves", chip: "Needs an approver" },
  folderId: { do: "choose the folder", chip: "Needs a folder" },
  fileId: { do: "choose the file", chip: "Needs a file" },
  spreadsheetId: { do: "choose the spreadsheet", chip: "Needs a spreadsheet" },
  recordId: { do: "choose the record", chip: "Needs a record" },
  type: { do: "choose the record type", chip: "Needs a type" },
  recordType: { do: "choose the record type", chip: "Needs a type" },
  formId: { do: "choose the form", chip: "Needs a form" },
  kind: { do: "choose the kind", chip: "Needs a kind" },
  agentId: { do: "choose the agent", chip: "Needs an agent" },
  repo: { do: "choose the repository", chip: "Needs a repository" },
  number: { do: "add the issue number", chip: "Needs a number" },
  range: { do: "say which cells, for example A1:C10", chip: "Needs a range" },
  values: { do: "add the values to write", chip: "Needs values" },
  rows: { do: "add the rows", chip: "Needs rows" },
  rowId: { do: "choose the row", chip: "Needs a row" },
  columns: { do: "add the columns", chip: "Needs columns" },
  format: { do: "choose the file format", chip: "Needs a format" },
  fields: { do: "add the fields to set", chip: "Needs fields" },
  patch: { do: "add the changes to make", chip: "Needs changes" },
  method: { do: "choose the request method", chip: "Needs a method" },
  url: { do: "add the address", chip: "Needs an address" },
  value: { do: "add the value", chip: "Needs a value" },
  mapping: { do: "add how to map it", chip: "Needs a mapping" },
  journeyId: { do: "choose the Journey", chip: "Needs a Journey" },
  subjectRecordId: { do: "choose the record to follow", chip: "Needs a record" },
  stage: { do: "choose the stage", chip: "Needs a stage" },
  signers: { do: "add who signs", chip: "Needs signers" },
};

/** Where the same input means something more particular for one step. */
const BY_STEP: Readonly<Record<string, Missing>> = {
  "sign.fileId": { do: "choose the file to send for signature", chip: "Needs a file" },
  "sheet.add_rows.fileId": { do: "choose the spreadsheet to add rows to", chip: "Needs a spreadsheet" },
  "sheet.delete_rows.fileId": { do: "choose the spreadsheet to delete rows from", chip: "Needs a spreadsheet" },
  "sheet.find_rows.fileId": { do: "choose the spreadsheet to search", chip: "Needs a spreadsheet" },
  "sheet.read_all.fileId": { do: "choose the spreadsheet to read", chip: "Needs a spreadsheet" },
  "sheet.update_rows.fileId": { do: "choose the spreadsheet to change", chip: "Needs a spreadsheet" },
  "sheet.create.folderId": { do: "choose the folder for the new spreadsheet", chip: "Needs a folder" },
  "sheet.create.name": { do: "name the new spreadsheet", chip: "Needs a name" },
  "sheet.create.format": { do: "choose the spreadsheet format", chip: "Needs a format" },
  "files.get.fileId": { do: "choose the file to read", chip: "Needs a file" },
  "files.create.name": { do: "name the new file", chip: "Needs a name" },
  "files.create.folderId": { do: "choose the folder for the new file", chip: "Needs a folder" },
  "calendar.list_events.from": { do: "set when the range starts", chip: "Needs a start" },
  "calendar.list_events.to": { do: "set when the range ends", chip: "Needs an end" },
  "ai.prompt": { do: "say what to ask", chip: "Needs a question" },
  "approval.title": { do: "say what needs approval", chip: "Needs a description" },
  "call_automation.trigger": { do: "choose how to start the other automation", chip: "Needs a trigger" },
  "forms.create.kind": { do: "choose the kind of form", chip: "Needs a kind" },
  "forms.publish.formId": { do: "choose the form to publish", chip: "Needs a form" },
  "github.issue.assign_agent.recordId": { do: "choose the issue", chip: "Needs an issue" },
  "github.issue.comment.number": { do: "add the issue number", chip: "Needs a number" },
  "records.update.type": { do: "choose the record type", chip: "Needs a type" },
  "records.update.patch": { do: "add the changes to make", chip: "Needs changes" },
  "records.create.fields": { do: "add the fields to set", chip: "Needs fields" },
  "http_request.method": { do: "choose the request method", chip: "Needs a method" },
  "loop.items": { do: "choose the list to go through", chip: "Needs a list" },
  "paths.paths": { do: "add the paths", chip: "Needs paths" },
  "parallel.branches": { do: "add at least two lanes", chip: "Needs lanes" },
  "start_journey.subjectRecordId": { do: "choose the record to start the Journey for", chip: "Needs a record" },
  "wait_stage.recordId": { do: "choose the record to wait for", chip: "Needs a record" },
  "wait_stage.stage": { do: "choose the stage to wait for", chip: "Needs a stage" },
  "send_email.to": { do: "add who to send it to", chip: "Needs a recipient" },
  "send_sms.to": { do: "add the phone number to text", chip: "Needs a number" },
  "send_sms.body": { do: "write the text", chip: "Needs a message" },
  "post_message.text": { do: "write the message to post", chip: "Needs a message" },
};

/** Something a person cannot read: a field key (camelCase, snake_case or a trailing Id) rather than words. */
const KEYLIKE = /[a-z][A-Z]|_|\bId\b|[a-z]Id\b/;

/** What to do about one missing input of a step, and the card's chip for it. A field the table does not know still reads as words (never the key). */
export function missingInput(stepKey: string, field: string): Missing {
  const known = BY_STEP[`${stepKey}.${field}`] ?? BY_FIELD[field];
  if (known !== undefined) return known;
  const spaced = field
    .replace(/Id$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .trim();
  const noun = spaced === "" || KEYLIKE.test(spaced) ? "what it needs" : `the ${spaced}`;
  return { do: `fill in ${noun}`, chip: "Needs a detail" };
}

/** The sentence for a step that is missing an input: "Send for signature: choose the file to send for signature." */
export function missingMessage(title: string, stepKey: string, field: string): string {
  return `${title}: ${missingInput(stepKey, field).do}.`;
}

const CHIP_OF_DO = new Map<string, string>(
  [...Object.values(BY_STEP), ...Object.values(BY_FIELD)].map((m) => [`: ${m.do}.`, m.chip] as const),
);

/**
 * The chip a step card shows for what is wrong with it, in one to three words. A message the table wrote gives its own chip; a message that says "needs <something>" gives "Needs <something>";
 * anything else is "Needs a fix". Never the bare word "error".
 */
export function chipForIssue(message: string): string {
  for (const [tail, chip] of CHIP_OF_DO) if (message.endsWith(tail)) return chip;
  const needs = / needs ((?:a |an |the )?[^.,:]+?)\.?$/.exec(message);
  if (needs?.[1] !== undefined && needs[1].split(/\s+/).length <= 4) return `Needs ${needs[1].replace(/^the /, "a ")}`;
  return "Needs a fix";
}
