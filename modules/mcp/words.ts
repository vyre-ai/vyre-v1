// What an outside app did, in plain words (lane r42-mcp, 19 Nov 2026): "Added a task", "Read 3 files". Built from the capability name alone, so a title, a field or a value never leaves a record: this is what Connected
// apps and the activity list show. Pure: no clock, no I/O.
type Kind = "add" | "read" | "change" | "remove" | "send" | "export" | "restore";
const KIND: ReadonlyArray<readonly [RegExp, Kind]> = [
  [/(^|[._])(delete|remove|trash|purge|purge_trashed|erase|cancel|withdraw|archive|revoke|clear)($|[._])/, "remove"],
  [/(^|[._])(restore)($|[._])/, "restore"],
  [/(^|[._])(export|export_start|download)($|[._])/, "export"],
  [/(^|[._])(send|remind|reply|forward|launch|invite|share|publish|deploy)($|[._])/, "send"],
  [/(^|[._])(create|add|put|make|post|save|upload|start|new|append|import|capture|request)($|[._])/, "add"],
  [
    /(^|[._])(update|set|edit|rename|move|label|pin|pause|mute|assign|transition|complete|tick|change|merge|resume|decide|apply|allow|deny|discuss|assist|adopt|setup)($|[._])/,
    "change",
  ],
  [
    /(^|[._])(get|read|list|query|search|find|recent|history|count|counts|view|describe|types|changes|brief|context|status|check|verify|today|image|policy|for_service|public_of)($|[._])/,
    "read",
  ],
];
const NOUN: Readonly<Record<string, readonly [string, string]>> = {
  records: ["a record", "records"],
  schema: ["a record type", "record types"],
  tasks: ["a task", "tasks"],
  goals: ["a goal", "goals"],
  files: ["a file", "files"],
  notes: ["a note", "notes"],
  chat: ["a chat", "chats"],
  threads: ["a chat", "chats"],
  channels: ["a channel", "channels"],
  calendar: ["a calendar event", "calendar events"],
  meetings: ["a meeting", "meetings"],
  memory: ["a memory", "memories"],
  automations: ["an Automation", "Automations"],
  runs: ["a run", "runs"],
  backup: ["everything in this Space", "everything in this Space"],
  hooks: ["a hook", "hooks"],
  browser: ["a browser connection", "browser connections"],
  telephony: ["a call or text", "calls and texts"],
  plugins: ["a plugin setting", "plugin settings"],
  gate: ["a Gate rule", "Gate rules"],
  settings: ["a setting", "settings"],
  esign: ["a document for signing", "documents for signing"],
  documents: ["a document", "documents"],
  mail: ["an email", "emails"],
  inbox: ["a message", "messages"],
  sites: ["a site", "sites"],
  skills: ["a skill", "skills"],
  agents: ["an agent", "agents"],
  projects: ["a project", "projects"],
  contacts: ["a contact", "contacts"],
  search: ["the Space", "the Space"],
  vault: ["a key", "keys"],
};
const PAST: Record<Kind, string> = {
  add: "Added",
  read: "Read",
  change: "Changed",
  remove: "Removed",
  send: "Sent",
  export: "Exported",
  restore: "Restored",
};
const WANTS: Record<Kind, string> = {
  add: "add",
  read: "read",
  change: "change",
  remove: "remove",
  send: "send",
  export: "export",
  restore: "restore",
};

/** The kind of act a capability is, and the thing it is about; null when neither is known. */
export function actOf(cap: string | undefined): { kind: Kind; noun: readonly [string, string] | null } | null {
  if (!cap) return null;
  const kind = KIND.find(([re]) => re.test(cap))?.[1];
  if (!kind) return null;
  return { kind, noun: NOUN[cap.split(".")[0] as string] ?? null };
}

/**
 * One line for what an app did. `count` is how many times in a row it did the same thing ("Read 3 files").
 * A call a person still has to answer reads as "Wants to ...", and a refused one as "Could not ...".
 */
export function doneWords(cap: string | undefined, outcome: "ok" | "error" | "held", count = 1): string {
  const act = actOf(cap);
  if (!act)
    return outcome === "held" ? "Wants to do something" : outcome === "error" ? "Tried something" : "Looked around";
  const n = Math.max(1, Math.floor(count));
  // a list, a search or a count reads many of them; a get reads one
  const many = (act.kind === "read" && !/\.get$/.test(cap as string)) || /purge/.test(cap as string);
  const noun = act.noun === null ? "something" : n > 1 ? `${n} ${act.noun[1]}` : many ? act.noun[1] : act.noun[0];
  if (outcome === "held") return `Wants to ${WANTS[act.kind]} ${noun}`;
  if (outcome === "error") return `Could not ${WANTS[act.kind]} ${noun}`;
  return `${PAST[act.kind]} ${noun}`;
}

/** Calls of the same kind on the same thing, in a row and close in time, count as one line. */
export function groupKey(cap: string | undefined): string {
  const act = actOf(cap);
  return act ? `${act.kind}:${(cap as string).split(".")[0]}` : "other";
}
