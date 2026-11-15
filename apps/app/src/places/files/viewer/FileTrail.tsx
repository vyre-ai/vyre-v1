// Where an open file is: the path (the same Breadcrumb as the folder list) above the viewer. The path is the place the person came from (Recent, Starred, Shared with me, Trash, Knowledge) or the
// file's folders; a folder the person may not open is words, never a link. There is no Back control here: leaving a file is the shell's Back and Forward (the title bar's arrows, Cmd+[ and Cmd+]),
// the same in every tab. This file tells the shell which folder the file is in, so a file opened cold goes up to its folder.
import { useEffect, useState } from "react";
import { forgetFileFolder, rememberFileFolder } from "../../../shell/tabs/file-folders.ts";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { Breadcrumb } from "../Toolbar.tsx";
import type { Crumb } from "../Toolbar.tsx";
import { useFilesData, useFolderNodes } from "../tree/data.tsx";
import { useFilesState } from "../tree/state.tsx";
import { WHERE_LABEL, crumbs } from "../tree/model.ts";
import type { Where } from "../tree/model.ts";

const PLACE = "place:";

/** The crumbs above an open file. `nodes` is the folders the person can see; `file` null while it loads. */
export function fileTrail(
  where: Where,
  nodes: readonly { id: string; name: string; parentId: string | null }[],
  file: { name: string; folderId: string } | null,
): Crumb[] {
  const out: Crumb[] = [];
  if (where.kind !== "folder") {
    out.push({ key: where.kind, name: WHERE_LABEL[where.kind], id: `${PLACE}${where.kind}` });
  } else {
    out.push({ key: "root", name: "Files", id: null });
    const chain = file ? crumbs(nodes, file.folderId) : [];
    // the folders above the file the person can see; when the first of them has a parent they cannot see, the trail starts there
    for (const f of chain) out.push({ key: f.id, name: f.name, id: f.id });
    // a file in a folder the person cannot see (shared to them, a chat card): nothing to link to between Files and the file
  }
  out.push({ key: "file", name: file?.name ?? "" });
  return out;
}

/** `onGo` opens a folder (its id) or the Files landing (null) as a new step of the tab: choosing a place on the path is an open, like any other. */
export function FileTrail({ fileId, onGo }: { fileId: string; onGo(folderId: string | null): void }): ReactElement {
  const data = useFilesData();
  const { state, dispatch } = useFilesState();
  const nodes = useFolderNodes();
  const [file, setFile] = useState<{ name: string; folderId: string } | null>(null);
  useEffect(() => {
    let live = true;
    setFile(null);
    void (data.call("files.get", { fileId }) as Promise<{ file: { name: string; folderId: string } }>).then(
      (r) => {
        if (!live) return;
        setFile({ name: r.file.name, folderId: r.file.folderId });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [data, fileId]);
  const visible = nodes.status === "ready" ? nodes.data : [];
  // the shell sends Back from a cold file up to its folder, but only a folder this person can list: otherwise Back goes to the Files landing
  const listable = file !== null && nodes.status === "ready" ? visible.some((n) => n.id === file.folderId) : null;
  useEffect(() => {
    if (file === null || listable === null) return;
    if (listable) rememberFileFolder(fileId, file.folderId);
    else forgetFileFolder(fileId);
  }, [fileId, file, listable]);
  const trail = fileTrail(state.where, visible, file).map((c) =>
    // a folder the person cannot open (it is not in the folders they can see) is words
    c.id !== undefined && c.id !== null && !c.id.startsWith(PLACE) && !visible.some((n) => n.id === c.id)
      ? { ...c, plain: true }
      : c,
  );
  const go = (id: string | null): void => {
    if (id !== null && id.startsWith(PLACE)) {
      dispatch({ type: "go", where: { kind: id.slice(PLACE.length) } as Where });
      onGo(null);
    } else {
      dispatch({ type: "go", where: { kind: "folder", id } });
      onGo(id);
    }
  };
  return (
    <View style={s.bar} testID="file-trail">
      <Breadcrumb crumbs={trail} onGo={go} />
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 40 },
});
