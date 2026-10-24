// What the CLI needs from the process, as one object, so commands run unchanged under test.
import { nodePlatform } from "../platform/index.ts";
import type { Platform } from "../platform/index.ts";

export const EXIT = { OK: 0, FAILED: 1, USAGE: 2, NOT_RUNNING: 5 } as const;

export interface FetchResponse { status: number; ok: boolean; headers: { get(name: string): string | null }; text(): Promise<string> }
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<FetchResponse>;

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
  env: NodeJS.ProcessEnv;
  cwd: string;
  fetch: FetchLike;
  sleep(ms: number): Promise<void>;
  platform: Platform;
  now(): number;
  /** stdout is a terminal; decides pretty output */
  tty: boolean;
  /** give a child process the terminal (`vyre run`); false pipes its output through out/err */
  inherit?: boolean;
  /** start vyred detached and return its pid; tests start one in-process */
  spawnDaemon?(args: string[], logFile: string): { pid: number };
  /** send a signal to a pid; tests stop an in-process daemon instead */
  signal?(pid: number, sig: NodeJS.Signals): void;
  /** value for a vault handle, from the filler process */
  filler?(handle: string): Promise<string>;
}

export function processIo(): CliIo {
  return {
    out: (t) => { process.stdout.write(t); },
    err: (t) => { process.stderr.write(t); },
    env: process.env,
    cwd: process.cwd(),
    fetch: fetch as unknown as FetchLike,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    platform: nodePlatform(),
    now: Date.now,
    tty: Boolean(process.stdout.isTTY),
    inherit: true,
  };
}

export const line = (io: CliIo, text: string): void => io.out(`${text}\n`);
export const errLine = (io: CliIo, text: string): void => io.err(`${text}\n`);
