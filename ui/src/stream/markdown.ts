// Markdown for a message that is still being written. The text grows by a few characters a frame, so re-parsing all of it each time would cost more with every word. This parser works the other
// way: a block is final once a blank line (or a closing code fence) follows it; it is parsed once, kept as an immutable object, and never looked at again. Only the text after the last final
// block, the open block, is parsed again on each frame. Unfinished syntax (a `**` with no closing, a link without its `)`) stays plain text until it is finished, so half a word never shows as
// markup. Links are only http, https and mailto; nothing in a message can become HTML.

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong" | "em"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };

export type Block =
  | { kind: "p"; key: string; inline: Inline[] }
  | { kind: "h"; key: string; level: 1 | 2 | 3 | 4 | 5 | 6; inline: Inline[] }
  | { kind: "ul" | "ol"; key: string; start: number; items: Inline[][]; /** A checklist item: true ticked, false open; null a plain item. Present only when some item is a checklist item. */ checks?: (boolean | null)[] }
  | { kind: "table"; key: string; head: Inline[][]; align: ("left" | "center" | "right")[]; rows: Inline[][][] }
  | { kind: "quote"; key: string; inline: Inline[] }
  | { kind: "code"; key: string; lang: string; text: string; closed: boolean }
  | { kind: "hr"; key: string };

// ---- inline

const ESCAPABLE = /[\\`*_[\]()#+\-.!~>]/;
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const isWord = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isSpace = (c: string | undefined): boolean => c === undefined || c === "" || /\s/.test(c);

/** Inline markup: `code`, **strong**, *em* and _em_, [links](https://...). Anything unfinished is text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = (): void => {
    if (buf !== "") {
      out.push({ t: "text", v: buf });
      buf = "";
    }
  };
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (ch === "\\" && i + 1 < src.length && ESCAPABLE.test(src.charAt(i + 1))) {
      buf += src.charAt(i + 1);
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && src.charAt(i + 1) === ch && !isSpace(src.charAt(i + 2)) && !(ch === "_" && isWord(src.charAt(i - 1)))) {
      const end = src.indexOf(ch + ch, i + 2);
      if (end > i + 2 && !isSpace(src.charAt(end - 1))) {
        flush();
        out.push({ t: "strong", c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && !isSpace(src.charAt(i + 1)) && src.charAt(i + 1) !== ch && !(ch === "_" && isWord(src.charAt(i - 1)))) {
      let end = -1;
      for (let j = i + 2; j < src.length; j++) {
        if (src.charAt(j) !== ch || src.charAt(j + 1) === ch || src.charAt(j - 1) === ch || isSpace(src.charAt(j - 1))) continue;
        if (ch === "_" && isWord(src.charAt(j + 1))) continue;
        end = j;
        break;
      }
      if (end > i + 1) {
        flush();
        out.push({ t: "em", c: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const mid = src.indexOf("](", i + 1);
      const end = mid > i ? src.indexOf(")", mid + 2) : -1;
      if (mid > i + 1 && end > mid + 2) {
        const href = src.slice(mid + 2, end).trim();
        if (SAFE_HREF.test(href) && !/\s/.test(href)) {
          flush();
          out.push({ t: "link", href, c: parseInline(src.slice(i + 1, mid)) });
          i = end + 1;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

// ---- blocks

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;

const closes = (line: string, mark: string): boolean => {
  const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return m !== null && (m[1] ?? "").charAt(0) === mark.charAt(0) && (m[1] ?? "").length >= mark.length;
};

// ---- tables

/** The cells of a table row: split on pipes that are not escaped or inside code, without the pipe at either end. */
export function cells(row: string): string[] {
  let t = row.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const out: string[] = [];
  let cur = "";
  let tick = false;
  for (let i = 0; i < t.length; i++) {
    const c = t.charAt(i);
    if (c === "\\" && t.charAt(i + 1) === "|") { cur += "|"; i++; continue; }
    if (c === "`") tick = !tick;
    if (c === "|" && !tick) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** A separator row (|---|:--:|): every cell dashes with optional colons, as many cells as the header. Short dashes count only when the row is closed with its last pipe, so a row still being written is not one. */
export function isSeparator(row: string, columns: number): boolean {
  if (!row.includes("-")) return false;
  const cs = cells(row);
  if (cs.length !== columns || columns < 1) return false;
  if (!cs.every((c) => /^:?-+:?$/.test(c))) return false;
  return /\|\s*$/.test(row) || cs.every((c) => c.replace(/:/g, "").length >= 3);
}

const alignOf = (cell: string): "left" | "center" | "right" => (cell.startsWith(":") && cell.endsWith(":") && cell.length > 1 ? "center" : cell.endsWith(":") ? "right" : "left");
const fit = (row: string[], n: number): string[] => (row.length >= n ? row.slice(0, n) : [...row, ...Array<string>(n - row.length).fill("")]);

/** The blocks of a stretch of text with no blank line between them (or with one inside a code fence). `first` numbers their keys. `open` is true for text still being written: an unfinished last table row waits. */
export function parseChunk(text: string, first: number, open = false): Block[] {
  const blocks: Block[] = [];
  const key = (): string => `b${first + blocks.length}`;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; start: number; items: string[]; checks: (boolean | null)[] } | null = null;
  let quote: string[] = [];

  const endPara = (): void => {
    if (para.length > 0) blocks.push({ kind: "p", key: key(), inline: parseInline(para.join("\n")) });
    para = [];
  };
  const endList = (): void => {
    if (list) blocks.push({ kind: list.kind, key: key(), start: list.start, items: list.items.map(parseInline), ...(list.checks.some((c) => c !== null) ? { checks: list.checks } : {}) });
    list = null;
  };
  const endQuote = (): void => {
    if (quote.length > 0) blocks.push({ kind: "quote", key: key(), inline: parseInline(quote.join("\n")) });
    quote = [];
  };
  const endAll = (): void => {
    endPara();
    endList();
    endQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = FENCE.exec(line);
    if (fence) {
      endAll();
      const mark = fence[1] ?? "```";
      const body: string[] = [];
      let closed = false;
      for (i++; i < lines.length; i++) {
        const inner = lines[i] ?? "";
        if (closes(inner, mark)) {
          closed = true;
          break;
        }
        body.push(inner);
      }
      blocks.push({ kind: "code", key: key(), lang: fence[2] ?? "", text: body.join("\n"), closed });
      continue;
    }
    if (line.trim() === "") {
      endAll();
      continue;
    }
    const sepRow = lines[i + 1];
    if (line.includes("|") && sepRow !== undefined && isSeparator(sepRow, cells(line).length)) {
      // a table: this header row, the separator row under it, then rows while they have a pipe. A table starts only when its separator row is complete, so a half-written one stays text.
      endAll();
      const head = cells(line);
      const align = cells(sepRow).map(alignOf);
      const rows: Inline[][][] = [];
      let j = i + 2;
      for (; j < lines.length; j++) {
        const r = lines[j] ?? "";
        if (r.trim() === "" || !r.includes("|") || FENCE.test(r)) break;
        // while the message is still being written the last row may be unfinished: it waits for its closing pipe
        if (open && j === lines.length - 1 && !/\|\s*$/.test(r)) { j++; break; }
        rows.push(fit(cells(r), head.length).map(parseInline));
      }
      blocks.push({ kind: "table", key: key(), head: head.map(parseInline), align, rows });
      i = j - 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      endAll();
      blocks.push({ kind: "h", key: key(), level: (heading[1] ?? "#").length as 1 | 2 | 3 | 4 | 5 | 6, inline: parseInline(heading[2] ?? "") });
      continue;
    }
    if (RULE.test(line)) {
      endAll();
      blocks.push({ kind: "hr", key: key() });
      continue;
    }
    const ol = ORDERED.exec(line);
    const ul = ol ? null : BULLET.exec(line);
    if (ol || ul) {
      endPara();
      endQuote();
      const kind = ol ? "ol" : "ul";
      if (list && list.kind !== kind) endList();
      if (!list) list = { kind, start: ol ? Number(ol[2]) : 1, items: [], checks: [] };
      const raw = (ol ? ol[3] : ul?.[2]) ?? "";
      const task = ul ? /^\[([ xX])\]\s+(.*)$/.exec(raw) : null;
      list.items.push(task ? (task[2] ?? "") : raw);
      list.checks.push(task ? task[1] !== " " : null);
      continue;
    }
    const q = QUOTE.exec(line);
    if (q) {
      endPara();
      endList();
      quote.push(q[1] ?? "");
      continue;
    }
    if (list && /^\s+\S/.test(line)) {
      // An indented line continues the item above it.
      const last = list.items.length - 1;
      list.items[last] = `${list.items[last] ?? ""} ${line.trim()}`;
      continue;
    }
    endList();
    endQuote();
    para.push(line);
  }
  endAll();
  return blocks;
}

// ---- incremental

export interface MarkdownStats {
  /** Stretches parsed once, when they became final. */
  closedParses: number;
  /** Times the open block was parsed again (once per snapshot request after an append). */
  openParses: number;
  /** Characters the open block parses covered, summed: shows the cost follows the open block, not the whole message. */
  openChars: number;
}

export interface MarkdownView {
  /** Every block: the final ones first (the same objects as last time), then the open ones (new objects). */
  blocks: readonly Block[];
  /** How many of `blocks` are final. */
  closedCount: number;
}

export interface IncrementalMarkdown {
  append(text: string): void;
  /** The text is complete: the open block becomes final. */
  finish(): void;
  /** Forget everything (a new message). */
  reset(): void;
  view(): MarkdownView;
  readonly stats: Readonly<MarkdownStats>;
}

export function createIncrementalMarkdown(): IncrementalMarkdown {
  let closed: Block[] = [];
  let pending = "";
  let scanned = 0;
  let fence: string | null = null;
  let cached: MarkdownView | null = null;
  const stats: MarkdownStats = { closedParses: 0, openParses: 0, openChars: 0 };

  function closeChunk(end: number): void {
    const chunk = pending.slice(0, end);
    pending = pending.slice(scanned);
    scanned = 0;
    if (chunk.trim() === "") return;
    stats.closedParses++;
    closed = closed.concat(parseChunk(chunk, closed.length));
  }

  function scan(): void {
    for (;;) {
      const nl = pending.indexOf("\n", scanned);
      if (nl === -1) return;
      const lineStart = scanned;
      const line = pending.slice(lineStart, nl);
      scanned = nl + 1;
      if (fence !== null) {
        if (closes(line, fence)) {
          fence = null;
          closeChunk(scanned);
        }
        continue;
      }
      const open = FENCE.exec(line);
      if (open) {
        fence = open[1] ?? "```";
        continue;
      }
      if (line.trim() === "") closeChunk(lineStart);
    }
  }

  return {
    append(text) {
      if (text === "") return;
      pending += text;
      cached = null;
      scan();
    },
    finish() {
      if (pending.trim() !== "") {
        stats.closedParses++;
        closed = closed.concat(parseChunk(pending, closed.length));
      }
      pending = "";
      scanned = 0;
      fence = null;
      cached = null;
    },
    reset() {
      closed = [];
      pending = "";
      scanned = 0;
      fence = null;
      cached = null;
    },
    view() {
      if (cached) return cached;
      let open: Block[] = [];
      if (pending.trim() !== "") {
        stats.openParses++;
        stats.openChars += pending.length;
        open = parseChunk(pending, closed.length, true);
      }
      cached = { blocks: open.length === 0 ? closed : closed.concat(open), closedCount: closed.length };
      return cached;
    },
    stats,
  };
}
