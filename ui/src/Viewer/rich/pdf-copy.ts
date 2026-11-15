// A redacted copy of a PDF (web): each page is drawn, the marked areas are painted over, and the page is saved as a picture in a new PDF. A black box laid over live text would leave the words in the file;
// here the words under a mark are never written, and a page with no mark is a picture too, so the copy has no text layer at all (the walk proves it by extracting the copy's text).
import { loadPdfjs } from "./vendor.ts";
import { imagePdf } from "./pdf-model.ts";
import type { CopyPage } from "./pdf-model.ts";

export interface CopyMark {
  page: number;
  box: { x: number; y: number; w: number; h: number };
}

/** Pages are drawn at this many pixels per PDF point: sharp enough to read, small enough for a long file. */
const PX_PER_PT = 1.5;

export async function redactedCopy(data: Uint8Array, marks: readonly CopyMark[]): Promise<Uint8Array> {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: data.slice() }).promise;
  const pages: CopyPage[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const pg = await doc.getPage(n);
      const pt = pg.getViewport({ scale: 1 });
      const vp = pg.getViewport({ scale: PX_PER_PT });
      const c = document.createElement("canvas");
      c.width = Math.ceil(vp.width);
      c.height = Math.ceil(vp.height);
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      ctx.fillStyle = "#000";
      for (const m of marks)
        if (m.page === n) ctx.fillRect(m.box.x * c.width, m.box.y * c.height, m.box.w * c.width, m.box.h * c.height);
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.88));
      if (!blob) throw new Error("no picture");
      pages.push({
        w: pt.width,
        h: pt.height,
        jpeg: new Uint8Array(await blob.arrayBuffer()),
        iw: c.width,
        ih: c.height,
      });
      pg.cleanup();
    }
  } finally {
    void doc.destroy();
  }
  return imagePdf(pages);
}
