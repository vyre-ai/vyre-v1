// @ts-check
// Agent control: the wire between the Vyre app and the extension for agent browsing (V1-SPEC 3.12 and 2.7, ARCH 7.12).
// The `chrome_*` tools are `computer` toolset capabilities (manifests/computers.ts). Whichever bridge owns the tab executes them: for an agent's own
// computer that is this extension, signed in as the agent; for a person's Chrome it is this extension too, opt-in per Space.
//
//   app -> ext   { type: "agent.call", id, tool, input, agent: { id, name }, space }    one tool call for one agent in one Space
//   app -> ext   { type: "agent.optin", spaces: [spaceId], mode }                     the Spaces whose agents may drive this Chrome (never stored here); mode "computer" in an agent computer, else "personal"
//   ext -> app   { id, type: "bridge", op: "agent.result", input: { callId, ok, output | error } }
//   ext -> app   { id, type: "bridge", op: "agent.event", input: { event, ... } }     driving, acted, plan, stopped, paused, resumed (logged under the agent)
//
// The same host program (native/host.js) relays both ways, so this rides the existing `run.vyre.bridge` messaging host on a port of its own.

import { BridgeFailure } from "../worker/protocol.js";

/** The tool names the model sees (`mcpName`) and the capability each one executes (manifests/computers.ts). */
export const TOOLS = Object.freeze({
  chrome_snapshot: "computers.chrome.snapshot",
  chrome_act: "computers.chrome.act",
  chrome_click: "computers.chrome.click",
  chrome_type: "computers.chrome.type",
  chrome_fill: "computers.chrome.fill",
  chrome_open: "computers.chrome.open",
  chrome_tabs: "computers.chrome.tabs",
  chrome_wait: "computers.chrome.wait",
  chrome_screenshot: "computers.chrome.screenshot",
  chrome_eval: "computers.chrome.eval",
  chrome_console: "computers.chrome.console",
  chrome_net: "computers.chrome.net",
  chrome_inspect: "computers.chrome.inspect",
  chrome_state: "computers.chrome.state",
  chrome_status: "computers.chrome.status",
  chrome_stop: "computers.chrome.stop",
  chrome_resume: "computers.chrome.resume",
  chrome_send: "computers.chrome.send",
  chrome_batch: "computers.chrome.batch",
  chrome_plan: "computers.chrome.plan",
  chrome_api: "computers.chrome.api",
  chrome_sources: "computers.chrome.sources",
});

/** Tools that may run inside chrome_batch: nothing that the Gate must see on its own (send, non-GET api) and nothing that stops or resumes. */
export const BATCHABLE = Object.freeze(new Set([
  "chrome_snapshot", "chrome_act", "chrome_click", "chrome_type", "chrome_fill", "chrome_open", "chrome_tabs", "chrome_wait",
  "chrome_screenshot", "chrome_console", "chrome_net", "chrome_inspect", "chrome_state", "chrome_status", "chrome_plan", "chrome_api", "chrome_sources",
]));

export const ACTIONS = Object.freeze(["click", "double_click", "hover", "press", "select", "scroll", "check", "uncheck", "focus"]);
export const WAITS = Object.freeze(["load", "text", "selector", "network_idle", "time"]);
export const METHODS = Object.freeze(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/**
 * Input shapes, in the contract's own words. "s" string, "n" number, "b" boolean, "o" object, "a" array; a trailing "?" means optional; an array is an enum.
 * @type {Record<string, Record<string, string | readonly string[]>>}
 */
const SHAPES = {
  chrome_snapshot: { tabId: "s?", selector: "s?", format: ["tree", "text", "?"] },
  chrome_act: { tabId: "s?", ref: "s?", action: ACTIONS, value: "s?" },
  chrome_click: { tabId: "s?", ref: "s?", x: "n?", y: "n?", button: ["left", "right", "middle", "?"] },
  chrome_type: { tabId: "s?", ref: "s?", text: "s", submit: "b?" },
  chrome_fill: { tabId: "s?", fields: "a" },
  chrome_open: { url: "s", newTab: "b?" },
  chrome_tabs: { action: ["list", "use", "new", "close"], tabId: "s?", url: "s?" },
  chrome_wait: { tabId: "s?", until: WAITS, value: "s?", timeoutMs: "n?" },
  chrome_screenshot: { tabId: "s?", ref: "s?", fullPage: "b?" },
  chrome_eval: { tabId: "s?", expression: "s" },
  chrome_console: { tabId: "s?", level: ["log", "warn", "error", "?"], limit: "n?" },
  chrome_net: { tabId: "s?", filter: "s?", bodies: "b?", limit: "n?" },
  chrome_inspect: { tabId: "s?", ref: "s" },
  chrome_state: { tabId: "s?" },
  chrome_status: {},
  chrome_stop: { reason: "s?" },
  chrome_resume: {},
  chrome_send: { heldId: "s" },
  chrome_batch: { tabId: "s?", steps: "a" },
  chrome_plan: { goal: "s", steps: "a?" },
  chrome_api: { method: METHODS, url: "s", headers: "o?", body: "?" },
  chrome_sources: { tabId: "s?" },
};

/** An error with a code the app turns into words for the agent. */
export class AgentFailure extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "AgentFailure";
    this.code = code;
  }
}

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Check a tool's input against its shape. Unknown keys are refused so a typo is an error, not a silent default.
 * @param {string} tool @param {unknown} input @returns {Record<string, any>}
 */
export function checkInput(tool, input) {
  const shape = SHAPES[tool];
  if (!shape) throw new AgentFailure("unknown_tool", `${tool} is not a Chrome tool`);
  const value = input === undefined ? {} : input;
  if (!isObject(value)) throw new AgentFailure("bad_input", `${tool} takes an object`);
  for (const key of Object.keys(value)) {
    if (key === "computerId") continue; // routing for the host, not for the page
    if (!(key in shape)) throw new AgentFailure("bad_input", `${tool} has no input called ${key}`);
  }
  for (const [key, kind] of Object.entries(shape)) {
    const v = value[key];
    if (Array.isArray(kind)) {
      const optional = kind.includes("?");
      if (v === undefined || v === null) { if (optional) continue; throw new AgentFailure("bad_input", `${tool} needs ${key}`); }
      if (!kind.includes(v)) throw new AgentFailure("bad_input", `${key} must be one of ${kind.filter((k) => k !== "?").join(", ")}`);
      continue;
    }
    if (kind === "?") continue;
    const optional = kind.endsWith("?");
    if (v === undefined || v === null) { if (optional) continue; throw new AgentFailure("bad_input", `${tool} needs ${key}`); }
    const t = kind[0];
    const ok = t === "s" ? typeof v === "string" : t === "n" ? typeof v === "number" && Number.isFinite(v) : t === "b" ? typeof v === "boolean" : t === "o" ? isObject(v) : Array.isArray(v);
    if (!ok) throw new AgentFailure("bad_input", `${key} has the wrong type`);
  }
  return value;
}

/**
 * A message from the app, checked before anyone acts on it. Returns null for anything the agent channel does not understand.
 * @param {unknown} m
 * @returns {{ type: "agent.call", id: string, tool: string, input: Record<string, any>, agent: { id: string, name: string }, space: string } | { type: "agent.optin", spaces: string[], mode: "personal" | "computer" } | null}
 */
export function parseCommand(m) {
  if (!isObject(m)) return null;
  if (m["type"] === "agent.optin" && Array.isArray(m["spaces"])) return { type: "agent.optin", spaces: m["spaces"].filter((/** @type {unknown} */ s) => typeof s === "string").slice(0, 100), mode: m["mode"] === "computer" ? "computer" : "personal" };
  if (m["type"] !== "agent.call") return null;
  const agent = m["agent"];
  if (typeof m["id"] !== "string" || typeof m["tool"] !== "string" || !isObject(agent) || typeof agent["id"] !== "string" || typeof agent["name"] !== "string" || typeof m["space"] !== "string") return null;
  return { type: "agent.call", id: m["id"], tool: m["tool"], input: isObject(m["input"]) ? m["input"] : {}, agent: { id: agent["id"], name: String(agent["name"]).slice(0, 40) }, space: m["space"] };
}

/** The words an agent reads for each failure code (the person reads them in the run log too). */
export const WORDS = Object.freeze({
  not_opted_in: "This Chrome has not been opened to agents for that Space. The person turns it on in Vyre for Chrome.",
  wrong_space: "That agent belongs to a Space that is not the active Space in this Chrome.",
  paused: "The person stopped the agent in this Chrome. Wait until they say to go on, then call chrome_resume.",
  busy: "Another agent is using that tab.",
  no_tab: "There is no tab to work in. Open a page with chrome_open first.",
  no_page: "That tab is not a web page the agent may drive.",
  tab_limit: "The tab limit is reached. Close a tab with chrome_tabs first.",
  not_yours: "That tab is not one this agent opened or was given.",
  unknown_ref: "That ref is not on the page the agent last read. Take a new chrome_snapshot.",
  no_element: "Nothing on the page matches that.",
  held_gone: "That held item is not waiting any more. Ask again.",
  not_public: "Agents browse the public web only. That address is on this computer or a private network.",
  not_in_batch: "That step cannot run inside a batch because it needs its own approval.",
  secret_field: "That field holds a secret. Fill it with a #Handle.field reference from the Vault, not with text.",
  fill_failed: "The Vault could not fill that handle into the field.",
  handle_unsupported: "chrome_api cannot carry a Vault handle. Sign in on the page first: the call uses the page's session.",
  cross_origin: "chrome_api calls the site the tab is on. Open that site first.",
  debugger_denied: "Chrome would not let the extension control that tab.",
  bad_input: "That input is not valid.",
  unknown_tool: "That is not a Chrome tool.",
  timeout: "The page did not answer in time.",
  offline: "The Vyre app is not reachable from this Chrome.",
});

/** @param {unknown} e @returns {{ code: string, message: string }} */
export function errorOf(e) {
  if (e instanceof AgentFailure) return { code: e.code, message: e.message || /** @type {Record<string,string>} */ (WORDS)[e.code] || "Something went wrong." };
  if (e instanceof BridgeFailure) return { code: e.code, message: e.message || "Something went wrong." };
  return { code: "error", message: "Something went wrong in the page. Take a new snapshot and try again." };
}

/** Throw the plain-words failure for a code. @param {string} code @param {string} [detail] @returns {never} */
export function fail(code, detail) {
  const base = /** @type {Record<string,string>} */ (WORDS)[code] ?? "Something went wrong.";
  throw new AgentFailure(code, detail ? `${base} ${detail}` : base);
}

export const OVERLAY_PORT = "vyre.agent.overlay";
export const TAB_LIMIT = 8;
export const HELD_TTL_MS = 10 * 60_000;
export const IDLE_MS = 20_000;
