// Site logs (r42-sites-run, slice 4): what a site printed, kept per deploy and per service, followed live, searched, and bounded.
// Pure code with no Docker and no database, so every rule here is tested alone. The runner feeds it (follower.ts), the store keeps it (store.ts), the handlers read it.
//   sources  app (the site's own output), requests (one line per request from the ingress), build (a deploy's build), jobs (a scheduled job's run)
//   caps     a line is cut at LINE_CHARS; a scope (one deploy, one service or one job run) keeps the newest LINES lines and BYTES bytes; a site keeps SCOPES scopes; what falls off is
//            counted, and a read says "N earlier lines left out" first, so a person never mistakes a cut log for a whole one

export type LogSource = "app" | "requests" | "build" | "jobs";
export const LOG_SOURCES: readonly LogSource[] = ["app", "requests", "build", "jobs"];
export type LogLevel = "error" | "warn" | "info";

export interface LogLine {
  /** grows by one for every line a ring takes, across scopes; a reader that has seq N asks for what came after it */
  seq: number;
  at: number;
  source: LogSource;
  /** a deployment id, a service name or a job run id: what the line belongs to */
  scope: string;
  text: string;
  level: LogLevel;
}

export interface LogCaps {
  lineChars: number;
  lines: number;
  bytes: number;
  scopes: number;
}
export const LOG_CAPS: LogCaps = { lineChars: 4000, lines: 5000, bytes: 2_000_000, scopes: 40 };

// every escape sequence (colour, cursor, window title, anything started by ESC), the C1 controls, bell and the other C0 controls except tab: none of it reaches a screen or a clipboard
const ANSI =
  /\u001b\[[0-9;?]*[ -\/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[ -\/]*[@-~]?|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/** One raw chunk (a Docker frame, a build line) as clean lines: no colour codes, no carriage returns, no blank lines, none longer than the cap. */
export function cleanLines(raw: string, lineChars: number = LOG_CAPS.lineChars): string[] {
  const out: string[] = [];
  for (const part of raw.split("\n")) {
    const t = part.replace(ANSI, "").replace(/\r/g, "").trimEnd();
    if (t.trim() === "") continue;
    out.push(t.length > lineChars ? `${t.slice(0, lineChars)}...` : t);
  }
  return out;
}

const ERROR = /error|fatal|panic|exception|traceback|uncaught|unhandled|segfault|\b(failed|oom|err)\b|\bE[A-Z]{4,}\b/i;
const WARN = /warn|\b(deprecated|retrying|timeout)\b/i;
/** The level a line reads as: what an app prints has no format, so the words decide. */
export function levelOf(text: string): LogLevel {
  if (ERROR.test(text)) return "error";
  if (WARN.test(text)) return "warn";
  return "info";
}

export interface LogQuery {
  /** words that must all appear (any case); "-word" must not; "quoted words" are one term */
  q?: string;
  source?: LogSource | readonly LogSource[];
  scope?: string;
  level?: LogLevel;
  from?: number;
  to?: number;
  /** only lines after this seq (a follower's cursor) */
  after?: number;
  /** the newest N matching lines (default 200, at most 1000) */
  limit?: number;
}

export interface Term {
  text: string;
  not: boolean;
}
/** The words of a search box: `timeout "db pool" -health` is three terms, the last one excluded. */
export function terms(q: string | undefined): Term[] {
  const out: Term[] = [];
  const re = /(-?)"([^"]+)"|(-?)(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q ?? "")) !== null) {
    const not = (m[1] ?? m[3]) === "-";
    const text = (m[2] ?? m[4] ?? "").toLowerCase();
    if (text !== "") out.push({ text, not });
  }
  return out;
}

export function matches(l: LogLine, q: LogQuery, ts: readonly Term[]): boolean {
  if (q.after !== undefined && l.seq <= q.after) return false;
  if (q.scope !== undefined && l.scope !== q.scope) return false;
  if (q.source !== undefined) {
    const s = typeof q.source === "string" ? [q.source] : q.source;
    if (!s.includes(l.source)) return false;
  }
  if (q.level !== undefined && l.level !== q.level) return false;
  if (q.from !== undefined && l.at < q.from) return false;
  if (q.to !== undefined && l.at > q.to) return false;
  if (ts.length > 0) {
    const low = l.text.toLowerCase();
    for (const t of ts) if (low.includes(t.text) === t.not) return false;
  }
  return true;
}

export const READ_MAX = 1000;
export const READ_DEFAULT = 200;
export function limitOf(n: number | undefined): number {
  return Math.max(1, Math.min(Math.trunc(n ?? READ_DEFAULT) || READ_DEFAULT, READ_MAX));
}

export interface ScopeInfo {
  scope: string;
  source: LogSource;
  lines: number;
  bytes: number;
  /** how many older lines fell off the cap */
  dropped: number;
  lastAt: number;
}

interface Bucket {
  info: ScopeInfo;
  lines: LogLine[];
}

/** The newest lines of a site, bounded as above. Memory only: the store persists what it hands out. */
export class LogRing {
  private seq = 0;
  private buckets = new Map<string, Bucket>();
  private caps: LogCaps;
  constructor(caps: LogCaps = LOG_CAPS) {
    this.caps = caps;
  }

  get lastSeq(): number {
    return this.seq;
  }

  /** Take raw text for a scope; returns the lines it made (none for blank text). */
  add(source: LogSource, scope: string, at: number, raw: string): LogLine[] {
    const made: LogLine[] = [];
    let b = this.buckets.get(scope);
    for (const text of cleanLines(raw, this.caps.lineChars)) {
      if (!b) {
        b = { info: { scope, source, lines: 0, bytes: 0, dropped: 0, lastAt: at }, lines: [] };
        this.buckets.set(scope, b);
        this.trimScopes(scope);
      }
      const l: LogLine = { seq: ++this.seq, at, source, scope, text, level: levelOf(text) };
      b.lines.push(l);
      b.info.lines++;
      b.info.bytes += text.length + 1;
      b.info.lastAt = at;
      while (b.lines.length > 0 && (b.info.lines > this.caps.lines || b.info.bytes > this.caps.bytes)) {
        const old = b.lines.shift() as LogLine;
        b.info.lines--;
        b.info.bytes -= old.text.length + 1;
        b.info.dropped++;
      }
      made.push(l);
    }
    return made;
  }

  /** Past the scope cap the scope that last printed longest ago goes whole: an old deploy's log leaves before a running service's. */
  private trimScopes(keep: string): void {
    while (this.buckets.size > this.caps.scopes) {
      let oldest: string | null = null;
      let at = Infinity;
      for (const [k, b] of this.buckets)
        if (k !== keep && b.info.lastAt < at) {
          at = b.info.lastAt;
          oldest = k;
        }
      if (oldest === null) return;
      this.buckets.delete(oldest);
    }
  }

  scopes(): ScopeInfo[] {
    return [...this.buckets.values()].map((b) => ({ ...b.info })).sort((a, b) => b.lastAt - a.lastAt);
  }

  /** The newest matching lines, oldest first, and how many older lines of the asked scope were cut (so the page can say so). */
  read(q: LogQuery = {}): { lines: LogLine[]; dropped: number; lastSeq: number } {
    const ts = terms(q.q);
    const want = limitOf(q.limit);
    const all: LogLine[] = [];
    for (const b of this.buckets.values()) {
      if (q.scope !== undefined && b.info.scope !== q.scope) continue;
      for (const l of b.lines) if (matches(l, q, ts)) all.push(l);
    }
    all.sort((a, b) => a.seq - b.seq);
    const dropped = q.scope !== undefined ? (this.buckets.get(q.scope)?.info.dropped ?? 0) : 0;
    return { lines: all.slice(-want), dropped, lastSeq: this.seq };
  }

  /** Forget a scope (a deploy's log when its deploy is removed). */
  drop(scope: string): void {
    this.buckets.delete(scope);
  }
}

/** The text a reader shows above a cut log. */
export function leftOut(dropped: number): string | null {
  return dropped > 0 ? `... ${dropped} earlier ${dropped === 1 ? "line" : "lines"} left out` : null;
}

/** Docker's `timestamps=1` puts an RFC 3339 time (nanoseconds) and a space in front of every line. */
export function parseStamped(line: string): { at: number; ns: string; text: string } | null {
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z (.*)$/s.exec(line);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}Z`);
  if (Number.isNaN(ms)) return null;
  const frac = (m[2] ?? "").padEnd(9, "0");
  return { at: ms + Number(frac.slice(0, 3)), ns: `${m[1]}.${frac}Z`, text: m[3] ?? "" };
}

export interface FollowerIO {
  /** the lines Docker printed since the given second, each with its timestamp in front */
  read(sinceSec: number): Promise<string[]>;
  sink(at: number, text: string): void;
}

/** Follows one container: ask for what came since the last line, hand over only lines not given before. A restart resumes from the cursor the store kept. */
export class LogFollower {
  /** the last timestamp handed over, with the lines already given at exactly that nanosecond */
  private lastNs = "";
  private atLast = new Set<string>();
  /** after a restart the lines given at the cursor's own nanosecond are not known, so none at that instant is given again (at most once, never twice) */
  private skipEqual = false;
  private io: FollowerIO;
  constructor(io: FollowerIO, cursor?: { ns: string }) {
    this.io = io;
    if (cursor) {
      this.lastNs = cursor.ns;
      this.skipEqual = cursor.ns !== "";
    }
  }
  get cursor(): { ns: string } {
    return { ns: this.lastNs };
  }
  /** One round; returns how many lines were new. A read that fails changes nothing, so the next round asks again. */
  async poll(): Promise<number> {
    const since = this.lastNs ? Math.floor(Date.parse(this.lastNs.replace(/\.\d+Z$/, "Z")) / 1000) : 0;
    const raw = await this.io.read(since);
    let n = 0;
    for (const r of raw) {
      const p = parseStamped(r);
      if (!p) continue;
      if (p.ns < this.lastNs) continue;
      if (p.ns === this.lastNs) {
        if (this.skipEqual || this.atLast.has(p.text)) continue;
      } else {
        this.lastNs = p.ns;
        this.atLast = new Set();
        this.skipEqual = false;
      }
      this.atLast.add(p.text);
      this.io.sink(p.at, p.text);
      n++;
    }
    return n;
  }
}

/** The values of a site's environment worth hiding in its log: eight characters or more, and not a plain setting. */
export function secretsOf(env: Readonly<Record<string, string>>): string[] {
  const plain = new Set([
    "PORT",
    "HOST",
    "HOSTNAME",
    "NODE_ENV",
    "PATH",
    "HOME",
    "PGHOST",
    "PGPORT",
    "PGUSER",
    "PGDATABASE",
    "LANG",
    "PWD",
    "PYTHONUNBUFFERED",
  ]);
  return [
    ...new Set(
      Object.entries(env)
        .filter(([k, v]) => !plain.has(k) && v.length >= 8)
        .map(([, v]) => v),
    ),
  ].sort((a, b) => b.length - a.length);
}

/** Every secret value replaced by bullets, so a log an agent reads never carries a key the app printed by mistake. */
export function mask(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const v of secrets) if (out.includes(v)) out = out.split(v).join("\u2022\u2022\u2022");
  return out;
}
