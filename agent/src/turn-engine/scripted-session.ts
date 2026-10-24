// A scripted engine session for the fake-provider path (ARCH 10.1): the engine is built and tested against this before any real driver plugs in via driver.ts.
// Latency is injected before the first event, which is what the send budget subtracts. `beforeEvent` lets a test hold a turn between steps.
import type { DriverEvent, EngineSession, OpenSession, SessionSpec, StoredMessage, ToolResult, TurnInput } from "./types.ts";

export interface ScriptedOptions {
  script: readonly DriverEvent[] | ((input: TurnInput, spec: SessionSpec) => readonly DriverEvent[]);
  /** Provider latency before the first event. */
  latencyMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called before event `index` is yielded; a test returns a pending promise to hold the turn at that step. */
  beforeEvent?: (index: number, ev: DriverEvent, spec: SessionSpec) => Promise<void> | void;
}

export interface ScriptedSession extends EngineSession {
  readonly spec: SessionSpec;
  readonly inputs: TurnInput[];
  readonly injected: StoredMessage[];
  readonly toolResults: Array<{ id: string; result: ToolResult }>;
  readonly cancelled: boolean;
  readonly closed: boolean;
}

export interface ScriptedProvider {
  openSession: OpenSession;
  /** Every session opened. */
  sessions: ScriptedSession[];
  /** Total send() calls across sessions: the number of provider calls made. */
  sends(): number;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function scriptedProvider(opts: ScriptedOptions): ScriptedProvider {
  const sessions: ScriptedSession[] = [];
  let sendCount = 0;
  const openSession: OpenSession = async (spec) => {
    const sleep = opts.sleep ?? realSleep;
    const inputs: TurnInput[] = [];
    const injected: StoredMessage[] = [];
    const toolResults: Array<{ id: string; result: ToolResult }> = [];
    let cancelled = false;
    let closed = false;
    let wake: () => void = () => {};
    const cancelSignal = new Promise<void>((resolve) => { wake = resolve; });

    const session: ScriptedSession = {
      spec, inputs, injected, toolResults, warm: false,
      get cancelled() { return cancelled; },
      get closed() { return closed; },
      ...(opts.latencyMs === undefined ? {} : { providerLatencyMs: opts.latencyMs }),
      async *send(input) {
        sendCount += 1;
        inputs.push(input);
        if (opts.latencyMs && opts.latencyMs > 0) await Promise.race([sleep(opts.latencyMs), cancelSignal]);
        const events = typeof opts.script === "function" ? opts.script(input, spec) : opts.script;
        for (let i = 0; i < events.length; i++) {
          if (cancelled) return;
          const ev = events[i];
          if (!ev) continue;
          if (opts.beforeEvent) await Promise.race([Promise.resolve(opts.beforeEvent(i, ev, spec)), cancelSignal]);
          if (cancelled) return;
          yield ev;
        }
      },
      sendToolResult(id, result) { toolResults.push({ id, result }); },
      inject(msg) { injected.push(msg); },
      async cancel() { cancelled = true; wake(); },
      async close() { closed = true; },
    };
    sessions.push(session);
    return session;
  };
  return { openSession, sessions, sends: () => sendCount };
}
