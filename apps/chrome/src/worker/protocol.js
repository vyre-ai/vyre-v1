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
//
// Capabilities the extension may call are listed here and nowhere else; anything else is refused before it is sent.
// A secret never travels worker -> app except the password of a login the person just submitted: once to ask whether the Vault knows it
// (bridge op login.check), and once more if they choose Save (vault.item.put or vault.item.update). Fill values travel the other way, by push.

export const HOST_NAME = "run.vyre.bridge";

/** Capabilities the extension calls (manifests/vault.ts, chat.ts): what each is for. */
export const CAPABILITIES = Object.freeze({
  "vault.items.match": "items that fit a page address: names and field keys, never values",
  "vault.use": "ask for an item by name or id and get a handle",
  "vault.fill": "fill a handle field into a browser ref; the filler pushes the value to the page",
  "vault.item.put": "save a new login (with login.check, the only calls that carry a password out of the page)",
  "vault.item.update": "change the password of a saved login the person chose to update",
  "vault.folders.list": "find the person's Mine folder to save into",
  "vault.site_rules.list": "Never Fill and Never Save sites",
  "vault.site_rules.set": "set or clear one site's rule",
  "vault.share": "share a saved login with the person's agent at Use level",
});

/** Bridge-level operations that are not capabilities: they are about this computer and this browser, not a Space's data. */
export const BRIDGE_OPS = Object.freeze({
  hello: "the app's version, the Spaces it knows and which is active",
  "space.select": "make one Space the extension's active Space (autofill and agents follow it)",
  "agents.list": "the active Space's agents with faces, and the suggested one for a page",
  "login.check": "the filler compares a submitted login with the vault and says known, changed or new, without revealing anything",
  "ask.page": "start an Ask about this page with an agent; the page title and address go, the question is the person's",
  "app.open": "open the Vyre app at a place (the Vault, an item)",
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
 * @returns {Reply | { type: "fill", ref: string, value: string } | { type: "spaces", spaces: any[], active: string | null } | null}
 */
export function parseIncoming(m) {
  if (!isObject(m)) return null;
  if (typeof m["id"] === "string" && m["ok"] === true) return { id: m["id"], ok: true, output: m["output"] };
  if (typeof m["id"] === "string" && m["ok"] === false && isObject(m["error"])) {
    return { id: m["id"], ok: false, error: { code: String(m["error"]["code"] ?? "error"), message: String(m["error"]["message"] ?? "") } };
  }
  if (m["type"] === "fill" && typeof m["ref"] === "string" && typeof m["value"] === "string") return { type: "fill", ref: m["ref"], value: m["value"] };
  if (m["type"] === "spaces" && Array.isArray(m["spaces"])) return { type: "spaces", spaces: m["spaces"], active: typeof m["active"] === "string" ? m["active"] : null };
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
});

/** @param {unknown} e @returns {string} */
export function wordsFor(e) {
  const code = e instanceof BridgeFailure ? e.code : isObject(e) && typeof e["code"] === "string" ? e["code"] : "";
  /** @type {Record<string,string>} */
  const table = WORDS;
  return table[code] ?? (isObject(e) && typeof e["message"] === "string" && e["message"] ? e["message"] : "Something went wrong. Try again.");
}
