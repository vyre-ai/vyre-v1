// What the viewers refuse to open, said in words. A file is read into the page, so a hostile one (a few kilobytes that unpack to a gigabyte, a PDF of a million pages) must be turned away before
// it is read or unpacked, never after the tab has grown. Every cap here is checked from the sizes a file declares (a file's size, a zip's directory, a PDF's page count) before the work is done.

/** The most bytes of a file each viewer reads. */
export const MAX_FILE_BYTES = { pdf: 150 * 1024 * 1024, xlsx: 40 * 1024 * 1024, docx: 40 * 1024 * 1024, pptx: 100 * 1024 * 1024 } as const;
/** What a zip may unpack to: no one entry over, and no total over; and how many entries it may have. */
export const MAX_ENTRY_BYTES = 100 * 1024 * 1024;
export const MAX_UNPACKED_BYTES = 300 * 1024 * 1024;
export const MAX_ENTRIES = 5000;
/** A PDF with more pages than this is not opened. */
export const MAX_PDF_PAGES = 5000;

/** A refusal with the sentence a person reads. */
export class LimitError extends Error {
  words: string;
  constructor(words: string) {
    super(words);
    this.name = "LimitError";
    this.words = words;
  }
}

const mb = (n: number): string => `${Math.round(n / (1024 * 1024))} MB`;

/** The sentence for a file over the size its viewer reads, or null when it is within it. */
export function tooLargeWords(kind: keyof typeof MAX_FILE_BYTES, size: number): string | null {
  const cap = MAX_FILE_BYTES[kind];
  return size > cap ? `This file is over ${mb(cap)}, which is more than can be drawn here. Open it in its own app.` : null;
}

export interface UnzipApi {
  unzipSync(
    d: Uint8Array,
    o?: { filter?: (f: { name: string; size: number; originalSize: number; compression: number }) => boolean },
  ): Record<string, Uint8Array>;
}

/**
 * Unpacks a zip, or refuses it before anything is unpacked: every entry's declared original size is checked as the directory is read (the filter runs before an entry is inflated), against a cap on
 * one entry, a cap on the total and a cap on the count. `want` picks the entries to unpack (default: all); the caps apply to every entry the directory lists, wanted or not.
 */
export function safeUnzip(
  ff: UnzipApi,
  bytes: Uint8Array,
  want: (name: string) => boolean = () => true,
  names?: string[],
): Record<string, Uint8Array> {
  let total = 0;
  let count = 0;
  const out = ff.unzipSync(bytes, {
    filter: (f) => {
      count += 1;
      total += f.originalSize;
      names?.push(f.name);
      if (count > MAX_ENTRIES) throw new LimitError("This file has too many parts to open here. Open it in its own app.");
      if (f.originalSize > MAX_ENTRY_BYTES || total > MAX_UNPACKED_BYTES)
        throw new LimitError(`This file unpacks to more than ${mb(MAX_UNPACKED_BYTES)}, so it is not opened here. Open it in its own app.`);
      return want(f.name);
    },
  });
  return out;
}

/** The sentence a failure is shown with: a refusal says its own words, anything else is the plain "could not be opened". */
export const wordsOf = (e: unknown, fallback: string): string => (e instanceof LimitError ? e.words : fallback);

/** The only addresses a link drawn from a file's content may have: web addresses, mail, and an anchor in the same document. Everything else (javascript:, data:, vbscript:, file:, //host) is plain text. */
export function safeHref(href: string | undefined): string | undefined {
  if (href === undefined) return undefined;
  // browsers ignore tabs, line breaks and other control characters inside a scheme ("java\tscript:")
  // eslint-disable-next-line no-control-regex
  const h = href.replace(/[\u0000- \u007f-\u009f]/g, "");
  if (/^#[^\s]*$/.test(h) && h.length > 1) return href.trim();
  return /^(https?:\/\/[^/\s]|mailto:[^\s]+@)/i.test(h) ? href.trim() : undefined;
}
