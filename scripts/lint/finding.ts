// One lint finding. Line and column are 1-based.

export type Finding = {
  rule: string;
  file: string;
  line: number;
  column: number;
  message: string;
};

export function lineCol(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const end = Math.min(index, source.length);
  for (let i = 0; i < end; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

export function finding(rule: string, file: string, source: string, index: number, message: string): Finding {
  const at = lineCol(source, index);
  return { rule, file, line: at.line, column: at.column, message };
}

/** Index just past the matching closer, respecting quotes. `openIndex` points at the opener. */
export function matchDelim(source: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  let quote = "";
  for (let i = openIndex; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === "\"" || c === "`") {
      quote = c;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return source.length;
}
