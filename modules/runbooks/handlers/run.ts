// runbooks: markdown files whose fenced sh or bash blocks get Run buttons, a "Runs on" bar and Run all (spec 2.16 Runbooks, 2.7; ARCH 7.5).
//   parse / list / targets / set_target        what a runbook holds and where it runs
//   run                                        one block or all blocks, one after another in ONE terminal session on the chosen target; Run all stops at the first failure
//   runs.list / runs.get                       History (who, where, when, exit, duration) and the output of each block
//
// Where the shell happens: the terminal module. A run opens a session (the Space server, or an agent computer) and sends each block to it with terminal.run, so the blocks share a
// working folder and exports the way a person typing them would, the output is scrubbed by the terminal, and "Open terminal" shows the same session. The session id is kept on the run.
// A block's exit code is the exit code of its last command. A block whose command could not run at all (timeout, session gone) counts as failed with exit -1.
//
// The run is a Run of kind runbook: ctx.run is the run id when the host made one. The call returns when the run has ended; the run events (run_started, block_finished, run_finished)
// stream while it goes, and requestStop(runId) makes it stop after the block in progress and interrupts that block.

import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";

type Row = Record<string, unknown>;

const NEXT: Record<NextStep["kind"], string> = {
  retry: "Try again", switch_model: "Switch model", use_backup_key: "Use the backup key", ask_access: "Ask for access", open_settings: "Open settings",
  reconnect: "Reconnect", edit_input: "Fix the input", wait: "Wait a moment", contact_admin: "Contact an admin", report: "Report a problem",
};

function fail(ctx: Ctx, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code, message: message ?? def.what, retryable: def.retryable, traceId: ctx.trace.traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

const isNull = (v: unknown): boolean => v === null || v === undefined;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const rowsOf = (ctx: Ctx, sql: string, ...args: unknown[]): Row[] => ctx.db.all(sql, ...args) as Row[];

function rec(ctx: Ctx, input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input as Record<string, unknown>;
}

function reqStr(ctx: Ctx, o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

function optStr(ctx: Ctx, o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

/** Four hex digits that follow the code of a block (FNV-1a folded to 16 bits). An id, not a secret. */
function codeHash(code: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (((h >>> 16) ^ h) & 0xffff).toString(16).padStart(4, "0");
}

export function mint(prefix: string): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(9));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `${prefix}_${hex}`;
}

// ---- reading the markdown ----

export interface Block { blockId: string; index: number; lang: "sh" | "bash"; code: string; title?: string; line: number }

const OPEN = /^( {0,3})(`{3,}|~{3,})[ \t]*([^`]*)$/;
const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

/** The title in a fence's info string: title="Build the image", title='x', or the words after the language. */
function infoTitle(rest: string): string | undefined {
  const quoted = /\btitle\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest);
  if (quoted) return (quoted[1] ?? quoted[2] ?? "").trim() || undefined;
  const plain = rest.trim();
  return plain !== "" && !plain.includes("=") ? plain : undefined;
}

/**
 * The fenced sh and bash blocks of a markdown file, in order, with the first level-1 heading as the runbook's title. A block's title is the one in its info string, else the nearest
 * heading above it. Fences of other languages (and everything inside them, including fence lookalikes) are skipped; an unclosed fence runs to the end of the file; a block with no code is not a block.
 */
export function parseBlocks(text: string): { title?: string; blocks: Block[] } {
  const lines = text.split(/\r?\n/);
  const blocks: Block[] = [];
  let title: string | undefined;
  let heading: string | undefined;
  let fence: { char: string; len: number; indent: number; lang: string; rest: string; line: number; body: string[]; heading: string | undefined } | null = null;
  const close = (): void => {
    if (!fence) return;
    const code = fence.body.join("\n").replace(/\s+$/, "");
    const lang = fence.lang;
    if ((lang === "sh" || lang === "bash") && code.trim() !== "") {
      const index = blocks.length;
      const hash = codeHash(code);
      const block: Block = { blockId: `b${index}_${hash}`, index, lang, code, line: fence.line };
      const t = infoTitle(fence.rest) ?? fence.heading;
      if (t !== undefined) block.title = t;
      blocks.push(block);
    }
    fence = null;
  };
  lines.forEach((raw, i) => {
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(raw);
      if (closing && (closing[1] as string)[0] === fence.char && (closing[1] as string).length >= fence.len) close();
      else fence.body.push(raw.replace(new RegExp(`^ {0,${fence.indent}}`), ""));
      return;
    }
    const open = OPEN.exec(raw);
    if (open) {
      const marks = open[2] as string;
      const info = (open[3] as string).trim();
      const lang = (info.split(/\s+/)[0] ?? "").toLowerCase();
      fence = { char: marks[0] as string, len: marks.length, indent: (open[1] as string).length, lang, rest: info.slice(lang.length), line: i + 1, body: [], heading };
      return;
    }
    const h = HEADING.exec(raw);
    if (h) {
      heading = (h[1] as string).trim() || undefined;
      if (title === undefined && /^ {0,3}#[ \t]/.test(raw)) title = heading;
    }
  });
  close();
  return title === undefined ? { blocks } : { title, blocks };
}

// ---- files, through the files module ----

interface Source { text: string; versionId: string; name: string }

const MARKDOWN = /\.(md|markdown)$/i;

async function source(ctx: Ctx, fileId: string, versionId: string | undefined): Promise<Source> {
  const got = (await ctx.call("files.get", { fileId })) as { file?: { name?: unknown } };
  const name = typeof got.file?.name === "string" ? got.file.name : "";
  if (!MARKDOWN.test(name)) fail(ctx, "validation.precondition_failed", "A runbook is a markdown file (.md).", { fileId });
  const read = (await ctx.call("files.read", { fileId, as: "text", ...(versionId === undefined ? {} : { versionId }) })) as { text?: unknown; version?: unknown };
  if (typeof read.text !== "string") fail(ctx, "internal.unexpected", "The runbook could not be read.", { fileId });
  let resolved = versionId;
  if (resolved === undefined) {
    const list = (await ctx.call("files.versions", { fileId })) as { versions?: { versionId?: unknown; n?: unknown }[] };
    const hit = (list.versions ?? []).find((v) => Number(v.n) === Number(read.version));
    resolved = typeof hit?.versionId === "string" ? hit.versionId : "";
  }
  return { text: read.text, versionId: resolved, name };
}

// ---- targets ----

interface Target { kind: "server" | "computer"; computerId?: string }

function targetOf(ctx: Ctx, value: unknown, field: string): Target {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(ctx, "validation.bad_input", "The input is not valid.", { field });
  const o = value as Record<string, unknown>;
  if (o.kind !== "server" && o.kind !== "computer") return fail(ctx, "validation.bad_input", "The target is the server or an agent computer.", { field });
  const computerId = optStr(ctx, o, "computerId");
  if (o.kind === "computer" && computerId === undefined) return fail(ctx, "validation.bad_input", "Say which agent computer to run on.", { field: `${field}.computerId` });
  return computerId !== undefined && o.kind === "computer" ? { kind: "computer", computerId } : { kind: "server" };
}

function savedTarget(ctx: Ctx, fileId: string): Target | undefined {
  const row = rowsOf(ctx, "SELECT * FROM runbooks_target WHERE file_id = ?", fileId)[0];
  if (!row) return undefined;
  return row.kind === "computer" && !isNull(row.computer_id) ? { kind: "computer", computerId: String(row.computer_id) } : { kind: "server" };
}

const targetOut = (t: Target): { kind: "server" | "computer"; computerId?: string } => (t.computerId === undefined ? { kind: t.kind } : { kind: t.kind, computerId: t.computerId });

async function runbooksTargets(ctx: Ctx): Promise<{ targets: { target: { kind: "server" | "computer"; computerId?: string }; name: string; online: boolean }[] }> {
  const targets: { target: { kind: "server" | "computer"; computerId?: string }; name: string; online: boolean }[] = [];
  if (ctx.authorize({ perm: "server.services", level: "manage" }, { type: "space", id: null }).effect === "allow") {
    targets.push({ target: { kind: "server" }, name: "Space server", online: true });
  }
  try {
    const got = (await ctx.call("computers.list", {})) as { computers?: { computerId?: unknown; agentId?: unknown; state?: unknown; caption?: unknown }[] };
    for (const c of got.computers ?? []) {
      if (typeof c.computerId !== "string") continue;
      const state = String(c.state);
      targets.push({ target: { kind: "computer", computerId: c.computerId }, name: `Agent computer ${typeof c.agentId === "string" ? c.agentId : c.computerId}`, online: !["asleep", "error", "provisioning"].includes(state) });
    }
  } catch (e) {
    // a Personal Space has no agent computers; a computer the caller may not watch is not a target
    if (!(e instanceof VyreErr)) throw e;
  }
  return { targets };
}

async function runbooksSetTarget(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const target = targetOf(ctx, o.target, "target");
  const got = (await ctx.call("files.get", { fileId })) as { file?: { name?: unknown } };
  if (!MARKDOWN.test(typeof got.file?.name === "string" ? got.file.name : "")) fail(ctx, "validation.precondition_failed", "A runbook is a markdown file (.md).", { fileId });
  const now = ctx.now();
  const computerId = target.computerId ?? null;
  if (rowsOf(ctx, "SELECT * FROM runbooks_target WHERE file_id = ?", fileId)[0]) {
    ctx.db.run("UPDATE runbooks_target SET kind = ?, computer_id = ?, updated_at = ? WHERE file_id = ?", target.kind, computerId, now, fileId);
  } else {
    ctx.db.run("INSERT INTO runbooks_target (file_id, kind, computer_id, updated_at) VALUES (?, ?, ?, ?)", fileId, target.kind, computerId, now);
  }
  ctx.emit("runbook.target_set", `file/${fileId}`, { fileId, target: targetOut(target) });
  return { ok: true };
}

async function runbooksParse(ctx: Ctx, input: unknown): Promise<{ title?: string; blocks: Block[]; runsOn?: { kind: "server" | "computer"; computerId?: string } }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const src = await source(ctx, fileId, optStr(ctx, o, "versionId"));
  const parsed = parseBlocks(src.text);
  const out: { title?: string; blocks: Block[]; runsOn?: { kind: "server" | "computer"; computerId?: string } } = { blocks: parsed.blocks };
  if (parsed.title !== undefined) out.title = parsed.title;
  const saved = savedTarget(ctx, fileId);
  if (saved) out.runsOn = targetOut(saved);
  return out;
}

// ---- listing runbooks ----

const MAX_FOLDERS = 200;
const MAX_DEPTH = 5;
const MAX_FILES = 500;
const PAGE_MAX = 500;

type Listing = { files?: { fileId?: unknown; name?: unknown; folderId?: unknown }[]; folders?: { folderId?: unknown }[] };

async function markdownFiles(ctx: Ctx, folder: string | undefined): Promise<{ fileId: string; name: string; folderId: string }[]> {
  const found: { fileId: string; name: string; folderId: string }[] = [];
  const seen = new Set<string>();
  const queue: { folder: string | undefined; section?: "space"; depth: number }[] = folder === undefined ? [{ folder: undefined, depth: 0 }, { folder: undefined, section: "space", depth: 0 }] : [{ folder, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < MAX_FOLDERS && found.length < MAX_FILES) {
    const at = queue.shift() as { folder: string | undefined; section?: "space"; depth: number };
    visited += 1;
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      let got: Listing & { next?: unknown };
      try {
        got = (await ctx.call("files.list", { ...(at.folder === undefined ? (at.section ? { section: at.section } : {}) : { folder: at.folder }), limit: 200, ...(cursor === undefined ? {} : { cursor }) })) as Listing & { next?: unknown };
      } catch (e) {
        if (!(e instanceof VyreErr)) throw e;
        break;
      }
      for (const f of got.files ?? []) {
        if (typeof f.fileId === "string" && typeof f.name === "string" && MARKDOWN.test(f.name) && !seen.has(f.fileId)) {
          seen.add(f.fileId);
          found.push({ fileId: f.fileId, name: f.name, folderId: typeof f.folderId === "string" ? f.folderId : at.folder ?? "" });
        }
      }
      if (at.depth < MAX_DEPTH) for (const d of got.folders ?? []) if (typeof d.folderId === "string") queue.push({ folder: d.folderId, depth: at.depth + 1 });
      if (typeof got.next !== "string") break;
      cursor = got.next;
    }
  }
  return found;
}

async function runbooksList(ctx: Ctx, input: unknown): Promise<{ runbooks: { fileId: string; name: string; folderId: string; blocks: number; lastRunAt?: number; lastState?: string }[]; next?: string; total: number }> {
  const o = rec(ctx, input);
  const folder = optStr(ctx, o, "folder");
  const limit = typeof o.limit === "number" ? o.limit : 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "limit" });
  // A cursor is the offset the previous page named; one that is not a number starts again from the top.
  const cursor = optStr(ctx, o, "cursor");
  const offset = cursor !== undefined && /^[0-9]+$/.test(cursor) ? Number(cursor) : 0;
  const all: { fileId: string; name: string; folderId: string; blocks: number; lastRunAt?: number; lastState?: string }[] = [];
  for (const f of await markdownFiles(ctx, folder)) {
    let blocks = 0;
    try {
      blocks = parseBlocks((await source(ctx, f.fileId, undefined)).text).blocks.length;
    } catch (e) {
      if (!(e instanceof VyreErr)) throw e;
      continue;
    }
    if (blocks === 0) continue;
    const row: { fileId: string; name: string; folderId: string; blocks: number; lastRunAt?: number; lastState?: string } = { ...f, blocks };
    const last = rowsOf(ctx, "SELECT * FROM runbooks_run WHERE file_id = ?", f.fileId).sort((a, b) => num(b.at) - num(a.at))[0];
    if (last) {
      row.lastRunAt = num(last.at);
      row.lastState = String(last.state);
    }
    all.push(row);
  }
  all.sort((a, b) => a.name.localeCompare(b.name) || a.fileId.localeCompare(b.fileId));
  const out: { runbooks: typeof all; next?: string; total: number } = { runbooks: all.slice(offset, offset + limit), total: all.length };
  if (offset + limit < all.length) out.next = String(offset + limit);
  return out;
}

// ---- running ----

const DEFAULT_BLOCK_TIMEOUT_SEC = 600;
const MAX_OUTPUT_CHARS = 1_000_000;
const stops = new Set<string>();
const live = new Map<string, string>();

/** Ask a run to stop after the block in progress (the Run's Stop button). The block in progress gets Ctrl-C. */
export async function requestStop(ctx: Ctx, runId: string): Promise<boolean> {
  const terminalId = live.get(runId);
  if (terminalId === undefined) return false;
  stops.add(runId);
  try {
    await ctx.call("terminal.interrupt", { terminalId });
  } catch (e) {
    if (!(e instanceof VyreErr)) throw e;
  }
  return true;
}

async function openSession(ctx: Ctx, target: Target, fileName: string, runId: string): Promise<string> {
  const name = `Runbook ${fileName}`.slice(0, 80);
  const opened = (target.kind === "server"
    ? await ctx.call("terminal.open_server", { idempotencyKey: `runbooks.run:${runId}:open`, name })
    : await ctx.call("terminal.open", { idempotencyKey: `runbooks.run:${runId}:open`, host: "agent_computer", computerId: target.computerId, name })) as { terminal?: { terminalId?: unknown } };
  const id = opened.terminal?.terminalId;
  if (typeof id !== "string") return fail(ctx, "provider.unavailable", "The terminal did not open.");
  return id;
}

type BlockState = "queued" | "running" | "succeeded" | "failed" | "stopped";

async function runbooksRun(ctx: Ctx, input: unknown): Promise<{ runId: string }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const blockId = optStr(ctx, o, "blockId");
  const all = o.all === true;
  // Run all wins over a block id: a client that sends both means everything.
  if (blockId === undefined && !all) fail(ctx, "validation.bad_input", "Say which block to run, or run all.", { field: "blockId" });
  const src = await source(ctx, fileId, optStr(ctx, o, "versionId"));
  const blocks = parseBlocks(src.text).blocks;
  const chosen = all ? blocks : blocks.filter((b) => b.blockId === blockId);
  if (chosen.length === 0) {
    if (all) return fail(ctx, "validation.precondition_failed", "This runbook has no shell blocks to run.", { fileId });
    return fail(ctx, "validation.not_found", "That block is not in this version of the runbook.", { blockId });
  }
  const target = o.target === undefined || o.target === null ? savedTarget(ctx, fileId) : targetOf(ctx, o.target, "target");
  if (!target) return fail(ctx, "validation.precondition_failed", "Pick where this runbook runs: the server or an agent computer.", { fileId });

  const runId = ctx.run ?? mint("run");
  const terminalId = await openSession(ctx, target, src.name, runId);
  const startedAt = ctx.now();
  ctx.db.run(
    "INSERT INTO runbooks_run (run_id, file_id, version_id, by_principal, target_kind, computer_id, terminal_id, at, duration_ms, state, exit_code, all_blocks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    runId, fileId, src.versionId, ctx.principal.id, target.kind, target.computerId ?? null, terminalId, startedAt, null, "running", null, all ? 1 : 0,
  );
  chosen.forEach((b, i) => ctx.db.run("INSERT INTO runbooks_block (run_id, block_id, idx, exit_code, ms, state) VALUES (?, ?, ?, ?, ?, ?)", runId, b.blockId, i, null, null, "queued"));
  ctx.emit("runbook.run_started", `file/${fileId}`, { runId, fileId, target: targetOut(target), blocks: chosen.length, all, by: ctx.principal.id });
  ctx.log.info("runbooks.run", { runId, fileId, blocks: chosen.length });

  live.set(runId, terminalId);
  let seq = 0;
  let state: BlockState = "succeeded";
  let exit: number | null = null;
  let failedBlock: string | undefined;
  try {
    for (let i = 0; i < chosen.length; i++) {
      const b = chosen[i] as Block;
      if (stops.has(runId)) {
        state = "stopped";
        for (const rest of chosen.slice(i)) ctx.db.run("UPDATE runbooks_block SET exit_code = ?, ms = ?, state = ? WHERE run_id = ? AND block_id = ?", null, null, "stopped", runId, rest.blockId);
        break;
      }
      ctx.db.run("UPDATE runbooks_block SET exit_code = ?, ms = ?, state = ? WHERE run_id = ? AND block_id = ?", null, null, "running", runId, b.blockId);
      const t0 = ctx.now();
      let code = -1;
      let ms = 0;
      let text = "";
      try {
        const r = (await ctx.call("terminal.run", { idempotencyKey: `runbooks.run:${runId}:${b.blockId}`, command: b.code, terminalId, timeoutSec: DEFAULT_BLOCK_TIMEOUT_SEC })) as { exitCode?: unknown; output?: unknown; durationMs?: unknown };
        code = typeof r.exitCode === "number" ? r.exitCode : -1;
        ms = typeof r.durationMs === "number" ? r.durationMs : Math.max(0, ctx.now() - t0);
        text = typeof r.output === "string" ? r.output : "";
      } catch (e) {
        if (!(e instanceof VyreErr)) throw e;
        ms = Math.max(0, ctx.now() - t0);
        text = e.error.message;
      }
      if (text !== "") {
        seq += 1;
        ctx.db.run("INSERT INTO runbooks_output (run_id, block_id, seq, stream, text) VALUES (?, ?, ?, ?, ?)", runId, b.blockId, seq, code === 0 ? "stdout" : "stderr", text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) : text);
      }
      const ok = code === 0;
      ctx.db.run("UPDATE runbooks_block SET exit_code = ?, ms = ?, state = ? WHERE run_id = ? AND block_id = ?", code, ms, ok ? "succeeded" : "failed", runId, b.blockId);
      ctx.emit("runbook.block_finished", `file/${fileId}`, { runId, fileId, blockId: b.blockId, exit: code, ms });
      exit = code;
      if (!ok) {
        // Run all stops at the first failure: the blocks after it never start.
        state = "failed";
        failedBlock = b.blockId;
        for (const rest of chosen.slice(i + 1)) ctx.db.run("UPDATE runbooks_block SET exit_code = ?, ms = ?, state = ? WHERE run_id = ? AND block_id = ?", null, null, "stopped", runId, rest.blockId);
        break;
      }
    }
  } finally {
    live.delete(runId);
    stops.delete(runId);
  }
  const ms = Math.max(0, ctx.now() - startedAt);
  ctx.db.run("UPDATE runbooks_run SET duration_ms = ?, state = ?, exit_code = ? WHERE run_id = ?", ms, state, exit, runId);
  const done: Record<string, unknown> = { runId, fileId, state, ms };
  if (exit !== null) done.exit = exit;
  if (failedBlock !== undefined) done.failedBlock = failedBlock;
  ctx.emit("runbook.run_finished", `file/${fileId}`, done);
  return { runId };
}

// ---- history ----

interface RunOut {
  runId: string; fileId: string; versionId: string; by: string; target: { kind: "server" | "computer"; computerId?: string }; at: number; durationMs?: number; state: string; exit?: number; all: boolean;
  blocks: { blockId: string; exit?: number; ms?: number; state: string }[];
}

function runOut(ctx: Ctx, r: Row): RunOut {
  const blocks = rowsOf(ctx, "SELECT * FROM runbooks_block WHERE run_id = ?", String(r.run_id)).sort((a, b) => num(a.idx) - num(b.idx)).map((b) => {
    const out: RunOut["blocks"][number] = { blockId: String(b.block_id), state: String(b.state) };
    if (!isNull(b.exit_code)) out.exit = num(b.exit_code);
    if (!isNull(b.ms)) out.ms = num(b.ms);
    return out;
  });
  const out: RunOut = {
    runId: String(r.run_id), fileId: String(r.file_id), versionId: String(r.version_id), by: String(r.by_principal),
    target: r.target_kind === "computer" && !isNull(r.computer_id) ? { kind: "computer", computerId: String(r.computer_id) } : { kind: "server" },
    at: num(r.at), state: String(r.state), all: num(r.all_blocks) === 1, blocks,
  };
  if (!isNull(r.duration_ms)) out.durationMs = num(r.duration_ms);
  if (!isNull(r.exit_code)) out.exit = num(r.exit_code);
  return out;
}

async function runsList(ctx: Ctx, input: unknown): Promise<{ runs: RunOut[]; next?: string; total: number }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const state = optStr(ctx, o, "state");
  const limit = typeof o.limit === "number" ? o.limit : 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "limit" });
  const cursor = optStr(ctx, o, "cursor");
  const offset = cursor !== undefined && /^[0-9]+$/.test(cursor) ? Number(cursor) : 0;
  const rows = rowsOf(ctx, "SELECT * FROM runbooks_run WHERE file_id = ?", fileId)
    .filter((r) => state === undefined || r.state === state)
    .sort((a, b) => num(b.at) - num(a.at) || String(b.run_id).localeCompare(String(a.run_id)));
  const out: { runs: RunOut[]; next?: string; total: number } = { runs: rows.slice(offset, offset + limit).map((r) => runOut(ctx, r)), total: rows.length };
  if (offset + limit < rows.length) out.next = String(offset + limit);
  return out;
}

async function runsGet(ctx: Ctx, input: unknown): Promise<{ run: RunOut; output: { blockId: string; seq: number; stream: string; text: string }[]; next?: number }> {
  const o = rec(ctx, input);
  const runId = reqStr(ctx, o, "runId");
  const row = rowsOf(ctx, "SELECT * FROM runbooks_run WHERE run_id = ?", runId)[0];
  if (!row) return fail(ctx, "validation.not_found", "There is no such run.", { runId });
  // the run is read through its runbook: whoever may not open the file does not see its output
  if (ctx.authorize({ perm: null, level: "view" }, { type: "file", id: String(row.file_id) }).effect !== "allow") return fail(ctx, "permission.not_found", "There is no such run.", { runId });
  const blockId = optStr(ctx, o, "blockId");
  const after = typeof o.after === "number" ? o.after : 0;
  const output = rowsOf(ctx, "SELECT * FROM runbooks_output WHERE run_id = ?", runId)
    .filter((c) => num(c.seq) > after && (blockId === undefined || c.block_id === blockId))
    .sort((a, b) => num(a.seq) - num(b.seq))
    .map((c) => ({ blockId: String(c.block_id), seq: num(c.seq), stream: String(c.stream), text: String(c.text) }));
  const out: { run: RunOut; output: typeof output; next?: number } = { run: runOut(ctx, row), output };
  const last = output[output.length - 1];
  if (last) out.next = last.seq;
  return out;
}

export const runHandlers = {
  "runbooks.list": runbooksList,
  "runbooks.parse": runbooksParse,
  "runbooks.targets": runbooksTargets,
  "runbooks.set_target": runbooksSetTarget,
  "runbooks.run": runbooksRun,
  "runbooks.runs.list": runsList,
  "runbooks.runs.get": runsGet,
};
