// The email builder's Ask Vyre driver (rulings 31 and 32): the module exports `hostSeams = { configureEmailBuilder }` and the daemon hands it this driver. An Ask is one real agent turn in a private
// Ask pane about the email design, so it takes the production inference path: the asker's own agent, model and account (engine.account.resolve), their spend limits and their access, since every
// call here runs as the asker. The agent is asked to answer with the changed fields of the design as JSON; the module holds that answer to the same rules as a save and returns a per-change diff.
// The driver never writes the design. It can be cancelled (AbortSignal), times out, and says why a turn failed in the words of the error the engine recorded.

type Json = Record<string, unknown>;

/** Run one capability as a person (the asker); the daemon builds it over the invoke pipeline. */
export type AskCall = (cap: string, input: unknown, as: string) => Promise<unknown>;

export interface EmailAskRequest { instruction: string; agentId: string | null; doc: { emailId: string } & Json; asker: string; signal?: AbortSignal | undefined }

/** An answer the driver could not turn into a proposal. `code` is an error code of the catalogue; the module raises it as it is. */
export class AskDriverError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "AskDriverError"; this.code = code; }
}

export interface EmailAskDeps {
  call: AskCall;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** How long one Ask may take before the turn is stopped. Default two minutes. */
  timeoutMs?: number;
  pollMs?: number;
  log?: (msg: string, attrs?: Record<string, unknown>) => void;
}

interface MessageRow { author?: { kind?: string; id?: string }; kind?: string; body?: string; threadSeq?: number; blocks?: { type: string; data?: unknown }[] }

/** What a failed turn means, by the code the engine recorded (the catalogue words, in the sentence the author reads). */
const FAILED: Readonly<Record<string, string>> = {
  "provider.auth_failed": "The provider rejected the key or sign-in for this agent. Open Settings and reconnect it.",
  "provider.rate_limited": "The provider is rate limiting this account. Wait a moment and try again.",
  "provider.overloaded": "The provider is overloaded. Try again in a moment.",
  "provider.network": "The provider could not be reached. Check the connection and try again.",
  "provider.unavailable": "The provider is down. Try again later or switch model.",
  "provider.context_too_long": "This design is longer than the model accepts. Try another model.",
  "provider.content_filtered": "The provider filtered this request. Say it another way.",
};

const NO_MODEL = "No model can answer for this agent yet. Open Settings, add a key or sign in, and let this Space use it.";
const NO_AGENT = "No agent is available to answer. Create an agent, then try again.";

/** What the agent is told. The design goes in whole so the answer can be a replacement of the fields it changes. */
export function askPrompt(instruction: string, doc: Json): string {
  return [
    "You are editing one email design for the person who asked. Do what the instruction says to this design and nothing else.",
    `Instruction: ${instruction}`,
    "Current design (JSON):",
    JSON.stringify(doc),
    "Answer with ONE JSON object and no other words: the fields of the design you change (subject, mode, blocks, html, plain), each with its complete new value. Leave out every field you do not change. Do not wrap the answer in a code fence.",
  ].join("\n\n");
}

/** The JSON object in an agent's answer: the whole text, a fenced block, or the outermost braces. */
export function parseProposal(text: string): Json {
  const tries: string[] = [text.trim()];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) tries.push(fence[1].trim());
  const open = text.indexOf("{"), close = text.lastIndexOf("}");
  if (open >= 0 && close > open) tries.push(text.slice(open, close + 1));
  for (const t of tries) {
    try { const v: unknown = JSON.parse(t); if (v && typeof v === "object" && !Array.isArray(v)) return v as Json; } catch { /* try the next reading */ }
  }
  throw new AskDriverError("provider.bad_response", "The agent answered, but not with a design change. Try again, or say more exactly what to change.");
}

function errorOf(e: unknown): AskDriverError {
  if (e instanceof AskDriverError) return e;
  const err = (e as { error?: { code?: string; message?: string } } | null)?.error;
  if (err?.code) return new AskDriverError(err.code, err.message ?? "The agent could not answer.");
  return new AskDriverError("internal.unexpected", e instanceof Error ? e.message : "The agent could not answer.");
}

export function createEmailAskDriver(d: EmailAskDeps): { propose(req: EmailAskRequest): Promise<Json>; cancel(asker: string, emailId: string): number } {
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = d.timeoutMs ?? 120_000, pollMs = d.pollMs ?? 250;

  async function pickAgent(req: EmailAskRequest): Promise<string> {
    if (req.agentId) return req.agentId;
    try {
      const s = (await d.call("chat.ask_suggest", { scopeType: "email", scopeId: req.doc.emailId }, req.asker)) as { agentId?: string | null };
      if (s.agentId) return s.agentId;
    } catch { /* no suggestion: take the first awake agent the person can use */ }
    const list = (await d.call("agents.list", {}, req.asker)) as { agents?: { agentId: string; status?: string }[] };
    const agent = (list.agents ?? []).find((a) => a.status === undefined || a.status === "awake");
    if (!agent) throw new AskDriverError("validation.precondition_failed", NO_AGENT);
    return agent.agentId;
  }

  async function stop(threadId: string, agentId: string, asker: string): Promise<void> {
    try { await d.call("engine.stop", { threadId, agentId }, asker); } catch (e) { d.log?.("email ask: could not stop the turn", { threadId, error: errorOf(e).message }); }
  }

  // the Asks in flight, by asker and design, so the person's Cancel reaches the turn that is running for them and nobody else's
  const running = new Map<string, Set<AbortController>>();

  return {
    /** Stops the Asks this person has running on this design. Returns how many were asked to stop. */
    cancel(asker, emailId) {
      const set = running.get(`${asker}:${emailId}`);
      for (const c of set ?? []) c.abort();
      return set?.size ?? 0;
    },
    async propose(req0) {
      const own = new AbortController(), key0 = `${req0.asker}:${req0.doc.emailId}`;
      req0.signal?.addEventListener("abort", () => own.abort(), { once: true });
      if (req0.signal?.aborted) own.abort();
      const req = { ...req0, signal: own.signal };
      let set = running.get(key0);
      if (!set) running.set(key0, (set = new Set()));
      set.add(own);
      try {
        const agentId = await pickAgent(req);
        // the first engine call builds the runtime; a message written before it exists is never handed to an engine
        await d.call("engine.pool.status", {}, req.asker);
        const key = `email-ask-${req.doc.emailId}-${now()}-${Math.random().toString(36).slice(2, 8)}`;
        const started = (await d.call("chat.start", { kind: "ask", agentIds: [agentId], scopeType: "email", scopeId: req.doc.emailId, title: "Email design", idempotencyKey: key }, req.asker)) as { thread: { threadId: string } };
        const threadId = started.thread.threadId;
        // an Ask with nobody to pay for it fails here, in words, instead of waiting for a turn that never starts
        const resolved = (await d.call("engine.account.resolve", { threadId, agentId, askerId: req.asker }, req.asker)) as { allowed?: boolean; accountRef?: string | null };
        if (!resolved.allowed || !resolved.accountRef) throw new AskDriverError("validation.precondition_failed", NO_MODEL);
        const posted = (await d.call("chat.post", { threadId, body: askPrompt(req.instruction, req.doc), mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `${key}-post` }, req.asker)) as { message?: { messageId?: string; threadSeq?: number } };
        const after = posted.message?.threadSeq ?? 0;
        const deadline = now() + timeoutMs;
        // the engine ends a turn by speaking: the agent's reply is posted once, whole, when the turn completes, and a failed, stopped or parked turn posts a turn_status block instead
        for (;;) {
          if (req.signal?.aborted) { await stop(threadId, agentId, req.asker); throw new AskDriverError("validation.precondition_failed", "The Ask was cancelled."); }
          const listed = (await d.call("chat.messages.list", { threadId, after }, req.asker)) as { messages?: MessageRow[] };
          const fromAgent = (listed.messages ?? []).filter((m) => m.author?.kind === "agent");
          const status = fromAgent.flatMap((m) => m.blocks ?? []).find((b) => b.type === "turn_status")?.data as { state?: string; code?: string } | undefined;
          if (status?.state === "failed") throw new AskDriverError(status.code && status.code.includes(".") ? status.code : "internal.unexpected", FAILED[status.code ?? ""] ?? "The agent could not finish. Try again.");
          if (status?.state === "cancelled") throw new AskDriverError("validation.precondition_failed", "The agent was stopped before it answered.");
          if (status?.state === "waiting") { await stop(threadId, agentId, req.asker); throw new AskDriverError("validation.precondition_failed", "The agent needs an approval to go on, which an Ask cannot ask for. Say what to change in a chat with the agent instead."); }
          const answer = fromAgent.filter((m) => typeof m.body === "string" && m.body.trim() !== "").pop();
          if (answer?.body) return parseProposal(answer.body);
          if (now() > deadline) { d.log?.("email ask: the agent did not answer in time", { threadId }); await stop(threadId, agentId, req.asker); throw new AskDriverError("provider.network", "The agent did not answer in time. Try again."); }
          await sleep(pollMs);
        }
      } catch (e) { throw errorOf(e); }
      finally { set.delete(own); if (set.size === 0) running.delete(key0); }
    },
  };
}
