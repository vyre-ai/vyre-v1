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
    const content = lines
      .map((l, k) => `BT /F1 16 Tf 56 ${720 - k * 28} Td (${l.replace(/[()\\]/g, "\\$&")}) Tj ET`)
      .join("\n");
    objs[4 + i * 2] =
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${5 + i * 2} 0 R/Resources<</Font<</F1 3 0 R>>>>>>`;
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

/** The entries of a zip, read back (stored and deflated). */
export function unzip(buf: Buffer): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  let end = buf.length - 22;
  while (buf.readUInt32LE(end) !== 0x06054b50) end--;
  const n = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28);
    const el = buf.readUInt16LE(p + 30);
    const cl = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString();
    const lnl = buf.readUInt16LE(off + 26);
    const lel = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
    out[name] = new Uint8Array(method === 8 ? zlib.inflateRawSync(data) : data);
    p += 46 + nl + el + cl;
  }
  return out;
}

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const rel = (id: string, type: string, target: string, ext = false): string =>
  `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${ext ? ' TargetMode="External"' : ""}/>`;

/** A sample Word file: a title and two headings, a bullet list, a table, a picture, a link, a header, a footer, a footnote, styles and numbering, and a tracked change. */
export function makeDocx(): Buffer {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const body = `<w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quarterly plan</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">This plan covers the </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>next quarter</w:t></w:r><w:r><w:t xml:space="preserve"> and links to </w:t></w:r><w:hyperlink r:id="rId9"><w:r><w:rPr><w:u w:val="single"/><w:color w:val="0563C1"/></w:rPr><w:t>the sample site</w:t></w:r></w:hyperlink><w:r><w:t>.</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Goals</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Ship the release</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Review the budget</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>
<w:tr><w:tc><w:tcPr><w:shd w:fill="DDEEFF"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Item</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Owner</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Website</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Casey</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/><wp:docPr id="1" name="Picture 1" descr="A small sample picture"/><a:graphic><a:graphicData><a:blip r:embed="rId8"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
<w:p><w:r><w:br w:type="page"/></w:r><w:r><w:t>Second page text</w:t></w:r></w:p>
<w:p><w:ins w:id="5" w:author="Sam" w:date="2026-11-01T00:00:00Z"><w:r><w:t>An inserted sentence.</w:t></w:r></w:ins></w:p>
<w:sectPr><w:headerReference w:type="default" r:id="rId6"/><w:footerReference w:type="default" r:id="rId7"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body>`;
  return zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rId1", "officeDocument", "word/document.xml")}</Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}>${body}</w:document>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rId6", "header", "header1.xml")}${rel("rId7", "footer", "footer1.xml")}${rel("rId8", "image", "media/image1.png")}${rel("rId9", "hyperlink", "https://example.com/sample", true)}</Relationships>`,
    "word/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style></w:styles>`,
    "word/numbering.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    "word/header1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}><w:p><w:r><w:t>Sample company report</w:t></w:r></w:p></w:hdr>`,
    "word/footer1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:r><w:t>Confidential sample</w:t></w:r></w:p></w:ftr>`,
    "word/footnotes.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${NS}><w:footnote w:id="0"><w:p/></w:footnote><w:footnote w:id="1"><w:p><w:r><w:t>Figures are estimates.</w:t></w:r></w:p></w:footnote></w:footnotes>`,
    "word/media/image1.png": png,
  });
}

/** A sample deck of three slides: a title, a bullet text box with a rectangle, and a table and a picture. */
export function makePptx(): Buffer {
  const A =
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const sp = (
    id: number,
    name: string,
    x: number,
    y: number,
    w: number,
    h: number,
    paras: string[],
    fill?: string,
    size = 1800,
    bold = false,
  ): string =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>${fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : ""}</p:spPr><p:txBody><a:bodyPr/><a:p>${paras.length ? "" : ""}</a:p>${paras.map((t) => `<a:p><a:r><a:rPr lang="en-US" sz="${size}"${bold ? ' b="1"' : ""}/><a:t>${t}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>`;
  const slide = (shapes: string): string =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${A}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld></p:sld>`;
  const s1 = slide(
    sp(2, "Title", 685800, 1600200, 7772400, 1200000, ["Quarterly review"], undefined, 4400, true) +
      sp(3, "Sub", 685800, 3000000, 7772400, 600000, ["Sample company, November"], undefined, 2000),
  );
  const s2 = slide(
    sp(2, "Heading", 457200, 300000, 8229600, 800000, ["Highlights"], undefined, 3200, true) +
      sp(
        3,
        "Body",
        457200,
        1300000,
        5000000,
        3000000,
        ["Revenue grew in every region", "Costs stayed flat", "Hiring starts in January"],
        undefined,
        2000,
      ) +
      sp(4, "Box", 5800000, 1500000, 2800000, 1800000, ["Target met"], "4F81BD", 2400, true),
  );
  const s3 = slide(
    sp(2, "Heading", 457200, 300000, 8229600, 800000, ["Numbers"], undefined, 3200, true) +
      `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="457200" y="1300000"/><a:ext cx="5000000" cy="1200000"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="2500000"/><a:gridCol w="2500000"/></a:tblGrid><a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1600" b="1"/><a:t>Region</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1600" b="1"/><a:t>Growth</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1600"/><a:t>North</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1600"/><a:t>12 percent</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>` +
      `<p:pic><p:nvPicPr><p:cNvPr id="6" name="Logo" descr="Sample logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr><a:xfrm><a:off x="6000000" y="1300000"/><a:ext cx="1500000" cy="1500000"/></a:xfrm></p:spPr></p:pic>`,
  );
  return zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rId1", "officeDocument", "ppt/presentation.xml")}</Relationships>`,
    "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${A}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/><p:sldId id="258" r:id="rId3"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rId1", "slide", "slides/slide1.xml")}${rel("rId2", "slide", "slides/slide2.xml")}${rel("rId3", "slide", "slides/slide3.xml")}</Relationships>`,
    "ppt/slides/slide1.xml": s1,
    "ppt/slides/slide2.xml": s2,
    "ppt/slides/slide3.xml": s3,
    "ppt/slides/_rels/slide3.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rId2", "image", "../media/image1.png")}</Relationships>`,
    "ppt/media/image1.png": png,
  });
}

/** A zip of one entry that is `size` zeros (a bomb): its directory says how big it unpacks to; the file itself is a few kilobytes. */
export function zipOfZeros(size: number): Buffer {
  const big = Buffer.alloc(size);
  const def = zlib.deflateRawSync(big, { level: 9 });
  const crc = zlib.crc32(big) >>> 0;
  const name = Buffer.from("word/document.xml");
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(8, 8);
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(def.length, 18);
  h.writeUInt32LE(size >>> 0, 22);
  h.writeUInt16LE(name.length, 26);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0);
  c.writeUInt16LE(20, 4);
  c.writeUInt16LE(20, 6);
  c.writeUInt16LE(8, 10);
  c.writeUInt32LE(crc, 16);
  c.writeUInt32LE(def.length, 20);
  c.writeUInt32LE(size >>> 0, 24);
  c.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12);
  end.writeUInt32LE(30 + name.length + def.length, 16);
  return Buffer.concat([h, name, def, c, name, end]);
}

