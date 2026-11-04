// Markdown for a message that is still being written. The text grows by a few characters a frame, so re-parsing all of it each time would cost more with every word. This parser works the other
// way: a block is final once a blank line (or a closing code fence) follows it; it is parsed once, kept as an immutable object, and never looked at again. Only the text after the last final
// block, the open block, is parsed again on each frame. Unfinished syntax (a `**` with no closing, a link without its `)`) stays plain text until it is finished, so half a word never shows as
// markup. Links are only http, https and mailto; nothing in a message can become HTML.

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong" | "em" | "del"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] }
  /** A footnote reference, [^id]. */
  | { t: "fnref"; id: string }
  /** Inline math between single dollar signs. */
  | { t: "math"; v: string }
  | { t: "br" }
  /** The few inline HTML tags a reply may use: keyboard keys, sub- and superscript, a highlight. Nothing else becomes markup. */
  | { t: "html"; tag: "kbd" | "sub" | "sup" | "mark"; c: Inline[] };

/** What a ```chart block says: a small JSON spec, drawn by our own SVG charts. */
export interface ChartSpec {
  type: "bar" | "line" | "area" | "pie" | "scatter";
  title?: string;
  /** The x labels (bar, line, area), or the slice labels (pie). */
  labels?: string[];
  series: { name: string; data: (number | [number, number])[] }[];
  xLabel?: string;
  yLabel?: string;
}

export type Callout = "note" | "tip" | "important" | "warning" | "caution";

export type Block =
  | { kind: "p"; key: string; inline: Inline[] }
  | { kind: "h"; key: string; level: 1 | 2 | 3 | 4 | 5 | 6; inline: Inline[] }
  | { kind: "ul" | "ol"; key: string; start: number; items: Inline[][]; /** A checklist item: true ticked, false open; null a plain item. Present only when some item is a checklist item. */ checks?: (boolean | null)[] }
  | { kind: "table"; key: string; head: Inline[][]; align: ("left" | "center" | "right")[]; rows: Inline[][][] }
  | { kind: "callout"; key: string; variant: Callout; title: string; inline: Inline[] }
  | { kind: "details"; key: string; summary: Inline[]; open: boolean; blocks: Block[]; closed: boolean }
  | { kind: "img"; key: string; src: string; alt: string }
  | { kind: "fn"; key: string; id: string; inline: Inline[] }
  | { kind: "math"; key: string; text: string }
  | { kind: "mermaid"; key: string; text: string; closed: boolean }
  | { kind: "chart"; key: string; text: string; closed: boolean; spec: ChartSpec | null; error: string | null }
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
    // An internal reference address (https://ref.vyre.invalid/<kind>/<id>) is never text a person reads. Well formed or not, with its brackets or without, it becomes a link with no words of its own, which the
    // page draws as a chip with the item's name (or draws as nothing when it cannot): the raw address and the id never show. A half-written one waits.
    if (ch === "]" || ch === "(" || ch === "h" || ch === "H") {
      // the address is still being written: wait, show nothing of it
      const tail = src.slice(i).replace(/^\]?\s*\(?\s*/, "").toLowerCase();
      if (tail.length >= 8 && "https://ref.vyre.invalid/".startsWith(tail)) { flush(); i = src.length; continue; }
      const ref = /^\]?\s*\(?\s*(https:\/\/ref\.vyre\.invalid\/[^\s)\]]*)\s*\)?/i.exec(src.slice(i));
      if (ref && (ch !== "h" && ch !== "H" ? true : !isWord(src.charAt(i - 1)))) {
        const url = ref[1] ?? "";
        flush();
        if (/\/[a-z]+\/[\w-]{6,}$/i.test(url)) out.push({ t: "link", href: url, c: [{ t: "text", v: "\u200b" }] });
        i += ref[0].length;
        continue;
      }
    }
    if (ch === "<") {
      const tag = /^<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/.exec(src.slice(i));
      if (tag) {
        const name = (tag[2] ?? "").toLowerCase();
        const full = tag[0];
        if (name === "br") { flush(); out.push({ t: "br" }); i += full.length; continue; }
        if (tag[1] === "/") { i += full.length; continue; }
        if (name === "script" || name === "style") {
          const close = src.toLowerCase().indexOf(`</${name}`, i + full.length);
          const gt = close >= 0 ? src.indexOf(">", close) : -1;
          i = gt >= 0 ? gt + 1 : src.length;
          continue;
        }
        if (name === "kbd" || name === "sub" || name === "sup" || name === "mark") {
          const close = src.toLowerCase().indexOf(`</${name}>`, i + full.length);
          if (close > 0) { flush(); out.push({ t: "html", tag: name, c: parseInline(src.slice(i + full.length, close)) }); i = close + name.length + 3; continue; }
        }
        const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(src.slice(i));
        if (auto) { flush(); out.push({ t: "link", href: auto[1] ?? "", c: [{ t: "text", v: auto[1] ?? "" }] }); i += auto[0].length; continue; }
        // any other tag is dropped; the words inside it stay
        i += full.length;
        continue;
      }
    }
    if (ch === "~" && src.charAt(i + 1) === "~" && !isSpace(src.charAt(i + 2))) {
      const end = src.indexOf("~~", i + 2);
      if (end > i + 2 && !isSpace(src.charAt(end - 1))) { flush(); out.push({ t: "del", c: parseInline(src.slice(i + 2, end)) }); i = end + 2; continue; }
    }
    if (ch === "$" && src.charAt(i + 1) !== "$" && !isSpace(src.charAt(i + 1)) && !isWord(src.charAt(i - 1))) {
      const end = src.indexOf("$", i + 1);
      if (end > i + 1 && !isSpace(src.charAt(end - 1)) && !/\d/.test(src.charAt(end + 1)) && !src.slice(i + 1, end).includes("\n")) { flush(); out.push({ t: "math", v: src.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (ch === "[" && src.charAt(i + 1) === "^") {
      const fn = /^\[\^([\w-]+)\]/.exec(src.slice(i));
      if (fn) { flush(); out.push({ t: "fnref", id: fn[1] ?? "" }); i += fn[0].length; continue; }
    }
    if ((ch === "h" || ch === "H") && !isWord(src.charAt(i - 1)) && src.slice(i - 2, i) !== "](" && /^https?:\/\//i.test(src.slice(i, i + 8))) {
      const m = /^https?:\/\/[^\s<>[\]]+/i.exec(src.slice(i));
      if (m) {
        let url = m[0];
        while (/[.,;:!?)\]]$/.test(url) && !(url.endsWith(")") && url.includes("("))) url = url.slice(0, -1);
        if (url.length > 8) { flush(); out.push({ t: "link", href: url, c: [{ t: "text", v: url }] }); i += url.length; continue; }
      }
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

// ---- charts

const CHART_TYPES = new Set(["bar", "line", "area", "pie", "scatter"]);
const MAX_POINTS = 600;

/** A ```chart block is a small JSON spec. Anything that is not one is an error line the reply shows above the source, never a crash. */
export function parseChartSpec(text: string): { ok: true; spec: ChartSpec } | { ok: false; error: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return { ok: false, error: `The chart is not valid JSON (${e instanceof Error ? e.message.replace(/^JSON\.parse: /, "") : "parse error"}).` }; }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "A chart is a JSON object with a type and series." };
  const o = raw as Record<string, unknown>;
  const type = typeof o["type"] === "string" ? o["type"].toLowerCase() : "";
  if (!CHART_TYPES.has(type)) return { ok: false, error: `A chart type is one of bar, line, area, pie or scatter (got ${JSON.stringify(o["type"] ?? null)}).` };
  const labels = Array.isArray(o["labels"]) ? o["labels"].map((l) => String(l)) : undefined;
  let series: ChartSpec["series"] = [];
  if (Array.isArray(o["series"])) {
    for (const [i, s0] of o["series"].entries()) {
      const so = (typeof s0 === "object" && s0 !== null ? s0 : {}) as Record<string, unknown>;
      const data = Array.isArray(so["data"]) ? so["data"] : Array.isArray(s0) ? (s0 as unknown[]) : null;
      if (!data) return { ok: false, error: `Series ${i + 1} has no data list.` };
      const pts: (number | [number, number])[] = [];
      for (const d of data) {
        if (typeof d === "number" && Number.isFinite(d)) pts.push(d);
        else if (Array.isArray(d) && d.length === 2 && d.every((n) => typeof n === "number" && Number.isFinite(n))) pts.push([d[0] as number, d[1] as number]);
        else return { ok: false, error: `Series ${i + 1} holds a value that is not a number: ${JSON.stringify(d)}.` };
      }
      series.push({ name: typeof so["name"] === "string" ? so["name"] : `Series ${i + 1}`, data: pts });
    }
  } else if (Array.isArray(o["data"])) {
    series = [{ name: typeof o["name"] === "string" ? o["name"] : "Series 1", data: o["data"].filter((n): n is number => typeof n === "number") }];
  }
  if (series.length === 0 || series.every((s1) => s1.data.length === 0)) return { ok: false, error: "A chart needs at least one series with data." };
  if (series.some((s1) => s1.data.length > MAX_POINTS)) return { ok: false, error: `A chart holds at most ${MAX_POINTS} points a series.` };
  return { ok: true, spec: { type: type as ChartSpec["type"], ...(typeof o["title"] === "string" ? { title: o["title"] } : {}), ...(labels ? { labels } : {}), series, ...(typeof o["xLabel"] === "string" ? { xLabel: o["xLabel"] } : {}), ...(typeof o["yLabel"] === "string" ? { yLabel: o["yLabel"] } : {}) } };
}

/** The blocks of a whole text (the inside of a collapsible): parsed as a finished message. */
function parseDoc(text: string, prefix: string): Block[] {
  const md = createIncrementalMarkdown();
  md.append(text);
  md.finish();
  return md.view().blocks.map((b) => ({ ...b, key: `${prefix}.${b.key}` }) as Block);
}

const SAFE_IMG = /^(https?:\/\/|data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,])/i;

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
    const img = para.length === 1 ? /^!\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)$/.exec((para[0] ?? "").trim()) : null;
    if (img && SAFE_IMG.test(img[2] ?? "")) blocks.push({ kind: "img", key: key(), alt: img[1] ?? "", src: img[2] ?? "" });
    else if (para.length > 0) blocks.push({ kind: "p", key: key(), inline: parseInline(para.join("\n")) });
    para = [];
  };
  const endList = (): void => {
    if (list) blocks.push({ kind: list.kind, key: key(), start: list.start, items: list.items.map(parseInline), ...(list.checks.some((c) => c !== null) ? { checks: list.checks } : {}) });
    list = null;
  };
  const endQuote = (): void => {
    const co = quote.length > 0 ? /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i.exec(quote[0] ?? "") : null;
    if (co) {
      const variant = (co[1] ?? "note").toLowerCase() as Callout;
      blocks.push({ kind: "callout", key: key(), variant, title: co[2]?.trim() || variant.charAt(0).toUpperCase() + variant.slice(1), inline: parseInline(quote.slice(1).join("\n")) });
    } else if (quote.length > 0) blocks.push({ kind: "quote", key: key(), inline: parseInline(quote.join("\n")) });
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
      const lang = (fence[2] ?? "").toLowerCase();
      const code = body.join("\n");
      if (lang === "mermaid" && closed) blocks.push({ kind: "mermaid", key: key(), text: code, closed });
      else if (lang === "chart" && closed) {
        const spec = parseChartSpec(code);
        blocks.push({ kind: "chart", key: key(), text: code, closed, spec: spec.ok ? spec.spec : null, error: spec.ok ? null : spec.error });
      } else blocks.push({ kind: "code", key: key(), lang: fence[2] ?? "", text: code, closed });
      continue;
    }
    if (line.trim() === "") {
      endAll();
      continue;
    }
    if (/^\s*\$\$/.test(line)) {
      // display math: $$ x $$ on one line, or $$ on its own line down to the closing $$
      const one = /^\s*\$\$(.+?)\$\$\s*$/.exec(line);
      if (one) { endAll(); blocks.push({ kind: "math", key: key(), text: (one[1] ?? "").trim() }); continue; }
      if (/^\s*\$\$\s*$/.test(line)) {
        let j = i + 1;
        while (j < lines.length && !/^\s*\$\$\s*$/.test(lines[j] ?? "")) j++;
        if (j < lines.length) { endAll(); blocks.push({ kind: "math", key: key(), text: lines.slice(i + 1, j).join("\n").trim() }); i = j; continue; }
      }
    }
    if (/^\s*<details[\s>]/i.test(line)) {
      endAll();
      const buf: string[] = [];
      let done = false;
      let j = i;
      for (; j < lines.length; j++) { buf.push(lines[j] ?? ""); if (/<\/details>\s*$/i.test(lines[j] ?? "")) { done = true; break; } }
      const html = buf.join("\n");
      const sm = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(html);
      const inner = html.replace(/^\s*<details[^>]*>/i, "").replace(/<\/details>\s*$/i, "").replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, "").trim();
      const k = key();
      blocks.push({ kind: "details", key: k, summary: parseInline((sm?.[1] ?? "Details").trim()), open: /^\s*<details[^>]*\sopen\b/i.test(buf[0] ?? ""), blocks: parseDoc(inner, k), closed: done });
      i = j;
      continue;
    }
    const fnDef = /^\[\^([\w-]+)\]:\s*(.*)$/.exec(line);
    if (fnDef) { endAll(); blocks.push({ kind: "fn", key: key(), id: fnDef[1] ?? "", inline: parseInline(fnDef[2] ?? "") }); continue; }
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
  let details = false;
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
      if (details) {
        if (/<\/details>\s*$/i.test(line)) { details = false; closeChunk(scanned); }
        continue;
      }
      if (/^\s*<details[\s>]/i.test(line) && !/<\/details>\s*$/i.test(line)) { details = true; continue; }
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
      details = false;
      cached = null;
    },
    reset() {
      closed = [];
      pending = "";
      scanned = 0;
      fence = null;
      details = false;
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
