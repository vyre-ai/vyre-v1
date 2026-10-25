// What the popup does, each one a capability, as plain functions so the tests drive them without a renderer. A failed write becomes one quiet line, never a thrown error from a
// click. Recording is two calls (start, stop); what happens to it is a third (process, with any of the four intents), a fourth keeps it as it is, a fifth deletes it.
import { DOUBLE_MS, SCROLL_MS, keyInput, toDisplay } from "./model.ts";
import type { Box, Display, Intent, KeyLike, Recording } from "./model.ts";

export interface PopupDeps {
  call(cap: string, input: unknown): Promise<unknown>;
  /** The quiet line under the screen. */
  note(text: string): void;
}

async function attempt<T>(d: PopupDeps, what: string, fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { d.note(`Could not ${what}. Try again.`); return null; }
}

let seq = 0;

export async function wake(d: PopupDeps, computerId: string, name: string): Promise<boolean> {
  return (await attempt(d, "wake it", async () => { await d.call("computers.wake", { computerId }); d.note(`${name} is awake`); return true; })) === true;
}

export async function takeOver(d: PopupDeps, computerId: string, name: string): Promise<boolean> {
  return (await attempt(d, "take over", async () => { await d.call("computers.take_over", { computerId }); d.note(`You're in control. ${name} waits.`); return true; })) === true;
}

export async function giveBack(d: PopupDeps, computerId: string, name: string): Promise<boolean> {
  return (await attempt(d, "give control back", async () => { await d.call("computers.give_back", { computerId }); d.note(`Control given back to ${name}`); return true; })) === true;
}

/** Start recording: returns the recording id, or null when it could not start. */
export async function startRecording(d: PopupDeps, computerId: string): Promise<string | null> {
  const out = await attempt(d, "start recording", async () => (await d.call("computers.record_start", { computerId })) as { recordingId: string });
  if (!out) return null;
  d.note("Recording. Everything you do on this screen is captured.");
  return out.recordingId;
}

/** Stop recording: returns the saved recording that the sheet is about. */
export async function stopRecording(d: PopupDeps, computerId: string): Promise<Recording | null> {
  const out = await attempt(d, "stop recording", async () => (await d.call("computers.record_stop", { computerId })) as { recording: Recording });
  return out ? out.recording : null;
}

/** Send the recording to the agent with any of the four intents; a task tracks the work. */
export async function sendRecording(d: PopupDeps, recordingId: string, intents: readonly Intent[], name: string): Promise<string | null> {
  if (intents.length === 0) return null;
  const out = await attempt(d, "send the recording", async () => (await d.call("computers.recording.process", { recordingId, intents: [...intents], idempotencyKey: `rec-${recordingId}-${++seq}` })) as { taskId: string });
  if (!out) return null;
  d.note(`Sent to ${name}. A task tracks it.`);
  return out.taskId;
}

/** Save only: the recording stays in the agent's folder as it is. */
export function keepRecording(d: PopupDeps, folderPath: string): void {
  d.note(`Saved to ${folderPath}`);
}

export async function discardRecording(d: PopupDeps, recordingId: string): Promise<boolean> {
  return (await attempt(d, "delete the recording", async () => { await d.call("computers.recording.delete", { recordingId }); d.note("Recording deleted"); return true; })) === true;
}

/** The stream a screen draws from: a ticket for a short time. Null while it cannot be had; the desktop then shows its last picture. */
export async function openStream(d: PopupDeps, computerId: string): Promise<{ transport: "webrtc" | "mjpeg"; url: string; ticket: string; expiresAt: number } | null> {
  try { return (await d.call("computers.stream", { computerId })) as { transport: "webrtc" | "mjpeg"; url: string; ticket: string; expiresAt: number }; } catch { return null; }
}

/* ---------- input while you are in control ---------- */

export interface Forwarder {
  /** A press at (x, y) in a view of `box` size. Two presses within DOUBLE_MS are a double-click. */
  press(x: number, y: number, box: Box, now: number, button?: "left" | "right" | "middle"): Promise<void>;
  /** A wheel turn at (x, y): positive `dy` scrolls down. Turns that come close together go as one call; `flushScroll` sends what is held. */
  scroll(x: number, y: number, box: Box, dx: number, dy: number): Promise<void>;
  flushScroll(): Promise<void>;
  /** A key. Letters collect into one `computers.screen.type`; anything else flushes them first and goes as a key combination. */
  key(e: KeyLike): Promise<void>;
  /** Send what has been typed so far. */
  flush(): Promise<void>;
}

/** Turns your presses and keys into calls on the agent's desktop. It never throws: a failed call is one quiet line. */
export function createForwarder(d: PopupDeps, computerId: string, display?: Display): Forwarder {
  let typed = "";
  let lastPress = -Infinity;
  let held: { x: number; y: number; dx: number; dy: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const send = async (cap: string, input: unknown): Promise<void> => { try { await d.call(cap, input); } catch { d.note("Could not send that to the screen. Try again."); } };
  const flush = async (): Promise<void> => {
    if (typed === "") return;
    const text = typed;
    typed = "";
    await send("computers.screen.type", { computerId, text });
  };
  const flushScroll = async (): Promise<void> => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (held === null) return;
    const h = held;
    held = null;
    if (h.dx === 0 && h.dy === 0) return;
    await send("computers.screen.scroll", { computerId, x: h.x, y: h.y, ...(h.dx !== 0 ? { dx: h.dx } : {}), dy: h.dy });
  };
  return {
    flush,
    flushScroll,
    async press(x, y, box, now, button = "left") {
      await flush();
      await flushScroll();
      const p = toDisplay(x, y, box, display);
      // Only the left button double-clicks; a right or middle press is always one click of its own.
      const double = button === "left" && now - lastPress <= DOUBLE_MS;
      lastPress = button !== "left" ? -Infinity : double ? -Infinity : now;
      await send("computers.screen.click", { computerId, x: p.x, y: p.y, ...(button !== "left" ? { button } : {}), ...(double ? { double: true } : {}) });
    },
    async scroll(x, y, box, dx, dy) {
      await flush();
      const p = toDisplay(x, y, box, display);
      held = { x: p.x, y: p.y, dx: (held?.dx ?? 0) + Math.round(dx), dy: (held?.dy ?? 0) + Math.round(dy) };
      if (timer === null) timer = setTimeout(() => { timer = null; void flushScroll(); }, SCROLL_MS);
    },
    async key(e) {
      const input = keyInput(e);
      if (!input) return;
      await flushScroll();
      if (input.kind === "text") { typed += input.text; return; }
      await flush();
      await send("computers.screen.key", { computerId, combo: input.combo });
    },
  };
}
