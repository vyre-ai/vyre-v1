// Right pane > Files: what is in the record's folder, with Attach and drop. The folder is the record's own (a project's Folder field), else the one made for it on the first attach. A file opens in
// the viewer; a folder opens in Files.
import { createElement, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Tooltip } from "../../../../../../ui/src/Tooltip/index.tsx";
import { useLive, usePageData } from "../recordpage/data.tsx";
import type { AttachFile } from "../recordpage/data.tsx";
import { PaneEmpty } from "./Empty.tsx";

const size = (n: number): string => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

interface Picked { name: string; type?: string; arrayBuffer(): Promise<ArrayBuffer> }
const asAttach = (list: ArrayLike<Picked> | null | undefined): AttachFile[] => Array.from(list ?? []).map((f) => ({ name: f.name, mime: f.type ?? "", file: f }));

export function FilesTab({ type, recordId, title, fieldFolder }: { type: string; recordId: string; title: string; fieldFolder?: string }): ReactElement {
  const data = usePageData();
  const [found, setFound] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const [over, setOver] = useState(false);
  const input = useRef<unknown>(null);
  const folderId = fieldFolder?.startsWith("fld_") ? fieldFolder : found;
  const target = { type, recordId, title };
  useEffect(() => {
    if (fieldFolder?.startsWith("fld_") || !data.files) return undefined;
    let off = false;
    void data.files.folderOf(target).then((f) => { if (!off) setFound(f); }, () => undefined);
    return () => { off = true; };
  }, [data.files, type, recordId, title, fieldFolder]);
  const q = useLive("files.list", { folder: folderId ?? "" }, folderId !== null);
  const attach = (files: AttachFile[]): void => {
    if (!data.files || files.length === 0) return;
    setState("busy");
    data.files.attach(files, target).then((f) => { setFound(f); setState("idle"); }, () => setState("failed"));
  };
  const rows: ReactElement[] = [];
  if (q.status === "ready" && folderId !== null) {
    for (const d of q.data.folders) rows.push(<View key={d.folderId} style={s.row}><Row id={`folder:${d.folderId}`} title={d.name} note="Folder" onPress={() => data.nav.openFiles(type, recordId)} /></View>);
    for (const x of q.data.files) rows.push(<View key={x.fileId} style={s.row}><Row id={`file:${x.fileId}`} title={x.name} titleSuffix={size(x.size)} onPress={() => (data.nav.openFile ? data.nav.openFile(x.fileId) : data.nav.openFiles(type, recordId))} /></View>);
  }
  const web = Platform.OS === "web";
  const pick = (): void => { (input.current as { click?: () => void } | null)?.click?.(); };
  const body = rows.length ? <ScrollView style={s.list} testID="pane-files-list">{rows}</ScrollView> : <PaneEmpty icon="files" text={state === "failed" ? "Could not attach. Try again" : "No files"} testID="pane-files-empty" />;
  const inner = (
    <View style={[s.root, over && s.over]} testID="pane-files">
      <View style={s.bar}>
        {folderId !== null ? (
          <Tooltip text="Open the folder in Files">
            <Pressable accessibilityRole="button" accessibilityLabel="Open in Files" testID="open-files" onPress={() => data.nav.openFiles(type, recordId)} style={({ hovered }: { hovered?: boolean }) => [s.open, hovered === true && s.attachOver]}>
              <Text style={s.openText}>Open in Files</Text>
            </Pressable>
          </Tooltip>
        ) : null}
        <View style={{ flex: 1 }} />
        {data.files ? (
          <Tooltip text="Attach files, or drop them here">
            <Pressable accessibilityRole="button" accessibilityLabel="Attach" testID="attach-files" disabled={state === "busy"} onPress={pick} style={({ hovered }: { hovered?: boolean }) => [s.attach, hovered === true && s.attachOver, state === "busy" && s.dim]}>
              <Text style={s.attachText}>{state === "busy" ? "Attaching" : "Attach"}</Text>
            </Pressable>
          </Tooltip>
        ) : null}
      </View>
      {body}
      {web && data.files ? createElement("input", { ref: input, type: "file", multiple: true, "data-testid": "attach-input", style: { display: "none" }, onChange: (e: { target: { files: ArrayLike<Picked>; value: string } }) => { attach(asAttach(e.target.files)); e.target.value = ""; } }) : null}
    </View>
  );
  if (!web || !data.files) return inner;
  return createElement(
    "div",
    {
      "data-testid": "files-dropzone", style: { display: "flex", flex: 1, minHeight: 0, flexDirection: "column" },
      onDragOver: (e: { preventDefault(): void }) => { e.preventDefault(); setOver(true); },
      onDragLeave: () => setOver(false),
      onDrop: (e: { preventDefault(): void; dataTransfer?: { files?: ArrayLike<Picked> } }) => { e.preventDefault(); setOver(false); attach(asAttach(e.dataTransfer?.files)); },
    },
    inner,
  );
}

const s = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  over: { backgroundColor: "var(--accent-wash)" as string },
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  attach: { height: 26, paddingHorizontal: 12, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent-wash)" as string },
  attachOver: { opacity: 0.8 },
  attachText: { fontSize: 12.5, fontWeight: "600", color: "var(--accent)" as string },
  open: { height: 26, paddingHorizontal: 8, justifyContent: "center" },
  openText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  dim: { opacity: 0.5 },
  list: { flex: 1, minHeight: 0 },
  row: { paddingHorizontal: 6 },
});
