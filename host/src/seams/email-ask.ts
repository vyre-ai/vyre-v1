// The email builder's Ask Vyre driver (rulings 31 and 32): the module exports `hostSeams = { configureEmailBuilder }` and the daemon hands it this driver. An Ask is one real agent turn in a private
// Ask pane about the email design, so it takes the production inference path: the asker's own agent, model and account (engine.account.resolve), their spend limits and their access, since every
// call here runs as the asker. The agent is asked to answer with the changed fields of the design as JSON; the module holds that answer to the same rules as a save and returns a per-change diff.
// The driver never writes the design. It can be cancelled (AbortSignal), times out, and says why a turn failed in the words of the error the engine recorded.

type Json = Record<string, unknown>;

/** Who a call runs as: exactly the principal that asked (never rewritten to a person) and, for an agent, the person it acts for. */
export interface AskWho { principal: { kind: "person" | "agent" | "service"; id: string }; actingFor?: string | undefined }

/** Run one capability as the asker; the daemon builds it over the invoke pipeline. */
export type AskCall = (cap: string, input: unknown, as: AskWho) => Promise<unknown>;

export interface EmailAskRequest { instruction: string; agentId: string | null; doc: Json; principal: AskWho["principal"]; actingFor?: string | undefined; signal?: AbortSignal | undefined }

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

/** The person a turn is for: the person who asked, or the person an agent acts for. Anyone else has no account to pay with, so an Ask refuses. */
export function personOf(r: { principal: AskWho["principal"]; actingFor?: string | undefined }): string {
  return r.actingFor ?? (r.principal.kind === "person" ? r.principal.id : "");
}

/** What differs between the things an agent can be asked about: the Ask pane's scope, its title, which id names the subject, and what the agent is told. */
export interface AskSpec { scope: string; title: string; idOf(doc: Json): string; prompt(instruction: string, doc: Json): string }

/** The Ask driver for any subject: one agent turn in a private Ask pane, as the asker, answering with changed fields as JSON. */
export function createAskDriver(d: EmailAskDeps, spec: AskSpec): { propose(req: EmailAskRequest): Promise<Json>; cancel(asker: string, subjectId: string): number } {
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = d.timeoutMs ?? 120_000, pollMs = d.pollMs ?? 250;

  async function pickAgent(req: EmailAskRequest, who: AskWho): Promise<string> {
    if (req.agentId) return req.agentId;
    try {
      const s = (await d.call("chat.ask_suggest", { scopeType: spec.scope, scopeId: spec.idOf(req.doc) }, who)) as { agentId?: string | null };
      if (s.agentId) return s.agentId;
    } catch { /* no suggestion: take the first awake agent the person can use */ }
    const list = (await d.call("agents.list", {}, who)) as { agents?: { agentId: string; status?: string }[] };
    const agent = (list.agents ?? []).find((a) => a.status === undefined || a.status === "awake");
    if (!agent) throw new AskDriverError("validation.precondition_failed", NO_AGENT);
    return agent.agentId;
  }

  async function stop(threadId: string, agentId: string, asker: AskWho): Promise<void> {
    try { await d.call("engine.stop", { threadId, agentId }, asker); } catch (e) { d.log?.("email ask: could not stop the turn", { threadId, error: errorOf(e).message }); }
  }

  // the Asks in flight, by asker and design, so the person's Cancel reaches the turn that is running for them and nobody else's
  const running = new Map<string, Set<AbortController>>();

  return {
    /** Stops the Asks this person has running on this design. Returns how many were asked to stop. */
    cancel(asker, subjectId) {
      const set = running.get(`${asker}:${subjectId}`);
      for (const c of set ?? []) c.abort();
      return set?.size ?? 0;
    },
    async propose(req0) {
      const own = new AbortController(), key0 = `${personOf(req0)}:${spec.idOf(req0.doc)}`;
      req0.signal?.addEventListener("abort", () => own.abort(), { once: true });
      if (req0.signal?.aborted) own.abort();
      const req = { ...req0, signal: own.signal };
      const who: AskWho = { principal: req0.principal, ...(req0.actingFor ? { actingFor: req0.actingFor } : {}) };
      const person = personOf(req0);
      let set = running.get(key0);
      if (!set) running.set(key0, (set = new Set()));
      set.add(own);
      try {
        if (person === "") throw new AskDriverError("permission.no_grant", "An Ask runs for a person and on their account. This caller is not acting for anyone.");
        const agentId = await pickAgent(req, who);
        // the first engine call builds the runtime; a message written before it exists is never handed to an engine
        await d.call("engine.pool.status", {}, who);
        const key = `${spec.scope}-ask-${spec.idOf(req.doc)}-${now()}-${Math.random().toString(36).slice(2, 8)}`;
        const started = (await d.call("chat.start", { kind: "ask", agentIds: [agentId], scopeType: spec.scope, scopeId: spec.idOf(req.doc), title: spec.title, idempotencyKey: key }, who)) as { thread: { threadId: string } };
        const threadId = started.thread.threadId;
        // an Ask with nobody to pay for it fails here, in words, instead of waiting for a turn that never starts
        const resolved = (await d.call("engine.account.resolve", { threadId, agentId, askerId: person }, who)) as { allowed?: boolean; accountRef?: string | null };
        if (!resolved.allowed || !resolved.accountRef) throw new AskDriverError("validation.precondition_failed", NO_MODEL);
        const posted = (await d.call("chat.post", { threadId, body: spec.prompt(req.instruction, req.doc), mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `${key}-post` }, who)) as { message?: { messageId?: string; threadSeq?: number } };
        const after = posted.message?.threadSeq ?? 0;
        const deadline = now() + timeoutMs;
        // the engine ends a turn by speaking: the agent's reply is posted once, whole, when the turn completes, and a failed, stopped or parked turn posts a turn_status block instead
        for (;;) {
          if (req.signal?.aborted) { await stop(threadId, agentId, who); throw new AskDriverError("validation.precondition_failed", "The Ask was cancelled."); }
          const listed = (await d.call("chat.messages.list", { threadId, after }, who)) as { messages?: MessageRow[] };
          const fromAgent = (listed.messages ?? []).filter((m) => m.author?.kind === "agent");
          const status = fromAgent.flatMap((m) => m.blocks ?? []).find((b) => b.type === "turn_status")?.data as { state?: string; code?: string } | undefined;
          if (status?.state === "failed") throw new AskDriverError(status.code && status.code.includes(".") ? status.code : "internal.unexpected", FAILED[status.code ?? ""] ?? "The agent could not finish. Try again.");
          if (status?.state === "cancelled") throw new AskDriverError("validation.precondition_failed", "The agent was stopped before it answered.");
          if (status?.state === "waiting") { await stop(threadId, agentId, who); throw new AskDriverError("validation.precondition_failed", "The agent needs an approval to go on, which an Ask cannot ask for. Say what to change in a chat with the agent instead."); }
          const answer = fromAgent.filter((m) => typeof m.body === "string" && m.body.trim() !== "").pop();
          if (answer?.body) return parseProposal(answer.body);
          if (now() > deadline) { d.log?.("email ask: the agent did not answer in time", { threadId }); await stop(threadId, agentId, who); throw new AskDriverError("provider.network", "The agent did not answer in time. Try again."); }
          await sleep(pollMs);
        }
      } catch (e) { throw errorOf(e); }
      finally { set.delete(own); if (set.size === 0) running.delete(key0); }
    },
  };
}

/** The email builder's Ask: the design goes in whole and the agent answers with the fields it changes. */
export const EMAIL_SPEC: AskSpec = { scope: "email", title: "Email design", idOf: (doc) => String(doc["emailId"]), prompt: askPrompt };
export function createEmailAskDriver(d: EmailAskDeps): { propose(req: EmailAskRequest): Promise<Json>; cancel(asker: string, emailId: string): number } { return createAskDriver(d, EMAIL_SPEC); }

/** What the agent is told about a form: the source it may change, and the questions it can place (placing is by name, the inputs themselves come from Build). */
export function formAskPrompt(instruction: string, doc: Json): string {
  return [
    "You are editing the source of one form for the person who asked. Do what the instruction says to this source and nothing else.",
    `Instruction: ${instruction}`,
    "Current source (JSON): html is a template, css is the style sheet, js is the script. questions are the questions the form asks.",
    JSON.stringify(doc),
    "HTML rules: use only headings, paragraphs, lists, links (https, mailto, tel or #), images (https), tables and div, section or span containers, with double-quoted attributes. Put <vyre-field name=\"KEY\"></vyre-field> where the question with that key should appear, once each; never write inputs, forms, scripts, styles, ids or comments. Questions you do not place still appear after your HTML.",
    "Answer with ONE JSON object and no other words: the source fields you change (html, css, js), each with its complete new text. Leave out every field you do not change. Do not wrap the answer in a code fence.",
  ].join("\n\n");
}
/** The forms builder's Ask: the same turn, about a form's source. */
export const FORM_SPEC: AskSpec = { scope: "form", title: "Form source", idOf: (doc) => String(doc["formId"]), prompt: formAskPrompt };
export function createFormAskDriver(d: EmailAskDeps): { propose(req: EmailAskRequest): Promise<Json>; cancel(asker: string, formId: string): number } { return createAskDriver(d, FORM_SPEC); }
