// CLI engine drivers (ARCH 6.6, spec 4.14, 4.17): Claude Code, Codex and Grok Build run headless inside the person's sandbox and reach Vyre through one loopback MCP endpoint per session.
// The shapes here are engine neutral; each engine file maps its own command line and event stream to them. Nothing in this folder holds a key or a login: the sandbox puts the login
// where the CLI reads it (sandbox/src/creds.ts) and the session token travels in the environment, never in a command line or a file.
import type { SessionSpec } from "../../turn-engine/types.ts";
import type { ModelInfo } from "../api/types.ts";

export type CliId = "claude_code" | "codex" | "grok";
export const CLI_IDS: readonly CliId[] = ["claude_code", "codex", "grok"];

/** The environment variable that carries the MCP session token into the CLI process. The command line names it; it never holds the value. */
export const TOKEN_ENV = "VYRE_MCP_TOKEN";

/** One process to start. `env` is everything the process sees besides what the launcher itself adds (PATH and the like); the host's environment is never passed through. */
export interface LaunchSpec { argv: readonly string[]; cwd?: string; env: Readonly<Record<string, string>> }

export interface CliExit { code: number | null; signal: string | null }

export interface CliProcess {
  readonly pid: number | undefined;
  readonly stdout: AsyncIterable<Uint8Array | string>;
  write(data: string): Promise<void>;
  endInput(): void;
  /** Settles once the process has ended and its output is drained. */
  readonly exited: Promise<CliExit>;
  /** The last bytes the process wrote to stderr, for an error message. */
  stderrTail(): string;
  kill(signal?: "SIGTERM" | "SIGKILL"): void;
}

/** Starts a process where the sandbox says (a Seatbelt or bwrap wrapper locally; `docker exec` attach on the Space host). Wired by the host; tests wire a local one. */
export interface Launcher { spawn(spec: LaunchSpec): Promise<CliProcess> }

/** Where the CLI reaches Vyre: the loopback MCP server's address and this session's token. */
export interface McpEndpoint {
  url: string;
  token: string;
  /** Inside a sandbox the loopback port is out of reach: the engine runs `node <shim> <path>` as its MCP server and the shim talks to this unix socket (agent/src/mcp/socket.ts). `url` is then unused. */
  socket?: { path: string; shim: string };
}

export interface CommandOptions {
  model: string | null;
  /** The engine's own session id to continue, from a checkpoint. */
  resume: string | null;
  mcpUrl: string;
  /** Set when the engine reaches Vyre through the sandbox's socket and stdio shim instead of the URL. */
  mcpSocket?: { path: string; shim: string };
  planMode: boolean;
  /** A granted work folder: the CLI's own file tools come on and it works there. Null on a chat that runs Vyre tools only. */
  workFolder: string | null;
  /** Vyre's guide for this agent (AGENT.md and the rest), for engines that take it as a flag. */
  system: string | null;
}

/** What a decoder makes of one output line. The driver turns these into DriverEvents. */
export type CliEvent =
  | { type: "session"; id: string }
  | { type: "mcp"; status: "ok" | "failed"; detail?: string }
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  /** A tool the CLI ran itself (through MCP or one of its own). Vyre's tools were already run by the MCP server; this only shows the activity. */
  | { type: "tool"; phase: "call"; id: string; name: string }
  | { type: "tool"; phase: "result"; id: string; ok: boolean }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "end"; error?: { code?: string; message: string } };

export interface CliDecoder {
  /** One decoder per process: it may keep state. A line that is not JSON, or of a shape it does not know, yields nothing. */
  push(line: string): CliEvent[];
  /** The process ended: whatever the engine said last about a failure is returned, once, when no `end` was seen. */
  finish(): CliEvent[];
}

export interface CliAdapter {
  readonly id: CliId;
  readonly bin: string;
  /** True when one process serves many turns (messages on stdin); false when each turn is a process that resumes the engine's session. */
  readonly persistent: boolean;
  readonly models: readonly ModelInfo[];
  command(o: CommandOptions): string[];
  /** Fixed environment of the engine (switches that stop it reading the person's other tool configs). */
  env(): Record<string, string>;
  /** The bytes of one user message on stdin. */
  encode(prompt: string): string;
  /** Whether the engine takes the system text as a flag; if not the first prompt carries it. */
  readonly systemFlag: boolean;
  decoder(): CliDecoder;
}

/** What a session leaves behind so the next one continues it: the engine's session id. */
export interface CliCheckpoint { engine: CliId; sessionId: string | null }

export type { SessionSpec };
