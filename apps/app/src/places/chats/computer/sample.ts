// The sample computer behind the popup's tests and screenshots: Intake's computer in the Northwind Space, working, asleep or already in your control. A fake replica holds the
// computer; the writes the popup makes (wake, take over, give back, start and stop recording, process, delete) change it, so every control in a mount really works. The capture
// store stands in for the stream's counters: `capture.bump()` adds a click, a page and some network calls, as a recording would.
import { createFakeReplica, createScreenHooks } from "../../../../../../client/src/index.ts";
import type { FakeReplica } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import type { ComputerPopupData, Connection, PopupNav } from "./data.tsx";
import { NO_CAPTURE } from "./model.ts";
import type { Capture, Computer, Intent, Recording } from "./model.ts";

/** Friday 24 October 2025, 10:00 (UTC, so every machine prints the same times). */
export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);

export type Variant = "working" | "asleep" | "takeover";

export const COMPUTER = "cmp_intake";

export interface Sample {
  data: ComputerPopupData;
  replica: FakeReplica;
  /** every capability the popup called, in order */
  calls: { cap: string; input: unknown }[];
  /** how many times the popup was asked to close */
  closed: { n: number };
  capture: { bump(): void; set(c: Capture): void };
  setOnline(online: boolean): void;
  failNext(cap: string): void;
  /** the clock the popup reads, in ms; move it to let a recording run */
  clock: { now: number };
}

export function createSample(variant: Variant = "working", o: { online?: boolean } = {}): Sample {
  const replica = createFakeReplica("northwind");
  const calls: { cap: string; input: unknown }[] = [];
  const closed = { n: 0 };
  const failing = new Set<string>();
  const listeners = new Set<() => void>();
  const capListeners = new Set<() => void>();
  const clock = { now: SAMPLE_NOW };
  let online = o.online ?? true;
  let cap: Capture = { ...NO_CAPTURE };
  let seq = 0;
  let recording: Recording | null = null;

  const base: Computer = { computerId: COMPUTER, agentId: "agt_intake", state: variant === "asleep" ? "asleep" : variant === "takeover" ? "takeover" : "working", tabs: 3, tabLimit: 8, host: "server", recording: false, ...(variant === "working" ? { caption: "Filling the county records form" } : {}) };
  replica.put("computers", [{ id: COMPUTER, ...base }]);
  const cur = (): Computer & { id: string } => (replica.rows("computers") as unknown as (Computer & { id: string })[])[0]!;
  const patch = (p: Partial<Computer>): Computer => { const next = { ...cur(), ...p }; replica.put("computers", [next]); const { id: _id, ...rest } = next; return rest as Computer; };
  replica.resolve("computers.get", () => { const { id: _id, ...rest } = cur(); return { computer: rest as Computer }; });
  replica.resolve("computers.timeline", () => ({ steps: [], total: 0 }));

  const writes: Record<string, (input: any) => unknown> = {
    "computers.wake": () => ({ computer: patch({ state: "working", caption: "Waking up" }) }),
    "computers.take_over": () => ({ computer: patch({ state: "takeover" }), ticket: "tk_takeover" }),
    "computers.give_back": () => ({ computer: patch({ state: "working" }) }),
    "computers.stream": () => ({ transport: "mjpeg", url: "https://stream.example/intake", ticket: "tk_stream", expiresAt: SAMPLE_NOW + 60_000 }),
    "computers.record_start": () => { recording = { recordingId: `rec_${++seq}`, computerId: COMPUTER, agentId: "agt_intake", startedAt: clock.now, folderPath: "Agents/Intake/work/recordings/2025-10-24-1000", state: "recording", intents: [] }; patch({ recording: true }); return { recordingId: recording.recordingId }; },
    "computers.record_stop": () => {
      if (!recording) throw new Error("not recording");
      recording = { ...recording, endedAt: clock.now, durationMs: clock.now - recording.startedAt, state: "saved" };
      patch({ recording: false });
      return { recording };
    },
    "computers.recording.process": (i: { recordingId: string; intents: Intent[] }) => {
      if (recording) recording = { ...recording, state: "processed", intents: i.intents };
      return { taskId: `tsk_rec${++seq}`, runId: `run_rec${seq}` };
    },
    "computers.recording.delete": () => { recording = null; return { deleted: true }; },
    "computers.screen.click": () => ({ ok: true }),
    "computers.screen.type": () => ({ ok: true }),
    "computers.screen.key": () => ({ ok: true }),
  };
  const nav: PopupNav = { close: () => void (closed.n += 1) };
  const connection: Connection = { get: () => (online ? "online" : "offline"), subscribe: (l) => { listeners.add(l); return () => void listeners.delete(l); } };
  const emitCap = (): void => { for (const l of [...capListeners]) l(); };
  const data: ComputerPopupData = {
    screens: createScreenHooks(replica, screensById),
    async call(c, input) {
      calls.push({ cap: c, input });
      if (failing.delete(c)) throw new Error(`${c} failed`);
      const w = writes[c];
      if (!w) throw new Error(`no write for ${c}`);
      return w(input);
    },
    connection,
    computerId: COMPUTER,
    agent: { agentId: "agt_intake", name: "Intake" },
    capture: { get: () => cap, subscribe: (l) => { capListeners.add(l); return () => void capListeners.delete(l); } },
    nav,
    clock: () => ({ now: clock.now, offsetMin: 0 }),
  };
  return {
    data, replica, calls, closed, clock,
    capture: { bump() { cap = { clicks: cap.clicks + 1, pages: cap.pages + (cap.clicks % 3 === 2 ? 1 : 0), requests: cap.requests + 4 }; emitCap(); }, set(c) { cap = c; emitCap(); } },
    setOnline(v) { online = v; for (const l of [...listeners]) l(); },
    failNext(c) { failing.add(c); },
  };
}
