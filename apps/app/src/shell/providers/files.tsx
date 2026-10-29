// The Files place in the shell (spec 3.5): the list of the open folder, Recent, Starred, Shared with me, Trash or Knowledge, with the Files sidebar in the shared place sidebar slot (P-L9_22).
// Where the list is, the selection and Quick Look are the place's own state. On a phone the sidebar is the list and the body opens when a row is chosen. Before the Space's runtime exists
// the place draws its loading frames.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { View, useWindowDimensions } from "react-native";
import { FilesList, ListLoading } from "../../places/files/list/index.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree, TreeLoading } from "../../places/files/tree/index.ts";
import { ReviewDataProvider } from "../../places/files/review/index.ts";
import { filesData } from "./files-data.ts";
import type { MemoryView } from "./files-data.ts";
import { MemoryMount } from "./files-memory.tsx";
import { KNOW_SCREEN, routeFromArgs, routeToArgs } from "../../places/files/memory/know.ts";
import type { KnowRoute } from "../../places/files/memory/know.ts";
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
  // Which Knowledge screen has the body: from the sidebar, from a link that names the screen, or from a click inside Knowledge (the route is written to the tab's hash, so back, forward and links follow it).
  // Choosing anything else in the sidebar gives the body back to the list.
  const { target, opened } = usePlaceHash();
  const screen = target.screen;
  const fromHash = (): KnowRoute | null => (screen === KNOW_SCREEN ? routeFromArgs(target.args) : screen === "files.memory-graph" ? { v: "graph" } : screen === "files.memory-proposed" ? { v: "learned" } : null);
  const [memory, setMemory] = useState<KnowRoute | null>(fromHash);
  const argsKey = JSON.stringify(target.args);
  useEffect(() => { const r = fromHash(); if (r) setMemory(r); }, [screen, argsKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const openRoute = useCallback((r: KnowRoute | null): void => {
    setMemory(r);
    if (r) opened({ screen: KNOW_SCREEN, args: routeToArgs(r) });
  }, [opened]);
  const data = useMemo(() => (rt ? filesData(rt, { view: memory, open: openRoute }) : null), [rt, memory, openRoute]);
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
            {fileId ? <FileDetail rt={rt!} fileId={fileId} /> : memory ? <MemoryMount rt={rt!} route={memory} go={openRoute} /> : <FilesList />}
          </View>
        </FilesStateProvider>
      </ReviewDataProvider>
    </FilesDataProvider>
  );
}
