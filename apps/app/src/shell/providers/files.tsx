// The Files place in the shell (spec 3.5): the list of the open folder, Recent, Starred, Shared with me, Trash or Knowledge, with the Files sidebar in the shared place sidebar slot (P-L9_22).
// Where the list is, the selection and Quick Look are the place's own state. On a phone the sidebar is the list and the body opens when a row is chosen. Before the Space's runtime exists
// the place draws its loading frames.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { MountRow } from "../../places/files/mounts/index.ts";
import { View, useWindowDimensions } from "react-native";
import { FilesList, ListLoading } from "../../places/files/list/index.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree, TreeLoading, useFilesState } from "../../places/files/tree/index.ts";
import { ReviewDataProvider } from "../../places/files/review/index.ts";
import { filesData } from "./files-data.ts";
import { MountSheets, MountStrip, useMountOf } from "./files-mounts.tsx";
import { LiveFoldersHost } from "./files-live.tsx";
import type { MountRequest } from "./files-mounts.tsx";
import { MemoryMount } from "./files-memory.tsx";
import { KNOW_SCREEN, routeFromArgs, routeToArgs } from "../../places/files/memory/know.ts";
import type { KnowRoute } from "../../places/files/memory/know.ts";
import { reviewData } from "./files-review.ts";
import { SidebarContent } from "../sidebar/index.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";

import { useOpenedId, usePlaceHash } from "../hash/context.tsx";
import { AgentFileGate, ReviewScreen, reviewKind } from "./files-review-screens.tsx";
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

/**
 * The body beside the tree: a file (its viewer, or the agent file page for an agent's AGENT.md and agent.toml), one of the review screens the shell wrote to the hash (a change set, a compare,
 * a commit, a history), or the list. Choosing anything in the tree gives the body back to the list.
 */
function FilesBody({ rt, fileId, memory, live, onConnect, go, version, onUnmount }: { rt: ShellRuntime; fileId: string | null; memory: KnowRoute | null; live: boolean; onConnect(): void; go(route: KnowRoute | null): void; version: number; onUnmount(mount: MountRow): void }): ReactElement {
  const { target, opened } = usePlaceHash();
  const { state } = useFilesState();
  const review = reviewKind(target);
  const where = useRef(state.where);
  useEffect(() => {
    if (where.current !== state.where && review) opened({});
    where.current = state.where;
  }, [state.where, review, opened]);
  // a compare and a history name the file in the same hash argument the viewer reads: the review screen wins
  if (review) return <ReviewScreen rt={rt} target={target} />;
  if (fileId) return <AgentFileGate rt={rt} fileId={fileId}><FileDetail rt={rt} fileId={fileId} /></AgentFileGate>;
  if (memory) return <MemoryMount rt={rt} route={memory} go={go} />;
  if (live) return <LiveFoldersHost rt={rt} onConnect={onConnect} />;
  return <FolderBody rt={rt} version={version} onUnmount={onUnmount} />;
}

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
  // Live folders: every mount with how it is doing. Choosing anything else in the sidebar gives the body back (the tree calls leaveMemory, which is openRoute(null)).
  const [liveOn, setLiveOn] = useState(screen === "files.live");
  useEffect(() => { if (screen === "files.live") setLiveOn(true); }, [screen]);
  const openRoute = useCallback((r: KnowRoute | null): void => {
    setMemory(r);
    if (r) { setLiveOn(false); opened({ screen: KNOW_SCREEN, args: routeToArgs(r) }); } else setLiveOn(false);
  }, [opened]);
  const openLive = useCallback((): void => { setMemory(null); setLiveOn(true); opened({ screen: "files.live" }); }, [opened]);
  // Connect a folder: the mount sheet, and the Unmount sheet for a mounted folder; `mountVersion` makes a mounted folder's status line read again after either
  const [mountReq, setMountReq] = useState<MountRequest | null>(null);
  const [mountVersion, setMountVersion] = useState(0);
  const data = useMemo(() => (rt ? filesData(rt, { view: memory, open: openRoute }, { connect: (into) => setMountReq({ kind: "mount", into }), live: openLive, liveView: liveOn }) : null), [rt, memory, openRoute, openLive, liveOn]);
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
            <FilesBody rt={rt!} fileId={fileId} memory={memory} live={liveOn && !fileId} onConnect={() => setMountReq({ kind: "mount", into: null })} go={openRoute} version={mountVersion} onUnmount={(mount) => setMountReq({ kind: "unmount", mount })} />
            <MountSheets rt={rt!} request={mountReq} onClose={() => setMountReq(null)} onChanged={() => setMountVersion((n) => n + 1)} />
          </View>
        </FilesStateProvider>
      </ReviewDataProvider>
    </FilesDataProvider>
  );
}
