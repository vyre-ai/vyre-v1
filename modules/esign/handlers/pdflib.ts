// The PDF library, loaded when the first document is read or written (27 Nov 2026, the real-server guard): importing it when the server starts was 200 ms of compiling and evaluating in one stretch, and
// nothing needs it until a PDF is prepared, signed or sealed. Every function that uses it awaits `loadPdfLib()` first; the code below that is synchronous then reads it with `lib()`.
import type * as PdfLib from "@cantoo/pdf-lib";

let loaded: typeof PdfLib | null = null;

export async function loadPdfLib(): Promise<void> {
  loaded ??= await import("@cantoo/pdf-lib");
}

/** The library, after `await loadPdfLib()`. */
export function lib(): typeof PdfLib {
  if (!loaded) throw new Error("the PDF library is not loaded: await loadPdfLib() first");
  return loaded;
}
