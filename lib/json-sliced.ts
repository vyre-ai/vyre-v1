// JSON.parse of a big document in pieces with a turn of the event loop between them (27 Nov 2026, the real-server guard): the 4.3 MB generated/registry.json parsed in one stretch of 70 to 130 ms at the
// start of every process, which no yield can split. The text is walked once (strings and brackets are skipped over, nothing is built), the top-level object is made key by key, and an array value
// longer than `chunk` characters is parsed a group of elements at a time. The answer is what JSON.parse answers (a test compares them on the real registry); text that is not an object at the top
// is parsed whole. Key order and duplicate keys (the last wins) are as JSON.parse has them.
const turnOf = (): Promise<void> => new Promise((r) => setImmediate(r));

/** The index just after the JSON value that starts at `i` (a string, a bracketed value, or a number, true, false, null): one loop over the characters, strings skipped in place. */
function endOfValue(t: string, from: number): number {
  const n = t.length;
  let i = from;
  const c = t.charCodeAt(i);
  if (c === 34) {
    for (i++; i < n; i++) {
      const d = t.charCodeAt(i);
      if (d === 92) i++;
      else if (d === 34) return i + 1;
    }
    throw new SyntaxError("unterminated string");
  }
  if (c === 123 || c === 91) {
    let depth = 0;
    for (; i < n; i++) {
      const d = t.charCodeAt(i);
      if (d === 34) {
        for (i++; i < n; i++) {
          const e = t.charCodeAt(i);
          if (e === 92) i++;
          else if (e === 34) break;
        }
      } else if (d === 123 || d === 91) depth++;
      else if ((d === 125 || d === 93) && --depth === 0) return i + 1;
    }
    throw new SyntaxError("unterminated value");
  }
  while (i < n) {
    const d = t.charCodeAt(i);
    if (d === 44 || d === 125 || d === 93 || d <= 32) break;
    i++;
  }
  return i;
}
const skipSpace = (t: string, i: number): number => {
  while (i < t.length && t.charCodeAt(i) <= 32) i++;
  return i;
};

/** The elements of the array that starts at `from`, parsed a group of about `chunk` characters at a time. */
async function parseArray(
  t: string,
  from: number,
  to: number,
  chunk: number,
  turn: () => Promise<void>,
): Promise<unknown[]> {
  const out: unknown[] = [];
  let i = skipSpace(t, from + 1);
  if (t.charCodeAt(i) === 93) return out;
  let groupFrom = i;
  for (;;) {
    const end = endOfValue(t, i);
    const next = skipSpace(t, end);
    const last = t.charCodeAt(next) === 93;
    if (end - groupFrom >= chunk || last) {
      const part = JSON.parse(`[${t.slice(groupFrom, end)}]`) as unknown[];
      for (const x of part) out.push(x);
      if (last) return out;
      await turn();
    }
    if (last) return out;
    i = skipSpace(t, next + 1); // the comma
    if (end - groupFrom >= chunk) groupFrom = i;
  }
}

export async function parseSliced(
  text: string,
  o: { chunk?: number; turn?: () => Promise<void> } = {},
): Promise<unknown> {
  const chunk = o.chunk ?? 150_000;
  const turn = o.turn ?? turnOf;
  let i = skipSpace(text, 0);
  if (text.length < 2 * chunk || text.charCodeAt(i) !== 123) return JSON.parse(text);
  const out: Record<string, unknown> = {};
  i = skipSpace(text, i + 1);
  if (text.charCodeAt(i) === 125) return out;
  for (;;) {
    const keyEnd = endOfValue(text, i);
    const key = JSON.parse(text.slice(i, keyEnd)) as string;
    i = skipSpace(text, keyEnd);
    if (text.charCodeAt(i) !== 58) throw new SyntaxError("expected a colon");
    i = skipSpace(text, i + 1);
    const end = endOfValue(text, i);
    const value =
      text.charCodeAt(i) === 91 && end - i > chunk
        ? await parseArray(text, i, end, chunk, turn)
        : JSON.parse(text.slice(i, end));
    Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
    await turn();
    i = skipSpace(text, end);
    const c = text.charCodeAt(i);
    if (c === 125) return out;
    if (c !== 44) throw new SyntaxError("expected a comma");
    i = skipSpace(text, i + 1);
  }
}
