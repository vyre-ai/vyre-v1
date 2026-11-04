// An audit row or an event, said the way a person at the next desk would say it: who did what to which thing, with no dotted names, ids or module words. "files.save" is "Priya saved Fee agreement.pdf", and with no name
// to give, "saved a file"; "tasks.working_notes.set" is "changed the working notes of a task". The registry names its acts as <module>.<part>.<verb> (a capability) or <module>.<thing>_<verb> (an event); this reads
// either. A table gives the verb its past tense and a determiner, a second one names the things people know by another word than the code's, and anything not in a table is still said in plain words, never as the code.

/** The past tense of a verb as people say it, and whether the thing it makes is "a" new one (create, add) or "the" one that was there. */
const VERBS: Readonly<Record<string, readonly [string, "a" | "the"]>> = {
  create: ["created", "a"], add: ["added", "a"], make: ["made", "a"], new: ["started", "a"], start: ["started", "a"], begin: ["started", "a"], open: ["opened", "the"], book: ["booked", "a"], draft: ["drafted", "a"],
  update: ["updated", "the"], change: ["changed", "the"], set: ["changed", "the"], edit: ["edited", "the"], save: ["saved", "the"], write: ["wrote", "the"], put: ["saved", "the"], replace: ["replaced", "the"],
  rename: ["renamed", "the"], move: ["moved", "the"], copy: ["copied", "the"], duplicate: ["copied", "the"], fork: ["branched", "the"], merge: ["merged", "the"], apply: ["applied", "the"], configure: ["set up", "the"], setup: ["set up", "the"],
  delete: ["deleted", "the"], remove: ["removed", "the"], erase: ["erased", "the"], purge: ["permanently deleted", "the"], trash: ["moved to the trash", "the"], discard: ["discarded", "the"], forget: ["forgot", "the"], clear: ["cleared", "the"], drop: ["dropped", "the"],
  restore: ["restored", "the"], undo: ["undid", "the"], redo: ["redid", "the"], revert: ["reverted", "the"], rollback: ["rolled back", "the"], reopen: ["reopened", "the"], undelete: ["restored", "the"], unarchive: ["unarchived", "the"],
  archive: ["archived", "the"], pin: ["pinned", "the"], unpin: ["unpinned", "the"], star: ["starred", "the"], mark: ["marked", "the"], label: ["labelled", "the"], tag: ["tagged", "the"],
  share: ["shared", "the"], unshare: ["stopped sharing", "the"], grant: ["gave access to", "the"], revoke: ["took back access to", "the"], allow: ["allowed", "the"], deny: ["denied", "the"], block: ["blocked", "the"], unblock: ["unblocked", "the"],
  invite: ["invited", "a"], accept: ["accepted", "the"], decline: ["declined", "the"], approve: ["approved", "the"], reject: ["rejected", "the"], request: ["asked for", "the"], propose: ["proposed", "a"], suggest: ["suggested", "a"], answer: ["answered", "the"], respond: ["replied to", "the"],
  send: ["sent", "a"], reply: ["replied to", "the"], post: ["posted", "a"], comment: ["commented on", "the"], react: ["reacted to", "the"], notify: ["notified", "the"], nudge: ["nudged", "the"], message: ["messaged", "the"], call: ["called", "the"], dial: ["called", "the"],
  publish: ["published", "the"], unpublish: ["took down", "the"], install: ["installed", "the"], uninstall: ["removed", "the"], deploy: ["deployed", "the"], build: ["built", "the"], import: ["imported", "the"], export: ["exported", "the"], download: ["downloaded", "the"], upload: ["uploaded", "the"], attach: ["attached", "the"],
  connect: ["connected", "the"], disconnect: ["disconnected", "the"], reconnect: ["reconnected", "the"], link: ["linked", "the"], unlink: ["unlinked", "the"], join: ["joined", "the"], leave: ["left", "the"], pair: ["paired", "the"], register: ["registered", "the"], enroll: ["enrolled", "the"], provision: ["set up", "the"],
  run: ["ran", "the"], retry: ["retried", "the"], test: ["tested", "the"], check: ["checked", "the"], scan: ["scanned", "the"], verify: ["verified", "the"], probe: ["checked", "the"], sync: ["synced", "the"], enable: ["turned on", "the"], disable: ["turned off", "the"], toggle: ["switched", "the"],
  pause: ["paused", "the"], resume: ["resumed", "the"], stop: ["stopped", "the"], cancel: ["canceled", "the"], finish: ["finished", "the"], complete: ["completed", "the"], close: ["closed", "the"], end: ["ended", "the"], expire: ["let expire", "the"], snooze: ["snoozed", "the"], wake: ["woke", "the"], sleep: ["put to sleep", "the"],
  assign: ["assigned", "the"], unassign: ["unassigned", "the"], delegate: ["handed over", "the"], handoff: ["handed over", "the"], take: ["took", "the"], release: ["released", "the"], claim: ["claimed", "the"], transfer: ["transferred", "the"], escalate: ["escalated", "the"],
  review: ["reviewed", "the"], resolve: ["resolved", "the"], dismiss: ["dismissed", "the"], confirm: ["confirmed", "the"], decide: ["decided on", "the"], promote: ["promoted", "the"], protect: ["protected", "the"], redact: ["redacted", "the"], unredact: ["showed", "the"], reveal: ["revealed", "the"],
  sign_in: ["signed in to", "the"], signin: ["signed in to", "the"], sign_out: ["signed out of", "the"], login: ["signed in to", "the"], rotate: ["rotated", "the"], renew: ["renewed", "the"], reset: ["reset", "the"], refresh: ["refreshed", "the"], reindex: ["rebuilt the index of", "the"], rebuild: ["rebuilt", "the"], backfill: ["filled in", "the"],
  view: ["viewed", "the"], read: ["read", "the"], get: ["opened", "the"], list: ["looked at", "the"], search: ["searched", "the"], find: ["looked for", "the"], history: ["looked at the history of", "the"], versions: ["looked at the versions of", "the"], preview: ["previewed", "the"], diff: ["compared", "the"],
  status: ["checked", "the"], health: ["checked", "the"], summary: ["looked at the summary of", "the"], overview: ["looked at", "the"], show: ["looked at", "the"], browse: ["browsed", "the"], tree: ["looked at", "the"], peek: ["looked at", "the"], query: ["looked at", "the"], fetch: ["fetched", "the"], load: ["opened", "the"],
  store: ["stored", "the"], stored: ["stored", "the"], use: ["used", "the"], act: ["acted on", "the"], log: ["logged", "the"], track: ["tracked", "the"], record: ["recorded", "the"], receive: ["received", "the"], ingest: ["took in", "the"], match: ["matched", "the"], unmatch: ["unmatched", "the"],
  advance: ["moved forward", "the"], lapse: ["let lapse", "the"], hold: ["put a hold on", "the"], subscribe: ["subscribed to", "the"], unsubscribe: ["unsubscribed from", "the"], follow: ["followed", "the"], mute: ["muted", "the"], watch: ["watched", "the"], ask: ["asked about", "the"],
  fill: ["filled in", "the"], generate: ["generated", "the"], summarize: ["summarized", "the"], compact: ["compacted", "the"], upsert: ["saved", "the"], append: ["added to", "the"], insert: ["added to", "the"], mint: ["issued", "a"], issue: ["issued", "a"], buy: ["bought", "the"], pay: ["paid", "the"], refund: ["refunded", "the"],
};

/** Participles an event ends in, when they are not simply "<verb>ed" or are said another way. */
const PARTICIPLES: Readonly<Record<string, string>> = {
  sent: "sent", set: "changed", made: "made", built: "built", run: "ran", left: "left", lost: "lost", paid: "paid", held: "held", read: "read", seen: "seen", taken: "taken", given: "given", kept: "kept", undone: "undid", dropped: "dropped",
  changed: "changed", created: "created", updated: "updated", deleted: "deleted", removed: "removed", added: "added", started: "started", stopped: "stopped", failed: "failed", completed: "completed", finished: "finished", saved: "saved",
  received: "received", restored: "restored", resumed: "resumed", requested: "asked for", opened: "opened", paused: "paused", erased: "erased", purged: "permanently deleted", revoked: "took back access to", proposed: "proposed", rejected: "rejected",
  linked: "linked", resolved: "resolved", moved: "moved", closed: "closed", archived: "archived", renamed: "renamed", promoted: "promoted", published: "published", canceled: "canceled", cancelled: "canceled", declined: "declined", applied: "applied",
  ended: "ended", approved: "approved", merged: "merged", pushed: "pushed", connected: "connected", assigned: "assigned", released: "released", verified: "verified", configured: "set up", registered: "registered", shared: "shared", submitted: "submitted",
  installed: "installed", delivered: "delivered", queued: "queued", delegated: "handed over", exported: "exported", disabled: "turned off", enabled: "turned on", migrated: "moved to the new version", synced: "synced", transferred: "transferred", discarded: "discarded",
  edited: "edited", unarchived: "unarchived", dismissed: "dismissed", matched: "matched", compacted: "compacted", marked: "marked", bumped: "refreshed", revealed: "revealed", answered: "answered", engaged: "joined", disengaged: "left", provisioned: "set up",
  granted: "gave access to", denied: "denied", expired: "expired", placed: "placed", written: "written", uploaded: "uploaded", enrolled: "enrolled", mounted: "connected", filled: "filled in", starred: "starred", highlighted: "highlighted", reviewed: "reviewed",
  blocked: "blocked", warned: "warned about", extended: "extended", reported: "reported", woken: "woken", designed: "designed", stored: "stored", checkpointed: "saved a checkpoint of", initialized: "started", pulled: "pulled", committed: "saved", copied: "copied", rolled: "rolled back",
  breached: "went over", entered: "entered", exited: "left", needed: "needs", allowed: "allowed", logged: "logged", accessed: "opened", viewed: "viewed", redacted: "redacted", unredacted: "showed", repaired: "repaired", replayed: "replayed", signed: "signed",
};

/** Events that end in a state, not an act: "a recording is ready". */
const STATES: Readonly<Record<string, string>> = { ready: "is ready", waiting: "is waiting", pending: "is waiting", back: "is back", out: "is out", review: "needs a look", ringing: "is ringing", progress: "made progress", needs: "needs attention" };

/** Words people know a thing by that are not the code's word for it. Whole words, after underscores are spaces. */
const SAY: Readonly<Record<string, string>> = {
  actor: "outside tool", acl: "access rule", mcp: "connected tool", dwd: "company-wide Google access", sso: "single sign-on", oauth: "sign-in", totp: "authenticator code", passkey: "passkey",
  epoch: "access cache", tombstone: "deleted item", idempotency: "retry", payload: "details", svc: "Vyre", webhook: "web hook", cursor: "position", caddy: "web server", ingress: "incoming route",
  a2p: "texting registration", twiml: "phone", docusign: "DocuSign", documenso: "Documenso", hubspot: "HubSpot", mailgun: "Mailgun", twilio: "Twilio", github: "GitHub", gmail: "Gmail", ms: "Microsoft", dropbox: "Dropbox", zoom: "Zoom", stripe: "Stripe", resend: "Resend",
  sms: "text message", cc: "copy", dnd: "do-not-disturb", dm: "direct message", pii: "personal details", api: "API", url: "address", uri: "address", id: "name", ids: "names", json: "data", csv: "spreadsheet", crm: "CRM", llm: "AI model", ai: "AI",
  principal: "person", entity: "item", resource: "item", subject: "item", capability: "action", cap: "permission", toolset: "tool set", cascade: "knock-on change", taint: "sensitivity mark",
  sync: "sync", replay: "replay", snapshot: "snapshot", checkpoint: "checkpoint", keys: "keys", key: "key", lease: "claim", acquire: "claim", reconcile: "match up", heartbeat: "check-in", telephony: "phone", scheduler: "schedule", runtime: "runtime",
  turn: "reply", conversation: "conversation", changeset: "set of changes", folder: "folder", mount: "connected folder", doc: "document",
  repo: "repository", signin: "sign-in", log: "log", source: "source", item: "item", note: "note", field: "field", value: "value",
};

const irregularPlural: Readonly<Record<string, string>> = { status: "status", access: "access", settings: "settings", news: "news", series: "series", analytics: "analytics", analysis: "analysis", sms: "text message", ms: "Microsoft", mounts: "connected folder", notes: "notes", keys: "key" };

const singular = (w: string): string => {
  if (irregularPlural[w] !== undefined) return irregularPlural[w] as string;
  if (/ies$/.test(w)) return w.replace(/ies$/, "y");
  if (/(ss|us|is)$/.test(w)) return w;
  if (/ses$|xes$|ches$|shes$/.test(w)) return w.replace(/es$/, "");
  return w.endsWith("s") ? w.slice(0, -1) : w;
};

/** The words of a code name said plainly: "working_notes" is "working notes", "mcp" is "connected tool". */
export function sayWords(name: string, plural = false): string {
  const out: string[] = [];
  for (const raw of name.split(/[_\s]+/)) {
    if (raw === "") continue;
    const w = raw.toLowerCase();
    const said = SAY[w] ?? SAY[singular(w)] ?? (plural ? w : singular(w));
    out.push(said);
  }
  // collapse repeats the code carries ("agent agent")
  return out.filter((w, i) => w !== out[i - 1]).join(" ");
}

export interface ActParts { /** the verb word the act was built from ("assign", "created") */ key: string; verb: string; det: "a" | "the"; /** the thing the act was on, in words ("working notes"), or "" */ subject: string; /** the kind of thing it belongs to ("task") or the provider or area */ owner: string; kind: "entity" | "provider" | "area"; state?: string }

/** Modules that are another company's product: an act in them is "in Google", "in Zoom". */
const PROVIDERS: Readonly<Record<string, string>> = { google: "Google", microsoft: "Microsoft", ms: "Microsoft", zoom: "Zoom", github: "GitHub", dropbox: "Dropbox", dropbox_sign: "Dropbox Sign", stripe: "Stripe", twilio: "Twilio", mailgun: "Mailgun", resend: "Resend", hubspot: "HubSpot", docusign: "DocuSign", documenso: "Documenso", telephony: "the phone service", git: "Git" };
/** Modules that are a part of the Space's settings, not a thing: said as an area. */
const AREAS: Readonly<Record<string, string>> = { access: "access settings", gate: "approval rules", governance: "governance settings", identity: "sign-in settings", network: "network settings", engine: "AI engine settings", company: "company settings", health: "health checks", memory: "memory", keys: "encryption keys", logs: "logs", console: "admin settings", providers: "AI providers", provider: "AI providers", mcp: "connected tools", settings: "settings", sync: "sync", retention: "retention rules", policy: "policy", notification: "notifications", notifications: "notifications", updates: "updates", spend: "spending limits", schema: "data model", report: "reports", reports: "reports", mail: "mail", vault: "the Vault", mailbox: "mail" };
const STOP = new Set(["a", "as", "of", "to", "from", "in", "the", "for", "by", "on", "my", "mine", "out", "up", "space", "personal"]);

const isVerbWord = (w: string): boolean => VERBS[w] !== undefined;
const isParticiple = (w: string): boolean => PARTICIPLES[w] !== undefined;

/** An act name read into the verb a person would use and the thing it was done to. Accepts both shapes the registry has: "tasks.working_notes.set" and "file.comment_resolved". */
export function actParts(action: string): ActParts {
  const parts = action.split(".").filter(Boolean);
  const mod = (parts[0] ?? "").toLowerCase();
  const rest = parts.slice(1);
  const last = rest.length > 0 ? rest[rest.length - 1]! : "";
  const words = last.split("_").filter((w) => w !== "");
  const mids = rest.slice(0, -1).filter((p) => !STOP.has(p)).map((p) => sayWords(p)).filter(Boolean);
  const kind: ActParts["kind"] = PROVIDERS[mod] !== undefined ? "provider" : AREAS[mod] !== undefined ? "area" : "entity";
  const owner = kind === "provider" ? (PROVIDERS[mod] as string) : kind === "area" ? (AREAS[mod] as string) : sayWords(mod);
  const lastWord = words[words.length - 1] ?? "";
  const earlier = words.slice(0, -1);
  const subjectOf = (skip: number): string => [...mids, ...words.filter((w, i) => i !== skip && !STOP.has(w)).map((w) => sayWords(w))].filter(Boolean).filter((w, i, arr) => w !== arr[i - 1]).join(" ");
  // a state: "call.recording_ready", but "task.sent_back" is an act with a "back"
  if (STATES[lastWord] !== undefined && !earlier.some((w) => isVerbWord(w) || isParticiple(w))) {
    const sub = [...mids, ...earlier.map((w) => sayWords(w))].filter(Boolean).join(" ");
    return { key: lastWord, verb: "", det: "the", subject: sub, owner, kind, state: STATES[lastWord] as string };
  }
  let vi = words.findIndex((w) => isVerbWord(w));
  let verb = "";
  let det: "a" | "the" = "the";
  if (vi >= 0 && !(words.length > 1 && isParticiple(lastWord) && vi !== words.length - 1 && !isVerbWord(lastWord))) {
    const v = VERBS[words[vi] as string] as readonly [string, "a" | "the"];
    verb = v[0];
    det = v[1];
  } else if (isParticiple(lastWord) || words.some(isParticiple)) {
    vi = isParticiple(lastWord) ? words.length - 1 : words.findIndex(isParticiple);
    const w = words[vi] as string;
    verb = PARTICIPLES[w] as string;
    det = /^(created|added|made|started|sent|proposed|invited|booked|opened|received)$/.test(w) ? "a" : "the";
  } else if (/ed$/.test(lastWord)) {
    vi = words.length - 1;
    verb = lastWord;
  } else {
    verb = "changed";
    vi = -1;
  }
  // "back" after "sent" is part of the verb
  if (vi === words.length - 2 && words[words.length - 1] === "back") { verb = `${verb} back`; words.pop(); }
  const subject = subjectOf(vi);
  return { key: words[vi] ?? lastWord, verb, det, subject: subject === owner ? "" : subject, owner, kind };
}

const article = (w: string): string => (/^[aeiou]/i.test(w) ? "an" : "a");

/** The word that joins a thing to the one it was done to: "assigned a role to Omar", "removed a member from Sales". */
const PREP: Readonly<Record<string, string>> = { assign: "to", grant: "to", add: "to", append: "to", invite: "to", delegate: "to", handoff: "to", share: "with", unassign: "from", remove: "from", revoke: "from", unshare: "with" };

/** "saved a file", "changed the working notes of a task", "created the calendar event in Google": the act without who. With the name of the thing, "saved Fee agreement.pdf". */
export function auditPhrase(action: string, resource?: string): string {
  const kindOf = SAID_OF[action];
  if (kindOf !== undefined) return resource !== undefined && resource !== "" ? `${kindOf[0]} the ${kindOf[1]}${kindOf[2] ? ` ${kindOf[2]}` : ""} ${resource}` : `${kindOf[0]} ${/^[aeiou]/.test(kindOf[1]) ? "an" : "a"} ${kindOf[1]}`;
  const said = SAID[action];
  if (said !== undefined) return resource !== undefined && resource !== "" && !said.includes(" a ") && !/Space|audit|held/.test(said) ? said : said;
  const p = actParts(action);
  if (p.state !== undefined) return `${[p.owner, p.subject].filter(Boolean).join(" ")}`.replace(/^(\w)/, (c) => c).trim() + ` ${p.state}`;
  const named = resource !== undefined && resource !== "";
  const det = (w: string): string => (p.det === "a" ? article(w) : "the");
  const prep = PREP[p.key];
  if (named && prep !== undefined && p.subject !== "") return `${p.verb} ${article(p.subject)} ${p.subject} ${prep} ${resource}`;
  if (p.kind === "provider") return named ? `${p.verb} ${resource} in ${p.owner}` : `${p.verb} ${p.subject !== "" ? `${det(p.subject)} ${p.subject}` : "an item"} in ${p.owner}`;
  if (p.kind === "area") return named ? `${p.verb} ${resource} in ${p.owner}` : p.subject !== "" ? `${p.verb} ${det(p.subject)} ${p.subject} in ${p.owner}` : `${p.verb} ${/^the /.test(p.owner) ? "" : "the "}${p.owner}`;
  if (named) return p.subject !== "" ? `${p.verb} the ${p.subject} of ${resource}` : `${p.verb} the ${p.owner} ${resource}`;
  return p.subject !== "" ? `${p.verb} ${det(p.subject)} ${p.subject} of ${article(p.owner)} ${p.owner}` : `${p.verb} ${article(p.owner)} ${p.owner}`;
}

/** Acts that read better said by hand than built from their parts. */
const SAID: Readonly<Record<string, string>> = {
  "audit.viewed": "opened the audit log", "identity.claim_owner": "claimed this Space", "member.joined": "joined the Space", "member.removed": "was removed from the Space", "gate.approved": "approved a held action", "gate.denied": "denied a held action",
  "gate.requested": "asked for approval",  "gate.expired": "let an approval request expire", "task.completed": "completed a task", "task.sent_back": "sent a task back", "run.undone": "undid a run", "subscription.canceled": "canceled the subscription",
  "access.requested": "asked for access", "access.granted": "gave access", "access.declined": "declined a request for access", "file.shared_external": "shared a file outside the Space", "views.share_external": "shared a view outside the Space",
  "files.share_external": "shared a file outside the Space", "vault.item.delete": "deleted a Vault item", "vault.item_restored": "restored a Vault item",
};

/** Acts where the thing has a name people use for its kind: with its name it reads "changed the approval rule Send". */
const SAID_OF: Readonly<Record<string, readonly [string, string, string?]>> = {
  "gate.rule_changed": ["changed", "approval rule"], "gate.rule_created": ["added", "approval rule"], "gate.rule_deleted": ["removed", "approval rule"],
  "role.changed": ["changed", "role", "of"], "role.created": ["created", "role"], "role.deleted": ["deleted", "role"],
};

/** A whole line: who, what they did, to what, and for whom. The actor is a name already (the caller looks it up); an unknown actor is "Someone". */
export function auditSentence(a: { actor: string; action: string; resource?: string; onBehalfOf?: string }): string {
  const p = SAID[a.action] !== undefined || SAID_OF[a.action] !== undefined ? { state: undefined } : actParts(a.action);
  const who = a.actor === "" ? "Someone" : a.actor;
  const phrase = auditPhrase(a.action, a.resource);
  const behalf = a.onBehalfOf !== undefined && a.onBehalfOf !== "" ? `, for ${a.onBehalfOf}` : "";
  if (p.state !== undefined) return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}${behalf}`;
  return `${who} ${phrase}${behalf}`;
}

/** The ids and code words a line a person reads must never hold: a dotted name, an underscore word, an id (rec_..., usr_...), a module word. A guard test runs every act the registry has through this. */
export const CODE_WORDS = /\b(epoch|tombstones?|mcp|dwd|acl|idempoten\w*|payload|svc|oauth|totp|twiml|a2p|undefined|null)\b/i;
export function leaksCode(text: string): string | null {
  if (/[a-z0-9]\.[a-z]{2,}(?:\.[a-z_]+)?\b/.test(text.replace(/\b(\w+\.(?:md|pdf|png|jpg|csv|xlsx|docx|toml|txt))\b/g, "")) && /\b[a-z]+(?:_[a-z]+)*\.[a-z_]+\b/.test(text)) return "a dotted name";
  if (/\b[a-z]{2,6}_[a-z0-9]{6,}\b/.test(text)) return "an id";
  if (/\w_\w/.test(text)) return "an underscore word";
  const m = CODE_WORDS.exec(text);
  return m ? `the code word ${m[0]}` : null;
}
