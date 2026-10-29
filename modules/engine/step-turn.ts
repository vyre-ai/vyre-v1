// An automation's AI step turn (spec 2.12; ARCH 6.6). One turn through the same session opener a chat uses (the same drivers, the same Vault fill, the same account rules and the same meters),
// without a chat thread, a queue or a bridge:
//   who pays      a Personal automation runs as its owner and uses the owner's own account (a subscription sign-in first, then an API key). A Space automation runs as its own service and may use only
//                 a Space-shared key, the one named in the step (keyId) or its backup. With neither, the turn is refused and the message names what to add.
//   as an agent   agentId adds the agent's name, role line and the memory facts the asker may read to the prompt, and its model to the session. The agent's tools are not given: the turn has none.
//   no tools      the session is opened with tools "none": no Vyre tools, no MCP session, and for a CLI engine none of its own either. The turn answers in words and sends nothing.
//   the key       is a handle all the way: the opener fills it into the request at the last moment. Neither the prompt, the result nor the error holds it.
//   a repeat      of the same attempt key returns the stored answer and asks nothing again, so a retry, a reviewer's wait or a recovered Run never pays twice.
import { resolveAccount, providerOfModel } from "../../agent/src/accounts/index.ts";
import type { AccountRow } from "../../agent/src/accounts/index.ts";
import type { DriverEvent, EngineAgent, SessionSpec, StoredMessage } from "../../agent/src/turn-engine/types.ts";
import { load } from "./handlers/accounts.ts";
import { isPaused, limitReached, recordStepUsage } from "./handlers/spend.ts";
import { ensure, raise, stepOpenOf } from "./projections.ts";
import type { EngineCtx } from "./projections.ts";
import { providerOfDriver } from "./runtime.ts";

export interface StepTurnIn {
  prompt: string;
  agentId?: string;
  keyId?: string;
  backupKeyId?: string;
  timeoutMinutes?: number;
  runId: string;
  stepId: string;
  idempotencyKey: string;
}
export interface StepTurnOut { text: string; keyUsed: string; modelUsed: string; tokensIn: number; tokensOut: number; agentName?: string }

/** The agent id of a turn that runs as no agent in particular. The Vault lookup reads it as "the person or service itself". */
export const STEP_AGENT = "step";
const MEMORY_FACTS = 30;
const MEMORY_CHARS = 3_000;
const DEFAULT_MINUTES = 5;
let msPerMinute = 60_000;
/** Tests shorten a minute so a stuck turn can be proved to time out. */
export function setMinuteForTests(ms: number): void { msPerMinute = ms; }

interface AgentOut { agent: { agentId: string; name: string; role?: string; model?: string; accountPolicy: "asker" | "key"; accountKey?: string; status?: string } }
interface PolicyOut { allowedAccounts: "any" | "company" }
interface FactsOut { facts?: Array<{ text?: string; layer?: string }> }

const codeOfDriver = (code: string): { code: string; retryable: boolean } => {
  if (code === "provider.rate_limited" || code === "provider.overloaded") return { code, retryable: true };
  if (code.startsWith("provider.") || code.startsWith("timeout.")) return { code, retryable: false };
  if (code === "auth.expired" || code === "engine.no_account" || code === "engine.account_unsupported") return { code: "provider.auth_failed", retryable: false };
  if (code === "engine.timeout") return { code: "timeout.deadline", retryable: false };
  return { code: "provider.unavailable", retryable: true };
};

const hex = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
};

async function agentContext(ctx: EngineCtx, agentId: string): Promise<{ agent: AgentOut["agent"]; header: string }> {
  const got = (await ctx.call("agents.get", { agentId })) as AgentOut;
  const a = got.agent;
  if (a.status === "paused") raise(ctx, "permission.limit", `${a.name} is paused, so this step cannot run as that agent.`, { reason: "agent_paused" });
  let facts = "";
  try {
    const out = (await ctx.call("memory.facts.list", { agentId, status: ["current"], limit: MEMORY_FACTS })) as FactsOut;
    for (const f of out.facts ?? []) {
      if (typeof f.text !== "string" || f.text === "") continue;
      if (facts.length + f.text.length > MEMORY_CHARS) break;
      facts += `- ${f.text}\n`;
    }
  } catch { /* memory the asker may not read is simply not in the prompt */ }
  const header = [`You are ${a.name}, an agent in Vyre.${a.role ? ` ${a.role}` : ""}`, facts !== "" ? `What you remember that applies:\n${facts.trimEnd()}` : ""].filter((x) => x !== "").join("\n\n");
  return { agent: a, header };
}

/** The account that pays, by the same rules as a chat (agent/src/accounts/resolve.ts), narrowed for a Space automation to the keys the Space shares. */
async function accountFor(ctx: EngineCtx, i: StepTurnIn, asker: string, service: boolean, agent: AgentOut["agent"] | undefined): Promise<{ row: AccountRow; itemId?: string; payer: string }> {
  const { rows, itemByRef } = await load(ctx as never);
  const policy = (await ctx.call("engine.policy.get", {})) as PolicyOut;
  const usable = service ? rows.filter((r) => !r.mine) : rows;
  const provider = agent?.model ? providerOfModel(agent.model) : undefined;
  const res = resolveAccount({
    starter: asker,
    trigger: i.keyId ? "task" : "message",
    ...(i.keyId ? { stepKey: i.keyId } : {}),
    agent: { accountPolicy: agent?.accountPolicy ?? "asker", ...(agent?.accountKey ? { accountKey: agent.accountKey } : {}), ...(provider ? { provider } : {}) },
    backupRefs: i.backupKeyId ? [i.backupKeyId] : [],
    policy: policy.allowedAccounts,
    accounts: usable,
    onServer: true,
  });
  const row = res.accountRef ? usable.find((r) => r.ref === res.accountRef) : undefined;
  if (!res.allowed || !row || !res.payer) {
    const why = service
      ? i.keyId
        ? "The key chosen for this AI step is not a Space-shared key that works. Share the key with the Space in the Vault (AI providers), or choose another."
        : "A Space automation needs a Space-shared AI key. Add one in the Vault under AI providers (Shared), then choose it in the AI step."
      : "This AI step runs on your own AI account and you have none that works on the server. Sign in with Claude or Codex (and turn on Let the Space run work on my subscription), or add an API key, in AI settings.";
    raise(ctx, "provider.auth_failed", why, { reason: "no_account", next: [{ kind: "open_settings", label: "Open AI settings" }] });
  }
  const itemId = itemByRef.get(row.ref);
  return { row, ...(itemId ? { itemId } : {}), payer: res.payer };
}

export async function stepTurn(ctx: EngineCtx, input: StepTurnIn): Promise<StepTurnOut> {
  ensure(ctx.db);
  const stored = ctx.db.all("SELECT result_json FROM engine_step_turns WHERE key = ?", input.idempotencyKey)[0] as { result_json?: string } | undefined;
  if (stored?.result_json) return JSON.parse(stored.result_json) as StepTurnOut;
  const open = stepOpenOf();
  if (!open) raise(ctx, "internal.unavailable", "The agent runtime is not running on this server, so an AI step cannot run.");
  if (typeof input.prompt !== "string" || input.prompt.trim() === "") raise(ctx, "validation.bad_input", "An AI step needs a prompt.");
  const service = ctx.principal.kind === "service";
  const asker = ctx.actingFor ?? ctx.principal.id;
  if (isPaused(ctx)) raise(ctx, "permission.limit", "All AI spend is paused in this Space, so this AI step is waiting for it to resume.", { reason: "spend_paused" });

  const withAgent = input.agentId ? await agentContext(ctx, input.agentId) : undefined;
  const agentKey = withAgent?.agent.agentId ?? STEP_AGENT;
  const hit = limitReached(ctx, { agentId: agentKey, asker }, ctx.now());
  if (hit) raise(ctx, "permission.limit", `The ${hit.scope === "space" ? "Space" : hit.scope === "agent" ? "agent" : "person"} has reached a ${hit.limit} AI limit, so this step did not run. Raise it or wait.`, { reason: "limit", scope: hit.scope, limit: hit.limit });

  const paid = await accountFor(ctx, input, asker, service, withAgent?.agent);
  const agent: EngineAgent = { id: agentKey, ...(withAgent ? { name: withAgent.agent.name } : {}), mode: "lead", ...(withAgent?.agent.model ? { model: withAgent.agent.model } : {}) };
  const slug = hex(input.idempotencyKey);
  const threadId = `thr_step${slug}`;
  const turnId = `trn_step${slug}${hex(String(ctx.now()))}`;
  const spec: SessionSpec = {
    threadId, agent, asker, turnId, traceId: ctx.trace.traceId, tools: "none",
    account: { ref: paid.row.ref, driver: paid.row.driver, provider: providerOfDriver(paid.row.driver), kind: paid.row.kind, payer: paid.payer, reason: input.keyId ? "step_key" : "starter", ...(paid.itemId ? { itemId: paid.itemId } : {}) },
  };
  const text = `${withAgent ? `${withAgent.header}\n\n` : ""}${input.prompt}`;
  const trigger: StoredMessage = { id: `msg_step${slug}`, threadId, threadSeq: 1, author: { kind: "person", id: asker }, mentions: [], depth: 0, body: text };

  const minutes = Math.min(30, Math.max(1, input.timeoutMinutes ?? DEFAULT_MINUTES));
  const session = await open(spec).catch((e: unknown) => {
    const c = (e as { code?: unknown } | null)?.code;
    const mapped = codeOfDriver(typeof c === "string" ? c : "");
    raise(ctx, mapped.code as never, e instanceof Error ? e.message.slice(0, 300) : "The AI engine could not start.", { reason: "open_failed" });
  });
  let reply = "";
  let tokensIn = 0;
  let tokensOut = 0;
  let failure: { code: string; message: string } | null = null;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void session.cancel(); }, minutes * msPerMinute);
  try {
    for await (const ev of session.send({ threadId, turnId, agent, trigger, asker, history: [], listeners: [] }) as AsyncIterable<DriverEvent>) {
      if (ev.type === "text") reply += ev.text;
      else if (ev.type === "usage") { tokensIn += ev.inputTokens; tokensOut += ev.outputTokens; }
      else if (ev.type === "error") { failure = { code: ev.code, message: ev.message }; break; }
      else if (ev.type === "tool_call") { failure = { code: "engine.no_tools", message: "The AI engine asked for a tool, and this step gives it none." }; await session.cancel(); break; }
      else if (ev.type === "done") break;
    }
  } finally {
    clearTimeout(timer);
    try { await session.close(); } catch { /* a session that will not close is dropped */ }
  }
  // what ran is counted whether or not it answered
  const model = withAgent?.agent.model ?? paid.row.driver;
  recordStepUsage(ctx, { turnId, agentId: agentKey, asker, model, tokensIn, tokensOut, ...(paid.itemId ? { itemId: paid.itemId } : {}) });
  if (timedOut) raise(ctx, "timeout.deadline", `The AI step did not answer within ${minutes} minutes.`, { reason: "timeout" });
  if (failure) {
    const mapped = codeOfDriver(failure.code);
    raise(ctx, mapped.code as never, failure.message.slice(0, 300), { reason: "engine", engineCode: failure.code });
  }
  const out: StepTurnOut = { text: reply, keyUsed: paid.row.ref, modelUsed: model, tokensIn, tokensOut, ...(withAgent ? { agentName: withAgent.agent.name } : {}) };
  ctx.db.run("INSERT OR IGNORE INTO engine_step_turns (key, result_json, at) VALUES (?, ?, ?)", input.idempotencyKey, JSON.stringify(out), ctx.now());
  return out;
}
