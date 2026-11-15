// Neutral sample files for the viewer walks, built here byte by byte: a PDF of any number of pages, and the zips a workbook, a Word file and a deck are. No real names and no real data.
import zlib from "node:zlib";

/** A correct PDF (cross-reference table and all): one Helvetica line group per page. */
export function makePdf(pages: readonly (readonly string[])[]): Buffer {
  const objs: string[] = [];
  const n = pages.length;
  objs[1] = "<</Type/Catalog/Pages 2 0 R>>";
  objs[2] = `<</Type/Pages/Kids[${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}]/Count ${n}>>`;
  objs[3] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>";
  pages.forEach((lines, i) => {
    const content = lines.map((l, k) => `BT /F1 16 Tf 56 ${720 - k * 28} Td (${l.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
    objs[4 + i * 2] = `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${5 + i * 2} 0 R/Resources<</Font<</F1 3 0 R>>>>>>`;
    objs[5 + i * 2] = `<</Length ${content.length}>>\nstream\n${content}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const at: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    at[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const x = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(at[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<</Size ${objs.length}/Root 1 0 R>>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** The pages of the sample report: page k says its number and a sentence with the word "report" in it. */
export const reportPages = (count: number): string[][] =>
  Array.from({ length: count }, (_, i) => [
    `Section ${i + 1} of the report`,
    `Page ${i + 1} describes the quarterly report figures.`,
    i % 5 === 0 ? `Contact: alex.sample@example.com` : `Nothing more on this page.`,
  ]);

/** A zip with stored (uncompressed-then-deflated) entries: enough for an Office file. */
export function zip(entries: Record<string, string | Buffer>): Buffer {
  const files: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const def = zlib.deflateRawSync(raw);
    const crc = zlib.crc32(raw) >>> 0;
    const nm = Buffer.from(name);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0, 6);
    h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(def.length, 18);
    h.writeUInt32LE(raw.length, 22);
    h.writeUInt16LE(nm.length, 26);
    files.push(h, nm, def);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(def.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(nm.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nm);
    offset += h.length + nm.length + def.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, cd, end]);
}
