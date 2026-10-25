// Small file builders for the previews tests: pictures, zip-based office files and PDFs, made from their parts so a test can say exactly what is inside.

import { deflateRawSync, deflateSync } from "node:zlib";
import { encodePng } from "../handlers/render.ts";
import type { Raster } from "../handlers/render.ts";

export type Rgba = [number, number, number, number];

export function solid(width: number, height: number, c: Rgba = [200, 30, 30, 255]): Raster {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(c, i * 4);
  return { width, height, data };
}

/** A picture whose red grows to the right and green downwards, so scaling and filters change the bytes. */
export function gradient(width: number, height: number): Raster {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set([Math.floor((x * 255) / Math.max(1, width - 1)), Math.floor((y * 255) / Math.max(1, height - 1)), (x * 7 + y * 13) & 255, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

export const png = (width: number, height: number, c?: Rgba): Uint8Array => encodePng(solid(width, height, c));

// ---- PNG with every filter type, palettes, gray and 16-bit ---------------------------------------------------

let table: Uint32Array | null = null;
export function crc32(b: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = (table[(c ^ (b[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export interface RawPng {
  width: number;
  height: number;
  depth: number;
  colorType: number;
  /** unfiltered scanlines, each row packed as the format says */
  rows: Uint8Array[];
  filter?: (row: number) => number;
  palette?: number[][];
  trns?: number[];
  interlace?: number;
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** A PNG written the long way, with the filter type chosen per row. bytes-per-pixel is taken from depth and colour type. */
export function rawPng(o: RawPng): Uint8Array {
  const channels = o.colorType === 0 ? 1 : o.colorType === 2 ? 3 : o.colorType === 3 ? 1 : o.colorType === 4 ? 2 : 4;
  const step = Math.max(1, (channels * o.depth) >> 3);
  const rowBytes = o.rows[0]?.length ?? 0;
  const out = new Uint8Array(o.height * (rowBytes + 1));
  for (let y = 0; y < o.height; y++) {
    const ft = o.filter ? o.filter(y) : 0;
    const row = o.rows[y] as Uint8Array;
    const prev = y > 0 ? (o.rows[y - 1] as Uint8Array) : new Uint8Array(rowBytes);
    out[y * (rowBytes + 1)] = ft;
    for (let x = 0; x < rowBytes; x++) {
      const left = x >= step ? row[x - step] ?? 0 : 0;
      const up = prev[x] ?? 0;
      const upLeft = x >= step ? prev[x - step] ?? 0 : 0;
      const cur = row[x] ?? 0;
      const sub = ft === 0 ? 0 : ft === 1 ? left : ft === 2 ? up : ft === 3 ? (left + up) >> 1 : paeth(left, up, upLeft);
      out[y * (rowBytes + 1) + 1 + x] = (cur - sub) & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, o.width);
  dv.setUint32(4, o.height);
  ihdr[8] = o.depth;
  ihdr[9] = o.colorType;
  ihdr[12] = o.interlace ?? 0;
  const parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr)];
  if (o.palette) parts.push(chunk("PLTE", Uint8Array.from(o.palette.flat())));
  if (o.trns) parts.push(chunk("tRNS", Uint8Array.from(o.trns)));
  parts.push(chunk("IDAT", deflateSync(out)), chunk("IEND", new Uint8Array(0)));
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return all;
}

/** Just enough JPEG for the size to be read from the header (no picture data). */
export function jpegHeader(width: number, height: number): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
}

export function gifHeader(width: number, height: number): Uint8Array {
  return Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, width & 255, width >> 8, height & 255, height >> 8, 0, 0, 0]);
}

export function webp(kind: "VP8 " | "VP8L" | "VP8X", width: number, height: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0x52, 0x49, 0x46, 0x46, 32, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 0);
  for (let i = 0; i < 4; i++) b[12 + i] = kind.charCodeAt(i);
  if (kind === "VP8 ") {
    b[26] = width & 255; b[27] = (width >> 8) & 0x3f; b[28] = height & 255; b[29] = (height >> 8) & 0x3f;
  } else if (kind === "VP8L") {
    b[20] = 0x2f;
    const w = width - 1;
    const h = height - 1;
    b[21] = w & 255; b[22] = ((w >> 8) & 0x3f) | ((h & 3) << 6); b[23] = (h >> 2) & 255; b[24] = (h >> 10) & 0xf;
  } else {
    const w = width - 1;
    const h = height - 1;
    b[24] = w & 255; b[25] = (w >> 8) & 255; b[26] = (w >> 16) & 255; b[27] = h & 255; b[28] = (h >> 8) & 255; b[29] = (h >> 16) & 255;
  }
  return b;
}

export function bmpHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  b[0] = 0x42; b[1] = 0x4d;
  new DataView(b.buffer).setUint32(18, width, true);
  new DataView(b.buffer).setInt32(22, -height, true);
  return b;
}

// ---- zip and office files ------------------------------------------------------------------------------------

/** A zip file; `deflate` entries are compressed, the others stored. */
export function zip(files: Record<string, string | Uint8Array>, deflate = true): Uint8Array {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === "string" ? enc.encode(content) : content;
    const packed = deflate ? deflateRawSync(data) : data;
    const method = deflate ? 8 : 0;
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + nameBytes.length);
    const ldv = new DataView(lh.buffer);
    ldv.setUint32(0, 0x04034b50, true); ldv.setUint16(4, 20, true); ldv.setUint16(8, method, true);
    ldv.setUint32(14, crc, true); ldv.setUint32(18, packed.length, true); ldv.setUint32(22, data.length, true); ldv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);
    const ch = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(ch.buffer);
    cdv.setUint32(0, 0x02014b50, true); cdv.setUint16(4, 20, true); cdv.setUint16(6, 20, true); cdv.setUint16(10, method, true);
    cdv.setUint32(16, crc, true); cdv.setUint32(20, packed.length, true); cdv.setUint32(24, data.length, true); cdv.setUint16(28, nameBytes.length, true); cdv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    local.push(lh, packed);
    central.push(ch);
    offset += lh.length + packed.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const edv = new DataView(end.buffer);
  edv.setUint32(0, 0x06054b50, true); edv.setUint16(8, central.length, true); edv.setUint16(10, central.length, true); edv.setUint32(12, cdSize, true); edv.setUint32(16, offset, true);
  const parts = [...local, ...central, end];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Each string is a paragraph; "\t" inside becomes a tab element and "\n" a line break. */
export function docx(paragraphs: string[], deflate = true): Uint8Array {
  const runs = (p: string): string => p.split(/(\t|\n)/).map((part) => (part === "\t" ? "<w:r><w:tab/></w:r>" : part === "\n" ? "<w:r><w:br/></w:r>" : part === "" ? "" : `<w:r><w:t xml:space="preserve">${esc(part)}</w:t></w:r>`)).join("");
  const body = paragraphs.map((p) => `<w:p>${runs(p)}</w:p>`).join("");
  return zip({
    "[Content_Types].xml": "<Types/>",
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  }, deflate);
}

export function pptx(slides: string[][]): Uint8Array {
  const files: Record<string, string> = { "[Content_Types].xml": "<Types/>" };
  slides.forEach((paras, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = `<p:sld><p:cSld><p:spTree><p:sp><p:txBody>${paras.map((p) => `<a:p><a:r><a:t>${esc(p)}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  });
  return zip(files);
}

export interface Sheet { name: string; rows: (string | number | boolean | null)[][] }

/** Strings go to the shared string table, except those starting with "inline:" which are written inline. */
export function xlsx(sheets: Sheet[]): Uint8Array {
  const shared: string[] = [];
  const sstIndex = (s: string): number => {
    const at = shared.indexOf(s);
    if (at >= 0) return at;
    shared.push(s);
    return shared.length - 1;
  };
  const col = (n: number): string => {
    let s = "";
    for (let v = n + 1; v > 0; v = Math.floor((v - 1) / 26)) s = String.fromCharCode(65 + ((v - 1) % 26)) + s;
    return s;
  };
  const files: Record<string, string> = { "[Content_Types].xml": "<Types/>" };
  const sheetTags: string[] = [];
  const rels: string[] = [];
  sheets.forEach((sh, i) => {
    sheetTags.push(`<sheet name="${esc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`);
    rels.push(`<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`);
    const rows = sh.rows.map((row, r) => {
      const cells = row.map((v, c) => {
        if (v === null || v === "") return "";
        const ref = `${col(c)}${r + 1}`;
        if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
        if (typeof v === "boolean") return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
        if (v.startsWith("inline:")) return `<c r="${ref}" t="inlineStr"><is><t>${esc(v.slice(7))}</t></is></c>`;
        return `<c r="${ref}" t="s"><v>${sstIndex(v)}</v></c>`;
      }).join("");
      return `<row r="${r + 1}">${cells}</row>`;
    }).join("");
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
  });
  files["xl/workbook.xml"] = `<workbook xmlns:r="x"><sheets>${sheetTags.join("")}</sheets></workbook>`;
  files["xl/_rels/workbook.xml.rels"] = `<Relationships>${rels.join("")}</Relationships>`;
  files["xl/sharedStrings.xml"] = `<sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`;
  return zip(files);
}

export function odt(paragraphs: string[]): Uint8Array {
  return zip({
    mimetype: "application/vnd.oasis.opendocument.text",
    "content.xml": `<office:document-content><office:body><office:text>${paragraphs.map((p) => `<text:p>${esc(p).replace(/\t/g, "<text:tab/>").replace(/ {2}/g, " <text:s/>")}</text:p>`).join("")}</office:text></office:body></office:document-content>`,
  }, false);
}

// ---- pdf ------------------------------------------------------------------------------------------------------

export interface PdfOptions {
  /** compress content streams with Flate */
  flate?: boolean;
  /** write the page objects only inside an object stream the reader cannot open (no page count from objects) */
  hidden?: boolean;
}

const pdfEsc = (s: string): string => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** A PDF with one page per element; each page is a list of lines drawn with Td, or raw content stream text when it starts with "RAW:". */
export function pdf(pages: string[][], o: PdfOptions = {}): Uint8Array {
  const objs: Uint8Array[] = [];
  const enc = new TextEncoder();
  const add = (parts: (string | Uint8Array)[]): number => {
    const bytes = parts.map((p) => (typeof p === "string" ? enc.encode(p) : p));
    const out = new Uint8Array(bytes.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of bytes) { out.set(p, at); at += p.length; }
    objs.push(out);
    return objs.length;
  };
  const kids: number[] = [];
  const first = 3; // catalog = 1, pages = 2, then (page, content) pairs
  pages.forEach((_lines, i) => kids.push(first + i * 2));
  add([`<< /Type /Catalog /Pages 2 0 R >>`]);
  add([`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pages.length} >>`]);
  pages.forEach((lines, i) => {
    const pageNo = first + i * 2;
    add([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pageNo + 1} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>`]);
    const raw = lines[0]?.startsWith("RAW:") ? (lines[0] as string).slice(4) : `BT /F1 12 Tf 72 720 Td ${lines.map((l, k) => `${k === 0 ? "" : "0 -14 Td "}(${pdfEsc(l)}) Tj`).join(" ")} ET`;
    const data = o.flate ? deflateSync(enc.encode(raw)) : enc.encode(raw);
    add([`<< /Length ${data.length}${o.flate ? " /Filter /FlateDecode" : ""} >>\nstream\n`, data, `\nendstream`]);
  });
  const header = enc.encode("%PDF-1.4\n");
  const chunks: Uint8Array[] = [header];
  objs.forEach((body, i) => {
    chunks.push(enc.encode(`${i + 1} 0 obj\n`), body, enc.encode("\nendobj\n"));
  });
  chunks.push(enc.encode(`trailer\n<< /Root 1 0 R /Size ${objs.length + 1} >>\n%%EOF\n`));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
