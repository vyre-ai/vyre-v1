// @ts-check
// The wire between the extension and the Vyre app on this computer (V1-SPEC 3.12, ARCH 7.12).
// Chrome starts the native messaging host `run.vyre.bridge`; the host is the local vyred device daemon's Chrome bridge.
// Every message is one JSON object. The extension asks, the app answers, and the app may push.
//
//   worker -> app   { id, type: "invoke", capability, input }     one capability call as the signed-in person, for the active Space
//   worker -> app   { id, type: "bridge", op, input }              a bridge-level question (below)
//   app -> worker   { id, ok: true, output } | { id, ok: false, error: { code, message } }
//   app -> worker   { type: "fill", ref, value }                   the vault filler pushing one value for a ref the worker handed out
//   app -> worker   { type: "spaces", spaces, active }             the Space list or the active Space changed
//   app -> worker   { type: "chat.delta", threadId, turnId, text, done, error? }   a side panel reply streaming in (text is the whole reply so far)
//   app -> worker   { type: "watch.run", watchId }                 check one My Chrome watch now (Check now in Automations)
//   app -> worker   { type: "tab.open", url }                      "Open the page" from a chat that started in Chrome
//
// Capabilities the extension may call are listed here and nowhere else; anything else is refused before it is sent.
// A secret never travels worker -> app except the password of a login the person just submitted: once to ask whether the Vault knows it
// (bridge op login.check), and once more if they choose Save (vault.item.put or vault.item.update). Fill values travel the other way, by push.

export const HOST_NAME = "run.vyre.bridge";

/** Capabilities the extension calls (manifests/vault.ts, chat.ts): what each is for. */
export const CAPABILITIES = Object.freeze({
  "vault.items.match": "items that fit a page address: names and field keys, never values",
  "vault.use": "ask for an item by name or id and get a handle",
  "vault.items.list": "the person's card items, names only, for the popup's Cards list (never values)",
  "vault.fill": "fill a handle field into a browser ref; the filler pushes the value to the page",
  "vault.item.put": "save a new login (with login.check, the only calls that carry a password out of the page)",
  "vault.item.update": "change the password of a saved login the person chose to update",
  "vault.folders.list": "find the folder to save into: the person's Mine folder, or the shared folders they may add to",
  "vault.site_rules.list": "Never Fill and Never Save sites",
  "vault.site_rules.set": "set or clear one site's rule",
  "notes.clip": "clip the page into a private note: its address, title, the selected text and a screenshot",
  "vault.share": "share a saved login with the person's agent at Use level",
  "notes.clip": "Save to Notes from a page: the address, title, the selection and a masked screenshot (lane l-notes)",
  "skills.mine.add": "save a recording the person reviewed as one of their skills: SKILL.md and its replay script (lane l-skills2)",
  "skills.share": "share that skill with people in the Space, who each get a card (lane l-skills2)",
  "engine.models.list": "the live models the person's AI account can reach, for the side panel's model picker (lane l-livemodels; never a list kept here)",
  "browser.sites.list": "the Space's Browser connections: sites agents may use, where they run, each agent's rights",
  "browser.watches.list": "the person's watches that run in this Chrome",
  "browser.watches.save": "create or change a watch from the Watch sheet",
  "browser.watches.remove": "remove or pause a watch",
  "browser.watches.report": "a My Chrome watch checked a page: what it read, and the before and after when it changed",
});

/** Bridge-level operations that are not capabilities: they are about this computer and this browser, not a Space's data. */
export const BRIDGE_OPS = Object.freeze({
  hello: "the app's version, the Spaces it knows and which is active",
  "space.select": "make one Space the extension's active Space (autofill and agents follow it)",
  "agents.list": "the active Space's agents with faces, and the suggested one for a page",
  "login.check": "the filler compares a submitted login with the vault and says known, changed or new, without revealing anything",
  "ask.page": "start an Ask about this page with an agent; the page title and address go, the question is the person's",
  "app.open": "open the Vyre app at a place (the Vault, an item, a chat, a note, a skill, Automations > Watching)",
  "chat.ask": "send a side panel message to an agent in the active Space: the same thread as Vyre Chats; the reply streams back as chat.delta pushes",
  "chat.search": "find the person's chats in the active Space by words, for the side panel's chat search",
  "chat.thread": "one chat's messages, to show it in the side panel",
  "records.match": "records that match a page: from its address and the email addresses and phone numbers written on it, with their recent chats and goals",
});

/** Where a field value goes. `role` says what the page field is for. */
export const ROLES = Object.freeze(["username", "password", "otp"]);

export const REF_TTL_MS = 30_000;

/** @typedef {{ code: string, message: string }} BridgeError */
/** @typedef {{ id: string, ok: true, output: any } | { id: string, ok: false, error: BridgeError }} Reply */

/** @param {unknown} v @returns {v is Record<string, any>} */
export const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Build a request. Refuses a capability or op that is not in the lists above.
 * @param {string} id
 * @param {"invoke"|"bridge"} type
 * @param {string} name capability or op
 * @param {Record<string, any>} [input]
 */
export function request(id, type, name, input = {}) {
  if (type === "invoke" && !(name in CAPABILITIES)) throw new BridgeFailure("not_allowed", `the extension may not call ${name}`);
  if (type === "bridge" && !(name in BRIDGE_OPS)) throw new BridgeFailure("not_allowed", `the extension has no bridge operation ${name}`);
  return type === "invoke" ? { id, type, capability: name, input } : { id, type, op: name, input };
}

/**
 * Check a message from the app. Returns the message when it is one the extension understands, else null (and the caller drops it).
 * @param {unknown} m
 * @returns {Reply | { type: "fill", ref: string, value: string } | { type: "spaces", spaces: any[], active: string | null } | { type: "chat.delta", threadId: string, turnId: string, text: string, done: boolean, error: string | null } | { type: "watch.run", watchId: string } | { type: "tab.open", url: string } | null}
 */
export function parseIncoming(m) {
  if (!isObject(m)) return null;
  if (typeof m["id"] === "string" && m["ok"] === true) return { id: m["id"], ok: true, output: m["output"] };
  if (typeof m["id"] === "string" && m["ok"] === false && isObject(m["error"])) {
    return { id: m["id"], ok: false, error: { code: String(m["error"]["code"] ?? "error"), message: String(m["error"]["message"] ?? "") } };
  }
  if (m["type"] === "fill" && typeof m["ref"] === "string" && typeof m["value"] === "string") return { type: "fill", ref: m["ref"], value: m["value"] };
  if (m["type"] === "spaces" && Array.isArray(m["spaces"])) return { type: "spaces", spaces: m["spaces"], active: typeof m["active"] === "string" ? m["active"] : null };
  if (m["type"] === "chat.delta" && typeof m["threadId"] === "string" && typeof m["turnId"] === "string" && typeof m["text"] === "string") {
    return { type: "chat.delta", threadId: m["threadId"], turnId: m["turnId"], text: m["text"].slice(0, 200_000), done: m["done"] === true, error: typeof m["error"] === "string" ? m["error"].slice(0, 500) : null };
  }
  if (m["type"] === "watch.run" && typeof m["watchId"] === "string") return { type: "watch.run", watchId: m["watchId"] };
  if (m["type"] === "tab.open" && typeof m["url"] === "string" && /^https?:\/\//i.test(m["url"])) return { type: "tab.open", url: m["url"] };
  return null;
}

/** An error with a code the popup can turn into words. */
export class BridgeFailure extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "BridgeFailure";
    this.code = code;
  }
}

/** The words a person reads for each failure code. */
export const WORDS = Object.freeze({
  no_host: "Vyre is not installed on this computer. Open your Space in the web app instead.",
  offline: "The Vyre app is not running. Open it and try again.",
  locked: "Your vault is locked. Unlock it in the Vyre app.",
  timeout: "The Vyre app did not answer in time.",
  never_fill: "Filling is turned off for this site.",
  insecure: "This page is not secure (http), so Vyre will not fill it.",
  no_field: "Vyre could not find a sign-in field on this page.",
  not_allowed: "That is not something the extension may do.",
  no_page: "This tab is not a web page.",
  incognito: "Vyre is off in incognito windows.",
  never_site: "This site is never sent to Vyre. Change it under This site.",
  not_available: "The Vyre app cannot do that yet.",
});

/** @param {unknown} e @returns {string} */
export function wordsFor(e) {
  const code = e instanceof BridgeFailure ? e.code : isObject(e) && typeof e["code"] === "string" ? e["code"] : "";
  /** @type {Record<string,string>} */
  const table = WORDS;
  return table[code] ?? (isObject(e) && typeof e["message"] === "string" && e["message"] ? e["message"] : "Something went wrong. Try again.");
}
