// The chat's two cards for an agent working in the person's own Chrome, made from the events the extension sends the daemon's Chrome bridge (apps/chrome/src/agent/sessions.js, tools.js):
//   held     a send, post, payment or delete waits for the person         -> a chrome_held block (To, From, Subject, Message; Send, Edit, Don't send)
//   frame    a small masked picture of the tab while the agent works      -> a chrome_step block "Using your Chrome · <site>"
//   saw      a Vault handle was filled into a page                         -> adds the handle (its name only) to the step's "Show what <agent> saw" list
//   driving  off, takeover, stopped, paused                               -> the same step block, in its last state
// The event carries the chat (`thread`) the agent was asked in; without it there is nowhere to put a card and none is made. Pure: no node imports, nothing stored, never a value from a secret field
// (the extension never reads one). The block shapes are the ones apps/app/src/places/chats/conversation/chrome-cards.tsx reads.
import type { AgentEvent } from "./chrome-bridge.ts";

export interface ChromeBlock { type: "chrome_held" | "chrome_step"; v: 1; thread: string; key: string; data: Record<string, unknown> }

const str = (v: unknown, n: number): string => (typeof v === "string" ? v.slice(0, n) : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const THUMB = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/** The block an event asks for, or null when it asks for none (or names no chat). `key` is stable for what the card is about, so a later event updates the same card. */
export function blockOf(e: AgentEvent): ChromeBlock | null {
  const thread = str(e["thread"], 80);
  const agent = str(e["agent"], 80);
  if (!thread || !agent) return null;
  const name = str(e["name"], 60);
  switch (e.event) {
    case "held": {
      const id = str(e["id"], 80);
      if (!/^hld_[0-9a-f]+$/.test(id)) return null;
      const card = obj(e["card"]);
      const pick = (k: string, n: number): string => str(card[k], n);
      return { type: "chrome_held", v: 1, thread, key: id, data: { heldId: id, agent: name, site: pick("site", 120), kind: str(e["kind"], 20), summary: str(e["summary"], 200), card: { to: pick("to", 200), from: pick("from", 200), subject: pick("subject", 200), message: pick("message", 2000) }, state: "waiting" } };
    }
    case "frame": {
      const thumb = str(e["thumb"], 400_000);
      return { type: "chrome_step", v: 1, thread, key: `step:${agent}`, data: { agent: name, site: str(e["site"], 120), thumb: THUMB.test(thumb) ? thumb : null, state: "using" } };
    }
    case "driving": {
      if (e["on"] !== false) return null;
      const why = str(e["why"], 80);
      const state = why === "idle" ? "done" : /stopped/.test(why) || why === "the person took over" ? "stopped" : "done";
      return { type: "chrome_step", v: 1, thread, key: `step:${agent}`, data: { agent: name, site: str(e["site"], 120), thumb: null, state } };
    }
    case "saw": {
      const handle = str(e["handle"], 120);
      return /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/.test(handle) ? { type: "chrome_step", v: 1, thread, key: `step:${agent}`, data: { agent: name, site: str(e["site"], 120), thumb: null, state: "using", saw: [handle] } } : null;
    }
    case "paused": return { type: "chrome_step", v: 1, thread, key: `step:${agent}`, data: { agent: name, site: str(e["site"], 120), thumb: null, state: "paused" } };
    default: return null;
  }
}

const HELD_ID = /^hld_[0-9a-f]+$/;
/**
 * The block a card post may carry, cut down to what the chat reads, or null. Only the two chrome card types, a real held id, only the four named fields, and a picture only as the extension's own data image.
 * Whoever posts gets the same cleaning, so a card never carries more than the page's own fields.
 */
export function cleanBlock(type: unknown, data: unknown): { type: "chrome_held" | "chrome_step"; v: 1; data: Record<string, unknown> } | null {
  const d = obj(data);
  if (type === "chrome_held") {
    const heldId = str(d["heldId"], 80);
    if (!HELD_ID.test(heldId)) return null;
    const card = obj(d["card"]);
    const pick = (k: string, n: number): string => str(card[k], n);
    const state = d["state"] === "sent" || d["state"] === "dropped" || d["state"] === "expired" ? d["state"] : "waiting";
    return { type: "chrome_held", v: 1, data: { heldId, agentId: str(d["agentId"], 80), agent: str(d["agent"], 60), site: str(d["site"], 120), kind: str(d["kind"], 20) || "send", summary: str(d["summary"], 200), card: { to: pick("to", 200), from: pick("from", 200), subject: pick("subject", 200), message: pick("message", 2000) }, state } };
  }
  if (type === "chrome_step") {
    const site = str(d["site"], 120);
    if (!site) return null;
    const thumb = str(d["thumb"], 400_000);
    const state = ["waiting", "paused", "done", "stopped"].includes(String(d["state"])) ? d["state"] : "using";
    const saw = (Array.isArray(d["saw"]) ? d["saw"] : []).filter((h): h is string => typeof h === "string" && /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/.test(h)).slice(0, 20);
    return { type: "chrome_step", v: 1, data: { agentId: str(d["agentId"], 80), agent: str(d["agent"], 60), site, thumb: THUMB.test(thumb) ? thumb : null, state, saw } };
  }
  return null;
}
