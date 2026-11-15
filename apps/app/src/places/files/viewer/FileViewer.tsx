// The Files Viewer (spec 3.5, 2.16): one file open in the shared Viewer, in a tab or beside the chat. It reads the file (files.viewer_data), its comments (files.comments.list) and its
// markup (files.markup.get), and every change a person makes is one capability call: a pin on an image or a comment on a passage is files.comments.add, a resolved one files.comments.resolve,
// freehand drawing files.markup.save, an edit in place files.save with the version it started from. A refusal shows as a quiet line and the screen keeps what the person typed.
// The file to open comes from the tab hash (`subject=file:<id>`); this screen never reads the hash itself.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { isPhoneWidth } from "../../../../../../ui/src/SidePane/layout.ts";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { Viewer } from "../../../../../../ui/src/Viewer/index.tsx";
import type { RichCtx } from "../../../../../../ui/src/Viewer/rich/types.ts";
import type { DocBlock, MarkupBox, Stroke } from "../../../../../../ui/src/Viewer/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { fileLink, noPreviewWords, openInWords } from "../open-in.ts";
import type { FileLink } from "../open-in.ts";
import { commentOnPage, commentOnQuote, contentFor, pinArea, resolveComment, saveMarkup, saveText } from "./actions.ts";
import { GridView } from "../../../../../../ui/src/Viewer/rich/GridView.tsx";
import { isXlsx, useWorkbook } from "./workbook.ts";
import { officeKindOf, useOffice } from "./office.ts";
import { DocPage } from "../../../../../../ui/src/Viewer/rich/DocPage.tsx";
import { SlideView } from "../../../../../../ui/src/Viewer/rich/SlideView.tsx";
import { PdfPages } from "../../../../../../ui/src/Viewer/rich/PdfPages.tsx";
import { redactedCopy } from "../../../../../../ui/src/Viewer/rich/pdf-copy.ts";
import { noTextLayer } from "../../../../../../ui/src/Viewer/rich/pdf-model.ts";
import { useFilesViewerData } from "./data.tsx";
import { useFileLinks } from "../links.ts";
import { ConnectedBar } from "./ConnectedBar.tsx";
import { FileMarkdownEditor } from "./FileMarkdownEditor.tsx";
import {
  versionRows,
  providerRevisionRows,
  boxesOf,
  pageCommentsOf,
  pagePins,
  nodeFor,
  docCommentsOf,
  docsMarkdown,
  isEditable,
  isOffice,
  kindLabel,
  officeBlocks,
  parseCsv,
  strokesOf,
  subtitleOf,
  textToBlocks,
  viewerKindOf,
  GRID_MAX_BYTES,
  FETCH_FAILURE_CODES,
  fetchFailureWords,
  GRID_PREVIEW_BYTES,
} from "./model.ts";
import { TypeTile } from "../FileList.tsx";
import { tileLabel } from "../tree/model.ts";
import { GoogleTile, WithProviderMark, googleAppOf } from "../marks.tsx";
import type { FileComment, ViewerData } from "./model.ts";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { copyLinkText, itemLink } from "../../../share/rows.ts";
import { ActivityPanel, LayerBanner, LayerTools, RedactPanel, jumpToMark, useLayer, viewerMarks } from "./redact.tsx";
import type { Access } from "./redact.tsx";

type Markup = CapMap["files.markup.get"]["out"];
const SAVE_DELAY_MS = 600;

export interface FileViewerProps {
  fileId: string;
  /** In the side pane beside the chat rather than a tab of its own. */
  pane?: "main" | "side";
}

type Graph = CapMap["memory.graph"]["out"];
type Load =
  | { status: "loading"; /** the provider, when the file is a live placeholder being fetched from it */ from?: string }
  | { status: "gone" }
  | {
      status: "failed";
      /** the provider the content could not be got from, and the cause the server named */ from: string;
      code: string;
    }
  | { status: "ready"; data: ViewerData; comments: readonly FileComment[]; markup: Markup; graph: Graph | null };

export function FileViewer({ fileId, pane = "main" }: FileViewerProps): ReactElement {
  const d = useFilesViewerData();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [note, setNote] = useState<string | null>(null);
  // where a file from a connected folder opens at its provider (Google Docs, Word, Excel, Dropbox); null for a file Vyre holds itself
  const [link, setLink] = useState<FileLink | null>(null);
  const version = useRef(0);
  const [rev, setRev] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((e: unknown): void => setNote(e instanceof Error ? e.message : "That did not work."), []);
  // Redaction for AI: the layer of this file, the Redact and Activity tabs, and the access menu
  const layer = useLayer(d, fileId, load.status === "ready" ? load.data.file.name : undefined);
  const [panel, setPanel] = useState<"redact" | "activity" | null>(null);
  const accessMenu = useMenu();
  const width = useWindowDimensions().width;
  useEffect(() => {
    if (layer.said) {
      setNote(layer.said);
      layer.setSaid(null);
    }
  }, [layer]);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoad({ status: "loading" });
    void (async () => {
      // a live file whose content is not here yet is fetched from its provider while this waits: say so, and say what failed if it does
      let from = "";
      try {
        const head = (await d.call("files.get", { fileId })) as {
          file: { size: number; source?: { provider: string } };
        };
        if (head.file.source && head.file.size === 0) {
          from = head.file.source.provider;
          if (live) setLoad({ status: "loading", from });
        }
      } catch {
        /* the real read below says what is wrong */
      }
      try {
        const data = (await d.call("files.viewer_data", { fileId })) as ViewerData;
        const comments = ((await d.call("files.comments.list", { fileId })) as { comments: FileComment[] }).comments;
        const markup =
          data.file.kind === "image" ? ((await d.call("files.markup.get", { fileId })) as Markup) : { strokes: [] };
        // the note's place in the memory graph gives its Links to and Linked from; a file with no node has none, and a failed read draws none
        const graph =
          data.file.kind === "markdown" || data.file.kind === "text"
            ? ((await d.call("memory.graph", { scope: "space" }).catch(() => null)) as Graph | null)
            : null;
        version.current = data.file.version;
        if (live) setLoad({ status: "ready", data, comments, markup, graph });
      } catch (e) {
        const code =
          (e as { code?: string; error?: { code?: string } } | null)?.code ??
          (e as { error?: { code?: string } } | null)?.error?.code;
        if (live)
          setLoad(
            from !== "" && FETCH_FAILURE_CODES.test(code ?? "")
              ? { status: "failed", from, code: code ?? "" }
              : { status: "gone" },
          );
      }
    })();
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [d, fileId, attempt]);

  const mounted = (load.status === "ready" && load.data.file.source !== undefined) || load.status === "failed";
  useEffect(() => {
    setLink(null);
    if (!mounted || !d.openUrl) return undefined;
    let live = true;
    void fileLink(d.call, fileId).then((l) => {
      if (live) setLink(l);
    });
    return () => {
      live = false;
    };
  }, [d, fileId, mounted, rev]);

  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(null), 4500);
    return () => clearTimeout(t);
  }, [note]);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const comments = ((await d.call("files.comments.list", { fileId })) as { comments: FileComment[] }).comments;
      setLoad((cur) => (cur.status === "ready" ? { ...cur, comments } : cur));
    } catch (e) {
      say(e);
    }
  }, [d, fileId, say]);

  const ready = load.status === "ready" ? load : null;
  // a PDF is drawn as its pages by pdf.js from the file's own bytes: its address, the words of each page (for Find) and the pages' count
  // the pages, grids and slides are drawn by the web page (canvas and the DOM); anywhere else the file keeps its words
  const web = typeof document !== "undefined" && typeof ResizeObserver === "function";
  const isPdf = web && ready?.data.file.kind === "pdf";
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [pdfTexts, setPdfTexts] = useState<readonly string[]>([]);
  const [pdfDone, setPdfDone] = useState(false);
  useEffect(() => {
    setPdfData(null);
    setPdfTexts([]);
    setPdfDone(false);
    if (!isPdf) return undefined;
    let live = true;
    void d.call("files.read", { fileId, as: "base64" }).then(
      (r) => {
        const b = (r as { base64?: string }).base64;
        if (live && typeof b === "string") setPdfData(Uint8Array.from(atob(b), (ch) => ch.charCodeAt(0)));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [d, fileId, isPdf, rev]);
  // an .xlsx opens as a real grid: every sheet, formats, formulas, and typing that is saved back as a new version
  const isBook =
    web &&
    ready !== null &&
    ready.data.file.kind === "spreadsheet" &&
    isXlsx(ready.data.file.name, ready.data.file.mime);
  // a Word file or a deck opens as its own pages or slides, and is typed into where the file allows
  const okind = web && ready !== null && isOffice(ready.data.file.kind) ? officeKindOf(ready.data.file.name) : null;
  const off = useOffice(d, fileId, okind, version, say, attempt);
  const offReady = off.state.status === "ready" ? off.state : null;
  const kind = offReady
    ? "document"
    : ready
      ? isPdf && pdfData === null
        ? "other"
        : viewerKindOf(isPdf ? { ...ready.data, previewUrl: pdfData !== null ? "pdf" : undefined } : ready.data)
      : "other";
  // a Google Doc is kept as Markdown: it is read as a note is, without Drive's escapes
  const app = ready ? googleAppOf(ready.data.file) : null;
  // the text the file holds after the saves of the Markdown editor, so the page reads what was just written once Edit is left
  const [liveText, setLiveText] = useState<string | null>(null);
  useEffect(() => {
    setLiveText(null);
  }, [fileId]);
  const rawText = liveText ?? ready?.data.text ?? "";
  const text = app === "gdocs" ? docsMarkdown(rawText) : rawText;
  // a Google Sheet is the same grid over its export's first tab, and a cell typed there is written at Google by the Sheets path that exists (mounts.sheet_write), never by saving the export over it
  const isGSheet = web && app === "gsheets" && rawText.trim() !== "";
  const providerEdit =
    ready !== null && ready.data.snapshot?.editVia === "provider_api" && ready.data.connected?.viewOnly !== true;
  // a CSV or TSV opens in the same grid and is written back as a new version; a file read only in part (a large one) is never written, since its rest would be lost
  const isCsv =
    web &&
    ready !== null &&
    ready.data.file.kind === "spreadsheet" &&
    !isBook &&
    /\.csv$/i.test(ready.data.file.name) &&
    rawText.trim() !== "";
  const csvWhole = ready !== null && ready.data.file.size <= GRID_PREVIEW_BYTES;
  const wbk = useWorkbook(
    d,
    fileId,
    isBook || isGSheet || isCsv,
    version,
    say,
    attempt,
    isGSheet ? { text: rawText, write: providerEdit } : isCsv ? { text: rawText, write: csvWhole, csv: true } : null,
  );
  const gDocEdit = app === "gdocs" && providerEdit;
  // a Google Doc's lines as they were when it opened, so an edited line is found at Google by its old words (mounts.doc_replace_text) and changed in the Doc itself
  const gdocText = useRef(new Map<string, string>());
  useEffect(() => {
    if (app === "gdocs") gdocText.current = new Map(textToBlocks(text, "markdown").map((b) => [b.id, b.text]));
  }, [app, text]);
  const fileLinks = useFileLinks(
    d,
    ready && app === null ? { folderId: ready.data.file.folderId } : null,
    kind === "document" ? text : "",
  );
  // a Word file or a deck is read from its Markdown: headings, lists, tables, pictures, and a deck's slides with their notes
  const office = ready !== null && isOffice(ready.data.file.kind);
  const blocks = useMemo(
    () =>
      offReady
        ? offReady.kind === "docx"
          ? offReady.doc.paras.map((q) => ({ id: q.id, tag: "p" as const, text: q.text }))
          : offReady.deck.slides.map((sl) => ({ id: `sl${sl.n}`, tag: "p" as const, text: sl.texts }))
        : wbk.state.status === "ready"
          ? wbk.texts.map((t, i) => ({ id: `sh${i + 1}`, tag: "p" as const, text: t }))
          : isPdf && kind === "document"
            ? pdfTexts.map((t, i) => ({ id: `pg${i + 1}`, tag: "p" as const, text: t }))
            : ready && kind === "document"
              ? office
                ? officeBlocks(text)
                : textToBlocks(text, app === "gdocs" ? "markdown" : ready.data.file.kind)
              : [],
    [ready, kind, text, app, office, isPdf, pdfTexts, wbk.state.status, wbk.texts, offReady, off.rev],
  );
  const sheet = useMemo(() => (kind === "csv" ? parseCsv(text) : undefined), [kind, text]);
  const boxes = useMemo(() => (ready ? boxesOf(ready.comments) : []), [ready]);
  const strokes = useMemo(() => (ready ? strokesOf(ready.markup.strokes) : []), [ready]);
  // the Redact for AI boxes on pages of a PDF
  const pdfMarks = useMemo(
    () =>
      (layer.list?.marks ?? []).flatMap((m) =>
        m.kind === "redact" && m.shape === "box" && m.box !== undefined && m.page !== undefined
          ? [{ id: m.markId, page: m.page, box: m.box }]
          : [],
      ),
    [layer.list],
  );

  if (load.status === "loading")
    return (
      <View
        testID="file-viewer-loading"
        style={s.frame}
        accessibilityLabel={load.from ? `Getting this from ${load.from}` : "Loading the file"}
      >
        <View style={s.skHead} />
        <View style={s.skBody} />
        {load.from ? (
          <Text style={s.getting} accessibilityLiveRegion="polite" testID="file-viewer-getting">
            {`Getting this from ${load.from}`}
          </Text>
        ) : null}
      </View>
    );
  if (load.status === "failed") {
    const fw = fetchFailureWords(load.code, load.from);
    return (
      <View
        testID="file-viewer-failed"
        style={[s.frame, s.failedFrame]}
        accessibilityLabel={`Could not get this from ${load.from}`}
      >
        <View style={s.failedBox}>
          <States
            kind="empty"
            title={fw.words}
            icon="offline"
            {...(fw.retry ? { action: { label: "Try again", onPress: () => setAttempt((n) => n + 1) } } : {})}
          />
        </View>
        {link && d.openUrl ? (
          <Pressable
            accessibilityRole="link"
            testID="file-viewer-failed-open"
            onPress={() => d.openUrl?.(link.webUrl)}
            style={s.failedOpen}
          >
            <Text style={s.failedOpenText}>{openInWords(link.openIn)}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  if (load.status === "gone" || !ready)
    return (
      <View
        testID="file-viewer-gone"
        style={s.frame}
        accessibilityLabel="That file is not here, or you may not open it."
      >
        <States kind="empty" title="File not available" icon="doc" />
      </View>
    );

  const file = ready.data.file;
  const now = d.clock().now;
  // a spreadsheet too big to draw: say so and point at where the whole file opens (a 50 MB CSV is not sent to the page)
  if (file.kind === "spreadsheet" && file.size > GRID_MAX_BYTES && (ready.data.text ?? "") === "")
    return (
      <View testID="file-viewer-toolarge" style={[s.frame, s.failedFrame]} accessibilityLabel="Too large to preview">
        <View style={s.failedBox}>
          <States kind="empty" title="Too large to preview here" icon="doc" />
        </View>
        {link && d.openUrl ? (
          <Pressable
            accessibilityRole="link"
            testID="file-viewer-toolarge-open"
            onPress={() => d.openUrl?.(link.webUrl)}
            style={s.failedOpen}
          >
            <Text style={s.failedOpenText}>{openInWords(link.openIn)}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  const addBox = (next: readonly MarkupBox[]): void => {
    const known = new Set(boxes.map((b) => b.id));
    const fresh = next.find((b) => !known.has(b.id));
    if (!fresh) {
      void reload();
      return;
    }
    void pinArea(d, fileId, fresh, fresh.text).then(reload).catch(say);
  };
  const saveStrokes = (next: readonly Stroke[]): void => {
    void saveMarkup(d, fileId, next).catch(say);
  };
  const sheetCount = Array.isArray(ready.data.sheets) ? ready.data.sheets.length : 0;
  const firstOfMany = file.kind === "spreadsheet" && sheetCount > 1 && wbk.state.status !== "ready";
  const cutShort = file.kind === "spreadsheet" && file.size > GRID_PREVIEW_BYTES && file.size <= GRID_MAX_BYTES;
  const edit = (next: readonly DocBlock[]): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void saveText(d, fileId, next, file.kind, version.current)
        .then((v) => {
          version.current = v;
        })
        .catch(say);
    }, SAVE_DELAY_MS);
  };

  // a Google Doc line edited in the viewer is replaced in the Doc itself: found by its old words and swapped for the new ones, which shows in the Doc's own history
  const editGDoc = (next: readonly DocBlock[]): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void (async () => {
        for (const b of next) {
          const old = gdocText.current.get(b.id);
          if (old === undefined || old === b.text || old.trim() === "") continue;
          if (/[*_`[\]]/.test(old) || /[*_`[\]]/.test(b.text)) {
            setNote("This line has formatting that cannot be changed from here. Open it in Google Docs.");
            continue;
          }
          try {
            await d.call("mounts.doc_replace_text", {
              fileId,
              find: old,
              replace: b.text,
              matchCase: true,
              idempotencyKey: `gdoc-${fileId}-${b.id}-${Date.now()}`,
            });
            gdocText.current.set(b.id, b.text);
            setNote("Changed in Google Docs.");
          } catch (e) {
            say(e);
          }
        }
      })();
    }, SAVE_DELAY_MS);
  };
  // a Markdown file is edited in the one Markdown editor, which saves it as new versions by itself
  const mdEditor = file.kind === "markdown" && app === null && !office && isEditable(ready.data);
  const node = ready.graph ? nodeFor(ready.graph, file.name) : null;
  // Preview as agent: the words an agent reads, as blocks of the same kind
  const shownBlocks = layer.preview && layer.view?.text ? textToBlocks(layer.view.text, file.kind) : blocks;
  const done = (): void => {
    void layer.run("files.review", { fileId }, "Reviewed. Agents can read the redacted version");
  };
  const setAccess = (value: Access | null): void => {
    void layer.run(
      "files.agent_access.set",
      { target: { type: "file", id: fileId }, value },
      value === null ? "Follows the folder again" : "Agent access changed",
    );
  };
  const openAccess = (x: number, y: number): void => {
    const cur = layer.list?.access;
    accessMenu.show(
      [
        { label: "Available", checked: cur?.value === "on" && cur.own, onSelect: () => setAccess("on") },
        { label: "Redacted", checked: cur?.value === "redact" && cur.own, onSelect: () => setAccess("redact") },
        { label: "Not available", checked: cur?.value === "off" && cur.own, onSelect: () => setAccess("off") },
        { separator: true },
        {
          label: `Same as the folder (${cur?.inherited === "redact" ? "Redacted" : cur?.inherited === "off" ? "Not available" : "Available"})`,
          checked: cur?.own === false,
          onSelect: () => setAccess(null),
        },
      ],
      x,
      y,
      "other",
    );
  };
  // History: the versions of the file, each one restorable (files.versions, files.restore_version); More: the file's link and name
  const openHistory = (x: number, y: number): void => {
    const provider = load.status === "ready" ? load.data.connected?.provider : undefined;
    void Promise.all([
      d.call("files.versions", { fileId }),
      // the provider's own revisions of a file of a connected folder, listed with Vyre's versions; a provider that cannot be asked just leaves its group out
      provider !== undefined
        ? d.call("mounts.history", { fileId }).catch(() => ({ revisions: [] }))
        : Promise.resolve({ revisions: [] }),
    ]).then(([out, theirs]) => {
      const rows = versionRows(
        (out as { versions: { versionId: string; n: number; by: string; at: number; reason?: string }[] }).versions,
        d.name,
      );
      const there = providerRevisionRows(
        (theirs as { revisions: Parameters<typeof providerRevisionRows>[0] }).revisions,
        d.name,
        provider ?? "",
      );
      accessMenu.show(
        rows.length === 0 && there.length === 0
          ? [{ head: "No earlier versions yet." }]
          : [
              ...(there.length > 0
                ? [
                    { head: `Kept at ${provider}. Pick one to put it back.` },
                    ...there.map(
                      (r): MenuEntry => ({
                        label: r.label,
                        ...(r.revisionId === null
                          ? {}
                          : {
                              onSelect: () =>
                                void d.call("mounts.restore", { fileId, revisionId: r.revisionId }).then(() => {
                                  setNote("Put back. It goes out like any edit.");
                                  setRev((x) => x + 1);
                                }, say),
                            }),
                      }),
                    ),
                  ]
                : []),
              { head: "Versions. Pick one to restore it." },
              ...rows.map(
                (r): MenuEntry => ({
                  label: r.label,
                  ...(r.versionId === null
                    ? {}
                    : {
                        onSelect: () =>
                          void d.call("files.restore_version", { fileId, versionId: r.versionId }).then(() => {
                            setNote(`Restored v${r.n}.`);
                            setRev((x) => x + 1);
                          }, say),
                      }),
                }),
              ),
            ],
        x,
        y,
        "other",
        { label: "History" },
      );
    }, say);
  };
  const copyText = (text: string, done: string): void => {
    void Promise.resolve(
      (globalThis as { navigator?: { clipboard?: { writeText(t: string): unknown } } }).navigator?.clipboard?.writeText(
        text,
      ),
    ).then(
      () => setNote(done),
      () => setNote("Could not copy here."),
    );
  };
  // a copy of the PDF with the marked areas painted out of its pictures: a new file beside it, the original untouched
  const makeCopy = async (): Promise<void> => {
    if (pdfData === null) return;
    setNote("Making the redacted copy");
    try {
      const bytes = await redactedCopy(pdfData, pdfMarks);
      const base = file.name.replace(/\.pdf$/i, "");
      await d.call("files.create", {
        folderId: file.folderId,
        name: `${base} (redacted).pdf`,
        kind: "pdf",
        mime: "application/pdf",
        content: await contentFor(d, bytes, "application/pdf"),
        idempotencyKey: `redcopy-${fileId}-${pdfMarks.map((m) => m.id).join("")}`,
      });
      setNote(`Saved ${base} (redacted).pdf beside the original.`);
    } catch (e) {
      say(e);
    }
  };
  const openMore = (x: number, y: number, hidden: { label: string; onSelect: () => void }[] = []): void => {
    const name = load.status === "ready" ? load.data.file.name : "";
    accessMenu.show(
      [
        ...hidden,
        ...(hidden.length > 0
          ? [
              { label: "Redact for AI", onSelect: () => toggle("redact") },
              { label: "Activity", onSelect: () => toggle("activity") },
            ]
          : []),
        ...(isPdf && pdfData !== null && pdfMarks.length > 0
          ? [{ label: "Save a redacted copy", onSelect: () => void makeCopy() }]
          : []),
        ...(d.share ? [{ label: "Share…", onSelect: () => d.share?.(fileId, name) }] : []),
        {
          label: "Copy Link",
          onSelect: () =>
            itemLink("file", fileId) === "" ? copyLinkText("") : copyText(itemLink("file", fileId), "Link copied."),
        },
        { label: "Copy name", onSelect: () => copyText(name, "Name copied.") },
      ],
      x,
      y,
      "other",
      { label: "More" },
    );
  };
  const toggle = (k: "redact" | "activity"): void => setPanel((p) => (p === k ? null : k));
  const side =
    panel === "redact" ? (
      <RedactPanel
        layer={layer}
        name={d.name}
        now={now}
        fileName={file.name}
        path={(d.pathOf?.(file.folderId) ?? "").replace(/ \/ /g, " / ")}
        onDone={done}
        onAccess={openAccess}
        onJump={jumpToMark}
      />
    ) : panel === "activity" ? (
      <ActivityPanel
        rows={layer.activity}
        now={now}
        onOpen={(r) => {
          if (r.markId) jumpToMark(r.markId);
        }}
      />
    ) : undefined;
  const siblings = file.kind === "image" ? d.siblings?.(file.folderId) : undefined;
  // Word, Excel and PowerPoint files wear the list's own type tile (DOCX, XLSX, PPTX), with the provider's mark when they come from SharePoint or OneDrive
  const label = office ? tileLabel(file.name, file.kind) : null;
  // the list's tile keeps a 10 px gap after itself; here the header spaces it, so the provider's mark sits on the tile's corner
  const tile =
    label !== null ? (
      <View style={s.typeTile}>
        <TypeTile label={label} icon="doc" folder={false} />
      </View>
    ) : (
      <View style={s.tile}>
        <Text style={s.tileText}>{kindLabel(file.name)}</Text>
      </View>
    );
  const mark =
    app !== null ? (
      <GoogleTile app={app} size={28} />
    ) : file.source ? (
      <WithProviderMark provider={file.source.provider} size={12}>
        {tile}
      </WithProviderMark>
    ) : label !== null ? (
      tile
    ) : undefined;
  const path = d.pathOf?.(file.folderId);
  return (
    <View testID="file-viewer" accessibilityLabel={`Viewer, ${file.name}`} style={s.frame}>
      {ready.data.connected ? (
        <ConnectedBar
          connected={ready.data.connected}
          now={now}
          onChoose={(choice) =>
            void d.call("mounts.resolve", { fileId, choice }).then(() => {
              setNote(
                choice === "keep_both"
                  ? "Both are kept. Your version is saved beside theirs."
                  : "Theirs is the file now.",
              );
              setRev((x) => x + 1);
            }, say)
          }
        />
      ) : null}
      <Viewer
        key={`${fileId}:${layer.preview && layer.view?.text ? "agent" : "people"}`}
        fileId={fileId}
        title={file.name}
        kind={kind}
        pane={pane}
        kindLabel={kindLabel(file.name)}
        subtitle={subtitleOf(ready.data, now, path)}
        {...(mark !== undefined ? { kindMark: mark } : {})}
        {...((app !== null && !(wbk.state.status === "ready" && providerEdit) && !gDocEdit) ||
        (office && (offReady === null || !ready.data.canEdit)) ||
        file.kind === "pdf" ||
        ready.data.connected?.viewOnly === true ||
        (isBook && wbk.state.status === "ready" && (!ready.data.canEdit || wbk.lock !== undefined)) ||
        (isCsv && wbk.state.status === "ready" && (!ready.data.canEdit || !csvWhole))
          ? { readOnly: true }
          : {})}
        {...(office
          ? { noPreview: noPreviewWords(file.name) ?? "No preview of this file here. Open it in its own app." }
          : {})}
        {...(kind === "image" && ready.data.previewUrl ? { src: ready.data.previewUrl } : {})}
        boxes={boxes}
        strokes={strokes}
        blocks={shownBlocks}
        {...(fileLinks ? { fileLinks } : {})}
        {...(sheet ? { sheet } : {})}
        comments={
          layer.preview
            ? []
            : isPdf || offReady?.kind === "pptx"
              ? pageCommentsOf(ready.comments, d.name, now)
              : docCommentsOf(ready.comments, d.name, now)
        }
        {...(wbk.state.status === "ready"
          ? {
              ...(wbk.saved !== undefined ? { saved: wbk.saved } : {}),
              rich: (c: RichCtx): ReactElement => {
                const grid = (wbk.state as { grid: import("../../../../../../ui/src/Viewer/rich/grid-model.ts").Grid })
                  .grid;
                const m = wbk.matchCells(c.find);
                const cur =
                  c.hit === null ? undefined : m.list.filter((x) => x.sheet === c.hit!.block)[c.hit.occurrence];
                return (
                  <GridView
                    grid={grid}
                    rev={wbk.rev}
                    sheet={wbk.sheet}
                    onSheet={wbk.setSheet}
                    edit={c.edit}
                    {...(isCsv ? { header: true } : {})}
                    {...((
                      isGSheet
                        ? !providerEdit
                        : isCsv
                          ? !ready.data.canEdit || !csvWhole
                          : !ready.data.canEdit || wbk.lock !== undefined
                    )
                      ? {
                          why: ready.data.connected?.viewOnly
                            ? `View only in ${ready.data.connected.provider}.`
                            : wbk.lock !== undefined && ready.data.canEdit && isBook
                              ? wbk.lock
                              : isCsv && ready.data.canEdit && !csvWhole
                                ? "A large file is shown in part. Open it in its own app to change it."
                                : "You can read this file but not change it.",
                        }
                      : {})}
                    {...(isGSheet
                      ? {
                          noStructure:
                            "Google Sheets takes cell values here. Open it in Google Sheets to add or remove rows and columns.",
                        }
                      : {})}
                    find={c.find}
                    current={cur ?? null}
                    matches={m.all[wbk.sheet] ?? new Set<string>()}
                    onChange={wbk.changed}
                  />
                );
              },
            }
          : {})}
        {...(offReady
          ? {
              ...(off.saved !== undefined ? { saved: off.saved } : {}),
              ...(offReady.kind === "pptx" ? { paged: true } : {}),
              rich: (c: RichCtx): ReactElement => {
                const why = !ready.data.canEdit
                  ? ready.data.connected?.viewOnly
                    ? `View only in ${ready.data.connected.provider}.`
                    : "You can read this file but not change it."
                  : undefined;
                if (offReady.kind === "docx") {
                  const cur = c.hit?.block ?? null;
                  return (
                    <DocPage
                      model={offReady.doc}
                      rev={off.redrawRev}
                      zoom={c.zoom}
                      edit={c.edit}
                      {...(why !== undefined ? { why } : {})}
                      imageUrl={off.imageUrl}
                      decor={c.decor}
                      currentBlock={cur}
                      onChange={off.changed}
                      onRedraw={off.redraw}
                    />
                  );
                }
                return (
                  <SlideHost
                    ctx={c}
                    model={offReady.deck}
                    rev={off.redrawRev}
                    {...(why !== undefined ? { why } : {})}
                    imageUrl={off.imageUrl}
                    pins={pagePins(ready.comments)}
                    marks={pdfMarks}
                    onChange={off.changed}
                    onArea={(a) => {
                      if (a.tool === "redact") layer.mark({ kind: "redact", shape: "box", box: a.box, page: a.page });
                      else void commentOnPage(d, fileId, { page: a.page, box: a.box }, a.text).then(reload).catch(say);
                    }}
                  />
                );
              },
            }
          : {})}
        {...(isPdf && pdfData !== null
          ? {
              paged: true,
              noText: noTextLayer(pdfTexts, pdfDone),
              rich: (c: RichCtx): ReactElement => (
                <PdfPages
                  data={pdfData}
                  zoom={c.zoom}
                  find={c.find}
                  current={c.hit === null ? null : { page: c.hit.block + 1, occurrence: c.hit.occurrence }}
                  tool={c.tool}
                  pins={pagePins(ready.comments)}
                  marks={pdfMarks}
                  thumbs={c.thumbs}
                  jump={c.jump}
                  onPages={(i) => c.setPages(i.count)}
                  onPage={c.setPage}
                  onText={(t, done) => {
                    setPdfTexts(t);
                    setPdfDone(done);
                  }}
                  onZoom={c.setZoom}
                  onArea={(a) => {
                    if (a.tool === "redact") layer.mark({ kind: "redact", shape: "box", box: a.box, page: a.page });
                    else
                      void commentOnPage(
                        d,
                        fileId,
                        { page: a.page, box: a.box, ...(a.quote ? { quote: a.quote } : {}) },
                        a.text,
                      )
                        .then(reload)
                        .catch(say);
                  }}
                />
              ),
            }
          : {})}
        ask={{
          place: "files",
          context: { kind: "file", id: fileId, title: file.name, access: ready.data.canEdit ? "edit" : "view" },
          agents: d.agents,
          testID: "file-ask",
          onAsk: (agent, mode, about) =>
            d.ask?.(agent.id, mode, { kind: about.kind, id: about.id, title: about.title }),
        }}
        {...(siblings ? { siblings, current: fileId, onSibling: (id: string) => d.openFile?.(id) } : {})}
        {...(ready.graph && node
          ? { graph: ready.graph, nodeId: node, onOpenLink: (id: string) => d.openFile?.(id) }
          : {})}
        agentName={d.agentFor?.(fileId) ?? d.agents.find((a) => a.assistant)?.name ?? "the agent"}
        {...(ready.data.canMark ? { onBoxes: addBox, onStrokes: saveStrokes } : {})}
        {...(isEditable(ready.data) && !mdEditor ? { onEdit: edit } : {})}
        {...(gDocEdit ? { onEdit: editGDoc } : {})}
        {...(file.kind === "markdown" && app === null && !office && !(layer.preview && layer.view?.text)
          ? { markdown: rawText }
          : {})}
        {...(mdEditor
          ? {
              docEditor: (
                <FileMarkdownEditor
                  call={d.call}
                  fileId={fileId}
                  name={file.name}
                  text={rawText}
                  version={version.current}
                  onText={setLiveText}
                />
              ),
            }
          : {})}
        {...(link && d.openUrl
          ? { openIn: { label: openInWords(link.openIn), onOpen: () => d.openUrl?.(link.webUrl) } }
          : {})}
        layer={{ marks: viewerMarks(layer.list, d.name, now), preview: layer.preview }}
        onLayer={layer.mark}
        onUnmark={(markId) => void layer.run("files.marks.remove", { markId }, "Agents can read it again")}
        onMarkActivity={() => setPanel("activity")}
        onHistory={openHistory}
        onMore={openMore}
        compact={isPhoneWidth(width)}
        tools={<LayerTools open={panel} onToggle={toggle} />}
        banner={
          <LayerBanner
            layer={layer}
            name={d.name}
            onOpen={() => setPanel("redact")}
            onDone={done}
            panelOpen={panel === "redact"}
          />
        }
        {...(side !== undefined ? { side } : {})}
        {...(d.ask
          ? {
              onAskQuote: (quote: string) =>
                d.ask?.(d.agents.find((a) => a.assistant)?.id ?? "assistant", "chat", {
                  kind: "file",
                  id: fileId,
                  title: `“${quote.slice(0, 60)}” in ${file.name}`,
                }),
            }
          : {})}
        onComment={(quote, textIn) => void commentOnQuote(d, fileId, quote, textIn).then(reload).catch(say)}
        onResolve={(id) => void resolveComment(d, id).then(reload).catch(say)}
        onAskMarkup={(marked) =>
          d.ask?.(d.agents.find((a) => a.assistant)?.id ?? "assistant", "do", {
            kind: "file_markup",
            id: fileId,
            title: `${marked.length} marks on ${file.name}`,
          })
        }
      />
      {accessMenu.element}
      {firstOfMany && !note ? (
        <Text style={[s.note, s.noteHigh]} testID="file-viewer-sheets">
          {`Showing the first of ${sheetCount} sheets. ${link ? openInWords(link.openIn) : "Open it in its own app"} for the rest.`}
        </Text>
      ) : null}
      {isGSheet && wbk.state.status === "ready" && !note ? (
        <Text style={[s.note, s.noteHigh]} testID="file-viewer-firsttab">
          Showing the first tab. Open it in Google Sheets for the others.
        </Text>
      ) : null}
      {cutShort && !note ? (
        <Text style={s.note} testID="file-viewer-cutshort">
          Showing the first rows of a large file.
        </Text>
      ) : null}
      {note ? (
        <Text style={s.note} accessibilityLiveRegion="polite" testID="file-viewer-note">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/** The deck's body: the slide on show follows the viewer's page control, and reports how many slides there are. */
function SlideHost(p: {
  ctx: RichCtx;
  model: import("../../../../../../ui/src/Viewer/rich/pptx.ts").PptxModel;
  rev: number;
  why?: string;
  imageUrl: (path: string) => string | undefined;
  pins: readonly import("../../../../../../ui/src/Viewer/rich/PdfPages.tsx").PdfPin[];
  marks: readonly import("../../../../../../ui/src/Viewer/rich/PdfPages.tsx").PdfMark[];
  onChange: () => void;
  onArea: (a: {
    tool: "comment" | "redact";
    page: number;
    box: { x: number; y: number; w: number; h: number };
    text: string;
  }) => void;
}): ReactElement {
  const [slide, setSlide] = useState(1);
  const { setPages, setPage } = p.ctx;
  useEffect(() => setPages(p.model.slides.length), [p.model.slides.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPage(slide), [slide]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (p.ctx.jump !== null) setSlide(p.ctx.jump.page);
  }, [p.ctx.jump?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // Find on another slide brings that slide up
  useEffect(() => {
    if (p.ctx.hit !== null) setSlide(p.ctx.hit.block + 1);
  }, [p.ctx.hit?.block, p.ctx.hit?.occurrence, p.ctx.find]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SlideView
      model={p.model}
      rev={p.rev}
      slide={slide}
      onSlide={setSlide}
      zoom={Math.min(p.ctx.zoom, 1.4)}
      edit={p.ctx.edit}
      {...(p.why !== undefined ? { why: p.why } : {})}
      thumbs={p.ctx.thumbs}
      imageUrl={p.imageUrl}
      decor={p.ctx.decor}
      tool={p.ctx.tool}
      pins={p.pins}
      marks={p.marks}
      onChange={p.onChange}
      onArea={p.onArea}
    />
  );
}

const s = StyleSheet.create({
  frame: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  skHead: { height: 48, margin: 14, borderRadius: 9, backgroundColor: "var(--sunk)" as string },
  skBody: { flex: 1, margin: 14, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  tile: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: "var(--sunk)" as string,
    alignItems: "center",
    justifyContent: "center",
  },
  tileText: { color: "var(--ink-3)" as string, fontSize: 8.5, fontWeight: "700" },
  typeTile: { marginRight: -10 },
  getting: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "42%" as unknown as number,
    textAlign: "center",
    fontSize: 13,
    color: "var(--ink-3)" as string,
  },
  failedFrame: { alignItems: "center", justifyContent: "center" },
  failedBox: { height: 190, width: "100%" },
  failedOpen: { alignSelf: "center", paddingHorizontal: 12, paddingVertical: 8, marginTop: -6 },
  failedOpenText: { fontSize: 13, color: "var(--accent)" as string, fontWeight: "600" },
  noteHigh: { bottom: 48 },
  note: {
    position: "absolute",
    left: 16,
    bottom: 14,
    fontSize: 12.5,
    color: "var(--ink-2)" as string,
    backgroundColor: "var(--raised)" as string,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
});
