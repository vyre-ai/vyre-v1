// A turn on the person's own computer (lane l-runson; owner rulings 2 and 3 Nov), and what happens when that computer sleeps in the middle of it.
//
// The Space keeps the turn: its queue row, its lease, its tools (over MCP), its approvals, Stop, compaction and its record stay where they are, and only the engine process runs on the computer
// (node-turns.ts routes the session there). So the turn is one turn wherever it runs; it never runs twice, because the engine's single turn per chat is the only owner of it.
//
// The computer goes away mid-turn (its link drops: asleep, offline, the app quit). The session below sees the engine end and finds the link gone:
//   Automatic      the chat says "Your computer went to sleep; continuing on <the Space's server>" and the same turn goes on there, from the same point: the engine there is told what was already
//                  said and which steps were already done, and resumes its own session for the chat when it has one. Nothing done is done again.
//   This computer  the chat says the turn waits for the computer, with "Run it on the server instead". It goes on when the computer is back (on it), or on the server when the person presses the
//                  button, or ends when they press Stop. While it waits the live line says so; nothing pretends to be working.
import type { DriverEvent, EngineSession, StoredMessage, ToolResult, TurnInput } from "../../agent/src/turn-engine/types.ts";

/** The live step of a turn waiting for the person's computer: the activity line reads it as "Waiting for your computer" (apps/app/src/places/chats/conversation/activity.ts). */
export const DEVICE_WAIT_STEP = "device_wait";

export const sleptLine = (server: string): string => `Your computer went to sleep; continuing on ${server}`;
export const SLEPT_WAIT_LINE = "Your computer went to sleep. This chat waits for it.";
export const DEVICE_WAIT_LINE = "Your computer is off. This chat runs when it is back.";

/** How often a waiting turn says it is still there, so the engine's quiet-session check never takes the wait for a hung engine. */
const BEAT_MS = 60_000;

export interface HandoverDeps {
  /** The link of the computer the turn is on is still up. */
  linkUp(): boolean;
  /** The chat is pinned to this computer: wait for it instead of moving on. */
  pinned: boolean;
  /** What the computer is called, for the engine's note ("Dana's MacBook"). */
  from: string;
  /** Open the session that goes on, next in the order without this computer: the person's own server, else the Space's own engine; with its name for the line ("the MLA server"). */
  openServer(): Promise<{ session: EngineSession; name: string }>;
  /** Open a session on the same computer again (it came back). */
  reopenDevice(): Promise<EngineSession>;
  /** Pinned: wait until the computer is back or the person says "run it on the server instead". Resolves "cancelled" when `signal` aborts (Stop). */
  waitFor(signal: AbortSignal): Promise<"device" | "server" | "cancelled">;
  /** A line in the chat (a turn_status note). */
  note(text: string): void;
  /** Where the turn went on, for its record ("server" or "device"). */
  moved(to: "server" | "device"): void;
  /** The live line while the turn waits: "call" when it starts waiting, "result" when it stops (bridge StreamEvent step, name DEVICE_WAIT_STEP). */
  live?(phase: "call" | "result"): void;
  /** For tests: the beat interval. */
  beatMs?: number;
}

/** The turn's input for the engine that goes on: the same turn, plus what was already said and done, so it continues instead of starting over. */
export function continued(input: TurnInput, from: string, said: string, steps: readonly string[]): TurnInput {
  return { ...input, handover: { from, said, steps: [...steps] } };
}

/**
 * The session of a turn on the person's computer, which goes on elsewhere (or waits) when the computer goes away. Everything else (steering, tool results, cancel) goes to whichever session is
 * current.
 */
export function handoverSession(first: EngineSession, d: HandoverDeps): EngineSession {
  let cur = first;
  let onDevice = true;
  const stop = new AbortController();
  let closed = false;
  const send = (input: TurnInput): AsyncIterable<DriverEvent> => (async function* () {
    let said = "";
    const steps: string[] = [];
    let now: TurnInput = input;
    for (;;) {
      let lost = false;
      try {
        for await (const ev of cur.send(now)) {
          // the engine ended because the computer went away: not the turn's failure, a move
          if (ev.type === "error" && onDevice && !d.linkUp() && !stop.signal.aborted) { lost = true; break; }
          if (ev.type === "text") said += ev.text;
          else if (ev.type === "block" && ev.kind === "tool_call") {
            const p = (ev.payload ?? {}) as { name?: unknown };
            if (typeof p.name === "string" && p.name !== "") steps.push(p.name);
          }
          yield ev;
        }
      } catch (e) {
        if (!(onDevice && !d.linkUp() && !stop.signal.aborted)) throw e;
        lost = true;
      }
      if (!lost) return;
      const gone = cur;
      void gone.close().catch(() => undefined);
      let to: "server" | "device";
      if (!d.pinned) to = "server";
      else {
        d.note(SLEPT_WAIT_LINE);
        d.live?.("call");
        const waiting = d.waitFor(stop.signal);
        // the engine's quiet-session check: an empty usage reading is the turn saying it is still there, and adds nothing to what it used
        let answer: "device" | "server" | "cancelled" | undefined;
        void waiting.then((a) => { answer = a; });
        while (answer === undefined) {
          const beat = new Promise<void>((r) => { const t = setTimeout(r, d.beatMs ?? BEAT_MS); t.unref?.(); void waiting.then(() => { clearTimeout(t); r(); }); });
          await beat;
          if (answer === undefined) yield { type: "usage", inputTokens: 0, outputTokens: 0 };
        }
        d.live?.("result");
        if (answer === "cancelled") return;
        to = answer;
      }
      if (to === "server") { const next = await d.openServer(); cur = next.session; d.note(sleptLine(next.name)); }
      else cur = await d.reopenDevice();
      onDevice = to === "device";
      d.moved(to);
      if (closed || stop.signal.aborted) { await cur.cancel().catch(() => undefined); return; }
      now = continued(input, d.from, said, steps);
    }
  })();
  return {
    send,
    sendToolResult: (callId: string, result: ToolResult) => cur.sendToolResult(callId, result),
    inject: (msg: StoredMessage) => cur.inject(msg),
    async cancel() { stop.abort(); await cur.cancel(); },
    async close() { closed = true; stop.abort(); await cur.close(); },
    get warm() { return cur.warm; },
    get model() { return (cur as { model?: string }).model; },
    ...(first.providerLatencyMs !== undefined ? { providerLatencyMs: first.providerLatencyMs } : {}),
  };
}
