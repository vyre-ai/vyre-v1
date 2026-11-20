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
import type {
  ChatMode,
  DriverEvent,
  Effort,
  EngineSession,
  SessionSpec,
  StoredMessage,
  ToolResult,
  TurnInput,
} from "../../turn-engine/types.ts";
import { scrub } from "../api/errors.ts";
import { redact } from "./redact.ts";
import { classifyCli, missingProgram, modelGone, plainCli, sessionGone } from "./errors.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { hookFiles } from "./hooks-config.ts";
import { channel, lines } from "./lines.ts";
import type { Channel } from "./lines.ts";
import { defaultPrompt } from "./prompt.ts";
import type {
  CliAdapter,
  CliCheckpoint,
  CliDecoder,
  CliEvent,
  CliProcess,
  Launcher,
  McpEndpoint,
  NativePlugins,
} from "./types.ts";
import { TOKEN_ENV } from "./types.ts";
import { FIRST_TOKEN_CLI_MS, NO_FIRST_TOKEN_CODE, NO_FIRST_TOKEN_LINE, logNoFirstToken } from "../first-token.ts";
import type { NoFirstTokenLog } from "../first-token.ts";

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
  /** No text, thinking or tool event for this long after the prompt is written ends the turn with a plain line. Default FIRST_TOKEN_CLI_MS. */
  firstTokenMs?: number;
  /** Told when a turn hit the first-token deadline. Default: one line on stderr. */
  onNoFirstToken?: NoFirstTokenLog;
  /** The account the session runs on, for the log line only. */
  account?: string;
  /** Time a stopped process gets to leave before it is killed. Default 1500 ms. */
  graceMs?: number;
  /** Runs once when the session closes: releases the MCP session token. */
  onClose?: () => Promise<void> | void;
  /** The engine's session id changed: learned from the engine, or null when the one it was asked to resume was gone. The host keeps it so a later session resumes it. Never throws into the turn. */
  checkpoint?: (sessionId: string | null) => Promise<void> | void;
  /**
   * A background task of the engine (a helper it started in the background, a shell job) started, is on a step, or ended, at any time: in the turn that started it or long after that turn ended.
   * Never throws into the turn.
   */
  onTask?: (e: Extract<CliEvent, { type: "task" }>) => void;
  /** Every background task has ended and the turn that started them ended long before: the host wakes the agent, once. The engine usually wakes itself; the next turn then reads that. */
  onBackgroundDone?: () => void;
  /** How long a woken turn waits for the engine to continue by itself before it writes the wake message itself. Default 4 s. */
  attachMs?: number;
}

export interface CliSessionStats {
  spawns: number;
  resumes: number;
  turns: number;
}

export interface CliSession extends EngineSession {
  readonly pid: number | undefined;
  /** The handle the next session continues from. */
  checkpoint(): Promise<CliCheckpoint>;
  /** Start the process ahead of the first message (persistent engines only). */
  prewarm(): Promise<void>;
  stats(): CliSessionStats;
  /** How many background tasks of the engine are still running (helpers, shell jobs): such a session is not idle, whatever its last turn did. */
  readonly background: number;
}

type Item = CliEvent | { type: "eof" };

/** `resumed`: the engine session id this process was started to continue, or null for a new one. */
interface Run {
  proc: CliProcess;
  chan: Channel<Item>;
  decoder: CliDecoder;
  alive: boolean;
  resumed: string | null;
}

const ENGINE_NAME: Readonly<Record<string, string>> = { claude_code: "Claude Code", codex: "Codex", grok: "Grok" };
/** The one line a turn says when the engine's own session was gone and it started a new one. */
export const goneLine = (engine: string): string =>
  `${ENGINE_NAME[engine] ?? engine} no longer had this chat's session, so it started a new one from the chat's summary and recent messages.`;

const IDLE_MS = 10 * 60_000;
const GRACE_MS = 1_500;

function pause(ms: number): { done: Promise<false>; stop(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  return {
    done,
    stop: () => {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

export function createCliSession(deps: CliSessionDeps, spec: SessionSpec): CliSession {
  const a = deps.adapter;
  const graceMs = deps.graceMs ?? GRACE_MS;
  const idleMs = deps.idleMs ?? IDLE_MS;
  const firstTokenMs = deps.firstTokenMs ?? FIRST_TOKEN_CLI_MS;
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
  /** The background tasks the engine started and that have not ended (the id of the call that started each, and the engine's own id for it when known). */
  const open = new Map<string, string>();
  /** What the engine said after a turn ended and before the next turn read it (its own continuation when a background task ended), in order. */
  const held: Item[] = [];
  let tail: { stop: AbortController; done: Promise<void> } | null = null;
  /** The engine wakes itself when a task ends: its continuation is in `held` or on the way. Set when every task has ended; the next turn is the wake that reads it. */
  let attach = false;
  /** The engine is in the middle of a turn of its own that nobody asked for (seen from content lines without their end). */
  let midTurn = false;
  /** Results of turns the engine ran on its own that a turn written now must not take for its own end. */
  let skipEnds = 0;
  const attachMs = deps.attachMs ?? 4000;

  const secrets = (): string[] => [deps.endpoint.token];
  /** Hand the engine's session id to the host when it changed. A host that cannot keep it costs only the resume after a restart, never the turn. */
  function remember(id: string | null): void {
    if (id === saved) return;
    saved = id;
    try {
      void Promise.resolve(deps.checkpoint?.(id)).catch(() => undefined);
    } catch {
      /* as above */
    }
  }
  const clean = (text: string): string => redact(scrub(text, secrets()));

  const told = (e: Extract<CliEvent, { type: "task" }>): void => {
    try {
      deps.onTask?.(e);
    } catch {
      /* the host's bookkeeping never reaches the turn */
    }
  };
  /** Keep the list of running tasks from a task line or a launch result; true when this made the list empty. */
  function noteTask(item: Extract<CliEvent, { type: "task" }>): boolean {
    if (item.state === "start") {
      if (!open.has(item.id)) open.set(item.id, item.taskId);
      told(item);
      return false;
    }
    if (item.state === "progress") {
      told(item);
      return false;
    }
    const key = open.has(item.id)
      ? item.id
      : ([...open].find(([, t]) => t !== "" && t === item.taskId)?.[0] ?? item.id);
    const had = open.delete(key);
    told({ ...item, id: key });
    return had && open.size === 0;
  }

  /** Between turns the engine's lines still come: task lines are kept and told, the engine's own continuation is held for the turn that is the wake. */
  function watch(r: Run): void {
    const stop = new AbortController();
    /** One line the engine said between turns. True when the engine's process is gone and the watching is over. */
    const take = (item: Item): boolean => {
      if (item.type === "eof") {
        endAll();
        held.length = 0;
        return true;
      }
      if (item.type === "task") {
        if (noteTask(item)) {
          attach = true;
          try {
            deps.onBackgroundDone?.();
          } catch {
            /* as above */
          }
        }
        return false;
      }
      if (item.type === "tool" && item.phase === "result" && item.launched === true && !open.has(item.id))
        open.set(item.id, "");
      if (item.type === "end") {
        midTurn = false;
        // a reply of the engine to one helper's end while others still work is not the answer: it is dropped, so the person hears the engine once, when the last one is back
        if (open.size > 0 && !attach) {
          held.length = 0;
          return false;
        }
      } else if (item.type === "text" || item.type === "thinking" || item.type === "tool") midTurn = true;
      held.push(item);
      return false;
    };
    const done = (async () => {
      for (;;) {
        const item = await r.chan.next(60_000, stop.signal);
        if (item === null) break;
        if (item === "idle") continue;
        if (take(item)) return;
      }
      // a person's message came while the engine was answering a helper of its own: whatever it said up to this instant is read here, so the end of that reply is never taken for the end of the new turn
      const none = new AbortController().signal;
      while (r.chan.size > 0) {
        const item = await r.chan.next(0, none);
        if (item === null || item === "idle") break;
        if (take(item)) return;
      }
    })();
    tail = { stop, done };
  }
  async function unwatch(): Promise<void> {
    const t = tail;
    tail = null;
    if (t === null) return;
    t.stop.abort();
    await t.done;
  }

  async function pump(r: Run): Promise<void> {
    try {
      for await (const line of lines(r.proc.stdout)) for (const ev of r.decoder.push(redact(line))) r.chan.push(ev); // a held secret never reaches a decoded text, tool detail or error
    } catch {
      /* a broken pipe or an over-long line ends the run like an exit */
    }
    for (const ev of r.decoder.finish()) r.chan.push(ev);
    r.alive = false;
    r.chan.push({ type: "eof" });
  }

  async function start(): Promise<Run> {
    const argv = a.command({
      model: deps.model,
      resume: sessionId,
      mcpUrl: deps.endpoint.url,
      ...(deps.endpoint.stdio ? { mcpStdio: deps.endpoint.stdio } : {}),
      ...(deps.plugins ? { plugins: deps.plugins } : {}),
      planMode: deps.mode !== undefined ? deps.mode === "plan" : (deps.planMode?.() ?? false),
      ...(deps.mode !== undefined ? { mode: deps.mode } : {}),
      ...(deps.effort !== undefined ? { effort: deps.effort } : {}),
      ...(deps.noTools ? { noTools: true } : {}),
      workFolder: deps.workFolder,
      system: a.systemFlag || deps.lean === true ? deps.system : null,
      ...(deps.lean ? { lean: true } : {}),
    });
    // the hooks config of an engine that reads it from files (Grok, Codex): written before it starts, never a reason a turn does not run
    if (deps.endpoint.stdio && deps.workFolder !== null && !deps.lean && !deps.noTools) {
      try {
        for (const [file, text] of Object.entries(
          hookFiles(a.id, {
            workFolder: deps.workFolder,
            stdio: deps.endpoint.stdio,
            ...(deps.env["HOME"] ? { home: deps.env["HOME"] } : {}),
          }),
        )) {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, text);
        }
      } catch {
        /* the hooks of the engine's own tools are missing; Vyre's own tools are still covered */
      }
    }
    const proc = await deps.launcher.spawn({
      argv,
      ...(deps.workFolder !== null ? { cwd: deps.workFolder } : {}),
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
  /** The engine's process ended: the tasks it was running ended with it. */
  function endAll(): void {
    for (const [id, taskId] of [...open]) told({ type: "task", state: "end", id, taskId, ok: false, stopped: true });
    open.clear();
  }
  async function stop(r: Run, waitFirst: boolean): Promise<void> {
    if (run === r) run = null;
    try {
      await stopProcess(r, waitFirst);
    } finally {
      endAll();
    }
  }
  async function stopProcess(r: Run, waitFirst: boolean): Promise<void> {
    const leave = async (ms: number): Promise<boolean> => {
      const t = pause(ms);
      try {
        return await Promise.race([r.proc.exited.then(() => true), t.done]);
      } finally {
        t.stop();
      }
    };
    if (waitFirst && (await leave(graceMs))) {
      r.alive = false;
      return;
    }
    r.proc.kill("SIGTERM");
    if (await leave(graceMs)) {
      r.alive = false;
      return;
    }
    r.proc.kill("SIGKILL");
    await leave(graceMs);
    r.alive = false;
  }

  const label = (m: StoredMessage, asker: string): string =>
    m.author.kind === "person" && m.author.id === asker ? m.body : `${m.author.id}: ${m.body}`;

  /**
   * One engine turn. "gone": the process was started to resume a session the engine says is not there, and nothing was said yet; the caller starts over without it. `compacting`: the prompt is the
   * engine's compact command, and what the engine reports of the compaction is passed on as a `compacted` block.
   */
  async function* turn(
    prompt: string,
    asker: string,
    signal: AbortSignal,
    compacting = false,
    wake = false,
  ): AsyncGenerator<DriverEvent, "done" | "stop" | "gone"> {
    await unwatch();
    // a wake reads what the engine said by itself; any other turn starts clean (what was held was the engine's reply to a helper, not an answer to this)
    const woken = wake && attach;
    attach = false;
    if (!woken) held.length = 0;
    skipEnds = !woken && midTurn ? 1 : 0;
    // The engine may be answering a helper's end by itself when this message is written: what it says before it echoes this message (--replay-user-messages) is that reply, not this turn
    let beforeRead = !woken && a.id === "claude_code" && (open.size > 0 || midTurn);
    midTurn = false;
    let r: Run | null = a.persistent && run !== null && run.alive ? run : null;
    if (r === null) r = await start();
    if (signal.aborted) {
      await stop(r, false);
      return "stop";
    }
    const text =
      !compacting && !a.systemFlag && deps.lean !== true && !systemSent && deps.system !== null && deps.system !== ""
        ? `${deps.system}\n\n${prompt}`
        : prompt;
    systemSent = true;
    /** Something reached the person this turn: a gone session is then an error like any other, never a silent start-over. */
    let said = false;
    const gone = (message: string): boolean => r !== null && r.resumed !== null && !said && sessionGone(message);
    // Before the write: a steering message may be injected the moment the text is on its way, and it counts on top of this one.
    outstanding = 1;
    unread = a.steers && !woken ? ["first"] : [];
    // the engine wakes itself when its last background task ends: this turn is that continuation, and nothing is written. If it has not started within a few seconds, the wake is written here.
    let continues = false;
    if (woken && r.alive) {
      if (held.length > 0 || r.chan.size > 0) continues = true;
      else {
        const ac = new AbortController();
        const first = await r.chan.next(attachMs, ac.signal);
        if (first !== null && first !== "idle") {
          held.push(first);
          continues = true;
        }
      }
    }
    try {
      try {
        live = r;
        if (!continues)
          await r.proc.write(
            a.encode(
              woken
                ? `${text}\n\n(Vyre: every helper you started in the background has finished. Carry on with what they found.)`
                : text,
            ),
          );
      } catch {
        // A persistent process that died since it was last used: replace it once, resuming the engine's session.
        await stop(r, false);
        r = await start();
        live = r;
        // One that ends at once again (a session to resume the CLI no longer has) says why on stderr: that is read below with its end, not thrown from here.
        try {
          await r.proc.write(a.encode(text));
        } catch {
          /* read below */
        }
      }
      if (!a.persistent) r.proc.endInput();
      const wroteAt = Date.now();
      for (;;) {
        // Until the first text, thinking or tool event the deadline runs from the prompt: session, usage and limit lines do not keep a silent engine alive. A compact has its own pace.
        const left = said || compacting ? Infinity : firstTokenMs - (Date.now() - wroteAt);
        // which limit this wait runs to is decided here, by state, not by reading the clock again when it fires: a timer may fire a millisecond early on a busy computer, and a silent
        // engine must then hear the first-token line, never the idle one (CI fast-22, 12 Nov)
        const toFirstToken = left <= idleMs;
        const item = held.length > 0 ? held.shift()! : await r.chan.next(Math.min(idleMs, Math.max(1, left)), signal);
        if (item === null) return "stop";
        if (item === "idle" && !said && !compacting && toFirstToken) {
          (deps.onNoFirstToken ?? logNoFirstToken)({
            provider: a.id,
            model: deps.model ?? "",
            account: deps.account ?? "",
            waitedMs: Date.now() - wroteAt,
          });
          yield { type: "error", code: NO_FIRST_TOKEN_CODE, message: NO_FIRST_TOKEN_LINE };
          await stop(r, false);
          return "stop";
        }
        if (item === "idle") {
          yield { type: "error", code: "engine.timeout", message: "The engine stopped answering." };
          await stop(r, false);
          return "stop";
        }
        if (beforeRead && !["read", "task", "session", "limits", "mcp", "eof"].includes(item.type)) continue;
        switch (item.type) {
          case "session":
            sessionId = item.id;
            remember(item.id);
            break;
          case "compacted":
            if (compacting)
              yield {
                type: "block",
                kind: "compacted",
                payload: {
                  ...(item.before !== undefined ? { before: item.before } : {}),
                  ...(item.after !== undefined ? { after: item.after } : {}),
                },
              };
            break;
          case "mcp":
            if (item.status === "failed") {
              yield {
                type: "error",
                code: "engine.mcp_failed",
                message: "Vyre's tools did not connect to the engine.",
              };
              await stop(r, false);
              return "stop";
            }
            break;
          case "text":
            // the engine's own "issue with the selected model" line is an error told as an answer: it is not shown, and the error that follows moves the turn to another model
            if (item.text.length < 600 && modelGone(item.text)) break;
            said = true;
            yield { type: "text", text: item.text };
            break;
          case "thinking":
            said = true;
            yield { type: "thinking", text: item.text };
            break;
          case "task":
            noteTask(item);
            break;
          case "tool":
            said = true;
            if (item.phase === "result" && item.launched === true && !open.has(item.id)) open.set(item.id, "");
            if (item.phase === "said" || item.phase === "usage") {
              // a subagent's own words and use, on the existing tool-input block with the id of the call that started it: the host keeps them in the Run tree and never in the chat
              yield {
                type: "block",
                kind: "tool_input",
                payload:
                  item.phase === "said"
                    ? { id: item.id, parent: item.parent, said: item.text }
                    : {
                        id: item.id,
                        parent: item.parent,
                        usage: {
                          inputTokens: item.inputTokens,
                          outputTokens: item.outputTokens,
                          ...(item.cacheReadTokens !== undefined ? { cacheReadTokens: item.cacheReadTokens } : {}),
                          ...(item.model ? { model: item.model } : {}),
                        },
                      },
              };
              break;
            }
            yield item.phase === "call"
              ? {
                  type: "block",
                  kind: "tool_call",
                  payload: { id: item.id, name: item.name, ...(item.parent ? { parent: item.parent } : {}) },
                }
              : item.phase === "input"
                ? {
                    type: "block",
                    kind: "tool_input",
                    payload: { id: item.id, detail: item.detail, ...(item.parent ? { parent: item.parent } : {}) },
                  }
                : {
                    type: "block",
                    kind: "tool_result",
                    payload: {
                      id: item.id,
                      ok: item.ok,
                      ...(item.launched ? { launched: true } : {}),
                      ...(item.launched && item.name ? { name: item.name } : {}),
                      ...(item.launched && item.detail ? { title: item.detail } : {}),
                      ...(item.output ? { detail: item.output } : {}),
                      ...(item.parent ? { parent: item.parent } : {}),
                      ...(item.result ? { result: item.result } : {}),
                    },
                  };
            break;
          case "usage":
            yield {
              type: "usage",
              inputTokens: item.inputTokens,
              outputTokens: item.outputTokens,
              ...(item.model ? { model: item.model } : {}),
              ...(item.contextWindow !== undefined ? { contextWindow: item.contextWindow } : {}),
              ...(item.contextTokens !== undefined ? { contextTokens: item.contextTokens } : {}),
              ...(item.cacheReadTokens !== undefined ? { cacheReadTokens: item.cacheReadTokens } : {}),
              ...(item.cacheWriteTokens !== undefined ? { cacheWriteTokens: item.cacheWriteTokens } : {}),
              ...(item.reasoningTokens !== undefined ? { reasoningTokens: item.reasoningTokens } : {}),
              ...(item.costUsd !== undefined ? { costUsd: item.costUsd } : {}),
            };
            break;
          case "limits":
            yield {
              type: "limits",
              window: item.window,
              pct: item.pct,
              ...(item.resetsAt !== undefined ? { resetsAt: item.resetsAt } : {}),
            };
            break;
          case "read":
            beforeRead = false;
            unread.shift();
            break;
          case "end":
            if (skipEnds > 0) {
              // the end of a reply the engine made to a helper by itself, before this turn's message was read
              skipEnds -= 1;
              break;
            }
            outstanding -= 1;
            if (item.error) {
              if (gone(item.error.message)) {
                await stop(r, false);
                return "gone";
              }
              yield {
                type: "error",
                code: item.error.code ?? classifyCli(item.error.message),
                message: plainCli(clean(item.error.message)),
                ...(item.error.resetsAt !== undefined ? { resetsAt: item.error.resetsAt } : {}),
              };
              return "stop";
            }
            // A steering engine's result ends the turn every message it has read belongs to. A message it has not read yet is the start of its next turn, which ends with a result of its own: wait for that
            // one. Counting results per message instead is what left the agent waiting for a result the engine never sent when it folded a mid-turn message into the turn it was running.
            if (a.steers ? !unread.includes("steer") : outstanding <= 0) return "done";
            break;
          case "eof": {
            endAll();
            // stderr may still be arriving when stdout closes: the process is gone once both are.
            const t = pause(graceMs);
            try {
              await Promise.race([r.proc.exited, t.done]);
            } finally {
              t.stop();
            }
            const tail = clean(r.proc.stderrTail()).trim(); // stderr is cleaned here, so a secret in it is gone before it is classified or shown
            if (gone(tail)) return "gone";
            const absent = missingProgram(tail);
            if (absent !== null) {
              yield { type: "error", code: "engine.cli_missing", message: `${absent} is not installed here.` };
              return "stop";
            }
            yield {
              type: "error",
              code: classifyCli(tail),
              message: tail !== "" ? plainCli(tail) : "The engine ended before it answered.",
            };
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
    if (!a.compactCommand) {
      yield {
        type: "error",
        code: "engine.compact_unsupported",
        message: `${ENGINE_NAME[a.id] ?? a.id} has no compact Vyre can ask for.`,
      };
      return;
    }
    if (sessionId === null) {
      yield { type: "error", code: "engine.nothing_to_compact", message: "There is no engine session to compact yet." };
      return;
    }
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
    if (closed) {
      yield { type: "error", code: "engine.closed", message: "This session is closed." };
      return;
    }
    if (running) {
      yield { type: "error", code: "engine.busy", message: "This session is already answering." };
      return;
    }
    running = true;
    const ac = new AbortController();
    abort = ac;
    turns += 1;
    try {
      if (input.compact) {
        yield* compact(input.compact.keep, input.asker, ac.signal);
        return;
      }
      let fresh = sessionId === null;
      const build = (steered: readonly StoredMessage[]): string =>
        deps.prompt && steered.length === 0
          ? deps.prompt(input, { fresh })
          : defaultPrompt(input, fresh, steered, sentContext);
      const first = steer.splice(0, steer.length);
      let prompt = build(first);
      for (;;) {
        let outcome = yield* turn(prompt, input.asker, ac.signal, false, input.wake === true);
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
        prompt = steer
          .splice(0, steer.length)
          .map((m) => label(m, input.asker))
          .join("\n\n");
      }
      // the engine's turn is over but its helpers are not: what it says from now on is read here, between turns
      if (open.size > 0 && run !== null && run.alive && tail === null) watch(run);
      yield { type: "done" };
    } finally {
      running = false;
      if (abort === ac) abort = null;
    }
  }

  return {
    get warm() {
      return a.persistent ? run !== null && run.alive : sessionId !== null;
    },
    get pid() {
      return run?.proc.pid;
    },
    send: (input) => send(input),
    sendToolResult(_callId: string, _result: ToolResult) {
      /* tools run through MCP, not here */
    },
    // A message that arrives while a turn is running: an engine that steers reads it at its next step (written at once, see the header); any other waits for the turn to end and is then sent as the next
    // turn of this same send.
    inject(msg) {
      const r = live;
      if (a.steers && r !== null && r.alive) {
        // Mid-turn: written at once. A write that fails (the process just ended) falls back to the next turn.
        unread.push("steer");
        void r.proc.write(a.encode(label(msg, spec.asker))).catch(() => {
          const at = unread.lastIndexOf("steer");
          if (at >= 0) unread.splice(at, 1);
          steer.push(msg);
        });
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
    async checkpoint() {
      return { engine: a.id, sessionId };
    },
    async prewarm() {
      if (a.persistent && !closed && (run === null || !run.alive)) await start();
    },
    stats: () => ({ spawns, resumes, turns }),
    get background() {
      return open.size;
    },
  };
}
