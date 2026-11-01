// The tabs of the step panel. A tab is named for the card it opens (the trigger's own name, the step's title) and carries that card's icon, so three triggers are three different tabs.
// Titles are worked out from the definition each time, so renaming a step or changing a trigger renames its tab. At most MAX_TABS stay open; opening one more closes the oldest.
import type { PaneTab } from "../../../../../../ui/src/SidePane/index.tsx";
import { glyphSvg } from "./icons.tsx";
import { iconOfKey, titleOfKey, triggerMeta } from "./model.ts";
import type { Definition } from "./model.ts";

export const MAX_TABS = 4;

const TRIGGER_SHORT: Record<string, string> = {
  record_change: "Record changes", schedule: "On a schedule", webhook: "Webhook", form_submit: "Form submitted", email_received: "Email received", chat_message: "Chat message",
  spreadsheet_row: "Spreadsheet row", ci_check: "CI check", meeting_transcript_ready: "Transcript ready", journey_stage_entered: "Stage entered", journey_stage_left: "Stage left",
  campaign_reply: "Campaign reply", button: "Button", manual: "Run by hand",
};

/** "trigger:2" is the third trigger; any other key is a step id. A bare "trigger" is the first trigger. */
export const triggerIndexOf = (key: string): number | null => (key === "trigger" ? 0 : key.startsWith("trigger:") ? Number(key.slice(8)) : null);

function triggerTitle(def: Definition, index: number): string {
  const t = def.triggers[index];
  if (!t) return "Trigger";
  const named = typeof t.config?.["label"] === "string" && t.config["label"].trim() !== "";
  const base = named ? triggerMeta(t.key, t.config).title : (TRIGGER_SHORT[t.key] ?? triggerMeta(t.key, t.config).title);
  // two triggers of one kind and no names: number them, so the tabs can be told apart
  const same = def.triggers.map((x, at) => ({ x, at })).filter(({ x }) => x.key === t.key && !(typeof x.config?.["label"] === "string" && x.config["label"].trim() !== ""));
  return !named && same.length > 1 ? `${base} ${same.findIndex(({ at }) => at === index) + 1}` : base;
}

export function tabTitle(def: Definition, key: string): string {
  const at = triggerIndexOf(key);
  if (at !== null) return triggerTitle(def, at);
  const n = def.nodes.find((x) => x.id === key);
  return n ? (n.title && n.title.trim() ? n.title : titleOfKey(n.key)) : key;
}

export function tabIcon(def: Definition, key: string): string {
  const at = triggerIndexOf(key);
  if (at !== null) { const t = def.triggers[at]; return glyphSvg(t ? triggerMeta(t.key, t.config).icon : "bolt"); }
  const n = def.nodes.find((x) => x.id === key);
  return glyphSvg(n ? iconOfKey(n.key) : "record");
}

/** A tab key is open only while its card exists. */
export function exists(def: Definition, key: string): boolean {
  const at = triggerIndexOf(key);
  return at !== null ? at < def.triggers.length : def.nodes.some((n) => n.id === key);
}

export function normalKey(key: string): string {
  return key === "trigger" ? "trigger:0" : key;
}

/** The keys after opening `key`: it goes last, and the oldest other tab closes when there are more than `max`. */
export function openTab(keys: readonly string[], key: string, max = MAX_TABS): string[] {
  const k = normalKey(key);
  const next = keys.includes(k) ? [...keys] : [...keys, k];
  while (next.length > max) {
    const drop = next.findIndex((x) => x !== k);
    if (drop < 0) break;
    next.splice(drop, 1);
  }
  return next;
}

/** After trigger `index` is removed: its tab closes and the tabs of the triggers after it move up by one. */
export function dropTrigger(keys: readonly string[], index: number): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const at = triggerIndexOf(key);
    if (at === null) out.push(key);
    else if (at < index) out.push(key);
    else if (at > index) out.push(`trigger:${at - 1}`);
  }
  return out;
}

export function paneTabs(def: Definition, keys: readonly string[]): PaneTab[] {
  return keys.filter((k) => exists(def, k)).map((k) => ({ key: k, title: tabTitle(def, k), icon: tabIcon(def, k) }));
}
