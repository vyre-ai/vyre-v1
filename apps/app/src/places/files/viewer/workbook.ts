// A workbook file opened in the Files viewer's grid: its bytes are read, parsed by ExcelJS (a static file of the app), edited in the grid model, and written back as a new version of the same file.
// Opening a file of a connected Drive or OneDrive goes through the same read and the same write: the write is the Drive save-back (a new revision of the same file), and a stale edit is refused by
// the version it started from, which the connected bar then offers as Keep both or Use theirs.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Grid, sheetFindText } from "../../../../../../ui/src/Viewer/rich/grid-model.ts";
import { itemHits } from "../../../../../../ui/src/Viewer/rich/pdf-model.ts";
import {
  baseline,
  bookFromRows,
  cellWrites,
  editUnsafe,
  readBook,
  sheetCsv,
  writeChanges,
} from "../../../../../../ui/src/Viewer/rich/workbook-io.ts";
import type { XBook } from "../../../../../../ui/src/Viewer/rich/workbook-io.ts";
import { LimitError, tooLargeWords, wordsOf } from "../../../../../../ui/src/Viewer/rich/limits.ts";
import { loadExcel, loadFflate } from "../../../../../../ui/src/Viewer/rich/vendor.ts";
import { colName } from "../../../../../../ui/src/Viewer/rich/formula.ts";
import { contentFor } from "./actions.ts";
import { parseCsv } from "./model.ts";
import type { FilesViewerData } from "./data.tsx";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** A workbook is an .xlsx (the grid reads and writes exactly that); an .xls or .ods stays the quiet "no preview" line. */
export const isXlsx = (name: string, mime: string): boolean => /\.(xlsx|xlsm)$/i.test(name) || mime === XLSX_MIME;

interface ExcelLib {
  Workbook: new () => XBook & { xlsx: { load(b: ArrayBuffer): Promise<unknown>; writeBuffer(): Promise<ArrayBuffer> } };
}

export type WorkbookState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "failed"; words: string }
  | { status: "ready"; grid: Grid };

export interface Workbook {
  state: WorkbookState;
  /** Bumped after each change: the grid redraws. */
  rev: number;
  sheet: number;
  setSheet: (i: number) => void;
  /** Call after the grid changed the model: redraws and saves after a short quiet. */
  changed: () => void;
  saved: number | undefined;
  /** Find: the words of each sheet (a cell per line) and the cell of each match, by sheet. */
  texts: readonly string[];
  matchCells: (find: string) => { all: Set<string>[]; list: { sheet: number; r: number; c: number }[] };
  /** Why the workbook is drawn but not edited here (it has parts a save would drop), or undefined. */
  lock: string | undefined;
  /** Save now. */
  flush: () => Promise<void>;
}

const SAVE_QUIET_MS = 700;

export function useWorkbook(
  d: FilesViewerData,
  fileId: string,
  on: boolean,
  version: { current: number },
  say: (e: unknown) => void,
  bump: number,
  /** A Google Sheet: its first tab as the export's CSV, and whether the person may write cells at Google. Edits go cell by cell through mounts.sheet_write, never through the export. */
  gs: { text: string; write: boolean; csv?: boolean } | null = null,
  /** The file's name and size, read before the file is: a file over the size this viewer reads is refused before it is fetched. */
  meta: { name: string; size: number } = { name: "", size: 0 },
): Workbook {
  const [state, setState] = useState<WorkbookState>({ status: "off" });
  const [rev, setRev] = useState(0);
  const [sheet, setSheet] = useState(0);
  const [saved, setSaved] = useState<number | undefined>(undefined);
  const [lock, setLock] = useState<string | undefined>(undefined);
  const wb = useRef<(XBook & { xlsx: { writeBuffer(): Promise<ArrayBuffer> } }) | null>(null);
  const opened = useRef<ReturnType<typeof baseline>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const again = useRef(false);
  const gridRef = useRef<Grid | null>(null);

  useEffect(() => {
    if (!on) {
      setState({ status: "off" });
      return undefined;
    }
    let live = true;
    setState({ status: "loading" });
    setSheet(0);
    void (async () => {
      try {
        if (gs !== null) {
          const t = parseCsv(gs.text);
          const grid = new Grid(
            bookFromRows(
              [[...t.cols], ...t.rows.map((r) => [...r])],
              "Sheet",
              gs.csv === true ? { plain: true, header: true } : {},
            ),
          );
          gridRef.current = grid;
          opened.current = baseline(grid.book);
          setState({ status: "ready", grid });
          setRev((x) => x + 1);
          return;
        }
        const big = tooLargeWords("xlsx", meta.size);
        if (big !== null) throw new LimitError(big);
        const [r, lib, ff] = await Promise.all([d.call("files.read", { fileId, as: "base64" }), loadExcel(), loadFflate()]);
        const b64 = (r as { base64?: string }).base64 ?? "";
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        // the zip is checked before ExcelJS opens it: a file that unpacks to far more than it should is refused here, and a workbook with parts a save would drop is read only
        setLock(editUnsafe(bytes, ff, meta.name) ?? undefined);
        const book = new (lib as ExcelLib).Workbook();
        await book.xlsx.load(bytes.buffer);
        if (!live) return;
        const grid = new Grid(readBook(book));
        wb.current = book as never;
        gridRef.current = grid;
        opened.current = baseline(grid.book);
        setState({ status: "ready", grid });
        setRev((x) => x + 1);
      } catch (e) {
        if (live) setState({ status: "failed", words: wordsOf(e, "This workbook could not be opened here.") });
      }
    })();
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [d, fileId, on, bump, gs?.text, meta.size]);

  const flush = useCallback(async (): Promise<void> => {
    const grid = gridRef.current;
    const book = wb.current;
    if (!grid) return;
    if (gs !== null && gs.csv === true) {
      // a CSV: the whole text is written back as a new version of the same file
      if (busy.current) {
        again.current = true;
        return;
      }
      busy.current = true;
      try {
        const out = (await d.call("files.write", {
          fileId,
          content: { text: sheetCsv(grid) },
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
      return;
    }
    if (gs !== null) {
      // a Google Sheet: each changed cell is written at Google by the Sheets path that exists (mounts.sheet_write), one value each
      if (busy.current) {
        again.current = true;
        return;
      }
      busy.current = true;
      try {
        for (const w of cellWrites(grid, opened.current))
          await d.call("mounts.sheet_write", {
            fileId,
            range: `${colName(w.c)}${w.r + 1}`,
            values: [[w.value]],
            idempotencyKey: `vw-${fileId}-${w.r}-${w.c}-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
          });
        opened.current = baseline(grid.book);
        setSaved((x) => (x ?? 0) + 1);
      } catch (e) {
        say(e);
      } finally {
        busy.current = false;
        if (again.current) {
          again.current = false;
          void flush();
        }
      }
      return;
    }
    if (!book) return;
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    try {
      writeChanges(grid, book, opened.current);
      const bytes = new Uint8Array(await book.xlsx.writeBuffer());
      const content = await contentFor(d, bytes, XLSX_MIME);
      const out = (await d.call("files.write", {
        fileId,
        content,
        baseVersion: version.current,
        reason: "Edited in the viewer",
      })) as { file?: { version?: number } };
      version.current = out.file?.version ?? version.current + 1;
      setSaved(version.current);
      opened.current = baseline(grid.book);
      if (grid.structure.length > 0) grid.structure.length = 0;
    } catch (e) {
      say(e);
    } finally {
      busy.current = false;
      if (again.current) {
        again.current = false;
        void flush();
      }
    }
  }, [d, fileId, say, version, gs]);

  const changed = useCallback((): void => {
    setRev((x) => x + 1);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_QUIET_MS);
  }, [flush]);

  const grid = state.status === "ready" ? state.grid : null;
  const texts = useMemo(() => (grid ? grid.book.sheets.map((s) => sheetFindText(s).text) : []), [grid, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const matchCells = useCallback(
    (find: string) => {
      const all: Set<string>[] = [];
      const list: { sheet: number; r: number; c: number }[] = [];
      if (!grid || find.trim() === "") return { all, list };
      grid.book.sheets.forEach((s, i) => {
        const f = sheetFindText(s);
        const lines = f.text === "" ? [] : f.text.split("\n");
        const set = new Set<string>();
        for (const h of itemHits(lines, find)) {
          const [r, c] = f.cells[h.item]!;
          set.add(`${r},${c}`);
          list.push({ sheet: i, r, c });
        }
        all[i] = set;
      });
      return { all, list };
    },
    [grid, rev], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return { state, rev, sheet, setSheet, changed, saved, texts, matchCells, lock, flush };
}
