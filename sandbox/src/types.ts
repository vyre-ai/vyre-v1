// @vyre/sandbox (ARCH 6.6, spec 4.17, S8): where a person's CLI engine runs. A container on the Space host, a Seatbelt profile on a Mac, bwrap on Linux. Nothing here knows which engine runs
// inside; the engine drivers (P-L2_06) ask for a Sandbox, start a process in it and never touch the host directly.
export type SandboxKind = "docker" | "seatbelt" | "bwrap";

/** A folder of the person's the sandbox may see. `host` is a path on the machine running the sandbox; `guest` is where the process sees it (docker only; Seatbelt and bwrap use the host path). */
export interface Mount { host: string; guest?: string; mode: "ro" | "rw" }

export interface Limits { cpus: number; memoryMb: number; pids: number }
export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({ cpus: 2, memoryMb: 2048, pids: 512 });

export interface SandboxSpec {
  /** `vyre-sbx-<person>`: the name of the container, network and proxy, and the key of the credential directory. Lowercase letters, digits and dashes. */
  id: string;
  /** The person this sandbox runs for. Credentials are theirs. */
  person: string;
  kind: SandboxKind;
  /** Docker only. Default `vyre/person-sandbox:1`. */
  image?: string;
  /** The person's work folders, and nothing else of the machine's disk. */
  mounts: readonly Mount[];
  /** Seatbelt and bwrap: a directory only this sandbox writes to, besides the mounts. */
  scratch?: string;
  /** Hosts the process may reach, by name (`api.anthropic.com`, `*.openai.com`). Everything else is refused at the proxy. */
  egressHosts: readonly string[];
  limits?: Partial<Limits>;
  /** Extra environment. Proxy variables are set by the sandbox and cannot be overridden. */
  env?: Readonly<Record<string, string>>;
  /** The user inside. Default 10001:10001. Never 0. */
  user?: { uid: number; gid: number };
}

/** Where on this machine mounts and scratch may come from: the person's own folders. A mount outside these is refused. */
export interface Roots { work: readonly string[]; scratch: readonly string[] }

export interface ExecSpec {
  argv: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  /** Kill the process after this long. Default 10 minutes. */
  timeoutMs?: number;
}
export interface ExecResult { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }

export interface CredentialFile {
  /** Relative to the person's home inside the sandbox (`.claude/.credentials.json`) or to the credential directory. No `..`, no absolute path. */
  path: string;
  data: Uint8Array;
}

export interface Sandbox {
  readonly id: string;
  readonly kind: SandboxKind;
  /** Run a program to completion inside the sandbox. */
  exec(spec: ExecSpec): Promise<ExecResult>;
  /** Put credential files where the process can read them, in memory only (tmpfs), mode 0600. */
  putCredentials(files: readonly CredentialFile[]): Promise<void>;
  /** Overwrite and remove every credential file now. Called at the end of a session; `stop` does it too. */
  wipeCredentials(): Promise<void>;
  /** Stop everything: the process, the container, the network, the proxy, the credentials. Safe to call twice. */
  stop(): Promise<void>;
  /** Proxy variables a process started here must carry. */
  env(): Readonly<Record<string, string>>;
}

export class SandboxError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "SandboxError"; this.code = code; }
}
