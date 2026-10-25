// One CLI engine session (ARCH 6.6): a headless CLI process attached to Vyre's MCP endpoint.
//
//   warm       a persistent engine (Claude Code) keeps one process for the whole session: the pool hands the same process to the next turn, so a resumed chat never pays the start-up again.
//              A one-shot engine (Codex, Grok) starts a process per turn that resumes the engine's own session id; "warm" there means the id is known.
//   tools      Vyre's tools reach the CLI over MCP and are run by the MCP server (access, Gate and audit happen there). The driver only shows the activity as blocks and never runs a tool
//              itself, so `sendToolResult` has nothing to do.
//   resume     the engine's session id is learned from its first event and kept; a process that died between turns, or a cancelled one, is replaced by one started with that id.
//   steering   a message injected during a turn goes to a persistent engine's stdin at once; for a one-shot engine it becomes the next turn of the same send.
//   cancel     the process is stopped (TERM, then KILL after the grace time). A cancelled session is dirty: the pool closes it instead of reusing it, and the next one resumes by id.
import type { DriverEvent, EngineSession, SessionSpec, StoredMessage, ToolResult, TurnInput } from "../../turn-engine/types.ts";
import { scrub } from "../api/errors.ts";
import { classifyCli } from "./errors.ts";
import { channel, lines } from "./lines.ts";
import type { Channel } from "./lines.ts";
import { defaultPrompt } from "./prompt.ts";
import type { CliAdapter, CliCheckpoint, CliDecoder, CliEvent, CliProcess, Launcher, McpEndpoint } from "./types.ts";
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
  prompt?: (input: TurnInput, ctx: { fresh: boolean }) => string;
  /** No output for this long ends the turn. Default 10 minutes. */
  idleMs?: number;
  /** Time a stopped process gets to leave before it is killed. Default 1500 ms. */
  graceMs?: number;
  /** Runs once when the session closes: releases the MCP session token. */
  onClose?: () => Promise<void> | void;
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

interface Run { proc: CliProcess; chan: Channel<Item>; decoder: CliDecoder; alive: boolean }

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
  let run: Run | null = null;
  let spawns = 0;
  let resumes = 0;
  let turns = 0;
  let closed = false;
  let running = false;
  let abort: AbortController | null = null;
  let outstanding = 0;
  let systemSent = deps.resume !== null;
  const steer: StoredMessage[] = [];

  const secrets = (): string[] => [deps.endpoint.token];
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
      model: deps.model, resume: sessionId, mcpUrl: deps.endpoint.url, ...(deps.endpoint.stdio ? { mcpStdio: deps.endpoint.stdio } : {}), planMode: deps.planMode?.() ?? false,
      workFolder: deps.workFolder, system: a.systemFlag ? deps.system : null,
    });
    const proc = await deps.launcher.spawn({
      argv, ...(deps.workFolder !== null ? { cwd: deps.workFolder } : {}),
      env: { ...a.env(), ...deps.env, [TOKEN_ENV]: deps.endpoint.token },
    });
    spawns += 1;
    if (sessionId !== null) resumes += 1;
    const r: Run = { proc, chan: channel<Item>(), decoder: a.decoder(), alive: true };
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

  async function* turn(prompt: string, asker: string, signal: AbortSignal): AsyncGenerator<DriverEvent, "done" | "stop"> {
    let r: Run | null = a.persistent && run !== null && run.alive ? run : null;
    if (r === null) r = await start();
    if (signal.aborted) { await stop(r, false); return "stop"; }
    const text = !a.systemFlag && !systemSent && deps.system !== null && deps.system !== "" ? `${deps.system}\n\n${prompt}` : prompt;
    systemSent = true;
    // Before the write: a steering message may be injected the moment the text is on its way, and it counts on top of this one.
    outstanding = 1;
    try {
      try { await r.proc.write(a.encode(text)); }
      catch {
        // A persistent process that died since it was last used: replace it once, resuming the engine's session.
        await stop(r, false);
        r = await start();
        await r.proc.write(a.encode(text));
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
          case "session": sessionId = item.id; break;
          case "mcp":
            if (item.status === "failed") {
              yield { type: "error", code: "engine.mcp_failed", message: "Vyre's tools did not connect to the engine." };
              await stop(r, false);
              return "stop";
            }
            break;
          case "text": yield { type: "text", text: item.text }; break;
          case "thinking": yield { type: "thinking", text: item.text }; break;
          case "tool":
            yield item.phase === "call"
              ? { type: "block", kind: "tool_call", payload: { id: item.id, name: item.name } }
              : { type: "block", kind: "tool_result", payload: { id: item.id, ok: item.ok } };
            break;
          case "usage": yield { type: "usage", inputTokens: item.inputTokens, outputTokens: item.outputTokens }; break;
          case "end":
            outstanding -= 1;
            if (item.error) {
              yield { type: "error", code: item.error.code ?? classifyCli(item.error.message), message: clean(item.error.message) };
              return "stop";
            }
            if (outstanding <= 0) return "done";
            break;
          case "eof": {
            // stderr may still be arriving when stdout closes: the process is gone once both are.
            const t = pause(graceMs);
            try { await Promise.race([r.proc.exited, t.done]); } finally { t.stop(); }
            const tail = clean(r.proc.stderrTail()).trim();
            yield { type: "error", code: classifyCli(tail), message: tail !== "" ? tail : "The engine ended before it answered." };
            return "stop";
          }
        }
      }
    } finally {
      // A one-shot engine's process ends with its turn; a persistent one stays for the next.
      if (!a.persistent && r) await stop(r, true);
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
      const fresh = sessionId === null;
      const build = (steered: readonly StoredMessage[]): string => (deps.prompt && steered.length === 0 ? deps.prompt(input, { fresh }) : defaultPrompt(input, fresh, steered));
      let prompt = build(steer.splice(0, steer.length));
      for (;;) {
        const outcome = yield* turn(prompt, input.asker, ac.signal);
        if (outcome === "stop") return;
        // One-shot engines take steering as the next turn of this send.
        if (a.persistent || steer.length === 0) break;
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
    inject(msg) {
      const r = run;
      if (running && a.persistent && r !== null && r.alive) {
        outstanding += 1;
        r.proc.write(a.encode(label(msg, spec.asker))).catch(() => { outstanding -= 1; steer.push(msg); });
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
