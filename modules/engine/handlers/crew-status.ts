// engine.crew.status (owner, 4 Nov 2026): one read of everything under a chat that works for it, for the Island, the header chip and the Crew pane. Helpers come from engine.helpers.status; teammates from their jobs
// (branch, files from the git summary the job kept). Tokens and cost are the turn rows' own, the model is the one each turn reported, the account is the one that paid. Nothing is estimated: a number that is not
// known is left out (test counts are not kept anywhere yet, so they are not here).
import { testsOf } from "../helper-tests.ts";
import { ensure } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";
import { helpersStatus } from "./helpers.ts";
import { jobOut } from "./crew.ts";
import { liveTurns } from "./bridge.ts";
import { agentDisplay } from "../agent-names.ts";

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0);
export type MemberState = "working" | "done" | "needs_you" | "failed" | "stopped";
export interface Member {
  kind: "helper" | "teammate"; id: string; parentThreadId: string; title: string; name?: string; agentId: string; state: MemberState; step?: string; found?: string;
  startedAt: number; endedAt?: number; elapsedMs: number; model?: string; provider?: string; accountLabel?: string; why?: string; fellBackFrom?: string;
  branch?: string; files?: Array<{ path: string; added: number; deleted: number }>; added?: number; deleted?: number; merged?: boolean;
  tokensIn: number; tokensOut: number; costMicros: number;
}

const JOB_STATE: Readonly<Record<string, MemberState>> = { working: "working", waiting: "needs_you", paused: "stopped", lost: "failed", done: "done", failed: "failed", stopped: "stopped", merged: "done" };

export async function crewStatus(ctx: EngineCtx, input: { threadId: string }) {
  ensure(ctx.db);
  const members: Member[] = [];
  // a teammate is also a helper thread: it is listed once, as a teammate
  const mates = new Set((ctx.db.all("SELECT thread_id FROM engine_crew_job WHERE lead_thread_id = ?", input.threadId) as Row[]).map((r) => String(r["thread_id"])));
  for (const h of (await helpersStatus(ctx, input)).helpers.filter((x) => !mates.has(x.threadId))) {
    members.push({
      kind: "helper", id: h.threadId, parentThreadId: input.threadId, title: h.title, agentId: h.agentId, state: h.state, ...(h.holdTaskId ? { holdTaskId: h.holdTaskId } : {}), ...(h.step ? { step: h.step } : {}), ...(h.found ? { found: h.found } : {}), startedAt: h.startedAt,
      ...(h.endedAt !== undefined ? { endedAt: h.endedAt } : {}), elapsedMs: h.elapsedMs, ...(h.model ? { model: h.model } : {}), ...(h.provider ? { provider: h.provider } : {}), ...(h.accountLabel ? { accountLabel: h.accountLabel } : {}),
      ...(h.why ? { why: h.why } : {}), ...(h.fellBackFrom ? { fellBackFrom: h.fellBackFrom } : {}), tokensIn: h.tokensIn, tokensOut: h.tokensOut, costMicros: h.costMicros,
    });
  }
  const accounts = ((await ctx.call("engine.accounts.list", {}).catch(() => ({ accounts: [] }))) as { accounts: Array<{ ref: string; name?: string; title?: string; aliases?: string[] }> }).accounts;
  const now = ctx.now();
  for (const r of ctx.db.all("SELECT * FROM engine_crew_job WHERE lead_thread_id = ? ORDER BY started_at, rowid", input.threadId) as Row[]) {
    const j = jobOut(r);
    const turns = ctx.db.all("SELECT model, account_ref, tokens_in, tokens_out, cost_micros FROM engine_turns WHERE thread_id = ? ORDER BY started_at, rowid", j.threadId) as Row[];
    const last = turns.at(-1);
    const ref = last && last["account_ref"] ? String(last["account_ref"]) : "";
    const acct = ref ? accounts.find((a) => a.ref === ref) ?? accounts.find((a) => (a.aliases ?? []).includes(ref)) : undefined;
    const files = ((j.result?.["summary"] as { files?: Array<{ path: string; added: number; deleted: number }> } | undefined)?.files) ?? [];
    const live = j.state === "working" ? (await liveTurns(ctx, { threadId: j.threadId }).catch(() => ({ turns: [] as Array<{ step?: string }> }))).turns.find((t) => t.step)?.step : undefined;
    const end = j.endedAt;
    const name = (await agentDisplay((cap, i) => ctx.call(cap, i), j.agentId)).name;
    members.push({
      kind: "teammate", id: j.threadId, parentThreadId: input.threadId, title: j.title, name, agentId: j.agentId, state: JOB_STATE[j.state] ?? "working", ...(live ? { step: live } : {}),
      startedAt: j.startedAt, ...(end !== undefined ? { endedAt: end } : {}), elapsedMs: Math.max(0, (end ?? now) - j.startedAt), ...(last && String(last["model"]) !== "unknown" ? { model: String(last["model"]) } : {}),
      ...(acct ? { accountLabel: acct.name ?? acct.title ?? ref } : {}), branch: j.branch, files, added: files.reduce((n, f) => n + f.added, 0), deleted: files.reduce((n, f) => n + f.deleted, 0), merged: j.state === "merged",
      tokensIn: turns.reduce((n, t) => n + num(t["tokens_in"]), 0), tokensOut: turns.reduce((n, t) => n + num(t["tokens_out"]), 0), costMicros: turns.reduce((n, t) => n + num(t["cost_micros"]), 0),
    });
  }
  for (const m of members) { const t = testsOf(ctx.db, m.id); if (t) m.tests = t; }
  const by = (s: MemberState): number => members.filter((m) => m.state === s).length;
  const totals = {
    members: members.length, working: by("working"), done: by("done"), needsYou: by("needs_you"), failed: by("failed"), stopped: by("stopped"),
    tokensIn: members.reduce((n, m) => n + m.tokensIn, 0), tokensOut: members.reduce((n, m) => n + m.tokensOut, 0), costMicros: members.reduce((n, m) => n + m.costMicros, 0),
    filesChanged: new Set(members.flatMap((m) => (m.files ?? []).map((f) => f.path))).size, added: members.reduce((n, m) => n + (m.added ?? 0), 0), deleted: members.reduce((n, m) => n + (m.deleted ?? 0), 0),
    elapsedMs: members.reduce((n, m) => Math.max(n, m.elapsedMs), 0),
  };
  return { members, totals };
}
