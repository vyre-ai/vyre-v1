// Compact a chat (engine.compact, lane l-sessions): free the context of the agent's engine, keeping what the person names, and say so in one calm line with the new context figure.
//
//   Claude Code   its own compact: `/compact <what to keep>` goes to the chat's engine session (the warm process, or one started with `--resume <id>`), which summarises itself and reports
//                 compact_boundary with the tokens before and after. The engine keeps its session id, so the next turn goes on in it.
//   Codex, Grok   a headless run has no compact Vyre can ask for (Codex exec has none; Grok's /compact takes no instructions and is not proven headless), so Vyre compacts for them: it writes a
//                 summary that starts with what to keep (the chat's rolling summary and the latest messages), forgets the engine's session id and closes its warm session. The next turn starts a
//                 new engine session from that summary and the messages after it.
//   API engines   their context is rebuilt from the chat each turn, so Vyre's summary is the compaction: from then on a turn is sent the summary and the messages after it. The driver's own
//                 automatic compaction (agent/src/drivers/api/messages.ts) puts the chat's "Keep this every time" at the head of its summary.
// Claude Code with no session to compact yet, or one its CLI says is gone, falls back to Vyre's summary, and the line says so.
// "Keep this every time" (engine_compact_keep) goes into every compaction of the chat: the person's, the API driver's automatic one (TurnInput.keep), and the CLIs' own automatic ones through the
// compact instructions in the CLAUDE.md and AGENTS.md of the chat's work folder (session.ts writeMemoryGuide).
import type { TurnEngine } from "../../agent/src/turn-engine/engine.ts";
import type { AccountQuery, EngineSession, OpenSession, ResolvedAccount, StoredMessage, TurnInput } from "../../agent/src/turn-engine/types.ts";
import type { ContextSection } from "../../agent/src/turn-engine/context.ts";
import { ROLL } from "../../agent/src/transcript/rollover.ts";
import { tokensOfChars } from "../../agent/src/transcript/tokens.ts";
import { windowFor } from "../../agent/src/transcript/windows.ts";
import { chatSettings } from "./chat-settings.ts";
import type { ChatSettings } from "./chat-settings.ts";
import { forgetSessions, keepEvery, lastCompaction, saveCompaction } from "./cli-sessions.ts";
import type { Compaction } from "./cli-sessions.ts";
import { BRIDGE_PREFIX } from "./handlers/bridge.ts";
import type { PostAs } from "./handlers/bridge.ts";
import { mintId } from "./projections.ts";
import type { Db } from "./projections.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;

/** Engines that compact their own context when asked (a headless `/compact <instructions>`). */
export const NATIVE_COMPACT: ReadonlySet<string> = new Set(["claude_code"]);
const ENGINE_NAME: Readonly<Record<string, string>> = { claude_code: "Claude Code", codex: "Codex", grok: "Grok" };

/** The latest messages written into Vyre's summary word for word (cut), after the rolling summary. */
const LATEST = 30;
const LINE_CHARS = 300;
const ROLLING_CHARS = 8_000;

const cut = (s: string, n: number): string => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const k = (n: number): string => (n >= 1_000_000 ? `${Math.round(n / 10_000) / 100}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(Math.max(0, Math.round(n))));

/** Vyre's summary of a chat: what to keep first, word for word, then the rolling summary, then the latest messages. */
export function vyreSummary(keep: string, rolling: string, latest: readonly StoredMessage[], nameOf: (id: string) => string = (id) => id): string {
  const lines = latest.filter((m) => m.body.trim() !== "").slice(-LATEST).map((m) => `${nameOf(m.author.id)}: ${cut(m.body, LINE_CHARS)}`);
  return [
    keep !== "" ? `Keep this, as the person asked: ${keep}` : "",
    rolling.trim() !== "" ? `In short:\n${cut(rolling, ROLLING_CHARS)}` : "",
    lines.length > 0 ? `The latest messages before the compaction:\n${lines.join("\n")}` : "",
  ].filter((x) => x !== "").join("\n\n");
}

/** The one line the chat shows. */
export function compactLine(o: { keep: string; used: number | null; window: number | null; fellBack?: string }): string {
  const parts = ["Compacted."];
  if (o.keep !== "") parts.push(`Kept: ${cut(o.keep, 200)}.`);
  if (o.used !== null && o.window !== null) parts.push(`Context now about ${k(o.used)} of ${k(o.window)} tokens.`);
  if (o.fellBack) parts.push(o.fellBack);
  return parts.join(" ");
}

export interface CompactDeps {
  db: Db;
  call: Call;
  engine: () => TurnEngine | null;
  /** The account the agent's next turn would run on (engine.account.resolve, the engine's own choice). */
  resolve(q: AccountQuery): Promise<ResolvedAccount | null>;
  /** The opener the turns use (the warm pool), so a native compact reaches the chat's own engine session. */
  open: OpenSession;
  /** Close the thread's idle engine sessions. */
  dropSessions?(threadId: string): Promise<number>;
  postAs?: PostAs;
  now: () => number;
  log?: (msg: string, attrs?: Record<string, unknown>) => void;
}

export interface CompactRequest { threadId: string; agentId: string; asker: string; keep: string; traceId: string }
export interface CompactResult { engine: string; how: "engine" | "vyre"; line: string; context: { used: number; window: number } | null; fellBack: boolean }

/** What the engine's own compact said, or why it could not. */
type NativeOutcome = { ok: true; before: number | null; after: number | null; output: number } | { ok: false; code: string };

export function createCompactor(d: CompactDeps) {
  async function native(req: CompactRequest, account: ResolvedAccount, s: ChatSettings): Promise<NativeOutcome> {
    const engine = d.engine();
    const base = engine?.agents(req.threadId).find((a) => a.id === req.agentId);
    if (!base) return { ok: false, code: "validation.not_found" };
    const agent = { ...base, ...(s.model !== undefined ? { model: s.model } : {}), ...(s.effort !== undefined ? { effort: s.effort } : {}) };
    const turnId = mintId("trn", d.now());
    // The compact resumes the engine session from its files: a warm process of this chat that holds the context from before would go on from there, so it is closed first.
    await d.dropSessions?.(req.threadId).catch(() => 0);
    let session: EngineSession;
    try {
      session = await d.open({ threadId: req.threadId, agent, asker: req.asker, turnId, traceId: req.traceId, account, ...(s.mode !== undefined ? { mode: s.mode } : {}) });
    } catch (e) {
      d.log?.("the engine session for a compact could not be opened", { threadId: req.threadId, error: e instanceof Error ? e.message : String(e) });
      return { ok: false, code: "engine.open_failed" };
    }
    let before: number | null = null, after: number | null = null, output = 0;
    let failed: string | null = null;
    try {
      const input: TurnInput = { threadId: req.threadId, turnId, agent, trigger: null, history: [], listeners: [], asker: req.asker, compact: { keep: req.keep } };
      for await (const ev of session.send(input)) {
        if (ev.type === "block" && ev.kind === "compacted") {
          const p = (ev.payload ?? {}) as { before?: unknown; after?: unknown };
          if (typeof p.before === "number") before = p.before;
          if (typeof p.after === "number") after = p.after;
        } else if (ev.type === "usage") output += ev.outputTokens;
        else if (ev.type === "error") { failed = ev.code; break; }
        else if (ev.type === "done") break;
      }
    } catch (e) {
      failed = "engine.cli_error";
      d.log?.("a compact failed", { threadId: req.threadId, error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (failed !== null && failed !== "engine.nothing_to_compact" && failed !== "engine.compact_unsupported") await session.cancel().catch(() => undefined);
      await session.close().catch(() => undefined);
    }
    return failed === null ? { ok: true, before, after, output } : { ok: false, code: failed };
  }

  async function vyre(req: CompactRequest, model: string | null, provider: string | null): Promise<Compaction> {
    let rolling = "";
    try {
      await d.call("chat.transcript.summarize", { threadId: req.threadId, idempotencyKey: `compact:${req.traceId}` }, req.asker);
      rolling = String(((await d.call("chat.transcript.summary", { threadId: req.threadId }, req.asker)) as { summary?: unknown }).summary ?? "");
    } catch { /* the latest messages still stand for the chat */ }
    const engine = d.engine();
    const msgs = engine ? engine.messages(req.threadId) : [];
    const names = new Map<string, string>();
    try {
      for (const a of engine?.agents(req.threadId) ?? []) names.set(a.id, a.name ?? a.id);
    } catch { /* ids stand in for names */ }
    const summary = vyreSummary(req.keep, rolling, msgs, (id) => names.get(id) ?? (id.startsWith("agt_") ? "Agent" : "Person"));
    const window = windowFor(model, provider);
    const c: Compaction = {
      threadId: req.threadId, agentId: req.agentId, how: "vyre", upToSeq: msgs.at(-1)?.threadSeq ?? 0, summary, keep: req.keep,
      used: Math.min(window, tokensOfChars(summary.length) + ROLL.baseline), window, at: d.now(),
    };
    saveCompaction(d.db, c);
    // the engine's own session holds the context from before: forget it and close its warm process, so the next turn starts a new one from the summary
    forgetSessions(d.db, req.threadId, req.agentId);
    await d.dropSessions?.(req.threadId).catch(() => 0);
    return c;
  }

  async function say(req: CompactRequest, text: string): Promise<void> {
    if (!d.postAs) return;
    try {
      await d.postAs(req.agentId, { actingFor: req.asker, threadId: req.threadId, body: "", mentions: [], clientId: BRIDGE_PREFIX + mintId("b", d.now()).slice(2), blocks: [{ type: "turn_status", v: 1, data: { state: "note", text } }] });
    } catch (e) { d.log?.("the compact line could not be shown in the chat", { threadId: req.threadId, error: e instanceof Error ? e.message : String(e) }); }
  }

  return {
    /**
     * Vyre rolls a chat over before its window fills (agent/src/transcript/rollover.ts, called from rollover.ts): the engine's session ends and the next turn starts a new one from the summary and the
     * messages after it. Always Vyre's own summary, never the engine's compact: Vyre owns the window.
     */
    async roll(req: CompactRequest, share: number, why: string): Promise<CompactResult> {
      let account: ResolvedAccount | null = null;
      try { account = await d.resolve({ threadId: req.threadId, agentId: req.agentId, askerId: req.asker }); } catch { account = null; }
      const s = await chatSettings(d.call, req.threadId, req.agentId, req.asker);
      const model = s.model ?? d.engine()?.agents(req.threadId).find((a) => a.id === req.agentId)?.model ?? null;
      const c = await vyre(req, model, account?.provider ?? null);
      const line = `Started a fresh session to keep the window from filling (it was ${Math.round(share * 100)}% full, ${why}). The summary and the latest messages carry over.${c.used !== null && c.window !== null ? ` Context now about ${k(c.used)} of ${k(c.window)} tokens.` : ""}`;
      await say(req, line);
      return { engine: account?.driver ?? "none", how: "vyre", line, context: c.used !== null && c.window !== null ? { used: c.used, window: c.window } : null, fellBack: false };
    },
    async run(req: CompactRequest): Promise<CompactResult> {
      let account: ResolvedAccount | null = null;
      try { account = await d.resolve({ threadId: req.threadId, agentId: req.agentId, askerId: req.asker }); } catch { account = null; }
      const engineId = account?.driver ?? "none";
      // the chat's own choice of model first (what the composer set), as the meter reads it
      const s = await chatSettings(d.call, req.threadId, req.agentId, req.asker);
      const model = s.model ?? d.engine()?.agents(req.threadId).find((a) => a.id === req.agentId)?.model ?? null;
      let fellBack: string | undefined;
      if (account && NATIVE_COMPACT.has(account.driver)) {
        const r = await native(req, account, s);
        if (r.ok) {
          const window = windowFor(model, account.provider);
          const used = r.after ?? (r.output > 0 ? r.output + ROLL.baseline : null);
          const msgs = d.engine()?.messages(req.threadId) ?? [];
          saveCompaction(d.db, { threadId: req.threadId, agentId: req.agentId, how: "engine", upToSeq: msgs.at(-1)?.threadSeq ?? 0, summary: "", keep: req.keep, used: used === null ? null : Math.min(window, used), window, at: d.now() });
          const line = compactLine({ keep: req.keep, used: used === null ? null : Math.min(window, used), window });
          await say(req, line);
          return { engine: engineId, how: "engine", line, context: used === null ? null : { used: Math.min(window, used), window }, fellBack: false };
        }
        const name = ENGINE_NAME[account.driver] ?? account.driver;
        fellBack = r.code === "engine.session_gone" ? `${name} no longer had this chat's session, so Vyre compacted it from the chat's summary.`
          : r.code === "engine.nothing_to_compact" ? `${name} had nothing of this chat yet, so Vyre compacted it from the chat's summary.`
          : `${name} could not compact it, so Vyre compacted it from the chat's summary.`;
      }
      const c = await vyre(req, model, account?.provider ?? null);
      const line = compactLine({ keep: req.keep, used: c.used, window: c.window, ...(fellBack ? { fellBack } : {}) });
      await say(req, line);
      return { engine: engineId, how: "vyre", line, context: c.used !== null && c.window !== null ? { used: c.used, window: c.window } : null, fellBack: fellBack !== undefined };
    },
  };
}
export type Compactor = ReturnType<typeof createCompactor>;

/**
 * Every turn after a compaction by Vyre is sent the summary and only the messages after it; every turn carries the chat's "Keep this every time" for the engine's automatic compaction. Sits inside
 * the turn context (withTurnContext), so it sees the sections and the history that wrapper set. A compaction by the engine itself changes nothing here: the engine holds its own summary.
 */
export function withCompaction(open: OpenSession, db: Db): OpenSession {
  return async (spec) => {
    const session = await open(spec);
    if (spec.tools === "none") return session;
    return Object.create(session, {
      send: {
        value: (input: TurnInput) => {
          if (input.compact) return session.send(input);
          let next = input;
          try {
            const keep = keepEvery(db, input.threadId);
            const c = lastCompaction(db, input.threadId, input.agent.id);
            if (keep !== "") next = { ...next, keep };
            if (c && c.how === "vyre") {
              const after = next.history.filter((m) => m.threadSeq > c.upToSeq);
              // the rolling summary ("earlier") covers what the summary of the compaction already holds, unless messages after it have gone out of the window shown word for word
              const shownAll = after.length < next.history.length || next.context?.keepHistory === undefined || next.history.length < next.context.keepHistory;
              // a turn whose context could not be built still gets the summary: without it the messages before the compaction would be gone for the engine
              const ctx = next.context ?? { sections: [], names: {} };
              const sections: ContextSection[] = ctx.sections.filter((s) => !(shownAll && s.id === "earlier"));
              if (c.summary !== "") sections.push({ id: "compacted", stable: false, once: true, text: c.summary });
              next = { ...next, context: { ...ctx, sections }, history: after };
            }
          } catch { /* a store that cannot be read leaves the turn as it was */ }
          return session.send(next);
        },
      },
    }) as EngineSession;
  };
}
