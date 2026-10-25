// The computer popup's logic, with no renderer (spec 2.7): what the pill says, which side icons show, how a recording is described, what the "what should the agent do with it"
// sheet offers, and how a pointer press or a key becomes input on the agent's desktop. The tests drive these rules directly.
import type { CapMap } from "../../../../../../generated/types.ts";

export type Computer = CapMap["computers.get"]["out"]["computer"];
export type Recording = CapMap["computers.recording.get"]["out"]["recording"];
export type Intent = CapMap["computers.recording.process"]["in"]["intents"][number];

export interface Clock { now: number; offsetMin: number }

/* ---------- state ---------- */

export type ScreenKind = "asleep" | "live" | "mine" | "busy" | "error";

export interface PopupView {
  screen: ScreenKind;
  /** the dark pill at the top of the screen */
  pill: string;
}

export function mmss(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function popupView(c: Computer, name: string, recordingSecs: number | null): PopupView {
  if (recordingSecs !== null) return { screen: "mine", pill: `Recording · ${mmss(recordingSecs)}` };
  switch (c.state) {
    case "asleep": return { screen: "asleep", pill: `${name}'s computer is asleep` };
    case "waking": return { screen: "busy", pill: `${name}'s computer is waking` };
    case "provisioning": return { screen: "busy", pill: `${name}'s computer is being set up` };
    case "working": return { screen: "live", pill: `${name} is working` };
    case "takeover": return { screen: "mine", pill: `You're in control · ${name} is waiting` };
    case "error": return { screen: "error", pill: `${name}'s computer needs attention` };
  }
}

export type RailKey = "take" | "record" | "chat" | "close";
export interface RailItem {
  key: RailKey;
  label: string;
  /** the words in the tip beside the icon */
  tip: string;
  on: boolean;
  disabled: boolean;
  /** a timer shown under the icon while recording */
  timer?: string;
}

/** The icons on the side, top to bottom: Take over (it flips to Give back), Record (only while you are in control), Chat, Close. */
export function railItems(c: Computer, recordingSecs: number | null, chatOpen: boolean): RailItem[] {
  const mine = c.state === "takeover";
  const reachable = c.state === "working" || c.state === "takeover";
  const items: RailItem[] = [];
  items.push({
    key: "take", label: mine ? "Give back control" : "Take over", tip: mine ? "Give back" : "Take over", on: mine,
    disabled: !reachable || recordingSecs !== null,
  });
  if (mine) {
    const rec = recordingSecs !== null;
    items.push({ key: "record", label: rec ? "Stop recording" : "Record", tip: rec ? "Stop recording" : "Record what you do", on: rec, disabled: false, ...(rec ? { timer: mmss(recordingSecs) } : {}) });
  }
  items.push({ key: "chat", label: chatOpen ? "Hide chat" : "Show chat", tip: chatOpen ? "Hide chat" : "Chat beside the screen", on: chatOpen, disabled: false });
  items.push({ key: "close", label: "Close", tip: "Close · Esc", on: false, disabled: false });
  return items;
}

/* ---------- recording ---------- */

export interface Capture { clicks: number; pages: number; requests: number }
export const NO_CAPTURE: Capture = { clicks: 0, pages: 1, requests: 0 };

export interface CaptureStore { get(): Capture; subscribe(l: () => void): () => void }

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The counter under the screen while recording. */
export function captureParts(c: Capture): string[] {
  return [plural(c.clicks, "click", "clicks"), plural(c.pages, "page", "pages"), plural(c.requests, "network call", "network calls"), "Video"];
}

/** The line on the sheet: what the recording holds. */
export function captureLine(c: Capture): string {
  return `Video, ${plural(c.clicks, "click", "clicks")} and keystrokes, ${plural(c.pages, "page", "pages")}, ${plural(c.requests, "network call", "network calls")}.`;
}

export const MASKED_NOTE = "Passwords and sealed fields are masked.";

export interface Option { key: Intent; title: string; blurb: string }

/** What the agent can do with a recording; any of them (spec 2.7). */
export function options(name: string): Option[] {
  return [
    { key: "make_skill", title: "Make a skill", blurb: `Turn what you did into a skill ${name} can run on its own, with the steps written down.` },
    { key: "learn_routine", title: "Learn a routine", blurb: "Do this on a schedule or when something happens, like every weekday at 8." },
    { key: "work_out_backend_calls", title: "Understand the app", blurb: `Study the network calls behind each click so ${name} can use the app's own API instead of the screen.` },
    { key: "learn_workflow", title: "Copy my workflow exactly", blurb: "Repeat the same clicks, in the same order, the way you do it." },
  ];
}

export const DEFAULT_INTENTS: readonly Intent[] = ["make_skill"];

/** Toggles one choice. At least one stays picked, so Send always means something. */
export function toggleIntent(picked: readonly Intent[], key: Intent): Intent[] {
  if (picked.includes(key)) return picked.length === 1 ? picked.slice() : picked.filter((k) => k !== key);
  return [...picked, key];
}

/** In the order the sheet lists them, whatever order they were picked in. */
export function orderedIntents(picked: readonly Intent[], name: string): Intent[] {
  return options(name).map((o) => o.key).filter((k) => picked.includes(k));
}

/* ---------- input while you are in control ---------- */

/** The computer's display, in the pixels `computers.screen.click` and friends use. */
export interface Display { width: number; height: number }
export const DISPLAY: Display = { width: 1280, height: 800 };

export interface Box { width: number; height: number }

/** A press at (x, y) inside a view of `box` size, as a point on the display. Clamped to the display. */
export function toDisplay(x: number, y: number, box: Box, display: Display = DISPLAY): { x: number; y: number } {
  if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0 };
  const px = Math.round((x / box.width) * display.width);
  const py = Math.round((y / box.height) * display.height);
  return { x: Math.min(display.width - 1, Math.max(0, px)), y: Math.min(display.height - 1, Math.max(0, py)) };
}

export interface KeyLike { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }
export type KeyInput = { kind: "text"; text: string } | { kind: "combo"; combo: string };

const NAMED: Record<string, string> = {
  Enter: "Return", Backspace: "BackSpace", Tab: "Tab", Delete: "Delete", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Home: "Home", End: "End", PageUp: "Page_Up", PageDown: "Page_Down",
};

/** A key press as input: a letter or symbol is text; Enter, arrows and anything held with Ctrl, Alt or Meta is a combination such as "ctrl+l". Escape is not forwarded: it closes the popup. */
export function keyInput(e: KeyLike): KeyInput | null {
  if (e.key === "Escape" || e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta" || e.key === "CapsLock") return null;
  const held = e.ctrlKey === true || e.altKey === true || e.metaKey === true;
  if (!held && e.key.length === 1) return { kind: "text", text: e.key };
  const name = NAMED[e.key] ?? (e.key.length === 1 ? e.key.toLowerCase() : e.key);
  const parts: string[] = [];
  if (e.ctrlKey === true) parts.push("ctrl");
  if (e.altKey === true) parts.push("alt");
  if (e.metaKey === true) parts.push("super");
  if (e.shiftKey === true && (e.key.length > 1 || held)) parts.push("shift");
  parts.push(name);
  return { kind: "combo", combo: parts.join("+") };
}

/** Two presses this close together are one double-click. */
export const DOUBLE_MS = 350;
/** Wheel turns this close together are sent as one scroll. */
export const SCROLL_MS = 40;

export function stateWord(c: Computer): string {
  switch (c.state) {
    case "asleep": return "Asleep";
    case "waking": return "Waking";
    case "provisioning": return "Setting up";
    case "working": return "Working";
    case "takeover": return "You're in control";
    case "error": return "Needs attention";
  }
}
