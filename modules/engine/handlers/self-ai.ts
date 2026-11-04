// engine.my_ai: what an agent (or /usage in a chat) says about the AI it runs on, from one place and never from the model's own memory of itself (owner, 4 Nov):
//   running  the model, effort, account and who paid for this chat's latest turn (engine.usage.get lastTurn), and the context used against the model's window
//   accounts every account the asker may run this chat on (engine.accounts.list with place chat: the one resolver the Vault and the pickers use), whether it is usable and why not, its models, and its limits:
//            read as the provider reported them (a Claude Code or Codex sign-in reports its session and week windows with each turn), or plainly "not readable"
//   use      the asker's own turns today and this month: turns, input (new and cached apart), output and cost
import { rows, num } from "./extra/util.ts";
import type { EngineCtx } from "../projections.ts";

type Obj = Record<string, unknown>;
interface Limits { state: "read" | "not_readable"; session?: { pct: number; resetsAt?: number }; week?: { pct: number; resetsAt?: number }; note?: string }
interface Use { turns: number; input: number; cachedInput: number; output: number; costMicros: number }

const dayStart = (t: number): number => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const monthStart = (t: number): number => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };

function useSince(ctx: EngineCtx, person: string, since: number): Use {
  const r = rows(ctx, `SELECT COUNT(*) AS turns, COALESCE(SUM(u.tokens_in), 0) AS tin, COALESCE(SUM(u.tokens_out), 0) AS tout, COALESCE(SUM(u.cost_micros), 0) AS cost,
      COALESCE(SUM((SELECT CAST(json_extract(i.info, '$.cacheReadTokens') AS INTEGER) FROM engine_turn_info i WHERE i.turn_id = u.turn_id)), 0) AS cached
    FROM engine_usage u WHERE u.person_id = ? AND u.at >= ?`, person, since)[0];
  const tin = num(r?.["tin"]), cached = Math.min(tin, num(r?.["cached"]));
  return { turns: num(r?.["turns"]), input: tin - cached, cachedInput: cached, output: num(r?.["tout"]), costMicros: num(r?.["cost"]) };
}

const NOT_READABLE: Readonly<Record<string, string>> = {
  anthropic: "Anthropic does not report what is left on an API key.", openai: "OpenAI does not report what is left on an API key.", openrouter: "OpenRouter's credit balance is not read by Vyre yet.",
  opencode_go: "OpenCode Go does not report its quota.", google: "Google does not report what is left on an API key.", xai: "xAI does not report what is left on an API key.",
};

export async function selfAi(ctx: EngineCtx, input: { threadId?: string; agentId?: string }): Promise<Obj> {
  const now = ctx.now();
  const person = ctx.actingFor ?? ctx.principal.id;
  const listed = (await ctx.call("engine.accounts.list", { place: "chat", ...(input.agentId ? { agentId: input.agentId } : {}) }).catch(() => ({ accounts: [] }))) as { accounts?: Obj[] };
  let running: Obj | undefined;
  let head: Obj | undefined;
  if (input.threadId && input.agentId) {
    const u = (await ctx.call("engine.usage.get", { threadId: input.threadId, agentId: input.agentId }).catch(() => null)) as Obj | null;
    if (u) {
      head = u;
      running = { ...(u["lastTurn"] as Obj ?? {}), ...(u["context"] ? { context: u["context"] } : {}) };
    }
  }
  const accounts = await Promise.all((listed.accounts ?? []).map(async (a) => {
    const ref = String(a["ref"]);
    const sub = a["kind"] === "subscription";
    const usage = (await ctx.call("engine.usage.get", { threadId: input.threadId ?? "", agentId: input.agentId ?? "", accountRef: ref }).catch(() => null)) as Obj | null;
    const session = (usage?.["session"] ?? null) as Limits["session"] | null, week = (usage?.["week"] ?? null) as Limits["week"] | null;
    const limits: Limits = session || week
      ? { state: "read", ...(session ? { session } : {}), ...(week ? { week } : {}) }
      : { state: "not_readable", note: sub ? "This sign-in's CLI reports its limits only with a turn, and none has been read here yet." : NOT_READABLE[String(a["driver"])] ?? "This provider does not report what is left." };
    const models = Array.isArray(a["models"]) && a["models"].length > 0 ? (a["models"] as string[])
      : a["usable"] === false ? [] : (((await ctx.call("engine.models.list", { accountRef: ref }).catch(() => ({ models: [] }))) as { models?: Array<{ model: string; allowed?: boolean }> }).models ?? []).filter((m) => m.allowed !== false).map((m) => m.model);
    return { ref, name: String(a["name"] ?? a["title"] ?? ref), provider: String(a["driver"]), kind: String(a["kind"]), usable: a["usable"] !== false, ...(a["why"] ? { why: a["why"] } : {}), models, limits };
  }));
  void head;
  return { ...(running ? { running } : {}), accounts, use: { today: useSince(ctx, person, dayStart(now)), month: useSince(ctx, person, monthStart(now)) } };
}
