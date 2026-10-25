// What the client keeps for a report (spec 5 Report a problem): the trace ids of the last 20 actions, recent events and errors, and the
// local ring-buffer log. Each ring is bounded; a new entry past the cap drops the oldest. Nothing here holds values, only ids, types and messages.

export class Ring<T> {
  private items: T[] = [];
  constructor(readonly cap: number) {}
  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.cap) this.items.splice(0, this.items.length - this.cap);
  }
  /** Oldest first. A copy: a later push never changes a bundle already built. */
  list(): T[] { return this.items.slice(); }
  get size(): number { return this.items.length; }
  clear(): void { this.items = []; }
}

export interface CapturedEvent { type: string; at: number; traceId?: string }
export interface CapturedError { code: string; message: string; at: number; traceId?: string; /** The message holds a Restricted or sealed value: only its code leaves the device. */ restricted?: boolean }
export interface LogLine { at: number; level: "debug" | "info" | "warn" | "error"; text: string }

export const ACTION_CAP = 20;
export const EVENT_CAP = 50;
export const ERROR_CAP = 50;
export const LOG_CAP = 200;

export interface Snapshot {
  traceIds: string[];
  events: CapturedEvent[];
  errors: CapturedError[];
  log: LogLine[];
}

export class Captures {
  readonly actions = new Ring<string>(ACTION_CAP);
  readonly events = new Ring<CapturedEvent>(EVENT_CAP);
  readonly errors = new Ring<CapturedError>(ERROR_CAP);
  readonly log = new Ring<LogLine>(LOG_CAP);

  /** The action dispatcher calls this once per action, with the trace id created when the action was queued. A repeat of the newest id is not a second action. */
  noteAction(traceId: string): void {
    const all = this.actions.list();
    if (all[all.length - 1] === traceId) return;
    this.actions.push(traceId);
  }
  noteEvent(e: CapturedEvent): void { this.events.push(e); }
  noteError(e: CapturedError): void { this.errors.push(e); }
  writeLog(level: LogLine["level"], text: string, at: number = Date.now()): void { this.log.push({ at, level, text }); }

  snapshot(): Snapshot {
    return { traceIds: this.actions.list(), events: this.events.list(), errors: this.errors.list(), log: this.log.list() };
  }
}

/** The window's one set of rings. The shell wires the dispatcher, event stream and logger to it. */
export const captures = new Captures();
