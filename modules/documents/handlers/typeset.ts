// documents: a Vyre document set on pages as a PDF, in process (lane r42-docs). No converter app, no browser, no outside service: the same blocks give the same bytes on any server.
// Body text in Times, small labels in Helvetica (the fonts every PDF reader has, so nothing is embedded); US Letter or A4 with one-inch margins; headings stay with the line after them;
// a table row and a signing row never split across pages. A signing row draws a line for each {sign:role} and returns where it is, as the places built-in signing takes (percent of the
// page from its top left), so nobody places a signature by hand.
// The standard fonts draw Western European letters only. A letter they cannot draw stops the document and names itself rather than printing a wrong one.

import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import type { PDFFont, PDFPage } from "@cantoo/pdf-lib";
import type { Block, Run, SignColumn } from "./vdoc.ts";

/** Where a signer signs or the date goes: the shape of esign's Place (modules/esign/handlers/pdf.ts). `signer` is the place of the role in `roles`. */
export interface Place {
  signer: number;
  kind: "signature" | "date";
  /** 1-based */
  page: number;
  /** percent of the page, origin top-left */
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Typeset {
  pdf: Uint8Array;
  places: Place[];
  /** signer roles in signing order: places[n].signer indexes this list */
  roles: string[];
  pages: number;
}
export type Paper = "letter" | "a4";

/** A plain refusal a person can read: a letter the fonts cannot draw. */
export class TypesetError extends Error {
  readonly letters: string[];
  constructor(letters: string[]) {
    super(
      `the document has ${letters.length === 1 ? "a letter" : "letters"} this PDF cannot draw yet: ${letters.join(" ")}`,
    );
    this.letters = letters;
  }
}

const SIZES: Record<Paper, [number, number]> = { letter: [612, 792], a4: [595.28, 841.89] };
const MARGIN = 72;
const BODY = 11.5;
const LEAD = 16.5;
const GREY = rgb(0.42, 0.42, 0.45);
const RULE = rgb(0.75, 0.75, 0.78);
/** One date for the file's own metadata, so the same input is the same bytes. */
const FIXED = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));

// what WinAnsi (the standard fonts' encoding) holds beyond Latin-1
// (the en and em dash are made from their code points: the text lint bans the characters, and their escapes)
const EXTRA = `€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•${String.fromCodePoint(0x2013, 0x2014)}˜™š›œžŸ`;
const drawable = (c: string): boolean => {
  const n = c.codePointAt(0) ?? 0;
  return (n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff) || EXTRA.includes(c);
};

interface Word {
  text: string;
  font: PDFFont;
  width: number;
  /** a space goes before this word when it does not start the line */
  gap: boolean;
  /** this word starts a new line (a kept line break) */
  br: boolean;
}

export async function typeset(blocks: readonly Block[], o: { title?: string; paper?: Paper } = {}): Promise<Typeset> {
  const doc = await PDFDocument.create();
  doc.setTitle(o.title ?? "Document");
  doc.setProducer("Vyre");
  doc.setCreator("Vyre");
  doc.setCreationDate(FIXED);
  doc.setModificationDate(FIXED);
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const boldItalic = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
  const label = await doc.embedFont(StandardFonts.Helvetica);
  const [W, H] = SIZES[o.paper ?? "letter"];
  const width = W - 2 * MARGIN;
  const bad = new Set<string>();
  const clean = (text: string): string => {
    let out = "";
    for (const c of text.replace(/\t/g, " ").replace(/[‑‐]/g, "-").replace(/[   ]/g, " ")) {
      if (drawable(c)) out += c;
      else {
        bad.add(c);
        out += "?";
      }
    }
    return out;
  };
  const fontOf = (r: Run, heading: boolean): PDFFont =>
    heading || r.b ? (r.i ? boldItalic : bold) : r.i ? italic : regular;

  let page: PDFPage = doc.addPage([W, H]);
  let y = H - MARGIN; // the top of the next line
  const room = (need: number): void => {
    if (y - need < MARGIN) {
      page = doc.addPage([W, H]);
      y = H - MARGIN;
    }
  };
  const words = (runs: readonly Run[], size: number, heading = false): Word[] => {
    const out: Word[] = [];
    let gap = false;
    let br = false;
    for (const r of runs) {
      const font = fontOf(r, heading);
      const parts = clean(r.text).split(/( +|\n)/);
      for (const p of parts) {
        if (p === "") continue;
        if (p === "\n") {
          br = true;
          gap = false;
        } else if (/^ +$/.test(p)) gap = true;
        else {
          out.push({ text: p, font, width: font.widthOfTextAtSize(p, size), gap: gap && out.length > 0 && !br, br });
          gap = false;
          br = false;
        }
      }
    }
    return out;
  };
  /** Words into lines no wider than `w`; a word wider than the line is cut. */
  const wrap = (ws: Word[], size: number, w: number): Word[][] => {
    const lines: Word[][] = [];
    let line: Word[] = [];
    let used = 0;
    const space = (f: PDFFont): number => f.widthOfTextAtSize(" ", size);
    for (let word of ws) {
      if (word.br && line.length > 0) {
        lines.push(line);
        line = [];
        used = 0;
      }
      for (;;) {
        const lead = line.length > 0 && word.gap ? space(word.font) : 0;
        if (used + lead + word.width <= w || (line.length === 0 && word.text.length === 1)) {
          line.push({ ...word, gap: line.length > 0 && word.gap });
          used += lead + word.width;
          break;
        }
        if (line.length > 0) {
          lines.push(line);
          line = [];
          used = 0;
          continue;
        }
        // one word wider than the whole line: cut it where it fits
        let k = word.text.length - 1;
        while (k > 1 && word.font.widthOfTextAtSize(word.text.slice(0, k), size) > w) k--;
        const head = word.text.slice(0, k);
        lines.push([{ ...word, text: head, width: word.font.widthOfTextAtSize(head, size), gap: false }]);
        const tail = word.text.slice(k);
        word = { ...word, text: tail, width: word.font.widthOfTextAtSize(tail, size), gap: false, br: false };
      }
    }
    if (line.length > 0) lines.push(line);
    return lines;
  };
  const drawLine = (line: Word[], x: number, base: number, size: number, color = rgb(0.1, 0.1, 0.12)): void => {
    let at = x;
    for (const w of line) {
      if (w.gap) at += w.font.widthOfTextAtSize(" ", size);
      page.drawText(w.text, { x: at, y: base, size, font: w.font, color });
      at += w.width;
    }
  };
  /** A run of text set from the current line down; returns nothing, moves y. Lines flow onto new pages. */
  const text = (runs: readonly Run[], size: number, lead: number, x: number, w: number, heading = false): void => {
    for (const line of wrap(words(runs, size, heading), size, w)) {
      room(lead);
      drawLine(line, x, y - size, size);
      y -= lead;
    }
  };
  const heightOf = (runs: readonly Run[], size: number, lead: number, w: number, heading = false): number =>
    Math.max(1, wrap(words(runs, size, heading), size, w).length) * lead;

  const roles: string[] = [];
  const places: Place[] = [];
  const roleOf = (role: string): number => {
    if (!roles.includes(role)) roles.push(role);
    return roles.indexOf(role);
  };
  // roles are numbered in the order the document names its signatures, whatever the order of the date marks
  for (const b of blocks)
    if (b.t === "sign") for (const c of b.cols) for (const t of c.tokens) if (t.kind === "signature") roleOf(t.role);
  const place = (signer: number, kind: Place["kind"], x: number, top: number, w: number, h: number): void => {
    places.push({
      signer,
      kind,
      page: doc.getPageCount(),
      x: (x / W) * 100,
      y: ((H - top) / H) * 100,
      w: (w / W) * 100,
      h: (h / H) * 100,
    });
  };

  const signRow = (cols: readonly SignColumn[]): void => {
    const gap = 28;
    const n = Math.max(1, cols.length);
    const colW = Math.min((width - gap * (n - 1)) / n, 260);
    const boxH = 46;
    const capSize = 10.5;
    const capLead = 14;
    const dateH = 18;
    const heights = cols.map((c) => {
      const sig = c.tokens.some((t) => t.kind === "signature");
      const date = c.tokens.some((t) => t.kind === "date");
      return (
        (sig ? boxH + 6 : 0) +
        (c.caption.length > 0 ? heightOf(c.caption, capSize, capLead, colW) : 0) +
        (date ? dateH + 6 : 0)
      );
    });
    const rowH = Math.max(...heights, 0) + 10;
    y -= 14;
    room(rowH);
    const top = y;
    cols.forEach((c, k) => {
      const x = MARGIN + k * (colW + gap);
      let at = top;
      for (const t of c.tokens.filter((q) => q.kind === "signature")) {
        place(roleOf(t.role), "signature", x, at, colW, boxH);
        page.drawLine({
          start: { x, y: at - boxH },
          end: { x: x + colW, y: at - boxH },
          thickness: 0.75,
          color: rgb(0.1, 0.1, 0.12),
        });
        at -= boxH + 6;
      }
      if (c.caption.length > 0) {
        for (const line of wrap(words(c.caption, capSize), capSize, colW)) {
          drawLine(line, x, at - capSize, capSize);
          at -= capLead;
        }
      }
      for (const t of c.tokens.filter((q) => q.kind === "date")) {
        at -= 4;
        page.drawText("Date", { x, y: at - 12, size: 8.5, font: label, color: GREY });
        const dx = x + 30;
        const dw = Math.min(colW - 30, 150);
        place(roleOf(t.role), "date", dx, at, dw, dateH);
        page.drawLine({
          start: { x: dx, y: at - dateH },
          end: { x: dx + dw, y: at - dateH },
          thickness: 0.5,
          color: RULE,
        });
        at -= dateH + 2;
      }
    });
    y = top - rowH;
  };

  const table = (head: Run[][], rows: Run[][][]): void => {
    const n = Math.max(1, head.length);
    const pad = 5;
    const size = 10.5;
    const lead = 14;
    const colW = width / n;
    const drawRow = (cellsOf: Run[][], header: boolean): void => {
      const h = Math.max(...cellsOf.map((c) => heightOf(c, size, lead, colW - 2 * pad, header)), lead) + 2 * pad;
      room(h);
      const top = y;
      cellsOf.forEach((c, k) => {
        const x = MARGIN + k * colW;
        let at = top - pad;
        for (const line of wrap(words(c, size, header), size, colW - 2 * pad)) {
          drawLine(line, x + pad, at - size, size);
          at -= lead;
        }
      });
      page.drawLine({
        start: { x: MARGIN, y: top - h },
        end: { x: MARGIN + width, y: top - h },
        thickness: header ? 0.9 : 0.4,
        color: header ? rgb(0.1, 0.1, 0.12) : RULE,
      });
      y = top - h;
    };
    y -= 4;
    if (head.some((c) => c.some((r) => r.text.trim() !== ""))) drawRow(head, true);
    for (const r of rows) drawRow(r, false);
    y -= 8;
  };

  blocks.forEach((b, idx) => {
    switch (b.t) {
      case "h": {
        const size = b.level === 1 ? 20 : b.level === 2 ? 14 : 12;
        const lead = b.level === 1 ? 26 : b.level === 2 ? 19 : 17;
        const before = idx === 0 ? 0 : b.level === 1 ? 18 : 12;
        y -= before;
        // a heading is never the last thing on a page
        room(heightOf(b.runs, size, lead, width, true) + LEAD * 2);
        text(b.runs, size, lead, MARGIN, width, true);
        y -= b.level === 1 ? 8 : 3;
        break;
      }
      case "p": {
        const indent = b.quote ? 18 : 0;
        text(b.runs, BODY, LEAD, MARGIN + indent, width - indent);
        y -= 7;
        break;
      }
      case "li": {
        const indent = 16 + b.depth * 16;
        room(LEAD);
        const markW = regular.widthOfTextAtSize(clean(b.marker), BODY);
        page.drawText(clean(b.marker), {
          x: MARGIN + indent - markW - 5,
          y: y - BODY,
          size: BODY,
          font: regular,
          color: rgb(0.1, 0.1, 0.12),
        });
        text(b.runs, BODY, LEAD, MARGIN + indent, width - indent);
        y -= 2;
        break;
      }
      case "hr":
        y -= 6;
        room(10);
        page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + width, y }, thickness: 0.5, color: RULE });
        y -= 12;
        break;
      case "break":
        page = doc.addPage([W, H]);
        y = H - MARGIN;
        break;
      case "table":
        table(b.head, b.rows);
        break;
      case "sign":
        signRow(b.cols);
        break;
    }
  });

  if (bad.size > 0) throw new TypesetError([...bad].sort().slice(0, 8));
  const total = doc.getPageCount();
  if (total > 1)
    doc.getPages().forEach((p, n) => {
      const t = `Page ${n + 1} of ${total}`;
      p.drawText(t, { x: (W - label.widthOfTextAtSize(t, 8.5)) / 2, y: 40, size: 8.5, font: label, color: GREY });
    });
  const pdf = await doc.save({ useObjectStreams: false });
  return { pdf, places, roles, pages: total };
}
