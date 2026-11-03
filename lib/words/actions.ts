// An act in the audit log or an activity feed, as a person says it (owner, 4 Nov 2026: "Copy overall is really bad for activity, logs and errors"). The log stores the capability that ran
// ("access.roles.assign"); a person reads "Priya Raman assigned a role to Omar Haddad". Who did what to which thing, in the past tense, with no dots, no underscores and no ids.
// A few acts have their own sentence (SENTENCES); every other one is made from its name: the verb in the past tense and the thing it was done to ("agents.routine.save" is "saved a routine").

const PAST: Readonly<Record<string, string>> = {
  create: "created", update: "changed", delete: "deleted", set: "changed", add: "added", remove: "removed", assign: "assigned", unassign: "removed", grant: "granted", revoke: "revoked",
  approve: "approved", decline: "declined", reject: "rejected", restore: "restored", share: "shared", unshare: "stopped sharing", pause: "paused", resume: "resumed", connect: "connected",
  disconnect: "disconnected", apply: "applied", start: "started", close: "closed", decide: "decided on", request: "asked for", append: "added to", archive: "archived", unarchive: "restored", redeem: "redeemed",
  lapse: "ended", propose: "suggested", accept: "accepted", dismiss: "dismissed", save: "saved", send: "sent", import: "imported", export: "exported", rename: "renamed", move: "moved", copy: "copied",
  run: "ran", retry: "retried", cancel: "canceled", invite: "invited", join: "joined", leave: "left", sign: "signed", open: "opened", view: "opened", read: "read", get: "opened", list: "listed", erase: "erased",
  purge: "erased", reset: "reset", rotate: "rotated", enable: "turned on", disable: "turned off", configure: "changed", claim: "claimed", delegate: "handed over", publish: "published", unpublish: "unpublished",
  mark: "marked", pin: "pinned", unpin: "unpinned", star: "starred", unstar: "unstarred", complete: "completed", reopen: "reopened", transition: "moved", deploy: "deployed", upload: "uploaded", download: "downloaded",
  sync: "synced", test: "tested", verify: "verified", suspend: "suspended", unsuspend: "reinstated", lock: "locked", unlock: "unlocked", forget: "forgot", remember: "remembered", merge: "merged", split: "split",
  review: "reviewed", submit: "submitted", withdraw: "withdrew", snooze: "snoozed", confirm: "confirmed", register: "registered", reconcile: "reconciled", define: "defined", resolve: "resolved",
  edit: "edited", record: "recorded", preview: "previewed", link: "linked", unlink: "unlinked", check: "checked", clear: "cleared", comment: "commented on", promote: "promoted", fetch: "fetched",
  ingest: "imported", create_from: "created", log: "logged", register_key: "registered", install: "installed", uninstall: "uninstalled", provision: "set up", bind: "linked", answer: "answered",
  grant_access: "granted", attach: "attached", detach: "removed", select: "chose", choose: "chose", change: "changed", toggle: "changed", replace: "replaced", rollback: "rolled back", undo: "undid", redo: "redid",
  seal: "locked", reveal: "showed", fill: "filled in", use: "used", assign_owner: "assigned", transfer: "transferred", escalate: "escalated", notify: "notified", subscribe: "subscribed", unsubscribe: "unsubscribed",
  label: "labelled", tag: "tagged", flag: "flagged", report: "reported", ban: "blocked", block: "blocked", unblock: "unblocked", allow: "allowed", deny: "denied", trust: "trusted", expire: "ended", renew: "renewed",
};
/** The prepositions for a thing a verb is done to or with: "assigned a role to Omar", "removed a member from Sales". */
const PREP: Readonly<Record<string, string>> = { assign: "to", grant: "to", share: "with", add: "to", append: "to", unassign: "from", remove: "from", revoke: "from", unshare: "with", delegate: "to", invite: "to" };
const NOUN: Readonly<Record<string, string>> = {
  principals: "person", actors: "outside agent", grants: "access", roles: "role", groups: "group", policies: "setting", exceptions: "permission exception", reviews: "access review", requests: "request",
  audience: "audience", labels: "label", automation: "automation", connector: "connection", connectors: "connection", mcp: "connection", vault: "vault item", items: "item", folders: "folder", files: "file",
  marks: "mark", records: "record", types: "record type", fields: "field", threads: "chat", chat: "chat", channels: "channel", tasks: "task", goals: "goal", notes: "note", agents: "agent", routine: "routine",
  suggestion: "suggestion", template: "template", visibility: "visibility", instruction: "instruction", role_line: "role line", providers: "AI sign-in", accounts: "AI account", keys: "key", devices: "device",
  invites: "invitation", members: "person", spaces: "Space", settings: "setting", skills: "skill", flows: "automation", runs: "run", holds: "hold", backups: "backup", computers: "computer", memory: "memory",
  facts: "fact", pages: "page", calendars: "calendar", events: "event", inboxes: "inbox", numbers: "phone number", mail: "email", drafts: "draft", forms: "form", sites: "site", apps: "app",
};
const SENTENCES: Readonly<Record<string, string>> = {
  "audit.viewed": "opened the audit log", "audit.view": "opened the audit log", "identity.claim_owner": "claimed this Space", "access.view_as": "looked at the Space as someone else",
  "access.requests.approve": "approved a request for access", "access.requests.decline": "declined a request for access", "access.request": "asked for access",
};
const a = (noun: string): string => (/^(?:[aeiou](?!ser|nique|nit))/i.test(noun) ? `an ${noun}` : /^(AI|SMS)\b/.test(noun) ? `an ${noun}` : `a ${noun}`);
const singular = (w: string): string => NOUN[w] ?? (w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.endsWith("ses") ? w.slice(0, -2) : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

function parts(action: string): { verb: string; verbWord: string; noun: string } | null {
  const words = action.split(/[._]/).filter((w) => w !== "");
  if (words.length === 0) return null;
  // the verb is the last word, or the word before it when the last is the thing ("remove_member", "set_owner", "run_now")
  let at = words.length - 1;
  // an event name already says it in the past ("role.changed", "gate.rule_changed", "file.moved"): that word is the verb
  const already = /(?:ed|sent|made|left|set|put|read|ran|got|took)$/.test(words[at]!) && words.length > 1 && !PAST[words[at]!];
  if (!already && !PAST[words[at]!] && at > 0 && PAST[words[at - 1]!]) at -= 1;
  const verbWord = words[at]!;
  const verb = PAST[verbWord] ?? (already ? verbWord : "changed");   // a verb this does not know reads as a change, never as a made-up past tense
  const after = words.slice(at + 1);
  const rest = words.slice(0, at);
  // the thing is what follows the verb, else the last word before it; with nothing but the module before it, the module is the thing
  const nounWord = after.length > 0 ? after[after.length - 1]! : rest.length > 1 ? rest[rest.length - 1]! : rest[0] ?? "";
  return { verb, verbWord, noun: nounWord === "" ? "" : singular(nounWord) };
}

/** What was done, without who and without what it was done to: "assigned a role", "changed the audience", "created an agent". */
export function actionWords(action: string): string {
  if (SENTENCES[action]) return SENTENCES[action]!;
  const p = parts(action);
  if (!p) return "did something";
  if (p.noun === "") return p.verb;
  return `${p.verb} ${p.verbWord === "set" || p.verbWord === "update" || p.verbWord === "configure" || p.verbWord === "reset" ? `the ${p.noun}` : a(p.noun)}`;
}

export interface ActionSentence { who: string; action: string; /** the name of what it was done to, when the log has a name for it */ thing?: string | undefined; /** the person an agent acted for */ forWho?: string | undefined }

/** "Priya Raman assigned a role to Omar Haddad, for Andrey" or "Priya Raman deleted the agent Dex": the thing joins with the verb's own word ("to", "from", "with"), else it follows its kind. */
export function actionSentence(s: ActionSentence): string {
  const forWho = s.forWho ? `, for ${s.forWho}` : "";
  if (SENTENCES[s.action] || !s.thing) return `${s.who} ${actionWords(s.action)}${forWho}`;
  const p = parts(s.action);
  if (!p) return `${s.who} did something to ${s.thing}${forWho}`;
  const prep = PREP[p.verbWord];
  if (prep) return `${s.who} ${p.verb} ${p.noun ? a(p.noun) : "it"} ${prep} ${s.thing}${forWho}`;
  // a role or access belongs to a person: "changed the role of Omar"
  if (p.noun === "role" || p.noun === "access" || p.noun === "permission exception") return `${s.who} ${p.verb} the ${p.noun} of ${s.thing}${forWho}`;
  return `${s.who} ${p.verb} ${p.noun ? `the ${p.noun} ` : ""}${s.thing}${forWho}`;
}
