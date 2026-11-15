// A real text extractor for a PDF in node: pdf.js itself, from the app's vendored files, reading every page's text items. The redacted copy is checked with this, not with a pattern in its bytes.
import { makePdf } from "./viewer-fixtures.ts";

type Lib = {
  getDocument(o: { data: Uint8Array; isEvalSupported?: boolean; verbosity?: number }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: { str: string }[] }> }>;
    }>;
  };
  GlobalWorkerOptions: { workerSrc: string };
};

export async function pdfText(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  const lib = (await import(new URL("../public/vendor/pdfjs/pdf.js", import.meta.url).href)) as Lib;
  lib.GlobalWorkerOptions.workerSrc = new URL("../public/vendor/pdfjs/pdf.worker.js", import.meta.url).href;
  const doc = await lib.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  let text = "";
  for (let n = 1; n <= doc.numPages; n++)
    text += (await (await doc.getPage(n)).getTextContent()).items.map((i) => i.str).join(" ") + "\n";
  return { pages: doc.numPages, text };
}

export const samplePdfBytes = (pages: string[][]): Uint8Array => new Uint8Array(makePdf(pages));
