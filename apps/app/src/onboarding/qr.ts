// A small QR code encoder: byte mode, error correction level L, versions 1 to 10 (up to 271 bytes), enough for a pairing link. No dependency.
// toMatrix returns rows of booleans (true = dark) without the quiet zone; the renderer adds it.

const DATA = [19, 34, 55, 80, 108, 136, 156, 194, 232, 274];
const ECC = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
const BLOCKS = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4];
const ALIGN: readonly (readonly number[])[] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 285; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

function remainder(data: readonly number[], n: number): number[] {
  let gen = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    gen.forEach((c, j) => { next[j] = next[j]! ^ c; next[j + 1] = next[j + 1]! ^ mul(c, EXP[i]!); });
    gen = next;
  }
  const out = data.concat(new Array<number>(n).fill(0));
  for (let i = 0; i < data.length; i++) {
    const f = out[i]!;
    if (f !== 0) for (let j = 1; j < gen.length; j++) out[i + j] = out[i + j]! ^ mul(gen[j]!, f);
  }
  return out.slice(data.length);
}

/** The smallest version that holds `n` bytes, or 0 when none of 1 to 10 does. */
export function versionFor(n: number): number {
  for (let v = 1; v <= 10; v++) if (n + (v < 10 ? 2 : 3) <= DATA[v - 1]!) return v;
  return 0;
}

function codewords(bytes: readonly number[], v: number): number[] {
  const bits: number[] = [];
  const put = (val: number, len: number): void => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = DATA[v - 1]! * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; data.length < DATA[v - 1]!; pad = pad === 0xec ? 0x11 : 0xec) data.push(pad);
  const nb = BLOCKS[v - 1]!, total = DATA[v - 1]!, short = Math.floor(total / nb), longFrom = nb - (total % nb);
  const blocks: number[][] = [];
  let at = 0;
  for (let b = 0; b < nb; b++) { const len = short + (b >= longFrom ? 1 : 0); blocks.push(data.slice(at, at + len)); at += len; }
  const ecc = blocks.map((b) => remainder(b, ECC[v - 1]!));
  const out: number[] = [];
  for (let i = 0; i < short + 1; i++) for (const b of blocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < ECC[v - 1]!; i++) for (const e of ecc) out.push(e[i]!);
  return out;
}


const MASKS: readonly ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (_r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function penalty(m: readonly (readonly boolean[])[]): number {
  const n = m.length;
  let p = 0;
  const run = (line: readonly boolean[]): void => {
    let len = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) len++;
      else { if (len >= 5) p += len - 2; len = 1; }
    }
  };
  for (let i = 0; i < n; i++) { run(m[i]!); run(m.map((row) => row[i]!)); }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) { const v = m[r]![c]; if (v === m[r]![c + 1] && v === m[r + 1]![c] && v === m[r + 1]![c + 1]) p += 3; }
  const pat = [true, false, true, true, true, false, true], light = [false, false, false, false];
  const has = (line: readonly boolean[], i: number): number => {
    let hit = 0;
    const seg = line.slice(i, i + 7);
    if (seg.length === 7 && seg.every((x, k) => x === pat[k])) {
      const before = line.slice(i - 4, i), after = line.slice(i + 7, i + 11);
      if (i >= 4 && before.every((x, k) => x === light[k])) hit++;
      if (i + 11 <= line.length && after.every((x, k) => x === light[k])) hit++;
    }
    return hit;
  };
  for (let i = 0; i < n; i++) { const col = m.map((row) => row[i]!); for (let k = 0; k + 7 <= n; k++) p += 40 * (has(m[i]!, k) + has(col, k)); }
  let dark = 0;
  for (const row of m) for (const x of row) if (x) dark++;
  p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return p;
}

/** The QR matrix for a text, or null when it is longer than version 10 holds. */
export function toMatrix(text: string): boolean[][] | null {
  const bytes = Array.from(new TextEncoder().encode(text));
  const v = versionFor(bytes.length);
  if (v === 0) return null;
  const n = 17 + 4 * v;
  const mod: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const fn: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const set = (r: number, c: number, dark: boolean): void => { if (r >= 0 && c >= 0 && r < n && c < n) { mod[r]![c] = dark; fn[r]![c] = true; } };
  const finder = (r0: number, c0: number): void => {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      const edge = dr === -1 || dr === 7 || dc === -1 || dc === 7;
      const ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
      set(r0 + dr, c0 + dc, !edge && ring !== 2);
    }
  };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  const pos = ALIGN[v - 1]!;
  for (const r of pos) for (const c of pos) {
    if ((r === 6 && c === 6) || (r === 6 && c === pos[pos.length - 1]) || (c === 6 && r === pos[pos.length - 1])) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  set(n - 8, 8, true);
  for (let i = 0; i < 9; i++) { set(8, i, false); set(i, 8, false); }
  for (let i = 0; i < 8; i++) { set(8, n - 1 - i, false); set(n - 1 - i, 8, false); }
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  set(n - 8, 8, true);
  if (v >= 7) {
    let r = v << 12;
    for (let i = 17; i >= 12; i--) if ((r >>> i) & 1) r ^= 0x1f25 << (i - 12);
    const info = (v << 12) | r;
    for (let i = 0; i < 18; i++) { const bit = ((info >>> i) & 1) === 1, a = Math.floor(i / 3), b = (i % 3) + n - 11; set(a, b, bit); set(b, a, bit); }
  }
  const stream = codewords(bytes, v), bits: boolean[] = [];
  for (const cw of stream) for (let i = 7; i >= 0; i--) bits.push(((cw >>> i) & 1) === 1);
  const place = (): void => {
    let k = 0, up = true;
    for (let c = n - 1; c > 0; c -= 2) {
      if (c === 6) c--;
      for (let i = 0; i < n; i++) {
        const r = up ? n - 1 - i : i;
        for (const cc of [c, c - 1]) if (!fn[r]![cc]) { mod[r]![cc] = k < bits.length ? bits[k]! : false; k++; }
      }
      up = !up;
    }
  };
  place();
  const format = (mask: number): number => {
    const d = (1 << 3) | mask; // level L is 01
    let r = d << 10;
    for (let i = 14; i >= 10; i--) if ((r >>> i) & 1) r ^= 0x537 << (i - 10);
    return ((d << 10) | r) ^ 0x5412;
  };
  let best: boolean[][] | null = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = mod.map((row, r) => row.map((x, c) => (fn[r]![c] ? x : x !== MASKS[mask]!(r, c))));
    const f = format(mask);
    for (let i = 0; i < 15; i++) {
      const bit = ((f >>> i) & 1) === 1;
      if (i < 6) m[i]![8] = bit; else if (i === 6) m[7]![8] = bit; else if (i === 7) m[8]![8] = bit; else if (i === 8) m[8]![7] = bit; else m[8]![14 - i] = bit;
      if (i < 8) m[8]![n - 1 - i] = bit; else m[n - 15 + i]![8] = bit;
    }
    m[n - 8]![8] = true;
    const s = penalty(m);
    if (s < bestScore) { bestScore = s; best = m; }
  }
  return best;
}
