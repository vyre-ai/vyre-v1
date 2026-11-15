// The libraries the viewer's file bodies need (pdf.js for a PDF, ExcelJS for a workbook, fflate for a Word or PowerPoint file) are static files of the app itself (apps/app/public/vendor),
// loaded the first time a file of that kind opens: nothing is fetched from another site, so the app works offline and inside the desktop app, and the first screen's bundle does not grow.
// Web only. Elsewhere the callers say the file has no preview here.

const root = (): string => {
  const g = globalThis as { location?: { origin?: string; href?: string } };
  const origin = g.location?.origin;
  return origin !== undefined && origin !== "null" ? origin : "";
};

const once = new Map<string, Promise<unknown>>();
const memo = <T>(key: string, make: () => Promise<T>): Promise<T> => {
  let p = once.get(key) as Promise<T> | undefined;
  if (!p) {
    p = make();
    once.set(key, p);
    p.catch(() => once.delete(key));
  }
  return p;
};

/** A classic script put in the page once; it sets a global. */
function script(src: string, global: string): Promise<unknown> {
  return memo(src, () => {
    const g = globalThis as unknown as Record<string, unknown> & { document?: Document };
    if (g[global] !== undefined) return Promise.resolve(g[global]);
    return new Promise((ok, no) => {
      const el = g.document?.createElement("script");
      if (!el || !g.document) return no(new Error("no page"));
      el.src = src;
      el.async = true;
      el.onload = () => ok(g[global]);
      el.onerror = () => no(new Error(`could not load ${src}`));
      g.document.head.appendChild(el);
    });
  });
}

/** The minimal slice of pdf.js the viewer uses. */
export interface PdfViewport {
  width: number;
  height: number;
  scale: number;
  convertToViewportRectangle?(r: number[]): number[];
}
export interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
  transform: number[];
  width: number;
  height: number;
}
export interface PdfPage {
  getViewport(o: { scale: number }): PdfViewport;
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): {
    promise: Promise<void>;
    cancel(): void;
  };
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  streamTextContent(): unknown;
  cleanup(): void;
}
export interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}
export interface PdfLib {
  getDocument(o: { url?: string; data?: Uint8Array; password?: string }): {
    promise: Promise<PdfDoc>;
    onPassword?: unknown;
    destroy(): Promise<void>;
  };
  GlobalWorkerOptions: { workerSrc: string };
  TextLayer: new (o: { textContentSource: unknown; container: HTMLElement; viewport: PdfViewport }) => {
    render(): Promise<void>;
    cancel(): void;
  };
}

export function loadPdfjs(): Promise<PdfLib> {
  return memo("pdfjs", async () => {
    // a runtime import of the app's own static file; the bundler never sees it
    const load = new Function("u", "return import" + "(u)") as (u: string) => Promise<PdfLib>;
    const lib = await load(`${root()}/vendor/pdfjs/pdf.js`);
    lib.GlobalWorkerOptions.workerSrc = `${root()}/vendor/pdfjs/pdf.worker.js`;
    return lib;
  });
}

export function loadExcel(): Promise<unknown> {
  return script(`${root()}/vendor/exceljs/exceljs.js`, "ExcelJS");
}

export function loadFflate(): Promise<{
  unzipSync(d: Uint8Array): Record<string, Uint8Array>;
  zipSync(
    d: Record<string, Uint8Array | [Uint8Array, { level?: number; mtime?: number }]>,
    o?: { level?: number },
  ): Uint8Array;
  strFromU8(d: Uint8Array): string;
  strToU8(s: string): Uint8Array;
}> {
  return script(`${root()}/vendor/fflate/fflate.js`, "fflate") as Promise<never>;
}
