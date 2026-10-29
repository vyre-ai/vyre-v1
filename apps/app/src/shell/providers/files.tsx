// The Files place in the shell (spec 3.5): the list of the open folder, Recent, Starred, Shared with me, Trash or Knowledge, with the Files sidebar in the shared place sidebar slot (P-L9_22).
// Where the list is, the selection and Quick Look are the place's own state. On a phone the sidebar is the list and the body opens when a row is chosen. Before the Space's runtime exists
// the place draws its loading frames.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { View, useWindowDimensions } from "react-native";
import { FilesList, ListLoading } from "../../places/files/list/index.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree, TreeLoading } from "../../places/files/tree/index.ts";
import { ReviewDataProvider } from "../../places/files/review/index.ts";
import { filesData } from "./files-data.ts";
import type { MemoryView } from "./files-data.ts";
import { MemoryMount } from "./files-memory.tsx";
import { reviewData } from "./files-review.ts";
import { SidebarContent } from "../sidebar/index.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";

import { useOpenedId, usePlaceHash } from "../hash/context.tsx";
import { FileDetail } from "./file-detail.tsx";

const TREE_W = 240;

export default function FilesPlace(_props: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  const fileId = useOpenedId(["file", "doc", "document"], ["fileId"]);
  const folderId = useOpenedId(["folder"], ["folderId"]);
  // Which Knowledge screen has the body: Proposed or Graph, from the sidebar or from a link that names the screen. Choosing anything else in the sidebar gives the body back to the list.
  const screen = usePlaceHash().target.screen;
  const [memory, setMemory] = useState<MemoryView["view"]>(screen === "files.memory-graph" ? "graph" : screen === "files.memory-proposed" ? "proposed" : null);
  useEffect(() => { if (screen === "files.memory-graph") setMemory("graph"); else if (screen === "files.memory-proposed") setMemory("proposed"); }, [screen]);
  const data = useMemo(() => (rt ? filesData(rt, { view: memory, open: setMemory }) : null), [rt, memory]);
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
            {fileId ? <FileDetail rt={rt!} fileId={fileId} /> : memory ? <MemoryMount rt={rt!} view={memory} /> : <FilesList />}
          </View>
        </FilesStateProvider>
      </ReviewDataProvider>
    </FilesDataProvider>
  );
}
