// The retained output of a terminal command (lane r42-computer, the lead's rules of 19 Nov). What a command printed, already scrubbed by the Vault's scrubber, is kept per command so that a person or the agent
// can read a part of it later (the last lines, the lines that match a word, a range) and never the whole by default. Its rules:
//   scrubbed before it is stored: the text kept is the text the run answered, after every Vault value of the scope was taken out, and then through the transcript's secret shapes (keys, tokens, bearer headers,
//   passwords in URLs and flags, private keys: agent/src/transcript/sanitize.ts), so what a command printed that the Vault never knew is not kept either; it is scrubbed again on every read, so a value learned later is out too;
//   capped: CMD_CAP_BYTES per command (the oldest output is dropped and the cut is marked in the text and in `cutBytes`), AGENT_CAP_BYTES per agent (the oldest commands' logs go first);
//   kept for KEEP_MS after the command ended, then deleted; erased with the agent; it lives in the Space's data (the terminal module's tables), never in a cache;
//   read only by whoever may read that terminal, through terminal.log.list and terminal.log.read (the handlers check access); an answer is never the whole log: at most MAX_LINES lines and MAX_ANSWER_CHARS characters.
import { redact } from "../../agent/src/transcript/sanitize.ts";
import type { Db } from "./projections.ts";

export let CMD_CAP_BYTES = 5 * 1024 * 1024;
export let AGENT_CAP_BYTES = 200 * 1024 * 1024;
/** Tests: smaller caps (null puts the real ones back). */
export function setCmdLogCaps(c: { cmd: number; agent: number } | null): void {
  CMD_CAP_BYTES = c?.cmd ?? 5 * 1024 * 1024;
  AGENT_CAP_BYTES = c?.agent ?? 200 * 1024 * 1024;
}
export const KEEP_MS = 7 * 24 * 60 * 60_000;
export const MAX_LINES = 400;
export const DEFAULT_TAIL = 40;
export const MAX_ANSWER_CHARS = 20_000;
export const MAX_LINE_CHARS = 1000;
export const CUT_MARK = (n: number): string => `[earlier output cut: ${n} bytes]\n`;

type Row = Record<string, unknown>;
const bytesOf = (s: string): number => Buffer.byteLength(s, "utf8");

const BLOCK_BYTES = 64 * 1024;
const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r));

/** The last `cap` bytes of a text, from the start of a line and never inside a character. Returns the text and how many bytes were dropped. */
export function capTail(text: string, cap: number): { text: string; cut: number } {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= cap) return { text, cut: 0 };
  let from = buf.length - cap;
  const nl = buf.indexOf(0x0a, from);
  from = nl >= 0 ? nl + 1 : from;
  // never in the middle of a character: a UTF-8 continuation byte belongs to the one before it
  while (from < buf.length && ((buf[from] as number) & 0xc0) === 0x80) from += 1;
  return { text: buf.subarray(from).toString("utf8"), cut: from };
}

/** Where the block that starts at `at` ends: about BLOCK_BYTES on, at a line end; a private key block is never split (it goes on to its END line); a line longer than a block is split at a space. */
function blockEnd(text: string, at: number): number {
  if (text.length - at <= BLOCK_BYTES) return text.length;
  let end = at + BLOCK_BYTES;
  const nl = text.indexOf("\n", end);
  const lastNl = text.lastIndexOf("\n", end);
  if (lastNl > at) end = lastNl + 1;
  else if (nl >= 0 && nl - at <= 2 * BLOCK_BYTES) end = nl + 1;
  else {
    // one very long line: cut at a space near the window's end, else hard
    const sp = text.lastIndexOf(" ", end);
    end = sp > at + BLOCK_BYTES / 2 ? sp + 1 : end;
  }
  // a private key that begins in this block and ends after it keeps its end in the same block (no END anywhere: nothing to match, nothing to extend)
  const begin = text.lastIndexOf("-----BEGIN", end - 1);
  if (begin >= at) {
    const mark = text.indexOf("-----END", begin);
    if (mark >= end) {
      const eol = text.indexOf("\n", mark);
      end = eol >= 0 ? eol + 1 : text.length;
    }
  }
  return end;
}

/** The text through the transcript's secret shapes in blocks, the loop given back between blocks, so a big log never holds the daemon. */
export async function redactBlocks(text: string): Promise<string> {
  if (text.length <= BLOCK_BYTES) return redact(text).text;
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    const end = blockEnd(text, at);
    out.push(redact(text.slice(at, end)).text);
    at = end;
    if (at < text.length) await yieldLoop();
  }
  return out.join("");
}

/** Keep one command's output: cut to the per-command cap FIRST (the oldest goes), then scrubbed in blocks off the main loop, stored, and the agent's total brought under its cap by dropping its oldest logs. Returns what was kept. */
export async function keepCmdLog(
  db: Db,
  a: { seq: number; terminalId: string; agentId: string; personId: string; endedAt: number; output: string },
): Promise<{ bytes: number; cutBytes: number }> {
  // the cap first: the work below is bounded by what is kept, never by what a program printed
  const capped = capTail(a.output, CMD_CAP_BYTES);
  // secret shapes: a key the Vault never knew is not kept, and the size counted is what is kept
  const scrubbed = await redactBlocks(capped.text);
  // a scrubbed shape can be longer than what it replaced: the cap holds for what is kept
  const again = capTail(scrubbed, CMD_CAP_BYTES);
  let body = again.text;
  const cutBytes = capped.cut + again.cut;
  if (cutBytes > 0) body = CUT_MARK(cutBytes) + body;
  const bytes = bytesOf(body);
  db.run("DELETE FROM terminal_cmd_log WHERE seq = ?", a.seq);
  db.run(
    "INSERT INTO terminal_cmd_log (seq, terminal_id, agent_id, person_id, ended_at, bytes, cut_bytes, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    a.seq,
    a.terminalId,
    a.agentId,
    a.personId,
    a.endedAt,
    bytes,
    cutBytes,
    body,
  );
  // the agent's total: oldest first, never the one just kept
  for (;;) {
    const total = Number(
      (db.all("SELECT COALESCE(SUM(bytes), 0) AS n FROM terminal_cmd_log WHERE agent_id = ?", a.agentId) as Row[])[0]?.[
        "n"
      ] ?? 0,
    );
    if (total <= AGENT_CAP_BYTES) break;
    const old = (
      db.all(
        "SELECT seq FROM terminal_cmd_log WHERE agent_id = ? AND seq <> ? ORDER BY ended_at, seq LIMIT 1",
        a.agentId,
        a.seq,
      ) as Row[]
    )[0];
    if (!old) break;
    db.run("DELETE FROM terminal_cmd_log WHERE seq = ?", Number(old["seq"]));
  }
  return { bytes, cutBytes };
}

/** Logs whose command ended KEEP_MS ago or longer are deleted. How many went. */
export function expireCmdLogs(db: Db, now: number): number {
  return db.run("DELETE FROM terminal_cmd_log WHERE ended_at <= ?", now - KEEP_MS).changes;
}
/** Everything kept for an agent (it was deleted for good, or its folder was erased). How many went. */
export function eraseCmdLogsOfAgent(db: Db, agentId: string): number {
  return db.run("DELETE FROM terminal_cmd_log WHERE agent_id = ?", agentId).changes;
}
/** Everything kept for what a person's commands printed (they left the Space): the commands an agent ran for them included. How many went. */
export function eraseCmdLogsOfPerson(db: Db, personId: string): number {
  return db.run("DELETE FROM terminal_cmd_log WHERE person_id = ?", personId).changes;
}
/** Everything kept for a terminal that was erased. */
export function eraseCmdLogsOfTerminal(db: Db, terminalId: string): number {
  return db.run("DELETE FROM terminal_cmd_log WHERE terminal_id = ?", terminalId).changes;
}

export interface LogRow {
  seq: number;
  command: string;
  exitCode: number | null;
  startedAt: number;
  durationMs: number | null;
  bytes: number;
  cutBytes: number;
  kept: boolean;
}
/** The commands of a terminal, newest first, with whether their output is still kept. */
export function listCmdLogs(db: Db, terminalId: string, limit: number, now: number): LogRow[] {
  const rows = db.all(
    `SELECT c.seq AS seq, c.command AS command, c.exit_code AS exit_code, c.started_at AS started_at, c.duration_ms AS duration_ms,
            l.bytes AS bytes, l.cut_bytes AS cut_bytes
       FROM terminal_commands c LEFT JOIN terminal_cmd_log l ON l.seq = c.seq AND l.ended_at > ?
      WHERE c.terminal_id = ? ORDER BY c.seq DESC LIMIT ?`,
    // a log older than its week is gone to a reader even before the hourly pass deletes it
    now - KEEP_MS,
    terminalId,
    Math.max(1, Math.min(200, Math.floor(limit))),
  ) as Row[];
  return rows.map((r) => ({
    seq: Number(r["seq"]),
    command: String(r["command"]),
    exitCode: r["exit_code"] === null || r["exit_code"] === undefined ? null : Number(r["exit_code"]),
    startedAt: Number(r["started_at"]),
    durationMs: r["duration_ms"] === null || r["duration_ms"] === undefined ? null : Number(r["duration_ms"]),
    bytes: r["bytes"] === null || r["bytes"] === undefined ? 0 : Number(r["bytes"]),
    cutBytes: r["cut_bytes"] === null || r["cut_bytes"] === undefined ? 0 : Number(r["cut_bytes"]),
    kept: r["bytes"] !== null && r["bytes"] !== undefined,
  }));
}

export interface LogQuery {
  /** The last n lines (the default when nothing else is asked). */
  tail?: number;
  /** Lines that contain any of these words, case-insensitively, with `context` lines around each. */
  match?: readonly string[];
  context?: number;
  /** Lines from..to, 1-based and inclusive. */
  from?: number;
  to?: number;
}
export interface LogAnswer {
  lines: Array<{ n: number; text: string }>;
  totalLines: number;
  bytes: number;
  cutBytes: number;
  exitCode: number | null;
  /** More matched than the answer holds (the line limit or the size limit). */
  more: boolean;
}

/**
 * Part of one command's kept output, never the whole: the tail, the lines around matches of a word, or a range. `scrub` takes out every Vault value of the scope again. A line is cut at MAX_LINE_CHARS, an
 * answer holds at most MAX_LINES lines and MAX_ANSWER_CHARS characters, and when more would have matched `more` says so. Null when the command's output is not kept (never kept, expired, or erased).
 */
export function readCmdLog(
  db: Db,
  terminalId: string,
  seq: number,
  q: LogQuery,
  scrub: (text: string) => string,
  now: number,
): LogAnswer | null {
  const r = (
    db.all(
      `SELECT l.body AS body, l.bytes AS bytes, l.cut_bytes AS cut_bytes, c.exit_code AS exit_code
       FROM terminal_cmd_log l JOIN terminal_commands c ON c.seq = l.seq WHERE l.seq = ? AND l.terminal_id = ? AND l.ended_at > ?`,
      seq,
      terminalId,
      // a log older than its week reads as gone at once, even before the hourly pass deletes it
      now - KEEP_MS,
    ) as Row[]
  )[0];
  if (!r) return null;
  const all = scrub(String(r["body"])).split("\n");
  if (all.length > 0 && all[all.length - 1] === "") all.pop();
  const total = all.length;
  const cap = (n: number): number => Math.max(1, Math.min(MAX_LINES, Math.floor(n)));
  let picked: number[];
  if (q.match !== undefined && q.match.length > 0) {
    const words = q.match
      .slice(0, 5)
      .map((w) => w.slice(0, 200).toLowerCase())
      .filter((w) => w !== "");
    const ctx = Math.max(0, Math.min(5, Math.floor(q.context ?? 0)));
    const hit = new Set<number>();
    all.forEach((line, i) => {
      // lower-cased once per line, whatever the number of words
      const low = line.toLowerCase();
      if (words.some((w) => low.includes(w)))
        for (let k = Math.max(0, i - ctx); k <= Math.min(total - 1, i + ctx); k++) hit.add(k);
    });
    picked = [...hit].sort((a, b) => a - b);
  } else if (q.from !== undefined || q.to !== undefined) {
    const from = Math.max(1, Math.floor(q.from ?? 1));
    const to = Math.min(total, Math.floor(q.to ?? from + MAX_LINES - 1));
    picked = [];
    // only as many indexes as an answer can hold, never one per line of a huge log
    for (let n = from; n <= to && picked.length <= MAX_LINES; n++) picked.push(n - 1);
  } else {
    const n = cap(q.tail ?? DEFAULT_TAIL);
    picked = [];
    for (let i = Math.max(0, total - n); i < total; i++) picked.push(i);
  }
  let more = false;
  if (picked.length > MAX_LINES) {
    // matches and ranges keep their first lines; the tail keeps its last (it was bounded above)
    picked = picked.slice(0, MAX_LINES);
    more = true;
  }
  const lines: Array<{ n: number; text: string }> = [];
  let chars = 0;
  for (const i of picked) {
    const text = (all[i] ?? "").slice(0, MAX_LINE_CHARS);
    if (chars + text.length > MAX_ANSWER_CHARS) {
      more = true;
      break;
    }
    chars += text.length;
    lines.push({ n: i + 1, text });
  }
  return {
    lines,
    totalLines: total,
    bytes: Number(r["bytes"]),
    cutBytes: Number(r["cut_bytes"]),
    exitCode: r["exit_code"] === null || r["exit_code"] === undefined ? null : Number(r["exit_code"]),
    more,
  };
}
