// In-process session for tests and the fake path. Real drivers use the same TurnSession methods.
// A tool_call pauses the stream until sendToolResult, which is the step boundary where steering is injected.
// Each round (the first send, and each round after a tool result) counts as one provider call.
// Injected user messages are appended to the next round's input, which is the next model call.

import type { DriverEvent, ToolResult, TurnInput, TurnMessage, TurnSession, UserMessage } from "./session.ts";

export interface ScriptedOptions {
  events: readonly DriverEvent[] | ((input: TurnInput, round: number) => readonly DriverEvent[]);
  latencyMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onSend?: (input: TurnInput, round: number) => void;
  onInject?: (msg: UserMessage) => void;
  onCancel?: () => void;
  driverId?: string;
}

export interface ScriptedSession extends TurnSession {
  readonly calls: number;
  readonly cancels: number;
  readonly injected: readonly UserMessage[];
}

export function scriptedSession(opts: ScriptedOptions): ScriptedSession {
  return new Scripted(opts);
}

class Scripted implements ScriptedSession {
  readonly driverId: string;
  readonly latencyMs: number;
  calls = 0;
  cancels = 0;
  readonly injected: UserMessage[] = [];
  private readonly opts: ScriptedOptions;
  private readonly pending: UserMessage[] = [];
  private readonly ready = new Set<string>();
  private readonly waiters = new Map<string, () => void>();
  private cancelled = false;

  constructor(opts: ScriptedOptions) {
    this.opts = opts;
    this.driverId = opts.driverId ?? "fake";
    this.latencyMs = opts.latencyMs ?? 0;
  }

  async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
    const source = this.opts.events;
    let cursor = 0;
    let round = 0;
    while (!this.cancelled) {
      const injectedNow = this.pending.splice(0, this.pending.length);
      const roundInput = withInjected(input, injectedNow);
      this.calls += 1;
      this.opts.onSend?.(roundInput, round);
      if (this.latencyMs > 0) await this.sleep(this.latencyMs);
      const batch = typeof source === "function" ? source(roundInput, round) : source.slice(cursor);
      let paused = false;
      for (const ev of batch) {
        if (this.cancelled) return;
        yield ev;
        if (typeof source !== "function") cursor += 1;
        if (ev.type === "tool_call") {
          paused = true;
          await this.waitFor(ev.id);
          if (this.cancelled) return;
          round += 1;
          break;
        }
        if (ev.type === "done" || ev.type === "error") return;
      }
      if (!paused) return;
    }
  }

  sendToolResult(callId: string, _result: ToolResult): void {
    this.ready.add(callId);
    this.wake(callId);
  }

  inject(msg: UserMessage): void {
    this.pending.push(msg);
    this.injected.push(msg);
    this.opts.onInject?.(msg);
  }

  async cancel(): Promise<void> {
    this.cancels += 1;
    this.cancelled = true;
    this.opts.onCancel?.();
    for (const [id, wake] of this.waiters) {
      this.waiters.delete(id);
      wake();
    }
  }

  private waitFor(id: string): Promise<void> {
    if (this.cancelled || this.ready.has(id)) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.set(id, resolve);
    });
  }

  private wake(id: string): void {
    const wake = this.waiters.get(id);
    if (!wake) return;
    this.waiters.delete(id);
    wake();
  }

  private sleep(ms: number): Promise<void> {
    if (this.opts.sleep) return this.opts.sleep(ms);
    const end = Date.now() + ms;
    return new Promise((resolve) => {
      const step = (): void => {
        const left = end - Date.now();
        if (left <= 0) {
          resolve();
          return;
        }
        setTimeout(step, left);
      };
      step();
    });
  }
}

function withInjected(input: TurnInput, injected: readonly UserMessage[]): TurnInput {
  if (injected.length === 0) return input;
  const extra: TurnMessage[] = injected.map((msg) => ({ role: "user", content: msg.content }));
  return { agentId: input.agentId, model: input.model, tools: input.tools, messages: [...input.messages, ...extra] };
}
