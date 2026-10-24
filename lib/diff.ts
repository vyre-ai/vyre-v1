// Text diff for History and Diff tabs, conflict notes and changesets. Line and word level, longest common subsequence, no dependencies.

export type DiffOp = { op: "eq" | "add" | "del"; text: string };

/** Above this many cells the exact LCS table is skipped and the common head and tail are kept around one replaced block. */
const MAX_CELLS = 4_000_000;

function diffSeq(a: string[], b: string[]): DiffOp[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail), y = b.slice(head, b.length - tail);
  const out: DiffOp[] = a.slice(0, head).map((text) => ({ op: "eq", text }));
  if (x.length * y.length > MAX_CELLS) {
    for (const text of x) out.push({ op: "del", text });
    for (const text of y) out.push({ op: "add", text });
  } else {
    const w = y.length + 1;
    const t = new Uint32Array((x.length + 1) * w);
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) {
      t[i * w + j] = x[i] === y[j] ? t[(i + 1) * w + j + 1]! + 1 : Math.max(t[(i + 1) * w + j]!, t[i * w + j + 1]!);
    }
    let i = 0, j = 0;
    while (i < x.length && j < y.length) {
      if (x[i] === y[j]) { out.push({ op: "eq", text: x[i]! }); i++; j++; }
      else if (t[(i + 1) * w + j]! >= t[i * w + j + 1]!) out.push({ op: "del", text: x[i++]! });
      else out.push({ op: "add", text: y[j++]! });
    }
    while (i < x.length) out.push({ op: "del", text: x[i++]! });
    while (j < y.length) out.push({ op: "add", text: y[j++]! });
  }
  for (const text of a.slice(a.length - tail)) out.push({ op: "eq", text });
  return out;
}

const lines = (s: string): string[] => (s === "" ? [] : s.split("\n"));

/** Line diff. Joining the `eq` and `del` texts with "\n" gives `a`; joining `eq` and `add` gives `b`. */
export function diffLines(a: string, b: string): DiffOp[] {
  return diffSeq(lines(a), lines(b));
}

/** Word diff: tokens are runs of non-space or runs of space, so joining the right ops restores each side exactly. */
export function diffWords(a: string, b: string): DiffOp[] {
  const tok = (s: string) => s.match(/\s+|\S+/g) ?? [];
  return diffSeq(tok(a), tok(b));
}

export function diffStats(ops: DiffOp[]): { added: number; removed: number; unchanged: number } {
  let added = 0, removed = 0, unchanged = 0;
  for (const o of ops) o.op === "add" ? added++ : o.op === "del" ? removed++ : unchanged++;
  return { added, removed, unchanged };
}

/** Rebuild one side from ops: "a" keeps eq and del, "b" keeps eq and add. Lines rejoin with "\n"; use sep "" for word diffs. */
export function sideOf(ops: DiffOp[], side: "a" | "b", sep = "\n"): string {
  return ops.filter((o) => o.op === "eq" || o.op === (side === "a" ? "del" : "add")).map((o) => o.text).join(sep);
}
