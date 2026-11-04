// What an agent reads back from the calendar and mail tools (Andrey's rc.20 report: "what is on my calendar this week and what needs a reply" took minutes and hundreds of thousands of tokens,
// because a list tool returned every raw description, HTML body, quoted history and attendee blob). The people's own views (the app) call the capabilities directly and are unchanged; this is only
// the shape the model gets, as `{ data, meta }`:
//   - a list is compact rows (events: title, start, end, who, location, link; mail: subject, from, date, a one-line snippet and needs-reply), never raw bodies, HTML, quoted text or blobs;
//   - one thing is read whole by its own tool (calendar_get_event, mail_message_get, mail_thread_get), with the raw HTML left out and very long text cut, saying so;
//   - a list has a default limit and a ceiling, meta says how many rows came back, how many exist, the next cursor and the size in bytes, and a result is held under RESULT_BUDGET by leaving rows out,
//     saying how many and where to resume.
// Pure functions, no clock and no I/O.

/** The most bytes of JSON a list tool returns to a model. A page of rows is shaped to fit; what does not fit is counted and how to get it is said. */
export const RESULT_BUDGET = 8 * 1024;
/** Longest one-line snippet or preview, and the cuts for long text read whole. */
export const SNIPPET = 160;
export const READ_TEXT_CAP = 20_000;
export const MESSAGE_CAP = 4_000;
export const DESCRIPTION_CAP = 4_000;

/** Rows a list returns when the model gives no limit, and the most it may ask for. */
export const LIMITS: Readonly<Record<string, { dflt: number; max: number; key?: string }>> = Object.freeze({
  "calendar.list_events": { dflt: 20, max: 100 },
  "inbox.list_by_thread": { dflt: 25, max: 100 },
  "inbox.list_by_contact": { dflt: 25, max: 100 },
  "inbox.threads": { dflt: 10, max: 30 },
  "inbox.thread": { dflt: 30, max: 100 },
  "mail.message.list": { dflt: 20, max: 100 },
  "mail.message.search": { dflt: 20, max: 100 },
  "records.search": { dflt: 20, max: 100 },
  "records.query": { dflt: 20, max: 100 },
  "files.list": { dflt: 30, max: 100 },
  "files.recent": { dflt: 20, max: 50 },
  "tasks.list": { dflt: 25, max: 100 },
  "memory.search": { dflt: 10, max: 30 },
  "memory.facts.list": { dflt: 25, max: 100 },
  "notes.search": { dflt: 15, max: 30 },
  "chat.messages.list": { dflt: 20, max: 60 },
  "chat.search": { dflt: 15, max: 30 },
  "chat.transcript.read": { dflt: 20, max: 60 },
  "chat.transcript.search": { dflt: 15, max: 30 },
  // a file is read a slice at a time: the text length, not a row count
  "files.read": { dflt: READ_TEXT_CAP, max: 100_000, key: "length" },
});

export interface Meta {
  /** Rows in `data`. */
  count: number;
  /** Rows that exist (when the server says), so a model knows whether to page. */
  total?: number;
  /** Pass as `cursor` for the next page. */
  next?: string;
  /** Size of `data` as JSON, in bytes. */
  bytes: number;
  /** Rows the server sent that did not fit the budget; ask again with a smaller range or `limit`, or `resume`. */
  omitted?: number;
  resume?: Record<string, number | string>;
  /** What to call to read one in full. */
  read?: string;
}

export interface Shaped { data: unknown; meta: Meta }

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const iso = (ms: number): string => new Date(ms).toISOString().replace(/:00\.000Z$/, "Z").replace(/\.000Z$/, "Z");
const oneLine = (s: string, n: number): string => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const who = (a: unknown): string => { const o = obj(a); return str(o["name"]) || str(o["displayName"]) || str(o["address"]) || str(o["email"]); };
const bytesOf = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;
const cut = (s: string, n: number): { text: string; cut?: number } => (s.length > n ? { text: s.slice(0, n), cut: s.length - n } : { text: s });
const strip = (html: string): string => html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

/** The input a list tool is called with: a default limit when the model gave none, and never above the ceiling. */
export function limited(cap: string, input: unknown): unknown {
  const l = LIMITS[cap];
  if (!l) return input;
  const o = input !== null && typeof input === "object" && !Array.isArray(input) ? { ...(input as Obj) } : {};
  const k = l.key ?? "limit";
  const asked = typeof o[k] === "number" ? (o[k] as number) : l.dflt;
  o[k] = Math.max(1, Math.min(l.max, Math.floor(asked)));
  return o;
}

// ---------------------------------------------------------------- rows

function eventRow(e: Obj): Obj {
  const at = arr(e["attendees"]).map(who).filter((s) => s !== "");
  const conf = obj(e["conference"]);
  const link = str(e["joinUrl"]) || str(conf["url"]);
  const row: Obj = { id: str(e["id"]), title: oneLine(str(e["title"]), 80), start: iso(num(e["startsAt"])), end: iso(num(e["endsAt"])) };
  if (e["allDay"] === true) row["allDay"] = true;
  if (at.length > 0) row["who"] = at.length > 4 ? [...at.slice(0, 4), `+${at.length - 4}`] : at;
  const loc = str(e["location"]);
  if (loc !== "") row["location"] = oneLine(loc, 60);
  if (link !== "") row["link"] = link;
  const status = str(e["status"]);
  if (status !== "" && status !== "confirmed") row["status"] = status;
  return row;
}

function mailRow(m: Obj, needsReply: boolean): Obj {
  const row: Obj = { id: str(m["id"]), thread: str(m["threadId"]), subject: oneLine(str(m["subject"]), 100), from: who(m["from"]), at: iso(num(m["sentAt"])), snippet: oneLine(str(m["snippet"]), SNIPPET) };
  if (m["direction"] === "out") row["sent"] = true;
  if (needsReply) row["needsReply"] = true;
  const status = str(m["status"]);
  if (status !== "" && status !== "received" && status !== "sent" && status !== "delivered") row["status"] = status;
  return row;
}

/** A message needs a reply when it is the newest of its thread in this page and it came in. */
function mailRows(list: unknown[]): Obj[] {
  const newest = new Map<string, Obj>();
  for (const m of list.map(obj)) { const t = str(m["threadId"]), cur = newest.get(t); if (!cur || num(m["sentAt"]) > num(cur["sentAt"])) newest.set(t, m); }
  return list.map(obj).map((m) => mailRow(m, m["direction"] === "in" && newest.get(str(m["threadId"])) === m));
}

function convoRow(c: Obj): Obj {
  const row: Obj = { id: str(c["id"]), name: str(c["displayName"]) || str(c["address"]), address: str(c["address"]), at: iso(num(c["lastMessageAt"])), via: str(c["lastChannel"]), preview: oneLine(str(c["lastPreview"]), SNIPPET) };
  if (num(c["unreadCount"]) > 0) row["unread"] = num(c["unreadCount"]);
  if (c["needsMatch"] === true) row["needsMatch"] = true;
  if (c["bounced"] === true) row["bounced"] = true;
  return row;
}

function threadRow(t: Obj): Obj {
  const msgs = arr(t["messages"]).map((x) => obj(obj(x)["message"]));
  const last = msgs.slice().sort((a, b) => num(b["at"]) - num(a["at"]))[0];
  const people = arr(t["participants"]).map(who).filter((s) => s !== "");
  const row: Obj = { threadId: str(t["threadId"]), subject: oneLine(str(t["subject"]), 100), with: people.length > 3 ? [...people.slice(0, 3), `+${people.length - 3}`] : people, at: iso(num(t["lastAt"])), messages: num(t["messageCount"]) || msgs.length };
  if (num(t["unread"]) > 0) row["unread"] = num(t["unread"]);
  if (last) {
    row["needsReply"] = last["direction"] === "in";
    row["last"] = { from: who(last["from"]), at: iso(num(last["at"])), snippet: oneLine(str(last["body"]), SNIPPET) };
  }
  return row;
}

// ---------------------------------------------------------------- records, files, tasks, memory, chat

/** A field value as one short thing: text cut, a list as its length, a nested object left out. */
function scalar(v: unknown): unknown {
  if (typeof v === "string") return oneLine(v, 100);
  if (typeof v === "number" || typeof v === "boolean" || v === null) return v;
  if (Array.isArray(v)) return v.length <= 3 && v.every((x) => typeof x === "string" || typeof x === "number") ? v.map((x) => (typeof x === "string" ? oneLine(x, 60) : x)) : `[${v.length}]`;
  return undefined;
}
function recordRow(r: Obj): Obj {
  const fields: Obj = {};
  let n = 0;
  for (const [k, v] of Object.entries(obj(r["fields"]))) { const x = scalar(v); if (x !== undefined && x !== "" && n < 8) { fields[k] = x; n++; } }
  return { id: str(r["id"]), type: str(r["type"]), updated: iso(num(r["updatedAt"])), ...(r["deletedAt"] !== undefined ? { deleted: true } : {}), fields };
}
function fileRow(f: Obj): Obj {
  return { id: str(f["fileId"]), name: oneLine(str(f["name"]), 100), kind: str(f["kind"]), size: num(f["size"]), updated: iso(num(f["updatedAt"])), folder: str(f["folderId"]), ...(f["conflict"] === true ? { conflict: true } : {}) };
}
function folderRow(f: Obj): Obj {
  return { id: str(f["folderId"]), path: oneLine(str(f["path"]) || str(f["name"]), 100), files: num(f["fileCount"]), folders: num(f["folderCount"]) };
}
function taskRow(t: Obj): Obj {
  const row: Obj = { id: str(t["id"]), title: oneLine(str(t["title"]), 100), state: str(t["state"]), kind: str(t["kind"]), assignee: str(obj(t["assigned"])["id"]) };
  if (num(t["due"]) > 0) row["due"] = iso(num(t["due"]));
  if (t["blocked"] === true) row["blocked"] = true;
  if (t["yourTurn"] === true) row["yourTurn"] = true;
  if (str(t["priority"]) !== "" && str(t["priority"]) !== "normal") row["priority"] = str(t["priority"]);
  if (str(t["summary"]) !== "") row["summary"] = oneLine(str(t["summary"]), 120);
  return row;
}
function hitRow(h: Obj): Obj {
  const id = str(h["noteId"]) || str(h["factId"]) || str(h["pageId"]);
  const row: Obj = { kind: str(h["kind"]), id, title: oneLine(str(h["title"]), 80), text: oneLine(str(h["text"]), 200), layer: str(h["layer"]), score: Math.round(num(h["score"]) * 100) / 100 };
  if (str(h["path"]) !== "") row["path"] = str(h["path"]);
  return row;
}
function chatMsgRow(m: Obj): Obj {
  const body = cut(str(m["body"]), 400);
  const row: Obj = { id: str(m["messageId"]), seq: num(m["threadSeq"]), by: str(obj(m["author"])["id"]), at: iso(num(m["createdAt"])), text: body.text };
  if (body.cut) row["textCut"] = body.cut;
  if (str(m["kind"]) !== "text" && str(m["kind"]) !== "") row["kind"] = str(m["kind"]);
  if (arr(m["blocks"]).length > 0) row["blocks"] = arr(m["blocks"]).map((b) => str(obj(b)["type"])).slice(0, 5);
  if (arr(m["attachments"]).length > 0) row["attachments"] = arr(m["attachments"]).length;
  return row;
}

function readFile(o: Obj): Shaped {
  const text = typeof o["text"] === "string" ? cut(o["text"] as string, READ_TEXT_CAP) : null;
  const data: Obj = { mime: str(o["mime"]), size: num(o["size"]), version: num(o["version"]), truncated: o["truncated"] === true || (text?.cut ?? 0) > 0 };
  if (text) { data["text"] = text.text; if (text.cut) data["textCut"] = text.cut; }
  if (typeof o["base64"] === "string") data["base64Omitted"] = (o["base64"] as string).length;
  if (typeof o["url"] === "string") data["url"] = o["url"];
  return { data, meta: { count: 1, bytes: bytesOf(data) } };
}

// ---------------------------------------------------------------- the budget

/** Hold the rows under the budget: leave rows out from the end, and say how many and where to resume. */
function fit(key: string, rows: Obj[], head: Obj, resumeOf: ((first: Obj) => Record<string, number | string>) | undefined, meta: Omit<Meta, "bytes" | "count">): Shaped {
  let keep = rows.length;
  const build = (n: number): Obj => ({ ...head, [key]: rows.slice(0, n) });
  while (keep > 1 && bytesOf(build(keep)) > RESULT_BUDGET) keep--;
  const data = build(keep);
  const omitted = rows.length - keep;
  const m: Meta = { ...meta, count: keep, bytes: bytesOf(data) };
  if (omitted > 0) {
    m.omitted = omitted;
    const nextRow = rows[keep];
    if (resumeOf && nextRow) m.resume = resumeOf(nextRow);
    // the server's own cursor skips the rows left out, so it is not offered when rows were
    delete m.next;
  }
  return { data, meta: m };
}

const paging = (o: Obj): Omit<Meta, "bytes" | "count"> => ({ ...(typeof o["total"] === "number" ? { total: o["total"] as number } : {}), ...(typeof o["next"] === "string" ? { next: o["next"] as string } : {}) });

// ---------------------------------------------------------------- one tool

function readEvent(o: Obj): Shaped {
  const e = obj(o["event"]), conf = obj(e["conference"]);
  const desc = cut(str(e["description"]), DESCRIPTION_CAP);
  const event: Obj = {
    ...eventRow(e), calendarId: str(e["calendarId"]),
    ...(str(e["organizer"]) !== "" ? { organizer: str(e["organizer"]) } : {}),
    attendees: arr(e["attendees"]).map((a) => { const x = obj(a); return { who: who(x), ...(str(x["response"]) !== "" ? { response: str(x["response"]) } : {}), ...(x["optional"] === true ? { optional: true } : {}) }; }),
    ...(desc.text !== "" ? { description: desc.text, ...(desc.cut ? { descriptionCut: desc.cut } : {}) } : {}),
    ...(str(e["agenda"]) !== "" ? { agenda: oneLine(str(e["agenda"]), 1000) } : {}),
    ...(Object.keys(conf).length > 0 ? { conference: { provider: str(conf["provider"]), ...(str(conf["url"]) !== "" ? { url: str(conf["url"]) } : {}), ...(str(conf["passcode"]) !== "" ? { passcode: str(conf["passcode"]) } : {}), dialIns: arr(conf["dialIns"]).slice(0, 2) } } : {}),
    ...(arr(e["recordIds"]).length > 0 ? { recordIds: arr(e["recordIds"]) } : {}),
    ...(str(e["meetingId"]) !== "" ? { meetingId: str(e["meetingId"]) } : {}),
  };
  const data: Obj = { event, ...(o["mine"] !== undefined ? { mine: o["mine"] } : {}), ...(o["repeats"] !== undefined ? { repeats: o["repeats"] } : {}) };
  return { data, meta: { count: 1, bytes: bytesOf(data) } };
}

function readMessage(o: Obj): Shaped {
  const m = obj(o["message"]);
  const body = str(o["text"]) !== "" ? str(o["text"]) : strip(str(o["html"]));
  const t = cut(body, READ_TEXT_CAP);
  const data: Obj = {
    message: { ...mailRow(m, false), to: arr(m["to"]).map(who), cc: arr(m["cc"]).map(who) },
    text: t.text, ...(t.cut ? { textCut: t.cut } : {}),
    attachments: arr(o["attachments"]).map((a) => { const x = obj(a); return { id: str(x["attachmentId"]), name: str(x["name"]), mime: str(x["mime"]), size: num(x["size"]) }; }),
  };
  return { data, meta: { count: 1, bytes: bytesOf(data) } };
}

function readThread(o: Obj): Shaped {
  const msgs = arr(o["messages"]).map(obj).map((m) => {
    const b = cut(str(m["body"]) !== "" ? str(m["body"]) : strip(str(m["html"])), MESSAGE_CAP);
    return {
      id: str(m["id"]), at: iso(num(m["at"])), ...(m["direction"] === "out" ? { sent: true } : {}), from: who(m["from"]), to: arr(m["to"]).map(who), ...(arr(m["cc"]).length > 0 ? { cc: arr(m["cc"]).map(who) } : {}),
      text: b.text, ...(b.cut ? { textCut: b.cut } : {}), ...(str(m["quoted"]) !== "" ? { quotedLeftOut: true } : {}),
      ...(arr(m["attachments"]).length > 0 ? { attachments: arr(m["attachments"]).map((a) => { const x = obj(a); return { id: str(x["attachmentId"]), name: str(x["name"]), size: num(x["size"]) }; }) } : {}),
    };
  });
  const last = arr(o["messages"]).map(obj).sort((a, b) => num(b["at"]) - num(a["at"]))[0];
  const data: Obj = { threadId: str(o["threadId"]), subject: str(o["subject"]), with: arr(o["participants"]).map(who), needsReply: last?.["direction"] === "in", messages: msgs };
  return { data, meta: { count: msgs.length, bytes: bytesOf(data) } };
}

const SHAPE_KEY: Readonly<Record<string, string>> = Object.freeze({
  "calendar.list_events": "events", "calendar.get_event": "event", "inbox.list_by_thread": "threads", "inbox.list_by_contact": "rows", "inbox.threads": "threads", "inbox.thread": "items",
  "mail.message.list": "messages", "mail.message.search": "messages", "mail.message.get": "message", "mail.thread.get": "messages", "records.search": "rows", "records.query": "rows", "records.get": "record",
  "files.list": "files", "files.recent": "files", "files.read": "mime", "tasks.list": "tasks", "memory.search": "hits", "memory.facts.list": "facts", "notes.search": "notes", "chat.messages.list": "messages",
  "chat.search": "hits", "chat.transcript.read": "markdown", "chat.transcript.search": "hits", "chat.recent": "today",
});

/** The agent-facing shape of one capability's answer, or null when the capability is not one of the calendar and mail reads (it is returned as it is). */
export function shapeOutput(cap: string, output: unknown): Shaped | null {
  const o = obj(output);
  // only an answer that has the shape of the capability's contract is shaped; anything else (an error body, a stand-in, a later contract) passes through as it is
  const need = SHAPE_KEY[cap];
  if (need === undefined || !(need in o)) return null;
  switch (cap) {
    case "calendar.list_events": {
      const rows = arr(o["events"]).map(obj).map(eventRow);
      return fit("events", rows, {}, (r) => ({ from: Date.parse(str(r["start"])) }), { ...paging(o), read: "calendar_get_event" });
    }
    case "calendar.get_event": return readEvent(o);
    case "inbox.list_by_thread": {
      const rows = arr(o["threads"]).map(obj).map((t) => {
        const people = arr(t["participants"]).map(str).filter((s) => s !== "");
        return { threadId: str(t["threadId"]), channel: str(t["channel"]), subject: oneLine(str(t["subject"]), 100), with: people.length > 3 ? [...people.slice(0, 3), `+${people.length - 3}`] : people, at: iso(num(t["lastAt"])), ...(num(t["unread"]) > 0 ? { unread: num(t["unread"]) } : {}) } as Obj;
      });
      return fit("threads", rows, {}, undefined, { ...paging(o), read: "mail_thread_get" });
    }
    case "inbox.list_by_contact": return fit("rows", arr(o["rows"]).map(obj).map(convoRow), {}, undefined, { ...paging(o), read: "inbox_threads" });
    case "inbox.threads": return fit("threads", arr(o["threads"]).map(obj).map(threadRow), { conversation: convoRow(obj(o["conversation"])) }, undefined, { ...paging(o), read: "mail_thread_get" });
    case "inbox.thread": {
      const rows = arr(o["items"]).map(obj).map((i) => ({ kind: str(i["kind"]), id: str(i["id"]), at: iso(num(i["at"])), ...(str(i["direction"]) !== "" ? { direction: str(i["direction"]) } : {}), ...(str(i["title"]) !== "" ? { title: oneLine(str(i["title"]), 100) } : {}), ...(str(i["preview"]) !== "" ? { preview: oneLine(str(i["preview"]), SNIPPET) } : {}) } as Obj));
      return fit("items", rows, { conversation: convoRow(obj(o["conversation"])) }, undefined, { ...paging(o), read: "mail_message_get" });
    }
    case "mail.message.list":
    case "mail.message.search": return fit("messages", mailRows(arr(o["messages"])), {}, cap === "mail.message.search" ? (r) => ({ to: Date.parse(str(r["at"])) }) : undefined, { ...paging(o), read: "mail_message_get" });
    case "mail.message.get": return readMessage(o);
    case "mail.thread.get": return readThread(o);
    case "records.search":
    case "records.query": return fit("rows", arr(o["rows"]).map(obj).map(recordRow), {}, undefined, { ...paging(o), read: "records_get" });
    case "records.get": {
      const r = obj(o["record"]);
      const fields: Obj = {};
      let cutFields = 0;
      for (const [k, v] of Object.entries(obj(r["fields"]))) {
        if (typeof v === "string") { const c = cut(v, 1000); fields[k] = c.text; if (c.cut) cutFields++; }
        else if (typeof v === "object" && v !== null && bytesOf(v) > 1000) { fields[k] = `[too long: ${bytesOf(v)} bytes]`; cutFields++; }
        else fields[k] = v;
      }
      const data: Obj = { record: { id: str(r["id"]), type: str(r["type"]), version: num(r["version"]), updated: iso(num(r["updatedAt"])), fields, ...(cutFields > 0 ? { fieldsCut: cutFields } : {}) } };
      return { data, meta: { count: 1, bytes: bytesOf(data) } };
    }
    case "files.list": {
      const folders = arr(o["folders"]).map(obj).map(folderRow).slice(0, 15);
      return fit("files", arr(o["files"]).map(obj).map(fileRow), { folders, ...(arr(o["folders"]).length > 15 ? { moreFolders: arr(o["folders"]).length - 15 } : {}) }, undefined, { ...paging(o), read: "files_read" });
    }
    case "files.recent": return fit("files", arr(o["files"]).map(obj).map(fileRow), {}, undefined, { read: "files_read" });
    case "files.read": return readFile(o);
    case "tasks.list": return fit("tasks", arr(o["tasks"]).map(obj).map(taskRow), {}, undefined, { ...paging(o), read: "tasks_get" });
    case "memory.search": return fit("hits", arr(o["hits"]).map(obj).map(hitRow), { ...(typeof o["locked"] === "string" ? { locked: o["locked"] } : {}) }, undefined, { read: "memory_page_get" });
    case "memory.facts.list": return fit("facts", arr(o["facts"]).map(obj).map((f) => ({ id: str(f["factId"]), text: oneLine(str(f["text"]), 200), layer: str(f["layer"]), status: str(f["status"]), since: iso(num(f["validFrom"])) } as Obj)), {}, undefined, { ...paging(o), read: "memory_fact_get" });
    case "notes.search": return fit("notes", arr(o["notes"]).map(obj).map((n) => ({ id: str(n["noteId"]), title: oneLine(str(n["title"]), 80), snippet: oneLine(str(n["snippet"]), SNIPPET), updated: iso(num(n["updatedAt"])) } as Obj)), {}, undefined, { read: "notes_get" });
    case "chat.messages.list": {
      const msgs = arr(o["messages"]).map(obj);
      const lo = msgs.reduce((m, x) => Math.min(m, num(x["threadSeq"])), Infinity);
      const r = fit("messages", msgs.map(chatMsgRow), {}, (row) => ({ before: num(row["seq"]) + 1 }), { read: "chat_message_get" });
      if (o["hasMore"] === true && r.meta.omitted === undefined && Number.isFinite(lo)) r.meta.resume = { before: lo };
      return r;
    }
    case "chat.search": return fit("hits", arr(o["hits"]).map(obj).map((h) => ({ id: str(h["messageId"]), thread: str(h["threadId"]), title: oneLine(str(obj(h["thread"])["title"]) || str(obj(h["thread"])["channelName"]), 60), seq: num(h["threadSeq"]), by: str(obj(h["author"])["id"]), at: iso(num(h["at"])), snippet: oneLine(str(h["snippet"]), SNIPPET) } as Obj)), {}, undefined, { read: "chat_messages_list" });
    case "chat.transcript.search": return fit("hits", arr(o["hits"]).map(obj).map((h) => ({ thread: str(h["threadId"]), idx: num(h["idx"]), role: str(h["role"]), at: iso(num(h["at"])), snippet: oneLine(str(h["snippet"]), SNIPPET) } as Obj)), {}, undefined, { read: "transcript_read" });
    case "chat.transcript.read": {
      const md = cut(str(o["markdown"]), READ_TEXT_CAP);
      const data: Obj = { markdown: md.text, ...(md.cut ? { markdownCut: md.cut } : {}), ...(typeof o["next"] === "number" ? { next: o["next"] } : {}) };
      return { data, meta: { count: 1, bytes: bytesOf(data) } };
    }
    case "chat.recent": {
      const out: Obj[] = [];
      for (const g of ["starred", "today", "yesterday", "earlier"]) for (const t of arr(o[g]).map(obj)) out.push({ id: str(t["threadId"]), group: g, title: oneLine(str(t["title"]), 80), kind: str(t["kind"]), ...(num(t["unread"]) > 0 ? { unread: num(t["unread"]) } : {}), at: iso(num(t["lastAt"])), ...(str(t["preview"]) !== "" ? { preview: oneLine(str(t["preview"]), 100) } : {}) });
      return fit("threads", out.slice(0, 40), {}, undefined, { total: out.length, read: "chat_messages_list" });
    }
    default: return null;
  }
}
