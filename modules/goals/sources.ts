// Where the number of a goal comes from. Each reader asks the module that owns the data, through a capability, and answers a number or the honest reason it has none.
// Nothing here believes an agent: a report from the lead never moves the number. The owner's own number (manual) and a checklist live on the goal and change only by the owner's press or a finished task.
import type { Goal, GoalsCtx, Source } from "./projections.ts";

export interface Reading { ok: boolean; value?: number; error?: string }

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const why = (e: unknown): string => {
  const o = e as { message?: unknown; body?: { error?: { message?: unknown } }; code?: unknown };
  const m = o?.body?.error?.message ?? o?.message;
  return typeof m === "string" && m.trim() !== "" ? m.trim().slice(0, 200) : "the source did not answer";
};

/** The number at a dotted path ("meta.total", "items.length", "data.0.count"); a list at the path counts its rows. Also a number written in plain text, when that is all there is. */
export function numberAt(value: unknown, path: string | undefined): number | undefined {
  let cur: unknown = value;
  for (const part of (path ?? "").split(".").filter((p) => p !== "")) {
    if (part === "length" && Array.isArray(cur)) { cur = cur.length; continue; }
    if (Array.isArray(cur) && /^\d+$/.test(part)) { cur = cur[Number(part)]; continue; }
    if (!isObj(cur)) return undefined;
    cur = cur[part];
  }
  if (typeof cur === "number" && Number.isFinite(cur)) return cur;
  if (Array.isArray(cur)) return cur.length;
  if (typeof cur === "string") { const m = /-?\d+(?:\.\d+)?/.exec(cur.replace(/,/g, "")); return m ? Number(m[0]) : undefined; }
  return undefined;
}

async function readRecords(ctx: GoalsCtx, s: Source): Promise<Reading> {
  if (!s.type) return { ok: false, error: "the source names no record type" };
  const out = (await ctx.call!("records.counts", { type: s.type, ...(s.filter !== undefined ? { filter: s.filter } : {}) })) as { count?: unknown };
  return typeof out?.count === "number" ? { ok: true, value: out.count } : { ok: false, error: `${s.type} gave no count` };
}
async function readConnection(ctx: GoalsCtx, s: Source): Promise<Reading> {
  if (!s.connector || !s.connectionId || !s.action) return { ok: false, error: "the source needs a connector, a connection and a read action" };
  const out = (await ctx.call!("connectors.read", { key: s.connector, action: s.action, connectionId: s.connectionId, input: s.input ?? {} })) as { output?: unknown };
  const v = numberAt(out?.output, s.path);
  return v === undefined ? { ok: false, error: `no number at "${s.path ?? ""}" in what ${s.connector} answered` } : { ok: true, value: v };
}
async function readMcp(ctx: GoalsCtx, g: Goal, s: Source): Promise<Reading> {
  if (!s.server || !s.tool) return { ok: false, error: "the source needs an MCP server and tool" };
  const out = (await ctx.call!("engine.mcp.read", { agentId: g.leadAgentId, server: s.server, tool: s.tool, ...(s.input !== undefined ? { input: s.input } : {}) })) as { isError?: boolean; text?: string; structured?: unknown };
  if (out?.isError) return { ok: false, error: `${s.tool} answered an error: ${String(out.text ?? "").slice(0, 160)}` };
  const v = numberAt(out?.structured ?? out?.text, out?.structured !== undefined ? s.path : undefined) ?? numberAt(out?.text, undefined);
  return v === undefined ? { ok: false, error: `no number in what ${s.tool} answered` } : { ok: true, value: v };
}
async function readAutomation(ctx: GoalsCtx, s: Source): Promise<Reading> {
  if (!s.automationId) return { ok: false, error: "the source names no automation" };
  const list = (await ctx.call!("runs.list", { automationId: s.automationId, status: ["succeeded"], limit: 1 })) as { runs?: Array<{ runId?: string; id?: string; output?: unknown }> };
  const run = list?.runs?.[0];
  if (!run) return { ok: false, error: "the automation has no successful run yet" };
  let output = run.output;
  if (output === undefined) output = ((await ctx.call!("runs.get", { runId: run.runId ?? run.id })) as { run?: { output?: unknown } })?.run?.output;
  const v = numberAt(output, s.path);
  return v === undefined ? { ok: false, error: `no number at "${s.path ?? ""}" in the automation's output` } : { ok: true, value: v };
}

/** Read the number of a goal now. Checklist and owner goals have no number to read: their progress is the goal's own items and tasks. */
export async function readSource(ctx: GoalsCtx, g: Goal): Promise<Reading> {
  const f = g.finish;
  if (f.kind !== "number") return { ok: true };
  const s = f.source;
  if (!s) return { ok: false, error: "the finish line names no source" };
  if (s.kind === "manual") return g.value === undefined ? { ok: false, error: "waiting for the owner to set the number" } : { ok: true, value: g.value };
  if (!ctx.call) return { ok: false, error: "the source cannot be reached from here" };
  try {
    if (s.kind === "records") return await readRecords(ctx, s);
    if (s.kind === "connection") return await readConnection(ctx, s);
    if (s.kind === "mcp") return await readMcp(ctx, g, s);
    if (s.kind === "automation") return await readAutomation(ctx, s);
    return { ok: false, error: `unknown source ${String((s as { kind: unknown }).kind)}` };
  } catch (e) { return { ok: false, error: why(e) }; }
}

/** The source in words, for the brief, the card and the activity line. */
export function sourceWords(s: Source | undefined): string {
  if (!s) return "no source";
  if (s.label) return s.label;
  if (s.kind === "records") return `the count of ${s.type ?? "records"}`;
  if (s.kind === "connection") return `${s.connector ?? "a connection"} (${s.action ?? "read"})`;
  if (s.kind === "mcp") return `${s.server ?? "an MCP server"} ${s.tool ?? ""}`.trim();
  if (s.kind === "automation") return "an automation's output";
  return "a number the owner sets";
}
