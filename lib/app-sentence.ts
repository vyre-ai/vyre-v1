// A sentence a person types in Automations ("when a form is submitted on my wordpress website, create a lead in Lawmatics") split into its trigger and its action clauses, in the order said (owner, 13 Nov 2026,
// AUTOMATIONS-2026-11-13 Part 4A and 4E). A PURE function: the skill and the screens both call it, and the check "does this channel, person, table, task or file exist in the Space" is passed in.
//
// It gives the skeleton and nothing more. It never guesses an app it does not know (an unknown capitalised name is accepted as a new app with its own name; an unknown short name is asked), never drops a clause
// it cannot place (it keeps it, marked unclear, with one question), and never builds a long chain (more than six actions, or two triggers, come back with a proposal to split). What each app CAN do is the model's job,
// read from the app's own documentation; the verb here is only the shape of the ask.

export type Exists = (kind: "channel" | "person" | "table" | "task" | "file", name: string) => boolean;

/** How an app was recognised: its name, a known short form, a near-miss spelling, an unknown name accepted as new, or an unknown short name that must be asked. */
export type AppHow = "name" | "alias" | "near" | "new" | "ask";
export interface AppMention {
  /** A stable lower-case key (slack, hubspot); the typed name in lower case for a new or asked app. */
  key: string;
  /** The full name to show. For an asked app, what was typed (no guess is put in its place). */
  name: string;
  /** Exactly what the person wrote. */
  typed: string;
  how: AppHow;
}

export interface Question {
  id: string;
  text: string;
  choices?: string[];
}

export type Act =
  | "message"
  | "sms"
  | "email"
  | "create_record"
  | "add_row"
  | "task"
  | "save_file"
  | "update_record"
  | "other";

export interface Place {
  kind: "vyre";
  what: "channel" | "chat" | "team" | "person" | "table" | "task" | "file";
  name?: string;
  exists?: boolean;
}

export interface Clause {
  /** 1-based, in the order said. */
  order: number;
  text: string;
  kind: "action" | "unclear";
  verb?: string;
  act?: Act;
  object?: string;
  /** "me" is the person asking; "team" is the Space's people. */
  to?: "me" | "team";
  apps: AppMention[];
  place?: Place;
  questions: Question[];
}

export interface Trigger {
  text: string;
  apps: AppMention[];
  questions: Question[];
}

export interface Skeleton {
  trigger: Trigger;
  clauses: Clause[];
  /** "I understood N things": every clause, the unclear ones included. */
  understood: number;
  unclear: number;
  split?: { reason: "too_many" | "two_triggers"; parts: Array<{ trigger: string; clauses: Clause[] }> };
}

export const MAX_ACTIONS = 6;

interface KnownApp {
  key: string;
  name: string;
  aliases: string[];
}
// The common apps and their short forms. A name that is not here is still accepted when it is capitalised after "in", "to", "into", "with" and the like (a new app, a letter tile), and asked when it is a short unknown.
const APPS: KnownApp[] = [
  { key: "wordpress", name: "WordPress", aliases: ["wp", "word press"] },
  { key: "slack", name: "Slack", aliases: [] },
  { key: "hubspot", name: "HubSpot", aliases: ["hub spot"] },
  { key: "salesforce", name: "Salesforce", aliases: ["sf", "sfdc"] },
  { key: "google-sheets", name: "Google Sheets", aliases: ["gsheets", "gsheet", "g sheets", "google sheet"] },
  { key: "google-drive", name: "Google Drive", aliases: ["gdrive", "g drive"] },
  { key: "google-calendar", name: "Google Calendar", aliases: ["gcal", "g cal"] },
  { key: "gmail", name: "Gmail", aliases: [] },
  { key: "microsoft-teams", name: "Microsoft Teams", aliases: ["ms teams"] },
  { key: "microsoft-365", name: "Microsoft 365", aliases: ["ms365", "ms 365", "office 365", "o365"] },
  { key: "outlook", name: "Outlook", aliases: [] },
  { key: "stripe", name: "Stripe", aliases: [] },
  { key: "notion", name: "Notion", aliases: [] },
  { key: "airtable", name: "Airtable", aliases: [] },
  { key: "mailchimp", name: "Mailchimp", aliases: [] },
  { key: "calendly", name: "Calendly", aliases: [] },
  { key: "zoom", name: "Zoom", aliases: [] },
  { key: "shopify", name: "Shopify", aliases: [] },
  { key: "quickbooks", name: "QuickBooks", aliases: ["qb", "qbo", "quick books"] },
  { key: "trello", name: "Trello", aliases: [] },
  { key: "asana", name: "Asana", aliases: [] },
  { key: "github", name: "GitHub", aliases: ["git hub"] },
  { key: "typeform", name: "Typeform", aliases: [] },
  { key: "zapier", name: "Zapier", aliases: [] },
  { key: "twilio", name: "Twilio", aliases: [] },
  { key: "wix", name: "Wix", aliases: [] },
  { key: "squarespace", name: "Squarespace", aliases: ["square space"] },
  { key: "notely", name: "Notely", aliases: [] },
];

const byPhrase = new Map<string, { app: KnownApp; how: "name" | "alias" }>();
for (const a of APPS) {
  byPhrase.set(a.name.toLowerCase(), { app: a, how: "name" });
  if (a.name.toLowerCase().replace(/ /g, "") !== a.name.toLowerCase())
    byPhrase.set(a.key.replace(/-/g, " "), { app: a, how: "name" });
  for (const al of a.aliases) byPhrase.set(al, { app: a, how: "alias" });
}
const nameNorms = APPS.map((a) => ({ app: a, norm: a.name.toLowerCase().replace(/[^a-z0-9]/g, "") }));

const PREPS = new Set(["in", "to", "into", "on", "via", "with", "using", "from", "through", "at", "onto"]);
const FILLERS = new Set(["my", "our", "your", "the", "a", "an", "this", "that", "their", "his", "her", "new"]);
// words that follow a preposition and are not an app
const NOT_APP = new Set([
  "me",
  "us",
  "you",
  "all",
  "it",
  "them",
  "chat",
  "vyre",
  "here",
  "team",
  "channel",
  "bulk",
  "order",
  "time",
  "full",
  "part",
  "one",
  "two",
  "mind",
  "sync",
  "real",
  "total",
  "case",
  "turn",
  "short",
  "person",
  "writing",
  "advance",
  "parallel",
  "background",
  "summary",
  "general",
  "private",
  "public",
  "web",
  "the",
  "my",
  "our",
  "your",
]);
const CAPS_NOT_APP = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "pdf",
  "sms",
  "url",
  "api",
  "csv",
  "id",
  "ok",
  "asap",
  "fyi",
  "vyre",
  "i",
]);

const VERBS = new Set([
  "send",
  "post",
  "tell",
  "notify",
  "message",
  "ping",
  "dm",
  "alert",
  "announce",
  "share",
  "email",
  "mail",
  "text",
  "sms",
  "create",
  "add",
  "submit",
  "make",
  "log",
  "save",
  "record",
  "push",
  "insert",
  "register",
  "enter",
  "update",
  "change",
  "set",
  "mark",
  "edit",
  "close",
  "archive",
  "delete",
  "remove",
  "assign",
  "forward",
  "copy",
  "upload",
  "store",
  "file",
  "book",
  "schedule",
  "invite",
  "open",
  "write",
  "put",
  "sync",
  "tag",
  "label",
  "move",
  "call",
  "reply",
  "respond",
  "start",
  "stop",
  "cancel",
  "generate",
  "draft",
  "summarize",
  "summarise",
]);
// a word that is a verb and also a noun: after "and" it is a field name when the clause before lists fields
const NOUNISH_VERBS = new Set([
  "email",
  "mail",
  "message",
  "text",
  "file",
  "record",
  "update",
  "log",
  "post",
  "share",
  "copy",
  "set",
  "mark",
  "store",
  "tag",
  "label",
  "open",
  "call",
  "draft",
  "start",
  "stop",
  "alert",
  "change",
  "schedule",
  "book",
]);
const FIELD_NOUNS = new Set([
  "name",
  "phone",
  "address",
  "number",
  "company",
  "subject",
  "title",
  "body",
  "notes",
  "note",
  "city",
  "state",
  "zip",
  "date",
  "time",
  "budget",
  "fields",
  "details",
]);
const DETERMINERS = new Set([
  "a",
  "an",
  "the",
  "my",
  "your",
  "our",
  "their",
  "his",
  "her",
  "its",
  "some",
  "any",
  "no",
  "each",
  "every",
  "one",
  "two",
  "three",
  "this",
  "that",
  "these",
  "those",
  "another",
  "other",
  "more",
]);
const OBJECT_NOUNS = [
  "lead",
  "contact",
  "deal",
  "customer",
  "client",
  "matter",
  "person",
  "ticket",
  "opportunity",
  "account",
  "company",
  "order",
  "invoice",
  "case",
  "message",
  "email",
  "row",
  "task",
  "file",
  "upload",
  "document",
  "note",
  "event",
  "meeting",
  "record",
];

const TRIGGER_LEAD = /^(?:when(?:ever)?|every time|each time|as soon as|once|if)\s+/i;
const TRIGGER_ANY = /^(?:when(?:ever)?|every time|each time|as soon as)\s+/i;
const FILLER_LEAD =
  /^(?:(?:and then|and also|and|then|also|it should|it must|it will|should|please|automatically|i want it to|i want to|let it)\s+)+/i;
const SEP = /(\s*,\s*(?:(?:and then|and also|and|then|also)\s+)?|\s+(?:and then|and also|and|then|also)\s+)/i;

const clean = (s: string): string =>
  s
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:]+|[\s,;:.!?]+$/g, "")
    .trim();
const firstWord = (s: string): string => (/^[#@]?[\w'’-]+/.exec(s.trim())?.[0] ?? "").toLowerCase();

function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

function nearApp(typed: string): KnownApp | undefined {
  const norm = typed.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (norm.length < 4) return undefined;
  let best: { app: KnownApp; d: number } | undefined;
  for (const { app, norm: n } of nameNorms) {
    if (n.length < 5) continue;
    const limit = n.length >= 8 ? 2 : 1;
    const d = distance(norm, n);
    if (d >= 1 && d <= limit && (!best || d < best.d)) best = { app, d };
  }
  return best?.app;
}

const isAcronym = (t: string): boolean =>
  /^[A-Za-z]{2,5}$/.test(t) &&
  !CAPS_NOT_APP.has(t.toLowerCase()) &&
  (!/[aeiouyAEIOUY]/.test(t) || t === t.toUpperCase());

const tokensOf = (s: string): string[] => s.match(/[#@]?[\w.'’-]+/g) ?? [];

function scanApps(text: string, ignore: ReadonlySet<string>): { apps: AppMention[]; questions: Question[] } {
  const tokens = tokensOf(text);
  const used = new Set<number>();
  const apps: AppMention[] = [];
  const add = (m: AppMention): void => {
    if (!apps.some((a) => a.key === m.key && a.typed.toLowerCase() === m.typed.toLowerCase())) apps.push(m);
  };
  const skip = (t: string): boolean =>
    /^[#@]/.test(t) || t.includes(".") || /^\d/.test(t) || ignore.has(t.toLowerCase());
  for (let i = 0; i < tokens.length; i++) {
    for (const n of [3, 2, 1]) {
      if (i + n > tokens.length) continue;
      const parts = tokens.slice(i, i + n);
      if (parts.some(skip)) continue;
      const phrase = parts.join(" ").toLowerCase();
      const hit = byPhrase.get(phrase);
      if (hit) {
        add({ key: hit.app.key, name: hit.app.name, typed: parts.join(" "), how: hit.how });
        for (let k = i; k < i + n; k++) used.add(k);
        i += n - 1;
        break;
      }
    }
  }
  const questions: Question[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!PREPS.has(tokens[i]!.toLowerCase())) continue;
    let j = i + 1;
    while (j < tokens.length && FILLERS.has(tokens[j]!.toLowerCase())) j++;
    const t = tokens[j];
    if (t === undefined || used.has(j) || skip(t) || NOT_APP.has(t.toLowerCase()) || PREPS.has(t.toLowerCase()))
      continue;
    const next = tokens[j + 1];
    if (next !== undefined && !used.has(j + 1) && !skip(next) && !PREPS.has(next.toLowerCase())) {
      const two = nearApp(`${t}${next}`);
      if (two && `${t}${next}`.length >= 8) {
        add({ key: two.key, name: two.name, typed: `${t} ${next}`, how: "near" });
        used.add(j);
        used.add(j + 1);
        continue;
      }
    }
    const near = nearApp(t);
    if (near) {
      add({ key: near.key, name: near.name, typed: t, how: "near" });
      used.add(j);
    } else if (isAcronym(t)) {
      add({ key: t.toLowerCase(), name: t, typed: t, how: "ask" });
      questions.push({ id: "which_app", text: `Which app is "${t}"?` });
      used.add(j);
    } else if (/^[A-Z][A-Za-z0-9]{2,}$/.test(t) && !CAPS_NOT_APP.has(t.toLowerCase()) && j > 0) {
      add({ key: t.toLowerCase(), name: t, typed: t, how: "new" });
      used.add(j);
    }
  }
  return { apps, questions };
}

const HERE =
  /\bhere\b|\bin vyre\b|\b(?:the )?team'?s? (?:channel|chat)\b|\bteam (?:channel|chat)\b|\bin (?:the )?chat\b|\b(?:to|for) the team\b|\bthe team\b/i;

function placeOf(
  text: string,
  apps: AppMention[],
  exists: Exists,
): { place?: Place; questions: Question[]; ignore: Set<string> } {
  const questions: Question[] = [];
  const ignore = new Set<string>();
  const ch = /#([\w-]+)/.exec(text);
  if (ch) {
    const name = ch[1]!.toLowerCase();
    const ex = exists("channel", name);
    if (ex) {
      if (apps.length > 0)
        questions.push({
          id: "vyre_or_outside",
          text: `Is #${name} in Vyre or in ${apps[0]!.name}?`,
          choices: ["Vyre", apps[0]!.name],
        });
      return { place: { kind: "vyre", what: "channel", name, exists: true }, questions, ignore };
    }
    if (apps.length === 0) {
      questions.push({ id: "no_such_channel", text: `There is no #${name} channel.` });
      return { place: { kind: "vyre", what: "channel", name, exists: false }, questions, ignore };
    }
    return { questions, ignore };
  }
  const thing = /(?:the\s+)?([A-Z][\w-]*(?:\s+[A-Z][\w-]*)*)\s+(table|task|file|folder)\b/.exec(text);
  if (thing && !byPhrase.has(thing[1]!.toLowerCase())) {
    const name = thing[1]!;
    const noun = thing[2]!;
    const what = noun === "table" ? "table" : noun === "task" ? "task" : "file";
    for (const w of name.split(/\s+/)) ignore.add(w.toLowerCase());
    const ex = exists(what, name);
    if (ex || apps.length === 0) {
      if (!ex) questions.push({ id: `no_such_${what}`, text: `There is no ${name} ${noun}.` });
      return { place: { kind: "vyre", what, name, exists: ex }, questions, ignore };
    }
    return { questions, ignore };
  }
  const who =
    /\b(?:message|tell|notify|ping|dm|email|assign(?: it| this)? to|forward to)\s+((?:[A-Z][a-z]+)(?:\s+[A-Z][a-z]+)*)/.exec(
      text,
    );
  if (who) {
    for (const w of who[1]!.split(/\s+/)) ignore.add(w.toLowerCase());
    if (exists("person", who[1]!))
      return { place: { kind: "vyre", what: "person", name: who[1]!, exists: true }, questions, ignore };
  }
  if (HERE.test(text)) {
    const what = /channel/i.test(text) ? "channel" : /\bchat\b/i.test(text) ? "chat" : "team";
    return { place: { kind: "vyre", what }, questions, ignore };
  }
  return { questions, ignore };
}

function actOf(words: string[], text: string): { act: Act; object?: string } {
  const lower = text.toLowerCase();
  const object = OBJECT_NOUNS.find((n) => words.includes(n) || words.includes(`${n}s`));
  const v = words[0] ?? "";
  const withObject = (act: Act): { act: Act; object?: string } => (object ? { act, object } : { act });
  if (/\brows?\b/.test(lower)) return withObject("add_row");
  if (/\btasks?\b/.test(lower) && /^(create|make|add|assign|open|new)$/.test(v)) return withObject("task");
  if (v === "email" || v === "mail" || /\be-?mails?\b/.test(lower)) return withObject("email");
  if (v === "text" || v === "sms" || /\b(?:a text|sms)\b/.test(lower)) return withObject("sms");
  if (/\b(?:upload|file|document|attachment|pdf)s?\b/.test(lower) && /^(save|upload|store|copy|put|file|move)$/.test(v))
    return withObject("save_file");
  if (/^(create|add|submit|make|log|save|record|push|insert|register|enter)$/.test(v))
    return withObject("create_record");
  if (/^(send|post|tell|notify|message|ping|dm|alert|announce|share|reply|respond)$/.test(v))
    return withObject("message");
  if (/^(update|change|set|mark|edit)$/.test(v)) return withObject("update_record");
  return withObject("other");
}

function analyse(raw: string, order: number, exists: Exists): Clause {
  const text = clean(raw);
  const words = (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter(Boolean);
  const verb = words[0] ?? "";
  const { apps: found, questions: appQuestions } = (() => {
    const p0 = placeOf(text, [], () => false);
    return scanApps(text, p0.ignore);
  })();
  const { place, questions: placeQuestions } = placeOf(text, found, exists);
  const apps = found;
  const base = { order, text, apps, questions: [] as Question[] };
  if (!VERBS.has(verb)) {
    return {
      ...base,
      kind: "unclear",
      ...(place ? { place } : {}),
      questions: [{ id: "say_again", text: "I did not understand this one." }],
    };
  }
  const { act, object } = actOf(words, text);
  const to: "me" | "team" | undefined = /\b(?:me|myself)\b/i.test(text)
    ? "me"
    : /\b(?:the team|everyone|our team)\b/i.test(text)
      ? "team"
      : undefined;
  return {
    ...base,
    kind: "action",
    verb,
    act,
    ...(object ? { object } : {}),
    ...(to ? { to } : {}),
    ...(place ? { place } : {}),
    questions: [...appQuestions, ...placeQuestions],
  };
}

function appsOfTrigger(text: string): Trigger {
  const { apps, questions } = scanApps(text, new Set());
  return { text, apps, questions };
}

interface Group {
  trigger: string;
  parts: string[];
}

function startsClause(prev: string, sep: string, next: string): boolean {
  const w = firstWord(next);
  if (w === "") return false;
  if (/\bthen\b/i.test(sep)) return true;
  if (/^[#@]/.test(w) || /^\d/.test(w) || DETERMINERS.has(w)) return false;
  if (byPhrase.has(w)) return false; // "and Slack": the next app of the same ask
  const listsFields = /\b(?:with|including|containing|plus|fields?)\b/i.test(prev);
  const lastWord = (prev.toLowerCase().match(/[a-z']+(?=\W*$)/) ?? [""])[0]!;
  if (NOUNISH_VERBS.has(w) && (listsFields || FIELD_NOUNS.has(lastWord))) return false;
  if (listsFields && !VERBS.has(w)) return false;
  return true;
}

function segment(actionText: string, initialTrigger: string): Group[] {
  const pieces = actionText.split(SEP);
  const groups: Group[] = [{ trigger: initialTrigger, parts: [] }];
  const last = (): Group => groups[groups.length - 1]!;
  let cur: string | undefined;
  let inTrigger = false;
  const flush = (): void => {
    if (cur !== undefined && clean(cur) !== "") last().parts.push(clean(cur));
    cur = undefined;
  };
  for (let k = 0; k * 2 < pieces.length; k++) {
    const seg = pieces[k * 2]!;
    const sep = k === 0 ? "" : pieces[k * 2 - 1]!;
    const body = clean(seg.replace(FILLER_LEAD, ""));
    if (k > 0 && TRIGGER_ANY.test(body)) {
      flush();
      groups.push({ trigger: clean(body.replace(TRIGGER_ANY, "")), parts: [] });
      inTrigger = true;
      continue;
    }
    if (inTrigger) {
      if (!/,|\bthen\b/i.test(sep)) {
        last().trigger = clean(`${last().trigger}${sep}${seg}`);
        continue;
      }
      inTrigger = false;
    }
    if (k === 0 || cur === undefined) {
      cur = body;
      continue;
    }
    if (startsClause(cur, sep, body)) {
      flush();
      cur = body;
    } else {
      cur = `${cur}${sep}${seg}`;
    }
  }
  flush();
  return groups;
}

const split = (list: Clause[], parts: number): Clause[][] => {
  const size = Math.ceil(list.length / parts);
  const out: Clause[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

export function parseSentence(sentence: string, exists: Exists): Skeleton {
  const full = clean(sentence);
  if (full === "") return { trigger: { text: "", apps: [], questions: [] }, clauses: [], understood: 0, unclear: 0 };
  let triggerText = "";
  let rest = full;
  const everyOnly = /^every\s+(?!time\b)/i.test(full);
  if (TRIGGER_LEAD.test(full) || everyOnly) {
    const body = everyOnly ? full : full.replace(TRIGGER_LEAD, "");
    const m = /^(.*?)(?:\s*,\s*|\s+then\s+)(.*)$/is.exec(body);
    if (m) {
      triggerText = clean(m[1]!);
      rest = m[2]!;
    } else {
      // no comma: the trigger ends where the first action verb starts
      const words = body.split(/\s+/);
      const at = words.findIndex(
        (w, i) =>
          i >= 2 &&
          /^(?:send|post|tell|notify|create|add|submit|save|email|text|message|ping|update|forward|make|log)$/i.test(w),
      );
      triggerText = clean(at > 0 ? words.slice(0, at).join(" ") : body);
      rest = at > 0 ? words.slice(at).join(" ") : "";
    }
  }
  const trigger: Trigger = triggerText
    ? appsOfTrigger(triggerText)
    : { text: "", apps: [], questions: [{ id: "no_trigger", text: "When should this run?" }] };
  const groups = segment(rest, triggerText);
  const built = groups.map((g) => g.parts.map((p, i) => analyse(p, i + 1, exists)));
  const clauses = built[0] ?? [];
  const understood = built.reduce((n, l) => n + l.length, 0);
  const unclear = built.reduce((n, l) => n + l.filter((c) => c.kind === "unclear").length, 0);
  const out: Skeleton = { trigger, clauses, understood, unclear };
  if (groups.length > 1) {
    out.split = { reason: "two_triggers", parts: groups.map((g, i) => ({ trigger: g.trigger, clauses: built[i]! })) };
  } else if (clauses.length > MAX_ACTIONS) {
    out.split = {
      reason: "too_many",
      parts: split(clauses, Math.ceil(clauses.length / MAX_ACTIONS)).map((c) => ({ trigger: triggerText, clauses: c })),
    };
  }
  return out;
}
