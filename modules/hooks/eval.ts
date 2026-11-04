// Running the hooks of one event (lane l-hooks). Order: Space, person, agent, chat, run; an admin's block ends it, so it wins. A hook only ever stops work or adds a note or runs its own action; there is no
// answer here that approves, loosens or skips anything. A hook that errors or runs out of time is logged and shown, never a block.
import { BLOCKING, matches, namesOf, parseCheck, plainTools, redact, scopeRank, validNext } from "../../lib/hooks.ts";
import type { HookFire, HookVerdict } from "../../lib/hooks.ts";
import { applicable, isAllowed, logRun, helpersActive, link, lineage, parentOf, takeNotes, takePass } from "./projections.ts";
import type { HooksCtx, Rec } from "./projections.ts";
import { hostSeams } from "./seams.ts";
import type { CheckAnswer } from "../../lib/hooks.ts";
import type { PluginHook, Who } from "./seams.ts";

const TOOL_EVENTS: ReadonlySet<string> = new Set(["tool.before", "tool.after", "outward.before"]);
const NOTE_FROM_STDOUT: ReadonlySet<string> = new Set(["session.start", "prompt.submit"]);
const CLAUDE_NAME: Record<string, string> = { "tool.before": "PreToolUse", "tool.after": "PostToolUse", "outward.before": "PreToolUse", "prompt.submit": "UserPromptSubmit", "session.start": "SessionStart", "turn.end": "Stop", "helper.start": "SubagentStart", "helper.end": "SubagentStop" };
/** Capabilities a hook's action may never name: a hook does not approve, grant, sign in or change hooks and settings. */
export const ACTION_DENIED = /^(hooks\.|gate\.|access\.|settings\.|vault\.|identity\.|members\.)|\.(approve|approve_plan|grant|decide)$/;

const trunc = (v: unknown, n = 2000): unknown => {
  if (v === undefined) return undefined;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  const r = redact(s ?? "", n);
  if (typeof v === "string") return r;
  try { return s !== undefined && s.length <= n ? JSON.parse(r) : r; } catch { return r; }
};

/** The event as a command or a check reads it: Claude Code's field names, plus Vyre's own. */
export function payloadOf(f: HookFire): Record<string, unknown> {
  return {
    session_id: f.threadId, hook_event_name: CLAUDE_NAME[f.event] ?? f.event, vyre_event: f.event, agent_id: f.agentId, thread_id: f.threadId, ...(f.turnId ? { turn_id: f.turnId } : {}), ...(f.engine ? { engine: f.engine } : {}),
    ...(f.tool ? { tool_name: f.tool } : {}), ...(f.cap ? { capability: f.cap } : {}), ...(f.input !== undefined ? { tool_input: trunc(f.input) } : {}), ...(f.output !== undefined ? { tool_response: trunc(f.output) } : {}),
    ...(f.ok !== undefined ? { ok: f.ok } : {}), ...(f.prompt !== undefined ? { prompt: trunc(f.prompt, 4000) } : {}), ...(f.title ? { title: redact(f.title, 200) } : {}),
  };
}

type Out = { block?: string; note?: string; next?: Array<{ label: string; ask: string }>; outcome: string; detail?: string };
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | "timeout"> => new Promise((ok, bad) => {
  const t = setTimeout(() => ok("timeout"), ms);
  p.then((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); bad(e); });
});

async function runOne(ctx: HooksCtx, h: Rec, who: Who, f: HookFire, payload: Record<string, unknown>): Promise<Out> {
  const ms = h.timeoutSec * 1000;
  if (h.kind === "command") {
    const r = await withTimeout(hostSeams.command(who, { command: h.spec.command ?? "", ...(h.spec.args ? { args: h.spec.args } : {}), timeoutSec: h.timeoutSec }, payload), ms + 2000);
    if (r === "timeout" || r.timedOut) return { outcome: "timeout" };
    if (r.code === 2) return { outcome: "blocked", block: plainTools(redact(r.stderr.trim() || r.stdout.trim() || "a hook stopped it")) };
    if (r.code !== 0) return { outcome: "error", detail: redact(r.stderr.trim() || `exit ${r.code}`, 160) };
    const out = r.stdout.trim();
    return NOTE_FROM_STDOUT.has(f.event) && out !== "" ? { outcome: "note", note: redact(out, 600) } : { outcome: "ok" };
  }
  if (h.kind === "check") {
    const r = await withTimeout(hostSeams.check(who, h.spec.instruction ?? "", payload, h.timeoutSec).then((a) => a ?? viaEngine(ctx, who, h.spec.instruction ?? "", payload)), ms + 2000);
    if (r === "timeout") return { outcome: "timeout" };
    if (r === null) return { outcome: "skipped", detail: "no AI account could answer" };
    if (r.decision === "block") return { outcome: "blocked", block: plainTools(redact(r.reason)), ...(r.next && validNext(r.next).length > 0 ? { next: validNext(r.next) } : {}) };
    if (r.decision === "note") return { outcome: "note", note: plainTools(redact(r.note, 600)) };
    return { outcome: "ok" };
  }
  const cap = h.spec.cap ?? "";
  if (ACTION_DENIED.test(cap)) return { outcome: "error", detail: "a hook may not call that" };
  const r = await withTimeout(hostSeams.action(who, cap, h.spec.input ?? {}), ms + 2000);
  return r === "timeout" ? { outcome: "timeout" } : { outcome: "ok" };
}

/** A check is read by a small model on the asker's own AI account: the account that would pay for the turn, asked through the engine (engine.complete is for the Space's own jobs, which this is). */
import { CHECK_SYSTEM } from "../../lib/hooks.ts";
export { CHECK_SYSTEM };
async function viaEngine(ctx: HooksCtx, who: Who, instruction: string, payload: Record<string, unknown>): Promise<CheckAnswer | null> {
  if (!ctx.call || !who.threadId) return null;
  const acct = (await ctx.call("engine.account.resolve", { threadId: who.threadId, agentId: who.agentId, askerId: who.asker, kind: "agent_work" })) as { accountRef?: string | null; allowed?: boolean } | undefined;
  if (!acct?.accountRef || acct.allowed === false) return null;
  const out = (await ctx.call("engine.complete", { accountRef: acct.accountRef, system: CHECK_SYSTEM, prompt: `Rule: ${instruction}\n\nEvent:\n${JSON.stringify(payload).slice(0, 6000)}` })) as { text?: string } | undefined;
  return out?.text === undefined ? null : parseCheck(out.text);
}

const said = new Map<string, number>();
async function say(ctx: HooksCtx, threadId: string, body: string, kind: "blocked" | "failed", h: Rec, reason?: string, tool?: string, next?: Array<{ label: string; ask: string }>, agentId?: string): Promise<void> {
  if (!ctx.call) return;
  try {
    await ctx.call("chat.hook_line", { threadId, body, kind, hookId: h.id, scope: h.scope, by: h.madeBy, byKind: h.madeByKind, ...(reason ? { reason } : {}), ...(tool ? { tool } : {}), ...(next ? { next } : {}), ...(agentId ? { agentId } : {}) });
  } catch (e) { ctx.log?.warn("a hook line was not posted", { error: e instanceof Error ? e.message : String(e) }); }
  // a stop in a helper's thread also reaches the chat it works for, so its lead and the people there see it
  const parent = kind === "blocked" ? parentOf(ctx, threadId) : null;
  if (parent) {
    try { await ctx.call("chat.hook_line", { threadId: parent, body: `A hook stopped a helper: ${reason ?? ""}`.trim(), kind: "blocked", scope: h.scope, by: h.madeBy, byKind: h.madeByKind, ...(reason ? { reason } : {}) }); } catch { /* the helper's own line stands */ }
  }
}

/** Hooks that plugins brought, as agent-scope command hooks, so they take their place in the one order. They do not run for Claude Code: it loads the plugin's own hooks itself. */
async function pluginRecs(f: HookFire, who: Who): Promise<Array<Rec & { plugin: PluginHook }>> {
  if (f.engine === "claude_code" || !TOOL_EVENTS.has(f.event)) return [];
  const want = f.event === "tool.after" ? "PostToolUse" : "PreToolUse";
  let list: PluginHook[] = [];
  try { list = await hostSeams.pluginHooks(who); } catch { return []; }
  return list.filter((p) => p.event === want).map((p, i) => ({
    id: `plugin:${p.pluginId}:${i}`, scope: "agent", personId: null, agentId: f.agentId, threadId: null, helpers: false, event: f.event, kind: "command", matcher: p.matcher, spec: { command: p.command, args: p.args },
    timeoutSec: p.timeoutSec ?? 30, paused: false, line: `a plugin hook from ${p.plugin}`, madeBy: `plugin:${p.plugin}`, madeByKind: "person" as const, forPerson: null, seq: 0, createdAt: 0, updatedAt: 0, endedAt: null, plugin: p,
  }));
}

export async function fire(ctx: HooksCtx, f: HookFire): Promise<HookVerdict> {
  const who: Who = { agentId: f.agentId, asker: f.asker, threadId: f.threadId };
  const mine = applicable(ctx, { event: f.event, agentId: f.agentId, asker: f.asker, threadId: f.threadId });
  const plugs = await pluginRecs(f, who);
  const tooly = TOOL_EVENTS.has(f.event);
  const names = namesOf({ ...(f.tool ? { tool: f.tool } : {}), ...(f.cap ? { cap: f.cap } : {}) });
  const order = [...mine, ...plugs].sort((a, b) => scopeRank(a.scope) - scopeRank(b.scope) || (a.id.startsWith("plugin:") ? 0 : 1) - (b.id.startsWith("plugin:") ? 0 : 1) || a.seq - b.seq);
  const payload = payloadOf(f);
  const verdict: HookVerdict = { block: null, notes: f.event === "prompt.submit" ? takeNotes(ctx, f.threadId) : [], ran: 0 };
  for (const h of order) {
    if (tooly && !names.some((n) => matches(h.matcher, n))) continue;
    // a person pressed "Allow this once" on this hook in this chat: it lets this one through, and the pass is used up
    if (BLOCKING.has(f.event) && !h.id.startsWith("plugin:") && takePass(ctx, h.id, f.threadId)) {
      verdict.ran++;
      logRun(ctx, { hookId: h.id, event: f.event, threadId: f.threadId, agentId: f.agentId, ...(f.tool ? { tool: f.tool } : {}), outcome: "allowed_once", ms: 0 });
      continue;
    }
    // a person pressed "Always allow" on a stop of this hook for this kind of act: the hook lets it go by and keeps guarding everything else
    if (BLOCKING.has(f.event) && !h.id.startsWith("plugin:") && isAllowed(ctx, h.id, f.tool)) {
      verdict.ran++;
      logRun(ctx, { hookId: h.id, event: f.event, threadId: f.threadId, agentId: f.agentId, ...(f.tool ? { tool: f.tool } : {}), outcome: "allowed_always", ms: 0 });
      continue;
    }
    const t0 = Date.now();
    let o: Out;
    try {
      const plugin = (h as Rec & { plugin?: PluginHook }).plugin;
      if (plugin) {
        const r = await withTimeout(hostSeams.plugin(who, plugin, { session_id: f.threadId, hook_event_name: CLAUDE_NAME[f.event], tool_name: f.tool ?? f.cap ?? "", tool_input: payload["tool_input"], tool_response: payload["tool_response"] }), (plugin.timeoutSec ?? 30) * 1000 + 2000);
        o = r === "timeout" || r.timedOut ? { outcome: "timeout" } : r.code === 2 ? { outcome: "blocked", block: redact(r.stderr.trim() || r.stdout.trim() || "a plugin hook refused it") } : { outcome: "ok" };
      } else o = await runOne(ctx, h, who, f, payload);
    } catch (e) { ctx.log?.warn("a hook failed", { hook: h.id, event: f.event, error: e instanceof Error ? e.message : String(e), ...((e as { error?: { details?: unknown } })?.error?.details ? { details: (e as { error: { details: unknown } }).error.details } : {}) }); if (process.env["VYRE_HOOKS_DEBUG"]) console.error("HOOKFAIL", e); o = { outcome: "error", detail: redact(e instanceof Error ? e.message : String(e), 160) }; }
    verdict.ran++;
    const ms = Date.now() - t0;
    if (o.outcome === "blocked" && !BLOCKING.has(f.event)) o = { outcome: "ok", detail: "this event cannot be stopped" };
    if (!h.id.startsWith("plugin:")) logRun(ctx, { hookId: h.id, event: f.event, threadId: f.threadId, agentId: f.agentId, ...(f.tool ? { tool: f.tool } : {}), outcome: o.outcome, ...(o.detail || o.block ? { detail: o.detail ?? o.block ?? "" } : {}), ms });
    if (o.outcome === "error" || o.outcome === "timeout") {
      const key = `${h.id}|${f.threadId}`;
      if (Date.now() - (said.get(key) ?? 0) > 3_600_000) {
        said.set(key, Date.now());
        if (said.size > 500) said.delete(said.keys().next().value as string);
        await say(ctx, f.threadId, `A hook did not finish (${o.outcome === "timeout" ? "ran out of time" : "it failed"}), so it did not stop anything: ${h.line}`, "failed", h);
      }
    }
    if (o.note) verdict.notes.push(o.note);
    if (o.block) {
      verdict.block = { reason: o.block, hookId: h.id, by: h.madeBy, scope: h.scope, ...(o.next ? { next: o.next } : {}) };
      ctx.emit("hook.blocked", f.threadId, { hookId: h.id, event: f.event, threadId: f.threadId, agentId: f.agentId, reason: o.block, scope: h.scope, by: h.madeBy });
      await say(ctx, f.threadId, `A hook stopped this: ${o.block}`, "blocked", h, o.block, f.tool, o.next, f.agentId);
      break;
    }
  }
  settle(ctx, f);
  return verdict;
}

/** Run hooks end with the turn that set them; if helpers it started are still working they stay until the last helper ends. */
function settle(ctx: HooksCtx, f: HookFire): void {
  if (f.event === "turn.end" && f.threadKind !== "helper") {
    ctx.db.run("UPDATE hooks_hook SET ended_at = ? WHERE scope = 'run' AND thread_id = ? AND removed_at IS NULL AND ended_at IS NULL AND created_at <= ?", ctx.now(), f.threadId, ctx.now());
    sweep(ctx, f.threadId);
  } else if (f.event === "helper.end") {
    ctx.db.run("UPDATE hooks_link SET done = 1 WHERE helper_thread = ?", f.threadId);
    // a helper's own run hooks end with it; the ones above it end when nothing under them is working
    ctx.db.run("UPDATE hooks_hook SET removed_at = ? WHERE scope = 'run' AND thread_id = ? AND removed_at IS NULL", ctx.now(), f.threadId);
    for (const t of lineage(ctx, f.threadId).slice(1)) sweep(ctx, t);
  }
}
function sweep(ctx: HooksCtx, thread: string): void {
  if (helpersActive(ctx, thread) > 0) return;
  ctx.db.run("UPDATE hooks_hook SET removed_at = ? WHERE scope = 'run' AND thread_id = ? AND ended_at IS NOT NULL AND removed_at IS NULL", ctx.now(), thread);
}
export { link };
