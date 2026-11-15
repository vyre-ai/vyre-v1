// The PDF body's pure parts: where each page sits, which pages are near the screen, what Find counts, what a failed open says, and the redacted copy's file.
// Nothing here touches the page or pdf.js, so a 500-page file is planned in microseconds and every rule is a unit test.

/** The gap between two pages, in pixels. */
export const PAGE_GAP = 12;
/** Pages this far (in screens) from the visible ones are kept drawn; further ones give their canvas back. */
export const KEEP_SCREENS = 1.5;

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

/** The top of each page and the total height, for pages of the given heights. */
export function pageOffsets(heights: readonly number[], gap = PAGE_GAP): { tops: number[]; total: number } {
  const tops: number[] = [];
  let y = gap;
  for (const h of heights) {
    tops.push(y);
    y += h + gap;
  }
  return { tops, total: y };
}

/** The 0-based pages to keep drawn for a scroll position: those within `KEEP_SCREENS` screens of the visible band. A binary search, so 500 pages cost nothing per scroll. */
export function pagesToDraw(
  tops: readonly number[],
  heights: readonly number[],
  scrollTop: number,
  viewH: number,
  keep = KEEP_SCREENS,
): { from: number; to: number } {
  if (tops.length === 0) return { from: 0, to: -1 };
  const lo = scrollTop - viewH * keep;
  const hi = scrollTop + viewH * (1 + keep);
  let a = 0;
  let b = tops.length - 1;
  while (a < b) {
    const m = (a + b) >> 1;
    if ((tops[m] ?? 0) + (heights[m] ?? 0) < lo) a = m + 1;
    else b = m;
  }
  const from = a;
  let to = from;
  while (to + 1 < tops.length && (tops[to + 1] ?? 0) <= hi) to++;
  return { from, to };
}

/** The 1-based page that holds the middle of the screen: the page number shown in the toolbar. */
export function currentPage(
  tops: readonly number[],
  heights: readonly number[],
  scrollTop: number,
  viewH: number,
): number {
  const mid = scrollTop + viewH / 3;
  let page = 1;
  for (let i = 0; i < tops.length; i++) {
    if ((tops[i] ?? 0) <= mid) page = i + 1;
    else break;
  }
  return page;
}

/** The scale that makes a page as wide as the screen's column (fit width), never below the smallest step. */
export const fitScale = (columnW: number, pageW: number): number =>
  pageW <= 0 ? 1 : Math.max(0.25, Math.min(4, Math.round((columnW / pageW) * 1000) / 1000));

/** Where each match of `query` sits in each text item of a page: Find counts by item, so what is counted is exactly what is marked on the page. */
export function itemHits(items: readonly string[], query: string): { item: number; at: number }[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const out: { item: number; at: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const t = (items[i] ?? "").toLowerCase();
    for (let at = t.indexOf(q); at >= 0; at = t.indexOf(q, at + q.length)) out.push({ item: i, at });
  }
  return out;
}

/** The text the Viewer's Find reads for a page: its items, one per line, so a match never spans two items. */
export const pageText = (items: readonly string[]): string => items.filter((s) => s !== "").join("\n");

/** True when no page has a text layer (a scan): Find says so instead of "No matches". */
export const noTextLayer = (pages: readonly string[], done: boolean): boolean =>
  done && pages.length > 0 && pages.every((t) => t.trim() === "");

/** What a person is told when a PDF cannot be opened, in one sentence. */
export function pdfFailureWords(e: unknown): string {
  const own = (e as { words?: unknown } | null)?.words;
  if (typeof own === "string") return own;
  const name = (e as { name?: string } | null)?.name ?? "";
  const msg = (e as { message?: string } | null)?.message ?? "";
  if (name === "PasswordException" || /password/i.test(msg))
    return "This PDF is protected by a password, so it cannot be shown here.";
  return "This PDF is damaged and cannot be shown here.";
}

/** A box in unit coordinates of a page from two corners, clamped to the page. */
export function unitBox(
  a: readonly [number, number],
  b: readonly [number, number],
): { x: number; y: number; w: number; h: number } | null {
  const c = (n: number): number => Math.max(0, Math.min(1, n));
  const x = c(Math.min(a[0], b[0]));
  const y = c(Math.min(a[1], b[1]));
  const w = c(Math.max(a[0], b[0])) - x;
  const h = c(Math.max(a[1], b[1])) - y;
  return w < 0.004 && h < 0.004 ? null : { x, y, w, h };
}

/* ---------- the redacted copy ---------- */

export interface CopyPage {
  /** The page's size in PDF points. */
  w: number;
  h: number;
  /** The page as a JPEG, with the marked areas already painted over. */
  jpeg: Uint8Array;
  /** The JPEG's size in pixels. */
  iw: number;
  ih: number;
}

const enc = (s: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
  return out;
};

/**
 * A PDF made only of pictures: each page is one JPEG that already has the marked areas painted over, so the words under a mark are not in the file at all (there is no text layer to select, copy or
 * extract). Written by hand: a catalog, a page tree, and per page a page, an image and a content stream. Nothing from the original file is carried.
 */
export function imagePdf(pages: readonly CopyPage[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (b: Uint8Array | number[]): void => {
    const u = b instanceof Uint8Array ? b : Uint8Array.from(b);
    parts.push(u);
    size += u.length;
  };
  const text = (s: string): void => push(enc(s));
  const obj = (id: number, body: () => void): void => {
    offsets[id] = size;
    text(`${id} 0 obj\n`);
    body();
    text("\nendobj\n");
  };
  text("%PDF-1.4\n");
  push([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  const n = pages.length;
  // objects: 1 catalog, 2 pages, then per page 3 ids: page, content, image
  obj(1, () => text("<< /Type /Catalog /Pages 2 0 R >>"));
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  obj(2, () => text(`<< /Type /Pages /Count ${n} /Kids [${kids}] >>`));
  pages.forEach((p, i) => {
    const pg = 3 + i * 3;
    const w = p.w.toFixed(2);
    const h = p.h.toFixed(2);
    obj(pg, () =>
      text(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${pg + 2} 0 R >> >> /Contents ${pg + 1} 0 R >>`,
      ),
    );
    const draw = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(pg + 1, () => text(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
    obj(pg + 2, () => {
      text(
        `<< /Type /XObject /Subtype /Image /Width ${p.iw} /Height ${p.ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      );
      push(p.jpeg);
      text("\nendstream");
    });
  });
  const count = 3 + n * 3;
  const xref = size;
  text(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) text(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
  text(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
