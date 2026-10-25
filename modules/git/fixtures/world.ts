// A hand-built Ctx for the git tests: a real git binary run against temp directories, a scripted Vault filler, a scripted settings and github module,
// and a tiny ScopedDb that serves git_protection (the module's only table, read from its migration).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import type { EventName } from "../../../packages/contracts/src/types.ts";
import { configureGit, processExec } from "../handlers/ops.ts";
import type { Exec, ExecResult, GitDrivers } from "../handlers/ops.ts";

export const TRACE = "0123456789abcdef0123456789abcdef";
export const TOKEN = "ghs_Sup3rSecretInstallationToken0001";
export const MIGRATION = new URL("../migrations/0001_git_core.sql", import.meta.url);

type Row = Record<string, unknown>;

export interface Emitted { name: string; subject: string; payload: unknown }
export interface ExecCall { argv: string[]; env: Record<string, string> }

/** ScopedDb for git_protection only; any other statement fails loudly so a handler cannot quietly use a table the migration lacks. */
export class ProtectionDb {
  readonly rows = new Map<string, Row>();
  all(sql: string, ...args: unknown[]): unknown[] {
    if (sql === "SELECT * FROM git_protection WHERE folder_id = ?") {
      const row = this.rows.get(String(args[0]));
      return row ? [{ ...row }] : [];
    }
    throw new Error(`unsupported query: ${sql}`);
  }
  run(sql: string, ...args: unknown[]): { changes: number } {
    if (sql === "INSERT OR REPLACE INTO git_protection (folder_id, branches, updated_at) VALUES (?, ?, ?)") {
      this.rows.set(String(args[0]), { folder_id: args[0], branches: args[1], updated_at: args[2] });
      return { changes: 1 };
    }
    throw new Error(`unsupported statement: ${sql}`);
  }
}

export interface World {
  ctx: Ctx;
  as(principal: { kind: "person" | "agent" | "actor" | "service"; id: string }): Ctx;
  root: string;
  treesDir: string;
  remoteRoot: string;
  db: ProtectionDb;
  events: Emitted[];
  calls: { cap: string; input: unknown }[];
  execCalls: ExecCall[];
  filled: { handle: string; kind: string; ref: string }[];
  /** a failure to hand back for the next git command whose argv contains this word (the real git is not run) */
  failNext(word: string, result: ExecResult): void;
  /** the folder's working tree directory */
  tree(folderId: string): string;
  write(folderId: string, file: string, text: string): void;
  read(folderId: string, file: string): string;
  /** a bare repository at <remoteRoot>/site.git, reachable as https://example.test/acme/site.git and https://github.com/acme/site.git */
  bare(): Promise<string>;
  git(folderId: string, ...args: string[]): Promise<ExecResult>;
  eventsNamed(name: string): unknown[];
  cleanup(): void;
}

export function world(): World {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-git-"));
  const treesDir = path.join(root, "trees");
  const remoteRoot = path.join(root, "remote");
  fs.mkdirSync(treesDir, { recursive: true });
  fs.mkdirSync(remoteRoot, { recursive: true });
  const real = processExec();
  const execCalls: ExecCall[] = [];
  const failures: { word: string; result: ExecResult }[] = [];
  const tokens = new Map<string, string>();
  const events: Emitted[] = [];
  const calls: { cap: string; input: unknown }[] = [];
  const filled: { handle: string; kind: string; ref: string }[] = [];
  const db = new ProtectionDb();
  let clock = 1_760_000_000_000;

  const exec: Exec = async (argv, opts) => {
    execCalls.push({ argv: [...argv], env: { ...(opts?.env ?? {}) } });
    const at = failures.findIndex((f) => argv.includes(f.word));
    if (at >= 0) {
      const [hit] = failures.splice(at, 1);
      if (hit) return hit.result;
    }
    return real(argv, opts);
  };
  const drivers: GitDrivers = {
    exec,
    treesDir,
    env: {
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: `url.${remoteRoot}/.insteadOf`,
      GIT_CONFIG_VALUE_0: "https://example.test/acme/",
      GIT_CONFIG_KEY_1: `url.${remoteRoot}/.insteadOf`,
      GIT_CONFIG_VALUE_1: "https://github.com/acme/",
    },
    takeCredential(ref) {
      const v = tokens.get(ref);
      tokens.delete(ref);
      return v;
    },
  };
  configureGit(drivers);

  const base: Ctx = {
    space: "spc_test",
    principal: { kind: "person", id: "usr_maya" },
    trace: { traceId: TRACE, spanId: "0123456789abcdef" },
    origin: "ui",
    depth: 0,
    now: () => {
      clock += 1;
      return clock;
    },
    db,
    emit<T>(name: EventName, subject: string, payload: T): EventEnvelope<T> {
      events.push({ name, subject, payload });
      return {} as EventEnvelope<T>;
    },
    async call(cap, input) {
      calls.push({ cap, input });
      if (cap === "settings.get") return { row: { key: "git.protected_branches", value: ["main", "master"] } };
      if (cap === "github.installation_token") return { handle: "#GitHub_App_Token", expiresAt: clock + 3_600_000 };
      throw new Error(`unscripted call ${cap}`);
    },
    authorize: () => ({ effect: "allow", reason: "granted", decisionId: "dec_test" }),
    vault: {
      async fill(handle, into) {
        filled.push({ handle, kind: into.kind, ref: into.ref });
        if (into.kind === "git_credential") tokens.set(into.ref, TOKEN);
      },
      use: (handle) => ({ handle }),
    },
    http: async () => ({ status: 200, text: async () => "" }),
    log: { debug() {}, info() {}, warn() {}, error() {} },
    schedule: async () => "sch_test",
    seal: { seal: () => ({ keyId: "k", nonce: "n", bytes: "b" }), unseal: () => new Uint8Array() },
  };

  const tree = (folderId: string): string => path.join(treesDir, folderId);
  return {
    ctx: base,
    as: (principal) => ({ ...base, principal }),
    root,
    treesDir,
    remoteRoot,
    db,
    events,
    calls,
    execCalls,
    filled,
    failNext(word, result) { failures.push({ word, result }); },
    tree,
    write(folderId, file, text) {
      const full = path.join(tree(folderId), file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, text);
    },
    read: (folderId, file) => fs.readFileSync(path.join(tree(folderId), file), "utf8"),
    async bare() {
      const dir = path.join(remoteRoot, "site.git");
      fs.mkdirSync(dir, { recursive: true });
      await real(["git", "init", "--bare", "--quiet", dir]);
      await real(["git", "-C", dir, "symbolic-ref", "HEAD", "refs/heads/main"]);
      return dir;
    },
    git: (folderId, ...args) => real(["git", "-C", tree(folderId), "-c", "user.name=Test", "-c", "user.email=test@example.test", ...args], { env: { GIT_CONFIG_GLOBAL: "/dev/null" } }),
    eventsNamed: (name) => events.filter((e) => e.name === name).map((e) => e.payload),
    cleanup() {
      configureGit(null);
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
