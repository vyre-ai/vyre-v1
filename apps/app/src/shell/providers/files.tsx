// The Files place in the shell (spec 3.5): the list of the open folder, Recent, Starred, Shared with me, Trash or Knowledge, with the Files sidebar in the shared place sidebar slot (P-L9_22).
// Where the list is, the selection and Quick Look are the place's own state. On a phone the sidebar is the list and the body opens when a row is chosen. Before the Space's runtime exists
// the place draws its loading frames.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { MountRow } from "../../places/files/mounts/index.ts";
import type { ShellRuntime } from "./runtime.tsx";
import { View, useWindowDimensions } from "react-native";
import { FilesList, ListLoading } from "../../places/files/list/index.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree, TreeLoading, useFilesState } from "../../places/files/tree/index.ts";
import { ReviewDataProvider } from "../../places/files/review/index.ts";
import { filesData } from "./files-data.ts";
import { MountSheets, MountStrip, useMountOf } from "./files-mounts.tsx";
import type { MountRequest } from "./files-mounts.tsx";
import type { MemoryView } from "./files-data.ts";
import { MemoryMount } from "./files-memory.tsx";
import { reviewData } from "./files-review.ts";
import { SidebarContent } from "../sidebar/index.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";

import { useOpenedId, usePlaceHash } from "../hash/context.tsx";
import { FileDetail } from "./file-detail.tsx";

const TREE_W = 240;

/** The open folder's list, with the status line of a mount above it when the folder is the root of one. */
function FolderBody({ rt, version, onUnmount }: { rt: ShellRuntime; version: number; onUnmount(mount: MountRow): void }): ReactElement {
  const { state } = useFilesState();
  const [mount, refresh] = useMountOf(rt, state.where.kind === "folder" ? state.where.id : null, version);
  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      {mount ? <MountStrip rt={rt} mount={mount} onUnmount={() => onUnmount(mount)} onChanged={refresh} /> : null}
      <FilesList />
    </View>
  );
}

export default function FilesPlace(_props: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  const fileId = useOpenedId(["file", "doc", "document"], ["fileId"]);
  const folderId = useOpenedId(["folder"], ["folderId"]);
  // Which Knowledge screen has the body: Proposed or Graph, from the sidebar or from a link that names the screen. Choosing anything else in the sidebar gives the body back to the list.
  const screen = usePlaceHash().target.screen;
  const [memory, setMemory] = useState<MemoryView["view"]>(screen === "files.memory-graph" ? "graph" : screen === "files.memory-proposed" ? "proposed" : null);
  useEffect(() => { if (screen === "files.memory-graph") setMemory("graph"); else if (screen === "files.memory-proposed") setMemory("proposed"); }, [screen]);
  // Connect a folder: the mount sheet, and the Unmount sheet for a mounted folder; `mountVersion` makes a mounted folder's status line read again after either
  const [mountReq, setMountReq] = useState<MountRequest | null>(null);
  const [mountVersion, setMountVersion] = useState(0);
  const data = useMemo(() => (rt ? filesData(rt, { view: memory, open: setMemory }, { connect: (into) => setMountReq({ kind: "mount", into }) }) : null), [rt, memory]);
  const review = useMemo(() => (rt ? reviewData(rt) : null), [rt]);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720;
  if (!data || !review) {
    return (
      <View testID="files-place-loading" style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
        {phone ? null : <View style={{ width: TREE_W }}><TreeLoading /></View>}
        <ListLoading />
      </View>
    );
  }
  return (
    <FilesDataProvider value={data}>
      <ReviewDataProvider value={review}>
        <FilesStateProvider key={folderId ?? "root"} {...(folderId ? { initial: { where: { kind: "folder" as const, id: folderId } } } : {})}>
          <View testID="files-place" style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
            <SidebarContent title="Files" searchPlaceholder="Search files">{(query, slot) => <FilesTree query={query} slot={slot} />}</SidebarContent>
            {fileId ? <FileDetail rt={rt!} fileId={fileId} /> : memory ? <MemoryMount rt={rt!} view={memory} /> : <FolderBody rt={rt!} version={mountVersion} onUnmount={(mount) => setMountReq({ kind: "unmount", mount })} />}
            <MountSheets rt={rt!} request={mountReq} onClose={() => setMountReq(null)} onChanged={() => setMountVersion((n) => n + 1)} />
          </View>
        </FilesStateProvider>
      </ReviewDataProvider>
    </FilesDataProvider>
  );
}
