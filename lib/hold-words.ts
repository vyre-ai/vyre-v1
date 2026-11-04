// A held act in a person's words, in one place: the Gate titles the approval task with it and the card reads the same (lane l-chrome2a). "send message" is "send a message", "automations.read_link" is "open example.com",
// and no module name or raw field name is shown. Nothing here decides anything.
import { HOLD_PHRASES } from "./hold-phrases.ts";
import { outwardOf } from "./outward.ts";
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const VERBS = new Set(["send", "create", "add", "update", "delete", "remove", "post", "archive", "edit", "change", "set", "invite", "share", "schedule", "book", "cancel", "close", "open", "reply", "forward", "upload", "move", "rename", "assign", "complete", "resolve", "mark", "merge", "publish", "write", "make", "start", "stop", "approve", "reject", "submit", "save", "log", "fill", "attach", "replace", "pause", "resume", "enable", "disable", "connect", "disconnect", "transfer", "refund", "charge", "tag", "label", "star", "pin", "unpin", "react", "comment", "sync"]);
const aOrAn = (w: string): string => (/^[aeiou]/i.test(w) ? "an" : "a");

/** Turns the words of a tool or capability name into a short verb phrase a person reads: "send message" becomes "send a message", "create contact" becomes "create a contact". A plural or a phrase that already has its own article is left as it is; a name that does not start with a verb is shown as its words. */
export function verbPhrase(words: string): string {
  const w = words.trim().replace(/\s+/g, " ").toLowerCase();
  const [verb, ...rest] = w.split(" ");
  if (!verb || rest.length === 0 || !VERBS.has(verb)) return w;
  const noun = rest.join(" ");
  if (/^(a|an|the|all|my|your|this|that|any|some)\b/.test(noun) || /s$/.test(rest[rest.length - 1]!) || /\b(to|in|on|for|from|with|of)\b/.test(noun)) return `${verb} ${noun}`;
  return `${verb} ${aOrAn(noun)} ${noun}`;
}


/** The address a link points at, as a person says it: "example.com". */
export function hostOfLink(raw: string): string {
  try { return new URL(raw).hostname.replace(/^www\./, ""); } catch { return raw; }
}

/** Modules a person has no word for: a step in one of these never reads "in <module>". */
const INTERNAL_SCOPES: ReadonlySet<string> = new Set(["engine", "gate", "automations", "computers", "connectors", "agents", "kernel", "host", "memory", "providers", "browser", "watches"]);

const OLD_WANTS: Record<string, string> = {
  "chat.message_person": "send a message to a teammate",
  "engine.mcp.call": "use an outside tool", "engine.mcp.read": "read from an outside tool",
  "files.write": "edit", "files.create": "create", "files.delete": "delete", "files.move": "move", "files.rename": "rename", "files.folder.create": "create the folder",
  "records.update": "change", "records.create": "add a record", "records.delete": "delete",
  "mail.send": "send an email", "inbox.reply": "send a reply", "twilio.send": "send a text", "telephony.sms.send": "send a text",
  "stripe.refund.create": "refund a payment", "calendar.create_event": "add a calendar event", "calendar.update_event": "change a calendar event", "calendar.delete_event": "delete a calendar event",
  "git.push": "push your changes", "git.commit": "save your changes to the repository", "sites.promote": "put the site live", "engine.crew.merge": "merge a teammate's branch", "engine.crew.push": "push a teammate's branch",
};
/** What a card says after "wants to": the older short words where a subject follows ("delete Q4 pricing.docx"), else the table of every held capability. */
export const WANTS: Record<string, string> = { ...HOLD_PHRASES, ...OLD_WANTS };

/** A step with no entry of its own, in plain words: "tasks.create" is "create a task", "calendar.add_guest" is "add a guest on calendar", never the capability's own name. */
export function capPhrase(cap: string): string {
  const parts = cap.split(".").filter(Boolean);
  const action = (parts[parts.length - 1] ?? cap).replace(/[_-]+/g, " ");
  const scope = parts.length > 1 && !INTERNAL_SCOPES.has(parts[0]!) ? parts[0]!.replace(/[_-]+/g, " ") : "";
  const single = scope.replace(/ies$/, "y").replace(/s$/, "");
  const [verb, ...rest] = action.split(" ");
  if (verb && VERBS.has(verb) && rest.length === 0 && single) return verbPhrase(`${verb} ${single}`);
  const phrase = verbPhrase(action);
  return scope ? `${phrase} in ${scope}` : phrase;
}


/** Steps whose words depend on what they carry: opening a link names the site. */
export function wantsFromInput(cap: string, input: Obj | undefined): string | null {
  if (cap === "automations.read_link" || cap === "automations.try_read") {
    const url = str(obj(input)["url"]);
    return url ? `open ${hostOfLink(url)}` : "open a link";
  }
  if (cap === "automations.read_docs") return "read the documentation";
  return null;
}

/** The task's title for a held act: "Send a message" only for a message; a read of a link is "Open example.com". */
export function holdTitle(cap: string, input: unknown, actTitle?: string): string {
  const o = outwardOf(cap, input);
  if (o) return { message: "Send a message", email: "Send an email", text: "Send a text", post: "Post to a chat", event: "Add a calendar event" }[o.channel];
  const known = wantsFromInput(cap, obj(input)) ?? HOLD_PHRASES[cap] ?? WANTS[cap];
  if (!known && actTitle && actTitle !== "Send a message") return actTitle;   // the Gate's own name for the kind of act, unless that is the message one, which this is not
  const w = known ?? (cap === "" ? "do a step" : capPhrase(cap));
  return w.charAt(0).toUpperCase() + w.slice(1);
}
