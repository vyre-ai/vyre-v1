// A hand-built Ctx for the runbooks tests: a fake files service (get, read, versions, list), a fake terminal module (open, open_server, run, interrupt) whose commands are scripted,
// fake agent computers, an in-memory database for the runbooks tables and a clock that ticks. Nothing here touches the host.

import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import { memoryDb } from "./db.ts";

type Row = Record<string, unknown>;

export const MIGRATION = new URL("../migrations/0001_runbooks.sql", import.meta.url);
export const TRACE = "0123456789abcdef0123456789abcdef";
export const ROOT = "fld_root";

export interface Version { id: string; text: string }
export interface FileSpec { id: string; name: string; folderId: string; versions: Version[] }
export interface Outcome { exitCode: number | null; output: string }
export interface Call { cap: string; input: Record<string, unknown> }

export interface World {
  ctx: Ctx;
  events: { name: string; subject: string; payload: unknown }[];
  calls: Call[];
  db: ReturnType<typeof memoryDb>;
  files: Map<string, FileSpec>;
  /** folder id to the folder ids inside it */
  folders: Map<string, string[]>;
  /** every command a block sent to terminal.run, in order */
  ran: { terminalId: string; command: string }[];
  /** what terminal.run answers; throw a VyreErr to make the terminal itself fail */
  script: (command: string, terminalId: string) => Promise<Outcome> | Outcome;
  computers: { computerId: string; agentId: string; state: string }[];
  /** false: a Personal Space, agent computers answer permission.needs_team */
  team: boolean;
  /** permission keys and file ids ctx.authorize refuses */
  denied: Set<string>;
  addFile(name: string, text: string, folderId?: string, fileId?: string, versionId?: string): string;
  edit(fileId: string, text: string, versionId?: string): string;
}

function err(code: "validation.not_found" | "permission.needs_team" | "permission.role_lacks_permission" | "provider.unavailable", message: string): VyreErr {
  return new VyreErr({ code, message, retryable: false, traceId: TRACE, next: [] });
}

export function world(): World {
  const db = memoryDb();
  const files = new Map<string, FileSpec>();
  const folders = new Map<string, string[]>();
  const events: World["events"] = [];
  const calls: Call[] = [];
  const ran: World["ran"] = [];
  const denied = new Set<string>();
  let clock = 1_760_000_000_000;
  let files_n = 0;
  let terminals = 0;
  const state: Pick<World, "script" | "computers" | "team"> = {
    script: (command) => (command.includes("FAIL") ? { exitCode: 2, output: "boom" } : { exitCode: 0, output: `ok: ${command.split("\n")[0] ?? ""}` }),
    computers: [],
    team: true,
  };
  const need = (id: unknown): FileSpec => {
    const f = typeof id === "string" ? files.get(id) : undefined;
    if (!f) throw err("validation.not_found", "That file does not exist.");
    return f;
  };
  const row = (f: FileSpec): Row => ({ fileId: f.id, folderId: f.folderId, name: f.name, version: f.versions.length });
  const ctx: Ctx = {
    space: "spc_test",
    principal: { kind: "person", id: "per_maya" },
    trace: { traceId: TRACE, spanId: "b".repeat(16) },
    origin: "user",
    depth: 0,
    now: () => {
      clock += 1;
      return clock;
    },
    db,
    emit: <T>(name: string, subject: string, payload: T): EventEnvelope<T> => {
      events.push({ name, subject, payload });
      return {
        seq: events.length, id: `evt_${events.length}`, type: name, sv: 1, hlc: String(clock), at: clock, traceId: TRACE, actor: "per_maya", depth: 0, label: 0, vis: "space", enc: 0, payload,
      };
    },
    call: async (cap: string, input: unknown): Promise<unknown> => {
      const i = (input ?? {}) as Record<string, unknown>;
      calls.push({ cap, input: i });
      switch (cap) {
        case "files.get": return { file: row(need(i.fileId)) };
        case "files.read": {
          const f = need(i.fileId);
          const at = typeof i.versionId === "string" ? f.versions.findIndex((v) => v.id === i.versionId) : f.versions.length - 1;
          const v = f.versions[at];
          if (!v) throw err("validation.not_found", "That version is not on this file.");
          return { text: v.text, mime: "text/markdown", size: v.text.length, version: at + 1, truncated: false };
        }
        case "files.versions": return { versions: need(i.fileId).versions.map((v, k) => ({ versionId: v.id, n: k + 1 })) };
        case "files.list": {
          if (i.section === "space") return { files: [], folders: [], total: 0 };
          const folder = typeof i.folder === "string" ? i.folder : ROOT;
          return {
            files: [...files.values()].filter((f) => f.folderId === folder).map(row),
            folders: (folders.get(folder) ?? []).map((folderId) => ({ folderId })),
            total: 0,
          };
        }
        case "terminal.open_server": {
          if (denied.has("server.services")) throw err("permission.role_lacks_permission", "No role of yours includes server.services.");
          return { terminal: { terminalId: `trm_${++terminals}` } };
        }
        case "terminal.open": {
          if (!state.team) throw err("permission.needs_team", "Agent computers are part of a Team Space.");
          return { terminal: { terminalId: `trm_${++terminals}` } };
        }
        case "terminal.run": {
          const terminalId = String(i.terminalId);
          const command = String(i.command);
          ran.push({ terminalId, command });
          const out = await state.script(command, terminalId);
          return { terminalId, exitCode: out.exitCode, output: out.output, truncated: false, durationMs: 5 };
        }
        case "terminal.interrupt": return { ok: true };
        case "computers.list": {
          if (!state.team) throw err("permission.needs_team", "Agent computers are part of a Team Space.");
          return { computers: state.computers };
        }
        default: throw new Error(`unexpected call ${cap}`);
      }
    },
    authorize: (action, resource) => ((action.perm !== null && denied.has(action.perm)) || (resource.id !== null && denied.has(resource.id))
      ? { effect: "deny", reason: "test", decisionId: "dec_deny" }
      : { effect: "allow", reason: "test", decisionId: "dec_test" }),
    vault: { fill: async () => {}, use: (handle: string) => ({ handle }) },
    http: async () => ({ status: 0, text: async () => "" }),
    log: { debug() {}, info() {}, warn() {}, error() {} },
    schedule: async () => "sch_test",
    seal: { seal: () => { throw new Error("seal is not used"); }, unseal: () => { throw new Error("seal is not used"); } },
  };
  const w: World = {
    ctx, events, calls, db, files, folders, ran, denied,
    get script() { return state.script; },
    set script(f) { state.script = f; },
    get computers() { return state.computers; },
    set computers(c) { state.computers = c; },
    get team() { return state.team; },
    set team(v) { state.team = v; },
    addFile(name, text, folderId = ROOT, fileId, versionId) {
      files_n += 1;
      const id = fileId ?? `fil_${files_n}`;
      files.set(id, { id, name, folderId, versions: [{ id: versionId ?? `ver_f${files_n}n1`, text }] });
      return id;
    },
    edit(fileId, text, versionId) {
      const f = need(fileId);
      const id = versionId ?? `ver_${f.id.replace(/\D/g, "")}n${f.versions.length + 1}`;
      f.versions.push({ id, text });
      return id;
    },
  };
  return w;
}

/** A runbook with three shell blocks, a python block, and headings for titles. */
export const RUNBOOK = [
  "# Deploy the site",
  "",
  "Some words.",
  "",
  "## Build",
  "```bash",
  "cd site",
  "npm run build",
  "```",
  "",
  "## Check",
  "```sh title=\"Smoke test\"",
  "curl -fsS localhost/health",
  "```",
  "",
  "```python",
  "print('not a shell block')",
  "```",
  "",
  "## Publish",
  "```bash",
  "./publish.sh",
  "```",
  "",
].join("\n");
