// A Word or PowerPoint file opened in the Files viewer's own page or slides: its bytes are read, unzipped with fflate (a static file of the app), read into a model, edited there and written back as a new
// version of the same file (a connected Drive or OneDrive file goes back as a new revision through the same write). Only the parts the editor changed are rewritten; the rest of the zip is the file's own.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { paraTexts, readDocx, writeDocx, docAsText } from "../../../../../../ui/src/Viewer/rich/docx.ts";
import type { DocxModel } from "../../../../../../ui/src/Viewer/rich/docx.ts";
import { deckAsText, readPptx, writePptx } from "../../../../../../ui/src/Viewer/rich/pptx.ts";
import type { PptxModel } from "../../../../../../ui/src/Viewer/rich/pptx.ts";
import { LimitError, safeUnzip, tooLargeWords, wordsOf } from "../../../../../../ui/src/Viewer/rich/limits.ts";
import { loadFflate } from "../../../../../../ui/src/Viewer/rich/vendor.ts";
import { contentFor } from "./actions.ts";
import type { FilesViewerData } from "./data.tsx";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export type OfficeKind = "docx" | "pptx";
/** The Office kind a file is edited as here: .docx and .pptx only (an old .doc or .ppt, or an OpenDocument file, stays the quiet "no preview" line). */
export const officeKindOf = (name: string): OfficeKind | null =>
  /\.(docx|docm)$/i.test(name) ? "docx" : /\.(pptx|pptm)$/i.test(name) ? "pptx" : null;
/** A macro-enabled Word, PowerPoint or Excel file is shown and never changed here. */
export const isMacroFile = (name: string): boolean => /\.(docm|pptm|xlsm)$/i.test(name);

const MIMES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
};

export type OfficeState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "failed"; words: string }
  | { status: "ready"; kind: "docx"; doc: DocxModel }
  | { status: "ready"; kind: "pptx"; deck: PptxModel };

export interface Office {
  state: OfficeState;
  /** Bumped when the page must be drawn again (a format or a heading), not after typing. */
  redrawRev: number;
  redraw: () => void;
  /** Bumped after every change, so Find reads the new words. */
  rev: number;
  changed: () => void;
  saved: number | undefined;
  texts: readonly string[];
  imageUrl: (path: string) => string | undefined;
  /** The file's words as the agent reads them (structured text). */
  asText: () => string;
  flush: () => Promise<void>;
}

const SAVE_QUIET_MS = 700;

export function useOffice(
  d: FilesViewerData,
  fileId: string,
  kind: OfficeKind | null,
  version: { current: number },
  say: (e: unknown) => void,
  bump: number,
  /** The file's size, checked before the file is read. */
  size = 0,
): Office {
  const [state, setState] = useState<OfficeState>({ status: "off" });
  const [rev, setRev] = useState(0);
  const [redrawRev, setRedrawRev] = useState(0);
  const [saved, setSaved] = useState<number | undefined>(undefined);
  const urls = useRef(new Map<string, string>());
  const ref = useRef<OfficeState>({ status: "off" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const again = useRef(false);
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve());
  ref.current = state;

  useEffect(() => {
    for (const u of urls.current.values()) URL.revokeObjectURL(u);
    urls.current.clear();
    if (kind === null) {
      setState({ status: "off" });
      return undefined;
    }
    let live = true;
    setState({ status: "loading" });
    void (async () => {
      try {
        const big = tooLargeWords(kind, size);
        if (big !== null) throw new LimitError(big);
        const [r, ff] = await Promise.all([d.call("files.read", { fileId, as: "base64" }), loadFflate()]);
        const bytes = Uint8Array.from(atob((r as { base64?: string }).base64 ?? ""), (c) => c.charCodeAt(0));
        // a file that unpacks to far more than it should is refused from its directory, before anything is unpacked
        const entries = safeUnzip(ff, bytes);
        if (!live) return;
        setState(
          kind === "docx"
            ? { status: "ready", kind, doc: readDocx(entries) }
            : { status: "ready", kind, deck: readPptx(entries) },
        );
        setRev((x) => x + 1);
      } catch (e) {
        if (live)
          setState({
            status: "failed",
            words: wordsOf(e, kind === "docx" ? "This document could not be opened here." : "This deck could not be opened here."),
          });
      }
    })();
    return () => {
      live = false;
      // leaving the file with a change waiting sends it now, not after the pause
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void flushRef.current();
      }
    };
  }, [d, fileId, kind, bump, size]);

  const flush = useCallback(async (): Promise<void> => {
    const st = ref.current;
    if (st.status !== "ready") return;
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    try {
      const ff = await loadFflate();
      const entries = st.kind === "docx" ? writeDocx(st.doc) : writePptx(st.deck);
      const files: Record<string, [Uint8Array, { level: 0 | 6; mtime: number }]> = {};
      for (const [k, v] of Object.entries(entries))
        files[k] = [v, { level: /\.(png|jpe?g|gif|webp)$/i.test(k) ? 0 : 6, mtime: 946684800000 }];
      const bytes = ff.zipSync(files as never);
      const content = await contentFor(d, bytes, st.kind === "docx" ? DOCX_MIME : PPTX_MIME);
      const out = (await d.call("files.write", {
        fileId,
        content,
        baseVersion: version.current,
        reason: "Edited in the viewer",
      })) as { file?: { version?: number } };
      version.current = out.file?.version ?? version.current + 1;
      setSaved(version.current);
    } catch (e) {
      say(e);
    } finally {
      busy.current = false;
      if (again.current) {
        again.current = false;
        void flush();
      }
    }
  }, [d, fileId, say, version]);

  flushRef.current = flush;
  const changed = useCallback((): void => {
    setRev((x) => x + 1);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_QUIET_MS);
  }, [flush]);
  const redraw = useCallback((): void => setRedrawRev((x) => x + 1), []);

  const texts = useMemo(
    () =>
      state.status !== "ready"
        ? []
        : state.kind === "docx"
          ? paraTexts(state.doc)
          : state.deck.slides.map((s) => s.texts),
    [state, rev], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const imageUrl = useCallback((path: string): string | undefined => {
    const st = ref.current;
    if (st.status !== "ready") return undefined;
    const have = urls.current.get(path);
    if (have) return have;
    const bytes = (st.kind === "docx" ? st.doc.entries : st.deck.entries)[path];
    if (!bytes) return undefined;
    const url = URL.createObjectURL(
      new Blob([bytes as BlobPart], {
        type: MIMES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream",
      }),
    );
    urls.current.set(path, url);
    return url;
  }, []);
  const asText = useCallback((): string => {
    const st = ref.current;
    return st.status !== "ready" ? "" : st.kind === "docx" ? docAsText(st.doc) : deckAsText(st.deck);
  }, []);
  return { state, redrawRev, redraw, rev, changed, saved, texts, imageUrl, asText, flush };
}
