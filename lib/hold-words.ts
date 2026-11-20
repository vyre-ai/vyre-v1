// A held act in a person's words, in one place: the Gate titles the approval task with it and the card reads the same (lane l-chrome2a). "send message" is "send a message", "automations.read_link" is "open example.com",
// and no module name or raw field name is shown. Nothing here decides anything.
import { visibleText } from "./visible-text.ts";
import { HOLD_PHRASES } from "./hold-phrases.ts";
import { validZone, zoneName } from "./zones.ts";
import { outwardOf } from "./outward.ts";
import { KEY_HOST_CAPS, envHandles, keyReadHost, keySendOf } from "./key-target.ts";
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const VERBS = new Set([
  "send",
  "create",
  "add",
  "update",
  "delete",
  "remove",
  "post",
  "archive",
  "edit",
  "change",
  "set",
  "invite",
  "share",
  "schedule",
  "book",
  "cancel",
  "close",
  "open",
  "reply",
  "forward",
  "upload",
  "move",
  "rename",
  "assign",
  "complete",
  "resolve",
  "mark",
  "merge",
  "publish",
  "write",
  "make",
  "start",
  "stop",
  "approve",
  "reject",
  "submit",
  "save",
  "log",
  "fill",
  "attach",
  "replace",
  "pause",
  "resume",
  "enable",
  "disable",
  "connect",
  "disconnect",
  "transfer",
  "refund",
  "charge",
  "tag",
  "label",
  "star",
  "pin",
  "unpin",
  "react",
  "comment",
  "sync",
]);
const aOrAn = (w: string): string => (/^[aeiou]/i.test(w) ? "an" : "a");

/** Turns the words of a tool or capability name into a short verb phrase a person reads: "send message" becomes "send a message", "create contact" becomes "create a contact". A plural or a phrase that already has its own article is left as it is; a name that does not start with a verb is shown as its words. */
export function verbPhrase(words: string): string {
  const w = words.trim().replace(/\s+/g, " ").toLowerCase();
  const [verb, ...rest] = w.split(" ");
  if (!verb || rest.length === 0 || !VERBS.has(verb)) return w;
  const noun = rest.join(" ");
  if (
    /^(a|an|the|all|my|your|this|that|any|some)\b/.test(noun) ||
    /s$/.test(rest[rest.length - 1]!) ||
    /\b(to|in|on|for|from|with|of)\b/.test(noun)
  )
    return `${verb} ${noun}`;
  return `${verb} ${aOrAn(noun)} ${noun}`;
}

/** The address a link points at, as a person says it: "example.com". */
export function hostOfLink(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return raw;
  }
}

/** Modules a person has no word for: a step in one of these never reads "in <module>". */
const INTERNAL_SCOPES: ReadonlySet<string> = new Set([
  "engine",
  "gate",
  "automations",
  "computers",
  "connectors",
  "agents",
  "kernel",
  "host",
  "memory",
  "providers",
  "browser",
  "watches",
]);

const OLD_WANTS: Record<string, string> = {
  "chat.message_person": "send a message to a teammate",
  "engine.mcp.call": "use an outside tool",
  "engine.mcp.read": "read from an outside tool",
  "files.write": "edit",
  "files.create": "create",
  "files.delete": "delete",
  "files.move": "move",
  "files.rename": "rename",
  "files.folder.create": "create the folder",
  "records.update": "change",
  "records.create": "add a record",
  "records.delete": "delete",
  "mail.send": "send an email",
  "inbox.reply": "send a reply",
  "twilio.send": "send a text",
  "telephony.sms.send": "send a text",
  "stripe.refund.create": "refund a payment",
  "calendar.create_event": "add a calendar event",
  "calendar.update_event": "change a calendar event",
  "calendar.delete_event": "delete a calendar event",
  "git.push": "push your changes",
  "git.commit": "save your changes to the repository",
  "sites.promote": "put the site live",
  "engine.crew.merge": "merge a teammate's branch",
  "engine.crew.push": "push a teammate's branch",
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
  // a test read sends a Vault key: the card names the key and the one host it would go to
  // the card names the key from the server's own reading (automations.key_hosts.pending); this fallback names only the host, never what the agent wrote for the key
  if (cap === "automations.try_read") {
    const host = keyReadHost(input);
    return host ? `send a key to ${host}` : "send a key to an app";
  }
  // the one call for a site's operations: the held actions read as what they do, so a person sees "put back a site's database" and not a call name
  if (cap === "sites.ops") {
    const a = obj(input)["action"];
    if (a === "backup_restore") return "put back a site's database from a backup, replacing what is in it now";
    if (a === "job_create" || a === "job_update") return "schedule a command that runs with the site's keys";
    if (a === "worker_add") return "start a worker that runs with the site's keys";
  }
  // a Vault key given to a site as env: the card names the key, the site and where its code comes from (never a value)
  if (cap.startsWith("sites.") && envHandles(input).length > 0) {
    const keys = envHandles(input).map((h) => h.replace(/^#/, "").replace(/\..*$/, ""));
    const o = obj(input);
    const src = obj(o["source"]);
    const repo = str(src["repo"])
      .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
      .replace(/\.git$/, "");
    const key = keys.length > 1 ? `${keys[0]} and ${keys.length - 1} more` : (keys[0] ?? "a key");
    return `give the key ${key} to the site ${str(o["name"]) || "this site"}, built from ${repo || (src["folderId"] || src["fileId"] || src["path"] ? "uploaded files" : "its source")}`;
  }
  // a site's own keys meeting code from another source: a move to another repo or files, or a preview promoted to production
  if (cap === "sites.preview_promote") return "serve a preview as production with the site's keys";
  // what gets built for production on a site that stores keys: which pushes build, deploy on push, the settings
  if (cap === "sites.webhook_set") {
    const follow = obj(input)["follow"];
    if (Array.isArray(follow)) {
      // a branch name is written by whoever wrote the call: cut by characters, then control characters are written out (lib/visible-text.ts, the one escaper)
      const shown = follow
        .filter((x): x is string => typeof x === "string")
        .slice(0, 5)
        .map((x) => visibleText(x, 40));
      const more = follow.length - shown.length;
      return `build previews of pushes to ${shown.join(", ") || "no branches"}${more > 0 ? ` and ${more} more` : ""}, with the site's keys`;
    }
    if (obj(input)["rotate"] === true) return "rotate the webhook secret; GitHub must be given the new one";
    if (obj(input)["enabled"] === true) return "switch on builds from GitHub pushes for a site with keys";
  }
  if (cap === "sites.update" && obj(input)["autoDeploy"] === true)
    return "deploy this site on every push, with its keys";
  if (cap === "sites.update" && obj(input)["settings"] !== undefined && obj(input)["settings"] !== null)
    return "change the settings of a site that holds keys";
  if (cap.startsWith("sites.") && obj(obj(input)["source"])["repo"] !== undefined && keySendOf(input) === undefined)
    return `give the site's keys to code from ${str(obj(obj(input)["source"])["repo"])
      .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
      .replace(/\.git$/, "")}`;
  // a production deploy of a site that holds keys, with no new source: the branch is not protected, so anyone who can push to it can use the keys
  if (cap === "sites.deploy") return "deploy a site that holds keys";
  // a call that sends a Vault key to a place it names: the card says which key goes to which host (the key's name, never its value)
  if (KEY_HOST_CAPS.has(cap)) {
    const use = keySendOf(input);
    const name = use ? use.handle.replace(/^#/, "").replace(/\..*$/, "") : "";
    return use && name
      ? `send the key ${name} to ${use.host ?? "an address it could not read"}`
      : "send a key to an app";
  }
  if (cap === "automations.read_link") {
    const url = str(obj(input)["url"]);
    return url ? `open ${hostOfLink(url)}` : "open a link";
  }
  if (cap === "automations.read_docs") return "read the documentation";
  // "Ada wants to change the Space time zone to Pacific Time": the zone is named in the person's words, not as an id
  if (cap === "spaces.timezone.set") {
    const zone = str(obj(input)["timezone"]);
    return zone && validZone(zone) ? `change the Space time zone to ${zoneName(zone)}` : "change the Space time zone";
  }
  return null;
}

/** The task's title for a held act: "Send a message" only for a message; a read of a link is "Open example.com". */
export function holdTitle(cap: string, input: unknown, actTitle?: string): string {
  const o = outwardOf(cap, input);
  if (o)
    return {
      message: "Send a message",
      email: "Send an email",
      text: "Send a text",
      post: "Post to a chat",
      event: "Add a calendar event",
    }[o.channel];
  const known = wantsFromInput(cap, obj(input)) ?? HOLD_PHRASES[cap] ?? WANTS[cap];
  if (!known && actTitle && actTitle !== "Send a message") return actTitle; // the Gate's own name for the kind of act, unless that is the message one, which this is not
  const w = known ?? (cap === "" ? "do a step" : capPhrase(cap));
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** The names a held act can say instead of ids: a person by the id or handle the call carries, and the file by its id. Filled by whoever builds the hold; anything missing reads in a plain word. */
export interface HoldNames {
  people?: Record<string, string>;
  file?: string;
  /** The Vault key a share hands over, by its name (never a value), and who gets it. */
  key?: string;
  recipient?: string;
  /** The site a deploy is held for, read as the Space: its name, the branch it builds and the keys it holds (names, never values), and whether its files are uploaded. */
  site?: { name: string; branch?: string; keys: string[]; upload?: boolean };
}

const listNames = (xs: string[]): string =>
  xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, 2).join(", ")} and ${xs.length - 2} more`;

/** What a held act is after "<agent> wants to": from the real input, who and what. "message Noah Berg", "email aliza@example.com", "text +14155550123", "share Q4 pricing.docx with a link for someone outside the Space". */
export function holdShort(cap: string, input: unknown, n: HoldNames = {}): string {
  const o = outwardOf(cap, input);
  if (o) {
    const people = n.people ?? {};
    const who = o.to
      .map((r) =>
        r.kind === "person"
          ? (people[r.id ?? ""] ?? r.name ?? "a teammate")
          : r.kind === "thread"
            ? "this chat"
            : r.kind === "phone"
              ? (r.address ?? "")
              : (r.name ?? r.address ?? ""),
      )
      .filter((x) => x !== "");
    if (o.channel === "message") return `message ${who[0] ?? "a teammate"}`;
    if (o.channel === "email") return who.length > 0 ? `email ${listNames(who)}` : "send an email";
    if (o.channel === "text") return who.length > 0 ? `text ${listNames(who)}` : "send a text";
    if (o.channel === "post")
      return who[0] === "this chat" || who.length === 0 ? "post in this chat" : `post in ${who[0]}`;
    return "add a calendar event";
  }
  if (cap === "vault.share" || cap === "access.share") {
    const sub = obj(obj(input)["subject"]);
    const kind = str(sub["kind"]);
    const who =
      n.recipient ??
      (kind === "agent" ? "an agent" : kind === "group" ? "a group" : kind === "person" ? "a teammate" : "someone");
    const res = str(obj(obj(input)["resource"])["type"]);
    if (res === "vault_item" || res === "vault_folder")
      return `share ${res === "vault_folder" ? "a Vault folder" : n.key ? `the key ${n.key}` : "a Vault key"} with ${who}`;
  }
  // a production deploy held for a person: the reason for this hold, with the site's branch and the keys' names. Uploaded files are held for being other files; a repo for the branch that anyone who can push to can use.
  if (cap === "sites.deploy" && n.site && !obj(obj(input)["source"])["repo"]) {
    const keys = n.site.keys.length > 0 ? listNames(n.site.keys) : "its keys";
    // a card made over a commit says which: the yes deploys that commit
    const sha = obj(input)["commit"];
    const at = typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha) ? ` at ${sha.slice(0, 7)}` : "";
    return n.site.upload
      ? `deploy the files now in ${n.site.name}, which holds ${keys}`
      : `deploy ${n.site.name}${at}: anyone who can push to ${n.site.branch || "its branch"} can use ${keys}. Protect the branch to deploy without asking`;
  }
  if (cap === "sites.webhook_set" && n.site && obj(input)["rotate"] === true)
    return `rotate the webhook secret for ${n.site.name}; GitHub must be given the new one`;
  if (cap === "files.share_external") return `share ${n.file ?? "a file"} with a link for someone outside the Space`;
  const w =
    wantsFromInput(cap, obj(input)) ?? HOLD_PHRASES[cap] ?? WANTS[cap] ?? (cap === "" ? "do a step" : capPhrase(cap));
  const named = n.file && cap.startsWith("files.") ? w.replace(/\b(a|the) file$/, n.file) : w;
  if (named !== w) return named;
  // a bare verb ("change", "edit") says nothing alone: name what it acts on from the capability's own scope ("change a record", "edit a file")
  const parts = cap.split(".");
  const scope =
    parts.length > 1 && !INTERNAL_SCOPES.has(parts[0]!)
      ? parts[0]!.replace(/[_-]+/g, " ").replace(/ies$/, "y").replace(/s$/, "")
      : "";
  if (/\s/.test(w) || !scope) return w;
  return scope === "file" && n.file ? `${w} ${n.file}` : `${w} ${aOrAn(scope)} ${scope}`;
}

/** The one sentence every surface says for a held act an agent asked for: the card, the footer under the ask, the top bar and the task. No "Approve:" in front. */
export const holdSentence = (agent: string, cap: string, input: unknown, n: HoldNames = {}): string =>
  `${agent} wants to ${holdShort(cap, input, n)}`;
