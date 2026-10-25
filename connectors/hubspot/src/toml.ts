// A small TOML reader for connector.toml: tables, arrays of tables (also nested), strings, numbers, booleans, arrays (several lines allowed) and inline tables.
// Self-contained on purpose: a connector folder imports nothing from the platform (ARCH 8, boundary B1).
export type TomlValue = string | number | boolean | TomlValue[] | { [key: string]: TomlValue };
export type TomlTable = { [key: string]: TomlValue };

export class TomlError extends Error {
  line: number;
  constructor(line: number, message: string) { super(`line ${line}: ${message}`); this.name = "TomlError"; this.line = line; }
}

const ESC: Record<string, string> = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };

class Reader {
  i = 0;
  s: string;
  line: number;
  constructor(s: string, line: number) { this.s = s; this.line = line; }
  ws(): void { while (this.i < this.s.length && /[ \t\r\n]/.test(this.s[this.i]!)) this.i++; }
  peek(): string | undefined { return this.s[this.i]; }
  fail(m: string): never { throw new TomlError(this.line, m); }
  value(): TomlValue {
    this.ws();
    const c = this.peek();
    if (c === '"') return this.basic();
    if (c === "'") return this.literal();
    if (c === "[") return this.array();
    if (c === "{") return this.inline();
    const m = /^[^\s,\]}#]+/.exec(this.s.slice(this.i));
    if (!m) this.fail("A value is missing.");
    const raw = m![0];
    this.i += raw.length;
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (/^[+-]?\d[\d_]*$/.test(raw)) return Number(raw.replaceAll("_", ""));
    if (/^[+-]?\d[\d_]*\.\d[\d_]*([eE][+-]?\d+)?$/.test(raw)) return Number(raw.replaceAll("_", ""));
    return this.fail(`${raw} is not a value: strings need quotes.`);
  }
  basic(): string {
    this.i++;
    let out = "";
    for (;;) {
      const c = this.s[this.i++];
      if (c === undefined) this.fail("A string is not closed.");
      if (c === '"') return out;
      if (c === "\\") {
        const e = this.s[this.i++];
        if (e === "u" || e === "U") {
          const n = e === "u" ? 4 : 8;
          out += String.fromCodePoint(parseInt(this.s.slice(this.i, this.i + n), 16));
          this.i += n;
        } else if (e !== undefined && e in ESC) out += ESC[e]!;
        else this.fail(`\\${e ?? ""} is not an escape.`);
      } else out += c;
    }
  }
  literal(): string {
    const end = this.s.indexOf("'", this.i + 1);
    if (end < 0) this.fail("A string is not closed.");
    const out = this.s.slice(this.i + 1, end);
    this.i = end + 1;
    return out;
  }
  array(): TomlValue[] {
    this.i++;
    const out: TomlValue[] = [];
    for (;;) {
      this.ws();
      if (this.peek() === "]") { this.i++; return out; }
      out.push(this.value());
      this.ws();
      if (this.peek() === ",") this.i++;
      else if (this.peek() !== "]") this.fail("An array needs commas between its items.");
    }
  }
  inline(): TomlTable {
    this.i++;
    const out: TomlTable = {};
    for (;;) {
      this.ws();
      if (this.peek() === "}") { this.i++; return out; }
      const key = this.key();
      this.ws();
      if (this.peek() !== "=") this.fail("A key needs an equals sign.");
      this.i++;
      out[key] = this.value();
      this.ws();
      if (this.peek() === ",") this.i++;
      else if (this.peek() !== "}") this.fail("An inline table needs commas between its keys.");
    }
  }
  key(): string {
    this.ws();
    if (this.peek() === '"') return this.basic();
    if (this.peek() === "'") return this.literal();
    const m = /^[A-Za-z0-9_-]+/.exec(this.s.slice(this.i));
    if (!m) this.fail("A key is missing.");
    this.i += m![0].length;
    return m![0];
  }
}

function stripComment(s: string): string {
  let q: string | undefined;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === "\\" && q === '"') i++;
      else if (c === q) q = undefined;
    } else if (c === '"' || c === "'") q = c;
    else if (c === "#") return s.slice(0, i);
  }
  return s;
}

const depth = (s: string): number => {
  let d = 0;
  let q: string | undefined;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) { if (c === "\\" && q === '"') i++; else if (c === q) q = undefined; }
    else if (c === '"' || c === "'") q = c;
    else if (c === "[" || c === "{") d++;
    else if (c === "]" || c === "}") d--;
  }
  return d;
};

function descend(root: TomlTable, path: string[], line: number, create: boolean): TomlTable {
  let cur = root;
  for (const k of path) {
    let next = cur[k];
    if (next === undefined && create) { next = {}; cur[k] = next; }
    if (Array.isArray(next)) {
      const last = next[next.length - 1];
      if (!last || typeof last !== "object" || Array.isArray(last)) throw new TomlError(line, `${k} is not a table.`);
      cur = last;
    } else if (next && typeof next === "object") cur = next;
    else throw new TomlError(line, `${k} is not a table.`);
  }
  return cur;
}

/** Parse connector.toml text. Throws TomlError with the line of the first problem. */
export function parseToml(text: string): TomlTable {
  const root: TomlTable = {};
  let table: TomlTable = root;
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const lineNo = n + 1;
    let line = stripComment(lines[n]!).trim();
    if (line === "") continue;
    const head = /^(\[\[?)\s*([A-Za-z0-9_.-]+)\s*(\]\]?)$/.exec(line);
    if (head) {
      const array = head[1] === "[[";
      if (array !== (head[3] === "]]")) throw new TomlError(lineNo, "The table header brackets do not match.");
      const path = head[2]!.split(".");
      const last = path.pop()!;
      const parent = descend(root, path, lineNo, true);
      if (array) {
        const list = (parent[last] ??= []) as TomlValue[];
        if (!Array.isArray(list)) throw new TomlError(lineNo, `${last} is not a list of tables.`);
        const fresh: TomlTable = {};
        list.push(fresh);
        table = fresh;
      } else {
        const t = (parent[last] ??= {}) as TomlTable;
        if (typeof t !== "object" || Array.isArray(t)) throw new TomlError(lineNo, `${last} is not a table.`);
        table = t;
      }
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) throw new TomlError(lineNo, "A line needs a key, an equals sign and a value.");
    const k = new Reader(line.slice(0, eq), lineNo).key();
    let rest = line.slice(eq + 1).trim();
    while (depth(rest) > 0 && n + 1 < lines.length) { n++; rest += ` ${stripComment(lines[n]!).trim()}`; }
    if (depth(rest) !== 0) throw new TomlError(lineNo, "A bracket is not closed.");
    const r = new Reader(rest, lineNo);
    if (Object.hasOwn(table, k)) throw new TomlError(lineNo, `${k} is set twice.`);
    table[k] = r.value();
    r.ws();
    if (r.i < rest.length) throw new TomlError(lineNo, "There is text after the value.");
    line = "";
  }
  return root;
}
