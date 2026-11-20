import { capText, cutBlocks, stripTags } from "../../../lib/html-text.ts";
// What an agent reads back from the calendar and mail tools (Andrea's rc.20 report: "what is on my calendar this week and what needs a reply" took minutes and hundreds of thousands of tokens,
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
export const LIMITS: Readonly<Record<string, { dflt: number; max: number }>> = Object.freeze({
  "calendar.list_events": { dflt: 25, max: 100 },
  "inbox.list_by_thread": { dflt: 25, max: 100 },
  "inbox.list_by_contact": { dflt: 30, max: 100 },
  "inbox.threads": { dflt: 10, max: 30 },
  "inbox.thread": { dflt: 30, max: 100 },
  "mail.message.list": { dflt: 25, max: 100 },
  "mail.message.search": { dflt: 25, max: 100 },
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

export interface Shaped {
  data: unknown;
  meta: Meta;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const iso = (ms: number): string =>
  new Date(ms)
    .toISOString()
    .replace(/:00\.000Z$/, "Z")
    .replace(/\.000Z$/, "Z");
const oneLine = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const who = (a: unknown): string => {
  const o = obj(a);
  return str(o["name"]) || str(o["displayName"]) || str(o["address"]) || str(o["email"]);
};
const bytesOf = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;
const cut = (s: string, n: number): { text: string; cut?: number } =>
  s.length > n ? { text: s.slice(0, n), cut: s.length - n } : { text: s };
const strip = (html: string): string =>
  stripTags(
    cutBlocks(capText(html, 2_000_000), ["style", "script"], { repl: " " }).replace(
      /<br\s{0,16}\/?>|<\/p>|<\/div>|<\/li>/gi,
      "\n",
    ),
    " ",
  )
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

/** The input a list tool is called with: a default limit when the model gave none, and never above the ceiling. */
export function limited(cap: string, input: unknown): unknown {
  const l = LIMITS[cap];
  if (!l) return input;
  const o = input !== null && typeof input === "object" && !Array.isArray(input) ? { ...(input as Obj) } : {};
  const asked = typeof o["limit"] === "number" ? (o["limit"] as number) : l.dflt;
  o["limit"] = Math.max(1, Math.min(l.max, Math.floor(asked)));
  return o;
}

// ---------------------------------------------------------------- rows

function eventRow(e: Obj): Obj {
  const at = arr(e["attendees"])
    .map(who)
    .filter((s) => s !== "");
  const conf = obj(e["conference"]);
  const link = str(e["joinUrl"]) || str(conf["url"]);
  const row: Obj = {
    id: str(e["id"]),
    title: oneLine(str(e["title"]), 80),
    start: iso(num(e["startsAt"])),
    end: iso(num(e["endsAt"])),
  };
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
  const row: Obj = {
    id: str(m["id"]),
    thread: str(m["threadId"]),
    subject: oneLine(str(m["subject"]), 100),
    from: who(m["from"]),
    at: iso(num(m["sentAt"])),
    snippet: oneLine(str(m["snippet"]), SNIPPET),
  };
  if (m["direction"] === "out") row["sent"] = true;
  if (needsReply) row["needsReply"] = true;
  const status = str(m["status"]);
  if (status !== "" && status !== "received" && status !== "sent" && status !== "delivered") row["status"] = status;
  return row;
}

/** A message needs a reply when it is the newest of its thread in this page and it came in. */
function mailRows(list: unknown[]): Obj[] {
  const newest = new Map<string, Obj>();
  for (const m of list.map(obj)) {
    const t = str(m["threadId"]),
      cur = newest.get(t);
    if (!cur || num(m["sentAt"]) > num(cur["sentAt"])) newest.set(t, m);
  }
  return list.map(obj).map((m) => mailRow(m, m["direction"] === "in" && newest.get(str(m["threadId"])) === m));
}

function convoRow(c: Obj): Obj {
  const row: Obj = {
    id: str(c["id"]),
    name: str(c["displayName"]) || str(c["address"]),
    address: str(c["address"]),
    at: iso(num(c["lastMessageAt"])),
    via: str(c["lastChannel"]),
    preview: oneLine(str(c["lastPreview"]), SNIPPET),
  };
  if (num(c["unreadCount"]) > 0) row["unread"] = num(c["unreadCount"]);
  if (c["needsMatch"] === true) row["needsMatch"] = true;
  if (c["bounced"] === true) row["bounced"] = true;
  return row;
}

function threadRow(t: Obj): Obj {
  const msgs = arr(t["messages"]).map((x) => obj(obj(x)["message"]));
  const last = msgs.slice().sort((a, b) => num(b["at"]) - num(a["at"]))[0];
  const people = arr(t["participants"])
    .map(who)
    .filter((s) => s !== "");
  const row: Obj = {
    threadId: str(t["threadId"]),
    subject: oneLine(str(t["subject"]), 100),
    with: people.length > 3 ? [...people.slice(0, 3), `+${people.length - 3}`] : people,
    at: iso(num(t["lastAt"])),
    messages: num(t["messageCount"]) || msgs.length,
  };
  if (num(t["unread"]) > 0) row["unread"] = num(t["unread"]);
  if (last) {
    row["needsReply"] = last["direction"] === "in";
    row["last"] = { from: who(last["from"]), at: iso(num(last["at"])), snippet: oneLine(str(last["body"]), SNIPPET) };
  }
  return row;
}

// ---------------------------------------------------------------- the budget

/** Hold the rows under the budget: leave rows out from the end, and say how many and where to resume. */
function fit(
  key: string,
  rows: Obj[],
  head: Obj,
  resumeOf: ((first: Obj) => Record<string, number | string>) | undefined,
  meta: Omit<Meta, "bytes" | "count">,
): Shaped {
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

const paging = (o: Obj): Omit<Meta, "bytes" | "count"> => ({
  ...(typeof o["total"] === "number" ? { total: o["total"] as number } : {}),
  ...(typeof o["next"] === "string" ? { next: o["next"] as string } : {}),
});

// ---------------------------------------------------------------- one tool

function readEvent(o: Obj): Shaped {
  const e = obj(o["event"]),
    conf = obj(e["conference"]);
  const desc = cut(str(e["description"]), DESCRIPTION_CAP);
  const event: Obj = {
    ...eventRow(e),
    calendarId: str(e["calendarId"]),
    ...(str(e["organizer"]) !== "" ? { organizer: str(e["organizer"]) } : {}),
    attendees: arr(e["attendees"]).map((a) => {
      const x = obj(a);
      return {
        who: who(x),
        ...(str(x["response"]) !== "" ? { response: str(x["response"]) } : {}),
        ...(x["optional"] === true ? { optional: true } : {}),
      };
    }),
    ...(desc.text !== "" ? { description: desc.text, ...(desc.cut ? { descriptionCut: desc.cut } : {}) } : {}),
    ...(str(e["agenda"]) !== "" ? { agenda: oneLine(str(e["agenda"]), 1000) } : {}),
    ...(Object.keys(conf).length > 0
      ? {
          conference: {
            provider: str(conf["provider"]),
            ...(str(conf["url"]) !== "" ? { url: str(conf["url"]) } : {}),
            ...(str(conf["passcode"]) !== "" ? { passcode: str(conf["passcode"]) } : {}),
            dialIns: arr(conf["dialIns"]).slice(0, 2),
          },
        }
      : {}),
    ...(arr(e["recordIds"]).length > 0 ? { recordIds: arr(e["recordIds"]) } : {}),
    ...(str(e["meetingId"]) !== "" ? { meetingId: str(e["meetingId"]) } : {}),
  };
  const data: Obj = {
    event,
    ...(o["mine"] !== undefined ? { mine: o["mine"] } : {}),
    ...(o["repeats"] !== undefined ? { repeats: o["repeats"] } : {}),
  };
  return { data, meta: { count: 1, bytes: bytesOf(data) } };
}

function readMessage(o: Obj): Shaped {
  const m = obj(o["message"]);
  const body = str(o["text"]) !== "" ? str(o["text"]) : strip(str(o["html"]));
  const t = cut(body, READ_TEXT_CAP);
  const data: Obj = {
    message: { ...mailRow(m, false), to: arr(m["to"]).map(who), cc: arr(m["cc"]).map(who) },
    text: t.text,
    ...(t.cut ? { textCut: t.cut } : {}),
    attachments: arr(o["attachments"]).map((a) => {
      const x = obj(a);
      return { id: str(x["attachmentId"]), name: str(x["name"]), mime: str(x["mime"]), size: num(x["size"]) };
    }),
  };
  return { data, meta: { count: 1, bytes: bytesOf(data) } };
}

function readThread(o: Obj): Shaped {
  const msgs = arr(o["messages"])
    .map(obj)
    .map((m) => {
      const b = cut(str(m["body"]) !== "" ? str(m["body"]) : strip(str(m["html"])), MESSAGE_CAP);
      return {
        id: str(m["id"]),
        at: iso(num(m["at"])),
        ...(m["direction"] === "out" ? { sent: true } : {}),
        from: who(m["from"]),
        to: arr(m["to"]).map(who),
        ...(arr(m["cc"]).length > 0 ? { cc: arr(m["cc"]).map(who) } : {}),
        text: b.text,
        ...(b.cut ? { textCut: b.cut } : {}),
        ...(str(m["quoted"]) !== "" ? { quotedLeftOut: true } : {}),
        ...(arr(m["attachments"]).length > 0
          ? {
              attachments: arr(m["attachments"]).map((a) => {
                const x = obj(a);
                return { id: str(x["attachmentId"]), name: str(x["name"]), size: num(x["size"]) };
              }),
            }
          : {}),
      };
    });
  const last = arr(o["messages"])
    .map(obj)
    .sort((a, b) => num(b["at"]) - num(a["at"]))[0];
  const data: Obj = {
    threadId: str(o["threadId"]),
    subject: str(o["subject"]),
    with: arr(o["participants"]).map(who),
    needsReply: last?.["direction"] === "in",
    messages: msgs,
  };
  return { data, meta: { count: msgs.length, bytes: bytesOf(data) } };
}

/** A command's output up to this many characters reaches the model whole (about 1,500 tokens); past it, the model gets the shape below. */
export const RUN_WHOLE = 6_000;
/** The lines of a long output the model keeps from its end, and the longest a kept line is. */
export const RUN_TAIL = 40;
const RUN_LINE = 300;
/** The most lines that look like a failure that are named beside the tail. */
export const RUN_MATCHES = 20;
const FAILURE =
  /\berr(?:or|ors)?\b|[A-Za-z]Error\b|\bFAIL(?:ED|URES?|S)?\b|\bfailed\b|\bfatal\b|\bpanic\b|\bexception\b|\btraceback\b|\bdenied\b|\brefused\b|timed?\s*out|\bENOENT\b|\bEACCES\b|not found|no such file|\bkilled\b|segmentation fault|undefined reference|\bnot ok\b|^E\s{2,}|✖|✗/i;
/** A line that says nothing went wrong ("0 errors", "failed: 0", "no errors"). */
const CLEAN =
  /\b(?:0|no|zero)\s+(?:errors?|failed|failures?|failing)\b|\b(?:errors?|failed|failures?)\s*[:=]\s*0\b(?!\s+(?:files?|matches|matched|found|results?|items?|rows?|lines?)\b)/gi;
/** A line is a failure when it still looks like one after every "0 errors" phrase is taken out: "Tests run: 10, Failures: 2, Errors: 0" is one, "compiled with 0 errors" is not. */
const failing = (line: string): boolean => FAILURE.test(line.replace(CLEAN, " "));
/** Most characters of a line the model keeps; a longer line is cut and the cut is counted. */
const RUN_LINE_KEEP = RUN_LINE;
/** The most lines of terminal_read reaches (its own ceiling). */
const READ_MAX_LINES = 5_000;

/**
 * What a model reads of a long command's output (r42-runtime-tokens, DIRECTION-agent-runtime C: terminal output reaches the model only as a tail, a search or a summary, never whole). A short output is
 * returned as it is. A long one is `{ exitCode, lines, bytes, omitted, cutChars, matches, tail, read }`: the last 40 lines; up to 20 earlier lines that look like a failure (the first 5 and the last 15 when there are
 * more; lines that only say "0 errors" are not counted), each with its line number and how many lines from the end it is; every line cut for width marked and counted; and `read`, the terminal_read call that reaches
 * the earliest of them (or the plain statement that it is out of reach). The whole log stays in the tab; the people's own views and the hooks see the whole output, this is only the model's copy.
 */
function shapeRun(o: Obj): Shaped | null {
  const output = str(o["output"]);
  if (output.length <= RUN_WHOLE) return null;
  const lines = output.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  let cutChars = 0;
  const cutLine = (l: string): string => {
    if (l.length <= RUN_LINE_KEEP) return l;
    cutChars += l.length - RUN_LINE_KEEP;
    return `${l.slice(0, RUN_LINE_KEEP - 1)}…[+${l.length - RUN_LINE_KEEP + 1} more characters on this line]`;
  };
  const from = Math.max(0, lines.length - RUN_TAIL);
  // the retained log (terminal.log.read, r42-computer) answers a command it kept, by its command id; a build without it names no commandId and keeps terminal_read
  const logged = str(o["commandId"]) !== "";
  const hits: number[] = [];
  for (let i = 0; i < from; i++) if (failing(lines[i]!)) hits.push(i);
  const picked =
    hits.length <= RUN_MATCHES ? hits : [...hits.slice(0, 5), ...hits.slice(hits.length - (RUN_MATCHES - 5))];
  const matches = picked.map((i) => ({ line: i + 1, fromEnd: lines.length - i, text: cutLine(lines[i]!) }));
  const tail = lines.slice(from).map(cutLine);
  // a margin, because later output (a prompt, other commands in the shared scrollback) and wrapped rows push a line further back than its count
  const far = matches.reduce((n, m) => Math.max(n, m.fromEnd), 0);
  const reach = matches.length > 0 ? far + Math.ceil(far / 10) + 10 : Math.min(lines.length, 200);
  const data = {
    terminalId: str(o["terminalId"]),
    exitCode: typeof o["exitCode"] === "number" ? o["exitCode"] : null,
    ...(typeof o["exitCode"] === "number"
      ? {}
      : { noExitCode: "the command did not report an exit code (it was interrupted or timed out)" }),
    durationMs: num(o["durationMs"]),
    lines: lines.length,
    bytes: output.length,
    ...(o["truncated"] === true ? { startCut: true } : {}),
    omitted: from,
    ...(hits.length > picked.length ? { matchesNotShown: hits.length - picked.length } : {}),
    ...(cutChars > 0 ? { cutChars } : {}),
    note:
      o["truncated"] === true
        ? "Long output: only the end is here, and the start of the command's output was already lost, so line numbers count from the first line that was kept."
        : "Long output: only the end is here. Line numbers count from the first line of this command's output.",
    read: logged
      ? {
          tool: "terminal_log_read",
          terminalId: str(o["terminalId"]),
          commandId: str(o["commandId"]),
          how: "from and to with a line number from matches, or match (up to 5 words) with context, or tail; its line numbers are the same as in matches; it never returns the whole log; if it answers not found (the log is kept for 7 days and may be cut), use terminal_read",
        }
      : reach <= READ_MAX_LINES
        ? {
            tool: "terminal_read",
            lines: reach,
            covers: matches.length > 0 ? "at least every line named in matches" : "the last lines",
          }
        : {
            tool: "terminal_read",
            lines: READ_MAX_LINES,
            covers:
              "only the last 5000 lines: matches with fromEnd above 5000 are out of its reach, the rest are in it",
          },
    ...(matches.length > 0 ? { matches } : {}),
    tail,
  };
  return {
    data,
    meta: {
      count: tail.length,
      total: lines.length,
      bytes: bytesOf(data),
      omitted: from,
      read: logged ? "terminal_log_read" : "terminal_read",
    },
  };
}

/** The agent-facing shape of one capability's answer, or null when the capability is not one of the calendar and mail reads (it is returned as it is). */
export function shapeOutput(cap: string, output: unknown): Shaped | null {
  const o = obj(output);
  switch (cap) {
    case "calendar.list_events": {
      const rows = arr(o["events"]).map(obj).map(eventRow);
      return fit("events", rows, {}, (r) => ({ from: Date.parse(str(r["start"])) }), {
        ...paging(o),
        read: "calendar_get_event",
      });
    }
    case "calendar.get_event":
      return readEvent(o);
    case "inbox.list_by_thread": {
      const rows = arr(o["threads"])
        .map(obj)
        .map((t) => {
          const people = arr(t["participants"])
            .map(str)
            .filter((s) => s !== "");
          return {
            threadId: str(t["threadId"]),
            channel: str(t["channel"]),
            subject: oneLine(str(t["subject"]), 100),
            with: people.length > 3 ? [...people.slice(0, 3), `+${people.length - 3}`] : people,
            at: iso(num(t["lastAt"])),
            ...(num(t["unread"]) > 0 ? { unread: num(t["unread"]) } : {}),
          } as Obj;
        });
      return fit("threads", rows, {}, undefined, { ...paging(o), read: "mail_thread_get" });
    }
    case "inbox.list_by_contact":
      return fit("rows", arr(o["rows"]).map(obj).map(convoRow), {}, undefined, { ...paging(o), read: "inbox_threads" });
    case "inbox.threads":
      return fit(
        "threads",
        arr(o["threads"]).map(obj).map(threadRow),
        { conversation: convoRow(obj(o["conversation"])) },
        undefined,
        { ...paging(o), read: "mail_thread_get" },
      );
    case "inbox.thread": {
      const rows = arr(o["items"])
        .map(obj)
        .map(
          (i) =>
            ({
              kind: str(i["kind"]),
              id: str(i["id"]),
              at: iso(num(i["at"])),
              ...(str(i["direction"]) !== "" ? { direction: str(i["direction"]) } : {}),
              ...(str(i["title"]) !== "" ? { title: oneLine(str(i["title"]), 100) } : {}),
              ...(str(i["preview"]) !== "" ? { preview: oneLine(str(i["preview"]), SNIPPET) } : {}),
            }) as Obj,
        );
      return fit("items", rows, { conversation: convoRow(obj(o["conversation"])) }, undefined, {
        ...paging(o),
        read: "mail_message_get",
      });
    }
    case "mail.message.list":
    case "mail.message.search":
      return fit(
        "messages",
        mailRows(arr(o["messages"])),
        {},
        cap === "mail.message.search" ? (r) => ({ to: Date.parse(str(r["at"])) }) : undefined,
        { ...paging(o), read: "mail_message_get" },
      );
    case "mail.message.get":
      return readMessage(o);
    case "mail.thread.get":
      return readThread(o);
    case "terminal.run":
      return shapeRun(o);
    default:
      return null;
  }
}
