// A longest-common-run diff of two lists of strings (blocks of a document, lines of a file), as hunks. Shared by the merge of text that arrives under an open page and by the writing back of a file's own line endings.

/** x[a..b) became y[c..d). */
export interface Hunk {
  a: number;
  b: number;
  c: number;
  d: number;
}

const MAX_CELLS = 4_000_000;

/** Where two lists differ: the shared start and end are cut off, the middle is matched by longest common run, and each stretch that does not match is one hunk. A middle too big to match is one hunk. */
export function hunks(x: readonly string[], y: readonly string[]): Hunk[] {
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p += 1;
  let q = 0;
  while (q < x.length - p && q < y.length - p && x[x.length - 1 - q] === y[y.length - 1 - q]) q += 1;
  const n = x.length - p - q;
  const m = y.length - p - q;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_CELLS) return [{ a: p, b: p + n, c: p, d: p + m }];
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i -= 1)
    for (let j = m - 1; j >= 0; j -= 1)
      lcs[i * w + j] =
        x[p + i] === y[p + j]
          ? (lcs[(i + 1) * w + j + 1] as number) + 1
          : Math.max(lcs[(i + 1) * w + j] as number, lcs[i * w + j + 1] as number);
  const out: Hunk[] = [];
  let i = 0;
  let j = 0;
  let open: Hunk | null = null;
  const close = (): void => {
    if (open) out.push(open);
    open = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && x[p + i] === y[p + j]) {
      close();
      i += 1;
      j += 1;
    } else {
      if (!open) open = { a: p + i, b: p + i, c: p + j, d: p + j };
      if (j >= m || (i < n && (lcs[(i + 1) * w + j] as number) >= (lcs[i * w + j + 1] as number))) {
        i += 1;
        open.b = p + i;
      } else {
        j += 1;
        open.d = p + j;
      }
    }
  }
  close();
  return out;
}
