// The Files data context (tree and list) built from the Space's runtime. The folder tree is the Space's folders read from the top of Files, shaped as the tree's nodes.
import type { LiveQuery, QueryState } from "../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../generated/types.ts";
import type { FolderNode } from "../../../../../ui/src/FolderTree/index.tsx";
import type { FilesData } from "../../places/files/tree/index.ts";
import { capLive, nameLookup } from "./records-live.ts";
import type { ShellRuntime } from "./runtime.tsx";

type ListOut = CapMap["files.list"]["out"];

/** Every folder the list answers for the top of Files, as the tree's nodes. */
export function folderNodes(out: ListOut): FolderNode[] {
  return out.folders.map((f) => {
    const space = f.scope === "space";
    return { id: f.folderId, name: f.name, parentId: f.parentId ?? null, count: f.fileCount, scope: space ? "space" : "personal", section: space ? "space" : "personal", via: space ? "space" : "owner", open: false };
  });
}

export function foldersQuery(rt: ShellRuntime): LiveQuery<readonly FolderNode[]> {
  const src = capLive<ListOut>(rt, "files.list", {});
  let last: QueryState<ListOut> | null = null;
  let out: QueryState<readonly FolderNode[]> = { status: "loading" };
  return {
    subscribe: src.subscribe,
    getSnapshot() {
      const s = src.getSnapshot();
      if (s === last) return out;
      last = s;
      out = s.status === "ready" ? { status: "ready", data: folderNodes(s.data) } : { status: "loading" };
      return out;
    },
  };
}

export function filesData(rt: ShellRuntime): FilesData {
  return {
    screens: rt.screens,
    live: (cap, input) => capLive(rt, cap, input as Record<string, unknown>),
    folders: foldersQuery(rt),
    call: rt.call,
    connection: rt.connection,
    clock: rt.clock,
    nameOf: nameLookup(rt),
    nav: {
      openFile: (fileId) => rt.open({ screen: "files.viewer", args: { fileId } }),
      shareFolder: (folderId) => rt.open({ screen: "spaces.switcher", args: { share: folderId } }),
      renameEntry: (kind, id, current) => rt.open({ screen: "files.list", args: { rename: id, kind, current } }),
      newFolder: (scope, parentId) => rt.open({ screen: "files.list", args: { newFolder: scope, ...(parentId ? { parentId } : {}) } }),
      openMemory: () => rt.open({ screen: "files.memory-proposed" }),
      openGraph: () => rt.open({ screen: "files.memory-graph" }),
    },
  };
}
