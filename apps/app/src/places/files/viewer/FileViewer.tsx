// The Files Viewer (spec 3.5, 2.16): one file open in the shared Viewer, in a tab or beside the chat. It reads the file (files.viewer_data), its comments (files.comments.list) and its
// markup (files.markup.get), and every change a person makes is one capability call: a pin on an image or a comment on a passage is files.comments.add, a resolved one files.comments.resolve,
// freehand drawing files.markup.save, an edit in place files.save with the version it started from. A refusal shows as a quiet line and the screen keeps what the person typed.
// The file to open comes from the tab hash (`subject=file:<id>`); this screen never reads the hash itself.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Viewer } from "../../../../../../ui/src/Viewer/index.tsx";
import type { DocBlock, MarkupBox, Stroke } from "../../../../../../ui/src/Viewer/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { commentOnQuote, pinArea, resolveComment, saveMarkup, saveText } from "./actions.ts";
import { useFilesViewerData } from "./data.tsx";
import { boxesOf, docCommentsOf, isEditable, kindLabel, parseCsv, strokesOf, subtitleOf, textToBlocks, viewerKind } from "./model.ts";
import type { FileComment, ViewerData } from "./model.ts";

type Markup = CapMap["files.markup.get"]["out"];
const SAVE_DELAY_MS = 600;

export interface FileViewerProps {
  fileId: string;
  /** In the side pane beside the chat rather than a tab of its own. */
  pane?: "main" | "side";
}

type Load = { status: "loading" } | { status: "gone" } | { status: "ready"; data: ViewerData; comments: readonly FileComment[]; markup: Markup };

export function FileViewer({ fileId, pane = "main" }: FileViewerProps): ReactElement {
  const d = useFilesViewerData();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [note, setNote] = useState<string | null>(null);
  const version = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((e: unknown): void => setNote(e instanceof Error ? e.message : "That did not work."), []);

  useEffect(() => {
    let live = true;
    setLoad({ status: "loading" });
    void (async () => {
      try {
        const data = (await d.call("files.viewer_data", { fileId })) as ViewerData;
        const comments = ((await d.call("files.comments.list", { fileId })) as { comments: FileComment[] }).comments;
        const markup = data.file.kind === "image" ? ((await d.call("files.markup.get", { fileId })) as Markup) : { strokes: [] };
        version.current = data.file.version;
        if (live) setLoad({ status: "ready", data, comments, markup });
      } catch { if (live) setLoad({ status: "gone" }); }
    })();
    return () => { live = false; if (timer.current) clearTimeout(timer.current); };
  }, [d, fileId]);

  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(null), 4500);
    return () => clearTimeout(t);
  }, [note]);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const comments = ((await d.call("files.comments.list", { fileId })) as { comments: FileComment[] }).comments;
      setLoad((cur) => (cur.status === "ready" ? { ...cur, comments } : cur));
    } catch (e) { say(e); }
  }, [d, fileId, say]);

  const ready = load.status === "ready" ? load : null;
  const kind = ready ? viewerKind(ready.data.file.kind) : "other";
  const text = ready?.data.text ?? "";
  const blocks = useMemo(() => (ready && kind === "document" ? textToBlocks(text, ready.data.file.kind) : []), [ready, kind, text]);
  const sheet = useMemo(() => (kind === "csv" ? parseCsv(text) : undefined), [kind, text]);
  const boxes = useMemo(() => (ready ? boxesOf(ready.comments) : []), [ready]);
  const strokes = useMemo(() => (ready ? strokesOf(ready.markup.strokes) : []), [ready]);

  if (load.status === "loading") return <View testID="file-viewer-loading" style={s.frame} accessibilityLabel="Loading the file"><View style={s.skHead} /><View style={s.skBody} /></View>;
  if (load.status === "gone" || !ready) return <View testID="file-viewer-gone" style={s.frame}><View style={s.gone}><Text style={s.goneText}>That file is not here, or you may not open it.</Text></View></View>;

  const file = ready.data.file;
  const now = d.clock().now;
  const addBox = (next: readonly MarkupBox[]): void => {
    const known = new Set(boxes.map((b) => b.id));
    const fresh = next.find((b) => !known.has(b.id));
    if (!fresh) { void reload(); return; }
    void pinArea(d, fileId, fresh, fresh.text).then(reload).catch(say);
  };
  const saveStrokes = (next: readonly Stroke[]): void => { void saveMarkup(d, fileId, next).catch(say); };
  const edit = (next: readonly DocBlock[]): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void saveText(d, fileId, next, file.kind, version.current).then((v) => { version.current = v; }).catch(say); }, SAVE_DELAY_MS);
  };

  const siblings = file.kind === "image" ? d.siblings?.(file.folderId) : undefined;
  const path = d.pathOf?.(file.folderId);
  return (
    <View testID="file-viewer" accessibilityLabel={`Viewer, ${file.name}`} style={s.frame}>
      <Viewer
        key={fileId}
        fileId={fileId} title={file.name} kind={kind} pane={pane}
        kindLabel={kindLabel(file.name)} subtitle={subtitleOf(ready.data, now, path)}
        {...(kind === "image" && ready.data.previewUrl ? { src: ready.data.previewUrl } : {})}
        boxes={boxes} strokes={strokes} blocks={blocks} {...(sheet ? { sheet } : {})}
        editing={isEditable(ready.data) && kind === "document"}
        comments={docCommentsOf(ready.comments, d.name, now)}
        ask={{ place: "files", context: { kind: "file", id: fileId, title: file.name, access: ready.data.canEdit ? "edit" : "view" }, agents: d.agents, testID: "file-ask", onAsk: (agent, mode, about) => d.ask?.(agent.id, mode, { kind: about.kind, id: about.id, title: about.title }) }}
        {...(siblings ? { siblings, current: fileId, onSibling: (id: string) => d.openFile?.(id) } : {})}
        onBoxes={addBox} onStrokes={saveStrokes} onEdit={edit}
        onComment={(quote, textIn) => void commentOnQuote(d, fileId, quote, textIn).then(reload).catch(say)}
        onResolve={(id) => void resolveComment(d, id).then(reload).catch(say)}
        onAskMarkup={(marked) => d.ask?.(d.agents.find((a) => a.assistant)?.id ?? "assistant", "do", { kind: "file_markup", id: fileId, title: `${marked.length} marks on ${file.name}` })}
      />
      {note ? <Text style={s.note} accessibilityLiveRegion="polite" testID="file-viewer-note">{note}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  frame: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  skHead: { height: 48, margin: 14, borderRadius: 9, backgroundColor: "var(--sunk)" as string },
  skBody: { flex: 1, margin: 14, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  gone: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  goneText: { fontSize: 13, color: "var(--ink-3)" as string },
  note: { position: "absolute", left: 16, bottom: 14, fontSize: 12.5, color: "var(--ink-2)" as string, backgroundColor: "var(--raised)" as string, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
});
