// Test kit for the API drivers: recorded streams (fixtures/), a fetch that replays them chunk by chunk, a gate that holds a stream open so a test can prove deltas leave before the
// response ends, and builders for session specs and turn inputs. No network, no key: auth headers come from a fake authorizer.
import { readFileSync } from "node:fs";
import type { EngineAgent, SessionSpec, StoredMessage, TurnInput } from "../../turn-engine/types.ts";
import type { SessionContext } from "./session.ts";
import type { AccountRef, Authorizer, Clock, Fetch, FetchResponse, ProviderId } from "./types.ts";

export function fixture(name: string, opts: { crlf?: boolean } = {}): string {
  const text = readFileSync(new URL(`./fixtures/${name}.sse`, import.meta.url), "utf8");
  return opts.crlf ? text.replace(/\n/g, "\r\n") : text;
}

/** Split text into byte chunks of `size`; the cut may fall inside a multi-byte character, as it does on a real connection. */
export function chunked(text: string, size: number): Uint8Array[] {
  const all = new TextEncoder().encode(text);
  const out: Uint8Array[] = [];
  for (let i = 0; i < all.length; i += size) out.push(all.slice(i, i + size));
  return out;
}

export interface Script {
  status?: number;
  headers?: Record<string, string>;
  /** Chunks of the response body, delivered one at a time. */
  chunks?: readonly Uint8Array[];
  /** Whole body as text for non-stream answers (errors, model lists). */
  text?: string;
  /** Wait this long before the response starts: the provider's own latency. */
  latencyMs?: number;
  /** Wait between chunks. */
  gapMs?: number;
  /** An async body the test controls (see gate). */
  body?: AsyncIterable<Uint8Array>;
  /** The connection itself fails. */
  throws?: string;
}

export interface Recorded { url: string; method: string; headers: Record<string, string>; body: any; signal: AbortSignal; at: number }

const abortError = (): Error => Object.assign(new Error("aborted"), { name: "AbortError" });

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const t = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = (): void => { clearTimeout(t); reject(abortError()); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export interface FakeFetch { fetch: Fetch; requests: Recorded[] }

/** `handler` is called with the n-th request (from 0) and returns the scripted answer. */
export function fakeFetch(handler: (req: Recorded, n: number) => Script | Promise<Script>): FakeFetch {
  const requests: Recorded[] = [];
  const f: Fetch = async (url, init) => {
    const body = init.body === undefined ? undefined : (JSON.parse(init.body) as unknown);
    const rec: Recorded = { url, method: init.method, headers: init.headers, body, signal: init.signal, at: performance.now() };
    const n = requests.length;
    requests.push(rec);
    const s = await handler(rec, n);
    if (s.latencyMs) await sleepAbortable(s.latencyMs, init.signal);
    if (s.throws) throw new Error(s.throws);
    const status = s.status ?? 200;
    const headers = Object.fromEntries(Object.entries(s.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const chunks = s.chunks ?? [];
    async function* stream(): AsyncGenerator<Uint8Array> {
      for (const c of chunks) {
        if (init.signal.aborted) throw abortError();
        yield c;
        if (s.gapMs) await sleepAbortable(s.gapMs, init.signal);
      }
    }
    const iterable: AsyncIterable<Uint8Array> | null = s.body
      ? abortable(s.body, init.signal)
      : s.chunks ? stream() : null;
    const res: FetchResponse = {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      body: iterable,
      text: async () => s.text ?? (chunks.length ? new TextDecoder().decode(concat(chunks)) : ""),
      json: async () => JSON.parse(s.text ?? "null") as unknown,
    };
    return res;
  };
  return { fetch: f, requests };
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const n = chunks.reduce((a, c) => a + c.byteLength, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

function abortable(src: AsyncIterable<Uint8Array>, signal: AbortSignal): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]() {
      const it = src[Symbol.asyncIterator]();
      return {
        next: () => new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
          if (signal.aborted) { reject(abortError()); return; }
          const onAbort = (): void => reject(abortError());
          signal.addEventListener("abort", onAbort, { once: true });
          it.next().then((r) => { signal.removeEventListener("abort", onAbort); resolve(r); }, (e: unknown) => { signal.removeEventListener("abort", onAbort); reject(e); });
        }),
        return: async () => ({ done: true as const, value: undefined }),
      };
    },
  };
}

/** A response body the test feeds by hand. */
export interface Gate { body: AsyncIterable<Uint8Array>; push(bytes: Uint8Array | string): void; end(): void; fail(message: string): void }

export function gate(): Gate {
  const queue: Array<Uint8Array | null | Error> = [];
  let waiter: (() => void) | null = null;
  const enc = new TextEncoder();
  const put = (v: Uint8Array | null | Error): void => { queue.push(v); const w = waiter; waiter = null; w?.(); };
  async function* body(): AsyncGenerator<Uint8Array> {
    for (;;) {
      while (queue.length === 0) await new Promise<void>((r) => { waiter = r; });
      const v = queue.shift();
      if (v === null || v === undefined) return;
      if (v instanceof Error) throw v;
      yield v;
    }
  }
  return {
    body: body(),
    push: (b) => put(typeof b === "string" ? enc.encode(b) : b),
    end: () => put(null),
    fail: (m) => put(new Error(m)),
  };
}

export const KEY = "sk-test-0123456789abcdef";

/** The fake Vault filler: the header each provider takes, the account ref as the key's handle. */
export const authorize: Authorizer = async (_acct: AccountRef, provider: ProviderId) => {
  if (provider === "anthropic") return { "x-api-key": KEY };
  if (provider === "google") return { "x-goog-api-key": KEY };
  return { authorization: `Bearer ${KEY}` };
};

/** A clock that never waits: retries run at once and the waits are recorded. */
export function fakeClock(): Clock & { sleeps: number[] } {
  const sleeps: number[] = [];
  let t = 1_000_000;
  return { sleeps, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } };
}

export const ctx = (over: Partial<SessionContext> = {}): SessionContext => ({
  system: [
    { text: "You are Intake, an agent in this Space.", stable: true },
    { text: "Today is Saturday.", stable: false },
    { text: "VYRE.md: the guide.", stable: true },
  ],
  tools: [
    { name: "records_list", description: "List records of a type.", inputSchema: { type: "object", properties: { type: { type: "string" }, limit: { type: "number" } }, required: ["type"], additionalProperties: false } },
    { name: "chat_post", description: "Post a message.", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
  ],
  ...over,
});

export const agent = (model: string, extra: Partial<EngineAgent> = {}): EngineAgent => ({ id: "intake", mode: "lead", model, accountRef: "#Team_Key", ...extra });
export const spec = (model: string, extra: Partial<EngineAgent> = {}): SessionSpec => ({ threadId: "T1", agent: agent(model, extra), asker: "dana" });

export const msg = (seq: number, from: string, body: string, kind: "person" | "agent" = "person"): StoredMessage => ({
  id: `m${seq}`, threadId: "T1", threadSeq: seq, author: { kind, id: from }, mentions: [], depth: 0, body,
});

export function turnInput(model: string, history: StoredMessage[] = [msg(1, "dana", "Who are my newest leads?")], over: Partial<TurnInput> = {}): TurnInput {
  const trigger = history[history.length - 1] ?? null;
  return { threadId: "T1", turnId: "turn1", agent: agent(model), trigger, history: history.slice(0, -1), listeners: [], asker: "dana", ...over };
}

export const MODELS: Readonly<Record<ProviderId, string>> = Object.freeze({
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-5",
  openrouter: "anthropic/claude-sonnet-5-5",
  google: "gemini-2.5-pro",
  xai: "grok-4",
});

/** Fixture names by provider: openrouter and xai speak the OpenAI wire. */
export const WIRE: Readonly<Record<ProviderId, "anthropic" | "openai" | "google">> = Object.freeze({
  anthropic: "anthropic", openai: "openai", openrouter: "openai", google: "google", xai: "openai",
});
