// An Automation in ONE plain sentence, written from its definition: "When a customer's stage becomes Signed, email the customer and create a task." It is what the list shows under the name and what the page
// shows on top, so a person knows what an Automation does without opening its steps. Built by code from the saved steps, never from a description someone typed: what it says is what the definition does.
// lib/describe-flow.ts tells the same definition step by step (the card in chat); this file says it once.
// DECISION: the sentence names what starts it and the steps that DO something (send, write, ask). Steps that only read, decide or wait are left out; more than three doing steps reads "..., and 4 more steps".
import { idLike, plainKindTitle } from "./words/steps.ts";

export interface SentenceNode {
  id: string;
  key: string;
  title?: string | undefined;
  input?: Record<string, unknown> | undefined;
  next?: string[] | undefined;
  branches?: unknown[] | undefined;
}
export interface SentenceTrigger {
  key: string;
  config?: Record<string, unknown> | undefined;
  filter?: unknown;
}
export interface SentenceDefinition {
  triggers: SentenceTrigger[];
  nodes: SentenceNode[];
  start?: string[] | undefined;
}

/** Names the server (or the page) knows and the definition holds only as keys or ids. Every one is optional: without it the key is said as words. */
export interface SentenceNames {
  /** A record type's name for one of them: "customer". */ type?(key: string): string | undefined;
  /** A field's label on a type: "stage". */ field?(type: string | undefined, key: string): string | undefined;
  /** What a stored value of a choice or stage field is called: "Signed". */ value?(
    type: string | undefined,
    field: string,
    value: unknown,
  ): string | undefined;
  /** A thing by id: a form, a channel, a person, an agent, a Journey, another Automation. */ thing?(
    id: string,
  ): string | undefined;
  /** Step kind titles from the registry, for a kind this file has no words for. */ stepTitle?(
    key: string,
  ): string | undefined;
}

const words = (key: string): string => key.replace(/[_\-.]+/g, " ").trim().toLowerCase();
const cap = (s: string): string => (s === "" ? s : s[0]!.toUpperCase() + s.slice(1));
const lower = (s: string): string =>
  s.length > 1 && s[1] === s[1]!.toLowerCase() && !/^I\b/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s;
const an = (noun: string): string => `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A value a person typed, not a `{{ }}` read and not an id. */
const literal = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" && !v.includes("{{") && !idLike(v.trim()) ? v.trim() : undefined;
const orList = (xs: string[]): string =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;

const typeName = (names: SentenceNames, key: unknown): string =>
  typeof key === "string" && key !== "" ? (names.type?.(key) ?? words(key)).toLowerCase() : "record";
const fieldName = (names: SentenceNames, type: unknown, key: string): string =>
  (names.field?.(typeof type === "string" ? type : undefined, key) ?? words(key)).toLowerCase();
function valueName(names: SentenceNames, type: unknown, field: string, v: unknown): string {
  const said = names.value?.(typeof type === "string" ? type : undefined, field, v);
  if (said !== undefined && said !== "") return said;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return "set";
  if (idLike(v)) return names.thing?.(v) ?? "the one chosen";
  // a stored key ("not_hired") is said as words; what a person typed is kept as they typed it
  return /^[a-z0-9_]+$/.test(v) ? cap(words(v)) : v.length > 40 ? `${v.slice(0, 37).trimEnd()}…` : v;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const clock = (h: number, m: number): string =>
  `${h % 12 === 0 ? 12 : h % 12}${m === 0 ? "" : `:${String(m).padStart(2, "0")}`} ${h < 12 ? "am" : "pm"}`;
/** The common shapes of a five-part cron in words; anything else is "On a schedule". */
export function cronWords(cron: unknown): string {
  if (typeof cron !== "string") return "On a schedule";
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return "On a schedule";
  const [min, hour, dom, mon, dow] = p as [string, string, string, string, string];
  const every = /^\*\/(\d+)$/.exec(min);
  if (every && hour === "*" && dom === "*" && mon === "*" && dow === "*")
    return `Every ${every[1] === "1" ? "minute" : `${every[1]} minutes`}`;
  if (/^\d+$/.test(min) && hour === "*" && dom === "*" && mon === "*" && dow === "*") return "Every hour";
  const everyH = /^\*\/(\d+)$/.exec(hour);
  if (/^\d+$/.test(min) && everyH && dom === "*" && mon === "*" && dow === "*") return `Every ${everyH[1]} hours`;
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour) || mon !== "*") return "On a schedule";
  const at = clock(Number(hour), Number(min));
  if (dom === "*" && dow === "*") return `Every day at ${at}`;
  if (dom === "*" && /^(1-5|1,2,3,4,5)$/.test(dow)) return `Every weekday at ${at}`;
  if (dom === "*" && /^[0-7]$/.test(dow)) return `Every ${DAYS[Number(dow) % 7]} at ${at}`;
  if (/^\d+$/.test(dom) && dow === "*") return `On day ${dom} of every month at ${at}`;
  return "On a schedule";
}

/** What starts it. A record change says the type, and the field and value its filter waits for. */
function whenOf(t: SentenceTrigger, names: SentenceNames): string {
  const f = isRec(t.filter) ? t.filter : {};
  const c = isRec(t.config) ? t.config : {};
  switch (t.key) {
    case "record_change": {
      const type = typeName(names, f["type"]);
      const where = isRec(f["where"]) ? Object.entries(f["where"]) : [];
      const fields = Array.isArray(f["fields"]) ? f["fields"].filter((x): x is string => typeof x === "string") : [];
      const op = f["op"];
      if (op === "deleted") return `When ${an(type)} is deleted`;
      if (where.length > 0) {
        const said = where
          .slice(0, 2)
          .map(([k, v]) => `${fieldName(names, f["type"], k)} ${op === "created" ? "is" : "becomes"} ${valueName(names, f["type"], k, v)}`);
        return op === "created"
          ? `When ${an(type)} is added and its ${said.join(" and its ")}`
          : `When ${an(type)}’s ${said.join(" and its ")}`;
      }
      if (fields.length > 0 && op !== "created")
        return `When ${an(type)}’s ${orList(fields.slice(0, 3).map((k) => fieldName(names, f["type"], k)))} changes`;
      if (op === "created") return `When ${an(type)} is added`;
      if (op === "updated") return `When ${an(type)} changes`;
      return `When ${an(type)} is added or changes`;
    }
    case "form_submit": {
      const form = typeof f["formId"] === "string" ? names.thing?.(f["formId"]) : undefined;
      if (form) return `When the form ${form} is submitted`;
      if (typeof f["type"] === "string") return `When a form adds ${an(typeName(names, f["type"]))}`;
      return "When a form is submitted";
    }
    case "button": {
      const label = literal(c["label"]) ?? literal(f["label"]);
      return label ? `When someone presses ${label}` : "When someone presses its button";
    }
    case "schedule":
      return cronWords(c["cron"]);
    case "manual":
      return "When someone runs it by hand";
    case "webhook":
      return "When a web request arrives";
    case "email_received":
      return "When an email arrives";
    case "chat_message":
      return "When a chat message is posted";
    case "journey_stage_entered":
    case "journey_stage_left": {
      const stage = literal(f["stage"]);
      const verb = t.key === "journey_stage_entered" ? "enters" : "leaves";
      return stage ? `When a record ${verb} the stage ${cap(words(stage))}` : `When a record ${verb} a Journey stage`;
    }
    case "spreadsheet_row":
      return f["op"] === "added" ? "When a spreadsheet row is added" : "When a spreadsheet row is added or changed";
    case "meeting_transcript_ready":
      return "When a meeting transcript is ready";
    case "ci_check":
      return "When a CI check finishes";
    default:
      return `When ${words(t.key)}`;
  }
}

/** Steps that only read, decide, shape or wait: they are how it works, not what it does. */
const QUIET = new Set([
  "if",
  "paths",
  "parallel",
  "loop",
  "collect",
  "group_by",
  "transform",
  "wait",
  "wait_stage",
  "stop",
  "records.find",
  "files.get",
  "files.list",
  "forms.list",
  "calendar.list_events",
  "sheet.find_rows",
  "sheet.read_all",
]);
const quiet = (n: SentenceNode): boolean =>
  QUIET.has(n.key) ||
  /(^|\.)(list|get)(_|$)/.test(n.key.split(".").slice(-1)[0] ?? "") ||
  (n.key === "code" && !(Array.isArray(n.input?.["hosts"]) && n.input["hosts"].length > 0)) ||
  (n.key === "http_request" && /^(GET|HEAD)$/i.test(String(n.input?.["method"] ?? "GET")));

/** What one step does, as the middle of a sentence: "email the customer", "create a task for Lena". */
function doOf(n: SentenceNode, names: SentenceNames): string {
  const title = (n.title ?? "").trim();
  if (title !== "" && !idLike(title)) {
    const short = title.replace(/\s*\([^)]*\)\s*$/, "").replace(/[.:;]+$/, "");
    return lower(short.length > 64 ? `${short.slice(0, 61).trimEnd()}…` : short);
  }
  const i = n.input ?? {};
  switch (n.key) {
    case "send_email":
    case "google.gmail.send_message":
    case "ms.mail.send_message": {
      const to = literal(i["to"]);
      return i["draftOnly"] === true ? `draft an email${to ? ` to ${to}` : ""}` : `send an email${to ? ` to ${to}` : ""}`;
    }
    case "send_sms": {
      const to = literal(i["to"]);
      return `send a text${to ? ` to ${to}` : ""}`;
    }
    case "create_task": {
      const who = isRec(i["assigned"]) && typeof i["assigned"]["id"] === "string" ? names.thing?.(i["assigned"]["id"]) : undefined;
      return `create a task${who ? ` for ${who}` : ""}`;
    }
    case "records.create":
      return `add ${an(typeName(names, i["type"]))}`;
    case "records.update":
      return typeof i["type"] === "string" ? `update the ${typeName(names, i["type"])}` : "update a record";
    case "records.relate":
      return "link two records";
    case "post_message":
      return "post in chat";
    case "sign":
      return "send a file for signature";
    case "ai":
      return "ask the AI";
    case "approval":
      return "ask for approval";
    case "start_journey":
      return "start a Journey";
    case "journeys.move_stage": {
      const stage = literal(i["toStage"]);
      return stage ? `move it to ${cap(words(stage))}` : "move it to a stage";
    }
    case "call_automation": {
      const other = typeof i["automationId"] === "string" ? names.thing?.(i["automationId"]) : undefined;
      return other ? `run ${other}` : "run another automation";
    }
    case "forms.link_create":
      return "make a form link";
    case "http_request":
      return "call a web address";
    case "code":
      return "run a script";
    default:
      return lower(plainKindTitle(n.key, names.stepTitle?.(n.key)));
  }
}

/** The steps in the order they run: from the start, following next and branches, then any step nothing reached. */
export function inRunOrder<N extends SentenceNode>(def: { nodes: N[]; start?: string[] | undefined }): N[] {
  const byId = new Map(def.nodes.map((n) => [n.id, n] as const));
  const starts = (def.start && def.start.length ? def.start : def.nodes[0] ? [def.nodes[0].id] : []).filter((s) =>
    byId.has(s),
  );
  const seen = new Set<string>();
  const out: N[] = [];
  const queue = [...starts];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (!n) continue;
    out.push(n);
    for (const to of [
      ...(n.next ?? []),
      ...(n.branches ?? []).map((b) => (b as { to?: string }).to).filter((x): x is string => typeof x === "string"),
    ])
      queue.push(to);
  }
  for (const n of def.nodes) if (!seen.has(n.id)) out.push(n);
  return out;
}

/** The whole Automation in one sentence. */
export function flowSentence(def: SentenceDefinition, names: SentenceNames = {}): string {
  const triggers = def.triggers ?? [];
  const first = triggers[0];
  let when = first ? whenOf(first, names) : "When someone runs it by hand";
  if (triggers.length === 2) when += ` or ${lower(whenOf(triggers[1]!, names)).replace(/^when /, "")}`;
  else if (triggers.length > 2) when += `, or one of ${triggers.length - 1} other things happens`;
  const does: string[] = [];
  for (const n of inRunOrder(def)) {
    if (quiet(n)) continue;
    const d = doOf(n, names);
    if (d !== "" && !does.includes(d)) does.push(d);
  }
  if (def.nodes.length === 0) return `${when}, nothing happens yet.`;
  if (does.length === 0) return `${when}, it works through ${def.nodes.length === 1 ? "one step" : `${def.nodes.length} steps`}.`;
  const shown = does.length > 3 ? does.slice(0, 2) : does;
  const more = does.length - shown.length;
  const list =
    more > 0
      ? `${shown.join(", ")}, and ${more} more steps`
      : shown.length === 1
        ? shown[0]!
        : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return `${when}, ${list}.`;
}
