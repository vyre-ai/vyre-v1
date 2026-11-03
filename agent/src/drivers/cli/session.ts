// One CLI engine session (ARCH 6.6): a headless CLI process attached to Vyre's MCP endpoint.
//
//   warm       a persistent engine (Claude Code) keeps one process for the whole session: the pool hands the same process to the next turn, so a resumed chat never pays the start-up again.
//              A one-shot engine (Codex, Grok) starts a process per turn that resumes the engine's own session id; "warm" there means the id is known.
//   tools      Vyre's tools reach the CLI over MCP and are run by the MCP server (access, Gate and audit happen there). The driver only shows the activity as blocks and never runs a tool
//              itself, so `sendToolResult` has nothing to do.
//   resume     the engine's session id is learned from its first event and kept; a process that died between turns, or a cancelled one, is replaced by one started with that id. Each new id is
//              handed to `checkpoint` (the host keeps it per chat), and a session opened after a restart or an eviction starts from it. When the engine says that session is not there any more, the
//              turn starts a new one from the chat's summary and recent messages and says so in one line.
//   compact    a turn whose input asks to compact sends the engine's own compact command (Claude Code's /compact with what to keep) to the session it holds and reports what the engine said.
//   steering   an engine that steers (Claude Code) gets a message injected during a turn written to its stdin at once: it reads it at its next step and answers it in the same turn, and says when it read it
//              (--replay-user-messages), so the turn ends at the engine's own result and is never left waiting for one that will not come. For the others (one-shot engines) the message waits for the turn to end and
//              becomes the next turn of the same send.
//   cancel     the process is stopped (TERM, then KILL after the grace time). A cancelled session is dirty: the pool closes it instead of reusing it, and the next one resumes by id.
import type { ChatMode, DriverEvent, Effort, EngineSession, SessionSpec, StoredMessage, ToolResult, TurnInput } from "../../turn-engine/types.ts";
import { scrub } from "../api/errors.ts";
import { classifyCli, missingProgram, sessionGone } from "./errors.ts";
import { channel, lines } from "./lines.ts";
import type { Channel } from "./lines.ts";
import { defaultPrompt } from "./prompt.ts";
import type { CliAdapter, CliCheckpoint, CliDecoder, CliEvent, CliProcess, Launcher, McpEndpoint, NativePlugins } from "./types.ts";
import { TOKEN_ENV } from "./types.ts";

export interface CliSessionDeps {
  adapter: CliAdapter;
  launcher: Launcher;
  endpoint: McpEndpoint;
  model: string | null;
  /** The engine's own session id to continue (from a checkpoint), or null for a new session. */
  resume: string | null;
  /** Vyre's guide for this agent. */
  system: string | null;
  /** The granted work folder; null on a chat that runs Vyre tools only. */
  workFolder: string | null;
  /** Extra environment from the sandbox (proxy variables). */
  env: Readonly<Record<string, string>>;
  planMode?: () => boolean;
  /** The chat's mode and the agent's effort this session was opened for (a different mode or effort opens a different session: the pool key holds both). */
  mode?: ChatMode;
  effort?: Effort;
  /** Plugins installed on the agent, for the CLI's own config. */
  plugins?: NativePlugins;
  /** No Vyre tools and none of the CLI's own (SessionSpec.tools "none"). */
  noTools?: boolean;
  /** The leanest command (SessionSpec.lean): `system` is the whole system prompt, given to the engine by flag (or config override) and never folded into the first prompt. */
  lean?: boolean;
  prompt?: (input: TurnInput, ctx: { fresh: boolean }) => string;
  /** No output for this long ends the turn. Default 10 minutes. */
  idleMs?: number;
  /** Time a stopped process gets to leave before it is killed. Default 1500 ms. */
  graceMs?: number;
  /** Runs once when the session closes: releases the MCP session token. */
  onClose?: () => Promise<void> | void;
  /** The engine's session id changed: learned from the engine, or null when the one it was asked to resume was gone. The host keeps it so a later session resumes it. Never throws into the turn. */
  checkpoint?: (sessionId: string | null) => Promise<void> | void;
}

export interface CliSessionStats { spawns: number; resumes: number; turns: number }

export interface CliSession extends EngineSession {
  readonly pid: number | undefined;
  /** The handle the next session continues from. */
  checkpoint(): Promise<CliCheckpoint>;
  /** Start the process ahead of the first message (persistent engines only). */
  prewarm(): Promise<void>;
  stats(): CliSessionStats;
}

type Item = CliEvent | { type: "eof" };

/** `resumed`: the engine session id this process was started to continue, or null for a new one. */
interface Run { proc: CliProcess; chan: Channel<Item>; decoder: CliDecoder; alive: boolean; resumed: string | null }

const ENGINE_NAME: Readonly<Record<string, string>> = { claude_code: "Claude Code", codex: "Codex", grok: "Grok" };
/** The one line a turn says when the engine's own session was gone and it started a new one. */
export const goneLine = (engine: string): string => `${ENGINE_NAME[engine] ?? engine} no longer had this chat's session, so it started a new one from the chat's summary and recent messages.`;

const IDLE_MS = 10 * 60_000;
const GRACE_MS = 1_500;

function pause(ms: number): { done: Promise<false>; stop(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), ms); });
  return { done, stop: () => { if (timer !== undefined) clearTimeout(timer); } };
}

export function createCliSession(deps: CliSessionDeps, spec: SessionSpec): CliSession {
  const a = deps.adapter;
  const graceMs = deps.graceMs ?? GRACE_MS;
  const idleMs = deps.idleMs ?? IDLE_MS;
  let sessionId = deps.resume;
  /** The id the host holds, so a checkpoint is only written when it changes. */
  let saved = deps.resume;
  let run: Run | null = null;
  let spawns = 0;
  let resumes = 0;
  let turns = 0;
  let closed = false;
  let running = false;
  let abort: AbortController | null = null;
  let outstanding = 0;
  /** A steering engine: what was written to the process and not yet read, in order ("first" is the turn's own message, "steer" an injected one), and the process a mid-turn write goes to (null between turns). */
  let unread: Array<"first" | "steer"> = [];
  let live: Run | null = null;
  let systemSent = deps.resume !== null;
  const steer: StoredMessage[] = [];
  /** The turn-context sections this engine session already holds (id to hash), so a resumed turn is sent only what changed. */
  const sentContext = new Map<string, string>();

  const secrets = (): string[] => [deps.endpoint.token];
  /** Hand the engine's session id to the host when it changed. A host that cannot keep it costs only the resume after a restart, never the turn. */
  function remember(id: string | null): void {
    if (id === saved) return;
    saved = id;
    try { void Promise.resolve(deps.checkpoint?.(id)).catch(() => undefined); } catch { /* as above */ }
  }
  const clean = (text: string): string => scrub(text, secrets());

  async function pump(r: Run): Promise<void> {
    try {
      for await (const line of lines(r.proc.stdout)) for (const ev of r.decoder.push(line)) r.chan.push(ev);
    } catch { /* a broken pipe or an over-long line ends the run like an exit */ }
    for (const ev of r.decoder.finish()) r.chan.push(ev);
    r.alive = false;
    r.chan.push({ type: "eof" });
  }

  async function start(): Promise<Run> {
    const argv = a.command({
      model: deps.model, resume: sessionId, mcpUrl: deps.endpoint.url, ...(deps.endpoint.stdio ? { mcpStdio: deps.endpoint.stdio } : {}), ...(deps.plugins ? { plugins: deps.plugins } : {}), planMode: deps.mode !== undefined ? deps.mode === "plan" : deps.planMode?.() ?? false, ...(deps.mode !== undefined ? { mode: deps.mode } : {}), ...(deps.effort !== undefined ? { effort: deps.effort } : {}), ...(deps.noTools ? { noTools: true } : {}),
      workFolder: deps.workFolder, system: a.systemFlag || deps.lean === true ? deps.system : null, ...(deps.lean ? { lean: true } : {}),
    });
    const proc = await deps.launcher.spawn({
      argv, ...(deps.workFolder !== null ? { cwd: deps.workFolder } : {}),
      env: { ...a.env(), ...deps.env, [TOKEN_ENV]: deps.endpoint.token },
    });
    spawns += 1;
    if (sessionId !== null) resumes += 1;
    const r: Run = { proc, chan: channel<Item>(), decoder: a.decoder(), alive: true, resumed: sessionId };
    void pump(r);
    run = r;
    return r;
  }

  /** End a process: TERM now, or after it has had `graceMs` to leave by itself; KILL if it is still there after another `graceMs`. */
  async function stop(r: Run, waitFirst: boolean): Promise<void> {
    if (run === r) run = null;
    const leave = async (ms: number): Promise<boolean> => {
      const t = pause(ms);
      try { return await Promise.race([r.proc.exited.then(() => true), t.done]); } finally { t.stop(); }
    };
    if (waitFirst && await leave(graceMs)) { r.alive = false; return; }
    r.proc.kill("SIGTERM");
    if (await leave(graceMs)) { r.alive = false; return; }
    r.proc.kill("SIGKILL");
    await leave(graceMs);
    r.alive = false;
  }

  const label = (m: StoredMessage, asker: string): string => (m.author.kind === "person" && m.author.id === asker ? m.body : `${m.author.id}: ${m.body}`);

  /**
   * One engine turn. "gone": the process was started to resume a session the engine says is not there, and nothing was said yet; the caller starts over without it. `compacting`: the prompt is the
   * engine's compact command, and what the engine reports of the compaction is passed on as a `compacted` block.
   */
  async function* turn(prompt: string, asker: string, signal: AbortSignal, compacting = false): AsyncGenerator<DriverEvent, "done" | "stop" | "gone"> {
    let r: Run | null = a.persistent && run !== null && run.alive ? run : null;
    if (r === null) r = await start();
    if (signal.aborted) { await stop(r, false); return "stop"; }
    const text = !compacting && !a.systemFlag && deps.lean !== true && !systemSent && deps.system !== null && deps.system !== "" ? `${deps.system}\n\n${prompt}` : prompt;
    systemSent = true;
    /** Something reached the person this turn: a gone session is then an error like any other, never a silent start-over. */
    let said = false;
    const gone = (message: string): boolean => r !== null && r.resumed !== null && !said && sessionGone(message);
    // Before the write: a steering message may be injected the moment the text is on its way, and it counts on top of this one.
    outstanding = 1;
    unread = a.steers ? ["first"] : [];
    try {
      try { live = r; await r.proc.write(a.encode(text)); }
      catch {
        // A persistent process that died since it was last used: replace it once, resuming the engine's session.
        await stop(r, false);
        r = await start();
        live = r;
        // One that ends at once again (a session to resume the CLI no longer has) says why on stderr: that is read below with its end, not thrown from here.
        try { await r.proc.write(a.encode(text)); } catch { /* read below */ }
      }
      if (!a.persistent) r.proc.endInput();
      for (;;) {
        const item = await r.chan.next(idleMs, signal);
        if (item === null) return "stop";
        if (item === "idle") {
          yield { type: "error", code: "engine.timeout", message: "The engine stopped answering." };
          await stop(r, false);
          return "stop";
        }
        switch (item.type) {
          case "session": sessionId = item.id; remember(item.id); break;
          case "compacted": if (compacting) yield { type: "block", kind: "compacted", payload: { ...(item.before !== undefined ? { before: item.before } : {}), ...(item.after !== undefined ? { after: item.after } : {}) } }; break;
          case "mcp":
            if (item.status === "failed") {
              yield { type: "error", code: "engine.mcp_failed", message: "Vyre's tools did not connect to the engine." };
              await stop(r, false);
              return "stop";
            }
            break;
          case "text": said = true; yield { type: "text", text: item.text }; break;
          case "thinking": said = true; yield { type: "thinking", text: item.text }; break;
          case "tool":
            said = true;
            yield item.phase === "call"
              ? { type: "block", kind: "tool_call", payload: { id: item.id, name: item.name } }
              : item.phase === "input"
                ? { type: "block", kind: "tool_input", payload: { id: item.id, detail: item.detail } }
                : { type: "block", kind: "tool_result", payload: { id: item.id, ok: item.ok } };
            break;
          case "usage": yield { type: "usage", inputTokens: item.inputTokens, outputTokens: item.outputTokens }; break;
          case "limits": yield { type: "limits", window: item.window, pct: item.pct, ...(item.resetsAt !== undefined ? { resetsAt: item.resetsAt } : {}) }; break;
          case "read": unread.shift(); break;
          case "end":
            outstanding -= 1;
            if (item.error) {
              if (gone(item.error.message)) { await stop(r, false); return "gone"; }
              yield { type: "error", code: item.error.code ?? classifyCli(item.error.message), message: clean(item.error.message) };
              return "stop";
            }
            // A steering engine's result ends the turn every message it has read belongs to. A message it has not read yet is the start of its next turn, which ends with a result of its own: wait for that
            // one. Counting results per message instead is what left the agent waiting for a result the engine never sent when it folded a mid-turn message into the turn it was running.
            if (a.steers ? !unread.includes("steer") : outstanding <= 0) return "done";
            break;
          case "eof": {
            // stderr may still be arriving when stdout closes: the process is gone once both are.
            const t = pause(graceMs);
            try { await Promise.race([r.proc.exited, t.done]); } finally { t.stop(); }
            const tail = clean(r.proc.stderrTail()).trim();
            if (gone(tail)) return "gone";
            const absent = missingProgram(tail);
            if (absent !== null) { yield { type: "error", code: "engine.cli_missing", message: `${absent} is not installed here.` }; return "stop"; }
            yield { type: "error", code: classifyCli(tail), message: tail !== "" ? tail : "The engine ended before it answered." };
            return "stop";
          }
        }
      }
    } finally {
      live = null;
      // A one-shot engine's process ends with its turn; a persistent one stays for the next.
      if (!a.persistent && r) await stop(r, true);
    }
  }

  /** The engine's own compact of the session it holds. Nothing to compact (no session yet) and a session the engine says is gone are errors the caller answers by compacting itself. */
  async function* compact(keep: string, asker: string, signal: AbortSignal): AsyncGenerator<DriverEvent> {
    if (!a.compactCommand) { yield { type: "error", code: "engine.compact_unsupported", message: `${ENGINE_NAME[a.id] ?? a.id} has no compact Vyre can ask for.` }; return; }
    if (sessionId === null) { yield { type: "error", code: "engine.nothing_to_compact", message: "There is no engine session to compact yet." }; return; }
    const outcome = yield* turn(a.compactCommand(keep), asker, signal, true);
    if (outcome === "gone") {
      sessionId = null;
      remember(null);
      systemSent = false;
      sentContext.clear();
      yield { type: "error", code: "engine.session_gone", message: goneLine(a.id) };
      return;
    }
    if (outcome === "done") {
      // the engine's context is now its summary: what it was sent of the turn context goes again on the next turn
      sentContext.clear();
      yield { type: "done" };
    }
  }

  async function* send(input: TurnInput): AsyncGenerator<DriverEvent> {
    if (closed) { yield { type: "error", code: "engine.closed", message: "This session is closed." }; return; }
    if (running) { yield { type: "error", code: "engine.busy", message: "This session is already answering." }; return; }
    running = true;
    const ac = new AbortController();
    abort = ac;
    turns += 1;
    try {
      if (input.compact) { yield* compact(input.compact.keep, input.asker, ac.signal); return; }
      let fresh = sessionId === null;
      const build = (steered: readonly StoredMessage[]): string => (deps.prompt && steered.length === 0 ? deps.prompt(input, { fresh }) : defaultPrompt(input, fresh, steered, sentContext));
      const first = steer.splice(0, steer.length);
      let prompt = build(first);
      for (;;) {
        let outcome = yield* turn(prompt, input.asker, ac.signal);
        if (outcome === "gone") {
          // The engine's own session is not there any more (its files went, or it never was): start a new one from the chat's summary and recent messages, and say so once.
          sessionId = null;
          remember(null);
          systemSent = false;
          sentContext.clear();
          fresh = true;
          yield { type: "block", kind: "turn_status", payload: { state: "note", text: goneLine(a.id) } };
          prompt = build(first);
          outcome = yield* turn(prompt, input.asker, ac.signal);
        }
        if (outcome !== "done") return;
        // Steering takes the next turn of this send.
        if (steer.length === 0) break;
        prompt = steer.splice(0, steer.length).map((m) => label(m, input.asker)).join("\n\n");
      }
      yield { type: "done" };
    } finally {
      running = false;
      if (abort === ac) abort = null;
    }
  }

  return {
    get warm() { return a.persistent ? run !== null && run.alive : sessionId !== null; },
    get pid() { return run?.proc.pid; },
    send: (input) => send(input),
    sendToolResult(_callId: string, _result: ToolResult) { /* tools run through MCP, not here */ },
    // A message that arrives while a turn is running: an engine that steers reads it at its next step (written at once, see the header); any other waits for the turn to end and is then sent as the next
    // turn of this same send.
    inject(msg) {
      const r = live;
      if (a.steers && r !== null && r.alive) {
        // Mid-turn: written at once. A write that fails (the process just ended) falls back to the next turn.
        unread.push("steer");
        void r.proc.write(a.encode(label(msg, spec.asker))).catch(() => { const at = unread.lastIndexOf("steer"); if (at >= 0) unread.splice(at, 1); steer.push(msg); });
        return;
      }
      steer.push(msg);
    },
    async cancel() {
      abort?.abort();
      const r = run;
      if (r) await stop(r, false);
    },
    async close() {
      if (closed) return;
      closed = true;
      abort?.abort();
      const r = run;
      if (r) await stop(r, false);
      await deps.onClose?.();
    },
    async checkpoint() { return { engine: a.id, sessionId }; },
    async prewarm() { if (a.persistent && !closed && (run === null || !run.alive)) await start(); },
    stats: () => ({ spawns, resumes, turns }),
  };
}
