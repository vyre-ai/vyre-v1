// One API engine session (ARCH 6.2, 6.6): our own tool loop over a provider's streaming API.
//
//   send       builds the prompt from the thread, streams one provider call, yields each delta the moment it is decoded, and when the model asks for tools yields the call, waits for
//              sendToolResult, and calls again; a message injected meanwhile (steering) joins the next call
//   retries    429 with a short Retry-After, 5xx and network errors before the first byte, with backoff; after the first byte an error is surfaced, never replayed
//   cancel     aborts the request in flight and releases any wait for a tool result; the generator ends without an error event
//   caching    the stable system blocks and the sorted tool list are hashed and marked (prefix.ts); each call notes whether the prefix matched the one before
import { windowFor } from "../../transcript/windows.ts";
import type { DriverEvent, EngineSession, SessionSpec, StoredMessage, ToolResult, TurnInput } from "../../turn-engine/types.ts";
import { classify, retryAfterMs, scrub } from "./errors.ts";
import { cap, compact, fixedTokens, threadMessages } from "./messages.ts";
import type { Summarize } from "./messages.ts";
import { createPrefixTracker, orderSystem, prefixHash } from "./prefix.ts";
import type { PrefixStats } from "./prefix.ts";
import { parseSse } from "./sse.ts";
import type {
  AccountRef, ApiTool, Authorizer, CallRequest, Clock, Decoded, Fetch, FetchResponse, Msg, ProviderAdapter, SystemBlock, ToolCall, Usage,
} from "./types.ts";

export interface SessionContext {
  system: SystemBlock[];
  tools: ApiTool[];
  maxOutputTokens?: number;
}

export interface RetryPolicy {
  /** Retries after the first attempt. */
  max: number;
  baseMs: number;
  capMs: number;
  /** A 429 is retried only when the provider says to wait no longer than this; a longer wait is the backup key's job. */
  rateLimitWaitMs: number;
}
export const RETRY_DEFAULTS: RetryPolicy = Object.freeze({ max: 2, baseMs: 250, capMs: 4_000, rateLimitWaitMs: 2_000 });

export interface SessionDeps {
  adapter: ProviderAdapter;
  account: AccountRef;
  base: string;
  fetch: Fetch;
  authorize: Authorizer;
  clock: Clock;
  context(spec: SessionSpec, input: TurnInput): SessionContext | Promise<SessionContext>;
  summarize?: Summarize;
  retry?: Partial<RetryPolicy>;
  /** No bytes for this long ends the call. Default 60 s. */
  idleMs?: number;
  /** Provider calls in one send. Default 40. */
  maxSteps?: number;
  random?: () => number;
}

export interface SessionStats {
  calls: number;
  retries: number;
  compactions: number;
  prefix: PrefixStats;
}

export interface ApiSession extends EngineSession {
  stats(): SessionStats;
}

const IDLE_MS = 60_000;
const MAX_STEPS = 40;

const zero = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

/** Wait for the next value but give up when nothing arrives for `ms`. */
async function nextWithin<T>(it: AsyncIterator<T>, ms: number, onIdle: () => void): Promise<IteratorResult<T> | "idle"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<"idle">((resolve) => { timer = setTimeout(() => { onIdle(); resolve("idle"); }, ms); });
  try { return await Promise.race([it.next(), idle]); } finally { if (timer !== undefined) clearTimeout(timer); }
}

export function createApiSession(deps: SessionDeps, spec: SessionSpec): ApiSession {
  const policy: RetryPolicy = { ...RETRY_DEFAULTS, ...deps.retry };
  const rnd = deps.random ?? Math.random;
  const tracker = createPrefixTracker();
  const model = deps.adapter.modelName(spec.agent.model ?? "");
  let calls = 0;
  let retries = 0;
  let compactions = 0;
  let sends = 0;
  let closed = false;
  let abort: AbortController | null = null;
  const injected: StoredMessage[] = [];
  const results = new Map<string, ToolResult>();
  let wake: (() => void) | null = null;

  const poke = (): void => { const w = wake; wake = null; w?.(); };

  /** One provider call. Yields decoded events as they arrive; the last one is `stop`, `error`, or the end of the stream. */
  async function* call(req: CallRequest, signal: AbortSignal): AsyncGenerator<Decoded> {
    const wire = deps.adapter.request(req);
    const url = `${deps.base.replace(/\/+$/, "")}${wire.path}`;
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) return;
      let auth: Record<string, string>;
      try { auth = await deps.authorize(deps.account, deps.adapter.id); }
      catch { yield { type: "error", status: 401, code: "provider.auth_failed", message: "No usable key for this account." }; return; }
      const secrets = Object.values(auth);
      const retryOrFail = async (status: number, text: string, res: FetchResponse | null, code?: string): Promise<boolean> => {
        const c = classify(status, text, code);
        const after = res ? retryAfterMs(res.headers.get("retry-after"), deps.clock.now()) : undefined;
        const okToWait = status === 429 ? after !== undefined && after <= policy.rateLimitWaitMs : true;
        if (c.retryable && attempt < policy.max && okToWait) {
          const backoff = Math.min(policy.capMs, policy.baseMs * 2 ** attempt) * (0.5 + rnd() / 2);
          retries += 1;
          await deps.clock.sleep(Math.max(after ?? 0, backoff), signal);
          return true;
        }
        return false;
      };
      // One controller per attempt: an idle stream is cut without cancelling the turn, so the retry still has a live signal.
      const att = new AbortController();
      const relay = (): void => att.abort();
      signal.addEventListener("abort", relay, { once: true });
      let res: FetchResponse;
      try {
        res = await deps.fetch(url, { method: "POST", headers: { ...wire.headers, ...auth }, body: JSON.stringify(wire.body), signal: att.signal });
      } catch (e) {
        signal.removeEventListener("abort", relay);
        if (signal.aborted) return;
        const message = scrub(e instanceof Error ? e.message : "network error", secrets);
        if (await retryOrFail(0, message, null)) continue;
        yield { type: "error", status: 0, code: "provider.unavailable", message: `The provider could not be reached: ${message}` };
        return;
      }
      if (!res.ok) {
        signal.removeEventListener("abort", relay);
        const text = scrub((await res.text().catch(() => "")).slice(0, 2_000), secrets);
        if (await retryOrFail(res.status, text, res)) continue;
        const c = classify(res.status, text);
        yield { type: "error", status: res.status, code: c.code, message: `The provider answered ${res.status}: ${text.slice(0, 200)}` };
        return;
      }
      if (!res.body) { signal.removeEventListener("abort", relay); yield { type: "error", status: 200, code: "provider.bad_response", message: "The provider sent no stream." }; return; }

      const dec = deps.adapter.decoder();
      const it = parseSse(res.body)[Symbol.asyncIterator]();
      let got = false;
      let failed: Decoded | null = null;
      try {
        for (;;) {
          const step = await nextWithin(it, deps.idleMs ?? IDLE_MS, () => att.abort());
          if (step === "idle") { failed = { type: "error", status: 0, code: "provider.unavailable", message: "The provider stopped answering." }; break; }
          if (step.done) break;
          for (const d of dec.push(step.value)) {
            if (d.type === "error") { failed = d; break; }
            // Usage and stop carry no content: a failure after only those can still be replayed. Content that left cannot.
            if (d.type === "text" || d.type === "thinking" || d.type === "tool_call") got = true;
            yield d;
          }
          if (failed) break;
        }
        if (!failed) for (const d of dec.end()) { if (d.type === "error") { failed = d; break; } if (d.type === "text" || d.type === "thinking" || d.type === "tool_call") got = true; yield d; }
      } catch (e) {
        if (signal.aborted && failed === null) return;
        failed = { type: "error", status: 0, code: "provider.unavailable", message: `The stream broke: ${scrub(e instanceof Error ? e.message : "read error", secrets)}` };
      } finally {
        signal.removeEventListener("abort", relay);
        // The request is released whether the stream ended, the consumer stopped reading (a call held at the Gate) or the turn was cancelled.
        att.abort();
        // Not awaited: a generator stuck on a read that never ends would hold the turn; the attempt controller has already cut the connection.
        void Promise.resolve(it.return?.()).catch(() => undefined);
      }
      if (failed === null) return;
      if (failed.type === "error" && !got && !signal.aborted) {
        const c = classify(failed.status, failed.message, failed.code);
        if (c.retryable && attempt < policy.max) {
          retries += 1;
          await deps.clock.sleep(Math.min(policy.capMs, policy.baseMs * 2 ** attempt) * (0.5 + rnd() / 2), signal);
          continue;
        }
      }
      if (failed.type === "error") {
        const c = classify(failed.status, failed.message, failed.code);
        yield { ...failed, code: failed.code?.startsWith("provider.") ? failed.code : c.code, message: scrub(failed.message, secrets) };
      }
      return;
    }
  }

  async function* send(input: TurnInput): AsyncGenerator<DriverEvent> {
    sends += 1;
    const ac = new AbortController();
    abort = ac;
    results.clear();
    try {
      const ctx = await deps.context(spec, input);
      const system = orderSystem(ctx.system);
      const hash = prefixHash(system, ctx.tools, model);
      const fixed = fixedTokens(system, ctx.tools);
      const window = windowFor(model, deps.adapter.id);
      let messages: Msg[] = threadMessages(input);
      const maxSteps = deps.maxSteps ?? MAX_STEPS;
      for (let step = 0; step < maxSteps; step++) {
        if (ac.signal.aborted || closed) return;
        const c = await compact(fixed, messages, window, deps.summarize);
        if (c.dropped > 0) { compactions += 1; messages = c.messages; }
        const req: CallRequest = { model, system, tools: ctx.tools, messages, maxOutputTokens: ctx.maxOutputTokens ?? deps.adapter.defaultMaxOutput, prefixHash: hash };
        tracker.note(hash);
        calls += 1;
        let text = "";
        const pending: ToolCall[] = [];
        const u = zero();
        let stop: Extract<Decoded, { type: "stop" }>["reason"] = "end";
        for await (const d of call(req, ac.signal)) {
          if (d.type === "text") { text += d.text; yield { type: "text", text: d.text }; }
          else if (d.type === "thinking") yield { type: "thinking", text: d.text };
          else if (d.type === "tool_call") { pending.push(d.call); yield { type: "tool_call", id: d.call.id, name: d.call.name, input: d.call.input }; }
          else if (d.type === "usage") Object.assign(u, d.usage);
          else if (d.type === "stop") stop = d.reason;
          else { yield { type: "error", code: d.code ?? "provider.error", message: d.message }; return; }
        }
        if (ac.signal.aborted) return;
        const inTokens = deps.adapter.inputIncludesCache ? u.inputTokens : u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
        tracker.settle(u.cacheReadTokens, u.cacheWriteTokens);
        if (inTokens > 0 || u.outputTokens > 0) yield { type: "usage", inputTokens: inTokens, outputTokens: u.outputTokens };
        if (stop === "filtered" && text === "" && pending.length === 0) { yield { type: "error", code: "provider.filtered", message: "The provider declined to answer." }; return; }

        if (pending.length > 0) {
          messages.push({ role: "assistant", text, calls: pending });
          for (const p of pending) {
            const r = await waitFor(p.id, ac.signal);
            if (r === null) return;
            messages.push({ role: "tool", callId: p.id, name: p.name, ok: r.ok, content: cap(typeof r.content === "string" ? r.content : JSON.stringify(r.content ?? null)) });
          }
        } else if (text !== "") {
          messages.push({ role: "assistant", text, calls: [] });
        }
        // Steering: a message that arrived during the step is read before the next call. At the end of a reply it earns another reply.
        const steer = injected.splice(0, injected.length);
        for (const m of steer) messages.push({ role: "user", text: m.author.kind === "agent" || m.author.id !== input.asker ? `${m.author.id}: ${m.body}` : m.body });
        if (pending.length === 0 && steer.length === 0) { yield { type: "done" }; return; }
      }
      yield { type: "error", code: "engine.step_limit", message: `The agent made ${maxSteps} model calls in one turn and was stopped.` };
    } finally {
      if (abort === ac) abort = null;
      ac.abort();
    }
  }

  /** The result for a call this send yielded. Null when the send was cancelled while waiting. */
  async function waitFor(id: string, signal: AbortSignal): Promise<ToolResult | null> {
    for (;;) {
      const r = results.get(id);
      if (r) { results.delete(id); return r; }
      if (signal.aborted || closed) return null;
      await new Promise<void>((resolve) => { wake = resolve; signal.addEventListener("abort", () => resolve(), { once: true }); });
    }
  }

  return {
    get warm() { return sends > 0; },
    send: (input) => send(input),
    sendToolResult(callId, result) { results.set(callId, result); poke(); },
    inject(msg) { injected.push(msg); },
    async cancel() { abort?.abort(); poke(); },
    async close() { closed = true; abort?.abort(); poke(); },
    stats: () => ({ calls, retries, compactions, prefix: tracker.stats() }),
  };
}
