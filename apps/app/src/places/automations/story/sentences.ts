// One sentence per step kind and trigger kind (AUTOMATIONS-BUILD-RC29 round four, item 1): a natural sentence with slots, so a row reads "Email to [Email], "Thanks, [Name]"" and not "Send an email: to ..., ...".
// {field} is a slot for that input; {a|b} takes the first that holds something; {field:dur} writes a duration in words. (...) is a group that shows only when every slot in it holds something.
// A top-level slot with nothing in it shows as a blank, so the sentence still reads and the orange line says what to add. A kind with no template falls back to its title (fallbackSentenceKinds names them).
const STEPS: Readonly<Record<string, string>> = {
  send_email: "Email to {to}(, “{subject|body}”)",
  send_sms: "Text to {to}(, “{body}”)",
  post_message: "Post in {channelId}(: {text})",
  create_task: "Create a task(: {title})( for {assigned})",
  approval: "Ask {approver} to approve(: {title})",
  ai: "Ask AI(: “{prompt}”)",
  "records.find": "Find in {type}( by {filter})",
  "records.create": "Create a {type} record",
  "records.update": "Update {recordId}( and set {patch})",
  "records.relate": "Link two records",
  wait: "Wait {forDuration:dur|until|forEvent}",
  wait_stage: "Wait for {recordId} to reach {stage}",
  if: "If {condition}",
  paths: "Choose a path(: {paths})",
  parallel: "Do these at the same time",
  loop: "For each item in {items}",
  collect: "Collect {fields}",
  group_by: "Group {items} by {by}",
  transform: "Transform {value}",
  stop: "Stop(: {message})",
  call_automation: "Run {automationId}",
  code: "Run code",
  http_request: "Send a {method} request to {url}",
  connector_request: "Do {action}",
  sign: "Send {fileId} for signature( to {signers})",
  "files.create": "Save {name} to {folderId}",
  "files.get": "Read {fileId}",
  "files.list": "List files( in {folder})",
  "files.copy": "Copy {fileId} to {toFolderId}",
  "files.move": "Move {fileId} to {toFolderId}",
  "files.share": "Share {fileId}",
  "forms.create": "Create a form {name}",
  "forms.list": "List forms",
  "forms.publish": "Publish {formId}",
  "calendar.create_event": "Schedule {title}( at {startsAt})",
  "calendar.list_events": "List events( from {from})",
  start_journey: "Start {journeyId} for {subjectRecordId}",
  "journeys.move_stage": "Move {recordId} to {toStage}",
  "forms.link_create": "Make a link to {formId} for {recordId}",
  "sheet.add_rows": "Add rows to {fileId}",
  "sheet.create": "Create the spreadsheet {name}",
  "sheet.delete_rows": "Delete a row from {fileId}",
  "sheet.find_rows": "Find rows in {fileId}",
  "sheet.read_all": "Read all rows of {fileId}",
  "sheet.update_rows": "Update rows in {fileId}",
  "github.issue.create": "Open an issue in {repo}(: {title})",
  "github.issue.comment": "Comment on issue {number} in {repo}",
  "github.issue.assign_agent": "Give {recordId} to {agentId}",
  "github.pull_request.get": "Read a pull request",
  "github.repos.list": "List repositories",
  "google.gmail.send_message": "Email to {to}(, “{subject|text}”)",
  "google.gmail.list_messages": "List Gmail messages",
  "google.gmail.create_draft": "Draft an email to {to}(, “{subject|text}”)",
  "google.gmail.get_message": "Read the Gmail message {messageId}",
  "google.calendar.get_event": "Read the calendar event {eventId}",
  "google.drive.get_file": "Read the Drive file {fileId}",
  "ms.mail.create_draft": "Draft an email to {to}(, “{subject|text}”)",
  "ms.mail.get_message": "Read the Outlook message {messageId}",
  "google.calendar.create_event": "Schedule {summary}( at {start})",
  "google.calendar.list_events": "List calendar events",
  "google.docs.create_document": "Create the document {title}",
  "google.drive.create_folder": "Create the folder {name}",
  "google.drive.list_files": "List Drive files",
  "google.sheets.append_values": "Add rows to {spreadsheetId}",
  "google.sheets.get_values": "Read sheet cells",
  "ms.mail.send_message": "Email to {to}(, “{subject|text}”)",
  "ms.mail.list_messages": "List Outlook messages",
  "ms.calendar.create_event": "Schedule {subject}( at {start})",
  "ms.calendar.list_events": "List calendar events",
  "ms.drive.create_folder": "Create the folder {name}",
  "ms.drive.list_items": "List OneDrive items",
};

/** The inputs a sentence reads that the step does not hold as one value: a Wait for an event says "for task completed", an HTTP request with no method is a GET. */
export function sentenceInput(key: string, input: Record<string, unknown>): Record<string, unknown> {
  if (key === "wait") {
    const e = input["event"];
    const name = e && typeof e === "object" ? (e as { event?: unknown }).event : undefined;
    return typeof name === "string" && name !== ""
      ? { ...input, forEvent: `for ${name.replace(/[._]+/g, " ").trim().toLowerCase()}` }
      : input;
  }
  if (key === "http_request" && typeof input["method"] !== "string") return { ...input, method: "GET" };
  return input;
}

/** What starts an Automation, as a sentence. A trigger's own setting, when it has one, follows after a colon. */
const TRIGGERS: Readonly<Record<string, string>> = {
  button: "A button is pressed",
  chat_message: "A chat message is posted",
  ci_check: "A CI check finishes",
  email_received: "An email is received",
  form_submit: "A form is submitted",
  journey_stage_entered: "A Journey record enters a stage",
  journey_stage_left: "A Journey record leaves a stage",
  manual: "Starts when you press Run now",
  meeting_transcript_ready: "A meeting transcript is ready",
  record_change: "A record changes",
  schedule: "On a schedule",
  spreadsheet_row: "A spreadsheet row is added or changed",
  webhook: "A web request arrives",
};

export const stepSentence = (key: string): string | null => STEPS[key] ?? null;
export const triggerSentence = (key: string): string | null => TRIGGERS[key] ?? null;
export const fallbackSentenceKinds = (kinds: readonly string[]): string[] =>
  kinds.filter((k) => STEPS[k] === undefined);
export const fallbackTriggerKinds = (kinds: readonly string[]): string[] =>
  kinds.filter((k) => TRIGGERS[k] === undefined);

/** A duration in words: "2d" is "2 days", "90m" is "90 minutes", "1h" is "1 hour". Anything else is kept as written. */
export function durationWords(raw: string): string {
  const m = /^\s*(\d+)\s*(s|m|h|d|w)\s*$/i.exec(raw);
  if (!m) return raw;
  const n = Number(m[1]);
  const unit = { s: "second", m: "minute", h: "hour", d: "day", w: "week" }[m[2]!.toLowerCase() as "s"]!;
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export interface Clause {
  /** Literal text. */ lit?: string;
  /** A slot: the input names to try, and how to write the value. */ slot?: { names: string[]; dur: boolean };
  /** A group that shows only when each of its slots holds something. */ group?: Clause[];
}

/** Parse a template into literals, slots and optional groups. */
export function parseTemplate(t: string): Clause[] {
  let at = 0;
  const run = (closer: string | null): Clause[] => {
    const out: Clause[] = [];
    let lit = "";
    const flush = (): void => {
      if (lit !== "") out.push({ lit });
      lit = "";
    };
    while (at < t.length) {
      const c = t[at]!;
      if (closer !== null && c === closer) {
        at += 1;
        break;
      }
      if (c === "(") {
        flush();
        at += 1;
        out.push({ group: run(")") });
      } else if (c === "{") {
        flush();
        const end = t.indexOf("}", at);
        const body = t.slice(at + 1, end);
        at = end + 1;
        const names = body.split("|").map((x) => x.replace(/:dur$/, ""));
        out.push({ slot: { names, dur: body.includes(":dur") } });
      } else {
        lit += c;
        at += 1;
      }
    }
    flush();
    return out;
  };
  return run(null);
}
