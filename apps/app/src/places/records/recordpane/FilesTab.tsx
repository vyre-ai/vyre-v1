// Right pane > Files: what is in the record's folder, with Attach and drop. The folder is the record's own (a project's Folder field), else the one made for it on the first attach. A file opens in
// the viewer; a folder opens in Files.
import { createElement, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Tooltip } from "../../../../../../ui/src/Tooltip/index.tsx";
import { DropZone } from "../../../../../../ui/src/FileDrop/index.tsx";
import { useLive, usePageData } from "../recordpage/data.tsx";
import type { AttachFile } from "../recordpage/data.tsx";
import { PaneEmpty } from "./Empty.tsx";
import { useMaybeSignData } from "../../files/sign/data.tsx";
import { canSignFile, statusLine } from "../../files/sign/model.ts";
import { SignSheet } from "../../files/sign/SignSheet.tsx";
import { DocumentSheet } from "../../files/document/DocumentSheet.tsx";
import { useRequests } from "../../files/sign/useRequests.ts";
import { Status } from "../../../../../../ui/src/Status/index.tsx";

/** Today as 2026-11-19 in the day the Space keeps. */
const dayOf = (c: { now: number; offsetMin?: number }): string =>
  new Date(c.now + (c.offsetMin ?? 0) * 60_000).toISOString().slice(0, 10);

const size = (n: number): string =>
  n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;

interface Picked {
  name: string;
  type?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}
const asAttach = (list: ArrayLike<Picked> | null | undefined): AttachFile[] =>
  Array.from(list ?? []).map((f) => ({ name: f.name, mime: f.type ?? "", file: f }));

export function FilesTab({
  type,
  recordId,
  title,
  fieldFolder,
}: {
  type: string;
  recordId: string;
  title: string;
  fieldFolder?: string;
}): ReactElement {
  const data = usePageData();
  const [found, setFound] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const input = useRef<unknown>(null);
  const folderId = fieldFolder?.startsWith("fld_") ? fieldFolder : found;
  const target = { type, recordId, title };
  useEffect(() => {
    if (fieldFolder?.startsWith("fld_") || !data.files) return undefined;
    let off = false;
    void data.files.folderOf(target).then(
      (f) => {
        if (!off) setFound(f);
      },
      () => undefined,
    );
    return () => {
      off = true;
    };
  }, [data.files, type, recordId, title, fieldFolder]);
  const q = useLive("files.list", { folder: folderId ?? "" }, folderId !== null);
  const attach = (files: AttachFile[]): void => {
    if (!data.files || files.length === 0) return;
    setState("busy");
    data.files.attach(files, target).then(
      (f) => {
        setFound(f);
        setState("idle");
      },
      () => setState("failed"),
    );
  };
  /** A document made from here may have made the record's folder: look for it again. */
  const reloadFiles = (): void => {
    if (!data.files || fieldFolder?.startsWith("fld_")) return;
    void data.files.folderOf(target).then(
      (f) => setFound(f),
      () => undefined,
    );
  };
  const sign = useMaybeSignData();
  const [signing, setSigning] = useState<{ id: string; name: string } | null>(null);
  const [making, setMaking] = useState(false);
  const reqs = useRequests(sign, { recordId });
  const rows: ReactElement[] = [];
  // the signature requests made from this record: each is a related item with its state; pressing it opens the signed copy (or the file that was sent)
  if (sign)
    for (const e of reqs.list) {
      const line = statusLine(e, sign.clock().now, sign.clock().offsetMin ?? 0);
      const open = e.signedFileId ?? e.fileId;
      rows.push(
        <View key={e.id} style={s.row}>
          <Row
            id={`sign:${e.id}`}
            title={e.title}
            {...(line.note ? { note: line.note } : {})}
            trailing={<Status inline tone={line.tone} label={line.label} testID={`sign-state-${e.id}`} />}
            {...(open && sign.openFile ? { onPress: () => sign.openFile?.(open) } : {})}
          />
        </View>,
      );
    }
  if (q.status === "ready" && folderId !== null) {
    for (const d of q.data.folders)
      rows.push(
        <View key={d.folderId} style={s.row}>
          <Row
            id={`folder:${d.folderId}`}
            title={d.name}
            note="Folder"
            onPress={() => data.nav.openFiles(type, recordId)}
          />
        </View>,
      );
    for (const x of q.data.files)
      rows.push(
        <View key={x.fileId} style={s.row}>
          <Row
            id={`file:${x.fileId}`}
            title={x.name}
            titleSuffix={size(x.size)}
            {...(sign && sign.canSend !== false && canSignFile(x.name)
              ? {
                  trailing: (
                    <Tooltip text="Send for signature">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Send ${x.name} for signature`}
                        testID={`sign-file-${x.fileId}`}
                        onPress={() => setSigning({ id: x.fileId, name: x.name })}
                        style={({ hovered }: { hovered?: boolean }) => [s.pen, hovered === true && s.attachOver]}
                      >
                        <Text style={s.openText}>Sign</Text>
                      </Pressable>
                    </Tooltip>
                  ),
                }
              : {})}
            onPress={() => (data.nav.openFile ? data.nav.openFile(x.fileId) : data.nav.openFiles(type, recordId))}
          />
        </View>,
      );
  }
  const web = Platform.OS === "web";
  const pick = (): void => {
    (input.current as { click?: () => void } | null)?.click?.();
  };
  const body = rows.length ? (
    <ScrollView style={s.list} testID="pane-files-list">
      {rows}
    </ScrollView>
  ) : (
    <PaneEmpty
      icon="files"
      text={state === "failed" ? "Could not attach. Try again" : "No files"}
      testID="pane-files-empty"
    />
  );
  const inner = (
    <View style={s.root} testID="pane-files">
      <View style={s.bar}>
        {folderId !== null ? (
          <Tooltip text="Open the folder in Files">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open in Files"
              testID="open-files"
              onPress={() => data.nav.openFiles(type, recordId)}
              style={({ hovered }: { hovered?: boolean }) => [s.open, hovered === true && s.attachOver]}
            >
              <Text style={s.openText}>Open in Files</Text>
            </Pressable>
          </Tooltip>
        ) : null}
        <View style={{ flex: 1 }} />
        {sign && sign.canSend !== false ? (
          <Tooltip text="Make a document from a template">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New document"
              testID="new-document"
              onPress={() => setMaking(true)}
              style={({ hovered }: { hovered?: boolean }) => [s.attach, hovered === true && s.attachOver]}
            >
              <Text style={s.attachText}>New document</Text>
            </Pressable>
          </Tooltip>
        ) : null}
        {data.files ? (
          <Tooltip text="Attach files, or drop them here">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Attach"
              testID="attach-files"
              disabled={state === "busy"}
              onPress={pick}
              style={({ hovered }: { hovered?: boolean }) => [
                s.attach,
                hovered === true && s.attachOver,
                state === "busy" && s.dim,
              ]}
            >
              <Text style={s.attachText}>{state === "busy" ? "Attaching" : "Attach"}</Text>
            </Pressable>
          </Tooltip>
        ) : null}
      </View>
      {body}
      {making && sign ? (
        <DocumentSheet
          call={sign.call}
          recordId={recordId}
          recordType={type}
          folderId={folderId}
          today={dayOf(sign.clock())}
          onClose={() => {
            setMaking(false);
            reloadFiles();
          }}
          {...(sign.openFile ? { onOpen: (id: string) => sign.openFile?.(id) } : {})}
          onSign={(f) => {
            setMaking(false);
            reloadFiles();
            setSigning({ id: f.fileId, name: f.name });
          }}
        />
      ) : null}
      {signing && sign ? (
        <SignSheet
          fileId={signing.id}
          fileName={signing.name}
          recordId={recordId}
          onClose={() => setSigning(null)}
          onSent={() => reqs.reload()}
        />
      ) : null}
      {web && data.files
        ? createElement("input", {
            ref: input,
            type: "file",
            multiple: true,
            "data-testid": "attach-input",
            style: { display: "none" },
            onChange: (e: { target: { files: ArrayLike<Picked>; value: string } }) => {
              attach(asAttach(e.target.files));
              e.target.value = "";
            },
          })
        : null}
    </View>
  );
  if (!web || !data.files) return inner;
  // files dropped on the tab, or pasted into it, go to the record's folder through the same path as Attach
  return (
    <DropZone testID="files-dropzone" style={ZONE} onFiles={(files) => attach(asAttach(files as unknown as Picked[]))}>
      {inner}
    </DropZone>
  );
}

const ZONE = { flex: 1 };

const s = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  attach: {
    height: 26,
    paddingHorizontal: 12,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "var(--accent-wash)" as string,
  },
  attachOver: { opacity: 0.8 },
  attachText: { fontSize: 12.5, fontWeight: "600", color: "var(--accent)" as string },
  open: { height: 26, paddingHorizontal: 8, justifyContent: "center" },
  openText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  dim: { opacity: 0.5 },
  pen: { height: 24, paddingHorizontal: 8, borderRadius: 12, justifyContent: "center" },
  list: { flex: 1, minHeight: 0 },
  row: { paddingHorizontal: 6 },
});
